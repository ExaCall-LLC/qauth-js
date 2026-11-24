// A fake token issuer for the tests: generated keys, a discovery document and
// a JWKS served through a fake fetch (counts every request). No network.
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export const ISSUER = "https://acme.qapps.test";
export const CLIENT = "client-web";

export async function fakeIssuer({ issuer = ISSUER, algs = ["RS256", "ES256", "EdDSA"], discoveryIssuer } = {}) {
  const keys = new Map(); // kid -> { alg, privateKey, jwk }
  const published = new Set();
  const calls = { discovery: 0, jwks: 0, other: [] };
  let down = false;

  async function addKey(kid, alg = "RS256", { publish = true } = {}) {
    const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
    keys.set(kid, { alg, privateKey, jwk });
    if (publish) published.add(kid);
    return kid;
  }
  await addKey("k1", "RS256");

  const fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (down) throw new TypeError("fetch failed");
    if (url.href === `${issuer}/.well-known/openid-configuration`) {
      calls.discovery++;
      return Response.json({
        issuer: discoveryIssuer ?? issuer,
        jwks_uri: `${issuer}/oauth/v2/keys`,
        id_token_signing_alg_values_supported: algs,
      });
    }
    if (url.href === `${issuer}/oauth/v2/keys`) {
      calls.jwks++;
      return Response.json({ keys: [...published].map((k) => keys.get(k).jwk) });
    }
    calls.other.push(url.href);
    return new Response("not found", { status: 404 });
  };

  /** Sign a token. claims override the defaults; o.kid picks the key; o.alg / o.key override the header / key. */
  async function sign(claims = {}, o = {}) {
    const kid = o.kid ?? "k1";
    const k = keys.get(kid);
    const now = Math.floor(Date.now() / 1000);
    const body = { iss: issuer, sub: "user-1", client_id: CLIENT, iat: now, exp: now + 900, jti: "j1", ...claims };
    for (const [n, v] of Object.entries(body)) if (v === undefined) delete body[n];
    const header = { alg: o.alg ?? k?.alg ?? "RS256", kid };
    const typ = "typ" in o ? o.typ : "JWT"; // qAuth's tokens carry typ JWT; o.typ undefined = no typ
    if (typ !== undefined) header.typ = typ;
    return new SignJWT(body).setProtectedHeader(header).sign(o.key ?? k.privateKey);
  }

  return {
    issuer,
    fetch,
    calls,
    sign,
    addKey,
    /** Publish only these key ids from now on. */
    publish: (...kids) => {
      published.clear();
      for (const k of kids) published.add(k);
    },
    jwks: () => ({ keys: [...published].map((k) => keys.get(k).jwk) }),
    setDown: (v) => {
      down = v;
    },
  };
}
