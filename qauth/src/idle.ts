/**
 * Idle sign-out for the app's own screen. qAuth ends a session after the
 * app's idle time (and at its maximum length), even when the app is closed;
 * this watcher is the screen's half: it reports that the person is active
 * (at most once a minute, shared by every tab of the session), warns before
 * the end, and says when the session is over.
 *
 * Instant sign-out: with `source.events` the watcher keeps qAuth's session
 * stream open (GET /v1/me/sessions/{sid}/events) and ends the moment qAuth
 * says the session ended, for any reason (signed out on another device, by
 * an admin, suspended, ...). It reconnects with backoff, and while the
 * stream is down it asks for the session's state every pollSeconds.
 *
 * Times are counted in seconds left, as qAuth answers them, so a wrong
 * device clock doesn't matter.
 */

/**
 * Why a session ended. `replaced`: signed out to make room for a new
 * sign-in at the app's session limit; `access_removed`: the person may no
 * longer use the app; `suspended`: their account was suspended.
 */
export type SessionEnd = "signed_out" | "idle" | "max_length" | "client_removed" | "access_removed" | "suspended" | "replaced";

export interface SessionState {
  sessionId: string;
  /** 0 = no idle limit. */
  idleMinutes: number;
  /** 0 = no maximum length. */
  maxMinutes: number;
  /** Seconds until the idle sign-out (-1 = never). */
  idleSecondsLeft: number;
  /** Seconds until the maximum length is reached (-1 = never). */
  maxSecondsLeft: number;
  /** Set when the session is over, with why. */
  ended?: SessionEnd;
  /** How often to ask when the session's stream can't stay open (the platform's setting). */
  pollSeconds?: number;
}

/** The answer of the session's stream: a fetch Response (its body is read as it comes). */
export interface StreamResponse {
  status: number;
  ok: boolean;
  body: ReadableStream<Uint8Array> | null;
  headers?: { get(name: string): string | null };
}

/** Where the watcher reads the session and reports activity. */
export interface IdleSource {
  state(): Promise<SessionState>;
  activity(): Promise<SessionState>;
  /**
   * Opens the session's stream (GET /v1/me/sessions/{sid}/events, with the
   * person's token in the Authorization header or through your proxy),
   * stopped by the signal. Leave it out to check by polling only.
   */
  events?(signal: AbortSignal): Promise<StreamResponse>;
}

export interface IdleWarning {
  /** idle: "stay signed in" keeps it; max_length: it can't be extended. */
  reason: "idle" | "max_length";
  secondsLeft: number;
}

export interface IdleWatchOptions {
  source: IdleSource;
  /** The session id (the ID token's `sid`); tabs of one session share activity. */
  sessionId: string;
  /** Warn this many seconds before the end. Default 60. */
  warnSeconds?: number;
  /** Called every second while the warning is due. */
  onWarn?: (w: IdleWarning) => void;
  /** Called when a warning is no longer due (the person is back). */
  onActive?: () => void;
  /** Called once when the session is over: sign the person out of your app. */
  onEnded: (reason: SessionEnd) => void;
  /** What counts as activity. Default: pointer, keys, scroll, touch. */
  events?: string[];
  /** Where to listen. Default: window. */
  target?: EventTarget;
  /**
   * While the stream is down (or without `source.events`), ask for the
   * session's state this often. Default: what qAuth's state answer says
   * (the platform's sessionPollSeconds), else 45.
   */
  pollSeconds?: number;
  /** The longest wait between stream reconnects (seconds). Default 60. */
  maxBackoffSeconds?: number;
  /** For tests. */
  now?: () => number;
  /** For tests (0..1). */
  random?: () => number;
}

export interface IdleWatch {
  /** "Stay signed in": reports activity now and clears an idle warning. */
  stillHere(): Promise<void>;
  /** Asks qAuth for the session's state now. */
  check(): Promise<void>;
  stop(): void;
}

const DEFAULT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"];

type Msg = { t: "active"; at: number } | { t: "state"; st: SessionState; at: number } | { t: "ended"; reason: SessionEnd };

export function watchIdle(o: IdleWatchOptions): IdleWatch {
  const now = o.now ?? (() => Date.now());
  const warnMs = (o.warnSeconds ?? 60) * 1000;
  const target: EventTarget | undefined = o.target ?? (typeof window !== "undefined" ? window : undefined);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`qauth-session:${o.sessionId}`) : null;
  let idleMs = 0; // the idle rule (0 = none)
  let idleAt = Infinity; // when the idle sign-out is due (local ms)
  let maxAt = Infinity;
  let lastReport = 0;
  let pending = false; // activity not yet reported
  let warned = false;
  let ended = false;
  let checking = false;
  let reporting: Promise<void> | null = null;
  // the stream and the polling while it is down
  const random = o.random ?? Math.random;
  const maxBackoff = (o.maxBackoffSeconds ?? 60) * 1000;
  let serverPoll = 0;
  const pollMs = () => (o.pollSeconds ?? 0) * 1000 || serverPoll || 45000;
  let lastCheck = now();
  let streamUp = false;
  let connecting = false;
  let nextConnect = 0;
  let failures = 0;
  let lastByte = 0;
  let deadMs = 75000; // three heartbeats of 25 s
  let abort: AbortController | null = null;

  const end = (reason: SessionEnd, tell = true) => {
    if (ended) return;
    ended = true;
    if (tell) channel?.postMessage({ t: "ended", reason } satisfies Msg);
    stop();
    o.onEnded(reason);
  };

  const apply = (st: SessionState, at = now()) => {
    if (st.pollSeconds && st.pollSeconds > 0) serverPoll = st.pollSeconds * 1000;
    if (st.ended) return end(st.ended);
    idleMs = st.idleMinutes * 60000;
    idleAt = st.idleSecondsLeft < 0 ? Infinity : at + st.idleSecondsLeft * 1000;
    maxAt = st.maxSecondsLeft < 0 ? Infinity : at + st.maxSecondsLeft * 1000;
  };

  // qAuth refuses the person's token once the session is over: that is the
  // end (why, from which deadline passed), not a network problem
  const refusedEnd = (e: unknown): boolean => {
    if ((e as { status?: number })?.status !== 401) return false;
    const t = now();
    end(t >= idleAt ? "idle" : t >= maxAt ? "max_length" : "signed_out");
    return true;
  };

  // report at most once a minute (or a quarter of a short idle time)
  const reportGap = () => Math.min(60000, idleMs > 0 ? idleMs / 4 : 60000);

  const report = (): Promise<void> => {
    if (reporting) return reporting;
    pending = false;
    lastReport = now();
    reporting = o.source
      .activity()
      .then((st) => {
        const at = now();
        apply(st, at);
        if (!ended) channel?.postMessage({ t: "state", st, at } satisfies Msg);
      })
      .catch((e) => {
        if (!refusedEnd(e)) pending = true; // try again on the next tick
      })
      .finally(() => {
        reporting = null;
      });
    return reporting;
  };

  const check = async (): Promise<void> => {
    if (checking || ended) return;
    checking = true;
    lastCheck = now();
    try {
      apply(await o.source.state());
    } catch (e) {
      refusedEnd(e); // otherwise offline: keep the local view; the next tick asks again
    } finally {
      checking = false;
    }
  };

  // the next try after a failure: doubling, with jitter (tabs don't all
  // come back at once), never past maxBackoff; a refusal for too many
  // streams waits at least a poll interval
  const retryLater = (atLeast = 0) => {
    failures++;
    const base = Math.min(maxBackoff, 1000 * 2 ** Math.min(failures - 1, 16));
    nextConnect = now() + Math.max(atLeast, Math.round(base * (0.8 + 0.4 * random())));
  };

  const onEvent = (name: string, data: string, ac: AbortController) => {
    let d: Record<string, unknown> = {};
    try {
      d = JSON.parse(data || "{}") as Record<string, unknown>;
    } catch {
      /* no data */
    }
    if (name === "ready") {
      failures = 0;
      if (typeof d.heartbeatSeconds === "number" && d.heartbeatSeconds > 0) deadMs = d.heartbeatSeconds * 3000;
      if (typeof d.pollSeconds === "number" && d.pollSeconds > 0) serverPoll = d.pollSeconds * 1000;
    } else if (name === "ended") {
      end(((d.reason as SessionEnd) || "signed_out") as SessionEnd);
      ac.abort();
    } else if (name === "reconnect") {
      nextConnect = now(); // at once: the stream had its time, or qAuth restarts
      ac.abort();
    }
  };

  const read = async (body: ReadableStream<Uint8Array>, ac: AbortController) => {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || ac.signal.aborted) return;
        lastByte = now();
        buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let name = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) name = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          onEvent(name, data.join("\n"), ac);
          if (ac.signal.aborted) return;
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  };

  const connect = async () => {
    const open = o.source.events?.bind(o.source);
    if (!open || ended || connecting) return;
    connecting = true;
    const ac = new AbortController();
    abort = ac;
    let res: StreamResponse;
    try {
      res = await open(ac.signal);
    } catch {
      connecting = false;
      abort = null;
      if (!ended) retryLater();
      return;
    }
    try {
      if (res.status === 401) {
        refusedEnd({ status: 401 });
        return;
      }
      if (!res.ok || !res.body) {
        // 429: too many streams; 503: not offered or restarting: poll meanwhile
        const ra = Number(res.headers?.get("retry-after") ?? "");
        retryLater(res.status === 429 ? Math.max(pollMs(), Number.isFinite(ra) ? ra * 1000 : 0) : 0);
        await res.body?.cancel().catch(() => undefined);
        return;
      }
      streamUp = true;
      lastByte = now();
      nextConnect = 0;
      await read(res.body, ac);
      if (!ended && !ac.signal.aborted) retryLater(); // closed under us
      else if (!ended && nextConnect === 0) retryLater(); // dead stream, aborted by the tick
    } catch {
      if (!ended && nextConnect === 0) retryLater();
    } finally {
      streamUp = false;
      connecting = false;
      if (abort === ac) abort = null;
    }
  };

  const tick = () => {
    if (ended) return;
    const t = now();
    if (streamUp) {
      if (t - lastByte > deadMs) abort?.abort(); // no heartbeat: reconnect
    } else {
      if (t - lastCheck >= pollMs()) void check();
      if (o.source.events && !connecting && t >= nextConnect) void connect();
    }
    if (pending && !warned && t - lastReport >= reportGap()) void report();
    const reason: IdleWarning["reason"] = maxAt <= idleAt ? "max_length" : "idle";
    const left = Math.min(idleAt, maxAt) - t;
    if (left <= 0) {
      void check(); // qAuth decides (another tab or device may have kept it)
    } else if (left <= warnMs) {
      warned = true;
      o.onWarn?.({ reason, secondsLeft: Math.ceil(left / 1000) });
    } else if (warned) {
      warned = false;
      o.onActive?.();
    }
  };

  const onActivity = () => {
    if (ended || warned) return; // during the warning only "stay signed in" counts
    const t = now();
    pending = true;
    if (idleMs > 0) idleAt = Math.max(idleAt, t + idleMs);
    channel?.postMessage({ t: "active", at: t } satisfies Msg);
  };

  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void check();
  };

  if (channel) {
    channel.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.t === "ended") return end(m.reason, false);
      if (m.t === "state") {
        apply(m.st, m.at);
        lastReport = m.at;
        pending = false;
      } else if (m.t === "active" && idleMs > 0) {
        idleAt = Math.max(idleAt, m.at + idleMs);
        pending = true;
      }
    };
  }

  const events = o.events ?? DEFAULT_EVENTS;
  for (const ev of events) target?.addEventListener(ev, onActivity, { passive: true } as AddEventListenerOptions);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(tick, 1000);
  void check();
  void connect();

  function stop() {
    clearInterval(timer);
    abort?.abort();
    for (const ev of events) target?.removeEventListener(ev, onActivity);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    channel?.close();
  }

  return {
    stillHere: async () => {
      if (ended) return;
      warned = false;
      pending = true;
      await report();
      if (!ended) o.onActive?.();
    },
    check,
    stop: () => {
      ended = true;
      stop();
    },
  };
}

/** The session id (`sid`) of an ID token, for watchIdle and the session calls. */
export function sessionIdOf(idToken: string): string {
  const part = idToken.split(".")[1];
  if (!part) return "";
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return (JSON.parse(json) as { sid?: string }).sid ?? "";
  } catch {
    return "";
  }
}
