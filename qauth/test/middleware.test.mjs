// The Express/Connect middleware (on a plain node:http server, the shape
// Connect and Express use) and the framework-free authenticate(Request).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Verifier, errorResponse, identityOf, bearerToken, QAuthError } from "../dist/index.js";
import { fakeIssuer, ISSUER, CLIENT } from "./fake-issuer.mjs";

async function serve(mw) {
  const server = http.createServer((req, res) =>
    mw(req, res, (err) => {
      if (err) {
        res.statusCode = 500;
        return res.end("next(err)");
      }
      const id = identityOf(req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ subject: id?.subject ?? null }));
    }),
  );
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((ok) => server.close(ok)) };
}

test("middleware: a good token passes with the Identity on the request", async () => {
  const iss = await fakeIssuer();
  const v = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch });
  const s = await serve(v.middleware());
  try {
    const r = await fetch(s.base, { headers: { authorization: `Bearer ${await iss.sign({ sub: "user-5" })}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { subject: "user-5" });
    // the scheme is case-insensitive
    const r2 = await fetch(s.base, { headers: { authorization: `bearer ${await iss.sign()}` } });
    assert.equal(r2.status, 200);
  } finally {
    await s.close();
  }
});

test("middleware: no token is 401 with a bare Bearer challenge", async () => {
  const iss = await fakeIssuer();
  const s = await serve(new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch }).middleware());
  try {
    for (const h of [{}, { authorization: "Basic dXNlcjpwYXNz" }, { authorization: "Bearer" }]) {
      const r = await fetch(s.base, { headers: h });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="api"');
      const body = await r.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, "TOKEN_MISSING");
    }
  } finally {
    await s.close();
  }
});

test("middleware: every refusal is 401 invalid_token with its code", async () => {
  const iss = await fakeIssuer();
  const s = await serve(new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch }).middleware());
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ["garbage", "TOKEN_MALFORMED"],
    [await iss.sign({ exp: now - 600 }), "TOKEN_EXPIRED"],
    [await iss.sign({ client_id: "other-app" }), "WRONG_CLIENT"],
    [await (await fakeIssuer({ issuer: "https://evil.test" })).sign(), "WRONG_ISSUER"],
  ];
  try {
    for (const [token, code] of cases) {
      const r = await fetch(s.base, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 401, code);
      assert.equal(r.headers.get("www-authenticate"), `Bearer realm="api", error="invalid_token", error_description="${code}"`);
      const body = await r.json();
      assert.equal(body.error.code, code);
      assert.equal(body.error.message, "Please sign in.");
    }
  } finally {
    await s.close();
  }
});

test("middleware: the issuer out of reach is 503 (not a sign-in prompt)", async () => {
  const iss = await fakeIssuer();
  const s = await serve(new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch }).middleware());
  try {
    const token = await iss.sign();
    iss.setDown(true);
    const r = await fetch(s.base, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("www-authenticate"), null);
    assert.equal((await r.json()).error.code, "KEYS_UNAVAILABLE");
  } finally {
    await s.close();
  }
});

test("middleware optional: no token passes without an identity; a bad one is still refused", async () => {
  const iss = await fakeIssuer();
  const s = await serve(new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch }).middleware({ optional: true }));
  try {
    const r = await fetch(s.base);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { subject: null });
    assert.equal((await fetch(s.base, { headers: { authorization: "Bearer garbage" } })).status, 401);
  } finally {
    await s.close();
  }
});

test("authenticate(Request) for fetch-style handlers, and errorResponse", async () => {
  const iss = await fakeIssuer();
  const v = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch });
  // a Next.js route handler / Hono / worker
  const handler = async (req) => {
    try {
      const who = await v.authenticate(req);
      return Response.json({ subject: who.subject });
    } catch (e) {
      return errorResponse(e);
    }
  };
  const ok = await handler(new Request("https://app.test/notes", { headers: { authorization: `Bearer ${await iss.sign({ sub: "u9" })}` } }));
  assert.deepEqual(await ok.json(), { subject: "u9" });
  const no = await handler(new Request("https://app.test/notes"));
  assert.equal(no.status, 401);
  assert.equal(no.headers.get("www-authenticate"), 'Bearer realm="api"');
  const bad = await handler(new Request("https://app.test/notes", { headers: { authorization: `Bearer ${await iss.sign({ client_id: "x" })}` } }));
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get("www-authenticate"), /error="invalid_token"/);
  assert.equal((await bad.json()).error.code, "WRONG_CLIENT");
  // not ours: rethrown
  assert.throws(() => errorResponse(new Error("boom")), /boom/);
  assert.ok(errorResponse(new QAuthError(429, "RATE_LIMITED", "slow down", undefined, undefined, 7)).headers.get("retry-after") === "7");
});

test("bearerToken reads only a well-formed Bearer header", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer  abc "), "abc");
  assert.equal(bearerToken("Bearer a b"), undefined);
  assert.equal(bearerToken("Basic abc"), undefined);
  assert.equal(bearerToken(undefined), undefined);
});
