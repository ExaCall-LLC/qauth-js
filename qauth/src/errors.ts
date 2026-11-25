/**
 * The SDK's one error type. Every refusal (a qAuth answer, a token this
 * backend refuses, qAuth out of reach) is a QAuthError with:
 *
 * - `status`: the HTTP status to answer with (0 when qAuth could not be reached),
 * - `code`: stable, e.g. FORBIDDEN, RATE_LIMITED, TOKEN_EXPIRED,
 * - `message`: plain words you can show,
 * - `requestId`: qAuth's request id, for support (when qAuth answered),
 * - `retryAfter`: seconds to wait before trying again (on 429 and 503 when qAuth says so).
 */
export class QAuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly fields?: Record<string, string[]>;
  /** Seconds to wait before trying again (from Retry-After). */
  readonly retryAfter?: number;
  /**
   * What came with the refusal, when qAuth sends something (e.g. the
   * sessions to choose from with a 409 `SESSION_LIMIT`).
   */
  data?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    fields?: Record<string, string[]>,
    retryAfter?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "QAuthError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

/**
 * Codes of a token this backend refused (status 401, except KEYS_UNAVAILABLE:
 * 503, the issuer's keys could not be fetched).
 */
export const TokenErrorCode = {
  /** No token was sent. */
  Missing: "TOKEN_MISSING",
  /** Not a signed JWT. */
  Malformed: "TOKEN_MALFORMED",
  Expired: "TOKEN_EXPIRED",
  /** nbf / iat in the future (beyond the clock leeway). */
  NotYetValid: "TOKEN_NOT_YET_VALID",
  /** iss is not one of the accepted issuers. */
  WrongIssuer: "WRONG_ISSUER",
  /** Issued to a client this backend does not accept, or names none (client_id). */
  WrongClient: "WRONG_CLIENT",
  /** An ID token (azp, at_hash, nonce, auth_time) or another token type, not an access token. */
  NotAccessToken: "NOT_ACCESS_TOKEN",
  /** The audience this backend requires is missing. */
  WrongAudience: "WRONG_AUDIENCE",
  /** Signature, key or algorithm refused. */
  BadSignature: "BAD_SIGNATURE",
  /** The issuer's discovery or keys could not be fetched. */
  KeysUnavailable: "KEYS_UNAVAILABLE",
} as const;
export type TokenErrorCode = (typeof TokenErrorCode)[keyof typeof TokenErrorCode];

/** Retry-After as seconds: either delta-seconds or an HTTP date. */
export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const at = Date.parse(s);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
