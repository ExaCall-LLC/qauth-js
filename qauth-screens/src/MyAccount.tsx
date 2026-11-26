import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Alert, Badge, Button, Dialog, FormField, Table, TextInput, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Note, Section, useConfirm, useLoad, type Msg } from "./shared.js";
import { createPasskey, passkeysAvailable } from "./webauthn.js";
import { MyTokens } from "./Tokens.js";
import { RecentActivity } from "./Activity.js";

interface Security {
  email: string;
  hasPassword: boolean;
  companyManaged: boolean;
  authenticator: boolean;
  phone?: string;
  recoveryCodes: number;
  passkeys?: { id: string; name: string }[];
  passkeysHere?: boolean;
  offered: { authenticator: boolean; phone: boolean };
}
interface Session {
  id: string;
  createdAt: string;
  lastUsed: string;
  device?: string;
  ip?: string;
}

export interface MyAccountProps {
  /** The title above the page (default "My account"); null for none. */
  title?: string | null;
  /** "Where you're signed in" (the sign-in sessions, with Sign out everywhere). Default true. */
  sessions?: boolean;
  /** Recent activity. Default true. */
  activity?: boolean;
  /** Personal access tokens. Default true. */
  tokens?: boolean;
  /**
   * Shows "Add a passkey" where qAuth can't make one on this page (your
   * app sends the person to its sign-in pages). Where it can
   * (`passkeysHere`, e.g. qAuth's own Console and Portal), "Add a
   * passkey" works on the page itself and this is not needed.
   */
  onAddPasskey?: () => void;
  /** Shown right under the title (e.g. the devices list, a profile card). */
  children?: ReactNode;
}

/** The signed-in person's account: password, second steps, recovery codes, sessions. */
export function MyAccount({ title, sessions = true, activity = true, tokens = true, onAddPasskey, children }: MyAccountProps = {}) {
  const { t } = useScreens();
  const sec = useLoad<Security>("/v1/me/security");
  if (sec.loading && !sec.data) return <p>{t("common.loading")}</p>;
  if (sec.error || !sec.data) return <Alert tone="danger">{sec.error}</Alert>;
  const s = sec.data;
  const heading = title === undefined ? t("account.title") : title;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {heading ? <h2 style={{ margin: 0 }}>{heading}</h2> : null}
      <p style={{ margin: 0, opacity: 0.75 }}>{s.email}</p>
      {children}
      {s.companyManaged ? <Alert tone="info">{t("account.company")}</Alert> : <PasswordSection />}
      {s.offered.authenticator || s.authenticator ? <AuthenticatorSection on={s.authenticator} reload={sec.reload} /> : null}
      {s.offered.phone || s.phone ? <PhoneSection phone={s.phone} reload={sec.reload} /> : null}
      {(s.passkeys && s.passkeys.length) || s.passkeysHere || (onAddPasskey && !s.companyManaged) ? (
        <PasskeysSection keys={s.passkeys ?? []} reload={sec.reload} here={!!s.passkeysHere} hasSecond={s.authenticator || (s.passkeys?.length ?? 0) > 0}
          onAdd={s.companyManaged ? undefined : onAddPasskey} />
      ) : null}
      {s.authenticator || s.phone ? <RecoverySection left={s.recoveryCodes} reload={sec.reload} /> : null}
      {sessions ? <SessionsSection /> : null}
      {activity ? <RecentActivity /> : null}
      {tokens ? <MyTokens /> : null}
    </div>
  );
}

function PasswordSection() {
  const { t, api } = useScreens();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [rep, setRep] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const save = async () => {
    if (next !== rep) return setMsg({ tone: "danger", text: t("account.mismatch") });
    try {
      await api.send("PUT", "/v1/me/password", { current: cur, new: next });
      setMsg({ tone: "success", text: t("account.changed") });
      setCur(""), setNext(""), setRep("");
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <Section title={t("account.password")}>
      <Note msg={msg} />
      <FormField label={t("account.current")}><TextInput type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></FormField>
      <FormField label={t("account.new")}><TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></FormField>
      <FormField label={t("account.repeat")}><TextInput type="password" value={rep} onChange={(e) => setRep(e.target.value)} autoComplete="new-password" /></FormField>
      <div><Button variant="primary" onClick={save} disabled={!cur || !next}>{t("account.change")}</Button></div>
    </Section>
  );
}

function AuthenticatorSection({ on, reload }: { on: boolean; reload: () => void }) {
  const { t, api } = useScreens();
  const { confirm, dialog } = useConfirm();
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.uri, { margin: 1, width: 192 }).then(setQr);
  }, [setup]);
  const start = async () => {
    setMsg(null);
    try {
      const got = await confirm((p) => api.send<{ uri: string; secret: string }>("POST", "/v1/me/authenticator", p ?? {}));
      if (got) setSetup(got);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const verify = async () => {
    try {
      await api.send("POST", "/v1/me/authenticator/verify", { code });
      setSetup(null), setCode(""), setMsg({ tone: "success", text: t("account.authDone") });
      reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <Section title={t("account.authenticator")}>
      {dialog}
      <Note msg={msg} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Badge tone={on ? "success" : "neutral"}>{on ? t("account.authOn") : t("account.authOff")}</Badge>
        {on ? (
          <Button size="sm" variant="ghost" onClick={() => void run(msgSetter(setMsg), () => confirm((p) => api.send("DELETE", "/v1/me/authenticator", p ?? {})), reload)}>{t("common.remove")}</Button>
        ) : !setup ? (
          <Button size="sm" onClick={start}>{t("account.authSetUp")}</Button>
        ) : null}
      </div>
      {setup ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 14 }}>{t("account.authScan")}</p>
          {qr ? <img src={qr} alt="" width={192} height={192} /> : null}
          <code style={{ fontSize: 13, wordBreak: "break-all" }}>{t("account.authKey")}: {setup.secret}</code>
          <FormField label={t("account.authCode")}><TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></FormField>
          <div><Button variant="primary" onClick={verify} disabled={code.length < 6}>{t("common.continue")}</Button></div>
        </div>
      ) : null}
    </Section>
  );
}

function PhoneSection({ phone, reload }: { phone?: string; reload: () => void }) {
  const { t, api } = useScreens();
  const { confirm, dialog } = useConfirm();
  const [number, setNumber] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const add = async () => {
    try {
      const r = await confirm((p) => api.send<{ codeSentTo: string }>("POST", "/v1/me/phone", { phone: number, ...(p ?? {}) }));
      if (!r) return;
      setSentTo(r.codeSentTo), setMsg({ tone: "success", text: t("account.phoneSent", { phone: r.codeSentTo }) });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const verify = async () => {
    try {
      await api.send("POST", "/v1/me/phone/verify", { code });
      setSentTo(""), setCode(""), setNumber(""), setMsg({ tone: "success", text: t("account.phoneDone") });
      reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <Section title={t("account.phone")}>
      {dialog}
      <Note msg={msg} />
      {phone ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span dir="ltr">{phone}</span>
          <Button size="sm" variant="ghost" onClick={() => void run(msgSetter(setMsg), () => confirm((p) => api.send("DELETE", "/v1/me/phone", p ?? {})), reload)}>{t("common.remove")}</Button>
        </div>
      ) : !sentTo ? (
        <>
          <FormField label={t("account.phoneNumber")}><TextInput type="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+966 5x xxx xxxx" dir="ltr" /></FormField>
          <div><Button onClick={add} disabled={!number}>{t("account.phoneAdd")}</Button></div>
        </>
      ) : (
        <>
          <FormField label={t("account.phoneCode")}><TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></FormField>
          <div><Button variant="primary" onClick={verify} disabled={!code}>{t("common.continue")}</Button></div>
        </>
      )}
    </Section>
  );
}

function PasskeysSection({ keys, reload, onAdd, here, hasSecond }: { keys: { id: string; name: string }[]; reload: () => void; onAdd?: () => void; here: boolean; hasSecond: boolean }) {
  const { t, api } = useScreens();
  const { confirm, dialog } = useConfirm();
  const [made, setMade] = useState<{ passkeyId: string; options: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  // the browser makes the passkey (face, fingerprint or device PIN); if it
  // can't right away (no user gesture left, cancelled), "Try again" does
  const create = async (start: { passkeyId: string; options: unknown }) => {
    setBusy(true);
    try {
      const credential = await createPasskey(start.options);
      await api.send("POST", `/v1/me/passkeys/${encodeURIComponent(start.passkeyId)}/verify`, { credential });
      setMade(null);
      setMsg({ tone: "success", text: t(hasSecond ? "passkey.added" : "passkey.addedFirst") });
      reload();
    } catch (e) {
      setMade(start);
      setMsg({ tone: "danger", text: (e as Error).name === "NotAllowedError" || !(e as Error).message ? t("passkey.failed") : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setMsg(null);
    try {
      const start = await confirm((p) => api.send<{ passkeyId: string; options: unknown }>("POST", "/v1/me/passkeys", p ?? {}), t("confirm.addPasskey"));
      if (start) await create(start);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const rename = async () => {
    const k = renaming;
    setRenaming(null);
    if (!k) return;
    try {
      await api.send("PUT", `/v1/me/passkeys/${encodeURIComponent(k.id)}`, { name });
      setMsg({ tone: "success", text: t("account.passkeyRenamed") });
      reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <Section title={t("account.passkeys")} hint={t(here ? "passkey.hereHint" : onAdd ? "account.passkeysAddHint" : "account.passkeysHint")}>
      {dialog}
      <Note msg={msg} />
      {keys.length === 0 ? <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>{t("account.passkeysNone")}</p> : null}
      {here && passkeysAvailable() ? (
        <div style={{ display: "flex", gap: 8 }}>
          {made ? (
            <Button size="sm" variant="primary" onClick={() => void create(made)} disabled={busy}>{t("passkey.tryAgain")}</Button>
          ) : (
            <Button size="sm" onClick={() => void add()} disabled={busy}>{t("account.passkeyAdd")}</Button>
          )}
        </div>
      ) : onAdd ? <div><Button size="sm" onClick={onAdd}>{t("account.passkeyAdd")}</Button></div> : null}
      {keys.map((k) => (
        <div key={k.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <span>{k.name || t("account.passkeys")}</span>
          <span style={{ display: "inline-flex", gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => (setRenaming(k), setName(k.name))}>{t("account.passkeyRename")}</Button>
            <Button size="sm" variant="ghost" onClick={() => void run(msgSetter(setMsg), () => confirm((p) => api.send("DELETE", `/v1/me/passkeys/${encodeURIComponent(k.id)}`, p ?? {})), reload)}>{t("common.remove")}</Button>
          </span>
        </div>
      ))}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title={t("account.passkeyRename")}
        footer={<Button variant="primary" onClick={() => void rename()} disabled={!name.trim()}>{t("common.save")}</Button>}>
        <FormField label={t("account.passkeyName")}>
          <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </FormField>
      </Dialog>
    </Section>
  );
}

function RecoverySection({ left, reload }: { left: number; reload: () => void }) {
  const { t, api } = useScreens();
  const { confirm, dialog } = useConfirm();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const make = async () => {
    setMsg(null);
    try {
      const r = await confirm((p) => api.send<{ codes: string[] }>("POST", "/v1/me/recovery-codes", p ?? {}));
      if (r) setCodes(r.codes), reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <Section title={t("account.recovery")} hint={t("account.recoveryLeft", { n: left })}>
      {dialog}
      <Note msg={msg} />
      {codes ? (
        <>
          <Alert tone="warning">{t("account.recoveryHint")}</Alert>
          <pre dir="ltr" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{codes.join("\n")}</pre>
          <div><Button onClick={() => setCodes(null)}>{t("common.done")}</Button></div>
        </>
      ) : (
        <div><Button size="sm" onClick={() => void make()}>{t("account.recoveryNew")}</Button></div>
      )}
    </Section>
  );
}

function SessionsSection() {
  const { t, api, locale } = useScreens();
  const list = useLoad<Session[]>("/v1/me/sessions");
  const [msg, setMsg] = useState<Msg>(null);
  const end = async (path: string) => {
    try {
      await api.send("DELETE", path);
      list.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar" : undefined);
  const cols: UiColumn<Session>[] = [
    { field: "device", header: t("account.device"), render: (r) => r.device || "—" },
    { field: "lastUsed", header: t("account.lastUsed"), render: (r) => when(r.lastUsed) },
    { field: "id", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => end(`/v1/me/sessions/${encodeURIComponent(r.id)}`)}>{t("account.end")}</Button> },
  ];
  return (
    <Section title={t("account.sessions")} hint={t("account.endAllHint")}>
      <Note msg={msg} />
      <Table<Session> data={list.data ?? []} columns={cols} getRowId={(r) => r.id} loading={list.loading} />
      <div><Button variant="ghost" onClick={() => end("/v1/me/sessions")}>{t("account.endAll")}</Button></div>
    </Section>
  );
}

const msgSetter = (set: (m: Msg) => void) => set;

/** Runs a change that may ask to confirm; reloads after it (not after a cancel). */
async function run(setMsg: (m: Msg) => void, change: () => Promise<unknown>, reload: () => void) {
  setMsg(null);
  try {
    if ((await change()) !== undefined) reload();
  } catch (e) {
    setMsg({ tone: "danger", text: (e as Error).message });
  }
}
