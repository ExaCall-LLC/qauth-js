import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@isdlc.ai/ui";
import { watchIdle, type IdleWarning as Warning, type IdleWatch, type SessionEnd, type SessionState } from "@isdlc.ai/qauth";
import { useScreens } from "./context.js";

export interface IdleWarningProps {
  /** The session id: the `sid` claim of the person's ID token (sessionIdOf). */
  sessionId: string;
  /**
   * The session is over (idle, maximum length, or signed out elsewhere):
   * sign the person out of your app here.
   */
  onEnded: (reason: SessionEnd) => void;
  /** "Sign out" in the warning: sign the person out now. */
  onSignOut: () => void;
  /** Warn this many seconds before the end. Default 60. */
  warnSeconds?: number;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Idle sign-out for your screens: counts the person's activity (across all
 * tabs of the session), reports it to qAuth, and shows a warning with a
 * countdown before the session ends — "Stay signed in" keeps it. Renders
 * nothing until then. qAuth ends the session on time even if the app is
 * closed; this only makes the end visible and avoidable.
 */
export function IdleWarning({ sessionId, onEnded, onSignOut, warnSeconds = 60 }: IdleWarningProps) {
  const { t, api } = useScreens();
  const [warn, setWarn] = useState<Warning | null>(null);
  const watch = useRef<IdleWatch | null>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    if (!sessionId) return;
    const path = `/v1/me/sessions/${encodeURIComponent(sessionId)}`;
    const w = watchIdle({
      sessionId,
      warnSeconds,
      source: { state: () => api.get<SessionState>(`${path}/state`), activity: () => api.send<SessionState>("POST", `${path}/activity`) },
      onWarn: setWarn,
      onActive: () => setWarn(null),
      onEnded: (r) => {
        setWarn(null);
        ended.current(r);
      },
    });
    watch.current = w;
    return () => w.stop();
  }, [api, sessionId, warnSeconds]);

  if (!warn) return null;
  const idle = warn.reason === "idle";
  return (
    <Dialog
      open
      hideClose
      size="sm"
      onOpenChange={() => undefined}
      title={idle ? t("idle.title") : t("idle.maxTitle")}
      description={t(idle ? "idle.body" : "idle.maxBody", { time: mmss(warn.secondsLeft) })}
      footer={
        <>
          <Button variant="ghost" onClick={onSignOut}>{t("idle.signOut")}</Button>
          {idle && <Button onClick={() => void watch.current?.stillHere()}>{t("idle.stay")}</Button>}
        </>
      }
    >
      <p aria-live="polite" style={{ fontSize: "2rem", fontVariantNumeric: "tabular-nums", textAlign: "center", margin: "0.5rem 0" }}>{mmss(warn.secondsLeft)}</p>
    </Dialog>
  );
}
