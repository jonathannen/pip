import { env } from 'cloudflare:workers';
import { createMiddleware } from 'hono/factory';
import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify } from 'jose';
import type { Unauthorized } from '../shared/api';

/** Who Cloudflare Access let through: a person, or a service token for an agent. */
export interface Identity {
  email: string;
  /** When the Access token expires, in ms since the epoch; null in `vite dev`, which has no Access. */
  expiresAt: number | null;
  serviceToken: boolean;
}

interface AccessPayload extends JWTPayload {
  email?: string;
  /** Set instead of email when a service token authenticated. */
  common_name?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** Why a request was turned down: the 401's body but for its `error`, and what is logged. */
export type Rejection = Omit<Unauthorized, 'error'>;

/**
 * Why jose turned a token down: its error code and, when a claim failed, which one and how. Only
 * these: the error itself carries the token's payload.
 */
function joseFailure(error: unknown): Pick<Rejection, 'code' | 'claim' | 'reason'> {
  if (!(error instanceof errors.JOSEError)) {
    return { code: error instanceof Error ? error.name : 'unknown' };
  }
  if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
    return { code: error.code, claim: error.claim, reason: error.reason };
  }
  return { code: error.code };
}

/**
 * The issuer and audience a token claims, read without verifying it, beside the issuer it has to
 * have: enough to tell a token from another team domain or another Access app. Nothing else of the
 * token; nothing at all of one that doesn't decode.
 */
function tokenClaims(token: string): Pick<Rejection, 'token_iss' | 'token_aud' | 'expected_iss'> {
  const expected = { expected_iss: env.ACCESS_TEAM_DOMAIN };
  try {
    const { iss, aud } = decodeJwt(token);
    const strings = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === 'string');
    return {
      ...(typeof iss === 'string' && { token_iss: iss }),
      ...((typeof aud === 'string' || strings(aud)) && { token_aud: aud }),
      ...expected,
    };
  } catch {
    return expected;
  }
}

/**
 * Verifies the Cf-Access-Jwt-Assertion header. Access already gates the hostname; this stops
 * anything that reaches the Worker another way.
 */
export async function verifyAccess(request: Request): Promise<Identity | Rejection> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    // `vite dev` has no Access in front. Dead code in production builds.
    if (import.meta.env.DEV) {
      return { email: 'dev@localhost', expiresAt: null, serviceToken: false };
    }
    return { code: 'missing_header' };
  }

  jwks ??= createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.ACCESS_TEAM_DOMAIN));
  try {
    const { payload } = await jwtVerify<AccessPayload>(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    if (payload.email) {
      return { email: payload.email, expiresAt, serviceToken: false };
    }
    if (payload.common_name) {
      return { email: payload.common_name, expiresAt, serviceToken: true };
    }
    return { code: 'no_identity', ...tokenClaims(token) };
  } catch (error) {
    return { ...joseFailure(error), ...tokenClaims(token) };
  }
}

export const requireAccess = createMiddleware<{ Variables: { identity: Identity } }>(
  async (c, next) => {
    const verified = await verifyAccess(c.req.raw);
    if ('code' in verified) {
      // Says which check failed, in Workers Logs and to the caller, who holds the token already.
      console.warn('pip: Access token rejected', verified);
      return c.json<Unauthorized>({ error: 'Unauthorized', ...verified }, 401);
    }
    c.set('identity', verified);
    await next();
  },
);
