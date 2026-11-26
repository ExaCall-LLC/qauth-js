# @isdlc.ai/qauth-screens

Ready-made qAuth screens to put inside your product, so your customers' people manage
their account and their organization without ever seeing qAuth:

- `<MyAccount />`: password, authenticator app (QR code), phone (SMS / call), recovery
  codes, where you're signed in (sign out one device, or everywhere);
- `<OrgMembers orgId />`: people (role, remove) and invitations (invite, resend, withdraw);
- `<OrgRoles orgId appId />`: an app's roles in the organization (the app's own and the
  organization's), and who holds which;
- `<OrgCompanySignIn orgId />`: the organization's company sign-in (OpenID Connect);
- `<ConfirmAction template variables onVerified />`: confirm a sensitive action with a
  one-time code sent to the person's own phone or email (or their authenticator app):
  where it went, the code box, send again, call me instead. `onVerified(requestId)` gives
  you the request id; your backend then consumes it with the same values before acting
  (`qauth.as(token).verifications.consume(...)` in `@isdlc.ai/qauth`).

English and Arabic (right-to-left). Built on `@isdlc.ai/ui`.

## Install

The screens' peer dependencies (`@isdlc.ai/ui`, `@isdlc.ai/react-i18n`, `@isdlc.ai/tokens`) are on the
`@isdlc.ai` registry only, so the app needs that registry (token in your user `~/.npmrc`):

```bash
npm config set @isdlc.ai:registry https://git.qapps.dev/api/packages/isdlc/npm/
npm install @isdlc.ai/qauth @isdlc.ai/qauth-screens
```

The package itself is also a public release of
[github.com/ExaCall-LLC/qauth-js](https://github.com/ExaCall-LLC/qauth-js/releases) (MIT): tag
`qauth-screens-vX.Y.Z`, file `isdlc.ai-qauth-screens-X.Y.Z.tgz`, e.g.
`https://github.com/ExaCall-LLC/qauth-js/releases/download/qauth-screens-v0.9.1/isdlc.ai-qauth-screens-0.9.1.tgz`.

## 1. Your backend: mount the proxy

The screens call your own backend, which forwards to qAuth with the signed-in person's
token from your session (`@isdlc.ai/qauth`):

```ts
import { qauthProxy } from "@isdlc.ai/qauth";
const proxy = qauthProxy({ baseUrl: process.env.QAUTH_URL!, mount: "/qauth",
  accessToken: async (req) => (await getSession(req))?.accessToken ?? null });
// Next.js: app/qauth/[...path]/route.ts
export const GET = proxy, POST = proxy, PUT = proxy, DELETE = proxy;
```

## 2. Your app: show the screens

```tsx
import { QAuthScreens, MyAccount, OrgMembers } from "@isdlc.ai/qauth-screens";
import "@isdlc.ai/ui/styles.css"; // with your @isdlc.ai/tokens theme

<QAuthScreens basePath="/qauth" locale="ar">
  <MyAccount />
  <OrgMembers orgId={currentOrg.id} />
</QAuthScreens>
```

```tsx
<ConfirmAction template="Money transfer" variables={{ amount: "500", currency: "SAR" }}
  summary="500 SAR to Hesham" onVerified={(id) => submitTransfer({ verification: id })} />
```

Idle sign-out: put `<IdleWarning>` once in your signed-in layout. It counts the person's
activity (across every tab of the session), reports it to qAuth at most once a minute, and
warns with a countdown before the session ends ("Stay signed in" keeps it). qAuth ends the
session on time even when the app is closed; the rules (idle time, maximum length) are the
app's Sign-in settings, made stricter per organization.

```tsx
import { sessionIdOf } from "@isdlc.ai/qauth";

<IdleWarning sessionId={sessionIdOf(idToken)} onEnded={() => signOutLocally()} onSignOut={() => signOut()} />
```

What each person can do is decided by qAuth (admins, managers, members), so the same
screen shows refusals as messages; show the org screens to the roles that use them.
Change any text with `messages={{ "account.title": "Security" }}`.

## Changes

- **0.9.1** (2026-11-26): `<OrgCompanySignIn>`: a "Public client (PKCE, no secret)" choice (no secret asked when ticked)
  and a warning listing the organization's apps in another directory, which company sign-in does not cover.
- **0.9.0** (2026-11-25): `<MyDevices session={sid} />`: pass your ID token's sid so this device is marked and stays
  signed in when signing out all TVs (without it, "Sign out all TVs" signs out every TV).
- **0.8.0** (2026-11-25): `RecentActivity` (My account › Security › Recent activity: the person's own sign-ins,
  refused attempts and security changes, from `GET /v1/me/activity`), part of `MyAccount`. English and Arabic.
- **0.7.1** (2026-11-25): counted words read right ("1 device", Arabic singular, dual and plural forms).
- **0.7.0** (2026-11-25): `<MyDevices />` (My account › Devices: every device with the counts against the app's
  limits, rename, mark shared, sign out one or all TVs, Add a device with a pairing code) and
  `<DeviceApproval code? clientId? />` (approve a TV's code from your app: the place first, the device's own name
  labelled, a warning on another network with a confirmation, number matching; at the limit the person picks a device
  to sign out). `ScreenError.data`. Needs a qAuth server with the 0.18 routes (`/v1/me/devices`).
- **0.6.1** (2026-11-24): works with `@isdlc.ai/qauth` 0.9 up to any 0.x (was 0.9.x only on npm's 0.x rules),
  including 0.13. No code change.
- **0.6.0** (2026-11-23): `MyAccount` gains "Personal access tokens" (also `<MyTokens />` alone): make a token from
  your own permissions (grouped; a group ticks all), choose when it expires, see and revoke your tokens.
- **0.5.0** (2026-11-22): `OrgMembers` shows every role a person holds (from every space), Edit roles uses
  qAuth's "can give" answer (roles you can't give are greyed out with the reason), invitations carry roles.
  Needs `@isdlc.ai/qauth` 0.9 and a qAuth server with `/givable-roles` (live on staging since 2026-11-19).
