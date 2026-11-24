/**
 * The proxy for qAuth's ready-made screens (@isdlc.ai/qauth-screens): mount
 * it on YOUR backend (e.g. at /qauth). The screens call it from the
 * browser; it forwards to qAuth with the signed-in person's access token
 * from your server session. Tokens never reach the browser, and people never
 * talk to qAuth directly.
 *
 *   // Next.js route handler app/qauth/[...path]/route.ts
 *   const proxy = qauthProxy({ baseUrl: process.env.QAUTH_URL!, mount: "/qauth",
 *     accessToken: async (req) => (await getSession(req))?.accessToken ?? null });
 *   export const GET = proxy, POST = proxy, PUT = proxy, DELETE = proxy;
 *
 * Rules: only qAuth's /v1/me/* and /v1/orgs/* paths, and starting,
 * resending and checking an action verification (never consuming one: that
 * is your backend's own call); no "..", no encoded
 * slashes or dots; a request that changes something must carry the header
 * "x-qauth-request: 1" (a cross-site form cannot add it: CSRF protection);
 * only JSON goes through, no cookies either way.
 */

export interface ProxyOptions {
  /** qAuth's address, e.g. https://auth.example.com */
  baseUrl: string;
  /** Where the proxy is mounted on your site, e.g. "/qauth". */
  mount: string;
  /** The signed-in person's access token from YOUR session (null = not signed in). */
  accessToken: (req: Request) => Promise<string | null> | string | null;
  fetch?: typeof fetch;
}

const allowed = /^\/v1\/(me|orgs)(\/[A-Za-z0-9._~-]+)*\/?$|^\/v1\/verifications(\/[A-Za-z0-9_-]+\/(resend|check))?\/?$/;

function json(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, status, message: code, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function qauthProxy(o: ProxyOptions): (req: Request) => Promise<Response> {
  const base = o.baseUrl.replace(/\/+$/, "");
  const mount = "/" + o.mount.replace(/^\/+|\/+$/g, "");
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  return async (req: Request) => {
    const url = new URL(req.url);
    const raw = url.pathname; // still percent-encoded
    if (!raw.startsWith(mount + "/")) return json(404, "RESOURCE_NOT_FOUND", "Not found.");
    const path = raw.slice(mount.length);
    if (/%2f|%5c|%2e|%00|\\|\/\.\.?(\/|$)|\/\//i.test(path) || !allowed.test(path)) {
      return json(404, "RESOURCE_NOT_FOUND", "Not found.");
    }
    const method = req.method.toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return json(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    if (method !== "GET" && req.headers.get("x-qauth-request") !== "1") {
      return json(403, "FORBIDDEN", "Missing the x-qauth-request header.");
    }
    const token = await o.accessToken(req);
    if (!token) return json(401, "UNAUTHORIZED", "Please sign in.");
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (method !== "GET") {
      body = await req.text();
      if (body) headers["content-type"] = "application/json";
    }
    const res = await f(base + path + url.search, { method, headers, body, redirect: "manual" });
    const out = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    return new Response(await res.text(), { status: res.status, headers: out });
  };
}
