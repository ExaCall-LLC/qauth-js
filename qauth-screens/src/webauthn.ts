/**
 * The browser's passkey prompts for options qAuth sends (base64url in
 * JSON), and their answers back as JSON (what the engine reads).
 */
type Json = Record<string, unknown>;

function buf(s: string): ArrayBuffer {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

function str(b: ArrayBuffer): string {
  const u = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The publicKey options with their binary fields decoded. */
export function decodeOptions(options: unknown): Json {
  const o = (options ?? {}) as Json;
  const pk = { ...((o.publicKey as Json) ?? o) } as Json;
  if (typeof pk.challenge === "string") pk.challenge = buf(pk.challenge);
  const user = pk.user as Json | undefined;
  if (user && typeof user.id === "string") pk.user = { ...user, id: buf(user.id) };
  for (const k of ["allowCredentials", "excludeCredentials"]) {
    const list = pk[k] as Json[] | undefined;
    if (Array.isArray(list)) pk[k] = list.map((c) => ({ ...c, id: typeof c.id === "string" ? buf(c.id) : c.id }));
  }
  return pk;
}

/** A browser credential as JSON. */
export function encodeCredential(c: PublicKeyCredential): Json {
  const r = c.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: str(r.clientDataJSON) };
  if ("attestationObject" in r && r.attestationObject) {
    response.attestationObject = str(r.attestationObject);
    if (typeof r.getTransports === "function") response.transports = r.getTransports();
  } else {
    response.authenticatorData = str(r.authenticatorData);
    response.signature = str(r.signature);
    if (r.userHandle) response.userHandle = str(r.userHandle);
  }
  return {
    id: c.id, rawId: str(c.rawId), type: c.type, response,
    clientExtensionResults: typeof c.getClientExtensionResults === "function" ? c.getClientExtensionResults() : {},
  };
}

export const passkeysAvailable = (): boolean => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** Makes a passkey with the options (the person's face, fingerprint or PIN). */
export async function createPasskey(options: unknown): Promise<Json> {
  const c = (await navigator.credentials.create({ publicKey: decodeOptions(options) as unknown as PublicKeyCredentialCreationOptions })) as PublicKeyCredential | null;
  if (!c) throw new Error("no passkey");
  return encodeCredential(c);
}

/** Answers a passkey challenge. */
export async function answerPasskey(options: unknown): Promise<Json> {
  const c = (await navigator.credentials.get({ publicKey: decodeOptions(options) as unknown as PublicKeyCredentialRequestOptions })) as PublicKeyCredential | null;
  if (!c) throw new Error("no passkey");
  return encodeCredential(c);
}
