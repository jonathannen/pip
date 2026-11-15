import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { exchangeCode, gmailEnabled, googleAuthUrl } from '../lib/gmail';
import type { Identity } from './access';
import { requireAccess } from './access';

/** The Google refresh token `/auth/google` stored; null until Gmail is connected. */
export async function getRefreshToken(): Promise<string | null> {
  const row = await env.DB.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').first<{
    refresh_token: string;
  }>();
  return row?.refresh_token ?? null;
}

/**
 * When Gmail was connected, for Settings; null when it isn't, or when the table can't be read (its
 * migration hasn't been applied).
 */
export async function gmailConnectedAt(): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT updated_at FROM google_auth WHERE id = 1').first<{
      updated_at: string;
    }>();
    return row?.updated_at ?? null;
  } catch {
    return null;
  }
}

async function storeRefreshToken(refreshToken: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO google_auth (id, refresh_token) VALUES (1, ?1)
     ON CONFLICT (id) DO UPDATE SET
       refresh_token = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(refreshToken)
    .run();
}

const STATE_COOKIE = 'google_oauth_state';

/** Where Google sends the browser back to: the callback below, on whatever host served the request. */
const redirectUri = (requestUrl: string) => new URL('/auth/google/callback', requestUrl).toString();

/**
 * `/auth/google`: the one-time Google sign-in that connects Gmail for the draft tools
 * (src/lib/gmail.ts). Settings links to it; the callback stores the refresh token in D1.
 */
export const google = new Hono<{ Variables: { identity: Identity } }>()
  .use(requireAccess)
  .get('/', (c) => {
    if (!gmailEnabled(env)) {
      return c.text('Gmail is off: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set', 503);
    }
    // The state goes out in a short-lived cookie and must come back on the callback's URL.
    const state = crypto.randomUUID();
    setCookie(c, STATE_COOKIE, state, {
      path: '/auth/google',
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      maxAge: 600,
    });
    return c.redirect(googleAuthUrl(env, redirectUri(c.req.url), state));
  })
  .get('/callback', async (c) => {
    const state = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/auth/google' });
    const error = c.req.query('error');
    if (error) {
      return c.text(`Google sign-in failed: ${error}`, 400);
    }
    const code = c.req.query('code');
    if (!code || !state || c.req.query('state') !== state) {
      return c.text('Google sign-in failed: start again at /auth/google', 400);
    }
    try {
      await storeRefreshToken(await exchangeCode(env, code, redirectUri(c.req.url)));
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 502);
    }
    // Back to Settings, whose Gmail card now says it's connected.
    return c.redirect('/settings');
  });
