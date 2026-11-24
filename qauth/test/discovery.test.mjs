// new QAuth({ issuer, clientId, apiKey }): qAuth's API address from the
// issuer's discovery (qauth_api), a Verifier for that issuer + client, and
// the refusals (not https, redirects, another issuer, no qauth_api).
import { test } from "node:test";
import assert from "node:assert/strict";
import { QAuth, QAuthError } from "../dist/index.js";
import { fakeIssuer, ISSUER, CLIENT } from "./fake-issuer.mjs";

const API = "https://auth.qapps.test";
const TRUST = ["auth.qapps.test"];
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;

/** The fake issuer, its discovery with qauth_api (or `doc` overrides), and a fake qAuth API at `api`. */
async function world({ api = API, doc = {}, discovery } = {}) {
  const iss = await fakeIssuer();
  const w = { iss, calls: [], discoveryReads: 0, down: false };
  w.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.href === DISCOVERY) {
      w.discoveryReads++;
      assert.equal(init?.redirect, "manual", "discovery never follows a redirect");
      if (w.down) throw new TypeError("fetch failed");
      if (discovery) return discovery();
      const base = await (await iss.fetch(input, init)).json();
      return Response.json({ ...base, qauth_api: api, ...doc });
    }
    if (url.origin === new URL(api).origin) {
      const h = new Headers(init?.headers);
      w.calls.push(`${url.pathname} ${h.get("authorization") ?? ""}${h.get("x-api-key") ?? ""}`);
      return Response.json({ success: true, status: 200, data: { id: "o1", name: "Shop" } });
    }
    return iss.fetch(input, init);
  };
  return w;
}

test("issuer + clientId: the API address comes from discovery (read once), tokens are verified for that issuer and client", async () => {
  const w = await world();
  const qa = new QAuth({ issuer: ISSUER, clientId: CLIENT, apiKey: "qak_test", fetch: w.fetch, trustedApiHosts: TRUST });
  assert.equal(await qa.apiUrl(), API);
  const token = await w.iss.sign();
  const who = await qa.verify(token);
  assert.equal(who.subject, "user-1");
  assert.equal(who.issuer, ISSUER);
  await qa.as(token).profile();
  await qa.org("o1").get();
  await qa.withKey().org("o1").get();
  assert.deepEqual(w.calls, [`/v1/me Bearer ${token}`, "/v1/orgs/o1 qak_test", "/v1/orgs/o1 qak_test"]);
  // qAuth's API address was read once; the Verifier reads discovery for its keys on its own
  const before = w.discoveryReads;
  await qa.as(token).profile();
  assert.equal(w.discoveryReads, before, "discovery is not read again");
  // another client's token is refused
  await assert.rejects(qa.verify(await w.iss.sign({ client_id: "other" })), (e) => e instanceof QAuthError && e.status === 401);
  // the permissions cache is per person (the Verifier is wired by default)
  assert.ok(qa.verifier);
});

test("baseUrl still works as before (no discovery)", async () => {
  const w = await world();
  const qa = new QAuth({ baseUrl: API, fetch: w.fetch });
  await qa.withKey("qak_x").org("o1").get();
  assert.equal(w.discoveryReads, 0);
  assert.throws(() => qa.withKey(), /API key is required/);
  assert.throws(() => qa.verify("t"), /no token Verifier/);
});

test("refused: a qauth_api that is not https (localhost allowed), another issuer, no qauth_api, a redirect", async () => {
  for (const [opts, re] of [
    [{ api: "http://auth.qapps.test" }, /not an https/],
    [{ doc: { issuer: "https://evil.test" } }, /names another issuer/],
    [{ doc: { qauth_api: undefined } }, /names no qAuth API/],
    [{ discovery: () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }) }, /redirect/],
    [{ api: "https://auth.evil.test" }, /isn't a known qAuth address/],
  ]) {
    const w = await world(opts);
    const qa = new QAuth({ issuer: ISSUER, clientId: CLIENT, fetch: w.fetch, trustedApiHosts: TRUST });
    await assert.rejects(qa.as("tok").profile(), (e) => e instanceof QAuthError && re.test(e.message), JSON.stringify(opts));
    assert.equal(w.calls.length, 0, "nothing is sent to an address that was refused");
  }
  const local = await world({ api: "http://localhost:8080" });
  await assert.rejects(new QAuth({ issuer: ISSUER, clientId: CLIENT, fetch: local.fetch }).apiUrl(), /isn't a known qAuth address/);
  assert.equal(await new QAuth({ issuer: ISSUER, clientId: CLIENT, fetch: local.fetch, trustedApiHosts: ["localhost:8080"] }).apiUrl(), "http://localhost:8080");
  // qAuth's own address is trusted by default
  const prod = await world({ api: "https://auth.qapps.dev" });
  assert.equal(await new QAuth({ issuer: ISSUER, clientId: CLIENT, fetch: prod.fetch }).apiUrl(), "https://auth.qapps.dev");
  assert.throws(() => new QAuth({ issuer: "http://acme.qapps.test", clientId: CLIENT }), /https/);
  assert.throws(() => new QAuth({ issuer: ISSUER }), /clientId is required/);
  assert.throws(() => new QAuth({}), /issuer \(with clientId\) or baseUrl/);
});

test("a failed discovery read is tried again after the retry time, not kept forever", async () => {
  const w = await world();
  let now = 1_000_000;
  const qa = new QAuth({ issuer: ISSUER, clientId: CLIENT, fetch: w.fetch, now: () => now, trustedApiHosts: TRUST });
  w.down = true;
  await assert.rejects(qa.apiUrl(), (e) => e instanceof QAuthError && e.code === "UNAVAILABLE");
  w.down = false;
  await assert.rejects(qa.apiUrl(), "within the retry time the failure stands");
  now += 5_001;
  assert.equal(await qa.apiUrl(), API);
});
