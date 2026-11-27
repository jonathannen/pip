import { describe, expect, it } from 'vitest';
import type { GuardStore } from '../src/web/reauth';
import { REAUTH_KEY, recover, recovered } from '../src/web/reauth';

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
  it('drops the session on a 401 and reloads when nothing answered, marking that it did', () => {
    const store = memoryStore();
    expect(recover('unauthorized', store)).toBe('logout');
    expect(store.items.has(REAUTH_KEY)).toBe(true);
    expect(recover('unreachable', memoryStore())).toBe('reload');
  });

  it('recovers once only, until /api/me answers', () => {
    const store = memoryStore();
    expect(recover('unauthorized', store)).toBe('logout');
    expect(recover('unauthorized', store)).toBe('none');
    expect(recover('unreachable', store)).toBe('none');
    recovered(store);
    expect(store.items.has(REAUTH_KEY)).toBe(false);
    expect(recover('unreachable', store)).toBe('reload');
  });

  it('does nothing without somewhere to keep the mark', () => {
    const throws = (): never => {
      throw new Error('storage is off');
    };
    expect(recover('unauthorized', undefined)).toBe('none');
    expect(recover('unauthorized', { getItem: throws, removeItem: throws, setItem: throws })).toBe(
      'none',
    );
    // Takes the write and keeps nothing.
    expect(
      recover('unauthorized', { getItem: () => null, removeItem: () => {}, setItem: () => {} }),
    ).toBe('none');
    expect(() => recovered({ getItem: throws, removeItem: throws, setItem: throws })).not.toThrow();
    expect(() => recovered(undefined)).not.toThrow();
  });
});
