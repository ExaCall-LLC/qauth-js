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
  createdAt: string;
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
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSOState {
  connected: boolean;
  /** Register this redirect address at the company's provider. */
  callbackUrl: string;
  connection?: SSOConnection;
}

export interface SSOSpec {
  /** What people see, e.g. "Contoso account". */
  displayName: string;
  /** e.g. https://login.microsoftonline.com/<tenant id>/v2.0 */
  issuer: string;
  clientId: string;
  /** Required the first time; omit to keep the stored one. */
  clientSecret?: string;
  /** optional (default): a button; required: no password sign-in or reset. */
  mode?: "optional" | "required";
}

/** What to publish to prove the org owns the domain. */
export interface AddedDomain {
  domain: OrgDomain;
  /** The DNS name of the TXT record: _qauth-verify.<domain>. Its value is domain.token. */
  record: string;
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
  /** API permission ids the key may use (never more than you hold). */
  permissions?: string[];
  /** qAuth's organization-API scopes (qauth:org:*). */
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
  createdAt: string;
}

export interface RoleSpec {
  name: string;
  description?: string;
  /** Permission ids of the app. */
  permissions: string[];
  /** Optional qAuth organization-management permission keys. */
  orgPermissions?: string[];
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
  target?: string;
  at: string;
  [k: string]: unknown;
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

  async call<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    return (await this.raw(method, path, body, query)).data as T;
  }

  async list<T>(path: string, query?: Query): Promise<Page<T>> {
    const env = await this.raw("GET", path, undefined, query);
    const p = (env.pagination ?? {}) as Partial<Pagination>;
    const pagination = { ...p, totalPages: p.total_pages ?? p.totalPages ?? 0 } as Pagination;
    return { items: (env.data as T[]) ?? [], pagination };
  }

  private async raw(method: string, path: string, body?: unknown, query?: Query): Promise<Record<string, unknown>> {
    // an empty, "." or ".." segment would reach another route: refuse before sending
    if (path.split("?")[0].split("/").slice(1).some((p) => p === "" || p === "." || p === "..")) {
      throw new QAuthError(400, "VALIDATION_ERROR", "An id in the request is empty or not allowed.");
    }
    const url = new URL((typeof this.base === "string" ? this.base : await this.base()) + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { accept: "application/json", ...this.auth };
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
      throw new QAuthError(res.status, err.code ?? "ERROR", err.message ?? String(env.message ?? `HTTP ${res.status}`), meta.request_id ?? res.headers.get("x-request-id") ?? undefined, err.fields, retryAfter);
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

  readonly members = {
    list: (): Promise<Page<Member>> => this.t.list(this.p("/members")),
    add: (m: NewMember): Promise<AddedMember> => this.t.call("POST", this.p("/members"), m),
    /** @deprecated Use `setRoles`. */
    setRole: (userId: string, role: Role): Promise<unknown> => this.t.call("PUT", this.p(`/members/${seg(userId)}`), { role }),
    /** Replace the person's roles in every space at once (ids from `givableRoles()`). */
    setRoles: (userId: string, roleIds: string[]): Promise<{ updated: boolean }> =>
      this.t.call("PUT", this.p(`/members/${seg(userId)}/roles`), { roleIds }),
    remove: (userId: string): Promise<{ removed: boolean }> => this.t.call("DELETE", this.p(`/members/${seg(userId)}`)),
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
  audit(q: { limit?: number; before?: number; type?: string } = {}): Promise<Page<AuditEntry>> {
    return this.t.list(this.p("/audit"), q);
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
export { watchIdle, sessionIdOf, type IdleWatch, type IdleWatchOptions, type IdleSource, type IdleWarning, type SessionState, type SessionEnd } from "./idle.js";

export default QAuth;

/** `?client=…` for the session calls ("" when no client is given). */
function clientQuery(clientId?: string): string {
  return clientId ? `?client=${encodeURIComponent(clientId)}` : "";
}
