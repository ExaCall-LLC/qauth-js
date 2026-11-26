import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@isdlc.ai/ui";
import { watchIdle, type IdleWarning as Warning, type IdleWatch, type SessionEnd, type SessionState } from "@isdlc.ai/qauth";
import { useScreens } from "./context.js";
import type { MessageKey } from "./i18n.js";

export interface IdleWarningProps {
  /** The session id: the `sid` claim of the person's ID token (sessionIdOf). */
  sessionId: string;
  /**
   * The session is over (idle, maximum length, signed out on another
   * device, by an admin, suspended...), told the moment it happens: sign
   * the person out of your app here (clear your session; keep the page).
   */
  onEnded: (reason: SessionEnd) => void;
  /** "Sign out" in the warning: sign the person out now. */
  onSignOut: () => void;
  /**
   * "Sign in again" after the session ended: send the person to your
   * sign-in. Given, the screen says why it ended and goes there by itself
   * after `returnAfterSeconds`; left out, no notice is shown (onEnded does it all).
   */
  onSignIn?: () => void;
  /** Seconds the notice stays before onSignIn is called. Default 3 (0 = wait for the button). */
  returnAfterSeconds?: number;
  /** Warn this many seconds before the end. Default 60. */
  warnSeconds?: number;
  /** Without the stream, check the session this often (seconds). Default: qAuth's setting, else 45. */
  pollSeconds?: number;
}

const REASONS: readonly string[] = ["signed_out", "idle", "max_length", "suspended", "access_removed", "client_removed", "replaced"];

/** The words for why a session ended (an unknown reason reads as signed out elsewhere). */
const endedKey = (r: string) => `ended.${REASONS.includes(r) ? r : "signed_out"}` as MessageKey;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Idle sign-out for your screens: counts the person's activity (across all
 * tabs of the session), reports it to qAuth, and shows a warning with a
 * countdown before the session ends — "Stay signed in" keeps it. Renders
 * nothing until then. qAuth ends the session on time even if the app is
 * closed; this only makes the end visible and avoidable.
 */
export function IdleWarning({ sessionId, onEnded, onSignOut, onSignIn, returnAfterSeconds = 3, warnSeconds = 60, pollSeconds }: IdleWarningProps) {
  const { t, api } = useScreens();
  const [warn, setWarn] = useState<Warning | null>(null);
  const [over, setOver] = useState<SessionEnd | null>(null);
  const watch = useRef<IdleWatch | null>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const signIn = useRef(onSignIn);
  signIn.current = onSignIn;

  useEffect(() => {
    if (!sessionId) return;
    const path = `/v1/me/sessions/${encodeURIComponent(sessionId)}`;
    const w = watchIdle({
      sessionId,
      warnSeconds,
      pollSeconds,
      source: {
        state: () => api.get<SessionState>(`${path}/state`),
        activity: () => api.send<SessionState>("POST", `${path}/activity`),
        // instant sign-out: qAuth's stream through your proxy (when the transport streams)
        events: api.stream ? (signal: AbortSignal) => api.stream!(`${path}/events`, signal) : undefined,
      },
      onWarn: setWarn,
      onActive: () => setWarn(null),
      onEnded: (r) => {
        setWarn(null);
        setOver(r);
        ended.current(r);
      },
    });
    watch.current = w;
    return () => w.stop();
  }, [api, sessionId, warnSeconds, pollSeconds]);

  useEffect(() => {
    if (!over || !signIn.current || returnAfterSeconds <= 0) return;
    const id = setTimeout(() => signIn.current?.(), returnAfterSeconds * 1000);
    return () => clearTimeout(id);
  }, [over, returnAfterSeconds]);

  if (over && onSignIn) {
    return (
      <Dialog
        open
        hideClose
        size="sm"
        onOpenChange={() => undefined}
        title={t("ended.title")}
        description={t(endedKey(over))}
        footer={<Button onClick={onSignIn}>{t("ended.signIn")}</Button>}
      />
    );
  }
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
