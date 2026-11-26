# @isdlc.ai/qauth

Server-side SDK for products that use **qAuth**. Your backend:

- **verifies access tokens offline** (the issuer's published keys, no qAuth call) and protects
  routes with ready middleware;
- asks **what the person may do** (`can`, `permissions`), with a short cache;
- calls qAuth on behalf of the signed-in person, with **that person's own access token**:
  their organizations, members, roles, domains, API keys and audit log, so your customers'
  admins can manage their organization inside your product without ever seeing qAuth;
- validates API keys your customers' systems present to your API.

Node 20+ (built-in `fetch` and WebCrypto), or any runtime that has both (Deno, Bun, workers).
One runtime dependency: [`jose`](https://github.com/panva/jose) for token signatures.

## Install

Public, no account or token needed:

```bash
npm install https://github.com/ExaCall-LLC/qauth-js/releases/download/qauth-v0.22.0/isdlc.ai-qauth-0.22.0.tgz
```

Every version is a release of [github.com/ExaCall-LLC/qauth-js](https://github.com/ExaCall-LLC/qauth-js/releases)
(MIT): tag `qauth-vX.Y.Z`, file `isdlc.ai-qauth-X.Y.Z.tgz`. The package name stays `@isdlc.ai/qauth`, so
imports don't change. To update, change both numbers in the address.

Apps that already use the `@isdlc.ai` registry can keep it (same versions):

```bash
npm config set @isdlc.ai:registry https://git.qapps.dev/api/packages/isdlc/npm/
npm install @isdlc.ai/qauth
```

## Quick start for a backend

```ts
import { QAuth, identityOf, errorResponse } from "@isdlc.ai/qauth";

// Your tenant's issuer and your app's client id: that's all. qAuth's API address
// comes from the issuer's discovery (qauth_api); tokens are checked offline by a
// Verifier for this issuer and client; permission answers are kept 60 s per person.
const qauth = new QAuth({
  issuer: "https://acme.qapps.dev",      // exactly as tokens carry it
  clientId: "<your app's client id>",    // the app whose tokens your API accepts
  apiKey: process.env.QAUTH_ORG_API_KEY, // optional: an organization's key for qauth.org(id)
});

// Express / Connect
app.use("/api", qauth.middleware());              // 401 + WWW-Authenticate when the token is refused
app.get("/api/notes", async (req, res) => {
  const who = identityOf(req)!;                   // { subject, clientId, issuer, expiresAt, claims, token }
  const org = req.get("x-org-id")!;
  if (!(await qauth.can(who, { app: NOTES_API_ID, org }, "notes:read"))) return res.status(403).end();
  res.json(await notesOf(org));
});

// Next.js route handler, Hono, workers (fetch-style)
export async function GET(request: Request) {
  try {
    const who = await qauth.authenticate(request);
    // …
  } catch (e) {
    return errorResponse(e);                      // 401 / 503 with the JSON envelope
  }
}
```

The issuer is trusted for tokens only; the API address it names must be a known qAuth host (`auth.qapps.dev`;
add yours with `trustedApiHosts`). Several clients, an audience, or an older qAuth server (its discovery has no `qauth_api`)? Pass your
own `verifier: new Verifier({ issuers, clientIds })` (below) and/or `baseUrl: "https://auth.qapps.dev"`.

Decide on **permission keys** (`notes:read`), never on role names: roles are data each
organization edits. Key your own data on `subject` (with `issuer`), never on email.

## Verify access tokens (offline)

```ts
const verifier = new Verifier({
  issuers: ["https://acme.qapps.dev", "https://shop.example.com"], // one per tenant you serve
  clientIds: ["web-client", "mobile-client"],
  audience: "notes-api",          // optional: also require this audience (unset = any audience; only clientIds restricts)
  clockToleranceSeconds: 60,      // default 60
  keysCooldownSeconds: 30,        // unknown key id: refetch the keys at most this often (default 30)
  keysMaxAgeSeconds: 600,         // refetch the keys this often anyway (default 600)
  discoveryCacheSeconds: 3600,    // keep each issuer's discovery this long (default 3600)
  failureBackoffSeconds: 5,       // after a failed discovery/key fetch, answer 503 at once this long (default 5)
  // algorithms: ["RS256"],       // narrow further (public-key only); default: what discovery publishes
  // keys: jwks,                  // fixed keys instead of discovery (tests, pinned keys)
});
const who = await verifier.verify(token); // Identity, or throws QAuthError
```

A token is accepted only when:

- its `iss` is one of `issuers`, exactly. Any other issuer is refused before anything is fetched. Issuers and
  the keys address must be `https://` (`http://` only for localhost / 127.0.0.1); redirects are never followed;
- it is signed with one of that issuer's keys (`jwks_uri` from `<issuer>/.well-known/openid-configuration`)
  with a public-key algorithm the issuer publishes (RS256, ES256, EdDSA…). `none` and HMAC are always refused;
- it is within `exp` / `nbf` (with the leeway), has `exp`, and `sub` is a non-empty string;
- it was issued to one of `clientIds`: its `client_id` (required; `azp` is never used instead);
- it is an **access token**. qAuth's ID tokens are signed with the same keys, carry `client_id` and `typ: JWT`
  too, so any token with an ID-token claim (`azp`, `at_hash`, `nonce`, `auth_time`, `sid`, `amr`) is refused, and so is a
  header `typ` other than `JWT` or `at+jwt` (no `typ` is fine).

Refusals are `QAuthError`s with status 401 and one of these codes (`TokenErrorCode`):
`TOKEN_MISSING`, `TOKEN_MALFORMED`, `TOKEN_EXPIRED`, `TOKEN_NOT_YET_VALID`, `WRONG_ISSUER`, `WRONG_CLIENT`,
`NOT_ACCESS_TOKEN`, `WRONG_AUDIENCE`, `BAD_SIGNATURE`. When the issuer's discovery or keys can't be fetched the answer is
503 `KEYS_UNAVAILABLE` (try again; it is not a sign-in problem). A failure is kept only for
`failureBackoffSeconds` (default 5), so a down issuer answers 503 at once instead of every request waiting.

Without `audience` any audience is accepted: the client (`client_id`) is what restricts tokens to your apps.
`Identity.sessionId` is not set for qAuth access tokens (they carry no `sid`); read the session id from the
ID token with `sessionIdOf(idToken)`.

Key rotation needs nothing from you: a token with a new key id makes the verifier refetch the keys
(at most once per cooldown), and a retired key stops verifying once it is gone from the JWKS.

## Middleware

- **Express / Connect** (also plain `node:http`): `verifier.middleware()` verifies the
  `Authorization: Bearer` token and puts the Identity on `req.identity` (`identityOf(req)`). Refused:
  401 with `WWW-Authenticate: Bearer realm="api", error="invalid_token", error_description="<code>"`
  (no `error` when no token was sent), and the JSON envelope. `middleware({ optional: true })` lets
  requests without a token through (no identity); a bad token is still refused.
- **Fetch-style** (Next.js route handlers, Hono, Deno, Bun, workers): `await verifier.authenticate(request)`
  returns the Identity or throws; `errorResponse(e)` turns the refusal into the same 401 / 503 `Response`.
- `bearerToken(header)` reads a well-formed `Bearer` header, if you build your own.
- `verifier.reset()` drops every cached discovery document and key set (they are fetched again on the next token).

## Permissions: can and permissions

```ts
await qauth.can(who, { app: appId, org: orgId }, "notes:read");   // true / false
await qauth.permissions(who, { app: appId, org: orgId });         // { roles, permissions, orgPermissions }
await qauth.orgs(who);                                            // [{ id, name, role }]
await qauth.forget(who);                                          // drop what is cached about the person
```

`who` is an Identity from the verifier, or the person's raw access token. These call qAuth with the
person's own token. `can` answers false when the person is not a member of the org (qAuth's 403/404);
a 401 (their session is over: signed out, idle, too long) still throws, so you can end your session too.

**Caching.** Answers are kept per person, app and organization for `permissionsCacheSeconds`
(default 60; `0` = always ask). Within that time an answer is reused **without asking qAuth again**:
a removed role, or the person's qAuth session ending (signed out, idle, too long), only shows after the
cache time. The access token itself is still checked offline on every request (expiry included). If an
action must see a session end at once, use `permissionsCacheSeconds: 0` or call `qauth.forget(who)` first. Concurrent questions
share one call; refusals and failures are never cached. The cache is keyed on the verified `sub`
(an Identity, or a raw token when the `QAuth` has a `verifier`); without a verifier a raw token's
answers are kept per token, never per an unverified `sub`.

## Caching API-key checks

`validateKey` asks qAuth every time by default, so a revoked key stops at once. A busy API may keep
answers briefly:

```ts
const qauth = new QAuth({ baseUrl, keyCacheSeconds: 30 }); // a revoked key then works up to 30 s more
const check = await qauth.validateKey(presentedKey, { app: appId });
if (!keyMay(check, appId, "records:read")) { /* 401 / 403 */ }
qauth.forgetKeys(); // e.g. right after you revoked a key
```

Answers (valid or not) are kept per key and app, keyed on a SHA-256 of the key; the key itself is
never stored. Failures are never cached.

## Act as the signed-in person

```ts
import { QAuth, QAuthError } from "@isdlc.ai/qauth";

const qauth = new QAuth({ baseUrl: "https://auth.example.com" });

// In a request handler of YOUR backend, with the person's access token
// (from your session; never send it to the browser to call qAuth directly):
const me = qauth.as(accessToken);
const profile = await me.profile();            // { id, email, orgs: [{ id, name, role }] }
const org = me.org(profile.orgs[0].id);

await org.members.list();                       // { items, pagination }
// roles come from qAuth, with whether you may give each (no escalation)
const roles = await org.givableRoles(); // [{ id, name, space, spaceName, canGive, missing? }]
const nurse = roles.find((r) => r.name === "Nurse" && r.canGive);
await org.members.add({ email: "sara@shop.com", roleIds: [nurse.id], invite: true });
await org.members.setRoles(userId, [nurse.id]); // replaces the person's roles in every space
await org.members.remove(userId);

// Child organizations: any first admin (a new one is emailed, never a password back);
// a parent sees a child's people read-only and never manages them
const kids = await org.subOrgs.list();          // only the children you reach
const made = await org.subOrgs.create({ name: "Branch", adminEmail: "boss@branch.com" }); // made.invited
await me.org(made.org.id).members.list();       // read-only for the parent

// Invitations: the person accepts on qAuth's page (existing account, or a new
// one with a password they choose) and only then joins
await org.invitations.create({ email: "lina@shop.com", roleIds: [nurse.id], appId, returnUrl: "https://app.example.com/welcome" });
await org.invitations.list();          // pending / expired / locked / revoked
await org.invitations.resend(invitationId);
await org.invitations.revoke(invitationId);

// The org's own roles for one of your apps, from the app's permissions
const perms = await org.roles.permissions(appId);
const role = await org.roles.create(appId, { name: "Night shift", permissions: [perms.items[0].id] });
await org.assignments.set({ appId, userId, roleIds: [role.id] });
await me.permissions({ app: appId, org: org.id });  // { roles, permissions }

// Verified email domains (accounts at the domain become the org's managed accounts)
const { domain, record } = await org.domains.add("shop.com");
// publish a TXT record named `record` with the value `domain.token`, then:
await org.domains.verify(domain.id);

// API keys for the org's systems (the secret is shown once)
const { key, secret } = await org.apiKeys.create({ name: "Billing sync", apps: [appId] });
await org.apiKeys.revoke(key.id);

// Company sign-in (OpenID Connect; admins; for emails at the org's verified domains)
const { callbackUrl } = await org.sso.get();  // register this at the provider
await org.sso.set({ displayName: "Contoso account", issuer: "https://login.microsoftonline.com/<tenant>/v2.0",
  clientId, clientSecret, mode: "required" });  // or "optional"

// Settings, security, audit
await org.setSecurity({ mfaRequired: true });
await org.audit({ limit: 50 });

// My account (the person's own): password, authenticator, phone, recovery codes, sessions.
// Removing a factor or new recovery codes needs a fresh proof: { password } or { code }.
await me.account.security();
await me.account.changePassword(current, next);
const { uri } = await me.account.authenticator.start();   // show as a QR code
await me.account.authenticator.verify("123456");
await me.account.authenticator.remove({ code: "123456" });
await me.account.phone.add("+966512345678"); await me.account.phone.verify(code);
const { codes } = await me.account.recoveryCodes();        // shown once
await me.account.sessions.list(); await me.account.sessions.endAll(); // signs out everywhere

// Server to server: an organization's API key on its own org (scopes qauth:org:read,
// qauth:org:members, qauth:org:roles, qauth:org:audit; never settings, security,
// company sign-in, keys or the admin role)
await qauth.withKey(orgApiKey).org(orgId).members.list();

// On YOUR API: check a key one of your customers' systems sent you
const check = await qauth.validateKey(presentedKey, { app: appId });
if (!check.valid) { /* 401 */ }
```

## Who may do what

- Only **members** of an organization can reach it; for anyone else qAuth answers
  "not found" (an admin of another organization, a person of another tenant).
- **Admins** manage the organization: settings, security, domains, API keys, the
  audit log, and people of any role.
- **Managers** manage people and the org's roles, but never the admin role (they
  cannot make anyone admin, nor change or remove an admin).
- **Members** read the organization, its apps and its domains.

Every change is recorded in your tenant's audit log with the person as the actor,
and your Automation rules see it like a change made in the qAuth Console.

## The proxy for the ready-made screens

`@isdlc.ai/qauth-screens` (members, invitations, roles, company sign-in, my account) call
YOUR backend, which forwards to qAuth with the person's token from your session:

```ts
import { qauthProxy } from "@isdlc.ai/qauth";
const proxy = qauthProxy({ baseUrl: process.env.QAUTH_URL!, mount: "/qauth",
  accessToken: async (req) => (await getSession(req))?.accessToken ?? null });
// Next.js: app/qauth/[...path]/route.ts
export const GET = proxy, POST = proxy, PUT = proxy, DELETE = proxy;
```

It passes only `/v1/me/*` and `/v1/orgs/*`, refuses `..` and encoded slashes, needs the header
`x-qauth-request: 1` on every change (CSRF), and never forwards cookies.

## Confirm an action with a code (action verification)

For a sensitive action in your app, such as a transfer, send a one-time code to the signed-in person's own phone or email (or ask for their authenticator app), on a template your tenant defined in the Console:

```ts
// in the app, signed in
const v = await qauth.as(token).verifications.start("Money transfer", { amount: "500", currency: "SAR" });
// show v.sentTo ("+966•••••5678") and a code box
const r = await qauth.as(token).verifications.check(v.requestId, code); // { status: "verified" }

// your backend, before moving the money
await qauth.as(token).verifications.consume(v.requestId, {
  template: "Money transfer",
  variables: { amount: "500", currency: "SAR" }, // exactly the values verified
}); // throws (409) unless verified by this person for these values, and never used before
```

The code always goes to the account's own verified phone or email; you can't choose the destination. Whether an action needs a new code each time is your app's choice.

## Step-up (confirm it's them before a sensitive action)

Switch on **Step-up** for the app (Console › app › Sign-in). Then, before a
sensitive action, send the person through sign-in again with `max_age=0`;
qAuth asks for a fresh second step (a remembered device doesn't count, and
someone with no second step sets one up).

```ts
import { stepUpParams, isFreshStepUp } from "@isdlc.ai/qauth";

const startedAt = new Date();               // keep it in your session
// redirect to your usual authorize URL, adding stepUpParams ({ max_age: "0" })
// … back on your callback, with the NEW access token:
const last = await qauth.as(newAccessToken).account.lastStepUp(clientId);
if (isFreshStepUp(last, startedAt)) { /* allow the action */ }
```

The record is kept per person and client, not per browser session, so
always compare it with your own `startedAt` and keep the window short.

## Idle sign-out (session rules)

An app's Sign-in settings can end sessions after so long idle and after a maximum length
(an organization can only make them stricter). qAuth ends sessions on time even when the
app is closed, and refuses to refresh an ended session; access tokens live 15 minutes, so
an ended session stops working within that.

Your screen's half, without the ready-made screens:

```ts
import { QAuth, watchIdle, sessionIdOf } from "@isdlc.ai/qauth";

const sid = sessionIdOf(idToken);
const me = new QAuth({ baseUrl }).as(accessToken).account; // server side, or call your proxy
const watch = watchIdle({
  sessionId: sid,
  source: { state: () => me.sessions.state(sid), activity: () => me.sessions.activity(sid) },
  onWarn: ({ reason, secondsLeft }) => showCountdown(reason, secondsLeft), // reason: idle | max_length
  onActive: () => hideCountdown(),
  onEnded: (reason) => signOutLocally(reason), // signed_out | idle | max_length
});
// "Stay signed in" → watch.stillHere()
```

Activity is shared by every tab of the session; times are seconds left, so a wrong device
clock doesn't matter. `@isdlc.ai/qauth-screens` has it ready as `<IdleWarning>`.

## Errors

Every refusal is a `QAuthError` with:

- `status`: the HTTP status (`0` when qAuth could not be reached or did not answer in time: code `UNAVAILABLE`, with `cause`);
- `code`: stable (`UNAUTHORIZED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`…,
  and the token codes above);
- `message`: plain words you can show;
- `requestId`: qAuth's request id, for support;
- `retryAfter`: seconds to wait before trying again, when qAuth says so (429 and 503 with `Retry-After`);
- `fields`: per-field problems on a `VALIDATION_ERROR`.

qAuth calls never follow redirects (a redirect would carry the token or API key to another host): a 3xx is
`UNEXPECTED_REDIRECT`. An empty, `.` or `..` id is refused before anything is sent (400 `VALIDATION_ERROR`).

List answers carry `pagination` as qAuth sends it: `page`, `limit`, `total`, `total_pages`, `has_next`,
`has_previous` (`totalPages` is kept as a deprecated copy of `total_pages`).

`parseRetryAfter(header)` turns a `Retry-After` value (seconds or an HTTP date) into seconds, if you call
qAuth yourself.

```ts
try {
  await org.members.add({ email: "x@shop.com", role: "admin" });
} catch (e) {
  if (e instanceof QAuthError && e.status === 403) { /* not allowed */ }
}
```

## Not in this version

A "this device" marker in the session list (tokens don't name their session).

## Changes

- **0.22.0** (2026-11-26): child organizations from the parent. `subOrgs.create` takes `externalId` and
  `{ idempotencyKey }` (a retry answers the same child; another request with the key is 409); `org(child).rename`,
  `setExternalId` and `setLevels` (a direct child, from its parent: `org.suborgs.manage` / `org.suborgs.create`, or the
  parent's key with the new scope `qauth:org:suborgs`).
- **0.21.0** (2026-11-25): `devices.list` marks `current` only for the `session` you pass (no guessing);
  `devices.signOutAll` takes `session` and answers 400 unless your device is named (`session`/`keep`) or `includeCurrent`.
- **0.20.0** (2026-11-25): the audit log. `AuditEntry` gains its own id (`uid`), who (`actorType`, `actorDisplay`, `actingOrgId`), what
  (`targetType`, `targetName`, `changes` before/after), the result (`result`, `reason`), where (`ip`, `userAgent`,
  `requestId`) and its place in the chain (`seq`, `hash`); `org.audit()` takes the audit log's filters (`AuditQuery`:
  `type`, `group`, `actor`, `target`, `result`, `app`, `ip`, `request`, `from`, `to`); `account.activity()` reads the
  person's own recent activity. Additions only.
- **0.19.0** (2026-11-25): `me.account.devices.signOutAll` keeps the calling device unless `includeCurrent`; `list`
  marks `current` from `session` (your ID token's sid), else your token's client's most recently active session.
  `SessionSettings.idleByType` and `OrgSessionSettings.idleByType` (idle per device type; TVs never idle by default).
- **0.18.0** (2026-11-25): sessions and devices. `me.account.devices`: `list({ app })` (every device with the counts
  against the app's limits; `current` marks this one), `update(id, { name, shared })`, `signOut(id)`,
  `signOutAll({ type, app, keep })`, `pairingCode(appId, { clientId })` (Add a device; needs a recent sign-in),
  `lookup(code)` (place, `choices` for number matching, `otherNetwork`) and `approve(code, { number, confirmPlace,
  signOut, clientId })` / `deny(code)` (409 `CONFIRM_PLACE`, 409 `SESSION_LIMIT` with the sessions in `error.data`,
  403 `FRESH_SIGN_IN_REQUIRED`).
  `org.members.devices / endDevice / endDevices` (admins), `org.sessionSettings.get / set` (stricter only).
  Device side: `startDeviceSignIn` (with `matchNumber` to show), `pollDeviceToken`, `pairDevice`. `QAuthError.data`.
- **0.17.0** (2026-11-25): child organizations. `org.subOrgs.list()` and
  `org.subOrgs.create({ name, adminEmail, levels, isolatedDirectory, levelId, invite })`: the first admin may be
  anyone, you too (an existing account is added as it is; a new one is emailed, no password comes back).
  `org.members.resetPassword(userId, { password, changeRequired })` (your own organization). A parent organization
  never manages a child's people: it sees them read-only, and adding, removing, resetting or giving roles there
  answers 403. `org.newAdmin` is deprecated (your tenant sets a new admin). `RoleSpec.levelId` and
  `AppRole.levelId`; `Org` gains `parentOrgId`, `levelId`, `levelName`, `externalId`, `isInternal`. Types
  `NewSubOrg`, `CreatedSubOrg`, `PasswordReset`. Additions only.
- **0.16.0** (2026-11-24): levels per product. `MyOrg` gains `parentOrgId`, `levelName`, `isInternal` and
  `levels` (API id -> your tenant's levels there, top first); `GivableRole` gains `levelId`, `levelName`,
  `builtIn` and `reason`; `org.levels()` and `org.newAdmin(email)` (a child's direct parent sets its new admin:
  an existing member gets the roles, anyone else is invited by email; never a password). Types `LevelRef`,
  `OrgLevels`, `NewAdminResult`. Additions only.
- **0.15.0** (2026-11-24): `org.branding` (`get`, `set`, `remove`: the white-label look, as the Go SDK has) and
  `org.design` (`get`, `set`, `reset`, `addPicture`): the organization's sign-in page design with its layout (simple
  or split, form at the start or end), form-side settings, side-panel blocks and the platform's limits. Types
  `Branding`, `BrandingSpec`, `Design`, `DesignBlock`, `DesignView`, `DesignFile`.
- **0.14.0** (2026-11-24): `new QAuth({ issuer, clientId, apiKey? })`: set up from your tenant's issuer and your
  app's client id alone. qAuth's API address is read once from the issuer's discovery document (`qauth_api`; the
  document must name the issuer, the address must be https://, http:// only on localhost; redirects never followed;
  a failed read is tried again after `discoveryRetrySeconds`, default 5), and a `Verifier` for that issuer and client
  is built and used by `permissions()`/`can()`/`orgs()` (`qauth.verifier`, `qauth.verify()`, `qauth.authenticate()`,
  `qauth.middleware()`). `apiKey` + `qauth.org(id)` (or `withKey()` without an argument) for machine calls;
  `qauth.apiUrl()`. The API address is pinned: `qauth_api` must be a trusted qAuth host (`DEFAULT_TRUSTED_API_HOSTS`:
  auth.qapps.dev; `trustedApiHosts` for staging or your own qAuth; otherwise `UNTRUSTED_API`). Needs a qAuth server with `qauth_api` in discovery (otherwise set `baseUrl`). Nothing removed:
  `new QAuth({ baseUrl })` works as before.
- **0.13.0** (2026-11-24): backends. `Verifier` (offline access-token check: issuers, clientIds, audience, leeway,
  discovery and key rotation), `verifier.middleware()` for Express/Connect, `verifier.authenticate(request)` +
  `errorResponse(e)` for fetch-style handlers, `identityOf`, `bearerToken`, `verifier.reset()`. `qauth.can()`, `qauth.permissions()`,
  `qauth.orgs()`, `qauth.forget()` with a per-person cache (`permissionsCacheSeconds`, default 60; `verifier` option).
  `validateKey` cache (`keyCacheSeconds`, default 0 = live as before) and `forgetKeys()`. `QAuthError` gains
  `retryAfter` (and `parseRetryAfter`); a network failure or timeout is now a `QAuthError` (status 0, `UNAVAILABLE`) instead of a raw
  fetch error. The Verifier takes only access tokens (`client_id` required; ID tokens refused: `NOT_ACCESS_TOKEN`);
  https:// issuers and keys only (http:// on localhost); a 5 s backoff after a failed key fetch. qAuth calls never
  follow redirects (`UNEXPECTED_REDIRECT`); empty / `.` / `..` ids are refused before sending. `Pagination` now types
  what qAuth sends (`total_pages`, `has_next`, `has_previous`); `totalPages` was never filled before and is now a
  deprecated copy of `total_pages`.
  **Node 20+** (was 18): token verification needs WebCrypto, and so does `validateKey`, which now hashes keys
  with it for its cache. New dependency `jose`. Nothing removed or renamed.
- **0.11.0** (2026-11-23): personal access tokens. `as(token).tokens.choices(orgId)`, `.create({ orgId, name,
  permissions, expiresAt })`, `.list()`, `.revoke(id)`. A token is checked like an API key (`kind: "pat"`) and never
  holds more than its person does at that moment. Nothing removed.
- **0.10.0** (2026-11-23): API keys hold permissions. `apiKeys.create({ permissions, expiresAt })`; `validateKey`
  answers `permissions` (API id → permission keys, live), `owner` (organization or the tenant) and `kind`; helper
  `keyMay(check, apiId, "records:read")`. Older keys (`scopes`, `apps`) keep working. Nothing removed.
- **0.9.0** (2026-11-22): roles from every space. `org.givableRoles()`, `org.members.setRoles()`, `roleIds` on
  `members.add` and `invitations.create`, `roles` on members. The one-word `role` / `setRole` still work
  (deprecated). Nothing removed.
