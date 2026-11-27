import { env } from 'cloudflare:workers';
import { createMiddleware } from 'hono/factory';
import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

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

/**
 * Why a token was turned down, for Workers Logs: jose's error code and, when a claim failed, which
 * one and how. Only these: the error itself carries the token's payload.
 */
function rejection(error: unknown): Record<string, string> {
  if (!(error instanceof errors.JOSEError)) {
    return { code: error instanceof Error ? error.name : 'unknown' };
  }
  if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
    return { code: error.code, claim: error.claim, reason: error.reason };
  }
  return { code: error.code };
}

/**
 * Verifies the Cf-Access-Jwt-Assertion header. Access already gates the hostname; this stops
 * anything that reaches the Worker another way.
 */
export async function verifyAccess(request: Request): Promise<Identity | undefined> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    // `vite dev` has no Access in front. Dead code in production builds.
    if (import.meta.env.DEV) {
      return { email: 'dev@localhost', expiresAt: null, serviceToken: false };
    }
    console.warn('pip: Access token rejected', { code: 'missing_header' });
    return undefined;
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
    console.warn('pip: Access token rejected', { code: 'no_identity' });
  } catch (error) {
    // Fall through to unauthorised, saying which check failed and nothing of the token.
    console.warn('pip: Access token rejected', rejection(error));
  }
  return undefined;
}

export const requireAccess = createMiddleware<{ Variables: { identity: Identity } }>(
  async (c, next) => {
    const identity = await verifyAccess(c.req.raw);
    if (!identity) {
      return c.text('Unauthorized', 401);
    }
    c.set('identity', identity);
    await next();
  },
);
