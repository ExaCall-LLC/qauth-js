/**
 * @isdlc.ai/qauth — server-side SDK for products that use qAuth.
 *
 * Your product's BACKEND calls qAuth on behalf of the signed-in person,
 * with that person's own access token. Every call is that person acting,
 * with exactly the rights they have:
 *
 *   const qauth = new QAuth({ issuer: "https://acme.qapps.dev", clientId: "web-client-id" });
 *   const who = await qauth.verify(accessToken); // offline token check (Identity)
 *   const me = qauth.as(accessToken);          // the signed-in person
 *   await me.profile();                        // who they are + their orgs
 *   const org = me.org(orgId);                 // one of their organizations
 *   await org.members.list();
 *   await org.members.add({ email: "sara@shop.com", role: "manager", invite: true });
 *
 * qAuth's API address comes from the issuer's discovery document
 * (`qauth_api`); `baseUrl` sets it by hand instead (older qAuth servers,
 * local development without the edge).
 *
 * Only members of an organization can reach it (anyone else gets
 * "not found"). Inside it: admins manage the org; managers manage people
 * (never the admin role); members read.
 *
 * Never call qAuth from a browser with this SDK: tokens and API keys stay
 * on your server. Node 20+ (or any runtime with fetch and WebCrypto).
 */

export type Role = "admin" | "manager" | "member";

/** Paging of a list answer, as qAuth sends it. */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  /** @deprecated qAuth sends `total_pages`; this copy of it is kept for older code. */
  totalPages: number;
}

/** A list answer: the items plus paging (stable from v1). */
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

export interface MyOrg {
  id: string;
  name: string;
  role: Role;
  /** The parent organization (absent: a top organization). */
  parentOrgId?: string;
  /** The organization's tenant level name, if it has one. */
  levelName?: string;
  /** Your tenant's own organization. */
  isInternal: boolean;
  /**
   * Its levels in each API (API id -> levels, top first): your tenant's
   * level names. Empty: no levels (everything works as without levels).
   */
  levels: Record<string, LevelRef[]>;
}

/** One level of your tenant (Operator, Provider, Customer…). */
export interface LevelRef {
  id: string;
  name: string;
}

/** What setting a child's new admin did (never a password). */
export interface NewAdminResult {
  /** An existing member who got the admin roles. */
  userId?: string;
  /** An invitation went to the email. */
  invited: boolean;
  invitationId?: string;
}

/** An organization's levels in each API (API id -> level ids). */
export interface OrgLevels {
  orgId: string;
  levels: Record<string, string[]>;
}

export interface Profile {
  id: string;
  login: string;
  name?: string;
  email?: string;
  orgs: MyOrg[];
}

export interface Org {
  id: string;
  tenantId: string;
  name: string;
  /** A second sign-in step for this org's people in every app (stricter only). */
  mfaRequired: boolean;
  /** Its managed people may also join other organizations. */
  membersMayJoinOthers: boolean;
  /** Your own id for it, if set. */
  externalId?: string;
  /** The parent organization (absent: a top organization). */
  parentOrgId?: string;
  /** Its single level label, if it has one. */
  levelId?: string;
  levelName?: string;
  /** Your tenant's own organization. */
  isInternal?: boolean;
  createdAt: string;
}

/** A new child organization (`org.subOrgs.create`). */
export interface NewSubOrg {
  name: string;
  /**
   * Its first admin: anyone, you or someone of your organization too. An
   * existing account is added as it is; a new one gets its sign-in details
   * by email (never in the answer to an organization).
   */
  adminEmail: string;
  /**
   * Levels per API (API id -> level ids), each directly below one of the
   * parent's levels there. Left out: in each API, the level directly below
   * the parent's lowest level that has one below it.
   */
  levels?: Record<string, string[]>;
  /** Its own new account pool (white label); otherwise the parent's. */
  isolatedDirectory?: boolean;
  /** Your own id for it (optional): unique in your tenant, at most 200 characters. */
  externalId?: string;
  /** Its single level label (optional). */
  levelId?: string;
  /**
   * Email the first admin (a new account's one-time password goes in the
   * email). Always on for a new account when an organization creates its
   * child: it never sees a password. Your tenant needs a default email channel.
   */
  invite?: boolean;
}

/** A child organization just created. */
export interface CreatedSubOrg {
  org: Org;
  /** Only for your tenant's own admins, when the account was new and not emailed: show once. Never from a parent. */
  initialAdminPassword?: string;
  /** The email already had an account in the pool: it was reused. */
  adminExisting: boolean;
  /** The first admin was emailed. */
  invited?: boolean;
}

/** A member's password reset: `updated`; `emailed` is always false (kept for compatibility). */
export interface PasswordReset {
  updated: boolean;
  emailed: boolean;
}

/** One role a person holds in an organization, from any space. */
export interface MemberRole {
  id: string;
  name: string;
  /** "organization" (running the organization) or an API app's id. */
  space: string;
  spaceName: string;
}

/** A role of the organization and whether the caller may give it (decided by qAuth). */
export interface GivableRole {
  id: string;
  name: string;
  description?: string;
  /** "organization" or an API app's id. */
  space: string;
  spaceName: string;
  /** A starter role every organization gets. */
  starter?: boolean;
  /** This organization's own role. */
  own?: boolean;
  /** What it lets people do, as names. */
  orgPermissions: string[];
  permissions: string[];
  canGive: boolean;
  /** Why it can't be given: what the caller lacks (names). */
  missing?: string[];
  /** The role's level (absent: floating) and its name. */
  levelId?: string;
  levelName?: string;
  /** The level's built-in Admin (always every permission of that level). */
  builtIn?: boolean;
  /** Why it can't be given here: the organization lacks its level for that API. */
  reason?: string;
}

export interface Member {
  id: string;
  login: string;
  name?: string;
  email?: string;
  /** @deprecated One-word summary kept for older apps; use `roles`. */
  role: Role;
  /** Every role the person holds here, from every space. */
  roles?: MemberRole[];
  /** The organization permissions those roles add up to (keys). */
  orgPermissions?: string[];
  /** A managed account (its email is at a domain the org verified). */
  managed: boolean;
  managedBy?: string;
  [k: string]: unknown;
}

export interface NewMember {
  email: string;
  givenName?: string;
  familyName?: string;
  /** @deprecated Use `roleIds`. Default "member". */
  role?: Role;
  /** Roles to give at once (ids from `givableRoles()`); you can't give more than you hold. */
  roleIds?: string[];
  /** Email the person through your tenant's own email channel. */
  invite?: boolean;
}

export interface AddedMember {
  user: { id: string; login: string; email?: string };
  /** Set only when a NEW account was created and invite was false: show it once. */
  initialPassword?: string;
  /** The email already had an account in the directory: it was reused. */
  existing: boolean;
  /** An invitation email went out through your channel. */
  invited?: boolean;
}

/** An organization's white-label sign-in look (logo, colours, light or dark, language) and its design. */
export interface Branding {
  appId?: string;
  orgId?: string;
  displayName?: string;
  accent: string;
  background: string;
  mode: "auto" | "light" | "dark";
  language: "auto" | "en" | "ar";
  hasLogo: boolean;
  logoUrl?: string;
  design: Design;
  updatedAt?: string;
}

/** Changes a look. `logo` is base64 (PNG, JPEG or WebP); empty colours inherit; no `design` keeps the saved one. */
export interface BrandingSpec {
  displayName?: string;
  logo?: string;
  removeLogo?: boolean;
  accent?: string;
  /** The page background, #rrggbb. */
  background?: string;
  mode?: "auto" | "light" | "dark";
  language?: "auto" | "en" | "ar";
  design?: Design;
}

/** A text in English and Arabic (plain text). */
export interface I18nText {
  en: string;
  ar: string;
}

/**
 * A side-panel block: heading (text, size, align, color), text (text, align,
 * color), image (image = a picture's hash, alt, width, align), list (items,
 * color), link (label, url: https only, style link|filled|outline, align) or
 * spacer (size). `id` is the block's own.
 */
export interface DesignBlock {
  id: string;
  type: "heading" | "text" | "image" | "list" | "link" | "spacer";
  text?: I18nText;
  size?: "s" | "m" | "l";
  align?: "start" | "center" | "end";
  color?: string;
  image?: string;
  alt?: I18nText;
  width?: number;
  items?: { en: string[]; ar: string[] };
  label?: I18nText;
  url?: string;
  style?: "link" | "filled" | "outline";
}

/** A sign-in look's layout, form-side settings and side panel. Empty values inherit. */
export interface Design {
  layout?: "simple" | "split";
  /** Logical: mirrors in Arabic. */
  formSide?: "start" | "end";
  /** The form side's colour, #rrggbb. */
  panelBackground?: string;
  text?: string;
  corners?: "sharp" | "soft" | "round";
  button?: "filled" | "outline";
  /** One of `DesignView.limits.fonts`. */
  font?: string;
  securedBy?: boolean;
  /** The sign-in step's own title and subtitle (empty = qAuth's words). */
  texts?: { en: { title: string; subtitle: string }; ar: { title: string; subtitle: string } };
  panel?: {
    background: { kind: "color" | "gradient" | "image"; color?: string; from?: string; to?: string; angle?: number; image?: string; overlay?: string; overlayOpacity?: number };
    blocks: DesignBlock[];
  };
  phone?: "hidden" | "banner";
}

/** An organization's look as qAuth answers it: its own, what it inherits, the platform's limits. */
export interface DesignView {
  level: "tenant" | "app" | "org";
  own: boolean;
  look: Branding;
  inherited: Branding;
  inheritedFrom: { level: "builtin" | "tenant" | "app" | "org"; id?: string; name?: string };
  limits: { fonts: string[]; logoMaxKb: number; imageMaxKb: number; maxBlocks: number; shortTextMax: number; longTextMax: number; listItemsMax: number };
  name?: string;
}

/** A picture kept for designs; designs name it by `hash`. */
export interface DesignFile {
  hash: string;
  contentType: string;
  size: number;
}

export interface OrgDomain {
  id: string;
  orgId: string;
  domain: string;
  /** Put this value in a TXT record at _qauth-verify.<domain>, then call verify(). */
  token: string;
  /** Set once the TXT record was found. */
  verifiedAt?: string;
  createdAt: string;
}

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  /** @deprecated Use `roleIds`. */
  role: Role;
  /** Roles the person gets on accepting. */
  roleIds?: string[];
  appId?: string;
  returnUrl?: string;
  status: "pending" | "accepted" | "revoked" | "locked";
  /** Pending but past its 7 days: resend it. */
  expired: boolean;
  invitedBy: string;
  invitedByName?: string;
  createdAt: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface NewInvitation {
  email: string;
  /** @deprecated Use `roleIds`. Default "member". */
  role?: Role;
  /** Roles the person gets on accepting (ids from `givableRoles()`); checked now, given then. */
  roleIds?: string[];
  /** The app they are invited to (shown on qAuth's page). */
  appId?: string;
  /** "Continue" after accepting; must be on one of the app's own addresses. */
  returnUrl?: string;
  /**
   * Default true: qAuth emails the link through your tenant's email channel.
   * false: deliver it yourself; acceptUrl comes back once.
   */
  send?: boolean;
}

export interface SentInvitation {
  invitation: Invitation;
  sent: boolean;
  /** Only with send=false. Shown once; whoever has it can accept. */
  acceptUrl?: string;
}

export interface SSOConnection {
  orgId: string;
  kind: "oidc";
  displayName: string;
  issuer: string;
  clientId: string;
  mode: "optional" | "required";
  /** The client secret is stored by qAuth's engine and never returned. */
  secretSet: boolean;
  /** A public client (PKCE, no secret), e.g. another qAuth tenant's web client. */
  publicClient?: boolean;
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSOState {
  connected: boolean;
  /** Register this redirect address at the company's provider. */
  callbackUrl: string;
  connection?: SSOConnection;
  /** Apps the organization can use that sign in from another directory: company sign-in does not cover them. */
  otherDirectoryApps?: SSOOtherApp[];
}

/** An app the organization can use whose people sign in from another directory. */
export interface SSOOtherApp {
  id: string;
  name: string;
  directoryId: string;
  directoryName: string;
}

export interface SSOSpec {
  /** What people see, e.g. "Contoso account". */
  displayName: string;
  /** e.g. https://login.microsoftonline.com/<tenant id>/v2.0 */
  issuer: string;
  clientId: string;
  /** Required the first time (unless a public client); omit to keep the stored one. */
  clientSecret?: string;
  /**
   * A public client (PKCE, no secret). Also assumed when no secret is given
   * to a qAuth issuer (its discovery serves qauth_api and takes token auth
   * method "none"); never for another provider.
   */
  publicClient?: boolean;
  /** optional (default): a button; required: no password sign-in or reset. */
  mode?: "optional" | "required";
}

/** What to publish to prove the org owns the domain. */
export interface AddedDomain {
  domain: OrgDomain;
  /** The DNS name of the TXT record: _qauth-verify.<domain>. Its value is domain.token. */
  record: string;
  /** The TXT record's name (same as record). */
  txtName?: string;
  /** The TXT record's value (same as domain.token). */
  txtValue?: string;
}

export interface ApiKey {
  id: string;
  /** "" for the tenant's own keys. */
  orgId: string;
  kind?: "m2m" | "pat";
  /** A personal token's person. */
  userId?: string;
  /** API permission ids the key may use. */
  permissions?: string[];
  name: string;
  /** The first characters, to recognise a key. */
  prefix: string;
  scopes: string[];
  apps: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface NewApiKey {
  name: string;
  /** API permission ids the key may use (never more than you hold; only the organization's own levels' and floating ones). */
  permissions?: string[];
  /**
   * qAuth's organization-API scopes (qauth:org:*). A key with only scopes (no
   * permission) is for qAuth's organization routes: no API accepts it
   * (/auth/validate answers 401).
   */
  scopes?: string[];
  /** App ids the key is for; the org must be able to use each of them. */
  apps?: string[];
  expiresAt?: string;
}

/** One API's permissions a person may put in a personal token. */
export interface TokenChoice {
  apiId: string;
  apiName: string;
  permissions: Permission[];
}

export interface NewPersonalToken {
  orgId: string;
  name: string;
  /** Permission ids from tokens.choices(); only ones the person holds. */
  permissions: string[];
  expiresAt?: string;
}

export interface MintedApiKey {
  key: ApiKey;
  /** The key itself. Shown ONCE: hand it over now, qAuth keeps only a hash. */
  secret: string;
}

export interface App {
  id: string;
  name: string;
  [k: string]: unknown;
}

export interface Permission {
  id: string;
  key: string;
  name: string;
  group?: string;
  [k: string]: unknown;
}

export interface OrgPermission {
  key: string;
  name: string;
  group: string;
}

export interface AppRole {
  id: string;
  appId: string;
  /** Empty for the app's built-in roles; the org's id for its own roles. */
  orgId?: string;
  name: string;
  description: string;
  /** Permission ids of the app. */
  permissions: string[];
  /** Organization-management permission keys granted alongside the app role. */
  orgPermissions?: string[];
  /** Its level (absent: a floating role). */
  levelId?: string;
  createdAt: string;
}

export interface RoleSpec {
  name: string;
  description?: string;
  /** Permission ids of the app. */
  permissions: string[];
  /** Optional qAuth organization-management permission keys. */
  orgPermissions?: string[];
  /**
   * Its level (your tenant's level id): it holds only that level's
   * permissions plus floating ones, and is given only where the organization
   * has the level. Left out: a floating role (floating permissions only).
   */
  levelId?: string;
}

export interface PersonRoles {
  userId: string;
  login: string;
  name?: string;
  roleIds: string[];
}

export interface AuditEntry {
  id: number;
  type: string;
  actor?: string;
  actorName?: string;
  /** person, api_key, platform_admin, setup_key or system. */
  actorType?: string;
  /** The actor's name at the time (email, key name). */
  actorDisplay?: string;
  /** The organization through which a parent acted on a child organization. */
  actingOrgId?: string;
  targetType?: string;
  target?: string;
  targetName?: string;
  /** success, refused or failed. */
  result?: "success" | "refused" | "failed";
  /** Why it was refused or failed (a short code). */
  reason?: string;
  /** The fields a change touched, before and after (secrets redacted). */
  changes?: Record<string, { before: unknown; after: unknown }>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  orgId?: string;
  appId?: string;
  at: string;
  /** The event's place in the log's hash chain. */
  seq?: number;
  hash?: string;
  /** The event's own id (unique; not part of the hash). */
  uid?: string;
  [k: string]: unknown;
}

/** The audit log's filters (the same on every audit list). */
export interface AuditQuery {
  limit?: number;
  /** An event id: events older than it (the next page). */
  before?: number;
  /** Event types starting with this, e.g. "signin.". */
  type?: string;
  /** Prefixes, comma-separated (a type group). */
  group?: string;
  /** An id, or part of a name or email. */
  actor?: string;
  target?: string;
  result?: "success" | "refused" | "failed";
  app?: string;
  ip?: string;
  /** A request id (X-Request-ID). */
  request?: string;
  /** RFC 3339 time or YYYY-MM-DD. */
  from?: string;
  to?: string;
}

export interface Effective {
  app: string;
  org: string;
  roles: string[];
  permissions: string[];
  orgPermissions?: string[];
}

/** The person's account page. */
export interface MySecurity {
  email: string;
  hasPassword: boolean;
  /** Signs in with the company account only (no password or factors here). */
  companyManaged: boolean;
  authenticator: boolean;
  /** Masked, when a verified phone is set. */
  phone?: string;
  /** Unused recovery codes left. */
  recoveryCodes: number;
  /** Passkeys (created on the sign-in page after a second step). */
  passkeys: { id: string; name: string }[];
  /** What the person's organization offers. */
  offered: { authenticator: boolean; phone: boolean };
}

/** A fresh proof that it is the person: their password, or an authenticator code. */
export type Proof = { password: string } | { code: string };

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsed: string;
  /** The browser or app, as it described itself. */
  device?: string;
  ip?: string;
}

import type { SessionState } from "./idle.js";
import { QAuthError, parseRetryAfter } from "./errors.js";
import { TtlCache } from "./cache.js";
import { Verifier, secureUrl, type ConnectMiddleware, type Identity } from "./verify.js";

export { QAuthError };

export interface QAuthOptions {
  /**
   * Your tenant's issuer, e.g. https://acme.qapps.dev (with `clientId`): qAuth's
   * API address is read once from its discovery document (`qauth_api`), and a
   * token Verifier for this issuer and client is built for you.
   */
  issuer?: string;
  /** Your app's client id: the tokens `verify()` accepts (with `issuer`). */
  clientId?: string;
  /** An organization's API key (qak_...) for machine calls: `org(id)` and `withKey()` use it. */
  apiKey?: string;
  /**
   * qAuth's address by hand, e.g. https://auth.example.com (instead of reading
   * it from the issuer's discovery; older qAuth servers, local development).
   */
  baseUrl?: string;
  /** Your own fetch (tests, proxies). Default: the global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
  /**
   * How long `permissions()` / `can()` / `orgs()` keep an answer, per person,
   * app and organization (seconds). Default 60; 0 = always ask qAuth.
   */
  permissionsCacheSeconds?: number;
  /**
   * How long `validateKey()` keeps an answer (seconds). Default 0: every
   * check asks qAuth, so a revoked key stops at once. 30 is a good value for
   * busy APIs (a revoked key then works for up to 30 s more).
   */
  keyCacheSeconds?: number;
  /**
   * A token Verifier: `permissions()`, `can()` and `orgs()` given a raw token
   * verify it offline first and cache per person (`sub`). Without one, a raw
   * token's answers are cached per token.
   */
  verifier?: Verifier;
  /**
   * The qAuth API hosts (host[:port]) a discovery document may name as
   * `qauth_api`. Default `DEFAULT_TRUSTED_API_HOSTS` (auth.qapps.dev). The issuer
   * is the trust root for tokens only: an issuer naming any other API address is
   * refused, so a tenant's DNS can't send your tokens and keys elsewhere. Your
   * own qAuth (staging, self-hosted): add its host here, or set `baseUrl`.
   */
  trustedApiHosts?: string[];
  /** After a failed discovery read, the next call waits this long before reading again (seconds). Default 5. */
  discoveryRetrySeconds?: number;
  /** The current time in ms (tests). */
  now?: () => number;
}

/** The qAuth API hosts trusted by default as an issuer's `qauth_api`. */
export const DEFAULT_TRUSTED_API_HOSTS: readonly string[] = ["auth.qapps.dev"];

/** qAuth's API address: fixed, or read from the issuer's discovery. */
type Base = string | (() => Promise<string>);

type Query = Record<string, string | number | undefined>;

class Transport {
  constructor(
    private readonly base: Base,
    private readonly f: typeof fetch,
    private readonly timeoutMs: number,
    private readonly auth: Record<string, string>,
  ) {}

  async call<T>(method: string, path: string, body?: unknown, query?: Query, extra?: Record<string, string>): Promise<T> {
    return (await this.raw(method, path, body, query, extra)).data as T;
  }

  /**
   * A stream (Server-Sent Events): the raw answer, its body read as it
   * comes; stopped by the signal. No timeout (a stream stays open), never
   * a redirect.
   */
  async stream(path: string, query?: Query, signal?: AbortSignal): Promise<Response> {
    if (path.split("?")[0].split("/").slice(1).some((p) => p === "" || p === "." || p === "..")) {
      throw new QAuthError(400, "VALIDATION_ERROR", "An id in the request is empty or not allowed.");
    }
    const url = new URL((typeof this.base === "string" ? this.base : await this.base()) + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    return this.f(url, { method: "GET", headers: { accept: "text/event-stream", ...this.auth }, signal, redirect: "manual" });
  }

  async list<T>(path: string, query?: Query): Promise<Page<T>> {
    const env = await this.raw("GET", path, undefined, query);
    const p = (env.pagination ?? {}) as Partial<Pagination>;
    const pagination = { ...p, totalPages: p.total_pages ?? p.totalPages ?? 0 } as Pagination;
    return { items: (env.data as T[]) ?? [], pagination };
  }

  private async raw(method: string, path: string, body?: unknown, query?: Query, extra?: Record<string, string>): Promise<Record<string, unknown>> {
    // an empty, "." or ".." segment would reach another route: refuse before sending
    if (path.split("?")[0].split("/").slice(1).some((p) => p === "" || p === "." || p === "..")) {
      throw new QAuthError(400, "VALIDATION_ERROR", "An id in the request is empty or not allowed.");
    }
    const url = new URL((typeof this.base === "string" ? this.base : await this.base()) + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { accept: "application/json", ...(extra ?? {}), ...this.auth };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.f(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        // never follow: a redirect would carry the token or API key to another host
        redirect: "manual",
      });
    } catch (e) {
      // network failure or timeout: still one error type (status 0)
      const timedOut = (e as { name?: string })?.name === "TimeoutError";
      throw new QAuthError(0, "UNAVAILABLE", timedOut ? "qAuth did not answer in time." : "Could not reach qAuth.", undefined, undefined, undefined, { cause: e });
    }
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new QAuthError(res.status, "UNEXPECTED_REDIRECT", "qAuth answered with a redirect; it was not followed.", res.headers.get("x-request-id") ?? undefined);
    }
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    let env: Record<string, unknown> = {};
    try {
      env = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new QAuthError(res.status, "BAD_RESPONSE", `qAuth answered HTTP ${res.status} without its JSON envelope`, res.headers.get("x-request-id") ?? undefined, undefined, retryAfter);
    }
    if (!res.ok || env.success === false) {
      const err = (env.error ?? {}) as { code?: string; message?: string; fields?: Record<string, string[]> };
      const meta = (env.meta ?? {}) as { request_id?: string };
      const e = new QAuthError(res.status, err.code ?? "ERROR", err.message ?? String(env.message ?? `HTTP ${res.status}`), meta.request_id ?? res.headers.get("x-request-id") ?? undefined, err.fields, retryAfter);
      if (env.data !== undefined && env.data !== null) e.data = env.data;
      throw e;
    }
    return env;
  }
}

const seg = (s: string) => encodeURIComponent(s);

/** One organization, as the signed-in person sees it. */
export class OrgClient {
  constructor(private readonly t: Transport, readonly id: string) {}

  private p(rest = "") {
    return `/v1/orgs/${seg(this.id)}${rest}`;
  }

  get(): Promise<Org> {
    return this.t.call("GET", this.p());
  }
  /** Admins: may this org's people also belong to other organizations? */
  updateSettings(s: { membersMayJoinOthers: boolean }): Promise<Org> {
    return this.t.call("PUT", this.p("/settings"), s);
  }
  /** Admins: require a second sign-in step for this org's people. */
  setSecurity(s: { mfaRequired: boolean }): Promise<Org> {
    return this.t.call("PUT", this.p("/security"), s);
  }
  /** Every role of this organization, with whether you may give it and why not. */
  async givableRoles(): Promise<GivableRole[]> {
    return (await this.t.call<{ roles: GivableRole[] }>("GET", this.p("/givable-roles"))).roles;
  }
  /** The apps this org can use. */
  apps(): Promise<Page<App>> {
    return this.t.list(this.p("/apps"));
  }
  /** The organization's levels in each API. */
  levels(): Promise<OrgLevels> {
    return this.t.call("GET", this.p("/levels"));
  }
  /**
   * @deprecated Since 0.17.0 a parent organization never manages a child's
   * people: setting a new admin of an organization that lost its admins is
   * your tenant's (Console, or `POST /tenant/orgs/{id}/new-admin`). From an
   * organization this answers 403.
   */
  newAdmin(email: string): Promise<NewAdminResult> {
    return this.t.call("POST", this.p("/new-admin"), { email });
  }

  readonly members = {
    list: (): Promise<Page<Member>> => this.t.list(this.p("/members")),
    add: (m: NewMember): Promise<AddedMember> => this.t.call("POST", this.p("/members"), m),
    /** @deprecated Use `setRoles`. */
    setRole: (userId: string, role: Role): Promise<unknown> => this.t.call("PUT", this.p(`/members/${seg(userId)}`), { role }),
    /** Replace the person's roles in every space at once (ids from `givableRoles()`). */
    setRoles: (userId: string, roleIds: string[]): Promise<{ updated: boolean }> =>
      this.t.call("PUT", this.p(`/members/${seg(userId)}/roles`), { roleIds }),
    remove: (userId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/members/${seg(userId)}`)),
    /**
     * Set a member's new password (directory rules apply; needs
     * org.people.reset_password in this organization). Only the
     * organization's own admins, its own key and your tenant can: a parent
     * organization never manages a child's people (403).
     */
    resetPassword: (userId: string, opts: { password?: string; changeRequired?: boolean } = {}): Promise<PasswordReset> =>
      this.t.call("POST", this.p(`/members/${seg(userId)}/reset-password`), opts),
    /** Admins: a member's signed-in devices in the apps this organization uses. */
    devices: (userId: string): Promise<Page<Device>> => this.t.list(this.p(`/members/${seg(userId)}/devices`)),
    /** Admins: end one of a member's devices (never rename or add one for them). */
    endDevice: (userId: string, deviceId: string): Promise<{ removed: boolean; count: number }> =>
      this.t.call("DELETE", this.p(`/members/${seg(userId)}/devices/${seg(deviceId)}`)),
    /** Admins: end all of a member's devices in the apps this organization uses. */
    endDevices: (userId: string): Promise<{ removed: boolean; count: number }> => this.t.call("DELETE", this.p(`/members/${seg(userId)}/devices`)),
  };

  /**
   * Child organizations. `list` shows only the children you reach (through
   * a level: one level below). `create` needs org.suborgs.create in a role
   * of the level directly above each level the child gets (or this
   * organization's API key with qauth:org:members). A parent sees its
   * children and their people (read-only); it never manages their people.
   */
  readonly subOrgs = {
    /** Each child carries `createdAt`. */
    list: (): Promise<Page<Org>> => this.t.list(this.p("/suborgs")),
    /**
     * With `idempotencyKey` (one you make per creation, 1 to 255 printable
     * characters) a retry is safe: the same key and request within qAuth's
     * window (24 hours by default) answer the same child, never a second
     * one; another request with that key is refused (409).
     */
    create: (s: NewSubOrg, opts: { idempotencyKey?: string } = {}): Promise<CreatedSubOrg> =>
      this.t.call("POST", this.p("/suborgs"), s, undefined, opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : undefined),
  };

  /**
   * Rename the organization: a direct child from its parent (with
   * org.suborgs.manage, or the parent's key with qauth:org:suborgs), or the
   * organization by its own admins. Unique among its siblings.
   */
  rename(name: string): Promise<Org> {
    return this.t.call("PUT", this.p(), { name });
  }
  /**
   * Set your own id for a direct child (`""` clears it): its parent (org.suborgs.manage
   * in a role of the parent, or the parent's key with qauth:org:suborgs) or your
   * tenant; never the organization's own people. Unique in your tenant.
   */
  setExternalId(externalId: string): Promise<Org> {
    return this.t.call("PUT", this.p("/external-id"), { externalId });
  }
  /**
   * Set a direct child's levels in one API, from its parent: the same rule as
   * creating it (each level directly below one of the parent's). Refused when
   * a child of the child, or someone holding a role of a level taken away,
   * would be left without it (409), and for the child's last level (403).
   */
  setLevels(apiId: string, levelIds: string[]): Promise<OrgLevels> {
    return this.t.call("PUT", this.p(`/levels/${seg(apiId)}`), { levelIds });
  }

  /**
   * Sessions & devices for one app, made stricter for this organization's
   * people (never looser than the app's: qAuth refuses that with 422).
   */
  readonly sessionSettings = {
    get: (appId: string): Promise<OrgSessionSettingsView> => this.t.call("GET", this.p(`/apps/${seg(appId)}/session-settings`)),
    /** `{}` goes back to the app's settings. */
    set: (appId: string, override: OrgSessionSettings): Promise<OrgSessionSettingsView> =>
      this.t.call("PUT", this.p(`/apps/${seg(appId)}/session-settings`), override),
  };

  /**
   * Invitations: no account exists until the person accepts on qAuth's page
   * (with their existing account, or by choosing their own password).
   */
  readonly invitations = {
    list: (): Promise<Page<Invitation>> => this.t.list(this.p("/invitations")),
    create: (i: NewInvitation): Promise<SentInvitation> => this.t.call("POST", this.p("/invitations"), i),
    /** A new link and 7 more days; the old link stops working. */
    resend: (invitationId: string, opts: { send?: boolean } = {}): Promise<SentInvitation> =>
      this.t.call("POST", this.p(`/invitations/${seg(invitationId)}/resend`), opts),
    revoke: (invitationId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/invitations/${seg(invitationId)}`)),
  };

  /**
   * Company sign-in (OpenID Connect: Entra ID, Google Workspace, Okta...).
   * Admins only. Applies to emails at the org's verified domains.
   */
  readonly sso = {
    get: (): Promise<SSOState> => this.t.call("GET", this.p("/sso")),
    set: (s: SSOSpec): Promise<SSOState> => this.t.call("PUT", this.p("/sso"), s),
    remove: (): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p("/sso")),
  };

  /**
   * The white-label sign-in look (logo, colours, light or dark, language).
   * No `app` = the organization's own; an app's id = its look for that app.
   */
  readonly branding = {
    get: (app?: string): Promise<Branding> => this.t.call("GET", this.p("/branding"), undefined, { app }),
    set: (spec: BrandingSpec, app?: string): Promise<Branding> => this.t.call("PUT", this.p("/branding"), spec, { app }),
    remove: (app?: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p("/branding"), undefined, { app }),
  };

  /**
   * The sign-in page design: the look with its layout (simple or split, form
   * at the start or end), form-side settings and side panel. Admins with
   * settings rights change it. No `app` = the organization's own look.
   */
  readonly design = {
    get: (app?: string): Promise<DesignView> => this.t.call("GET", this.p("/design"), undefined, { app }),
    set: (spec: BrandingSpec, app?: string): Promise<DesignView> => this.t.call("PUT", this.p("/design"), spec, { app }),
    /** Inherit again. */
    reset: (app?: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p("/design"), undefined, { app }),
    /** Keep a picture (PNG, JPEG, WebP or GIF as base64); use its `hash` in the panel. */
    addPicture: (base64: string): Promise<DesignFile> => this.t.call("POST", this.p("/design/files"), { data: base64 }),
  };

  readonly domains = {
    list: (): Promise<Page<OrgDomain>> => this.t.list(this.p("/domains")),
    add: (domain: string): Promise<AddedDomain> => this.t.call("POST", this.p("/domains"), { domain }),
    verify: (domainId: string): Promise<OrgDomain> => this.t.call("POST", this.p(`/domains/${seg(domainId)}/verify`)),
    remove: (domainId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/domains/${seg(domainId)}`)),
  };

  readonly apiKeys = {
    list: (): Promise<Page<ApiKey>> => this.t.list(this.p("/api-keys")),
    create: (k: NewApiKey): Promise<MintedApiKey> => this.t.call("POST", this.p("/api-keys"), k),
    revoke: (keyId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/api-keys/${seg(keyId)}`)),
  };

  /** The org's own roles for one app (built on the app's permissions). */
  readonly roles = {
    permissions: (appId: string): Promise<Page<Permission>> => this.t.list(this.p(`/apps/${seg(appId)}/permissions`)),
    /** The app's built-in roles plus this org's own. */
    list: (appId: string): Promise<Page<AppRole>> => this.t.list(this.p(`/apps/${seg(appId)}/roles`)),
    create: (appId: string, r: RoleSpec): Promise<AppRole> => this.t.call("POST", this.p(`/apps/${seg(appId)}/roles`), r),
    update: (roleId: string, r: RoleSpec): Promise<AppRole> => this.t.call("PUT", this.p(`/roles/${seg(roleId)}`), r),
    remove: (roleId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/roles/${seg(roleId)}`)),
  };

  /** Who holds which roles of one app in this org. */
  readonly assignments = {
    list: (appId: string): Promise<Page<PersonRoles>> => this.t.list(this.p("/app-roles"), { app: appId }),
    set: (a: { appId: string; userId: string; roleIds: string[] }): Promise<{ updated: boolean }> =>
      this.t.call("PUT", this.p("/app-roles"), a),
  };

  /** Admins: the org's audit log, newest first. `before` is an event id. */
  audit(q: AuditQuery = {}): Promise<Page<AuditEntry>> {
    return this.t.list(this.p("/audit"), q as Query);
  }
}

/** The signed-in person (their access token). */
export class PersonClient {
  constructor(private readonly t: Transport) {}

  /** Who the person is, and their organizations with their role in each. */
  profile(): Promise<Profile> {
    return this.t.call("GET", "/v1/me");
  }
  orgs(): Promise<Page<MyOrg>> {
    return this.t.list("/v1/me/orgs");
  }
  /** The person's roles and permissions in one app, inside one org. */
  permissions(q: { app: string; org: string }): Promise<Effective> {
    return this.t.call("GET", "/v1/me/permissions", undefined, q);
  }
  /** One of the person's organizations. */
  org(orgId: string): OrgClient {
    return new OrgClient(this.t, orgId);
  }

  /**
   * Personal access tokens, for scripts and tools acting as this person in
   * one organization: a subset of their own permissions, in APIs that accept
   * personal tokens, checked like an API key and never more than they hold.
   */
  readonly tokens = {
    list: (): Promise<Page<ApiKey>> => this.t.list("/v1/me/tokens"),
    /** Per API: the permissions the person can put in a token for this org. */
    choices: (orgId: string): Promise<Page<TokenChoice>> => this.t.list("/v1/me/token-choices", { org: orgId }),
    create: (tk: NewPersonalToken): Promise<MintedApiKey> => this.t.call("POST", "/v1/me/tokens", tk),
    revoke: (tokenId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", `/v1/me/tokens/${seg(tokenId)}`),
  };

  /**
   * Action verification: confirm a sensitive action (a transfer, a change of
   * email) with a one-time code sent to this person's OWN phone or email, or
   * from their authenticator app. Your backend must call `consume` with
   * exactly what it is about to do before acting; it answers yes once.
   */
  readonly verifications = {
    /** Sends a code for an action. `template` is the template's id or name. */
    start: (template: string, variables: Record<string, string> = {}, opts: { channel?: VerifyChannel; locale?: string } = {}): Promise<StartedVerification> =>
      this.t.call("POST", "/v1/verifications", { template, variables, ...opts }),
    /** Sends the code again, or by another of the person's channels. */
    resend: (requestId: string, opts: { channel?: VerifyChannel; locale?: string } = {}): Promise<StartedVerification> =>
      this.t.call("POST", `/v1/verifications/${seg(requestId)}/resend`, opts),
    /** Checks the code the person typed. */
    check: (requestId: string, code: string): Promise<VerificationCheck> =>
      this.t.call("POST", `/v1/verifications/${seg(requestId)}/check`, { code }),
    /**
     * Your backend, before acting: throws (409) unless this person verified
     * this template for exactly these values, recently, and it was never used.
     */
    consume: (requestId: string, expect: { template: string; variables?: Record<string, string> }): Promise<ConsumedVerification> =>
      this.t.call("POST", `/v1/verifications/${seg(requestId)}/consume`, { template: expect.template, variables: expect.variables ?? {} }),
  };

  /**
   * My account. Removing a factor or making new recovery codes needs a fresh
   * proof (password or authenticator code); wrong proofs count toward the
   * account's lockout.
   */
  readonly account = {
    security: (): Promise<MySecurity> => this.t.call("GET", "/v1/me/security"),
    /**
     * The person's recent activity, newest first: their sign-ins and
     * sign-outs (device, address), refused sign-ins, password, second-step,
     * passkey and token changes, and what an admin did to their account.
     */
    activity: (q: Omit<AuditQuery, "actor" | "target"> = {}): Promise<Page<AuditEntry>> => this.t.list("/v1/me/activity", q as Query),
    changePassword: (current: string, next: string): Promise<{ updated: boolean }> =>
      this.t.call("PUT", "/v1/me/password", { current, new: next }),
    authenticator: {
      /** Returns the otpauth:// address (show it as a QR code) and its secret. */
      start: (): Promise<{ uri: string; secret: string }> => this.t.call("POST", "/v1/me/authenticator"),
      verify: (code: string): Promise<{ updated: boolean }> => this.t.call("POST", "/v1/me/authenticator/verify", { code }),
      remove: (proof: Proof): Promise<{ removed: boolean }> => this.t.call("DELETE", "/v1/me/authenticator", proof),
    },
    phone: {
      /** Sends a code to the number; it is saved once verify() gets the right code. */
      add: (phone: string): Promise<{ codeSentTo: string }> => this.t.call("POST", "/v1/me/phone", { phone }),
      verify: (code: string): Promise<{ updated: boolean }> => this.t.call("POST", "/v1/me/phone/verify", { code }),
      remove: (proof: Proof): Promise<{ removed: boolean }> => this.t.call("DELETE", "/v1/me/phone", proof),
    },
    passkeys: {
      /** Removes one of the person's passkeys (they are listed in security()). */
      remove: (passkeyId: string, proof: Proof): Promise<{ removed: boolean }> =>
        this.t.call("DELETE", `/v1/me/passkeys/${seg(passkeyId)}`, proof),
    },
    /** Ten new single-use codes, shown once (the old ones stop working). Proof needed when codes exist. */
    recoveryCodes: (proof?: Proof): Promise<{ codes: string[] }> => this.t.call("POST", "/v1/me/recovery-codes", proof ?? {}),
    sessions: {
      list: (): Promise<Page<SessionInfo>> => this.t.list("/v1/me/sessions"),
      end: (sessionId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", `/v1/me/sessions/${seg(sessionId)}`),
      /** Signs the person out everywhere, here too: their tokens stop working at once. */
      endAll: (): Promise<{ removed: boolean; count: number }> => this.t.call("DELETE", "/v1/me/sessions"),
      /**
       * The session's sign-out rules and time left (sessionId = the ID token's sid). With single sign-on
       * several apps share one sid, each with its own rules: pass your OAuth clientId (required then, unless your access token names it).
       */
      state: (sessionId: string, clientId?: string): Promise<SessionState> =>
        this.t.call("GET", `/v1/me/sessions/${seg(sessionId)}/state${clientQuery(clientId)}`),
      /** "Still here": resets the idle timer of YOUR app's session (pass your clientId). watchIdle sends it for you. */
      activity: (sessionId: string, clientId?: string): Promise<SessionState> =>
        this.t.call("POST", `/v1/me/sessions/${seg(sessionId)}/activity${clientQuery(clientId)}`),
      /**
       * Instant sign-out: the session's stream (Server-Sent Events: ready, ping, ended {reason}, reconnect), as a raw
       * Response read as it comes; stop it with the signal. watchIdle's `source.events` takes it as it is. On a server
       * (Node: no window), watchIdle with this source only watches: it reconnects, falls back to polling, and calls onEnded.
       */
      events: (sessionId: string, opts: { clientId?: string; signal?: AbortSignal } = {}): Promise<Response> =>
        this.t.stream(`/v1/me/sessions/${seg(sessionId)}/events`, { client: opts.clientId }, opts.signal),
    },
    /**
     * My account › Devices: everywhere the person is signed in to the
     * tenant's apps, with rename, mark shared, sign out one or every device
     * of a type; pairing codes (Add a device); and approving a TV's code.
     */
    devices: {
      /**
       * `app`: show the counts against that app's limits. `session`: the sid of your ID token
       * (`sessionIdOf(idToken)`): access tokens carry none, so without it no device is `current`.
       */
      list: (opts: { app?: string; session?: string } = {}): Promise<DeviceList> => this.t.call("GET", "/v1/me/devices", undefined, opts),
      /** Rename a device, or mark it shared (signs out sooner when idle; counts as a kiosk). */
      update: (deviceId: string, change: { name?: string; shared?: boolean }): Promise<Device> =>
        this.t.call("PUT", `/v1/me/devices/${seg(deviceId)}`, change),
      signOut: (deviceId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", `/v1/me/devices/${seg(deviceId)}`),
      /**
       * Every device of a type (and app). Name your own device so it stays signed in (`session`:
       * your ID token's sid, or `keep`: its device id), or pass `includeCurrent` to sign it out
       * too; with neither qAuth answers 400 (it never guesses which device is yours).
       */
      signOutAll: (opts: { type?: DeviceType; app?: string; session?: string; keep?: string; includeCurrent?: boolean } = {}): Promise<{ removed: boolean; count: number }> =>
        this.t.call("DELETE", "/v1/me/devices", undefined, {
          type: opts.type, app: opts.app, session: opts.session, keep: opts.keep, includeCurrent: opts.includeCurrent ? "true" : undefined,
        }),
      /**
       * Add a device: a single-use code (no I, O, 0 or 1) the device types under "Enter a pairing code".
       * Needs a recent sign-in to your app (a step-up when the app asks a second step): else 403
       * `FRESH_SIGN_IN_REQUIRED`. `clientId`: your OAuth client, when your access token doesn't name it.
       */
      pairingCode: (appId: string, opts: { clientId?: string } = {}): Promise<PairingCode> =>
        this.t.call("POST", "/v1/me/pairing-codes", { appId }, { client: opts.clientId }),
      /** The device waiting for a TV code (or a computer's QR): show it before approving. Wrong codes count. */
      lookup: (code: string): Promise<WaitingDevice> => this.t.call("GET", `/v1/me/device-approvals/${seg(code)}`),
      /**
       * Approve: the device gets its own session. `number`: the one the
       * person picked from `lookup(code).choices` (the device shows it; a
       * wrong pick refuses the device for good). A device on another network
       * throws 409 `CONFIRM_PLACE` until the person confirms (`confirmPlace`).
       * At the app's limit: 409 `SESSION_LIMIT` with the sessions in
       * `error.data.sessions`; pass the ones the person picked in `signOut`.
       * Needs a recent sign-in to your app (403 `FRESH_SIGN_IN_REQUIRED`).
       */
      approve: (code: string, opts: { number?: number; confirmPlace?: boolean; signOut?: string[]; clientId?: string } = {}): Promise<{ decision: "approve"; device: string }> =>
        this.t.call("POST", `/v1/me/device-approvals/${seg(code)}`, { decision: "approve", number: opts.number, confirmPlace: opts.confirmPlace, signOut: opts.signOut ?? [] }, { client: opts.clientId }),
      deny: (code: string): Promise<{ decision: "deny"; device: string }> => this.t.call("POST", `/v1/me/device-approvals/${seg(code)}`, { decision: "deny" }),
    },
    /**
     * The person's latest step-up for your OAuth client (null = none). Pair
     * it with stepUp: remember when you sent them, and accept the step-up
     * only if `isFreshStepUp(record, startedAt)`.
     */
    lastStepUp: async (clientId: string): Promise<StepUp | null> => {
      try {
        return await this.t.call<StepUp>("GET", `/v1/me/step-up?client=${encodeURIComponent(clientId)}`);
      } catch (e) {
        if (e instanceof QAuthError && e.status === 404) return null;
        throw e;
      }
    },
  };
}

/** A device type sessions count as. */
export type DeviceType = "tv" | "phone" | "computer" | "other";

/** One signed-in device (one app session). */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  /** signin | code (a TV code) | pairing | phone (a computer signed in with a phone). */
  kind: string;
  shared: boolean;
  appId: string;
  appName: string;
  clientId: string;
  place: string;
  startedAt: string;
  lastActiveAt: string;
  /** The device the call came from. */
  current: boolean;
}

/** How many devices are in use against a limit (type "" = all together; limit 0 = none). */
export interface DeviceCount {
  type: "" | DeviceType;
  inUse: number;
  limit: number;
}

export interface DeviceList {
  devices: Device[];
  appId?: string;
  counts?: DeviceCount[];
  /** Apps the person can add a device to. */
  apps: { id: string; name: string; pairing: boolean }[];
}

export interface PairingCode {
  code: string;
  appId: string;
  appName: string;
  expiresAt: string;
  /** The app's device sign-in address (never the code itself). */
  url: string;
}

/** A device waiting for approval, as the person sees it before approving. */
export interface WaitingDevice {
  id: string;
  kind: "tv" | "phone";
  userCode: string;
  deviceName: string;
  deviceType: DeviceType;
  shared: boolean;
  appId: string;
  appName: string;
  place: string;
  askedAt: string;
  expiresAt: string;
  /** The app asks a second step: approve on the sign-in page (/tv) instead. */
  secondStep: boolean;
  /** Number matching: the device shows one of these; the person picks it (none = off). */
  choices?: number[];
  /** The device is on another network than the person approving (`approverPlace`): warn, and confirm. */
  otherNetwork: boolean;
  approverPlace?: string;
  /** A computer's QR from another network is refused by the app. */
  refusedOnOtherNetwork?: boolean;
  max: number;
  typeMax: number;
  inUse: number;
  typeInUse: number;
}

/** An app's session limits and device sign-in settings (see the API reference). */
export interface SessionSettings {
  maxSessions: number;
  perType: Partial<Record<DeviceType, number>>;
  atLimit: "ask" | "replace" | "refuse";
  replace: "least_recent" | "earliest";
  deviceSignIn: boolean;
  deviceCodeMinutes: number;
  pairing: boolean;
  pairingMinutes: number;
  pairingLength: number;
  wrongTries: number;
  wrongWindowMinutes: number;
  secondStep: boolean;
  phoneSignIn: boolean;
  phoneQrSeconds: number;
  sharedIdleMinutes: number;
  kioskQr: boolean;
  kioskType: DeviceType;
  orgDeviceLimit: number;
  /** Number matching is on unless this is true. */
  skipNumberMatch: boolean;
  phonePlaceMismatch: "refuse" | "warn";
  freshMinutes: number;
  ownAppOnly: boolean;
  skipNewDeviceEmail: boolean;
  skipReplacedEmail: boolean;
  pairingAppTries: number;
  /** Idle sign-out per device type: -1 never (TVs by default), 0 the app's usual rule, or minutes. */
  idleByType: Partial<Record<DeviceType, number>>;
  /** The first sign-in screen: the email only (default), or email and password together. */
  signinForm: "email_first" | "one_screen";
  /** No "Choose an account" list / last email / passkey autofill on this app's sign-in page. */
  skipChooser: boolean;
  skipLastEmail: boolean;
  skipPasskeyAutofill: boolean;
  /** "Email me a code" signs in with a one-time code instead of the password. */
  emailCodeSignIn: boolean;
  /** Emails at a verified domain are not sent to their company sign-in after the first screen. */
  skipCompanyByDomain: boolean;
  /** When a reused shared sign-in asks a quick check: minutes without activity, always, never, or the tenant's default. */
  reverifyOnReuse: ReverifyOnReuse;
}

/** Minutes (1 to 1440) without activity in the browser, or "always" | "never" | "default" (the tenant's rule). */
export type ReverifyOnReuse = number | "always" | "never" | "default";

/** An organization's stricter settings for one app (left out = the app's). */
export type OrgSessionSettings = Partial<Pick<SessionSettings, "maxSessions" | "perType" | "atLimit" | "replace" | "deviceSignIn" | "deviceCodeMinutes" | "pairing" | "pairingMinutes" | "wrongTries" | "secondStep" | "phoneSignIn" | "sharedIdleMinutes" | "kioskQr" | "freshMinutes">> & {
  /** Only `true` (stricter): number matching on for the organization's people. */
  numberMatch?: boolean;
  /** A shorter idle time per device type (minutes). */
  idleByType?: Partial<Record<DeviceType, number>>;
  /** Only "email_first" (stricter). */
  signinForm?: "email_first";
  /** Only true (stricter). */
  skipChooser?: boolean;
  skipLastEmail?: boolean;
  /** Only false (stricter). */
  emailCodeSignIn?: boolean;
  /** "always", or fewer minutes than the app's rule. */
  reverifyOnReuse?: number | "always";
};

export interface OrgSessionSettingsView {
  appId: string;
  appName: string;
  app: SessionSettings;
  override: OrgSessionSettings;
  effective: SessionSettings;
}

/** A completed step-up: when, and with which second step. */
/** How a verification code reaches the person. */
export type VerifyChannel = "sms" | "voice" | "email" | "authenticator";

/** Where the code went (masked), and the other channels the person can switch to. */
export interface StartedVerification {
  requestId: string;
  channel: VerifyChannel;
  sentTo: string;
  expiresAt: string;
  channels: VerifyChannel[];
}

/** verified, invalid (try again: triesLeft), or spent (start a new one). */
export interface VerificationCheck {
  status: "verified" | "invalid" | "spent";
  triesLeft: number;
}

/** What the backend learns, once. */
export interface ConsumedVerification {
  requestId: string;
  template: string;
  variables: Record<string, string>;
  channel: VerifyChannel;
  verifiedAt: string;
}

export interface StepUp {
  at: string;
  method: "authenticator" | "email" | "sms" | "voice" | "recovery code" | "company";
}

/**
 * Step-up: before a sensitive action, send the person to sign in again with
 * these extra authorize parameters (needs the app's Step-up switch, Console >
 * app > Sign-in). qAuth then asks for a fresh second step, even on a
 * remembered device. Note the time you sent them (`startedAt`), then check
 * `me.account.lastStepUp(clientId)` with the NEW tokens and `isFreshStepUp`.
 *
 * The record is per person and client, not per browser session: always
 * compare with your own `startedAt` (and keep the window short), so a step-up
 * done elsewhere earlier never counts here.
 */
export const stepUpParams = { max_age: "0" } as const;

/** The step-up happened after `startedAt` (and within `withinMs`, default 10 minutes). */
export function isFreshStepUp(record: StepUp | null, startedAt: Date, withinMs = 10 * 60_000): boolean {
  if (!record) return false;
  const at = new Date(record.at).getTime();
  return at >= startedAt.getTime() - 1000 && Date.now() - at <= withinMs;
}

export interface KeyCheck {
  valid: boolean;
  /** Set when valid: whose key it is and what it may do. */
  key?: {
    id: string;
    name: string;
    tenantId: string;
    orgId: string;
    /** "m2m" for a machine's key ("pat" later: a person's token). */
    kind?: "m2m" | "pat";
    /** Whose key: an organization's integration, or the tenant's own services. */
    owner?: { type: "organization" | "tenant"; id: string };
    /** qAuth's own organization-API scopes (qauth:org:*), and older keys' scopes. */
    scopes: string[];
    /** The apps it works for right now (the org's live access). */
    apps: string[];
    /** What it may do, worked out live: API id -> permission keys. */
    permissions?: Record<string, string[]>;
    expiresAt?: string | null;
  };
}

/** Whether a checked key may use one permission of one API. */
export function keyMay(check: KeyCheck, apiId: string, permission: string): boolean {
  return !!check.valid && !!check.key?.permissions?.[apiId]?.includes(permission);
}

/** Who a permissions call is for: a verified Identity, or the person's raw access token. */
export type Who = Identity | string;

/** The organization and app a permission question is about. */
export interface Scope {
  app: string;
  org: string;
}

export class QAuth {
  private readonly base: Base;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;
  /** The token Verifier: yours, or the one built from `issuer` + `clientId`. */
  readonly verifier?: Verifier;
  private readonly apiKey?: string;
  private api?: { p: Promise<string>; failedAt?: number };
  private readonly perms: TtlCache<Effective>;
  private readonly orgLists: TtlCache<MyOrg[]>;
  private readonly keys: TtlCache<KeyCheck>;

  constructor(private readonly o: QAuthOptions) {
    if (!o?.baseUrl && !o?.issuer) throw new Error("QAuth: issuer (with clientId) or baseUrl is required");
    if (o.issuer !== undefined && !secureUrl(o.issuer)) throw new Error(`QAuth: issuer ${o.issuer} must be an https:// address (http:// only for localhost)`);
    if (o.issuer && !o.clientId && !o.verifier) throw new Error("QAuth: clientId is required with issuer");
    this.f = o.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = o.timeoutMs ?? 15000;
    this.base = o.baseUrl ? o.baseUrl.replace(/\/+$/, "") : () => this.discoverApi();
    this.verifier = o.verifier ?? (o.issuer && o.clientId ? new Verifier({ issuers: [o.issuer], clientIds: [o.clientId], fetch: o.fetch }) : undefined);
    this.apiKey = o.apiKey;
    const permsMs = (o.permissionsCacheSeconds ?? 60) * 1000;
    this.perms = new TtlCache(permsMs, o.now);
    this.orgLists = new TtlCache(permsMs, o.now);
    this.keys = new TtlCache((o.keyCacheSeconds ?? 0) * 1000, o.now);
  }

  /**
   * Server to server: an organization's API key (qak_...) acting on its own
   * organization, within its qauth:org:* scopes. It can never change
   * settings, security, company sign-in, keys or the admin role.
   */
  withKey(apiKey: string | undefined = this.apiKey): { org(orgId: string): OrgClient } {
    if (!apiKey) throw new Error("QAuth.withKey: the API key is required (pass it, or set apiKey)");
    const t = new Transport(this.base, this.f, this.timeoutMs, { "x-api-key": apiKey });
    return { org: (orgId: string) => new OrgClient(t, orgId) };
  }

  /** One organization with the `apiKey` you set (machine calls; see `withKey`). */
  org(orgId: string): OrgClient {
    return this.withKey().org(orgId);
  }

  /**
   * qAuth's API address: `baseUrl`, or `qauth_api` from the issuer's discovery
   * (read once; a failed read is tried again after `discoveryRetrySeconds`).
   */
  apiUrl(): Promise<string> {
    return typeof this.base === "string" ? Promise.resolve(this.base) : this.base();
  }

  /** Check a person's access token offline (the Verifier for `issuer` + `clientId`). Throws QAuthError (401, or 503). */
  verify(accessToken: string): Promise<Identity> {
    return this.needVerifier().verify(accessToken);
  }

  /** The Bearer token of a fetch-style Request, verified (see Verifier.authenticate). */
  authenticate(request: Request): Promise<Identity> {
    return this.needVerifier().authenticate(request);
  }

  /** Express / Connect middleware that verifies the Bearer token (see Verifier.middleware). */
  middleware(opts: { optional?: boolean } = {}): ConnectMiddleware {
    return this.needVerifier().middleware(opts);
  }

  private needVerifier(): Verifier {
    if (!this.verifier) throw new Error("QAuth: no token Verifier (set issuer and clientId, or verifier)");
    return this.verifier;
  }

  private nowMs(): number {
    return this.o.now?.() ?? Date.now();
  }

  private discoverApi(): Promise<string> {
    const hit = this.api;
    if (hit && (hit.failedAt === undefined || this.nowMs() - hit.failedAt < (this.o.discoveryRetrySeconds ?? 5) * 1000)) return hit.p;
    const entry: { p: Promise<string>; failedAt?: number } = { p: this.readApi() };
    this.api = entry;
    entry.p.catch(() => {
      entry.failedAt = this.nowMs();
    });
    return entry.p;
  }

  /** Reads qauth_api from the issuer's discovery: never follows a redirect; the document must name this issuer; https only. */
  private async readApi(): Promise<string> {
    const iss = this.o.issuer as string;
    let doc: { issuer?: unknown; qauth_api?: unknown };
    let res: Response;
    try {
      res = await this.f(`${iss.replace(/\/+$/, "")}/.well-known/openid-configuration`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
    } catch (e) {
      throw new QAuthError(0, "UNAVAILABLE", "Could not read the issuer's sign-in settings.", undefined, undefined, undefined, { cause: e });
    }
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new QAuthError(res.status, "UNEXPECTED_REDIRECT", "The issuer's discovery answered with a redirect; it was not followed.");
    }
    if (!res.ok) throw new QAuthError(res.status, "UNAVAILABLE", `The issuer's discovery answered HTTP ${res.status}.`);
    try {
      doc = (await res.json()) as typeof doc;
    } catch (e) {
      throw new QAuthError(502, "BAD_DISCOVERY", "The issuer's discovery is not a JSON document.", undefined, undefined, undefined, { cause: e });
    }
    if (doc.issuer !== iss) throw new QAuthError(502, "BAD_DISCOVERY", "The issuer's discovery document names another issuer.");
    if (typeof doc.qauth_api !== "string" || !doc.qauth_api) {
      throw new QAuthError(502, "BAD_DISCOVERY", "The issuer's discovery names no qAuth API (qauth_api): this qAuth server is older; set baseUrl.");
    }
    if (!secureUrl(doc.qauth_api)) throw new QAuthError(502, "BAD_DISCOVERY", "The qAuth API the issuer names is not an https:// address.");
    const trusted = (this.o.trustedApiHosts ?? DEFAULT_TRUSTED_API_HOSTS).map((h) => h.toLowerCase());
    if (!trusted.includes(new URL(doc.qauth_api).host.toLowerCase())) {
      throw new QAuthError(502, "UNTRUSTED_API", "This issuer names an API address that isn't a known qAuth address; pass baseUrl (or trustedApiHosts) if you run your own qAuth.");
    }
    return doc.qauth_api.replace(/\/+$/, "");
  }

  /** Act as the signed-in person, with their access token. */
  as(accessToken: string): PersonClient {
    if (!accessToken) throw new Error("QAuth.as: the person's access token is required");
    return new PersonClient(new Transport(this.base, this.f, this.timeoutMs, { authorization: `Bearer ${accessToken}` }));
  }

  /**
   * The person's roles and permissions in one app, inside one organization
   * (`{ roles, permissions, orgPermissions }`), kept per person, app and org
   * for `permissionsCacheSeconds` (default 60). Throws QAuthError (401: their
   * session is over; 403/404: not a member of the org).
   */
  async permissions(who: Who, scope: Scope): Promise<Effective> {
    const { token, key } = await this.whoKey(who);
    return this.perms.get(`${key}p\n${scope.app}\n${scope.org}`, () => this.as(token).permissions(scope));
  }

  /**
   * May the person use this permission KEY (e.g. "notes:read") of the app in
   * this org? Decide on permission keys, never on role names (roles are data
   * each organization edits). Answers false when qAuth says they are not a
   * member of the org (403/404); a 401 (session over) still throws.
   */
  async can(who: Who, scope: Scope, permission: string): Promise<boolean> {
    try {
      return (await this.permissions(who, scope)).permissions.includes(permission);
    } catch (e) {
      if (e instanceof QAuthError && (e.status === 403 || e.status === 404)) return false;
      throw e;
    }
  }

  /** The person's organizations (with their role in each), cached like permissions. */
  async orgs(who: Who): Promise<MyOrg[]> {
    const { token, key } = await this.whoKey(who);
    return this.orgLists.get(`${key}o\n`, async () => (await this.as(token).orgs()).items);
  }

  /**
   * Drop what is cached about a person (sign-out, a role change you made):
   * pass their Identity (or `{ issuer, subject }`), or the raw token you used.
   */
  async forget(who: Who | { issuer: string; subject: string }): Promise<void> {
    const prefixes: string[] = [];
    if (typeof who === "string") {
      prefixes.push(`t:${await sha256(who)}\n`);
      if (this.verifier) {
        try {
          const id = await this.verifier.verify(who);
          prefixes.push(identityKey(id));
        } catch {
          /* an invalid token has no person to forget */
        }
      }
    } else {
      prefixes.push(identityKey(who));
    }
    for (const p of prefixes) {
      this.perms.forget(p);
      this.orgLists.forget(p);
    }
  }

  /**
   * Check an API key one of your customers' systems presented to YOUR API.
   * Revoked or expired keys answer valid=false. `app` limits the check to one
   * of your apps. With `keyCacheSeconds` set, answers (valid or not) are kept
   * that long, keyed on a hash of the key (the key itself is never stored).
   */
  async validateKey(apiKey: string, opts: { app?: string } = {}): Promise<KeyCheck> {
    if (!apiKey) return { valid: false };
    return this.keys.get(`${await sha256(apiKey)}\n${opts.app ?? ""}`, () => this.checkKey(apiKey, opts));
  }

  /** Drop every cached validateKey answer (e.g. right after you revoked a key). */
  forgetKeys(): void {
    this.keys.forget("");
  }

  private async checkKey(apiKey: string, opts: { app?: string }): Promise<KeyCheck> {
    const headers: Record<string, string> = { "x-api-key": apiKey };
    if (opts.app) headers["x-qauth-app"] = opts.app;
    try {
      return await new Transport(this.base, this.f, this.timeoutMs, headers).call<KeyCheck>("POST", "/auth/validate");
    } catch (e) {
      if (e instanceof QAuthError && e.status === 401) return { valid: false };
      throw e;
    }
  }

  /** The token to call with, and the cache key: per person when verified, else per token. Never an unverified sub. */
  private async whoKey(who: Who): Promise<{ token: string; key: string }> {
    if (typeof who !== "string") {
      if (!who?.token) throw new Error("QAuth: the Identity has no token");
      return { token: who.token, key: identityKey(who) };
    }
    if (!who) throw new Error("QAuth: the person's access token is required");
    if (this.verifier) return { token: who, key: identityKey(await this.verifier.verify(who)) };
    return { token: who, key: `t:${await sha256(who)}\n` };
  }
}

function identityKey(id: { issuer: string; subject: string }): string {
  return `i:${id.issuer}\n${id.subject}\n`;
}

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export { qauthProxy, type ProxyOptions } from "./proxy.js";
export { Verifier, bearerToken, errorResponse, identityOf, type VerifierOptions, type Identity, type ConnectMiddleware, type MiddlewareRequest, type MiddlewareResponse } from "./verify.js";
export { TokenErrorCode, parseRetryAfter } from "./errors.js";
export { startDeviceSignIn, pollDeviceToken, pairDevice, type DeviceSignIn, type DeviceSignInOptions, type DeviceTokens } from "./device.js";
export { watchIdle, sessionIdOf, type IdleWatch, type IdleWatchOptions, type IdleSource, type IdleWarning, type SessionState, type SessionEnd, type StreamResponse } from "./idle.js";

export default QAuth;

/** `?client=…` for the session calls ("" when no client is given). */
function clientQuery(clientId?: string): string {
  return clientId ? `?client=${encodeURIComponent(clientId)}` : "";
}
