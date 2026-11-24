import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Alert, Badge, Button, FormField, Table, TextInput, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Note, ProofDialog, Section, useLoad, type Msg } from "./shared.js";
import { MyTokens } from "./Tokens.js";

interface Security {
  email: string;
  hasPassword: boolean;
  companyManaged: boolean;
  authenticator: boolean;
  phone?: string;
  recoveryCodes: number;
  passkeys?: { id: string; name: string }[];
  offered: { authenticator: boolean; phone: boolean };
}
interface Session {
  id: string;
  createdAt: string;
  lastUsed: string;
  device?: string;
  ip?: string;
}

/** The signed-in person's account: password, second steps, recovery codes, sessions. */
export function MyAccount() {
  const { t } = useScreens();
  const sec = useLoad<Security>("/v1/me/security");
  if (sec.loading && !sec.data) return <p>{t("common.loading")}</p>;
  if (sec.error || !sec.data) return <Alert tone="danger">{sec.error}</Alert>;
  const s = sec.data;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2 style={{ margin: 0 }}>{t("account.title")}</h2>
      <p style={{ margin: 0, opacity: 0.75 }}>{s.email}</p>
      {s.companyManaged ? <Alert tone="info">{t("account.company")}</Alert> : <PasswordSection />}
      {s.offered.authenticator || s.authenticator ? <AuthenticatorSection on={s.authenticator} reload={sec.reload} /> : null}
      {s.offered.phone || s.phone ? <PhoneSection phone={s.phone} reload={sec.reload} /> : null}
      {s.passkeys && s.passkeys.length ? <PasskeysSection keys={s.passkeys} reload={sec.reload} /> : null}
      {s.authenticator || s.phone ? <RecoverySection left={s.recoveryCodes} reload={sec.reload} /> : null}
      <SessionsSection />
      <MyTokens />
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
      setSetup(await api.send("POST", "/v1/me/authenticator"));
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
      <Note msg={msg} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Badge tone={on ? "success" : "neutral"}>{on ? t("account.authOn") : t("account.authOff")}</Badge>
        {on ? (
          <ProofDialog trigger={<Button size="sm" variant="ghost">{t("common.remove")}</Button>}
            onProof={async (p) => { await api.send("DELETE", "/v1/me/authenticator", p); reload(); }} />
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
  const [number, setNumber] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const add = async () => {
    try {
      const r = await api.send<{ codeSentTo: string }>("POST", "/v1/me/phone", { phone: number });
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
      <Note msg={msg} />
      {phone ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span dir="ltr">{phone}</span>
          <ProofDialog trigger={<Button size="sm" variant="ghost">{t("common.remove")}</Button>}
            onProof={async (p) => { await api.send("DELETE", "/v1/me/phone", p); reload(); }} />
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

function PasskeysSection({ keys, reload }: { keys: { id: string; name: string }[]; reload: () => void }) {
  const { t, api } = useScreens();
  return (
    <Section title={t("account.passkeys")} hint={t("account.passkeysHint")}>
      {keys.map((k) => (
        <div key={k.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <span>{k.name || t("account.passkeys")}</span>
          <ProofDialog trigger={<Button size="sm" variant="ghost">{t("common.remove")}</Button>}
            onProof={async (p) => { await api.send("DELETE", `/v1/me/passkeys/${encodeURIComponent(k.id)}`, p); reload(); }} />
        </div>
      ))}
    </Section>
  );
}

function RecoverySection({ left, reload }: { left: number; reload: () => void }) {
  const { t, api } = useScreens();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const make = async (proof?: object) => {
    const r = await api.send<{ codes: string[] }>("POST", "/v1/me/recovery-codes", proof ?? {});
    setCodes(r.codes);
    reload();
  };
  return (
    <Section title={t("account.recovery")} hint={t("account.recoveryLeft", { n: left })}>
      <Note msg={msg} />
      {codes ? (
        <>
          <Alert tone="warning">{t("account.recoveryHint")}</Alert>
          <pre dir="ltr" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{codes.join("\n")}</pre>
          <div><Button onClick={() => setCodes(null)}>{t("common.done")}</Button></div>
        </>
      ) : left > 0 ? (
        <ProofDialog trigger={<Button size="sm">{t("account.recoveryNew")}</Button>} onProof={(p) => make(p)} />
      ) : (
        <div><Button size="sm" onClick={() => make().catch((e: Error) => setMsg({ tone: "danger", text: e.message }))}>{t("account.recoveryNew")}</Button></div>
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
