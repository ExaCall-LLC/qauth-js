import { Badge, Table, type UiColumn } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Section, useLoad } from "./shared.js";
import type { MessageKey } from "./i18n.js";

interface Event {
  id: number;
  type: string;
  result?: "success" | "refused" | "failed";
  actor?: string;
  actorName?: string;
  appName?: string;
  ip?: string;
  userAgent?: string;
  at: string;
}

/** What an event means to the person; other types show as they are named. */
const LABELS: Record<string, MessageKey> = {
  "signin.succeeded": "activity.ev.signedIn",
  "signin.single_sign_on": "activity.ev.signedIn",
  "signin.failed": "activity.ev.wrongPassword",
  "signin.refused": "activity.ev.refused",
  "signin.denied": "activity.ev.denied",
  "signin.second_factor": "activity.ev.secondStep",
  "signin.second_factor_failed": "activity.ev.wrongCode",
  "signin.stepped_up": "activity.ev.steppedUp",
  "signin.reset_requested": "activity.ev.resetAsked",
  "signin.reset_completed": "activity.ev.passwordChanged",
  "session.signed_out": "activity.ev.signedOut",
  "session.ended_idle": "activity.ev.ended",
  "session.ended_max_length": "activity.ev.ended",
  "me.password.updated": "activity.ev.passwordChanged",
  "me.authenticator.verify": "activity.ev.authenticatorOn",
  "me.authenticator.removed": "activity.ev.authenticatorOff",
  "me.phone.verify": "activity.ev.phoneOn",
  "me.phone.removed": "activity.ev.phoneOff",
  "me.passkeys.removed": "activity.ev.passkeyOff",
  "me.passkeys.updated": "activity.ev.passkeyRenamed",
  "signin.passkey_added": "activity.ev.passkeyOn",
  "passkey.added": "activity.ev.passkeyOn",
  "me.recovery-codes": "activity.ev.recoveryCodes",
  "me.tokens.created": "activity.ev.tokenOn",
  "me.tokens.removed": "activity.ev.tokenOff",
  "me.sessions.removed": "activity.ev.signedOut",
};

/**
 * My account › Recent activity: the person's own sign-ins (where from, on
 * which device), refused attempts, and changes to their password, second
 * steps, passkeys and tokens, newest first (GET /v1/me/activity).
 */
export function RecentActivity({ limit = 20 }: { limit?: number }) {
  const { t, locale } = useScreens();
  const list = useLoad<Event[]>(`/v1/me/activity?limit=${limit}`);
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar" : undefined);
  const cols: UiColumn<Event>[] = [
    { field: "at", header: t("activity.when"), render: (r) => when(r.at) },
    {
      field: "type",
      header: t("activity.what"),
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {LABELS[r.type] ? t(LABELS[r.type] as MessageKey) : <code dir="ltr">{r.type}</code>}
          {r.result && r.result !== "success" ? <Badge tone="warning">{t("activity.refused")}</Badge> : null}
        </span>
      ),
    },
    { field: "appName", header: t("activity.app"), render: (r) => r.appName || "—" },
    { field: "ip", header: t("activity.where"), render: (r) => (r.ip ? <code dir="ltr">{r.ip}</code> : "—") },
    { field: "userAgent", header: t("account.device"), render: (r) => <span style={{ fontSize: 12, opacity: 0.8 }}>{r.userAgent || "—"}</span> },
  ];
  return (
    <Section title={t("activity.title")} hint={t("activity.hint")}>
      <Table<Event> data={list.data ?? []} columns={cols} getRowId={(r) => String(r.id)} loading={list.loading} />
    </Section>
  );
}
