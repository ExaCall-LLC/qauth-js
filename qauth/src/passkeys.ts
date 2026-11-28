/**
 * Add a passkey on your app's own page (browser only, EXA-630).
 *
 * Your page runs the browser's passkey creation itself; qAuth gives a
 * begin/finish ceremony through its API, for the person signed in to your
 * app, with their access token from your app's client:
 *
 *   1. POST /v1/me/passkeys/begin  → creation options for the tenant's
 *      passkey home (one passkey for all of the tenant's apps), and a
 *      ceremony id (single use, 5 minutes)
 *   2. navigator.credentials.create on your page
 *   3. POST /v1/me/passkeys/finish → qAuth checks the ceremony, the type,
 *      the challenge and your page's origin, the engine the attestation.
 *
 * The person's sign-in must be fresh by your app's `passkeyAddFreshness`
 * (the whole session by default) and have used a second factor or a
 * passkey. Otherwise qAuth answers STEP_NEEDED: createPasskey confirms with
 * one of the person's passkeys itself when it can (`step: "auto"`), else it
 * throws a {@link PasskeyStepNeeded} with the ways; ask the code and call
 * `verifyPasskeyStep`, then `createPasskey` again. Never a full new sign-in.
 *
 * Browsers without Related Origin Requests (Firefox) can't use the
 * tenant's passkey home from your page: createPasskey then opens a small
 * qAuth pop-up on the home that runs the same ceremony (call it from a
 * click: browsers block pop-ups opened later).
 */

export interface CreatePasskeyOptions {
  /** qAuth's API address (the issuer's qauth_api), e.g. "https://auth.qapps.dev". */
  apiBase: string;
  /** The person's access token from your app's client (or a function that returns it). */
  accessToken: string | (() => string | Promise<string>);
  /** page: on your page; popup: qAuth's pop-up; auto (default): your page where the browser supports related origins, else the pop-up. */
  mode?: "auto" | "page" | "popup";
  /** STEP_NEEDED: auto (default) confirms with an existing passkey when the person has one; none: always throw PasskeyStepNeeded. */
  step?: "auto" | "none";
  /** The new passkey's name (default: the app, the device and the day). */
  name?: string;
  /** Give up on the pop-up after this long (default 5 minutes). */
  timeoutMs?: number;
}

export interface CreatedPasskey {
  result: "added" | "cancelled" | "error";
  id?: string;
  name?: string;
  rpId?: string;
}

/** The sign-in isn't fresh enough: confirm inline with one of `ways`, then try again. */
export class PasskeyStepNeeded extends Error {
  constructor(readonly ways: string[], message: string) {
    super(message);
    this.name = "PasskeyStepNeeded";
  }
}

/** A qAuth refusal (code: the API's error code, e.g. ORIGIN_NOT_ALLOWED). */
export class PasskeyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

type Win = Pick<Window, "open" | "addEventListener" | "removeEventListener" | "location"> & { navigator: Navigator; PublicKeyCredential?: unknown };

async function token(o: CreatePasskeyOptions): Promise<string> {
  return typeof o.accessToken === "function" ? await o.accessToken() : o.accessToken;
}

async function api<T>(o: CreatePasskeyOptions, path: string, body: unknown, f: typeof fetch): Promise<T> {
  const res = await f(o.apiBase.replace(/\/+$/, "") + path, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + (await token(o)) },
    body: JSON.stringify(body),
  });
  let env: { data?: unknown; message?: string; error?: { code?: string; message?: string } } = {};
  try {
    env = await res.json();
  } catch {
    throw new PasskeyError(res.status, "BAD_RESPONSE", `qAuth answered HTTP ${res.status}`);
  }
  if (!res.ok) {
    const code = env.error?.code ?? "ERROR";
    const msg = env.error?.message ?? env.message ?? `HTTP ${res.status}`;
    if (code === "STEP_NEEDED") throw new PasskeyStepNeeded(((env.data ?? {}) as { ways?: string[] }).ways ?? [], msg);
    throw new PasskeyError(res.status, code, msg);
  }
  return env.data as T;
}

const b64 = (b: ArrayBuffer): string => {
  const u = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const buf = (s: string): ArrayBuffer => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

/** WebAuthn JSON options → what navigator.credentials wants (base64url → bytes). */
export function decodeOptions(options: unknown): Record<string, unknown> {
  const o = JSON.parse(JSON.stringify(options)) as Record<string, any>;
  const pk = (o.publicKey ?? o) as Record<string, any>;
  pk.challenge = buf(pk.challenge);
  if (pk.user?.id) pk.user.id = buf(pk.user.id);
  for (const c of pk.allowCredentials ?? []) c.id = buf(c.id);
  for (const c of pk.excludeCredentials ?? []) c.id = buf(c.id);
  return pk;
}

/** A browser credential → JSON for qAuth (base64url fields). */
export function encodeCredential(c: any): Record<string, unknown> {
  const r = c.response;
  const out: Record<string, any> = { id: c.id, rawId: b64(c.rawId), type: c.type, response: { clientDataJSON: b64(r.clientDataJSON) } };
  if (r.attestationObject) {
    out.response.attestationObject = b64(r.attestationObject);
    if (r.getTransports) out.response.transports = r.getTransports();
  } else {
    out.response.authenticatorData = b64(r.authenticatorData);
    out.response.signature = b64(r.signature);
    if (r.userHandle) out.response.userHandle = b64(r.userHandle);
  }
  out.clientExtensionResults = c.getClientExtensionResults ? c.getClientExtensionResults() : {};
  return out;
}

/** Whether this browser can use a passkey home on another site from this page (Related Origin Requests). */
export async function relatedOriginsSupported(win: Win = globalThis.window as unknown as Win): Promise<boolean> {
  const P = win?.PublicKeyCredential as { getClientCapabilities?: () => Promise<Record<string, boolean>> } | undefined;
  if (!P?.getClientCapabilities) return false;
  try {
    return !!(await P.getClientCapabilities()).relatedOrigins;
  } catch {
    return false;
  }
}

/**
 * Confirm it's the person with one of their passkeys (the STEP_NEEDED
 * inline check), on this page.
 */
export async function confirmWithPasskey(o: CreatePasskeyOptions, win: Win = globalThis.window as unknown as Win, f: typeof fetch = fetch): Promise<void> {
  const s = await api<{ step: string; options: unknown }>(o, "/v1/me/passkeys/step", { way: "passkey" }, f);
  const c = await win.navigator.credentials.get({ publicKey: decodeOptions(s.options) as unknown as PublicKeyCredentialRequestOptions });
  await api(o, "/v1/me/passkeys/step/verify", { way: "passkey", step: s.step, answer: encodeCredential(c) }, f);
}

/** Start the inline check with a code (way: code | sms | email); answer it with verifyPasskeyStep. */
export function startPasskeyStep(o: CreatePasskeyOptions, way: "code" | "sms" | "email", f: typeof fetch = fetch): Promise<{ way: string; step?: string; sentTo?: string }> {
  return api(o, "/v1/me/passkeys/step", { way }, f);
}

/** Answer the inline check with the code (`step` from startPasskeyStep for sms and email). */
export function verifyPasskeyStep(o: CreatePasskeyOptions, a: { way: "code" | "sms" | "email"; code: string; step?: string }, f: typeof fetch = fetch): Promise<{ confirmed: boolean }> {
  return api(o, "/v1/me/passkeys/step/verify", a, f);
}

/** Add a passkey for the signed-in person, on this page (or qAuth's pop-up). */
export async function createPasskey(o: CreatePasskeyOptions, win: Win = globalThis.window as unknown as Win, f: typeof fetch = fetch): Promise<CreatedPasskey> {
  if (!win?.navigator?.credentials) throw new Error("createPasskey runs in a browser with passkeys");
  if (!o.apiBase) throw new Error("createPasskey: apiBase is required");
  const popup = o.mode === "popup" || (o.mode !== "page" && !(await relatedOriginsSupported(win)));
  // a pop-up must open during the click: open it now, point it later
  const w = popup ? win.open("about:blank", "qauth-passkey", "popup,width=480,height=640") : null;
  if (popup && !w) throw new PasskeyError(0, "POPUP_BLOCKED", "The browser blocked the pop-up. Call createPasskey from a click.");
  let begun: { ceremony: string; options?: unknown; rpId: string; popupUrl?: string };
  try {
    try {
      begun = await api(o, "/v1/me/passkeys/begin", { popup }, f);
    } catch (e) {
      // in pop-up mode this page can't use the home's passkeys (no related
      // origins): the app asks a code instead
      if (!(e instanceof PasskeyStepNeeded) || o.step === "none" || popup || !e.ways.includes("passkey")) throw e;
      await confirmWithPasskey(o, win, f);
      begun = await api(o, "/v1/me/passkeys/begin", { popup }, f);
    }
  } catch (e) {
    w?.close();
    throw e;
  }
  if (popup && w && begun.popupUrl) return waitForPopup(o, win, w, begun.popupUrl, begun.ceremony);
  let cred: unknown;
  try {
    cred = await win.navigator.credentials.create({ publicKey: decodeOptions(begun.options) as unknown as PublicKeyCredentialCreationOptions });
  } catch (e) {
    if ((e as { name?: string })?.name === "NotAllowedError") return { result: "cancelled" };
    throw e;
  }
  const done = await api<{ id: string; name: string; rpId: string }>(o, "/v1/me/passkeys/finish", { ceremony: begun.ceremony, credential: encodeCredential(cred), name: o.name }, f);
  return { result: "added", ...done };
}

/**
 * The pop-up: it asks for the ceremony ("ready"), which goes to the passkey
 * home's origin only, by message (never in its address); its result counts
 * only from the home's origin, sent by the window this call opened.
 */
function waitForPopup(o: CreatePasskeyOptions, win: Win, w: Window, popupUrl: string, ceremony: string): Promise<CreatedPasskey> {
  const home = new URL(popupUrl).origin;
  w.location.href = popupUrl;
  return new Promise((resolve) => {
    const done = (r: CreatedPasskey) => {
      win.removeEventListener("message", onMsg as EventListener);
      clearInterval(watch);
      clearTimeout(timer);
      resolve(r);
    };
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== home || ev.source !== w) return;
      const d = ev.data as { type?: string; result?: string; name?: string };
      if (d?.type === "qauth.passkey.ready") {
        w.postMessage({ type: "qauth.passkey.ceremony", ceremony }, home);
        return;
      }
      if (d?.type !== "qauth.passkey" || !["added", "cancelled", "error"].includes(String(d.result))) return;
      done({ result: d.result as CreatedPasskey["result"], name: d.name });
    };
    win.addEventListener("message", onMsg as EventListener);
    const watch = setInterval(() => {
      if (w.closed) done({ result: "cancelled" });
    }, 500);
    const timer = setTimeout(() => {
      w.close();
      done({ result: "error" });
    }, o.timeoutMs ?? 5 * 60 * 1000);
  });
}
