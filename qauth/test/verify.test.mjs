// Offline access-token verification against a fake issuer (generated keys,
// discovery and JWKS through a fake fetch). No network, no qAuth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, UnsecuredJWT } from "jose";
import { Verifier, QAuthError, TokenErrorCode } from "../dist/index.js";
import { fakeIssuer, ISSUER, CLIENT } from "./fake-issuer.mjs";

const refused = (code, status = 401) => (e) => {
  assert.ok(e instanceof QAuthError, `expected QAuthError, got ${e}`);
  assert.equal(e.code, code);
  assert.equal(e.status, status);
  return true;
};

const setup = async (opts = {}, issuerOpts = {}) => {
  const iss = await fakeIssuer(issuerOpts);
  const v = new Verifier({ issuers: [iss.issuer], clientIds: [CLIENT], fetch: iss.fetch, ...opts });
  return { iss, v };
};

test("accepts a token of an accepted issuer and client: the Identity", async () => {
  const { iss, v } = await setup();
  const t = await iss.sign({ sub: "user-7" });
  const id = await v.verify(t);
  assert.equal(id.subject, "user-7");
  assert.equal(id.clientId, CLIENT);
  assert.equal(id.issuer, ISSUER);
  assert.equal(id.sessionId, undefined); // access tokens carry no sid
  assert.ok(id.expiresAt instanceof Date && id.expiresAt.getTime() > Date.now());
  assert.equal(id.claims.jti, "j1");
  assert.equal(id.token, t);
  assert.equal(iss.calls.discovery, 1);
  assert.equal(iss.calls.jwks, 1);
  // discovery and keys are cached
  await v.verify(await iss.sign());
  assert.equal(iss.calls.discovery, 1);
  assert.equal(iss.calls.jwks, 1);
});

test("ES256 and EdDSA keys work too", async () => {
  const { iss, v } = await setup();
  await iss.addKey("ec", "ES256");
  await iss.addKey("ed", "EdDSA");
  assert.equal((await v.verify(await iss.sign({}, { kid: "ec" }))).subject, "user-1");
  assert.equal((await v.verify(await iss.sign({}, { kid: "ed" }))).subject, "user-1");
});

test("client: client_id only (azp is never a fallback); several accepted", async () => {
  const { iss, v } = await setup();
  await assert.rejects(v.verify(await iss.sign({ client_id: "other-app" })), refused(TokenErrorCode.WrongClient));
  await assert.rejects(v.verify(await iss.sign({ client_id: undefined })), refused(TokenErrorCode.WrongClient));
  await assert.rejects(v.verify(await iss.sign({ client_id: "" })), refused(TokenErrorCode.WrongClient));
  await assert.rejects(v.verify(await iss.sign({ client_id: 42 })), refused(TokenErrorCode.WrongClient));
  // azp alone, or next to client_id: an ID-token claim, refused
  await assert.rejects(v.verify(await iss.sign({ client_id: undefined, azp: CLIENT })), refused(TokenErrorCode.NotAccessToken));
  await assert.rejects(v.verify(await iss.sign({ azp: CLIENT })), refused(TokenErrorCode.NotAccessToken));
  const two = new Verifier({ issuers: ISSUER, clientIds: [CLIENT, "client-mobile"], fetch: iss.fetch });
  assert.equal((await two.verify(await iss.sign({ client_id: "client-mobile" }))).clientId, "client-mobile");
});

// Shapes of real staging tokens (claim names exactly as qAuth issues them).
const now = () => Math.floor(Date.now() / 1000);
const realAccessToken = () => ({
  aud: ["311111111111111111", "322222222222222222"],
  client_id: CLIENT,
  exp: now() + 900,
  iat: now(),
  iss: ISSUER,
  jti: "V2_311111111111111111-at_322222222222222222",
  nbf: now(),
  sub: "333333333333333333",
});
const realIdToken = () => ({
  amr: ["pwd"],
  at_hash: "c2FtcGxlLWF0LWhhc2g",
  aud: [CLIENT, "311111111111111111"],
  auth_time: now() - 5,
  azp: CLIENT,
  client_id: CLIENT,
  email: "alice@shop.test",
  email_verified: true,
  exp: now() + 43200,
  family_name: "Doe",
  given_name: "Alice",
  iat: now(),
  iss: ISSUER,
  locale: "en",
  name: "Alice Doe",
  preferred_username: "alice@shop.test",
  sid: "V1_344444444444444444",
  sub: "333333333333333333",
  updated_at: now() - 86400,
});

test("the real access-token shape (typ JWT) is accepted", async () => {
  const { iss, v } = await setup();
  const id = await v.verify(await iss.sign(realAccessToken(), { typ: "JWT" }));
  assert.equal(id.subject, "333333333333333333");
  assert.equal(id.clientId, CLIENT);
  assert.equal(id.sessionId, undefined);
});

test("the real ID-token shape is refused: NOT_ACCESS_TOKEN (same keys, same client_id, typ JWT)", async () => {
  const { iss, v } = await setup();
  await assert.rejects(v.verify(await iss.sign(realIdToken(), { typ: "JWT" })), refused(TokenErrorCode.NotAccessToken));
  // each ID-token claim alone is enough
  for (const c of ["azp", "at_hash", "nonce", "auth_time", "sid", "amr"]) {
    const extra = { azp: CLIENT, at_hash: "x", nonce: "n", auth_time: now(), sid: "V1_1", amr: ["pwd"] }[c];
    await assert.rejects(v.verify(await iss.sign({ ...realAccessToken(), [c]: extra })), refused(TokenErrorCode.NotAccessToken), c);
  }
});

test("header typ: absent, JWT or at+jwt only", async () => {
  const { iss, v } = await setup();
  for (const typ of [undefined, "JWT", "at+jwt", "at+JWT", "application/at+jwt"]) {
    assert.equal((await v.verify(await iss.sign(realAccessToken(), { typ }))).clientId, CLIENT, String(typ));
  }
  for (const typ of ["id+jwt", "logout+jwt", "JOSE", ""]) {
    await assert.rejects(v.verify(await iss.sign(realAccessToken(), { typ })), refused(TokenErrorCode.NotAccessToken), typ);
  }
});

test("sub must be a non-empty string", async () => {
  const { iss, v } = await setup();
  await assert.rejects(v.verify(await iss.sign({ sub: "" })), refused(TokenErrorCode.Malformed));
  await assert.rejects(v.verify(await iss.sign({ sub: 42 })), refused(TokenErrorCode.Malformed));
});

test("another issuer is refused without ever being contacted", async () => {
  const { iss, v } = await setup();
  const evil = await fakeIssuer({ issuer: "https://evil.test" });
  await assert.rejects(v.verify(await evil.sign()), refused(TokenErrorCode.WrongIssuer));
  // a near miss is not a match (exact iss)
  await assert.rejects(v.verify(await iss.sign({ iss: ISSUER + "/" })), refused(TokenErrorCode.WrongIssuer));
  assert.equal(iss.calls.discovery, 0);
  assert.deepEqual(iss.calls.other, []);
});

test("several issuers (tenants): each one's own keys", async () => {
  const a = await fakeIssuer({ issuer: "https://a.qapps.test" });
  const b = await fakeIssuer({ issuer: "https://b.qapps.test" });
  const both = (input, init) => (String(input).startsWith("https://a.") ? a.fetch(input, init) : b.fetch(input, init));
  const v = new Verifier({ issuers: [a.issuer, b.issuer], clientIds: [CLIENT], fetch: both });
  assert.equal((await v.verify(await a.sign({ sub: "ua" }))).issuer, a.issuer);
  assert.equal((await v.verify(await b.sign({ sub: "ub" }))).issuer, b.issuer);
  // b's key never verifies a token that claims to be from a
  const forged = await new SignJWT({ iss: a.issuer, sub: "x", client_id: CLIENT, exp: Math.floor(Date.now() / 1000) + 60 })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign((await generateKeyPair("RS256")).privateKey);
  await assert.rejects(v.verify(forged), refused(TokenErrorCode.BadSignature));
});

test("expired, not yet valid, and the clock leeway", async () => {
  const { iss, v } = await setup();
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(v.verify(await iss.sign({ exp: now - 120 })), refused(TokenErrorCode.Expired));
  await assert.rejects(v.verify(await iss.sign({ nbf: now + 600 })), refused(TokenErrorCode.NotYetValid));
  // within the default 60 s leeway
  assert.equal((await v.verify(await iss.sign({ exp: now - 30 }))).subject, "user-1");
  const strict = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch, clockToleranceSeconds: 0 });
  await assert.rejects(strict.verify(await iss.sign({ exp: now - 30 })), refused(TokenErrorCode.Expired));
});

test("audience, when required", async () => {
  const { iss, v } = await setup({ audience: "notes-api" });
  assert.equal((await v.verify(await iss.sign({ aud: ["notes-api", "other"] }))).subject, "user-1");
  await assert.rejects(v.verify(await iss.sign({ aud: "other" })), refused(TokenErrorCode.WrongAudience));
  await assert.rejects(v.verify(await iss.sign()), refused(TokenErrorCode.WrongAudience));
});

test("bad signatures: another key, unknown key id, alg none, HMAC", async () => {
  const { iss, v } = await setup();
  const other = (await generateKeyPair("RS256")).privateKey;
  await assert.rejects(v.verify(await iss.sign({}, { key: other })), refused(TokenErrorCode.BadSignature));
  await assert.rejects(v.verify(await iss.sign({}, { kid: "nope", key: other })), refused(TokenErrorCode.BadSignature));
  const none = new UnsecuredJWT({ client_id: CLIENT }).setIssuer(ISSUER).setSubject("u").setExpirationTime("5m").encode();
  await assert.rejects(v.verify(none), refused(TokenErrorCode.BadSignature));
  const hs = await new SignJWT({ client_id: CLIENT })
    .setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setSubject("u")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("x".repeat(32)));
  await assert.rejects(v.verify(hs), refused(TokenErrorCode.BadSignature));
});

test("only algorithms the issuer publishes", async () => {
  const { iss, v } = await setup({}, { algs: ["RS256"] });
  await iss.addKey("ec", "ES256");
  await assert.rejects(v.verify(await iss.sign({}, { kid: "ec" })), refused(TokenErrorCode.BadSignature));
  // and never an HMAC one even when discovery lists it
  const { iss: i2, v: v2 } = await setup({}, { algs: ["HS256"] });
  await assert.rejects(v2.verify(await i2.sign()), refused(TokenErrorCode.KeysUnavailable, 503));
});

test("malformed and missing tokens; claims sub and exp are required", async () => {
  const { iss, v } = await setup();
  await assert.rejects(v.verify(""), refused(TokenErrorCode.Missing));
  await assert.rejects(v.verify("not-a-jwt"), refused(TokenErrorCode.Malformed));
  await assert.rejects(v.verify("a.b.c"), refused(TokenErrorCode.Malformed));
  await assert.rejects(v.verify(await iss.sign({ sub: undefined })), refused(TokenErrorCode.Malformed));
  await assert.rejects(v.verify(await iss.sign({ exp: undefined })), refused(TokenErrorCode.Malformed));
});

test("key rotation: an unknown key id refetches the keys (at most once per cooldown)", async () => {
  const { iss, v } = await setup({ keysCooldownSeconds: 0 });
  await v.verify(await iss.sign());
  assert.equal(iss.calls.jwks, 1);
  await iss.addKey("k2", "RS256");
  iss.publish("k1", "k2");
  assert.equal((await v.verify(await iss.sign({}, { kid: "k2" }))).subject, "user-1");
  assert.equal(iss.calls.jwks, 2);
  // k1 retired: tokens signed with it are refused once the keys are refetched
  iss.publish("k2");
  await iss.addKey("k3", "RS256", { publish: false });
  await assert.rejects(v.verify(await iss.sign({}, { kid: "k3" })), refused(TokenErrorCode.BadSignature));
});

test("an unknown key id does not refetch the keys again within the cooldown", async () => {
  const { iss, v } = await setup(); // default 30 s cooldown
  await v.verify(await iss.sign());
  await iss.addKey("k2", "RS256", { publish: false });
  for (let i = 0; i < 5; i++) await assert.rejects(v.verify(await iss.sign({}, { kid: "k2" })), refused(TokenErrorCode.BadSignature));
  assert.equal(iss.calls.jwks, 1, "JWKS refetched within the cooldown");
});

test("the issuer out of reach: 503 KEYS_UNAVAILABLE; fast for a short backoff, then tried again", async () => {
  let t = Date.now();
  const { iss, v } = await setup({ now: () => new Date(t) });
  const token = await iss.sign();
  iss.setDown(true);
  await assert.rejects(v.verify(token), refused(TokenErrorCode.KeysUnavailable, 503));
  assert.equal(iss.calls.discovery, 0); // the fetch itself failed
  iss.setDown(false);
  // within the backoff (default 5 s): 503 at once, the issuer is not asked
  t += 4_000;
  const before = iss.calls.discovery;
  await assert.rejects(v.verify(token), refused(TokenErrorCode.KeysUnavailable, 503));
  assert.equal(iss.calls.discovery, before);
  t += 2_000;
  assert.equal((await v.verify(token)).subject, "user-1");
});

test("keys out of reach after discovery: 503, then fast within the backoff", async () => {
  let t = Date.now();
  const { iss, v } = await setup({ now: () => new Date(t) });
  let jwksDown = true;
  const f = iss.fetch;
  const v2 = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], now: () => new Date(t),
    fetch: async (u, init) => (jwksDown && String(u).endsWith("/keys") ? Promise.reject(new TypeError("down")) : f(u, init)) });
  const token = await iss.sign();
  await assert.rejects(v2.verify(token), refused(TokenErrorCode.KeysUnavailable, 503));
  const n = iss.calls.jwks;
  jwksDown = false;
  await assert.rejects(v2.verify(token), refused(TokenErrorCode.KeysUnavailable, 503));
  assert.equal(iss.calls.jwks, n, "no fetch within the backoff");
  t += 6_000;
  assert.equal((await v2.verify(token)).subject, "user-1");
  void v;
});

test("redirects are never followed (discovery, keys)", async () => {
  const iss = await fakeIssuer();
  const seen = [];
  const redirecting = async (u, init) => {
    seen.push(init?.redirect);
    if (String(u).endsWith("openid-configuration")) return new Response(null, { status: 302, headers: { location: "https://evil.test/x" } });
    return iss.fetch(u, init);
  };
  const v = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: redirecting });
  await assert.rejects(v.verify(await iss.sign()), refused(TokenErrorCode.KeysUnavailable, 503));
  assert.deepEqual(seen, ["manual"]);
  // the JWKS fetch is manual too
  const seen2 = [];
  const v2 = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: (u, init) => (seen2.push(init?.redirect), iss.fetch(u, init)) });
  await v2.verify(await iss.sign());
  assert.deepEqual(seen2, ["manual", "manual"]);
});

test("http:// issuers and keys addresses only on this machine", async () => {
  assert.throws(() => new Verifier({ issuers: "http://acme.qapps.test", clientIds: [CLIENT] }), /https/);
  assert.throws(() => new Verifier({ issuers: "not a url", clientIds: [CLIENT] }), /https/);
  for (const ok of ["http://localhost:8080", "http://127.0.0.1:9000", "https://acme.qapps.test"]) {
    new Verifier({ issuers: ok, clientIds: [CLIENT] });
  }
  // a discovery document pointing the keys at plain http is refused
  const iss = await fakeIssuer();
  const f = async (u, init) => {
    if (String(u).endsWith("openid-configuration")) return Response.json({ issuer: ISSUER, jwks_uri: "http://keys.example.test/jwks" });
    return iss.fetch(u, init);
  };
  const v = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: f });
  await assert.rejects(v.verify(await iss.sign()), refused(TokenErrorCode.KeysUnavailable, 503));
});

test("discovery that names another issuer is refused", async () => {
  const { iss, v } = await setup({}, { discoveryIssuer: "https://evil.test" });
  await assert.rejects(v.verify(await iss.sign()), refused(TokenErrorCode.KeysUnavailable, 503));
});

test("fixed keys (tests, pinned): no discovery", async () => {
  const iss = await fakeIssuer();
  const v = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], keys: iss.jwks(), fetch: () => assert.fail("no fetch") });
  assert.equal((await v.verify(await iss.sign())).subject, "user-1");
});

test("configuration mistakes fail at once", () => {
  assert.throws(() => new Verifier({ issuers: [], clientIds: [CLIENT] }));
  assert.throws(() => new Verifier({ issuers: ISSUER, clientIds: [] }));
  assert.throws(() => new Verifier({ issuers: ISSUER, clientIds: [CLIENT], algorithms: ["HS256"] }));
  assert.throws(() => new Verifier({ issuers: ISSUER, clientIds: [CLIENT], algorithms: ["none"] }));
});
