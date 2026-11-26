// The SDK against the REAL qAuth HTTP server (tools/sdk-testserver: qAuth's
// routes, checks and envelopes over in-memory stores). Needs Go on PATH, or
// QAUTH_SDK_TESTSERVER pointing at a built binary.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { QAuth, QAuthError, qauthProxy, isFreshStepUp, stepUpParams, keyMay, watchIdle } from "../dist/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let proc;
let seed;

before(async () => {
  // a built binary, never `go run` (killing `go run` leaves its child alive)
  let bin = process.env.QAUTH_SDK_TESTSERVER;
  if (!bin) {
    bin = join(mkdtempSync(join(tmpdir(), "qauth-sdk-")), "sdk-testserver");
    execFileSync("go", ["build", "-o", bin, "./tools/sdk-testserver"], { cwd: repo, stdio: "inherit" });
  }
  proc = spawn(bin, [], { stdio: ["ignore", "pipe", "ignore"] });
  const lines = createInterface({ input: proc.stdout });
  seed = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("test server did not start")), 120000);
    lines.once("line", (l) => {
      clearTimeout(t);
      resolve(JSON.parse(l));
    });
  });
});

after(() => proc?.kill());

const qauth = () => new QAuth({ baseUrl: seed.baseUrl });

test("profile and organizations of the signed-in person", async () => {
  const me = qauth().as("shop-admin-token");
  const p = await me.profile();
  assert.equal(p.email, "admin@shop.test");
  assert.deepEqual(p.orgs.map((o) => [o.id, o.role]), [[seed.shop, "admin"]]);
  const orgs = await me.orgs();
  assert.deepEqual(orgs.items[0].levels, {}, "Shop has no levels");
  // levels per product: Cafe is a Customer of the API
  const cafe = await qauth().as("cafe-admin-token").orgs();
  assert.deepEqual(cafe.items[0].levels[seed.api], [{ id: seed.customerLevel, name: "Customer" }]);
  assert.equal(cafe.items[0].isInternal, false);
  const lv = await qauth().as("cafe-admin-token").org(seed.cafe).levels();
  assert.deepEqual(lv.levels[seed.api], [seed.customerLevel]);
  assert.equal(orgs.items.length, 1);
  assert.equal(orgs.pagination.total, 1);
  // paging as qAuth sends it, plus the deprecated camelCase copy
  assert.equal(orgs.pagination.total_pages, 1);
  assert.equal(orgs.pagination.has_next, false);
  assert.equal(orgs.pagination.has_previous, false);
  assert.equal(orgs.pagination.totalPages, 1);
});

test("a bad token is a QAuthError 401", async () => {
  await assert.rejects(qauth().as("nope").profile(), (e) => e instanceof QAuthError && e.status === 401 && e.code === "UNAUTHORIZED");
});

test("an org admin manages people", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  assert.equal((await org.get()).name, "Shop");
  const added = await org.members.add({ email: "sara@shop.test", role: "manager" });
  assert.equal(added.existing, false);
  const list = await org.members.list();
  const sara = list.items.find((m) => m.login === "sara@shop.test");
  assert.equal(sara.role, "manager");
  // every role with whether the admin may give it; give two at once
  const givable = await org.givableRoles();
  assert.ok(givable.length > 0 && givable.every((r) => typeof r.canGive === "boolean" && r.space));
  const pick = givable.filter((r) => r.canGive).slice(0, 2).map((r) => r.id);
  assert.ok(pick.length > 0);
  assert.deepEqual(await org.members.setRoles(sara.id, pick), { updated: true });
  const held = (await org.members.list()).items.find((m) => m.id === sara.id).roles.map((r) => r.id);
  assert.deepEqual([...held].sort(), [...pick].sort());
  await org.members.setRole(sara.id, "member");
  assert.equal((await org.members.list()).items.find((m) => m.id === sara.id).role, "member");
  assert.deepEqual(await org.members.remove(sara.id), { removed: true });
});

test("a member reads but cannot manage; another org is not found", async () => {
  const me = qauth().as("shop-member-token");
  assert.equal((await me.org(seed.shop).get()).id, seed.shop);
  await assert.rejects(me.org(seed.shop).members.list(), (e) => e.status === 403 && e.code === "FORBIDDEN");
  await assert.rejects(me.org(seed.cafe).get(), (e) => e.status === 404);
  await assert.rejects(qauth().as("cafe-admin-token").org(seed.shop).members.list(), (e) => e.status === 404);
});

test("settings, security, apps", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  assert.equal((await org.updateSettings({ membersMayJoinOthers: true })).membersMayJoinOthers, true);
  assert.equal((await org.setSecurity({ mfaRequired: true })).mfaRequired, true);
  // an organization's apps are the APIs (products) it has
  assert.deepEqual((await org.apps()).items.map((a) => a.id), [seed.api]);
});

test("domains: add, list, verify (TXT missing), remove", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  const { domain: d, record, txtName, txtValue } = await org.domains.add("shop.test");
  assert.ok(d.token);
  assert.equal(record, "_qauth-verify.shop.test");
  assert.equal(txtName, record);
  assert.equal(txtValue, d.token);
  assert.equal((await org.domains.list()).items.length, 1);
  await assert.rejects(org.domains.verify(d.id), (e) => e instanceof QAuthError && e.status === 422);
  assert.deepEqual(await org.domains.remove(d.id), { removed: true });
});

test("branding and the sign-in page design: set, read, picture, reset", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  const b = await org.branding.set({ displayName: "Shop", accent: "#123456" });
  assert.equal(b.accent, "#123456");
  // a 1x1 PNG
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pic = await org.design.addPicture(png);
  assert.equal(pic.contentType, "image/png");
  const v = await org.design.set({
    accent: "#123456",
    design: {
      layout: "split",
      formSide: "end",
      panel: { background: { kind: "image", image: pic.hash, overlay: "#FFFFFF", overlayOpacity: 88 }, blocks: [{ id: "h", type: "heading", text: { en: "Welcome", ar: "مرحبًا" }, size: "m" }] },
    },
  });
  assert.equal(v.own, true);
  assert.equal(v.look.design.layout, "split");
  assert.equal((await org.branding.get()).design.panel?.blocks[0].id, "h");
  assert.ok(v.limits.fonts.includes("Cairo"));
  // links are https only; text is plain
  await assert.rejects(
    org.design.set({ design: { layout: "split", panel: { background: { kind: "color" }, blocks: [{ id: "l", type: "link", url: "http://shop.test", label: { en: "x", ar: "x" } }] } } }),
    (e) => e instanceof QAuthError && (e.status === 400 || e.status === 422) && /https/.test(e.message),
  );
  assert.deepEqual(await org.design.reset(), { removed: true });
  assert.equal((await org.design.get()).own, false);
});

test("API keys: create (secret once), list, validate, revoke", async () => {
  const q = qauth();
  const org = q.as("shop-admin-token").org(seed.shop);
  const minted = await org.apiKeys.create({ name: "Billing sync", apps: [seed.app] });
  assert.ok(minted.secret.length > 20);
  assert.equal(minted.key.name, "Billing sync");
  assert.ok(!JSON.stringify(await org.apiKeys.list()).includes(minted.secret));
  const ok = await q.validateKey(minted.secret, { app: seed.app });
  assert.equal(ok.valid, true);
  assert.equal(ok.key.orgId, seed.shop);
  assert.equal((await q.validateKey(minted.secret, { app: "another-app" })).valid, false);
  await org.apiKeys.revoke(minted.key.id);
  assert.equal((await q.validateKey(minted.secret)).valid, false);
});

test("API keys hold permissions; validateKey says what a key may do", async () => {
  const q = qauth();
  const org = q.as("shop-admin-token").org(seed.shop);
  const in3 = new Date(Date.now() + 90 * 86400000).toISOString();
  const minted = await org.apiKeys.create({ name: "Contacts sync", permissions: [seed.permission], expiresAt: in3 });
  assert.deepEqual(minted.key.permissions, [seed.permission]);
  const check = await q.validateKey(minted.secret);
  assert.equal(check.valid, true);
  assert.deepEqual(check.key.owner, { type: "organization", id: seed.shop });
  assert.deepEqual(check.key.permissions[seed.api], ["contacts:read"]);
  assert.equal(keyMay(check, seed.api, "contacts:read"), true);
  assert.equal(keyMay(check, seed.api, "contacts:write"), false);
  await org.apiKeys.revoke(minted.key.id);
});

test("personal access tokens: a subset of the person's own permissions", async () => {
  const q = qauth();
  const me = q.as("shop-member-token");
  const choices = (await me.tokens.choices(seed.shop)).items;
  assert.equal(choices.length, 1);
  assert.deepEqual(choices[0].permissions.map((p) => p.key), ["contacts:read"]);
  const t = await me.tokens.create({ orgId: seed.shop, name: "My script", permissions: [seed.permission] });
  assert.equal(t.key.kind, "pat");
  const check = await q.validateKey(t.secret);
  assert.equal(check.key.kind, "pat");
  assert.equal(keyMay(check, seed.api, "contacts:read"), true);
  assert.equal((await me.tokens.list()).items.length, 1);
  // someone else's token is not theirs to revoke; the owner revokes it
  await assert.rejects(q.as("shop-admin-token").tokens.revoke(t.key.id), (e) => e.status === 404);
  await me.tokens.revoke(t.key.id);
  assert.equal((await q.validateKey(t.secret)).valid, false);
});

test("the org's own roles and who holds them", async () => {
  const me = qauth().as("shop-admin-token");
  const org = me.org(seed.shop);
  assert.deepEqual((await org.roles.permissions(seed.app)).items.map((p) => p.key), ["contacts:read"]);
  const role = await org.roles.create(seed.app, { name: "Night shift", permissions: [seed.permission] });
  assert.equal(role.orgId, seed.shop);
  const names = (await org.roles.list(seed.app)).items.map((r) => r.name).sort();
  assert.deepEqual(names, ["Agent", "Night shift"]);
  await assert.rejects(org.roles.update(seed.agentRole, { name: "x", permissions: [seed.permission] }), (e) => e.status === 404);
  const p = await me.profile();
  await org.assignments.set({ appId: seed.app, userId: p.id, roleIds: [role.id] });
  const mine = (await org.assignments.list(seed.app)).items.find((x) => x.userId === p.id);
  assert.deepEqual(mine.roleIds, [role.id]);
  const eff = await me.permissions({ app: seed.app, org: seed.shop });
  assert.deepEqual(eff.permissions, ["contacts:read"]);
  // can() / permissions() on the real routes (cached per person, app, org)
  const qa = qauth();
  const scope = { app: seed.app, org: seed.shop };
  assert.equal(await qa.can("shop-admin-token", scope, "contacts:read"), true);
  assert.equal(await qa.can("shop-admin-token", scope, "contacts:write"), false);
  assert.deepEqual((await qa.permissions("shop-admin-token", scope)).permissions, ["contacts:read"]);
  assert.equal(await qa.can("shop-admin-token", { app: seed.app, org: seed.cafe }, "contacts:read"), false); // not a member
  await assert.rejects(qa.can("nope", scope, "contacts:read"), (e) => e instanceof QAuthError && e.status === 401);
  assert.equal((await qa.orgs("shop-admin-token"))[0].id, seed.shop);
  await org.roles.update(role.id, { name: "Night shift 2", permissions: [seed.permission] });
  assert.deepEqual(await org.roles.remove(role.id), { removed: true });
});

test("the org's audit log shows what was done through the API", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  await org.members.add({ email: "audit-me@shop.test" });
  const page = await org.audit({ limit: 5 });
  assert.ok(page.items.some((e) => e.type === "orgs.members.created"));
  await assert.rejects(qauth().as("shop-member-token").org(seed.shop).audit(), (e) => e.status === 403);
  // the filters: who did it, the result, and each event's who/what/where
  const mine = await org.audit({ type: "orgs.members.", result: "success", limit: 5 });
  const added = mine.items.find((e) => e.type === "orgs.members.created");
  assert.ok(added && added.result === "success" && added.actorType === "person" && added.requestId);
  assert.ok(mine.items.every((e) => e.result === "success" && e.type.startsWith("orgs.members.")));
});

test("my recent activity: my own events only", async () => {
  const me = qauth().as("shop-admin-token");
  const page = await me.account.activity({ limit: 20 });
  assert.ok(page.items.length > 0);
  assert.ok(page.items.every((e) => e.actor === "shop-admin" || e.target === "shop-admin"), JSON.stringify(page.items.slice(0, 2)));
  assert.ok(page.items.every((e) => e.changes === undefined));
});

test("invitations: create (link once), list, resend, revoke; a member cannot invite", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  const sent = await org.invitations.create({ email: "lina@shop.test", role: "manager", send: false });
  assert.equal(sent.sent, false);
  assert.match(sent.acceptUrl, /\/invite\?t=/);
  assert.equal(sent.invitation.status, "pending");
  const list = await org.invitations.list();
  assert.ok(list.items.some((i) => i.email === "lina@shop.test" && i.role === "manager"));
  assert.ok(!JSON.stringify(list).includes(new URL(sent.acceptUrl).searchParams.get("t")));
  const again = await org.invitations.resend(sent.invitation.id, { send: false });
  assert.notEqual(again.acceptUrl, sent.acceptUrl);
  assert.deepEqual(await org.invitations.revoke(sent.invitation.id), { removed: true });
  await assert.rejects(org.invitations.create({ email: "x@shop.test", send: false }).then(() =>
    qauth().as("shop-member-token").org(seed.shop).invitations.create({ email: "y@shop.test", send: false })), (e) => e.status === 403);
});

test("child organizations: list, create (any first admin; a new one is emailed, never a password); a parent never manages the child's people", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  // the first admin may be the caller (an existing account, added as it is)
  const self = await org.subOrgs.create({ name: "Self", adminEmail: "admin@shop.test" });
  assert.equal(self.adminExisting, true);
  assert.equal(self.initialAdminPassword, undefined);
  await assert.rejects(qauth().as("shop-member-token").org(seed.shop).subOrgs.create({ name: "X", adminEmail: "x@branch.test" }), (e) => e.status === 403);
  const made = await org.subOrgs.create({ name: "Branch TS", adminEmail: "boss@branch-ts.test", invite: false });
  assert.equal(made.invited, true, "from a parent the first admin is always emailed");
  assert.equal(made.initialAdminPassword, undefined);
  assert.equal(made.org.parentOrgId, seed.shop);
  const kids = await org.subOrgs.list();
  assert.ok(kids.items.some((k) => k.id === made.org.id && k.name === "Branch TS"));
  // a parent never manages the child's people; it sees them
  const child = qauth().as("shop-admin-token").org(made.org.id);
  await assert.rejects(child.members.add({ email: "staff@branch-ts.test" }), (e) => e.status === 403 && /own admins/.test(e.message));
  const people = await child.members.list();
  await assert.rejects(child.members.resetPassword(people.items[0].id, { password: "Another-good-pass-9!" }), (e) => e.status === 403);
  await assert.rejects(child.newAdmin("x@branch-ts.test"), (e) => e.status === 403);
  // the organization's own key creates children too, with the same rules
  const viaKey = await qauth().withKey(seed.orgKey).org(seed.shop).subOrgs.create({ name: "Branch key", adminEmail: "boss@branch-key.test" });
  assert.equal(viaKey.invited, true);
  assert.equal(viaKey.initialAdminPassword, undefined);
});

test("a key for child organizations only: create (externalId, Idempotency-Key), rename, external id, levels; never people", async () => {
  const kids = qauth().withKey(seed.subOrgsKey).org(seed.shop).subOrgs;
  const spec = { name: "Branch Idem TS", adminEmail: "boss@branch-idem-ts.test", externalId: "ts-idem-1" };
  const first = await kids.create(spec, { idempotencyKey: "ts-create-1" });
  assert.equal(first.org.externalId, "ts-idem-1");
  assert.ok(first.org.createdAt);
  const again = await kids.create(spec, { idempotencyKey: "ts-create-1" });
  assert.deepEqual(again, first, "a retry with the key answers the same child");
  await assert.rejects(kids.create({ ...spec, name: "Another" }, { idempotencyKey: "ts-create-1" }), (e) => e.status === 409);
  const child = qauth().withKey(seed.subOrgsKey).org(first.org.id);
  assert.equal((await child.rename("Branch Idem TS Ltd")).name, "Branch Idem TS Ltd");
  assert.equal((await child.setExternalId("")).externalId, undefined);
  // Shop has no levels: its child can't get one from it
  await assert.rejects(child.setLevels(seed.api, [seed.customerLevel]), (e) => e.status === 422);
  const list = await kids.list();
  assert.ok(list.items.every((k) => typeof k.createdAt === "string" && !k.createdAt.startsWith("0001")));
  await assert.rejects(qauth().withKey(seed.subOrgsKey).org(seed.shop).members.list(), (e) => e.status === 403);
});

test("roles carry their level", async () => {
  const org = qauth().as("cafe-admin-token").org(seed.cafe);
  const r = await org.roles.create(seed.app, { name: "Customer helper", permissions: [], levelId: seed.customerLevel });
  assert.equal(r.levelId, seed.customerLevel);
  await org.roles.remove(r.id);
});

test("company sign-in: not connected, needs a verified domain, admins only", async () => {
  const org = qauth().as("shop-admin-token").org(seed.shop);
  const st = await org.sso.get();
  assert.equal(st.connected, false);
  assert.match(st.callbackUrl, /\/idps\/callback$/);
  assert.ok(Array.isArray(st.otherDirectoryApps));
  await assert.rejects(org.sso.set({ displayName: "Shop account", issuer: "https://login.example.test", clientId: "c", clientSecret: "s" }),
    (e) => e.status === 422 && /verify at least one email domain/i.test(e.message));
  await assert.rejects(org.sso.set({ displayName: "Shop account", issuer: "https://login.example.test", clientId: "c", publicClient: true }),
    (e) => e.status === 422 && /verify at least one email domain/i.test(e.message));
  await assert.rejects(org.sso.remove(), (e) => e.status === 404);
  await assert.rejects(qauth().as("shop-member-token").org(seed.shop).sso.get(), (e) => e.status === 403);
});

test("my account: security, password, authenticator with proof, recovery codes, sessions", async () => {
  const me = qauth().as("shop-admin-token");
  const sec = await me.account.security();
  assert.equal(sec.hasPassword, true);
  assert.equal(sec.authenticator, false);
  await assert.rejects(me.account.changePassword("wrong", "Brand-new-pass-1!"), (e) => e.status === 422);
  assert.deepEqual(await me.account.changePassword("Pass-shop-admin-1!", "Brand-new-pass-1!"), { updated: true });
  const start = await me.account.authenticator.start();
  assert.match(start.uri, /^otpauth:/);
  await me.account.authenticator.verify("123456");
  await assert.rejects(me.account.authenticator.remove({ password: "nope" }), (e) => e.status === 422);
  const codes = await me.account.recoveryCodes();
  assert.equal(codes.codes.length, 10);
  await assert.rejects(me.account.recoveryCodes(), (e) => e.status === 422); // proof needed now
  assert.equal((await me.account.recoveryCodes({ code: "123456" })).codes.length, 10);
  assert.deepEqual(await me.account.authenticator.remove({ code: "123456" }), { removed: true });
  const s = await me.account.sessions.list();
  assert.equal(s.items.length, 2);
  await assert.rejects(me.account.sessions.end("sess-cafe-admin-1"), (e) => e.status === 404);
  assert.deepEqual(await me.account.sessions.end(s.items[0].id), { removed: true });
  assert.deepEqual(await me.account.sessions.endAll(), { removed: true, count: 1 });
});

test("single sign-on: each app reads its own rules on a shared session", async () => {
  const me = qauth().as("cafe-admin-token").account;
  assert.equal((await me.sessions.state("sess-shared", "cid-second")).idleMinutes, 5);
  assert.equal((await me.sessions.state("sess-shared", "cid-first")).idleMinutes, 30);
  await assert.rejects(me.sessions.state("sess-shared"), (e) => e.status === 400); // shared: the app must be named
  assert.equal((await me.sessions.activity("sess-shared", "cid-second")).idleMinutes, 5);
});

test("an org's API key: its own org within its scopes", async () => {
  const org = qauth().withKey(seed.orgKey).org(seed.shop);
  assert.ok((await org.members.list()).items.length >= 1);
  const added = await org.members.add({ email: "via-key@shop.test" });
  assert.equal(added.existing, false);
  await assert.rejects(org.members.add({ email: "boss@shop.test", role: "admin" }), (e) => e.status === 403);
  await assert.rejects(org.updateSettings({ membersMayJoinOthers: true }), (e) => e.status === 403);
  await assert.rejects(org.apiKeys.list(), (e) => e.status === 403);
  await assert.rejects(qauth().withKey(seed.orgKey).org(seed.cafe).members.list(), (e) => e.status === 404);
});

test("the screens' proxy: allowed paths only, CSRF header on writes, the session's token", async () => {
  const proxy = qauthProxy({ baseUrl: seed.baseUrl, mount: "/qauth", accessToken: (req) => (req.headers.get("cookie") === "s=ok" ? "shop-member-token" : null) });
  const at = (path, init = {}) => proxy(new Request("https://product.example" + path, { ...init, headers: { cookie: "s=ok", ...(init.headers ?? {}) } }));
  let r = await at("/qauth/v1/me/security");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.email, "member@shop.test");
  r = await proxy(new Request("https://product.example/qauth/v1/me/security"));
  assert.equal(r.status, 401, "no session, no call");
  for (const bad of ["/qauth/admin/tenants", "/qauth/v1/me/..%2f..%2fadmin", "/qauth/v1/orgs/%2e%2e/x", "/qauth/tenant/orgs", "/qauth//v1/me", "/other/v1/me"]) {
    r = await at(bad);
    assert.equal(r.status, 404, bad);
  }
  // the screens may start and check a verification, never consume one
  r = await at("/qauth/v1/verifications", { method: "POST", headers: { "x-qauth-request": "1", "content-type": "application/json" }, body: JSON.stringify({ template: "Money transfer", variables: { amount: "1" } }) });
  assert.equal(r.status, 201, "start through the proxy");
  const started = (await r.json()).data;
  r = await at(`/qauth/v1/verifications/${started.requestId}/consume`, { method: "POST", headers: { "x-qauth-request": "1" } });
  assert.equal(r.status, 404, "consume is the backend's own call");
  r = await at("/qauth/v1/me/sessions", { method: "DELETE" });
  assert.equal(r.status, 403, "a write without the CSRF header");
  r = await at("/qauth/v1/me/sessions", { method: "DELETE", headers: { "x-qauth-request": "1" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("set-cookie"), null);
});

test("step-up: no record is null; freshness is judged against when you sent them", async () => {
  assert.equal(await qauth().as("shop-admin-token").account.lastStepUp("some-client"), null);
  assert.deepEqual(stepUpParams, { max_age: "0" });
  const sent = new Date(Date.now() - 60_000);
  assert.equal(isFreshStepUp({ at: new Date().toISOString(), method: "authenticator" }, sent), true);
  assert.equal(isFreshStepUp({ at: new Date(Date.now() - 120_000).toISOString(), method: "email" }, sent), false, "before you sent them");
  assert.equal(isFreshStepUp(null, sent), false);
});

test("action verification: code to the person's own phone, checked, consumed once", async () => {
  const me = qauth().as("shop-member-token");
  const v = await me.verifications.start("Money transfer", { amount: "500" });
  assert.equal(v.channel, "sms");
  assert.notEqual(v.sentTo, "+966512345678");
  assert.deepEqual(v.channels, ["sms", "voice"]);
  assert.deepEqual(await me.verifications.check(v.requestId, "0000"), { status: "invalid", triesLeft: 2 });
  assert.equal((await me.verifications.check(v.requestId, "1234")).status, "verified");
  await assert.rejects(me.verifications.consume(v.requestId, { template: "Money transfer", variables: { amount: "5000" } }), (e) => e.status === 409);
  await assert.rejects(qauth().as("shop-admin-token").verifications.consume(v.requestId, { template: "Money transfer", variables: { amount: "500" } }), (e) => e.status === 404);
  const used = await me.verifications.consume(v.requestId, { template: "Money transfer", variables: { amount: "500" } });
  assert.equal(used.template, "Money transfer");
  await assert.rejects(me.verifications.consume(v.requestId, { template: "Money transfer", variables: { amount: "500" } }), (e) => e.status === 409);
});

test("a role change shows at once (qAuth drops its kept answers; SDK cache off)", async () => {
  const qa = new QAuth({ baseUrl: seed.baseUrl, permissionsCacheSeconds: 0 });
  const me = qa.as("shop-admin-token");
  const org = me.org(seed.shop);
  const { id } = await me.profile();
  const scope = { app: seed.app, org: seed.shop };
  const role = await org.roles.create(seed.app, { name: "Stale check", permissions: [seed.permission] });
  await org.assignments.set({ appId: seed.app, userId: id, roleIds: [] });
  assert.equal(await qa.can("shop-admin-token", scope, "contacts:read"), false);
  await org.assignments.set({ appId: seed.app, userId: id, roleIds: [role.id] });
  assert.equal(await qa.can("shop-admin-token", scope, "contacts:read"), true, "a given role works at once");
  await org.assignments.set({ appId: seed.app, userId: id, roleIds: [] });
  assert.equal(await qa.can("shop-admin-token", scope, "contacts:read"), false, "a removed role stops at once");
  await org.roles.remove(role.id);
});

test("my devices: list with counts, approve a TV code, rename, pairing code, sign out; org admins end devices", async () => {
  const me = qauth().as("cafe-admin-token");
  let list = await me.account.devices.list({ app: seed.app, session: "laptop-1" });
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].name, "Office laptop");
  assert.equal(list.devices[0].current, true);
  assert.deepEqual(list.counts.map((c) => [c.type, c.inUse, c.limit]), [["", 1, 3], ["tv", 0, 2], ["phone", 0, 0], ["computer", 1, 0], ["other", 0, 0]]);
  assert.deepEqual(list.apps.map((a) => [a.id, a.pairing]), [[seed.app, true]]);
  // the TV waiting with BKRT-JMXL: shown before approving, then approved
  const waiting = await me.account.devices.lookup("bkrt jmxl");
  assert.equal(waiting.deviceName, "Living room TV");
  assert.equal(waiting.appName, "Omni");
  assert.equal(waiting.typeMax, 2);
  assert.equal(waiting.choices.length, 3);
  assert.ok(waiting.choices.includes(seed.tvNumber));
  assert.equal(waiting.otherNetwork, true); // the TV asked from 203.0.113.7
  await assert.rejects(qauth().as("shop-member-token").account.devices.lookup("WRONGCDE"), (e) => e.status === 422);
  // another network: the person must confirm
  await assert.rejects(me.account.devices.approve("BKRT-JMXL", { number: seed.tvNumber, clientId: "omni-web" }), (e) => e.status === 409 && e.code === "CONFIRM_PLACE");
  assert.deepEqual(await me.account.devices.approve("BKRT-JMXL", { number: seed.tvNumber, confirmPlace: true, clientId: "omni-web" }), { decision: "approve", device: "Living room TV" });
  list = await me.account.devices.list({ app: seed.app });
  const tv = list.devices.find((d) => d.type === "tv");
  assert.equal(tv.kind, "code");
  assert.equal(list.counts[1].inUse, 1);
  // another person can't touch it
  await assert.rejects(qauth().as("shop-member-token").account.devices.signOut(tv.id), (e) => e.status === 404);
  const renamed = await me.account.devices.update(tv.id, { name: "Bedroom TV", shared: true });
  assert.equal(renamed.name, "Bedroom TV");
  assert.equal(renamed.shared, true);
  await assert.rejects(me.account.devices.pairingCode(seed.app), (e) => e.status === 403 && e.code === "FRESH_SIGN_IN_REQUIRED"); // no client named
  const pc = await me.account.devices.pairingCode(seed.app, { clientId: "omni-web" });
  assert.match(pc.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(!pc.url.includes(pc.code), "a pairing code never sits in a link");
  // Cafe's admin sees and ends a member's TV through the org API (another org's admin can't)
  const cafe = qauth().as("cafe-admin-token").org(seed.cafe);
  const theirs = await cafe.members.devices("cafe-admin");
  assert.equal(theirs.items.length, 2);
  await assert.rejects(qauth().as("shop-admin-token").org(seed.shop).members.devices("cafe-admin"), (e) => e.status === 403 || e.status === 404);
  assert.equal((await cafe.members.endDevice("cafe-admin", tv.id)).removed, true);
  await assert.rejects(me.account.devices.signOutAll({ type: "computer" }), (e) => e.status === 400); // which one is mine?
  assert.equal((await me.account.devices.signOutAll({ type: "computer", includeCurrent: true })).count, 1);
  assert.equal((await me.account.devices.list()).devices.length, 0);
});

test("an organization makes an app's session settings stricter, never looser", async () => {
  const shop = qauth().as("shop-admin-token").org(seed.shop);
  const v = await shop.sessionSettings.get(seed.app);
  assert.equal(v.app.maxSessions, 3);
  await assert.rejects(shop.sessionSettings.set(seed.app, { maxSessions: 5 }), (e) => e.status === 422);
  await assert.rejects(shop.sessionSettings.set(seed.app, { phoneSignIn: true }), (e) => e.status === 422);
  const set = await shop.sessionSettings.set(seed.app, { maxSessions: 2, atLimit: "refuse" });
  assert.equal(set.effective.maxSessions, 2);
  assert.equal(set.effective.atLimit, "refuse");
  assert.deepEqual((await shop.sessionSettings.set(seed.app, {})).override, {});
});

// keep these last: they end cafe-admin's first session
test("instant sign-out: the screens' proxy passes the session's stream through as it comes", { timeout: 5000 }, async () => {
  const proxy = qauthProxy({ baseUrl: seed.baseUrl, mount: "/qauth", accessToken: () => "cafe-admin-token" });
  const ac = new AbortController();
  const r = await proxy(new Request("https://product.example/qauth/v1/me/sessions/sess-cafe-admin-1/events?client=cid-live", { signal: ac.signal }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(r.headers.get("x-accel-buffering"), "no");
  const reader = r.body.getReader();
  let got = "";
  while (!got.includes("event: ready")) {
    const { value, done } = await reader.read(); // a buffering proxy would never answer before the stream ends
    assert.ok(!done, "the stream ended early");
    got += new TextDecoder().decode(value);
  }
  ac.abort();
  await reader.cancel().catch(() => undefined);
});

test("instant sign-out: watchIdle on qAuth's stream ends the moment the session is signed out elsewhere", async () => {
  const me = qauth().as("cafe-admin-token").account;
  const sid = "sess-cafe-admin-1";
  const ended = [];
  let opened = 0;
  const w = watchIdle({
    sessionId: sid,
    source: {
      state: () => me.sessions.state(sid, "cid-live"),
      activity: () => me.sessions.activity(sid, "cid-live"),
      events: (signal) => (opened++, me.sessions.events(sid, { clientId: "cid-live", signal })),
    },
    onEnded: (r) => ended.push(r),
  });
  await new Promise((r) => setTimeout(r, 300)); // the stream is open
  assert.equal(opened, 1);
  const start = Date.now();
  assert.deepEqual(await me.sessions.end(sid), { removed: true }); // "sign out" on another device
  while (ended.length === 0 && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ended, ["signed_out"]);
  assert.ok(Date.now() - start < 1000, `ended after ${Date.now() - start} ms`);
  w.stop();
});
