import type { Unauthorized } from '../shared/api';

/** Marks, in sessionStorage, that the page was reloaded once already to sign in again. */
export const REAUTH_KEY = 'pip:reauth';

/** Access drops this hostname's session here; the next page load signs in again. */
export const LOGOUT_PATH = '/cdn-cgi/access/logout';

/** The part of `Storage` the guard uses. */
export interface GuardStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/**
 * Whether to reload the page after `/api/me` got no answer, marking that it did. No answer is most
 * often Access redirecting to its sign-in on another origin, which `fetch` can't follow and a page
 * load can. Once only, until `recovered`: with the mark already there, or nowhere to keep one, the
 * answer is no, so the page can't reload in a loop.
 *
 * A reload is all the page does by itself. A 401 is never followed to Access's logout: that left
 * the installed app on an Access page with no way back, at every launch.
 */
export function reloadOnce(store: GuardStore | undefined): boolean {
  try {
    if (!store || store.getItem(REAUTH_KEY) !== null) {
      return false;
    }
    store.setItem(REAUTH_KEY, '1');
    return store.getItem(REAUTH_KEY) !== null;
  } catch {
    return false;
  }
}

/** `/api/me` answered: the next failure may reload again. */
export function recovered(store: GuardStore | undefined): void {
  try {
    store?.removeItem(REAUTH_KEY);
  } catch {
    // Nothing was kept, so there is nothing to clear.
  }
}

/**
 * Why the Worker turned the request down, from a 401's body. Undefined when the body isn't the
 * Worker's: an older Worker's bare text, or a 401 from something in front of it.
 */
export function unauthorized(body: unknown): Unauthorized | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const { code, claim, reason, token_iss, token_aud, expected_iss } = body as Record<
    string,
    unknown
  >;
  if (typeof code !== 'string') {
    return undefined;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const audience =
    Array.isArray(token_aud) && token_aud.every((item) => typeof item === 'string')
      ? (token_aud as string[])
      : text(token_aud);
  return {
    error: 'Unauthorized',
    code,
    claim: text(claim),
    reason: text(reason),
    token_iss: text(token_iss),
    token_aud: audience,
    expected_iss: text(expected_iss),
  };
}

/** The reason as rows for the error screen, a label and its value; only what the Worker said. */
export function reasonRows(why: Unauthorized): [label: string, value: string][] {
  const audience = typeof why.token_aud === 'string' ? why.token_aud : why.token_aud?.join(', ');
  const rows: [string, string | undefined][] = [
    ['code', why.code],
    ['claim', why.claim && (why.reason ? `${why.claim} (${why.reason})` : why.claim)],
    ['token issuer', why.token_iss],
    ['expected issuer', why.expected_iss],
    ['token audience', audience],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}
