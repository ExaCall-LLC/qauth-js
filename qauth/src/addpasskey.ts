/**
 * Add a passkey from your app (browser only). Opens qAuth's "Add a passkey"
 * page on your app's sign-in host, in a frame over your page or in a
 * pop-up, and resolves with what happened there.
 *
 * Why qAuth's page and not your own: a passkey is made by the browser for
 * the site it is on, and qAuth checks the browser's answer (its challenge,
 * origin and the authenticator's attestation). If your app ran the ceremony
 * and passed the answer along, qAuth could not tell a forged answer from a
 * real one, so it doesn't take one: the ceremony runs only on qAuth's page,
 * and your app only hears the result.
 *
 * The app's "Let this app embed the add-a-passkey page" setting must be on
 * (Console › the app › Sign-in, or `embedPasskeyPage: true` in
 * qauth.app.yaml), and your page's origin must be the origin of one of the
 * client's redirect URIs.
 */

/** How the page opens: a frame over your page, a pop-up, or (auto) a frame where the browser allows passkeys in one and a pop-up elsewhere (Firefox). */
export type AddPasskeyMode = "auto" | "iframe" | "popup";

export interface AddPasskeyOptions {
  /** Your app's sign-in host, where its passkeys live: the address its sign-in page opens on (e.g. "sadeem.id.qapps.dev" or "https://sadeem.id.qapps.dev"). */
  signInHost?: string;
  /** Or the issuer URL: its host is used. Only right when the app signs in on the issuer's own host; otherwise pass signInHost. */
  issuer?: string;
  /** The app's OIDC client id. */
  clientId: string;
  mode?: AddPasskeyMode;
  /** Fills in the email on qAuth's page (the person still confirms it's them). */
  loginHint?: string;
  /** Give up after this long (default 10 minutes): resolves "error". */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** What happened on qAuth's page. `name` is the new passkey's display name (only for "added"). */
export interface AddPasskeyResult {
  result: "added" | "cancelled" | "error";
  name?: string;
}

const RESULTS = ["added", "cancelled", "error"];

/** The https origin of the sign-in host (the only origin results are taken from). */
export function signInOrigin(o: Pick<AddPasskeyOptions, "signInHost" | "issuer">): string {
  const raw = (o.signInHost || o.issuer || "").trim();
  if (!raw) throw new Error("addPasskey: signInHost (or issuer) is required");
  const u = new URL(raw.includes("://") ? raw : "https://" + raw);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("addPasskey: the sign-in host must be https");
  return u.origin;
}

/** The page's address for this app and this page's origin. */
export function addPasskeyUrl(o: AddPasskeyOptions, embeddingOrigin: string, popup: boolean): string {
  const u = new URL("/ui/passkeys/add", signInOrigin(o));
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("origin", embeddingOrigin);
  if (popup) u.searchParams.set("mode", "popup");
  if (o.loginHint) u.searchParams.set("login_hint", o.loginHint);
  return u.toString();
}

/** auto: a pop-up in browsers that refuse passkey creation in a cross-site frame (Firefox), else a frame. */
export function pickMode(mode: AddPasskeyMode | undefined, userAgent: string): "iframe" | "popup" {
  if (mode === "iframe" || mode === "popup") return mode;
  return /Firefox\//.test(userAgent) && !/Seamonkey\//.test(userAgent) ? "popup" : "iframe";
}

/**
 * Opens qAuth's "Add a passkey" page and resolves with its result. Only a
 * message from the sign-in host's origin, sent by the window this call
 * opened, counts. `win` is the browser window (tests pass their own).
 */
export function addPasskey(o: AddPasskeyOptions, win: Window = globalThis.window): Promise<AddPasskeyResult> {
  if (!win || !win.document) return Promise.reject(new Error("addPasskey runs in a browser"));
  if (!o.clientId) return Promise.reject(new Error("addPasskey: clientId is required"));
  let host: string;
  try {
    host = signInOrigin(o);
  } catch (e) {
    return Promise.reject(e);
  }
  const mode = pickMode(o.mode, win.navigator?.userAgent ?? "");
  const auto = (o.mode ?? "auto") === "auto";
  const url = addPasskeyUrl(o, win.location.origin, mode === "popup");
  const doc = win.document;
  return new Promise<AddPasskeyResult>((resolve) => {
    let frame: HTMLIFrameElement | undefined;
    let shade: HTMLElement | undefined;
    let popup: Window | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let settled = false;
    const finish = (r: AddPasskeyResult) => {
      if (settled) return;
      settled = true;
      win.removeEventListener("message", onMessage);
      win.removeEventListener("keydown", onKey);
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      o.signal?.removeEventListener("abort", onAbort);
      shade?.remove();
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          /* the page closes itself */
        }
      }
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const from = frame?.contentWindow ?? popup;
      if (e.origin !== host || !from || e.source !== from) return;
      const d = e.data as { type?: unknown; result?: unknown; name?: unknown } | null;
      if (!d || d.type !== "qauth.passkey" || typeof d.result !== "string" || !RESULTS.includes(d.result)) return;
      const out: AddPasskeyResult = { result: d.result as AddPasskeyResult["result"] };
      if (out.result === "added" && typeof d.name === "string") out.name = d.name.slice(0, 120);
      if (out.result === "error" && frame && auto) {
        // auto: the browser couldn't make the passkey in the frame; try a
        // pop-up once (a browser may block it: then "error")
        shade?.remove();
        shade = undefined;
        frame = undefined;
        win.removeEventListener("keydown", onKey);
        openPopup(addPasskeyUrl(o, win.location.origin, true));
        return;
      }
      finish(out);
    };
    const onAbort = () => finish({ result: "cancelled" });
    // the person can always close the frame (Esc, or a click beside it),
    // also when qAuth refused to show the page in it
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish({ result: "cancelled" });
    };
    const timer = setTimeout(() => finish({ result: "error" }), o.timeoutMs ?? 10 * 60_000);
    win.addEventListener("message", onMessage);
    if (o.signal) {
      if (o.signal.aborted) return onAbort();
      o.signal.addEventListener("abort", onAbort);
    }
    function openPopup(at: string) {
      popup = win.open(at, "qauth-add-passkey", "popup,width=480,height=680");
      if (!popup) return finish({ result: "error" }); // blocked: call it from a click
      poll = setInterval(() => {
        if (popup?.closed) finish({ result: "cancelled" });
      }, 500);
    }
    if (mode === "popup") return openPopup(url);
    shade = doc.createElement("div");
    shade.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px");
    frame = doc.createElement("iframe");
    frame.src = url;
    frame.title = "Add a passkey";
    // the page asks the person's existing passkey too, and makes the new one
    frame.setAttribute("allow", "publickey-credentials-create; publickey-credentials-get");
    frame.setAttribute("style", "width:440px;max-width:100%;height:620px;max-height:100%;border:0;border-radius:16px;background:#fff");
    shade.addEventListener("click", (e: Event) => {
      if (e.target === shade) finish({ result: "cancelled" });
    });
    win.addEventListener("keydown", onKey);
    shade.appendChild(frame);
    doc.body.appendChild(shade);
  });
}
