/**
 * Offline access-token verification: your backend checks a person's access
 * token itself, with the issuer's published keys, without calling qAuth.
 *
 *   const verifier = new Verifier({
 *     issuers: ["https://acme.qapps.dev"],   // each tenant has its own issuer
 *     clientIds: ["web-client-id"],           // the apps whose tokens your API accepts
 *   });
 *   const who = await verifier.verify(accessToken); // Identity, or throws QAuthError (401)
 *
 * A token is accepted only when: its `iss` is one of `issuers` (exact match;
 * no other issuer is ever contacted); it is signed with one of that issuer's
 * keys (from discovery's jwks_uri) with a public-key algorithm the issuer
 * publishes (never `none` or HMAC); it is within exp/nbf (with leeway); and it
 * was issued to one of `clientIds` (its `client_id`). Only ACCESS tokens pass:
 * a token carrying ID-token claims (azp, at_hash, nonce, auth_time, sid, amr) or a
 * header `typ` other than JWT / at+jwt is refused (NOT_ACCESS_TOKEN). Identify the person by `subject` (plus `issuer`),
 * never by email or name.
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { QAuthError, TokenErrorCode } from "./errors.js";

/** The public-key algorithms a token may use. */
const ASYMMETRIC = new Set(["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "Ed25519"]);
/** Header `typ` values an access token may carry (or none). */
const ACCESS_TYPES = new Set(["jwt", "at+jwt", "application/at+jwt"]);
/** Claims only ID tokens carry: a token with any of them is not an access token. */
const ID_TOKEN_CLAIMS = ["azp", "at_hash", "nonce", "auth_time", "sid", "amr"];
/** When the issuer's discovery names no algorithms. */
const DEFAULT_ALGS = ["RS256", "ES256", "EdDSA"];

export interface VerifierOptions {
  /** Accepted issuers (`iss`), exactly as the tokens carry them, e.g. https://acme.qapps.dev */
  issuers: string | string[];
  /** Clients whose tokens are accepted (checked against `client_id`). At least one. */
  clientIds: string[];
  /** Also require this audience (any of them, when several). Unset = any audience: only `clientIds` restricts. */
  audience?: string | string[];
  /** Leeway for exp/nbf/iat in seconds. Default 60. */
  clockToleranceSeconds?: number;
  /** Narrow the algorithms further (public-key ones only). Default: what the issuer's discovery publishes. */
  algorithms?: string[];
  /** Your own fetch for discovery and keys (tests, proxies). Default: the global fetch. */
  fetch?: typeof fetch;
  /** Timeout for discovery and key fetches, in ms. Default 5000. */
  timeoutMs?: number;
  /** On a token whose key id is unknown, refetch the keys at most this often (seconds). Default 30. */
  keysCooldownSeconds?: number;
  /** Refetch the keys after this long even when every key id is known (seconds). Default 600. */
  keysMaxAgeSeconds?: number;
  /** Keep each issuer's discovery document this long (seconds). Default 3600. */
  discoveryCacheSeconds?: number;
  /** After a failed discovery or key fetch, answer 503 at once (without fetching) for this long (seconds). Default 5. */
  failureBackoffSeconds?: number;
  /**
   * Fixed keys instead of discovery (tests, pinned keys): a JWKS or a jose key
   * getter. Used for every accepted issuer; algorithms default to RS256, ES256, EdDSA.
   */
  keys?: JSONWebKeySet | JWTVerifyGetKey;
  /** The current time (tests). */
  now?: () => Date;
}

/** The person (or app) an access token speaks for. */
export interface Identity {
  /** The person's id at the issuer: key everything on this (with `issuer`). */
  subject: string;
  /** The client the token was issued to. */
  clientId: string;
  issuer: string;
  /**
   * Not set for qAuth access tokens: they carry no `sid` (a token with one is
   * an ID token and is refused). Read the session id from the ID token
   * (`sessionIdOf(idToken)`) where you need it.
   */
  sessionId?: string;
  expiresAt: Date;
  /** Every claim of the token. */
  claims: JWTPayload;
  /** The access token itself, for calls to qAuth as this person. Never send it to the browser. */
  token: string;
}

type IssuerKeys = { keys: JWTVerifyGetKey; algorithms: string[] };

class KeysFetchFailed extends Error {}

const refuse = (code: TokenErrorCode, message: string, cause?: unknown) =>
  new QAuthError(code === TokenErrorCode.KeysUnavailable ? 503 : 401, code, message, undefined, undefined, undefined, cause ? { cause } : undefined);

export class Verifier {
  private readonly issuers: Set<string>;
  private readonly clients: Set<string>;
  private readonly f: typeof fetch;
  private readonly leeway: number;
  private readonly narrow?: string[];
  private readonly fixed?: JWTVerifyGetKey;
  private readonly discovered = new Map<string, { at: number; p: Promise<IssuerKeys>; failed?: boolean }>();

  constructor(private readonly o: VerifierOptions) {
    const iss = typeof o?.issuers === "string" ? [o.issuers] : (o?.issuers ?? []);
    if (!iss.length || iss.some((i) => !i)) throw new Error("Verifier: at least one issuer is required");
    if (!o.clientIds?.length || o.clientIds.some((c) => !c)) throw new Error("Verifier: at least one client id is required");
    if (o.algorithms?.some((a) => !ASYMMETRIC.has(a))) throw new Error("Verifier: only public-key algorithms are allowed");
    if (o.algorithms && !o.algorithms.length) throw new Error("Verifier: algorithms must not be empty");
    for (const i of iss) {
      if (!secureUrl(i)) throw new Error(`Verifier: issuer ${i} must be an https:// address (http:// only for localhost)`);
    }
    this.issuers = new Set(iss);
    this.clients = new Set(o.clientIds);
    this.f = o.fetch ?? globalThis.fetch.bind(globalThis);
    this.leeway = o.clockToleranceSeconds ?? 60;
    this.narrow = o.algorithms;
    if (o.keys) this.fixed = typeof o.keys === "function" ? o.keys : createLocalJWKSet(o.keys);
  }

  /** Check an access token. Resolves to who it speaks for; throws QAuthError (401, or 503 when keys can't be fetched). */
  async verify(token: string): Promise<Identity> {
    if (!token) throw refuse(TokenErrorCode.Missing, "No access token was sent.");
    let iss: unknown;
    let alg: unknown;
    let typ: unknown;
    try {
      iss = decodeJwt(token).iss;
      ({ alg, typ } = decodeProtectedHeader(token));
    } catch (e) {
      throw refuse(TokenErrorCode.Malformed, "The access token is not a signed token.", e);
    }
    if (typeof alg !== "string" || !ASYMMETRIC.has(alg)) {
      throw refuse(TokenErrorCode.BadSignature, "The access token is not signed with a public-key algorithm.");
    }
    if (typ !== undefined && !(typeof typ === "string" && ACCESS_TYPES.has(typ.toLowerCase()))) {
      throw refuse(TokenErrorCode.NotAccessToken, "This is not an access token.");
    }
    // exact match BEFORE any fetch: an unknown issuer is never contacted
    if (typeof iss !== "string" || !this.issuers.has(iss)) {
      throw refuse(TokenErrorCode.WrongIssuer, "The access token is from an issuer this service does not accept.");
    }
    const ik = await this.issuerKeys(iss);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, ik.keys, {
        issuer: iss,
        audience: this.o.audience,
        algorithms: ik.algorithms,
        requiredClaims: ["exp", "sub"],
        clockTolerance: this.leeway,
        currentDate: this.o.now?.(),
      }));
    } catch (e) {
      throw mapJoseError(e);
    }
    if (typeof payload.sub !== "string" || !payload.sub) throw refuse(TokenErrorCode.Malformed, "The access token names no person (sub).");
    // ID tokens are signed by the same keys and carry client_id too: refuse anything with ID-token claims
    if (ID_TOKEN_CLAIMS.some((c) => c in payload)) throw refuse(TokenErrorCode.NotAccessToken, "This is not an access token.");
    const client = typeof payload.client_id === "string" && payload.client_id ? payload.client_id : undefined;
    if (!client) throw refuse(TokenErrorCode.WrongClient, "The access token names no client (client_id).");
    if (!this.clients.has(client)) throw refuse(TokenErrorCode.WrongClient, "The access token was issued to an app this service does not accept.");
    return {
      subject: payload.sub as string,
      clientId: client,
      issuer: iss,
      expiresAt: new Date((payload.exp as number) * 1000),
      claims: payload,
      token,
    };
  }

  /**
   * Framework-free: the Bearer token of a fetch-style Request (Next.js route
   * handlers, Hono, Deno, Bun, workers), verified. Throws QAuthError; turn it
   * into an answer with `errorResponse(e)`.
   */
  authenticate(request: Request): Promise<Identity> {
    return this.verify(bearerToken(request.headers.get("authorization")) ?? "");
  }

  /**
   * Express / Connect middleware: verifies the Bearer token and puts the
   * Identity on `req.identity` (read it with `identityOf(req)`); otherwise
   * answers 401 with WWW-Authenticate (503 when the issuer's keys can't be
   * fetched). `optional: true` lets requests without a token through (no identity).
   */
  middleware(opts: { optional?: boolean } = {}): ConnectMiddleware {
    return (req, res, next) => {
      const token = bearerToken(headerOf(req, "authorization"));
      if (!token && opts.optional) return next();
      this.verify(token ?? "").then(
        (id) => {
          req.identity = id;
          next();
        },
        (e) => {
          if (!(e instanceof QAuthError)) return next(e);
          const a = answerFor(e);
          res.statusCode = a.status;
          for (const [k, v] of Object.entries(a.headers)) res.setHeader(k, v);
          res.end(a.body);
        },
      );
    };
  }

  /** Drop the cached discovery and keys of every issuer (they are fetched again on the next token). */
  reset(): void {
    this.discovered.clear();
  }

  private nowMs(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }

  private backoffMs(): number {
    return (this.o.failureBackoffSeconds ?? 5) * 1000;
  }

  private issuerKeys(iss: string): Promise<IssuerKeys> {
    if (this.fixed) {
      return Promise.resolve({ keys: this.fixed, algorithms: this.narrow ?? DEFAULT_ALGS });
    }
    const now = this.nowMs();
    const hit = this.discovered.get(iss);
    const ttl = hit?.failed ? this.backoffMs() : (this.o.discoveryCacheSeconds ?? 3600) * 1000;
    if (hit && now - hit.at < ttl) return hit.p;
    const p = this.discover(iss);
    const entry: { at: number; p: Promise<IssuerKeys>; failed?: boolean } = { at: now, p };
    this.discovered.set(iss, entry);
    p.catch(() => {
      // a failure is kept only for the short backoff: a down issuer answers 503 fast
      entry.failed = true;
      entry.at = this.nowMs();
    });
    return p;
  }

  private async discover(iss: string): Promise<IssuerKeys> {
    const timeout = this.o.timeoutMs ?? 5000;
    let doc: { issuer?: unknown; jwks_uri?: unknown; id_token_signing_alg_values_supported?: unknown };
    try {
      const res = await this.f(`${iss.replace(/\/+$/, "")}/.well-known/openid-configuration`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
        redirect: "manual",
      });
      if (!res.ok) throw new Error(`discovery answered HTTP ${res.status}${res.status >= 300 && res.status < 400 ? " (redirect not followed)" : ""}`);
      doc = (await res.json()) as typeof doc;
    } catch (e) {
      throw refuse(TokenErrorCode.KeysUnavailable, "Could not read the issuer's sign-in settings. Please try again.", e);
    }
    if (doc.issuer !== iss) {
      throw refuse(TokenErrorCode.KeysUnavailable, "The issuer's discovery document names another issuer.");
    }
    if (typeof doc.jwks_uri !== "string" || !doc.jwks_uri) {
      throw refuse(TokenErrorCode.KeysUnavailable, "The issuer's discovery document names no keys address.");
    }
    if (!secureUrl(doc.jwks_uri)) {
      throw refuse(TokenErrorCode.KeysUnavailable, "The issuer's keys address is not https://.");
    }
    const published = Array.isArray(doc.id_token_signing_alg_values_supported)
      ? (doc.id_token_signing_alg_values_supported as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    let algorithms = (published.length ? published : DEFAULT_ALGS).filter((a) => ASYMMETRIC.has(a));
    if (this.narrow) algorithms = algorithms.filter((a) => this.narrow!.includes(a));
    if (!algorithms.length) {
      throw refuse(TokenErrorCode.KeysUnavailable, "The issuer publishes no public-key algorithm this service accepts.");
    }
    const remote = createRemoteJWKSet(new URL(doc.jwks_uri), {
      timeoutDuration: timeout,
      cooldownDuration: (this.o.keysCooldownSeconds ?? 30) * 1000,
      cacheMaxAge: (this.o.keysMaxAgeSeconds ?? 600) * 1000,
      // never follow a redirect; the fetch is jose's own (with its timeout), not tied to any caller
      [customFetch]: (url: string, init: RequestInit) => this.f(url, { ...init, redirect: "manual" }),
    });
    // a failure to FETCH the keys is "unavailable" (503), not a bad token;
    // after one, answer at once for the backoff instead of fetching again
    let failedAt = -Infinity;
    const keys: JWTVerifyGetKey = async (header, token) => {
      if (this.nowMs() - failedAt < this.backoffMs()) {
        const cached = remote.fresh ? remote.jwks()?.keys : undefined;
        if (!cached || !header.kid || !cached.some((k) => k.kid === header.kid)) {
          throw new KeysFetchFailed("the issuer's keys could not be fetched a moment ago");
        }
      }
      try {
        return await remote(header, token);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "ERR_JWKS_NO_MATCHING_KEY" || code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS") throw e;
        failedAt = this.nowMs();
        throw new KeysFetchFailed("could not fetch the issuer's keys", { cause: e });
      }
    };
    return { keys, algorithms };
  }
}

/** https://, or http:// on this machine only (local development). */
export function secureUrl(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function mapJoseError(e: unknown): QAuthError {
  if (e instanceof QAuthError) return e;
  if (e instanceof KeysFetchFailed) return refuse(TokenErrorCode.KeysUnavailable, "Could not fetch the issuer's keys. Please try again.", e);
  const code = (e as { code?: string }).code;
  const claim = (e as { claim?: string }).claim;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return refuse(TokenErrorCode.Expired, "The access token has expired.", e);
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (claim === "iss") return refuse(TokenErrorCode.WrongIssuer, "The access token is from an issuer this service does not accept.", e);
      if (claim === "aud") return refuse(TokenErrorCode.WrongAudience, "The access token is not meant for this service.", e);
      if (claim === "nbf" || claim === "iat") return refuse(TokenErrorCode.NotYetValid, "The access token is not valid yet.", e);
      return refuse(TokenErrorCode.Malformed, `The access token is missing or has a wrong ${claim ?? "claim"}.`, e);
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JOSE_ALG_NOT_ALLOWED":
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
    case "ERR_JOSE_NOT_SUPPORTED":
      return refuse(TokenErrorCode.BadSignature, "The access token's signature could not be verified.", e);
    default:
      return refuse(TokenErrorCode.Malformed, "The access token could not be read.", e);
  }
}

/** The token of an `Authorization: Bearer <token>` header (undefined when there is none). */
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = /^Bearer[ \t]+([^\s]+)[ \t]*$/i.exec(header ?? "");
  return m?.[1];
}

/** The minimal request/response shapes the middleware needs (Express, Connect, node:http). */
export interface MiddlewareRequest {
  headers: Record<string, string | string[] | undefined>;
  identity?: Identity;
}
export interface MiddlewareResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}
export type ConnectMiddleware = (req: MiddlewareRequest, res: MiddlewareResponse, next: (err?: unknown) => void) => void;

/** The Identity the middleware put on the request (undefined when none). */
export function identityOf(req: object): Identity | undefined {
  return (req as { identity?: Identity }).identity;
}

function headerOf(req: MiddlewareRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** The answer for a refusal: status, headers (WWW-Authenticate on 401, Retry-After when known) and the JSON envelope. */
function answerFor(e: QAuthError): { status: number; headers: Record<string, string>; body: string } {
  const status = e.status || 502;
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (status === 401) {
    // RFC 6750: no error attribute when no credentials were sent
    headers["www-authenticate"] =
      e.code === TokenErrorCode.Missing
        ? 'Bearer realm="api"'
        : `Bearer realm="api", error="invalid_token", error_description="${e.code}"`;
  }
  if (e.retryAfter !== undefined) headers["retry-after"] = String(e.retryAfter);
  const message = status === 401 ? "Please sign in." : e.message;
  const body = JSON.stringify({ success: false, status, message: e.code, error: { code: e.code, message } });
  return { status, headers, body };
}

/**
 * A fetch-style Response for a refusal from `authenticate` (401 + WWW-Authenticate,
 * or 503). Anything that is not a QAuthError is rethrown.
 */
export function errorResponse(e: unknown): Response {
  if (!(e instanceof QAuthError)) throw e;
  const a = answerFor(e);
  return new Response(a.body, { status: a.status, headers: a.headers });
}
