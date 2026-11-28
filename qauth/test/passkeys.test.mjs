// createPasskey (browser) against a fake window and fetch: the order of
// the ceremony, the inline passkey step, and the pop-up's messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPasskey, PasskeyStepNeeded, PasskeyError, decodeOptions, encodeCredential } from "../dist/index.js";

const b64 = (s) => Buffer.from(s).toString("base64url");
const bytes = (s) => new Uint8Array(Buffer.from(s)).buffer;

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body || "{}");
    calls.push({ path, body, auth: init.headers.authorization, credentials: init.credentials });
    const r = routes[path].shift();
    return { ok: r.status < 400, status: r.status, json: async () => r.env };
  };
  return { f, calls };
}

function fakeWindow({ related = true, created, got } = {}) {
  const listeners = [];
  const win = {
    PublicKeyCredential: { getClientCapabilities: async () => ({ relatedOrigins: related }) },
    navigator: {
      credentials: {
        create: async ({ publicKey }) => {
          win.createdWith = publicKey;
          return created ?? { id: "c", rawId: bytes("c"), type: "public-key", response: { clientDataJSON: bytes("{}"), attestationObject: bytes("a") } };
        },
        get: async ({ publicKey }) => {
          win.gotWith = publicKey;
          return got ?? { id: "g", rawId: bytes("g"), type: "public-key", response: { clientDataJSON: bytes("{}"), authenticatorData: bytes("d"), signature: bytes("s") } };
        },
      },
    },
    addEventListener: (t, fn) => listeners.push(fn),
    removeEventListener: () => {},
    location: { origin: "https://sadeem.test" },
    open: () => {
      win.popup = { closed: false, location: {}, posted: [], close() { this.closed = true; }, postMessage(m, o) { this.posted.push([m, o]); } };
      return win.popup;
    },
    send: (ev) => listeners.forEach((fn) => fn(ev)),
  };
  return win;
}

const begin = { status: 200, env: { success: true, data: { ceremony: "cer1", rpId: "id.exacall.test", options: { publicKey: { challenge: b64("ch"), user: { id: b64("u") } } } } } };

test("on the app's page: begin, the browser's creation, finish", async () => {
  const { f, calls } = fakeFetch({
    "/v1/me/passkeys/begin": [begin],
    "/v1/me/passkeys/finish": [{ status: 201, env: { success: true, data: { id: "pk1", name: "Sadeem · Mac", rpId: "id.exacall.test" } } }],
  });
  const win = fakeWindow();
  const r = await createPasskey({ apiBase: "https://auth.test/", accessToken: "tok" }, win, f);
  assert.equal(r.result, "added");
  assert.equal(r.rpId, "id.exacall.test");
  assert.deepEqual(calls.map((c) => c.path), ["/v1/me/passkeys/begin", "/v1/me/passkeys/finish"]);
  assert.equal(calls[0].auth, "Bearer tok");
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].body.popup, false);
  assert.equal(calls[1].body.ceremony, "cer1");
  assert.equal(Buffer.from(win.createdWith.challenge).toString(), "ch");
  assert.ok(calls[1].body.credential.response.attestationObject);
});

test("STEP_NEEDED: confirmed with an existing passkey, then begun again", async () => {
  const step = { status: 403, env: { success: false, data: { ways: ["passkey", "code"] }, error: { code: "STEP_NEEDED", message: "Confirm it's you" } } };
  const { f, calls } = fakeFetch({
    "/v1/me/passkeys/begin": [step, begin],
    "/v1/me/passkeys/step": [{ status: 200, env: { data: { way: "passkey", step: "st1", options: { publicKey: { challenge: b64("g") } } } } }],
    "/v1/me/passkeys/step/verify": [{ status: 200, env: { data: { confirmed: true } } }],
    "/v1/me/passkeys/finish": [{ status: 201, env: { data: { id: "pk1", name: "n", rpId: "id.exacall.test" } } }],
  });
  const r = await createPasskey({ apiBase: "https://auth.test", accessToken: () => "tok" }, fakeWindow(), f);
  assert.equal(r.result, "added");
  assert.deepEqual(calls.map((c) => c.path), ["/v1/me/passkeys/begin", "/v1/me/passkeys/step", "/v1/me/passkeys/step/verify", "/v1/me/passkeys/begin", "/v1/me/passkeys/finish"]);
  assert.equal(calls[2].body.step, "st1");
  // without a passkey to confirm with (or step: "none"): the app is told the ways
  const { f: f2 } = fakeFetch({ "/v1/me/passkeys/begin": [{ ...step, env: { ...step.env, data: { ways: ["code", "email"] } } }] });
  await assert.rejects(createPasskey({ apiBase: "https://auth.test", accessToken: "t" }, fakeWindow(), f2), (e) => e instanceof PasskeyStepNeeded && e.ways.join() === "code,email");
});

test("a refusal keeps its code", async () => {
  const { f } = fakeFetch({ "/v1/me/passkeys/begin": [{ status: 403, env: { success: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "no" } } }] });
  await assert.rejects(createPasskey({ apiBase: "https://auth.test", accessToken: "t" }, fakeWindow(), f), (e) => e instanceof PasskeyError && e.code === "ORIGIN_NOT_ALLOWED");
});

test("without related origins (Firefox): qAuth's pop-up on the home, its message only", async () => {
  const { f, calls } = fakeFetch({
    "/v1/me/passkeys/begin": [{ status: 200, env: { data: { ceremony: "c", rpId: "id.exacall.test", popupUrl: "https://id.exacall.test/ui/passkeys/new" } } }],
  });
  const win = fakeWindow({ related: false });
  const p = createPasskey({ apiBase: "https://auth.test", accessToken: "t" }, win, f);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls[0].body.popup, true);
  assert.equal(win.popup.location.href, "https://id.exacall.test/ui/passkeys/new");
  // the ceremony goes by message, to the home only, and only when the pop-up asks
  win.send({ origin: "https://evil.test", source: win.popup, data: { type: "qauth.passkey.ready" } });
  assert.equal(win.popup.posted.length, 0);
  win.send({ origin: "https://id.exacall.test", source: win.popup, data: { type: "qauth.passkey.ready" } });
  assert.deepEqual(win.popup.posted, [[{ type: "qauth.passkey.ceremony", ceremony: "c" }, "https://id.exacall.test"]]);
  // another origin, or another window: ignored
  win.send({ origin: "https://evil.test", source: win.popup, data: { type: "qauth.passkey", result: "added" } });
  win.send({ origin: "https://id.exacall.test", source: {}, data: { type: "qauth.passkey", result: "added" } });
  win.send({ origin: "https://id.exacall.test", source: win.popup, data: { type: "qauth.passkey", result: "added", name: "Sadeem · Mac" } });
  const r = await p;
  assert.deepEqual(r, { result: "added", name: "Sadeem · Mac" });
});

test("options and credentials convert both ways", () => {
  const o = decodeOptions({ publicKey: { challenge: b64("x"), excludeCredentials: [{ id: b64("k") }] } });
  assert.equal(Buffer.from(o.challenge).toString(), "x");
  const c = encodeCredential({ id: "i", rawId: bytes("i"), type: "public-key", response: { clientDataJSON: bytes("{}"), attestationObject: bytes("a") } });
  assert.equal(c.response.clientDataJSON, b64("{}"));
});

test("pop-up mode never runs the passkey step on this page: the app asks a code", async () => {
  const step = { status: 403, env: { success: false, data: { ways: ["passkey", "email"] }, error: { code: "STEP_NEEDED", message: "Confirm" } } };
  const { f, calls } = fakeFetch({ "/v1/me/passkeys/begin": [step] });
  const win = fakeWindow({ related: false });
  await assert.rejects(createPasskey({ apiBase: "https://auth.test", accessToken: "t" }, win, f), (e) => e instanceof PasskeyStepNeeded);
  assert.deepEqual(calls.map((c) => c.path), ["/v1/me/passkeys/begin"]);
  assert.equal(win.popup.closed, true);
});
