/** Marks, in sessionStorage, that signing in again was tried once already. */
export const REAUTH_KEY = 'pip:reauth';

/** Access drops this hostname's session here; the next page load signs in again. */
export const LOGOUT_PATH = '/cdn-cgi/access/logout';

/** How `/api/me` failed: the Worker turned the Access session down, or no answer came back. */
export type MeFailure = 'unauthorized' | 'unreachable';

/** What to do about it: drop the session, load the page again, or neither and show the error. */
export type Recovery = 'logout' | 'reload' | 'none';

/** The part of `Storage` the guard uses. */
export interface GuardStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/**
 * Decides how to recover from a failed `/api/me`, and marks that it did. Once only, until
 * `recovered`: with the mark already there, or nowhere to keep one, the answer is `none`, so a
 * session the Worker keeps turning down can't send the page round in a loop.
 *
 * A 401 means Access let the request through and the Worker didn't (a session from before the team
 * domain changed, say), so a reload would bring the same session back: it has to be dropped. No
 * answer at all is most often Access redirecting to its sign-in on another origin, which `fetch`
 * can't follow and a page load can.
 */
export function recover(failure: MeFailure, store: GuardStore | undefined): Recovery {
  try {
    if (!store || store.getItem(REAUTH_KEY) !== null) {
      return 'none';
    }
    store.setItem(REAUTH_KEY, '1');
    if (store.getItem(REAUTH_KEY) === null) {
      return 'none';
    }
  } catch {
    return 'none';
  }
  return failure === 'unauthorized' ? 'logout' : 'reload';
}

/** `/api/me` answered: the next failure may try to recover again. */
export function recovered(store: GuardStore | undefined): void {
  try {
    store?.removeItem(REAUTH_KEY);
  } catch {
    // Nothing was kept, so there is nothing to clear.
  }
}
