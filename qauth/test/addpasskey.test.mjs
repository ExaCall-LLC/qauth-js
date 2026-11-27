// addPasskey with a fake browser window: the page's address, the frame's
// permissions, and only the sign-in host's message from the opened window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addPasskey, addPasskeyUrl, signInOrigin } from "../dist/index.js";
import { pickMode } from "../dist/addpasskey.js";

function fakeWindow(ua = "Mozilla/5.0 Chrome/131") {
  const listeners = new Set();
  const frameWin = { name: "frame" };
  const body = { children: [], appendChild(el) { this.children.push(el); el.parent = this; } };
  const make = (tag) => ({
    tag, attrs: {}, children: [], src: "", title: "", handlers: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.handlers[t] = f; },
    appendChild(el) { this.children.push(el); },
    remove() { body.children = body.children.filter((c) => c !== this); },
    get contentWindow() { return tag === "iframe" ? frameWin : undefined; },
  });
  const opened = [];
  const win = {
    document: { body, createElement: make },
    location: { origin: "https://app.test" },
    navigator: { userAgent: ua },
    keys: new Set(),
    addEventListener(t, f) { if (t === "message") listeners.add(f); if (t === "keydown") this.keys.add(f); },
    removeEventListener(t, f) { listeners.delete(f); this.keys.delete(f); },
    open(url) { const p = { url, closed: false, close() { this.closed = true; } }; opened.push(p); return p; },
  };
  const send = (origin, source, data) => { for (const f of [...listeners]) f({ origin, source, data }); };
  return { win, body, frameWin, opened, send, listeners };
}

test("the page's address names the client and this page's origin", () => {
  assert.equal(signInOrigin({ signInHost: "Sadeem.id.qapps.dev" }), "https://sadeem.id.qapps.dev");
  assert.equal(signInOrigin({ issuer: "https://id.example.test/" }), "https://id.example.test");
  assert.throws(() => signInOrigin({ signInHost: "http://evil.test" }));
  const u = new URL(addPasskeyUrl({ signInHost: "login.test", clientId: "cid" }, "https://app.test", true));
  assert.equal(u.origin + u.pathname, "https://login.test/ui/passkeys/add");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("origin"), "https://app.test");
  assert.equal(u.searchParams.get("mode"), "popup");
});

test("auto picks a pop-up in Firefox, a frame elsewhere", () => {
  assert.equal(pickMode("auto", "Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/133.0"), "popup");
  assert.equal(pickMode(undefined, "Mozilla/5.0 Chrome/131 Safari/537"), "iframe");
  assert.equal(pickMode("iframe", "Firefox/133.0"), "iframe");
});

test("a frame with passkey permissions; only the sign-in host's message from it counts", async () => {
  const w = fakeWindow();
  const p = addPasskey({ signInHost: "login.test", clientId: "cid" }, w.win);
  const shade = w.body.children[0];
  const frame = shade.children[0];
  assert.equal(frame.attrs.allow, "publickey-credentials-create; publickey-credentials-get");
  assert.match(frame.src, /^https:\/\/login\.test\/ui\/passkeys\/add\?/);
  // another origin, another window, another shape: ignored
  w.send("https://evil.test", w.frameWin, { type: "qauth.passkey", result: "added", name: "x" });
  w.send("https://login.test", { other: true }, { type: "qauth.passkey", result: "added", name: "x" });
  w.send("https://login.test", w.frameWin, { type: "other", result: "added" });
  w.send("https://login.test", w.frameWin, { type: "qauth.passkey", result: "owned" });
  w.send("https://login.test", w.frameWin, { type: "qauth.passkey", result: "added", name: "Mac · 2026-11-27" });
  assert.deepEqual(await p, { result: "added", name: "Mac · 2026-11-27" });
  assert.equal(w.body.children.length, 0, "the frame is removed");
  assert.equal(w.listeners.size, 0);
});

test("a pop-up: its message, or closing it, ends the call", async () => {
  const w = fakeWindow("Firefox/133.0");
  const p = addPasskey({ signInHost: "login.test", clientId: "cid" }, w.win);
  assert.equal(w.opened.length, 1);
  assert.match(w.opened[0].url, /mode=popup/);
  w.send("https://login.test", w.frameWin, { type: "qauth.passkey", result: "added" }); // not the pop-up
  w.send("https://login.test", w.opened[0], { type: "qauth.passkey", result: "cancelled" });
  assert.deepEqual(await p, { result: "cancelled" });

  const w2 = fakeWindow();
  w2.win.open = () => null; // blocked
  assert.deepEqual(await addPasskey({ signInHost: "login.test", clientId: "cid", mode: "popup" }, w2.win), { result: "error" });
});

test("abort and timeout settle it", async () => {
  const w = fakeWindow();
  const ac = new AbortController();
  const p = addPasskey({ signInHost: "login.test", clientId: "cid", signal: ac.signal }, w.win);
  ac.abort();
  assert.deepEqual(await p, { result: "cancelled" });
  const w2 = fakeWindow();
  assert.deepEqual(await addPasskey({ signInHost: "login.test", clientId: "cid", timeoutMs: 5 }, w2.win), { result: "error" });
});

test("Esc or a click beside the frame closes it (also when qAuth refused to show the page)", async () => {
  const w = fakeWindow();
  const p = addPasskey({ signInHost: "login.test", clientId: "cid" }, w.win);
  const shade = w.body.children[0];
  shade.handlers.click({ target: shade.children[0] }); // a click on the frame itself: nothing
  for (const f of w.win.keys) f({ key: "Enter" });
  shade.handlers.click({ target: shade });
  assert.deepEqual(await p, { result: "cancelled" });
  assert.equal(w.win.keys.size, 0);

  const w2 = fakeWindow();
  const p2 = addPasskey({ signInHost: "login.test", clientId: "cid" }, w2.win);
  for (const f of [...w2.win.keys]) f({ key: "Escape" });
  assert.deepEqual(await p2, { result: "cancelled" });
});

test("auto: an error from the frame opens a pop-up once; iframe mode doesn't", async () => {
  const w = fakeWindow();
  const p = addPasskey({ signInHost: "login.test", clientId: "cid" }, w.win);
  w.send("https://login.test", w.frameWin, { type: "qauth.passkey", result: "error" });
  assert.equal(w.body.children.length, 0, "the frame is gone");
  assert.equal(w.opened.length, 1);
  assert.match(w.opened[0].url, /mode=popup/);
  w.send("https://login.test", w.opened[0], { type: "qauth.passkey", result: "added", name: "Booking · Mac · 2026-11-28" });
  assert.deepEqual(await p, { result: "added", name: "Booking · Mac · 2026-11-28" });

  const w2 = fakeWindow();
  const p2 = addPasskey({ signInHost: "login.test", clientId: "cid", mode: "iframe" }, w2.win);
  w2.send("https://login.test", w2.frameWin, { type: "qauth.passkey", result: "error" });
  assert.deepEqual(await p2, { result: "error" });
  assert.equal(w2.opened.length, 0);
});
