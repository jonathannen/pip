import { env } from 'cloudflare:workers';
import { createMiddleware } from 'hono/factory';
import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, jwtVerify } from 'jose';

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
 * Verifies the Cf-Access-Jwt-Assertion header. Access already gates the hostname; this stops
 * anything that reaches the Worker another way.
 */
export async function verifyAccess(request: Request): Promise<Identity | undefined> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    // `vite dev` has no Access in front. Dead code in production builds.
    return import.meta.env.DEV
      ? { email: 'dev@localhost', expiresAt: null, serviceToken: false }
      : undefined;
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
  } catch {
    // Fall through to unauthorised.
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
