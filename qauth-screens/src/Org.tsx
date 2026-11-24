import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, FormField, MultiSelect, SegmentedControl, Table, TextInput, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Note, Section, useLoad, type Msg } from "./shared.js";
import type { MessageKey } from "./i18n.js";

type Role = "admin" | "manager" | "member";
interface MemberRole {
  id: string;
  name: string;
  space: string;
  spaceName: string;
}
interface Member {
  id: string;
  login: string;
  name?: string;
  role: Role;
  roles?: MemberRole[];
  managed: boolean;
}
/** A role of the organization and whether the signed-in person may give it (qAuth decides). */
interface GivableRole {
  id: string;
  name: string;
  space: string;
  spaceName: string;
  orgPermissions: string[];
  permissions: string[];
  canGive: boolean;
  missing?: string[];
}
interface Invitation {
  id: string;
  email: string;
  role: Role;
  roleIds?: string[];
  status: "pending" | "accepted" | "revoked" | "locked";
  expired: boolean;
}

/** Roles to pick, grouped by space; a role you can't give shows why. */
function RolePicker({ roles, value, onChange }: { roles: GivableRole[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useScreens();
  const spaces = [...new Set(roles.map((r) => r.space))].sort((a, b) => (a === "organization" ? -1 : b === "organization" ? 1 : 0));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {spaces.map((sp) => (
        <div key={sp} style={{ display: "grid", gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{sp === "organization" ? t("roles.orgSpace") : roles.find((r) => r.space === sp)?.spaceName}</strong>
          {roles.filter((r) => r.space === sp).map((r) => {
            const on = value.includes(r.id);
            const locked = !r.canGive && !on;
            const what = [...r.orgPermissions, ...r.permissions];
            return (
              <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: locked ? 0.55 : 1 }}>
                <span style={{ flexShrink: 0, display: "inline-flex" }}>
                  <Checkbox checked={on} disabled={!r.canGive} onCheckedChange={(v) => onChange(v ? [...value, r.id] : value.filter((x) => x !== r.id))} />
                </span>
                <span>
                  <span>{r.name}</span>
                  <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>
                    {!r.canGive && r.missing?.length ? t("roles.cantGive", { what: r.missing.join(", ") }) : what.length ? what.join(", ") : t("roles.nothing")}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function EditRoles({ base, member, roles, onDone }: { base: string; member: Member; roles: GivableRole[]; onDone: (ok: string) => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api.send("PUT", `${base}/members/${encodeURIComponent(member.id)}/roles`, { roleIds: picked });
      setOpen(false);
      onDone(t("roles.saved"));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setPicked((member.roles ?? []).map((r) => r.id)), setErr(null);
      }}
      trigger={<Button size="sm" variant="ghost" style={{ whiteSpace: "nowrap" }}>{t("roles.edit")}</Button>}
      title={t("roles.editTitle", { name: member.name || member.login })}
      footer={<Button variant="primary" onClick={save}>{t("common.save")}</Button>}
    >
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <RolePicker roles={roles} value={picked} onChange={setPicked} />
    </Dialog>
  );
}

/** The organization's people, and the invitations not yet accepted. */
export function OrgMembers({ orgId }: { orgId: string }) {
  const { t, api } = useScreens();
  const base = `/v1/orgs/${encodeURIComponent(orgId)}`;
  const members = useLoad<Member[]>(`${base}/members`);
  const invites = useLoad<Invitation[]>(`${base}/invitations`);
  const givable = useLoad<{ roles: GivableRole[] }>(`${base}/givable-roles`);
  const roles = givable.data?.roles ?? [];
  const [msg, setMsg] = useState<Msg>(null);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: "success", text: ok });
      members.reload(), invites.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const cols: UiColumn<Member>[] = [
    { field: "login", header: t("common.email") },
    { field: "name", header: t("common.name"), render: (r) => r.name || "—" },
    {
      field: "role",
      header: t("common.role"),
      render: (r) =>
        (r.roles ?? []).length ? (
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
            {(r.roles ?? []).map((x) => <Badge key={x.id} tone="neutral">{x.space === "organization" ? x.name : `${x.spaceName} · ${x.name}`}</Badge>)}
          </span>
        ) : (
          <Badge tone="warning">{t("roles.none")}</Badge>
        ),
    },
    { field: "managed", header: t("members.account"), render: (r) => <Badge tone={r.managed ? "info" : "neutral"}>{r.managed ? t("members.managed") : t("members.personal")}</Badge> },
    {
      field: "id",
      header: "",
      render: (r) => (
        <div style={{ display: "flex", gap: 4 }}>
          <EditRoles base={base} member={r} roles={roles} onDone={(ok) => act(async () => undefined, ok)} />
          <ResetPassword base={base} member={r} onDone={(ok) => act(async () => undefined, ok)} />
          <Button size="sm" variant="ghost" onClick={() => act(() => api.send("DELETE", `${base}/members/${encodeURIComponent(r.id)}`))}>{t("members.remove")}</Button>
        </div>
      ),
    },
  ];
  const pending = (invites.data ?? []).filter((i) => i.status !== "accepted");
  const state = (i: Invitation) =>
    i.status === "pending" ? (i.expired ? t("invites.expired") : t("invites.waiting")) : i.status === "locked" ? t("invites.locked") : t("invites.revoked");
  const icols: UiColumn<Invitation>[] = [
    { field: "email", header: t("common.email") },
    {
      field: "role",
      header: t("common.role"),
      render: (i) => (i.roleIds?.length ? roles.filter((r) => i.roleIds?.includes(r.id)).map((r) => r.name).join(", ") || "—" : t(`role.${i.role}` as MessageKey)),
    },
    { field: "status", header: "", render: (i) => <Badge tone={i.status === "pending" && !i.expired ? "info" : "warning"}>{state(i)}</Badge> },
    {
      field: "id",
      header: "",
      render: (i) =>
        i.status === "revoked" ? null : (
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => act(() => api.send("POST", `${base}/invitations/${encodeURIComponent(i.id)}/resend`, {}))}>{t("invites.resend")}</Button>
            {i.status === "pending" ? <Button size="sm" variant="ghost" onClick={() => act(() => api.send("DELETE", `${base}/invitations/${encodeURIComponent(i.id)}`))}>{t("invites.withdraw")}</Button> : null}
          </div>
        ),
    },
  ];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title={t("members.title")}>
        <Note msg={msg} />
        {members.error ? <Alert tone="danger">{members.error}</Alert> : null}
        <div><Invite base={base} roles={roles} onDone={(email) => act(async () => undefined, t("members.invited", { email }))} /></div>
        {!members.loading && !(members.data ?? []).length ? <EmptyState title={t("common.none")} /> : <Table<Member> data={members.data ?? []} columns={cols} getRowId={(r) => r.id} loading={members.loading} />}
      </Section>
      {pending.length ? (
        <Section title={t("invites.title")}>
          <Table<Invitation> data={pending} columns={icols} getRowId={(i) => i.id} />
        </Section>
      ) : null}
    </div>
  );
}

function Invite({ base, roles, onDone }: { base: string; roles: GivableRole[]; onDone: (email: string) => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setErr(null);
    try {
      await api.send("POST", `${base}/invitations`, { email, roleIds: picked });
      setOpen(false), setEmail(""), setPicked([]);
      onDone(email);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="primary">{t("members.add")}</Button>} title={t("members.add")}
      footer={<Button variant="primary" onClick={send} disabled={!email.trim()}>{t("common.continue")}</Button>}>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <FormField label={t("common.email")} required><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
      <FormField label={t("roles.title")}><RolePicker roles={roles} value={picked} onChange={setPicked} /></FormField>
    </Dialog>
  );
}

function ResetPassword({ base, member, onDone }: { base: string; member: Member; onDone: (ok: string) => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [changeRequired, setChangeRequired] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api.send("POST", `${base}/members/${encodeURIComponent(member.id)}/reset-password`, { password, changeRequired });
      setOpen(false), setPassword(""), setChangeRequired(true);
      onDone(t("members.resetDone"));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setPassword(""), setChangeRequired(true), setErr(null);
      }}
      trigger={<Button size="sm" variant="ghost">{t("members.resetPassword")}</Button>}
      title={t("members.resetTitle", { email: member.login })}
      footer={<Button variant="primary" onClick={save} disabled={!password}>{t("common.save")}</Button>}
    >
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <FormField label={t("members.newPassword")} required>
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </FormField>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <Checkbox checked={changeRequired} onCheckedChange={(v) => setChangeRequired(Boolean(v))} />
        <span>{t("members.changeRequired")}</span>
      </label>
    </Dialog>
  );
}

interface AppRole {
  id: string;
  orgId?: string;
  name: string;
  permissions: string[];
  orgPermissions?: string[];
}
interface Permission {
  id: string;
  key: string;
  name: string;
  group?: string;
}
interface OrgPermission {
  key: string;
  name: string;
  group: string;
}
interface PersonRoles {
  userId: string;
  login: string;
  roleIds: string[];
}

/** One app's roles in the organization: the app's own, the org's own, and who holds which. */
export function OrgRoles({ orgId, appId }: { orgId: string; appId: string }) {
  const { t, api } = useScreens();
  const base = `/v1/orgs/${encodeURIComponent(orgId)}`;
  const roles = useLoad<AppRole[]>(`${base}/apps/${encodeURIComponent(appId)}/roles`);
  const perms = useLoad<Permission[]>(`${base}/apps/${encodeURIComponent(appId)}/permissions`);
  const orgPerms = useLoad<OrgPermission[]>(`${base}/org-permissions`);
  const people = useLoad<PersonRoles[]>(`${base}/app-roles?app=${encodeURIComponent(appId)}`);
  const [msg, setMsg] = useState<Msg>(null);
  const permName = (id: string) => perms.data?.find((p) => p.id === id)?.name ?? id;
  const orgPermName = (key: string) => orgPerms.data?.find((p) => p.key === key)?.name ?? key;
  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      roles.reload(), people.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const rcols: UiColumn<AppRole>[] = [
    { field: "name", header: t("common.name"), render: (r) => <>{r.name} {r.orgId ? null : <Badge tone="neutral">{t("roles.builtin")}</Badge>}</> },
    {
      field: "permissions",
      header: t("roles.permissions"),
      render: (r) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          <span>{r.permissions.map(permName).join(", ") || ((r.orgPermissions ?? []).length ? "" : "—")}</span>
          {(r.orgPermissions ?? []).map((k) => <Badge key={k} tone="info">{orgPermName(k)}</Badge>)}
        </div>
      ),
    },
    { field: "id", header: "", render: (r) => (r.orgId ? <Button size="sm" variant="ghost" onClick={() => act(() => api.send("DELETE", `${base}/roles/${encodeURIComponent(r.id)}`))}>{t("common.remove")}</Button> : null) },
  ];
  const roleOpts = (roles.data ?? []).map((r) => ({ value: r.id, label: r.name }));
  const pcols: UiColumn<PersonRoles>[] = [
    { field: "login", header: t("common.email") },
    {
      field: "roleIds",
      header: t("roles.title"),
      render: (p) => <MultiSelect value={p.roleIds} options={roleOpts} aria-label={t("roles.title")}
        onValueChange={(v) => act(() => api.send("PUT", `${base}/app-roles`, { appId, userId: p.userId, roleIds: v }))} />,
    },
  ];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title={t("roles.title")}>
        <Note msg={msg} />
        <div><NewRole base={base} appId={appId} perms={perms.data ?? []} orgPerms={orgPerms.data ?? []} onDone={() => roles.reload()} /></div>
        <Table<AppRole> data={roles.data ?? []} columns={rcols} getRowId={(r) => r.id} loading={roles.loading} />
      </Section>
      <Section title={t("roles.who")}>
        <Table<PersonRoles> data={people.data ?? []} columns={pcols} getRowId={(p) => p.userId} loading={people.loading} />
      </Section>
    </div>
  );
}

type CheckItem = { id: string; name: string; group?: string };

function GroupedChecks({ items, selected, onChange }: { items: CheckItem[]; selected: string[]; onChange: (next: string[]) => void }) {
  const groups = new Map<string, CheckItem[]>();
  for (const it of items) {
    const g = it.group || "—";
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {[...groups.entries()].map(([g, ps]) => {
        const allIn = ps.every((p) => selected.includes(p.id));
        const someIn = ps.some((p) => selected.includes(p.id));
        const ids = ps.map((p) => p.id);
        return (
          <div key={g}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 600, opacity: 0.85, marginBottom: 4 }}>
              <Checkbox
                checked={allIn ? true : someIn ? "indeterminate" : false}
                aria-label={g}
                onCheckedChange={(v) => onChange(v ? Array.from(new Set([...selected, ...ids])) : selected.filter((x) => !ids.includes(x)))}
              />
              <span>{g}</span>
            </label>
            <div style={{ display: "grid", gap: 4, paddingInlineStart: 20 }}>
              {ps.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                  <Checkbox
                    checked={selected.includes(p.id)}
                    aria-label={p.name}
                    onCheckedChange={(v) => onChange(v ? [...selected, p.id] : selected.filter((y) => y !== p.id))}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewRole({ base, appId, perms, orgPerms, onDone }: { base: string; appId: string; perms: Permission[]; orgPerms: OrgPermission[]; onDone: () => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedOrg, setPickedOrg] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api.send("POST", `${base}/apps/${encodeURIComponent(appId)}/roles`, { name, permissions: picked, orgPermissions: pickedOrg });
      setOpen(false), setName(""), setPicked([]), setPickedOrg([]);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="primary">{t("roles.new")}</Button>} title={t("roles.new")}
      footer={<Button variant="primary" onClick={save} disabled={!name.trim() || (!picked.length && !pickedOrg.length)}>{t("common.save")}</Button>}>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <FormField label={t("common.name")} required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
      <div style={{ display: "grid", gap: 12 }}>
        {perms.length ? (
          <FormField label={t("roles.permissions")}>
            <GroupedChecks items={perms} selected={picked} onChange={setPicked} />
          </FormField>
        ) : null}
        {orgPerms.length ? (
          <FormField label={t("roles.orgPermissions")}>
            <GroupedChecks items={orgPerms.map((p) => ({ id: p.key, name: p.name, group: p.group }))} selected={pickedOrg} onChange={setPickedOrg} />
          </FormField>
        ) : null}
      </div>
    </Dialog>
  );
}

interface SSOState {
  connected: boolean;
  callbackUrl: string;
  connection?: { displayName: string; issuer: string; clientId: string; mode: "optional" | "required" };
}

/** The organization's company sign-in (admins). */
export function OrgCompanySignIn({ orgId }: { orgId: string }) {
  const { t, api } = useScreens();
  const path = `/v1/orgs/${encodeURIComponent(orgId)}/sso`;
  const st = useLoad<SSOState>(path);
  const c = st.data?.connection;
  const [form, setForm] = useState<{ displayName: string; issuer: string; clientId: string; clientSecret: string; mode: string } | null>(null);
  const f = form ?? { displayName: c?.displayName ?? "", issuer: c?.issuer ?? "", clientId: c?.clientId ?? "", clientSecret: "", mode: c?.mode ?? "optional" };
  const set = (k: keyof typeof f, v: string) => setForm({ ...f, [k]: v });
  const [msg, setMsg] = useState<Msg>(null);
  const save = async () => {
    try {
      await api.send("PUT", path, f);
      setMsg({ tone: "success", text: t("sso.saved") }), setForm(null);
      st.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const remove = async () => {
    try {
      await api.send("DELETE", path);
      setMsg({ tone: "success", text: t("sso.removed") }), setForm(null);
      st.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  if (st.error) return <Alert tone="danger">{st.error}</Alert>;
  return (
    <Section title={t("sso.title")} hint={t("sso.hint")}>
      <Note msg={msg} />
      <FormField label={t("sso.redirect")}><TextInput value={st.data?.callbackUrl ?? ""} readOnly dir="ltr" /></FormField>
      <FormField label={t("sso.displayName")} required><TextInput value={f.displayName} onChange={(e) => set("displayName", e.target.value)} /></FormField>
      <FormField label={t("sso.issuer")} required><TextInput value={f.issuer} onChange={(e) => set("issuer", e.target.value)} dir="ltr" placeholder="https://login.microsoftonline.com/<tenant id>/v2.0" /></FormField>
      <FormField label={t("sso.clientId")} required><TextInput value={f.clientId} onChange={(e) => set("clientId", e.target.value)} dir="ltr" /></FormField>
      <FormField label={t("sso.clientSecret")} required={!st.data?.connected}><TextInput type="password" value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} placeholder={st.data?.connected ? t("sso.secretKept") : ""} autoComplete="new-password" /></FormField>
      <FormField label={t("sso.mode")}>
        <SegmentedControl value={f.mode} onValueChange={(v) => set("mode", v)} options={[{ value: "optional", label: t("sso.optional") }, { value: "required", label: t("sso.required") }]} />
      </FormField>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" onClick={save}>{t("common.save")}</Button>
        {st.data?.connected ? <Button variant="ghost" onClick={remove}>{t("common.remove")}</Button> : null}
      </div>
    </Section>
  );
}

interface SubOrg {
  id: string;
  name: string;
  levelName?: string;
  parentOrgId?: string;
  isolatedDirectory?: boolean;
}
interface CreatedSubOrg {
  org: SubOrg;
  initialAdminPassword?: string;
}

/** Child organizations managed under a parent organization or service provider. */
export function OrgSubOrgs({ orgId }: { orgId: string }) {
  const { t, api } = useScreens();
  const base = `/v1/orgs/${encodeURIComponent(orgId)}`;
  const suborgs = useLoad<SubOrg[]>(`${base}/suborgs`);
  const cols: UiColumn<SubOrg>[] = [
    {
      field: "name",
      header: t("common.name"),
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span>{r.name}</span>
          {r.levelName ? <Badge tone="info">{r.levelName}</Badge> : null}
        </span>
      ),
    },
    {
      field: "isolatedDirectory",
      header: t("suborgs.isolatedDirectory"),
      render: (r) => (r.isolatedDirectory ? <Badge tone="info">{t("suborgs.isolatedDirectory")}</Badge> : "—"),
    },
  ];
  return (
    <Section title={t("suborgs.title")}>
      {suborgs.error ? <Alert tone="danger">{suborgs.error}</Alert> : null}
      <div><NewSubOrg base={base} onDone={() => suborgs.reload()} /></div>
      {!suborgs.loading && !(suborgs.data ?? []).length ? <EmptyState title={t("suborgs.none")} /> : <Table<SubOrg> data={suborgs.data ?? []} columns={cols} getRowId={(r) => r.id} loading={suborgs.loading} />}
    </Section>
  );
}

function NewSubOrg({ base, onDone }: { base: string; onDone: () => void }) {
  const { t, api } = useScreens();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [isolatedDirectory, setIsolatedDirectory] = useState(false);
  const [createdPw, setCreatedPw] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    setCreatedPw(null);
    try {
      const res = await api.send<CreatedSubOrg>("POST", `${base}/suborgs`, { name, adminEmail, isolatedDirectory });
      setName(""), setAdminEmail(""), setIsolatedDirectory(false);
      onDone();
      if (res?.initialAdminPassword) setCreatedPw(res.initialAdminPassword);
      else setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setCreatedPw(null), setErr(null);
      }}
      trigger={<Button variant="primary">{t("suborgs.add")}</Button>}
      title={t("suborgs.add")}
      footer={createdPw ? <Button onClick={() => setOpen(false)}>{t("common.done")}</Button> : <Button variant="primary" onClick={create} disabled={!name.trim() || !adminEmail.trim()}>{t("common.save")}</Button>}
    >
      {createdPw ? (
        <Alert tone="success">{t("suborgs.createdPassword", { password: createdPw })}</Alert>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {err ? <Alert tone="danger">{err}</Alert> : null}
          <FormField label={t("common.name")} required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label={t("suborgs.adminEmail")} required><TextInput type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></FormField>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <Checkbox checked={isolatedDirectory} onCheckedChange={(v) => setIsolatedDirectory(Boolean(v))} />
            <span>{t("suborgs.isolatedDirectory")}</span>
          </label>
        </div>
      )}
    </Dialog>
  );
}

interface BrandingData {
  displayName?: string;
  accent: string;
  background: string;
  mode: "auto" | "light" | "dark";
  language: "auto" | "en" | "ar";
  hasLogo: boolean;
}
interface AddressesData {
  active?: string;
  cnameTarget?: string;
  custom?: { host: string; status: string; lastError?: string };
}

const readLogoBase64 = (file: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(file);
  });

/** White-label branding (org default or per-app DBA override) and custom sign-in domain. */
export function OrgBranding({ orgId, appId }: { orgId: string; appId?: string }) {
  const { t, api } = useScreens();
  const base = `/v1/orgs/${encodeURIComponent(orgId)}`;
  const brandPath = appId ? `${base}/branding?app=${encodeURIComponent(appId)}` : `${base}/branding`;
  const st = useLoad<BrandingData>(brandPath);
  const c = st.data;
  const [form, setForm] = useState<{
    displayName: string;
    accent: string;
    background: string;
    mode: BrandingData["mode"];
    language: BrandingData["language"];
    logo: string;
    removeLogo: boolean;
  } | null>(null);
  const f = form ?? {
    displayName: c?.displayName ?? "",
    accent: c?.accent ?? "",
    background: c?.background ?? "",
    mode: c?.mode ?? "auto",
    language: c?.language ?? "auto",
    logo: "",
    removeLogo: false,
  };
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setForm({ ...f, [k]: v });
  const [msg, setMsg] = useState<Msg>(null);

  const save = async () => {
    setMsg(null);
    try {
      await api.send("PUT", brandPath, {
        displayName: f.displayName,
        accent: f.accent,
        background: f.background,
        mode: f.mode,
        language: f.language,
        ...(f.logo ? { logo: f.logo } : {}),
        ...(f.removeLogo ? { removeLogo: true } : {}),
      });
      setMsg({ tone: "success", text: t("branding.saved") }), setForm(null);
      st.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const reset = async () => {
    setMsg(null);
    try {
      await api.send("DELETE", brandPath);
      setMsg({ tone: "success", text: t("branding.removed") }), setForm(null);
      st.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!appId ? <OrgDomainSection base={base} /> : null}
      <Section title={t("branding.title")}>
        <Note msg={msg} />
        {st.error ? <Alert tone="danger">{st.error}</Alert> : null}
        <FormField label={t("branding.displayName")}>
          <TextInput value={f.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </FormField>
        <FormField label={t("branding.logo")}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={t("branding.logo")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readLogoBase64(file).then((data) => setForm({ ...f, logo: data, removeLogo: false }));
              }}
            />
            {f.logo || (c?.hasLogo && !f.removeLogo) ? (
              <Button size="sm" variant="ghost" onClick={() => setForm({ ...f, logo: "", removeLogo: Boolean(c?.hasLogo) })}>{t("branding.removeLogo")}</Button>
            ) : null}
          </div>
        </FormField>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <FormField label={t("branding.accent")}><TextInput value={f.accent} onChange={(e) => set("accent", e.target.value)} dir="ltr" placeholder="#2450C7" /></FormField>
          <FormField label={t("branding.background")}><TextInput value={f.background} onChange={(e) => set("background", e.target.value)} dir="ltr" placeholder="#FFFFFF" /></FormField>
        </div>
        <FormField label={t("branding.mode")}>
          <SegmentedControl
            value={f.mode}
            onValueChange={(v) => set("mode", v as BrandingData["mode"])}
            options={[{ value: "auto", label: t("branding.modeAuto") }, { value: "light", label: t("branding.modeLight") }, { value: "dark", label: t("branding.modeDark") }]}
          />
        </FormField>
        <FormField label={t("branding.language")}>
          <SegmentedControl
            value={f.language}
            onValueChange={(v) => set("language", v as BrandingData["language"])}
            options={[{ value: "auto", label: t("branding.modeAuto") }, { value: "en", label: "English" }, { value: "ar", label: "العربية" }]}
          />
        </FormField>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" onClick={save}>{t("common.save")}</Button>
          <Button variant="ghost" onClick={reset}>{t("branding.reset")}</Button>
        </div>
      </Section>
    </div>
  );
}

function OrgDomainSection({ base }: { base: string }) {
  const { t, api } = useScreens();
  const addr = useLoad<AddressesData>(`${base}/addresses`);
  const [host, setHost] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const currentHost = host ?? addr.data?.custom?.host ?? "";
  const target = addr.data?.cnameTarget || addr.data?.active;

  const saveDomain = async () => {
    setMsg(null);
    try {
      await api.send("PUT", `${base}/domain`, { hostname: currentHost });
      setMsg({ tone: "success", text: t("branding.domainSaved") }), setHost(null);
      addr.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  const removeDomain = async () => {
    setMsg(null);
    try {
      await api.send("DELETE", `${base}/domain`);
      setMsg({ tone: "success", text: t("branding.removed") }), setHost("");
      addr.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };

  return (
    <Section title={t("branding.domainTitle")} hint={target ? t("branding.domainTarget", { target }) : undefined}>
      <Note msg={msg} />
      {addr.error ? <Alert tone="danger">{addr.error}</Alert> : null}
      {addr.data?.custom ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code dir="ltr">{addr.data.custom.host}</code>
          <Badge tone={addr.data.custom.status === "ready" ? "success" : addr.data.custom.status === "failed" ? "danger" : "info"}>
            {t("branding.domainStatus", { status: addr.data.custom.status })}
          </Badge>
          {addr.data.custom.lastError ? <span style={{ fontSize: 12, opacity: 0.75 }}>{addr.data.custom.lastError}</span> : null}
        </div>
      ) : null}
      <FormField label={t("branding.domainHost")}>
        <TextInput value={currentHost} onChange={(e) => setHost(e.target.value)} placeholder="login.partner.com" dir="ltr" />
      </FormField>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" onClick={saveDomain} disabled={!currentHost.trim()}>{t("common.save")}</Button>
        {addr.data?.custom ? <Button variant="ghost" onClick={removeDomain}>{t("common.remove")}</Button> : null}
      </div>
    </Section>
  );
}
