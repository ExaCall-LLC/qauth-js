import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, FormField, TextInput } from "@isdlc.ai/ui";
import { useScreens } from "./context.js";
import { Section } from "./shared.js";

type Channel = "sms" | "voice" | "email" | "authenticator";
interface Started {
  requestId: string;
  channel: Channel;
  sentTo: string;
  expiresAt: string;
  channels: Channel[];
}

export interface ConfirmActionProps {
  /** The verification template's id or name, e.g. "Money transfer". */
  template: string;
  /** Every variable the template declares (except first_name). */
  variables?: Record<string, string>;
  /** Heading, e.g. "Confirm the transfer". */
  title?: ReactNode;
  /** What is being confirmed, e.g. "500 SAR to Hesham". */
  summary?: ReactNode;
  /**
   * Called once the code is right, with the request id. Send it to YOUR
   * backend, which consumes it (with the same values) before acting.
   */
  onVerified: (requestId: string) => void;
  onCancel?: () => void;
}

const RESEND_AFTER = 30;

/**
 * Confirms one action with a one-time code: sends it to the person's own
 * phone or email (or asks for their authenticator app), shows where it went,
 * takes the code, offers "send again" and the person's other channels.
 */
export function ConfirmAction({ template, variables, title, summary, onVerified, onCancel }: ConfirmActionProps) {
  const { t, api } = useScreens();
  const [v, setV] = useState<Started | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [spent, setSpent] = useState(false);
  const started = useRef(false);
  const vars = JSON.stringify(variables ?? {});

  const start = useCallback(async () => {
    setErr(null), setSpent(false), setCode(""), setBusy(true);
    try {
      setV(await api.send<Started>("POST", "/v1/verifications", { template, variables: JSON.parse(vars) }));
      setWait(RESEND_AFTER);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, template, vars]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const resend = async (channel?: Channel) => {
    if (!v) return;
    setErr(null), setBusy(true);
    try {
      setV(await api.send<Started>("POST", `/v1/verifications/${encodeURIComponent(v.requestId)}/resend`, channel ? { channel } : {}));
      setCode(""), setWait(RESEND_AFTER);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!v) return;
    setErr(null), setBusy(true);
    try {
      const r = await api.send<{ status: string; triesLeft: number }>("POST", `/v1/verifications/${encodeURIComponent(v.requestId)}/check`, { code: code.trim() });
      if (r.status === "verified") return onVerified(v.requestId);
      if (r.status === "spent") setSpent(true);
      else setErr(t("confirm.wrong", { n: r.triesLeft }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const where = v ? (v.channel === "authenticator" ? t("confirm.fromApp") : t(v.channel === "voice" ? "confirm.calling" : "confirm.sent", { to: v.sentTo })) : "";
  const others = v ? v.channels.filter((c) => c !== v.channel) : [];
  return (
    <Section title={title ?? t("confirm.title")} hint={summary}>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {spent ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Alert tone="info">{t("confirm.spent")}</Alert>
          <div>
            <Button variant="primary" onClick={() => void start()} disabled={busy}>
              {t("confirm.newCode")}
            </Button>
          </div>
        </div>
      ) : v ? (
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0 }}>{where}</p>
          <FormField label={t("confirm.code")}>
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" dir="ltr" autoFocus />
          </FormField>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => void confirm()} disabled={busy || !code.trim()}>
              {t("confirm.confirm")}
            </Button>
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            {v.channel !== "authenticator" ? (
              <Button size="sm" variant="ghost" onClick={() => void resend()} disabled={busy || wait > 0}>
                {wait > 0 ? t("confirm.againIn", { s: wait }) : t("confirm.again")}
              </Button>
            ) : null}
            {others.map((c) => (
              <Button key={c} size="sm" variant="ghost" onClick={() => void resend(c)} disabled={busy}>
                {t(`confirm.use.${c}`)}
              </Button>
            ))}
          </div>
        </div>
      ) : busy ? (
        <p style={{ margin: 0 }}>{t("common.loading")}</p>
      ) : (
        <div>
          <Button variant="primary" onClick={() => void start()}>
            {t("confirm.newCode")}
          </Button>
        </div>
      )}
    </Section>
  );
}
