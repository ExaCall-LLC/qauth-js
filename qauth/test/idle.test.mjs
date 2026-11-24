// The idle watcher with a fake qAuth (same rules as the server: seconds
// left from a shared clock) and mocked timers.
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { watchIdle, sessionIdOf } from "../dist/index.js";

let T; // the shared clock (ms)
beforeEach(() => {
  T = 1_000_000;
  mock.timers.enable({ apis: ["setInterval"] });
});
afterEach(() => mock.timers.reset());

const flush = () => new Promise((r) => setImmediate(r));
async function advance(seconds) {
  for (let i = 0; i < seconds; i++) {
    T += 1000;
    mock.timers.tick(1000);
    await flush();
  }
}

// a session with idle/max rules in minutes, kept like qAuth keeps it
function fakeQAuth(idle, max) {
  const s = { started: T, active: T, ended: undefined, activityCalls: 0 };
  const state = () => {
    if (!s.ended && max && T >= s.started + max * 60000) s.ended = "max_length";
    if (!s.ended && idle && T >= s.active + idle * 60000) s.ended = "idle";
    return {
      sessionId: "s1", idleMinutes: idle, maxMinutes: max, ended: s.ended,
      idleSecondsLeft: idle ? Math.max(0, Math.floor((s.active + idle * 60000 - T) / 1000)) : -1,
      maxSecondsLeft: max ? Math.max(0, Math.floor((s.started + max * 60000 - T) / 1000)) : -1,
    };
  };
  s.source = {
    state: async () => state(),
    activity: async () => {
      s.activityCalls++;
      if (!state().ended) s.active = T;
      return state();
    },
  };
  return s;
}

function watch(q, extra = {}) {
  const seen = { warns: [], active: 0, ended: [] };
  const target = new EventTarget();
  const w = watchIdle({
    source: q.source, sessionId: extra.sid ?? `s-${Math.random()}`, warnSeconds: 30, target, now: () => T,
    onWarn: (x) => seen.warns.push(x), onActive: () => seen.active++, onEnded: (r) => seen.ended.push(r), ...extra,
  });
  return { w, seen, poke: () => target.dispatchEvent(new Event("keydown")) };
}

test("warns before the idle end, then ends", async () => {
  const q = fakeQAuth(2, 0);
  const { w, seen } = watch(q);
  await flush();
  await advance(89);
  assert.equal(seen.warns.length, 0, "no warning 31 s before the end");
  await advance(2);
  assert.equal(seen.warns.at(-1).reason, "idle");
  assert.ok(seen.warns.at(-1).secondsLeft <= 30 && seen.warns.at(-1).secondsLeft >= 28);
  await advance(31);
  assert.deepEqual(seen.ended, ["idle"]);
  w.stop();
});

test("activity is reported at most once per gap, and keeps the session", async () => {
  const q = fakeQAuth(4, 0); // gap = 60 s (a quarter of 4 min)
  const { w, seen, poke } = watch(q);
  await flush();
  for (let i = 0; i < 300; i++) {
    poke();
    await advance(1);
  }
  assert.ok(q.activityCalls >= 4 && q.activityCalls <= 6, `reports: ${q.activityCalls}`);
  assert.equal(seen.warns.length, 0);
  assert.equal(seen.ended.length, 0, "an active person is never signed out");
  w.stop();
});

test("during the warning only 'stay signed in' counts", async () => {
  const q = fakeQAuth(2, 0);
  const { w, seen, poke } = watch(q);
  await flush();
  await advance(95);
  assert.ok(seen.warns.length > 0);
  const before = q.activityCalls;
  poke();
  await advance(2);
  assert.equal(q.activityCalls, before, "a stray mouse move during the warning is not activity");
  await w.stillHere();
  await advance(2);
  assert.equal(q.activityCalls, before + 1);
  assert.ok(seen.active >= 1);
  const warnsBefore = seen.warns.length;
  await advance(60);
  assert.equal(seen.warns.length, warnsBefore, "the timer started over");
  assert.equal(seen.ended.length, 0);
  w.stop();
});

test("the maximum length warns as max_length and can't be extended", async () => {
  const q = fakeQAuth(0, 2);
  const { w, seen } = watch(q);
  await flush();
  await advance(95);
  assert.equal(seen.warns.at(-1).reason, "max_length");
  await w.stillHere();
  await advance(30);
  assert.deepEqual(seen.ended, ["max_length"]);
  w.stop();
});

test("tabs of one session share activity and the end", async () => {
  const q = fakeQAuth(2, 0);
  const a = watch(q, { sid: "shared" });
  const b = watch(q, { sid: "shared" });
  await flush();
  for (let i = 0; i < 100; i++) {
    a.poke(); // only tab A is used
    await advance(1);
  }
  assert.equal(b.seen.warns.length, 0, "tab B saw tab A's activity");
  await a.w.stop();
  await advance(200);
  assert.deepEqual(b.seen.ended, ["idle"]);
  b.w.stop();
});

test("a session ended elsewhere is reported once", async () => {
  const q = fakeQAuth(30, 0);
  const { w, seen } = watch(q);
  await flush();
  q.ended = "signed_out";
  await w.check();
  await w.check();
  assert.deepEqual(seen.ended, ["signed_out"]);
  w.stop();
});

test("sessionIdOf reads the sid claim", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(sessionIdOf(`${b64({ alg: "RS256" })}.${b64({ sid: "abc-1", sub: "u" })}.sig`), "abc-1");
  assert.equal(sessionIdOf("garbage"), "");
});

test("the end is reported once when another tab and a check race", async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  const ended = { sessionId: "s1", idleMinutes: 2, maxMinutes: 0, idleSecondsLeft: 0, maxSecondsLeft: -1, ended: "idle" };
  let calls = 0;
  const source = { state: async () => (++calls === 1 ? { ...ended, ended: undefined, idleSecondsLeft: 100 } : slow), activity: async () => ended };
  const { w, seen } = watch({ source }, { sid: "race" });
  await flush();
  const inFlight = w.check(); // waits on the slow answer
  const other = new BroadcastChannel("qauth-session:race");
  other.postMessage({ t: "ended", reason: "idle" });
  await new Promise((r) => setTimeout(r, 30)); // the message arrives first
  assert.deepEqual(seen.ended, ["idle"]);
  release(ended);
  await inFlight;
  other.close();
  assert.deepEqual(seen.ended, ["idle"]);
  w.stop();
});

test("without tab sharing, a check and a report racing to the end report it once", async () => {
  const saved = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = undefined;
  try {
    let release;
    const slow = new Promise((r) => (release = r));
    const ended = { sessionId: "s1", idleMinutes: 2, maxMinutes: 0, idleSecondsLeft: 0, maxSecondsLeft: -1, ended: "idle" };
    let calls = 0;
    const source = { state: async () => (++calls === 1 ? { ...ended, ended: undefined, idleSecondsLeft: 100 } : slow), activity: async () => ended };
    const { w, seen } = watch({ source });
    await flush();
    const inFlight = w.check();
    await w.stillHere(); // its answer: ended
    release(ended);
    await inFlight;
    assert.deepEqual(seen.ended, ["idle"]);
    w.stop();
  } finally {
    globalThis.BroadcastChannel = saved;
  }
});

test("a refused token (401) is the end, with the reason from the passed deadline", async () => {
  const q = fakeQAuth(2, 0);
  const refused = Object.assign(new Error("unauthorized"), { status: 401 });
  const { w, seen } = watch(q);
  await flush();
  q.source.state = async () => { throw refused; };
  await advance(125);
  assert.deepEqual(seen.ended, ["idle"]);
  w.stop();
  const q2 = fakeQAuth(30, 0);
  const b = watch(q2);
  await flush();
  q2.source.state = async () => { throw refused; };
  await b.w.check();
  assert.deepEqual(b.seen.ended, ["signed_out"]);
  b.w.stop();
  const q3 = fakeQAuth(30, 0);
  const c = watch(q3);
  await flush();
  q3.source.state = async () => { throw new Error("offline"); };
  await c.w.check();
  assert.deepEqual(c.seen.ended, [], "a network error is not the end");
  c.w.stop();
});
