/**
 * Device sign-in for TVs, set-top boxes and other screens without a
 * keyboard (RFC 8628 through qAuth): the device asks for a code, shows the
 * code and a QR of `verificationUriComplete`, and polls until the person
 * approves on a signed-in phone. Or the person makes a pairing code in My
 * account › Devices › Add a device and the device sends it with `pairDevice`.
 * The app's Device sign-in (or Pairing codes) setting must be on.
 */

export interface DeviceSignInOptions {
  /** The issuer (your tenant's sign-in address), e.g. https://auth.example.com */
  issuer: string;
  clientId: string;
  /** Default "openid offline_access" (a refresh token keeps the TV signed in). */
  scope?: string;
  /** What the person sees when approving ("Living room TV"): letters, digits and spaces, at most 40. */
  deviceName?: string;
  deviceType?: "tv" | "phone" | "computer" | "other";
  /** A screen many people use: signed out sooner when idle, counted as the app's kiosk type. */
  shared?: boolean;
  fetch?: typeof fetch;
}

export interface DeviceSignIn {
  deviceCode: string;
  /** Show it on the screen (e.g. BKRT-JMXL). */
  userCode: string;
  /** The approval address (the app's sign-in address /tv). */
  verificationUri: string;
  /** The same with the code filled in: show it as a QR. */
  verificationUriComplete: string;
  /** Seconds the code works (the app's TV code lifetime). */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
  /**
   * Number matching: show it big next to the code; the person picks it on
   * the phone (undefined when the app has number matching off).
   */
  matchNumber?: number;
}

export interface DeviceTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

async function form(f: typeof fetch, url: string, body: Record<string, string | undefined>): Promise<{ status: number; json: Record<string, unknown> }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) if (v !== undefined) params.set(k, v);
  const res = await f(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: params.toString(), redirect: "manual" });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

const base = (issuer: string) => issuer.replace(/\/+$/, "");

/** Asks for a code for this device. */
export async function startDeviceSignIn(o: DeviceSignInOptions): Promise<DeviceSignIn> {
  const f = o.fetch ?? fetch;
  const r = await form(f, `${base(o.issuer)}/oauth/v2/device_authorization`, {
    client_id: o.clientId,
    scope: o.scope ?? "openid offline_access",
    device_name: o.deviceName,
    device_type: o.deviceType,
    shared: o.shared ? "true" : undefined,
  });
  if (r.status !== 200) throw new Error(String(r.json.error_description ?? r.json.error ?? `HTTP ${r.status}`));
  return {
    deviceCode: String(r.json.device_code),
    userCode: String(r.json.user_code),
    verificationUri: String(r.json.verification_uri),
    verificationUriComplete: String(r.json.verification_uri_complete ?? r.json.verification_uri),
    expiresIn: Number(r.json.expires_in ?? 600),
    interval: Number(r.json.interval ?? 5),
    matchNumber: r.json.match_number === undefined ? undefined : Number(r.json.match_number),
  };
}

/**
 * Polls until the person approves (tokens), denies or the code expires
 * (throws with the OAuth error: access_denied, expired_token, invalid_grant).
 */
export async function pollDeviceToken(o: { issuer: string; clientId: string; deviceCode: string; interval?: number; signal?: AbortSignal; fetch?: typeof fetch }): Promise<DeviceTokens> {
  const f = o.fetch ?? fetch;
  let wait = (o.interval ?? 5) * 1000;
  for (;;) {
    if (o.signal?.aborted) throw new Error("aborted");
    const r = await form(f, `${base(o.issuer)}/oauth/v2/token`, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: o.deviceCode, client_id: o.clientId });
    if (r.status === 200) return r.json as unknown as DeviceTokens;
    const err = String(r.json.error ?? "");
    if (err === "slow_down") wait += 5000;
    else if (err !== "authorization_pending") throw Object.assign(new Error(String(r.json.error_description ?? err)), { code: err });
    await new Promise((res) => setTimeout(res, wait));
  }
}

/**
 * The device's "Enter a pairing code": signs the waiting device in as the
 * person who made the code (for this app only). Then poll for its tokens.
 * Wrong codes count per device: after the app's tries the error is slow_down.
 */
export async function pairDevice(o: { issuer: string; clientId: string; deviceCode: string; pairingCode: string; fetch?: typeof fetch }): Promise<{ paired: true }> {
  const f = o.fetch ?? fetch;
  const r = await form(f, `${base(o.issuer)}/oauth/v2/device_pair`, { client_id: o.clientId, device_code: o.deviceCode, pairing_code: o.pairingCode });
  if (r.status !== 200) throw Object.assign(new Error(String(r.json.error_description ?? r.json.error ?? `HTTP ${r.status}`)), { code: String(r.json.error ?? "") });
  return { paired: true };
}
