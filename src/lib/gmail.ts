// Gmail drafts over Google's REST API: list, read, create and update. There is no send here.
// Auth is OAuth: a refresh token from the one-time sign-in at /auth/google (src/worker/google.ts)
// is exchanged for a short-lived access token on each use.

export interface GmailEnv {
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
}

/** The one scope asked for: it covers drafts.list, drafts.get, drafts.create and drafts.update. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';

/** The most drafts `listDrafts` reads: each one costs a request of its own. */
export const DRAFTS_LIST_MAX = 20;

/** What a draft is written from. Each address is `ann@example.com` or `Ann <ann@example.com>`. */
export interface DraftFields {
  readonly to?: readonly string[] | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly bcc?: readonly string[] | undefined;
  readonly subject: string;
  readonly body: string;
}

/** A draft as `drafts_list` shows it. */
export interface DraftSummary {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly snippet: string;
}

/** A draft as `drafts_get` shows it. */
export interface Draft {
  readonly id: string;
  readonly thread_id: string | null;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly subject: string;
  /** The plain-text part, or the HTML part's text when there is no plain one. */
  readonly body: string;
}

/** A message part in Gmail's `format=full` and `format=metadata` responses. */
interface Part {
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly body?: { readonly data?: string };
  readonly parts?: readonly Part[];
}

interface DraftResponse {
  readonly id: string;
  readonly message?: {
    readonly threadId?: string;
    readonly snippet?: string;
    readonly payload?: Part;
  };
}

/** Whether the OAuth client's secrets are set, so Gmail can be connected and used. */
export function gmailEnabled(env: GmailEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function requireEnv(env: GmailEnv, name: keyof GmailEnv): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set (wrangler secret put ${name}, or .dev.vars locally)`);
  }
  return value;
}

/** Google's consent screen for the drafts scope, returning to `redirectUri` with `state`. */
export function googleAuthUrl(env: GmailEnv, redirectUri: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: requireEnv(env, 'GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    // Offline access with a forced consent screen, so Google returns a refresh token every time.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(
  env: GmailEnv,
  fields: Record<string, string>,
): Promise<{ access_token?: string; refresh_token?: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: requireEnv(env, 'GOOGLE_CLIENT_ID'),
      client_secret: requireEnv(env, 'GOOGLE_CLIENT_SECRET'),
      ...fields,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    const reason = [body.error, body.error_description].filter(Boolean).join(': ');
    throw new Error(`Google token request failed: ${reason || `HTTP ${res.status}`}`);
  }
  return body;
}

/** Exchanges the code Google sent to `redirectUri` for a refresh token. */
export async function exchangeCode(
  env: GmailEnv,
  code: string,
  redirectUri: string,
): Promise<string> {
  const { refresh_token } = await tokenRequest(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  if (!refresh_token) {
    throw new Error('Google returned no refresh token');
  }
  return refresh_token;
}

/** A short-lived access token for the stored refresh token. */
export async function accessToken(env: GmailEnv, refreshToken: string): Promise<string> {
  const { access_token } = await tokenRequest(env, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (!access_token) {
    throw new Error('Google returned no access token');
  }
  return access_token;
}

async function gmail<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DRAFTS_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`Gmail: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return (await res.json()) as T;
}

/** The first `limit` drafts Gmail lists (at most DRAFTS_LIST_MAX): who each is to, and its subject. */
export async function listDrafts(token: string, limit = DRAFTS_LIST_MAX): Promise<DraftSummary[]> {
  const max = Math.min(Math.max(limit, 1), DRAFTS_LIST_MAX);
  // The list only names the drafts, so each one's headers are a request of their own.
  const { drafts = [] } = await gmail<{ drafts?: { id: string }[] }>(token, `?maxResults=${max}`);
  return Promise.all(
    drafts.map(async ({ id }) => {
      const draft = await gmail<DraftResponse>(token, `/${encodeURIComponent(id)}?format=metadata`);
      return {
        id: draft.id,
        to: header(draft.message?.payload, 'To'),
        subject: header(draft.message?.payload, 'Subject'),
        snippet: decodeEntities(draft.message?.snippet ?? ''),
      };
    }),
  );
}

export async function getDraft(token: string, id: string): Promise<Draft> {
  const draft = await gmail<DraftResponse>(token, `/${encodeURIComponent(id)}?format=full`);
  const payload = draft.message?.payload;
  const plain = findPart(payload, 'text/plain');
  const html = plain ? undefined : findPart(payload, 'text/html');
  return {
    id: draft.id,
    thread_id: draft.message?.threadId ?? null,
    to: header(payload, 'To'),
    cc: header(payload, 'Cc'),
    bcc: header(payload, 'Bcc'),
    subject: header(payload, 'Subject'),
    body: plain ? partText(plain) : html ? htmlToText(partText(html)) : '',
  };
}

/** Creates a draft; returns its id. */
export async function createDraft(token: string, fields: DraftFields): Promise<{ id: string }> {
  const { id } = await gmail<DraftResponse>(token, '', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: encodeRaw(fields) } }),
  });
  return { id };
}

/** Replaces a draft's whole content with `fields`; returns its id. */
export async function updateDraft(
  token: string,
  id: string,
  fields: DraftFields,
): Promise<{ id: string }> {
  const draft = await gmail<DraftResponse>(token, `/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ message: { raw: encodeRaw(fields) } }),
  });
  return { id: draft.id };
}

/**
 * The RFC 822 message for a draft: plain text in UTF-8 with CRLF line ends, sent as base64 so long
 * lines and non-ASCII text are safe, with non-ASCII headers as RFC 2047 encoded words.
 */
export function buildMessage(fields: DraftFields): string {
  const body = new TextEncoder().encode(fields.body.replace(/\r?\n/g, '\r\n'));
  const lines: string[] = [];
  for (const [name, addresses] of [
    ['To', fields.to],
    ['Cc', fields.cc],
    ['Bcc', fields.bcc],
  ] as const) {
    if (addresses && addresses.length > 0) {
      // One address a line, so a line with encoded words stays within RFC 2047's 76 characters.
      lines.push(`${name}: ${addresses.map(encodeAddress).join(',\r\n ')}`);
    }
  }
  lines.push(
    `Subject: ${encodeHeaderText(fields.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    // Body lines are at most 76 characters.
    ...(base64(body).match(/.{1,76}/g) ?? []),
  );
  return `${lines.join('\r\n')}\r\n`;
}

/** The message as Gmail's `raw` field wants it: base64url. */
function encodeRaw(fields: DraftFields): string {
  return base64(new TextEncoder().encode(buildMessage(fields)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64UrlBytes(data: string): Uint8Array {
  const binary = atob(data.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** A header value on one line: as is when ASCII, else as RFC 2047 encoded words. */
function encodeHeaderText(value: string): string {
  const text = value.replace(/[\r\n]+/g, ' ');
  if (!/[^\x20-\x7e]/.test(text)) {
    return text;
  }
  // 39 bytes of text a word, split between characters: a line of one word and the header's name is
  // then within the 76 characters RFC 2047 allows.
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = '';
  for (const char of text) {
    if (encoder.encode(chunk + char).length > 39) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(encoder.encode(word))}?=`).join('\r\n ');
}

/** `Name <address>` with a non-ASCII name encoded; anything else as given. */
function encodeAddress(address: string): string {
  const text = address.replace(/[\r\n]+/g, ' ').trim();
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  if (!named?.[1] || !/[^\x20-\x7e]/.test(named[1])) {
    return text;
  }
  return `${encodeHeaderText(named[1].replace(/^"|"$/g, ''))}\r\n <${named[2]}>`;
}

/** A header's value, with any RFC 2047 encoded words decoded; '' when the header is absent. */
function header(part: Part | undefined, name: string): string {
  const found = part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return (found?.value ?? '')
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (word, charset: string, kind: string, data: string) => {
        try {
          const bytes =
            kind.toLowerCase() === 'b'
              ? base64UrlBytes(data)
              : Uint8Array.from(
                  data
                    .replaceAll('_', ' ')
                    .replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) =>
                      String.fromCharCode(Number.parseInt(hex, 16)),
                    ),
                  (char: string) => char.charCodeAt(0),
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return word;
        }
      },
    );
}

/** The first part of the given type that isn't an attachment, searching nested parts. */
function findPart(part: Part | undefined, mimeType: string): Part | undefined {
  if (!part) {
    return undefined;
  }
  if (part.mimeType === mimeType && !part.filename) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** A part's body as text, in the charset its Content-Type names (UTF-8 otherwise). */
function partText(part: Part): string {
  const bytes = base64UrlBytes(part.body?.data ?? '');
  const charset = /charset="?([^";\s]+)/i.exec(header(part, 'Content-Type'))?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
