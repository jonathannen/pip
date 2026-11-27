import { describe, expect, it } from 'vitest';
import type { GuardStore } from '../src/web/reauth';
import { REAUTH_KEY, reasonRows, recovered, reloadOnce, unauthorized } from '../src/web/reauth';

/** sessionStorage, as far as the guard uses it. */
function memoryStore(): GuardStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('reauth', () => {
  it('reloads once only, until /api/me answers', () => {
    const store = memoryStore();
    expect(reloadOnce(store)).toBe(true);
    expect(store.items.has(REAUTH_KEY)).toBe(true);
    expect(reloadOnce(store)).toBe(false);
    recovered(store);
    expect(store.items.has(REAUTH_KEY)).toBe(false);
    expect(reloadOnce(store)).toBe(true);
  });

  it('does not reload without somewhere to keep the mark', () => {
    const throws = (): never => {
      throw new Error('storage is off');
    };
    expect(reloadOnce(undefined)).toBe(false);
    expect(reloadOnce({ getItem: throws, removeItem: throws, setItem: throws })).toBe(false);
    // Takes the write and keeps nothing.
    expect(reloadOnce({ getItem: () => null, removeItem: () => {}, setItem: () => {} })).toBe(
      false,
    );
    expect(() => recovered({ getItem: throws, removeItem: throws, setItem: throws })).not.toThrow();
    expect(() => recovered(undefined)).not.toThrow();
  });

  it("reads the Worker's reason from a 401, and lays it out for the error screen", () => {
    const why = unauthorized({
      error: 'Unauthorized',
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'iss',
      reason: 'check_failed',
      token_iss: 'https://old-team.cloudflareaccess.com',
      token_aud: ['aud-tag'],
      expected_iss: 'https://team.cloudflareaccess.com',
      email: 'not shown',
    });
    expect(why && reasonRows(why)).toEqual([
      ['code', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
      ['claim', 'iss (check_failed)'],
      ['token issuer', 'https://old-team.cloudflareaccess.com'],
      ['expected issuer', 'https://team.cloudflareaccess.com'],
      ['token audience', 'aud-tag'],
    ]);
    const bare = unauthorized({ error: 'Unauthorized', code: 'missing_header', token_aud: 7 });
    expect(bare && reasonRows(bare)).toEqual([['code', 'missing_header']]);
  });

  it("has no reason for a 401 that isn't the Worker's", () => {
    // An older Worker's bare text doesn't parse as JSON, which the page reads as null.
    for (const body of [null, 'Unauthorized', 7, {}, { error: 'Unauthorized' }, { code: 401 }]) {
      expect(unauthorized(body)).toBeUndefined();
    }
  });
});
