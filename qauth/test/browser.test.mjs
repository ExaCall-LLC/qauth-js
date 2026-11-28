// EXA-640: the person's browser (X-QAuth-Client-UA / -IP) from the app's
// server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QAuth, browserHeaders } from "../dist/index.js";

function recorder() {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ path: new URL(url).pathname, headers: init.headers });
    return new Response(JSON.stringify({ success: true, status: 200, data: { ceremony: "c1", rpId: "id.a.test", options: {} } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { seen, fetch };
}

test("as(token, browser) sends the browser's details; as(token) sends none", async () => {
  const { seen, fetch } = recorder();
  const q = new QAuth({ baseUrl: "https://auth.test", fetch });
  await q.as("tok", { userAgent: "Mozilla/5.0\r\nX-Evil: 1", ip: "203.0.113.7" }).account.passkeys.begin({ origin: "https://app.test" });
  const h = seen[0].headers;
  assert.equal(h["x-qauth-session"], undefined);
  assert.equal(h["x-qauth-client-ua"], "Mozilla/5.0X-Evil: 1");
  assert.equal(h["x-qauth-client-ip"], "203.0.113.7");
  assert.equal(h.authorization, "Bearer tok");
  await q.as("tok").account.passkeys.begin({ origin: "https://app.test" });
  assert.equal(seen[1].headers["x-qauth-client-ua"], undefined);
  assert.equal(seen[1].headers["x-qauth-client-ip"], undefined);
});

test("browserHeaders never overrides authorization and drops empty values", () => {
  assert.deepEqual(browserHeaders({ userAgent: " ", ip: "" }), {});
  assert.equal(browserHeaders({ userAgent: "x".repeat(600) })["x-qauth-client-ua"].length, 512);
});
