// permissions()/can()/orgs() and validateKey() caches, and the error type
// (retryAfter, network failures), against a fake qAuth fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QAuth, QAuthError, Verifier, parseRetryAfter } from "../dist/index.js";
import { fakeIssuer, ISSUER, CLIENT } from "./fake-issuer.mjs";

const BASE = "https://qauth.test";

/** A fake qAuth: per token -> org -> permissions; counts calls. */
function fakeQAuth() {
  const q = {
    calls: [],
    perms: {}, // token -> org -> { roles, permissions }
    keys: {}, // key -> answer
    status: null, // force an answer status (and headers)
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const h = new Headers(init?.headers);
      q.calls.push(url.pathname + url.search);
      const env = (data, status = 200, headers = {}) =>
        new Response(JSON.stringify(status < 400 ? { success: true, status, data } : { success: false, status, error: data, meta: { request_id: "req-1" } }), {
          status,
          headers: { "content-type": "application/json", ...headers },
        });
      if (q.status) return env({ code: q.status.code, message: "no" }, q.status.status, q.status.headers);
      if (url.pathname === "/v1/me/permissions") {
        const token = h.get("authorization")?.replace(/^Bearer /, "");
        const p = q.perms[token]?.[url.searchParams.get("org")];
        if (!p) return env({ code: "RESOURCE_NOT_FOUND", message: "Not found." }, 404);
        return env({ app: url.searchParams.get("app"), org: url.searchParams.get("org"), ...p });
      }
      if (url.pathname === "/v1/me/orgs") return env([{ id: "o1", name: "Shop", role: "admin" }]);
      if (url.pathname === "/auth/validate") {
        const a = q.keys[h.get("x-api-key")];
        return a ? env(a) : env({ code: "UNAUTHORIZED", message: "no" }, 401);
      }
      return env({ code: "RESOURCE_NOT_FOUND", message: "?" }, 404);
    },
  };
  return q;
}

const scope = { app: "notes-api", org: "o1" };

test("permissions and can: cached per person, app and org for the TTL", async () => {
  const q = fakeQAuth();
  q.perms.tok = { o1: { roles: ["editor"], permissions: ["notes:read", "notes:write"] } };
  let now = 1_000_000;
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch, now: () => now });
  assert.equal(await qa.can("tok", scope, "notes:read"), true);
  assert.equal(await qa.can("tok", scope, "notes:delete"), false);
  assert.deepEqual((await qa.permissions("tok", scope)).roles, ["editor"]);
  assert.equal(q.calls.length, 1, "one call for three questions");
  // another org or app is another entry
  q.perms.tok.o2 = { roles: [], permissions: [] };
  assert.equal(await qa.can("tok", { app: "notes-api", org: "o2" }, "notes:read"), false);
  await qa.permissions("tok", { app: "other-api", org: "o1" });
  assert.equal(q.calls.length, 3);
  // a role removed in qAuth takes effect after the TTL (default 60 s)
  q.perms.tok.o1 = { roles: [], permissions: [] };
  now += 59_000;
  assert.equal(await qa.can("tok", scope, "notes:read"), true);
  now += 2_000;
  assert.equal(await qa.can("tok", scope, "notes:read"), false);
});

test("permissionsCacheSeconds: 0 asks qAuth every time", async () => {
  const q = fakeQAuth();
  q.perms.tok = { o1: { roles: [], permissions: ["notes:read"] } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch, permissionsCacheSeconds: 0 });
  await qa.can("tok", scope, "notes:read");
  await qa.can("tok", scope, "notes:read");
  assert.equal(q.calls.length, 2);
});

test("concurrent questions share one call (even with the cache off)", async () => {
  const q = fakeQAuth();
  q.perms.tok = { o1: { roles: [], permissions: ["notes:read"] } };
  let release;
  const gate = new Promise((ok) => (release = ok));
  const held = async (input, init) => {
    await gate;
    return q.fetch(input, init);
  };
  const qa = new QAuth({ baseUrl: BASE, fetch: held, permissionsCacheSeconds: 0 });
  const all = Promise.all([qa.can("tok", scope, "notes:read"), qa.can("tok", scope, "notes:read"), qa.permissions("tok", scope)]);
  await new Promise((ok) => setTimeout(ok, 50)); // every question is waiting on the same call
  release();
  const [a, b, p] = await all;
  assert.deepEqual([a, b, p.permissions], [true, true, ["notes:read"]]);
  assert.equal(q.calls.length, 1);
});

test("can: not a member (403/404) is false and not cached; 401 throws", async () => {
  const q = fakeQAuth();
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  assert.equal(await qa.can("tok", scope, "notes:read"), false);
  q.perms.tok = { o1: { roles: [], permissions: ["notes:read"] } };
  assert.equal(await qa.can("tok", scope, "notes:read"), true, "a refusal is never cached");
  q.status = { status: 401, code: "UNAUTHORIZED" };
  await assert.rejects(qa.can("other", scope, "notes:read"), (e) => e instanceof QAuthError && e.status === 401);
});

test("with a verifier: keyed on the verified person, so a new token of theirs hits the cache", async () => {
  const iss = await fakeIssuer();
  const verifier = new Verifier({ issuers: ISSUER, clientIds: [CLIENT], fetch: iss.fetch });
  const q = fakeQAuth();
  const t1 = await iss.sign({ sub: "u1", jti: "a" });
  const t2 = await iss.sign({ sub: "u1", jti: "b" });
  q.perms[t1] = { o1: { roles: [], permissions: ["notes:read"] } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch, verifier });
  assert.equal(await qa.can(t1, scope, "notes:read"), true);
  assert.equal(await qa.can(t2, scope, "notes:read"), true);
  assert.equal(q.calls.length, 1);
  // an Identity works the same
  assert.equal(await qa.can(await verifier.verify(t2), scope, "notes:read"), true);
  assert.equal(q.calls.length, 1);
  // a forged token (unverifiable) never reaches the cache of the person it names
  const forged = t1.split(".").slice(0, 2).join(".") + ".AAAA";
  await assert.rejects(qa.can(forged, scope, "notes:read"), (e) => e instanceof QAuthError && e.status === 401);
  // forget drops the person's answers
  await qa.forget({ issuer: ISSUER, subject: "u1" });
  await qa.can(t1, scope, "notes:read");
  assert.equal(q.calls.length, 2);
});

test("without a verifier: a raw token is cached per token, never per its unverified sub", async () => {
  const iss = await fakeIssuer();
  const q = fakeQAuth();
  const real = await iss.sign({ sub: "victim", jti: "a" });
  q.perms[real] = { o1: { roles: [], permissions: ["notes:admin"] } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  assert.equal(await qa.can(real, scope, "notes:admin"), true);
  // same sub, different (forged) token: asks qAuth, which refuses
  const other = (await fakeIssuer()).sign({ sub: "victim", jti: "z" });
  assert.equal(await qa.can(await other, scope, "notes:admin"), false);
  assert.equal(q.calls.length, 2);
  await qa.forget(real);
  await qa.can(real, scope, "notes:admin");
  assert.equal(q.calls.length, 3);
});

test("orgs: cached like permissions", async () => {
  const q = fakeQAuth();
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  assert.equal((await qa.orgs("tok"))[0].id, "o1");
  await qa.orgs("tok");
  assert.equal(q.calls.length, 1);
});

test("validateKey: live by default (no cache)", async () => {
  const q = fakeQAuth();
  q.keys["qak_1"] = { valid: true, key: { id: "k", permissions: { api: ["r"] } } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  assert.equal((await qa.validateKey("qak_1")).valid, true);
  delete q.keys["qak_1"]; // revoked
  assert.equal((await qa.validateKey("qak_1")).valid, false);
  assert.equal(q.calls.length, 2);
  assert.equal((await qa.validateKey("")).valid, false);
  assert.equal(q.calls.length, 2, "an empty key is not sent");
});

test("validateKey with keyCacheSeconds: kept per key and app, then asked again", async () => {
  const q = fakeQAuth();
  q.keys["qak_1"] = { valid: true, key: { id: "k" } };
  let now = 5_000_000;
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch, keyCacheSeconds: 30, now: () => now });
  assert.equal((await qa.validateKey("qak_1", { app: "a" })).valid, true);
  delete q.keys["qak_1"];
  assert.equal((await qa.validateKey("qak_1", { app: "a" })).valid, true, "cached");
  assert.equal((await qa.validateKey("qak_1", { app: "b" })).valid, false, "another app is another entry");
  assert.equal((await qa.validateKey("qak_x", { app: "a" })).valid, false);
  assert.equal(q.calls.length, 3);
  now += 31_000;
  assert.equal((await qa.validateKey("qak_1", { app: "a" })).valid, false, "expired from the cache");
  // forgetKeys drops everything at once
  q.keys["qak_2"] = { valid: true, key: { id: "k2" } };
  await qa.validateKey("qak_2");
  delete q.keys["qak_2"];
  qa.forgetKeys();
  assert.equal((await qa.validateKey("qak_2")).valid, false);
});

test("validateKey: a qAuth failure is thrown and never cached", async () => {
  const q = fakeQAuth();
  q.keys["qak_1"] = { valid: true, key: { id: "k" } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch, keyCacheSeconds: 30 });
  q.status = { status: 503, code: "UNAVAILABLE", headers: { "retry-after": "5" } };
  await assert.rejects(qa.validateKey("qak_1"), (e) => e instanceof QAuthError && e.status === 503 && e.retryAfter === 5);
  q.status = null;
  assert.equal((await qa.validateKey("qak_1")).valid, true);
});

test("errors: 429 carries retryAfter and the request id", async () => {
  const q = fakeQAuth();
  q.status = { status: 429, code: "RATE_LIMITED", headers: { "retry-after": "12" } };
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  await assert.rejects(qa.as("tok").profile(), (e) => {
    assert.ok(e instanceof QAuthError);
    assert.equal(e.status, 429);
    assert.equal(e.code, "RATE_LIMITED");
    assert.equal(e.retryAfter, 12);
    assert.equal(e.requestId, "req-1");
    return true;
  });
});

test("errors: qAuth out of reach is a QAuthError (status 0, UNAVAILABLE) with the cause", async () => {
  const qa = new QAuth({ baseUrl: BASE, fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(qa.as("tok").profile(), (e) => e instanceof QAuthError && e.status === 0 && e.code === "UNAVAILABLE" && e.cause instanceof TypeError);
  const slow = new QAuth({ baseUrl: BASE, timeoutMs: 20, fetch: (_u, init) => new Promise((_ok, no) => init.signal.addEventListener("abort", () => no(init.signal.reason))) });
  // AbortSignal.timeout's timer doesn't keep Node alive (a server does in real apps); hold the loop open here
  const keep = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(slow.as("tok").profile(), (e) => e instanceof QAuthError && e.code === "UNAVAILABLE" && /in time/.test(e.message));
  } finally {
    clearTimeout(keep);
  }
});

test("QAuthError: the old constructor still works; Retry-After both forms", () => {
  const e = new QAuthError(403, "FORBIDDEN", "no", "r1", { email: ["bad"] });
  assert.equal(e.status, 403);
  assert.equal(e.requestId, "r1");
  assert.deepEqual(e.fields, { email: ["bad"] });
  assert.equal(e.retryAfter, undefined);
  assert.equal(e.name, "QAuthError");
  assert.ok(e instanceof Error);
  assert.equal(parseRetryAfter("30"), 30);
  assert.equal(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString()) >= 9, true);
  assert.equal(parseRetryAfter("soon"), undefined);
  assert.equal(parseRetryAfter(null), undefined);
});

test("a redirect from qAuth is never followed: UNEXPECTED_REDIRECT, the API key stays here", async () => {
  const seen = [];
  const qa = new QAuth({ baseUrl: BASE, fetch: async (u, init) => {
    seen.push(init.redirect);
    return new Response(null, { status: 307, headers: { location: "https://evil.test/auth/validate" } });
  } });
  await assert.rejects(qa.validateKey("qak_secret"), (e) => e instanceof QAuthError && e.code === "UNEXPECTED_REDIRECT" && e.status === 307);
  await assert.rejects(qa.as("tok").profile(), (e) => e instanceof QAuthError && e.code === "UNEXPECTED_REDIRECT");
  assert.deepEqual(seen, ["manual", "manual"]);
});

test("empty, '.' and '..' ids are refused before anything is sent", async () => {
  const q = fakeQAuth();
  const qa = new QAuth({ baseUrl: BASE, fetch: q.fetch });
  const me = qa.as("tok");
  for (const id of ["", ".", ".."]) {
    await assert.rejects(me.org(id).get(), (e) => e instanceof QAuthError && e.status === 400 && e.code === "VALIDATION_ERROR", JSON.stringify(id));
    await assert.rejects(me.org("o1").members.remove(id), (e) => e instanceof QAuthError && e.code === "VALIDATION_ERROR");
  }
  assert.equal(q.calls.length, 0);
  // a dot inside an id is fine
  await me.org("a.b").get().catch(() => {});
  assert.equal(q.calls.length, 1);
});
