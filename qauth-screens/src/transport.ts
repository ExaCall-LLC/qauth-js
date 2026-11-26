/**
 * How the screens reach qAuth: through YOUR backend's proxy (qauthProxy
 * from @isdlc.ai/qauth, mounted e.g. at /qauth). Same-site requests with
 * your session cookie; every change carries "x-qauth-request: 1".
 */
export class ScreenError extends Error {
  readonly status: number;
  readonly code: string;
  /** What came with the refusal (e.g. the sessions to choose from at a SESSION_LIMIT). */
  readonly data?: unknown;
  constructor(status: number, code: string, message: string, data?: unknown) {
    super(message);
    this.name = "ScreenError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export interface Transport {
  get<T>(path: string): Promise<T>;
  send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T>;
  /**
   * A stream (the session's events, instant sign-out): the raw answer, read
   * as it comes; stopped by the signal. Optional: without it the screens
   * check by polling.
   */
  stream?(path: string, signal: AbortSignal): Promise<Response>;
}

export function createTransport(basePath = "/qauth", f: typeof fetch = (...a) => fetch(...a)): Transport {
  const base = basePath.replace(/\/+$/, "");
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (method !== "GET") headers["x-qauth-request"] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await f(base + path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
    let env: { success?: boolean; data?: unknown; error?: { code?: string; message?: string } } = {};
    try {
      env = await res.json();
    } catch {
      throw new ScreenError(res.status, "BAD_RESPONSE", `HTTP ${res.status}`);
    }
    if (!res.ok || env.success === false) {
      throw new ScreenError(res.status, env.error?.code ?? "ERROR", env.error?.message ?? `HTTP ${res.status}`, env.data ?? undefined);
    }
    return env.data as T;
  }
  return {
    get: (p) => call("GET", p),
    send: (m, p, b) => call(m, p, b),
    stream: (p, signal) => f(base + p, { method: "GET", headers: { accept: "text/event-stream" }, credentials: "same-origin", signal }),
  };
}
