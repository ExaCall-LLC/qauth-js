import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Dialog, FormField, Select, Switch, Table, TextInput, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { ScreenError } from "./transport.js";
import { Note, Section, useLoad, type Msg } from "./shared.js";

type DeviceType = "tv" | "phone" | "computer" | "other";

interface Device {
  id: string;
  name: string;
  type: DeviceType;
  kind: string;
  shared: boolean;
  appId: string;
  appName: string;
  place: string;
  lastActiveAt: string;
  current: boolean;
}
interface DeviceList {
  devices: Device[];
  appId?: string;
  counts?: { type: "" | DeviceType; inUse: number; limit: number }[];
  apps: { id: string; name: string; pairing: boolean }[];
}
interface PairingCode {
  code: string;
  appName: string;
  expiresAt: string;
  url: string;
}
interface Waiting {
  userCode: string;
  deviceName: string;
  deviceType: DeviceType;
  appName: string;
  place: string;
  askedAt: string;
  secondStep: boolean;
  choices?: number[];
  otherNetwork: boolean;
  approverPlace?: string;
  max: number;
  typeMax: number;
  inUse: number;
  typeInUse: number;
}
interface LimitSession {
  deviceId: string;
  name: string;
  type: DeviceType;
  appName: string;
  place: string;
}

const TYPES: DeviceType[] = ["tv", "phone", "computer", "other"];

/** "1 device", "3 devices"; Arabic singular, dual, 3–10 and 11+ (Intl plural rules). */
function devices(t: (k: never, p?: Record<string, string | number>) => string, locale: string, n: number): string {
  const cat = new Intl.PluralRules(locale === "ar" ? "ar" : "en").select(n);
  return (t as unknown as (k: string, p?: Record<string, string | number>) => string)(`count.device.${cat}`, { n });
}

/**
 * My account › Devices: everywhere the person is signed in to your apps,
 * `session`: your ID token's sid (`sessionIdOf(idToken)`), so this device
 * is marked and stays signed in when signing out others.
 * with the counts against one app's limits; rename, mark shared, sign out
 * one or every device of a type; Add a device (a pairing code).
 * `app`: the app whose counts to show first (default: the first one).
 */
export function MyDevices({ app, session }: { app?: string; session?: string }) {
  const { t, api, locale } = useScreens();
  const [appId, setAppId] = useState(app ?? "");
  const q = new URLSearchParams();
  if (appId) q.set("app", appId);
  if (session) q.set("session", session);
  const list = useLoad<DeviceList>(`/v1/me/devices${q.size ? `?${q}` : ""}`);
  const [msg, setMsg] = useState<Msg>(null);
  const [rename, setRename] = useState<Device | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const data = list.data;
  useEffect(() => {
    if (!appId && data?.apps.length) setAppId(data.apps[0].id);
  }, [appId, data]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: "success", text: ok });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      list.reload();
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar" : undefined);
  const cols: UiColumn<Device>[] = [
    {
      field: "name",
      header: t("devices.name"),
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {r.name}
          {r.current ? <Badge tone="info">{t("devices.this")}</Badge> : null}
          {r.shared ? <Badge tone="neutral">{t("devices.shared")}</Badge> : null}
        </span>
      ),
    },
    { field: "type", header: t("devices.type"), render: (r) => t(`devices.type.${r.type}`) },
    { field: "appName", header: t("devices.app") },
    { field: "lastActiveAt", header: t("account.lastUsed"), render: (r) => when(r.lastActiveAt) },
    { field: "place", header: t("devices.place"), render: (r) => r.place || "—" },
    {
      field: "id",
      header: "",
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Button size="sm" variant="ghost" onClick={() => (setRename(r), setName(r.name), setShared(r.shared))}>{t("devices.rename")}</Button>
          <Button size="sm" variant="ghost" onClick={() => run(() => api.send("DELETE", `/v1/me/devices/${encodeURIComponent(r.id)}`))}>{t("account.end")}</Button>
        </span>
      ),
    },
  ];
  const pairApps = (data?.apps ?? []).filter((a) => a.pairing);
  const counts = (data?.counts ?? []).filter((c) => c.type === "" || c.limit > 0 || c.inUse > 0);
  const tvs = (data?.devices ?? []).filter((d) => d.type === "tv").length;
  return (
    <Section title={t("devices.title")} hint={t("devices.hint")}>
      <Note msg={msg} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(data?.apps.length ?? 0) > 1 ? (
          <Select value={appId} onValueChange={setAppId} options={(data?.apps ?? []).map((a) => ({ value: a.id, label: a.name }))} aria-label={t("devices.app")} />
        ) : null}
        {counts.map((c) => (
          <Badge key={c.type || "all"} tone={c.limit && c.inUse >= c.limit ? "warning" : "neutral"}>
            {c.limit ? t("devices.countOf", { what: t(c.type ? `devices.types.${c.type}` : "devices.all"), n: c.inUse, max: c.limit }) : t("devices.count", { what: t(c.type ? `devices.types.${c.type}` : "devices.all"), n: c.inUse })}
          </Badge>
        ))}
      </div>
      <Table<Device> data={data?.devices ?? []} columns={cols} getRowId={(r) => r.id} loading={list.loading} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tvs > 0 ? (
          <Button
            variant="ghost"
            onClick={() =>
              // your own device stays when the session is known; "all TVs" otherwise means all of them
              run(() => api.send("DELETE", `/v1/me/devices?type=tv&${session ? `session=${encodeURIComponent(session)}` : "includeCurrent=true"}`))
            }
          >
            {t("devices.signOutTvs")}
          </Button>
        ) : null}
        {pairApps.length ? (
          <Button
            onClick={() =>
              run(async () => {
                const target = pairApps.find((a) => a.id === appId) ?? pairApps[0];
                setCode(await api.send<PairingCode>("POST", "/v1/me/pairing-codes", { appId: target.id }));
              })
            }
          >
            {t("devices.add")}
          </Button>
        ) : null}
      </div>
      {code ? (
        <Alert tone="info">
          <div style={{ display: "grid", gap: 6 }}>
            <strong>{t("devices.addTitle", { app: code.appName })}</strong>
            <span>{t("devices.addHint")}</span>
            <code dir="ltr" style={{ fontSize: 24, letterSpacing: 4 }}>{code.code.replace(/(.{4})(?=.)/g, "$1 ")}</code>
            <span>{t("devices.addValid", { time: when(code.expiresAt) })}</span>
            <div><Button size="sm" onClick={() => setCode(null)}>{t("common.done")}</Button></div>
          </div>
        </Alert>
      ) : null}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)} title={t("devices.rename")}>
        <div style={{ display: "grid", gap: 12 }}>
          <FormField label={t("devices.name")}>
            <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Switch checked={shared} onCheckedChange={setShared} aria-label={t("devices.markShared")} />
            {t("devices.markShared")}
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setRename(null)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const d = rename;
                setRename(null);
                if (d) void run(() => api.send("PUT", `/v1/me/devices/${encodeURIComponent(d.id)}`, { name, shared }));
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

/**
 * Approve a TV (or another device) from your app where the person is
 * signed in: they type or scan the TV's code, see the device, the app, the
 * place and the time, and approve or deny. At the app's limit they pick a
 * device to sign out first. `code`: the code from the QR (?code=).
 */
export function DeviceApproval({ code: initial = "", clientId }: { code?: string; clientId?: string }) {
  const { t, api, locale } = useScreens();
  const [code, setCode] = useState(initial);
  const [dev, setDev] = useState<Waiting | null>(null);
  const [limit, setLimit] = useState<LimitSession[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [done, setDone] = useState<string | null>(null);
  const [number, setNumber] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const path = `/v1/me/device-approvals/${encodeURIComponent(code.trim())}${clientId ? `?client=${encodeURIComponent(clientId)}` : ""}`;
  const look = async () => {
    setMsg(null);
    try {
      setDev(await api.get<Waiting>(path));
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const decide = async (decision: "approve" | "deny") => {
    setMsg(null);
    try {
      await api.send("POST", path, { decision, signOut: pick, number: number || undefined, confirmPlace: confirm });
      setDone(decision === "approve" ? t("approve.approved") : t("approve.denied"));
    } catch (e) {
      if (e instanceof ScreenError && e.code === "SESSION_LIMIT") {
        setLimit(((e.data as { sessions?: LimitSession[] } | undefined)?.sessions ?? []));
      }
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  if (done) return <Section title={t("approve.title")}><Alert tone="success">{done}</Alert></Section>;
  return (
    <Section title={t("approve.title")} hint={t("approve.hint")}>
      <Note msg={msg} />
      {!dev ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FormField label={t("approve.code")}>
            <TextInput dir="ltr" value={code} placeholder="XXXX-XXXX" maxLength={16} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <Button variant="primary" disabled={!code.trim()} onClick={() => void look()}>{t("common.continue")}</Button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <strong style={{ fontSize: 18 }}>{t("approve.question", { app: dev.appName })}</strong>
          <strong>{dev.place ? t("approve.where", { place: dev.place }) : t("approve.whereUnknown")}</strong>
          {dev.otherNetwork ? <Alert tone="danger">{t("approve.otherNetwork", { place: dev.approverPlace ?? "" })}</Alert> : null}
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
            <dt>{t("devices.name")}</dt><dd style={{ margin: 0 }}>{t("approve.callsItself", { name: dev.deviceName })}</dd>
            <dt>{t("devices.type")}</dt><dd style={{ margin: 0 }}>{t(`devices.type.${dev.deviceType}`)}</dd>
            <dt>{t("devices.app")}</dt><dd style={{ margin: 0 }}>{dev.appName}</dd>
            <dt>{t("devices.place")}</dt><dd style={{ margin: 0 }}>{dev.place || "—"}</dd>
            <dt>{t("approve.code")}</dt><dd style={{ margin: 0 }} dir="ltr">{dev.userCode}</dd>
            <dt>{t("approve.asked")}</dt><dd style={{ margin: 0 }}>{new Date(dev.askedAt).toLocaleString(locale === "ar" ? "ar" : undefined)}</dd>
          </dl>
          <Alert tone="warning">{t("approve.warning")}</Alert>
          {dev.typeMax ? <span>{t("approve.countsType", { n: devices(t, locale, dev.typeMax), used: dev.typeInUse })}</span> : dev.max ? <span>{t("approve.counts", { n: devices(t, locale, dev.max), used: dev.inUse })}</span> : null}
          {limit ? (
            <div style={{ display: "grid", gap: 6 }}>
              <strong>{t("approve.pick")}</strong>
              {limit.map((s) => (
                <label key={s.deviceId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flexShrink: 0, display: "inline-flex" }}>
                    <Checkbox checked={pick.includes(s.deviceId)} onCheckedChange={(v) => setPick(v === true ? [...pick, s.deviceId] : pick.filter((x) => x !== s.deviceId))} aria-label={s.name} />
                  </span>
                  {s.name} · {t(`devices.type.${s.type}`)} · {s.appName}{s.place ? ` · ${s.place}` : ""}
                </label>
              ))}
            </div>
          ) : null}
          {dev.choices?.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              <strong>{t("approve.pickNumber")}</strong>
              <div style={{ display: "flex", gap: 8 }}>
                {dev.choices.map((n) => (
                  <Button key={n} variant={number === n ? "primary" : "default"} aria-pressed={number === n} onClick={() => setNumber(n)}>{String(n)}</Button>
                ))}
              </div>
            </div>
          ) : null}
          {dev.otherNetwork ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flexShrink: 0, display: "inline-flex" }}>
                <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} aria-label={t("approve.confirm")} />
              </span>
              {t("approve.confirm")}
            </label>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" disabled={(!!dev.choices?.length && !number) || (dev.otherNetwork && !confirm)} onClick={() => void decide("approve")}>{t("approve.approve")}</Button>
            <Button variant="ghost" onClick={() => void decide("deny")}>{t("approve.deny")}</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

export { TYPES as DEVICE_TYPES };
