// Secrets at rest in D1: AES-256-GCM under PIP_SECRETS_KEY, WebCrypto only. A stored value is
// `v1:<base64 iv>:<base64 ciphertext and tag>`, with a fresh random 12-byte IV each time. What it
// belongs to (its row and column) is authenticated with it, so a value copied to another row or
// column doesn't decrypt.

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** PIP_SECRETS_KEY as a key: base64 of exactly 32 bytes. Throws on anything else. */
export async function importSecretsKey(base64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = Uint8Array.fromBase64(base64.trim());
  } catch {
    throw new Error('PIP_SECRETS_KEY is not base64');
  }
  if (raw.length !== KEY_BYTES) {
    throw new Error(`PIP_SECRETS_KEY must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `plaintext` as stored. `context` says what it belongs to, and has to be given again to read it. */
export async function encryptSecret(
  key: CryptoKey,
  plaintext: string,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}:${iv.toBase64()}:${new Uint8Array(sealed).toBase64()}`;
}

/**
 * A stored value read back. Throws when it isn't one, or was made with another key or for another
 * context, or has been changed; the error never has the value in it.
 */
export async function decryptSecret(
  key: CryptoKey,
  stored: string,
  context: string,
): Promise<string> {
  const [version, iv, sealed, ...rest] = stored.split(':');
  if (version !== VERSION || !iv || !sealed || rest.length > 0) {
    throw new Error('not a stored secret');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.fromBase64(iv),
        additionalData: new TextEncoder().encode(context),
      },
      key,
      Uint8Array.fromBase64(sealed),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('the stored secret does not decrypt');
  }
}
