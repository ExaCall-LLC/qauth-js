import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Dialog, FormField, Select, Table, TextInput, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Note, Section, useLoad, type Msg } from "./shared.js";

interface Token {
  id: string;
  name: string;
  prefix: string;
  orgId: string;
  permissions?: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}
interface Perm {
  id: string;
  key: string;
  name: string;
  group: string;
}
interface Choice {
  apiId: string;
  apiName: string;
  permissions: Perm[];
}
interface MyOrg {
  id: string;
  name: string;
}

type Expiry = "1m" | "3m" | "1y" | "custom" | "none";

function expiryOf(c: Expiry, date: string): { iso: string | null; ok: boolean } {
  const months = { "1m": 1, "3m": 3, "1y": 12 } as Record<string, number>;
  if (c === "none") return { iso: null, ok: true };
  if (c === "custom") {
    const d = date ? new Date(date + "T23:59:59") : null;
    return { iso: d ? d.toISOString() : null, ok: !!d && d > new Date() };
  }
  const x = new Date();
  x.setMonth(x.getMonth() + (months[c] ?? 3));
  return { iso: x.toISOString(), ok: true };
}

/** The permissions the person holds, by API and group; a group ticks all of its permissions. */
function Picker({ choices, value, onChange }: { choices: Choice[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useScreens();
  const set = (ids: string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((x) => !ids.includes(x)));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {choices.map((c) => {
        const groups: { name: string; items: Perm[] }[] = [];
        for (const p of c.permissions) {
          const name = p.group || t("tokens.other");
          let g = groups.find((x) => x.name === name);
          if (!g) groups.push((g = { name, items: [] }));
          g.items.push(p);
        }
        return (
          <div key={c.apiId} style={{ display: "grid", gap: 8 }}>
            {choices.length > 1 ? <strong style={{ fontSize: 13 }}>{c.apiName}</strong> : null}
            {groups.map((g) => {
              const ids = g.items.map((p) => p.id);
              const n = ids.filter((id) => value.includes(id)).length;
              return (
                <div key={g.name} style={{ display: "grid", gap: 4, border: "1px solid var(--exa-color-border)", borderRadius: 8, padding: "8px 10px" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                    <span style={{ flexShrink: 0, display: "inline-flex" }}>
                      <Checkbox checked={n === ids.length ? true : n > 0 ? "indeterminate" : false} onCheckedChange={(v) => set(ids, v === true)} aria-label={g.name} />
                    </span>
                    {g.name}
                  </label>
                  {g.items.map((p) => (
                    <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", paddingInlineStart: 24 }}>
                      <span style={{ flexShrink: 0, display: "inline-flex" }}>
                        <Checkbox checked={value.includes(p.id)} onCheckedChange={(v) => set([p.id], v === true)} aria-label={p.name || p.key} />
                      </span>
                      <span>
                        {p.name || p.key}
                        <span style={{ display: "block", fontSize: 12, opacity: 0.7, fontFamily: "var(--exa-font-mono, monospace)" }}>{p.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function NewToken({ orgs, onDone }: { orgs: MyOrg[]; onDone: () => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [exp, setExp] = useState<Expiry>("3m");
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const orgID = org || orgs[0]?.id || "";
  const choices = useLoad<Choice[]>(open && orgID ? `/v1/me/token-choices?org=${encodeURIComponent(orgID)}` : null);
  const e = expiryOf(exp, date);
  const close = () => {
    setOpen(false), setSecret(null), setName(""), setPerms([]), setErr(null), setExp("3m"), setDate("");
  };
  const save = async () => {
    setErr(null);
    try {
      const out = await api.send<{ secret: string }>("POST", "/v1/me/tokens", { orgId: orgID, name, permissions: perms, expiresAt: e.iso });
      setSecret(out.secret);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const list = choices.data ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      trigger={<Button variant="primary" disabled={!orgs.length}>{t("tokens.new")}</Button>}
      title={t("tokens.new")}
      description={t("tokens.newHint")}
      footer={secret ? <Button variant="primary" onClick={close}>{t("common.done")}</Button> : <Button variant="primary" onClick={save} disabled={!name.trim() || !perms.length || !e.ok}>{t("tokens.create")}</Button>}
    >
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {secret ? (
        <FormField label={t("tokens.secret")}>
          <TextInput readOnly value={secret} onFocus={(x) => x.currentTarget.select()} />
        </FormField>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <FormField label={t("common.name")} required>
            <TextInput value={name} onChange={(x) => setName(x.target.value)} placeholder={t("tokens.namePlaceholder")} />
          </FormField>
          {orgs.length > 1 ? (
            <FormField label={t("tokens.org")}>
              <Select value={orgID} onValueChange={(v) => (setOrg(v), setPerms([]))} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
            </FormField>
          ) : null}
          <FormField label={t("tokens.permissions")} hint={t("tokens.permissionsHint")} required>
            {choices.loading ? <span>{t("common.loading")}</span> : list.length ? <Picker choices={list} value={perms} onChange={setPerms} /> : <Alert tone="info">{t("tokens.noChoices")}</Alert>}
          </FormField>
          <FormField label={t("tokens.expires")} hint={exp === "none" ? t("tokens.neverHint") : undefined}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 170 }}>
                <Select
                  value={exp}
                  onValueChange={(v) => setExp(v as Expiry)}
                  options={(["1m", "3m", "1y", "custom", "none"] as const).map((v) => ({ value: v, label: t(`tokens.exp.${v}`) }))}
                  aria-label={t("tokens.expires")}
                />
              </div>
              {exp === "custom" ? <TextInput type="date" value={date} onChange={(x) => setDate(x.target.value)} aria-label={t("tokens.exp.custom")} /> : null}
            </div>
          </FormField>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The person's personal access tokens: see and revoke them; make one (a
 * subset of their own permissions) only with canCreate, in qAuth's own My
 * account: qAuth refuses a product's token (EXA-489).
 */
export function MyTokens({ canCreate = false }: { canCreate?: boolean } = {}) {
  const { t, api, locale } = useScreens();
  const list = useLoad<Token[]>("/v1/me/tokens");
  const orgs = useLoad<MyOrg[]>("/v1/me/orgs");
  const [msg, setMsg] = useState<Msg>(null);
  const names = Object.fromEntries((orgs.data ?? []).map((o) => [o.id, o.name]));
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : undefined) : t("tokens.exp.none"));
  const revoke = async (id: string) => {
    try {
      await api.send("DELETE", `/v1/me/tokens/${encodeURIComponent(id)}`);
      list.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const cols: UiColumn<Token>[] = [
    { field: "name", header: t("common.name") },
    { field: "orgId", header: t("tokens.org"), render: (r) => names[r.orgId] ?? "—" },
    { field: "permissions", header: t("tokens.permissions"), render: (r) => String(r.permissions?.length ?? 0) },
    { field: "expiresAt", header: t("tokens.expires"), render: (r) => when(r.expiresAt) },
    {
      field: "id",
      header: "",
      render: (r) =>
        r.revokedAt ? <Badge tone="neutral">{t("tokens.revoked")}</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke(r.id)}>{t("tokens.revoke")}</Button>,
    },
  ];
  const rows = list.data ?? [];
  return (
    <Section title={t("tokens.title")} hint={t("tokens.hint")}>
      <Note msg={msg} />
      {canCreate ? <div><NewToken orgs={orgs.data ?? []} onDone={list.reload} /></div> : <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>{t("tokens.ownOnly")}</p>}
      {rows.length ? <Table<Token> data={rows} columns={cols} getRowId={(r) => r.id} loading={list.loading} /> : null}
    </Section>
  );
}
