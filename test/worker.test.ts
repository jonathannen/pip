import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '../src/shared/api';
import { DEFAULT_CODE_MODEL } from '../src/shared/api';

const worker = exports.default;

const mcpHeaders = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-06-18',
};

async function slackSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  return `v0=${new Uint8Array(mac).toHex()}`;
}

/**
 * Sends pip an `app_mention` signed as Slack signs it and waits for everything it does about it.
 * pip is U0PIP (bot B0PIP); `bots` is SLACK_CC_BOT_IDS. Gives the code channels started and the
 * messages posted.
 */
async function mention(
  event: Record<string, unknown>,
  { bots = '', retry = false }: { bots?: string; retry?: boolean } = {},
) {
  const { slack } = await import('../src/worker/slack');
  const channels: Record<string, string>[] = [];
  const posts: Record<string, string>[] = [];
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const form = Object.fromEntries(await request.formData()) as Record<string, string>;
    switch (request.url) {
      case 'https://slack.com/api/auth.test':
        return Response.json({ ok: true, team_id: 'T0PIP', user_id: 'U0PIP', bot_id: 'B0PIP' });
      case 'https://slack.com/api/chat.postMessage':
        posts.push(form);
        return Response.json({ ok: true });
      case 'https://pynhq.slack.com/api/client.codeChannels.create':
        channels.push(form);
        return Response.json({ ok: true, channel_id: 'C0NEW' });
      default:
        throw new Error(`unexpected fetch: ${request.url}`);
    }
  });
  try {
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T0PIP',
      event_id: 'Ev0TEST',
      event: { type: 'app_mention', channel: 'C0HERE', ts: '1700000000.000100', ...event },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const ctx = createExecutionContext();
    const res = await slack({ ...env, SLACK_CC_BOT_IDS: bots }).run(
      new Request('http://pip/slack/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': await slackSignature('test-signing-secret', timestamp, body),
          ...(retry ? { 'x-slack-retry-num': '1', 'x-slack-retry-reason': 'http_timeout' } : {}),
        },
        body,
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
    return { channels, posts };
  } finally {
    fetchSpy.mockRestore();
  }
}

/** Stands in for Google: answers the token endpoint and Gmail, and records what was asked. */
function mockGoogle(gmail: (url: URL) => unknown = () => ({})) {
  const tokenRequests: Record<string, string>[] = [];
  const gmailRequests: {
    method: string;
    url: string;
    authorization: string | null;
    body?: { message?: { raw?: string } };
  }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === 'https://oauth2.googleapis.com/token') {
      tokenRequests.push(Object.fromEntries(init?.body as URLSearchParams));
      return Response.json({ access_token: 'at-test', refresh_token: 'rt-new', expires_in: 3599 });
    }
    gmailRequests.push({
      method: init?.method ?? 'GET',
      url: url.href,
      authorization: new Headers(init?.headers).get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(gmail(url));
  });
  return { tokenRequests, gmailRequests, restore: () => spy.mockRestore() };
}

/** Calls a tool on /mcp/core; the result's text, and whether it's an error. */
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await worker.fetch('http://pip/mcp/core', {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  // The answer is plain JSON, or one server-sent event carrying it.
  const { result } = JSON.parse(body.startsWith('{') ? body : body.slice(body.indexOf('{'))) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: result.content[0]?.text ?? '', isError: result.isError === true };
}

const base64Url = (text: string) =>
  new TextEncoder().encode(text).toBase64({ alphabet: 'base64url', omitPadding: true });

const fromBase64 = (data: string, alphabet: 'base64' | 'base64url' = 'base64') =>
  new TextDecoder().decode(Uint8Array.fromBase64(data, { alphabet }));

/** A draft's `raw` as sent to Gmail: its header lines unfolded, and its body decoded. */
function decodeRaw(raw: string) {
  const [head = '', body = ''] = fromBase64(raw, 'base64url').split('\r\n\r\n');
  return {
    headers: head.replaceAll('\r\n ', ' ').split('\r\n'),
    bodyLines: body.trimEnd().split('\r\n'),
    body: fromBase64(body.replaceAll('\r\n', '')),
  };
}

/** A header's RFC 2047 encoded words, decoded and joined. */
const decodeWords = (value: string) =>
  [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((word) => fromBase64(word[1] ?? '')).join('');

const connectGmail = () =>
  env.DB.prepare(
    "INSERT OR REPLACE INTO google_auth (id, refresh_token) VALUES (1, 'rt-test')",
  ).run();

describe('access', () => {
  it('rejects an invalid Access JWT', async () => {
    const res = await worker.fetch('http://pip/api/me', {
      headers: { 'cf-access-jwt-assertion': 'bad' },
    });
    expect(res.status).toBe(401);
  });

  it('uses the dev identity when Access is absent in dev', async () => {
    const res = await worker.fetch('http://pip/api/me');
    expect(await res.json()).toEqual({
      email: 'dev@localhost',
      code_channels_enabled: true,
      gmail_enabled: true,
      gmail_connected_at: null,
      service_token: false,
      version: 'local',
    });
  });
});

describe('deployment', () => {
  it('reports itself as local when it was not built', async () => {
    const res = await worker.fetch('http://pip/api/deployment');
    expect(await res.json()).toEqual({
      repo: 'jonathannen/pip',
      commit: null,
      message: null,
      branch: null,
      dirty: false,
      built_at: null,
      version_id: 'local',
      version_tag: null,
      deployed_at: null,
    });
  });
});

describe('notes', () => {
  it('adds, lists and deletes a note', async () => {
    const created = await worker.fetch('http://pip/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '  remember the milk  ' }),
    });
    expect(created.status).toBe(201);
    const note: { id: number; body: string; created_by: string } = await created.json();
    expect(note).toMatchObject({ body: 'remember the milk', created_by: 'dev@localhost' });

    const listed: { id: number }[] = await (await worker.fetch('http://pip/api/notes')).json();
    expect(listed.map((n) => n.id)).toContain(note.id);

    const deleted = await worker.fetch(`http://pip/api/notes/${note.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    const again = await worker.fetch(`http://pip/api/notes/${note.id}`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('refuses an empty note', async () => {
    const res = await worker.fetch('http://pip/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('code channel', () => {
  it('refuses an empty prompt', async () => {
    const res = await worker.fetch('http://pip/api/code-channel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '  ' }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses an unknown model', async () => {
    const res = await worker.fetch('http://pip/api/code-channel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'fix the build', model: 'GPT-2' }),
    });
    expect(res.status).toBe(400);
  });

  it('reads the /cc prefixes', async () => {
    const { launchFromSlack } = await import('../src/worker/slack');
    const calls: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const form = init?.body as FormData;
      calls.push(Object.fromEntries(form.entries()));
      return Response.json({ ok: true, channel_id: 'C0123ABC' });
    });
    try {
      const text = await launchFromSlack(
        { SLACK_CLIENT_TOKEN: 'xoxc-test', SLACK_D_COOKIE: 'xoxd-test' },
        'public: raw: ship it',
      );
      expect(text).toContain('<#C0123ABC>');
      expect(text).toContain('ship it');
      expect(calls).toHaveLength(1);
      const sent = calls[0] as { is_private: string; blocks: string };
      expect(sent.is_private).toBe('false');
      expect(sent.blocks).toContain('"ship it"');
      expect(sent.blocks).not.toContain('pynhq/pyn');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('sitrep', () => {
  it('pings the channels in the Scheduled section', async () => {
    const { SITREP_PROMPT, sitrepFromSlack } = await import('../src/worker/slack');
    const posts: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/api/users.channelSections.list')) {
        return Response.json({
          ok: true,
          channel_sections: [
            {
              channel_section_id: 'L01',
              name: 'Other',
              type: 'standard',
              channel_ids_page: { channel_ids: ['C0OTHER'], count: 1 },
            },
            {
              channel_section_id: 'L02',
              name: ' scheduled ',
              type: 'standard',
              channel_ids_page: { channel_ids: ['C0AAA', 'C0BBB'], count: 2, cursor: 'abc' },
            },
          ],
        });
      }
      const form = init?.body as FormData;
      posts.push({ url: String(url), ...Object.fromEntries(form.entries()) });
      return Response.json({ ok: true });
    });
    try {
      const text = await sitrepFromSlack({
        SLACK_CLIENT_TOKEN: 'xoxc-test',
        SLACK_D_COOKIE: 'xoxd-test',
      });
      expect(text).toContain('<#C0AAA>');
      expect(text).toContain('<#C0BBB>');
      expect(text).not.toContain('C0OTHER');
      expect(text).not.toContain(':warning:');
      const url = 'https://pynhq.slack.com/api/chat.postMessage';
      expect(posts).toEqual([
        { url, token: 'xoxc-test', channel: 'C0AAA', text: SITREP_PROMPT },
        { url, token: 'xoxc-test', channel: 'C0BBB', text: SITREP_PROMPT },
      ]);
      expect(SITREP_PROMPT).toBe(
        'give me the current status - things in flight, blockers, things that need action. Be concise, use bullets',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('warns when Slack lists fewer channels than the section has', async () => {
    const { sitrepFromSlack } = await import('../src/worker/slack');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        ok: true,
        channel_sections: [
          { name: 'Scheduled', channel_ids_page: { channel_ids: ['C0AAA', 'C0BBB'], count: 3 } },
        ],
      }),
    );
    try {
      const text = await sitrepFromSlack({
        SLACK_CLIENT_TOKEN: 'xoxc-test',
        SLACK_D_COOKIE: 'xoxd-test',
      });
      expect(text).toContain(':warning: Slack listed only 2 of 3 channels in the section.');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('google sign-in', () => {
  /** Starts the sign-in; the state Google is given and the cookie holding it. */
  async function start() {
    const res = await worker.fetch('http://pip/auth/google', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { location, cookie, state: location.searchParams.get('state') ?? '' };
  }

  it("redirects to Google's consent screen for the drafts scope", async () => {
    const { location, cookie, state } = await start();
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: 'google-client-id',
      redirect_uri: 'http://pip/auth/google/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.compose',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    expect(state).not.toBe('');
    expect(cookie).toBe(`google_oauth_state=${state}`);
  });

  it('stores the refresh token on the callback', async () => {
    await env.DB.exec('DELETE FROM google_auth');
    const { cookie, state } = await start();
    const google = mockGoogle();
    try {
      const res = await worker.fetch(
        `http://pip/auth/google/callback?code=the-code&state=${state}`,
        { headers: { cookie }, redirect: 'manual' },
      );
      // Back to Settings, where the Gmail card shows the connection.
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/settings');
      expect(google.tokenRequests).toEqual([
        {
          client_id: 'google-client-id',
          client_secret: 'google-client-secret',
          grant_type: 'authorization_code',
          code: 'the-code',
          redirect_uri: 'http://pip/auth/google/callback',
        },
      ]);
    } finally {
      google.restore();
    }
    const row = await env.DB.prepare('SELECT refresh_token FROM google_auth').first();
    expect(row).toEqual({ refresh_token: 'rt-new' });
  });

  it("refuses a callback whose state isn't the cookie's", async () => {
    await env.DB.exec('DELETE FROM google_auth');
    const { cookie } = await start();
    const google = mockGoogle();
    try {
      const res = await worker.fetch(
        'http://pip/auth/google/callback?code=the-code&state=someone-elses',
        { headers: { cookie } },
      );
      expect(res.status).toBe(400);
      expect(google.tokenRequests).toEqual([]);
    } finally {
      google.restore();
    }
    expect(await env.DB.prepare('SELECT refresh_token FROM google_auth').first()).toBeNull();
  });

  /** What /api/me tells Settings' Gmail card. */
  async function gmailStatus() {
    const res = await worker.fetch('http://pip/api/me');
    const { gmail_enabled, gmail_connected_at } = await res.json<Me>();
    return { gmail_enabled, gmail_connected_at };
  }

  it('tells Settings whether Gmail is connected, and since when', async () => {
    await env.DB.exec('DELETE FROM google_auth');
    expect(await gmailStatus()).toEqual({ gmail_enabled: true, gmail_connected_at: null });

    await env.DB.prepare(
      "INSERT INTO google_auth (id, refresh_token, updated_at) VALUES (1, 'rt-test', '2026-11-15T01:00:00.000Z')",
    ).run();
    expect(await gmailStatus()).toEqual({
      gmail_enabled: true,
      gmail_connected_at: '2026-11-15T01:00:00.000Z',
    });
  });

  it('tells Settings when the client secrets are not set', async () => {
    await env.DB.exec('DELETE FROM google_auth');
    const secrets = env as { GOOGLE_CLIENT_SECRET?: string };
    const secret = secrets.GOOGLE_CLIENT_SECRET;
    delete secrets.GOOGLE_CLIENT_SECRET;
    try {
      expect(await gmailStatus()).toEqual({ gmail_enabled: false, gmail_connected_at: null });
    } finally {
      secrets.GOOGLE_CLIENT_SECRET = secret;
    }
  });

  it("reports not connected when the table isn't there yet", async () => {
    await env.DB.exec('ALTER TABLE google_auth RENAME TO google_auth_later');
    try {
      expect(await gmailStatus()).toEqual({ gmail_enabled: true, gmail_connected_at: null });
    } finally {
      await env.DB.exec('ALTER TABLE google_auth_later RENAME TO google_auth');
    }
  });
});

describe('gmail drafts', () => {
  const DRAFTS = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
  const refresh = {
    client_id: 'google-client-id',
    client_secret: 'google-client-secret',
    grant_type: 'refresh_token',
    refresh_token: 'rt-test',
  };

  it('says so when Gmail is not connected', async () => {
    await env.DB.exec('DELETE FROM google_auth');
    const google = mockGoogle();
    try {
      const result = await callTool('drafts_list', {});
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Gmail is not connected');
      expect(result.text).toContain('/auth/google');
      expect(google.tokenRequests).toEqual([]);
      expect(google.gmailRequests).toEqual([]);
    } finally {
      google.restore();
    }
  });

  it('lists drafts with who they are to and their subject', async () => {
    await connectGmail();
    const google = mockGoogle((url) =>
      url.pathname.endsWith('/drafts')
        ? {
            drafts: [
              { id: 'r-1', message: { id: 'm-1' } },
              { id: 'r-2', message: { id: 'm-2' } },
            ],
          }
        : {
            id: url.pathname.split('/').pop(),
            message: {
              snippet: 'It&#39;s on',
              payload: {
                headers: [
                  { name: 'To', value: 'ann@example.com' },
                  { name: 'Subject', value: '=?UTF-8?B?Q2Fmw6k=?= at noon' },
                ],
              },
            },
          },
    );
    try {
      const result = await callTool('drafts_list', { limit: 2 });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual([
        { id: 'r-1', to: 'ann@example.com', subject: 'Café at noon', snippet: "It's on" },
        { id: 'r-2', to: 'ann@example.com', subject: 'Café at noon', snippet: "It's on" },
      ]);
      expect(google.tokenRequests).toEqual([refresh]);
      expect(google.gmailRequests).toEqual([
        { method: 'GET', url: `${DRAFTS}?maxResults=2`, authorization: 'Bearer at-test' },
        { method: 'GET', url: `${DRAFTS}/r-1?format=metadata`, authorization: 'Bearer at-test' },
        { method: 'GET', url: `${DRAFTS}/r-2?format=metadata`, authorization: 'Bearer at-test' },
      ]);
    } finally {
      google.restore();
    }
  });

  it('reads a draft: its headers and the plain-text part', async () => {
    await connectGmail();
    const google = mockGoogle(() => ({
      id: 'r-1',
      message: {
        id: 'm-1',
        threadId: 't-1',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'To', value: 'Ann <ann@example.com>' },
            { name: 'Cc', value: 'bob@example.com' },
            { name: 'Subject', value: 'Lunch' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
              body: { data: base64Url('See you at the café.\r\n') },
            },
            { mimeType: 'text/html', body: { data: base64Url('<div>See you at the café.</div>') } },
          ],
        },
      },
    }));
    try {
      const result = await callTool('drafts_get', { id: 'r-1' });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({
        id: 'r-1',
        thread_id: 't-1',
        to: 'Ann <ann@example.com>',
        cc: 'bob@example.com',
        bcc: '',
        subject: 'Lunch',
        body: 'See you at the café.\r\n',
      });
      expect(google.gmailRequests).toEqual([
        { method: 'GET', url: `${DRAFTS}/r-1?format=full`, authorization: 'Bearer at-test' },
      ]);
    } finally {
      google.restore();
    }
  });

  it("reads the HTML part's text when a draft has no plain part", async () => {
    await connectGmail();
    const google = mockGoogle(() => ({
      id: 'r-1',
      message: {
        payload: {
          mimeType: 'text/html',
          headers: [{ name: 'Subject', value: 'Lunch' }],
          body: {
            data: base64Url(
              '<style>p{}</style><p>Tom &amp; I</p><p>will be <b>late</b>.<br>Sorry</p>',
            ),
          },
        },
      },
    }));
    try {
      const result = await callTool('drafts_get', { id: 'r-1' });
      expect(JSON.parse(result.text)).toMatchObject({
        thread_id: null,
        subject: 'Lunch',
        body: 'Tom & I\nwill be late.\nSorry',
      });
    } finally {
      google.restore();
    }
  });

  it('creates a draft as an RFC 822 message', async () => {
    await connectGmail();
    const google = mockGoogle(() => ({ id: 'r-9', message: { id: 'm-9' } }));
    try {
      const result = await callTool('drafts_create', {
        to: ['Ann <ann@example.com>', 'bob@example.com'],
        cc: ['cat@example.com'],
        bcc: ['dan@example.com'],
        subject: 'Lunch on Friday',
        body: 'Hi Ann,\n\nNoon at the usual place?\n\nJon',
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({ id: 'r-9' });
      expect(google.tokenRequests).toEqual([refresh]);
      expect(google.gmailRequests).toHaveLength(1);
      const [request] = google.gmailRequests;
      expect(request).toMatchObject({
        method: 'POST',
        url: DRAFTS,
        authorization: 'Bearer at-test',
      });
      const message = decodeRaw(request?.body?.message?.raw ?? '');
      expect(message.headers).toEqual([
        'To: Ann <ann@example.com>, bob@example.com',
        'Cc: cat@example.com',
        'Bcc: dan@example.com',
        'Subject: Lunch on Friday',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
      ]);
      expect(message.body).toBe('Hi Ann,\r\n\r\nNoon at the usual place?\r\n\r\nJon');
    } finally {
      google.restore();
    }
  });

  it('updates a draft, encoding non-ASCII headers and long bodies', async () => {
    await connectGmail();
    const google = mockGoogle(() => ({ id: 'r-1', message: { id: 'm-2' } }));
    const subject = 'Déjeuner vendredi à midi: on se retrouve au café habituel près de la gare? 🍽️';
    const body = `Chère Zoë,\n\n${'Ça marche pour moi. '.repeat(20)}\n\nJon`;
    try {
      const result = await callTool('drafts_update', {
        id: 'r-1',
        to: ['Zoë Müller <zoe@example.com>'],
        subject,
        body,
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({ id: 'r-1' });
      const [request] = google.gmailRequests;
      expect(request).toMatchObject({
        method: 'PUT',
        url: `${DRAFTS}/r-1`,
        authorization: 'Bearer at-test',
      });
      const raw = request?.body?.message?.raw ?? '';
      // Only ASCII goes on the wire, in lines short enough for any mail server.
      const lines = fromBase64(raw, 'base64url').split('\r\n');
      expect(lines.every((line) => /^[\x20-\x7e]*$/.test(line) && line.length <= 76)).toBe(true);
      const message = decodeRaw(raw);
      const [to = '', subjectLine = ''] = message.headers;
      expect(to.startsWith('To: =?UTF-8?B?')).toBe(true);
      expect(to.endsWith(' <zoe@example.com>')).toBe(true);
      expect(decodeWords(to)).toBe('Zoë Müller');
      expect(subjectLine.startsWith('Subject: =?UTF-8?B?')).toBe(true);
      expect(decodeWords(subjectLine)).toBe(subject);
      expect(message.body).toBe(body.replaceAll('\n', '\r\n'));
    } finally {
      google.restore();
    }
  });

  it("passes on Gmail's error", async () => {
    await connectGmail();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).startsWith('https://oauth2.googleapis.com/')
          ? Response.json({ access_token: 'at-test' })
          : Response.json(
              { error: { code: 404, message: 'Requested entity was not found.' } },
              { status: 404 },
            ),
      );
    try {
      const result = await callTool('drafts_get', { id: 'nope' });
      expect(result.isError).toBe(true);
      expect(result.text).toBe('Gmail: Requested entity was not found.');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('mcp', () => {
  it('lists the core tools', async () => {
    const res = await worker.fetch('http://pip/mcp/core', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const tool of [
      'whoami',
      'hello',
      'create_code_channel',
      'notes_list',
      'notes_add',
      'notes_delete',
      'drafts_list',
      'drafts_get',
      'drafts_create',
      'drafts_update',
    ]) {
      expect(text).toContain(`"${tool}"`);
    }
  });

  it('answers whoami with the caller', async () => {
    const res = await worker.fetch('http://pip/mcp/core', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('dev@localhost');
  });

  it('404s an unknown server', async () => {
    const res = await worker.fetch('http://pip/mcp/nope', {
      method: 'POST',
      headers: mcpHeaders,
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

describe('slack', () => {
  it('rejects unsigned requests', async () => {
    const res = await worker.fetch('http://pip/slack/events', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('answers a signed url_verification', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await worker.fetch('http://pip/slack/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': await slackSignature('test-signing-secret', timestamp, body),
      },
      body,
    });
    expect(await res.text()).toBe('abc123');
  });
});

describe('cc mention', () => {
  const owner = env.SLACK_OWNER_USER_ID;

  it('reads the prompt after the mention and cc', async () => {
    const { parseCcMention } = await import('../src/worker/slack');
    expect(parseCcMention('<@U0PIP> cc fix the build', 'U0PIP')).toBe('fix the build');
    expect(parseCcMention('  <@U0PIP|pip>   CC  fix\nthe build\n', 'U0PIP')).toBe('fix\nthe build');
    expect(parseCcMention('<@U0PIP> cc', 'U0PIP')).toBe('');
    expect(parseCcMention('<@U0PIP> cc   ', 'U0PIP')).toBe('');
    // Slack's escaping, undone: links and `&`, `<`, `>`.
    expect(
      parseCcMention('<@U0PIP> cc a &amp;&amp; b &lt;div&gt; <https://x.test/1|x.test/1>', 'U0PIP'),
    ).toBe('a && b <div> https://x.test/1');
    // Not the command: no `cc` word, `cc` not straight after the mention, or someone else first.
    expect(parseCcMention('<@U0PIP> ccc fix the build', 'U0PIP')).toBeUndefined();
    expect(parseCcMention('<@U0PIP> hello', 'U0PIP')).toBeUndefined();
    expect(parseCcMention('hey <@U0PIP> cc fix the build', 'U0PIP')).toBeUndefined();
    expect(parseCcMention('<@U0OTHER> cc <@U0PIP> fix the build', 'U0PIP')).toBeUndefined();
    expect(parseCcMention('<@U0PIP> cc fix the build', undefined)).toBeUndefined();
  });

  it('allows the owner and listed bots only', async () => {
    const { mayMentionCc } = await import('../src/worker/slack');
    const allow = (bots: string | undefined, sender: { user?: string; bot_id?: string }) =>
      mayMentionCc({ SLACK_OWNER_USER_ID: 'U0OWNER', SLACK_CC_BOT_IDS: bots }, sender);
    expect(allow('', { user: 'U0OWNER' })).toBe(true);
    expect(allow('', { user: 'U0SOMEONE' })).toBe(false);
    // The list is for bots: a person's ID in it does nothing.
    expect(allow('U0SOMEONE', { user: 'U0SOMEONE' })).toBe(false);
    expect(allow('U0BOT', { user: 'U0BOT', bot_id: 'B0BOT' })).toBe(true);
    expect(allow(' U0X , B0BOT ', { user: 'U0BOT', bot_id: 'B0BOT' })).toBe(true);
    // A classic app's message has no user.
    expect(allow('B0BOT', { bot_id: 'B0BOT' })).toBe(true);
    expect(allow('U0X', { user: 'U0BOT', bot_id: 'B0BOT' })).toBe(false);
    expect(allow('', { user: 'U0BOT', bot_id: 'B0BOT' })).toBe(false);
    expect(allow(undefined, { user: 'U0BOT', bot_id: 'B0BOT' })).toBe(false);
    expect(allow('', { bot_id: '' })).toBe(false);
    expect(allow(',', { user: '', bot_id: '' })).toBe(false);
    expect(allow('', {})).toBe(false);
  });

  it('starts a code channel for the owner and answers in the thread', async () => {
    const { channels, posts } = await mention({
      user: owner,
      text: '<@U0PIP> cc fix the build\nand tell <@U0SOMEONE>',
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.is_private).toBe('true');
    expect(channels[0]?.blocks).toContain(
      '"In pynhq/pyn repo fix the build\\nand tell <@U0SOMEONE>"',
    );
    // The answer doesn't repeat the prompt, so it pings no one the prompt mentions.
    expect(posts).toEqual([
      {
        channel: 'C0HERE',
        thread_ts: '1700000000.000100',
        text: `:rocket: Started <#C0NEW> (${DEFAULT_CODE_MODEL}).`,
      },
    ]);
  });

  it('takes the /cc prefixes, and answers in the thread the mention is in', async () => {
    const { channels, posts } = await mention({
      user: owner,
      text: '<@U0PIP> CC public: raw: ship it',
      thread_ts: '1690000000.000001',
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.is_private).toBe('false');
    expect(channels[0]?.blocks).toContain('"ship it"');
    expect(posts[0]?.thread_ts).toBe('1690000000.000001');
  });

  it('starts a code channel for a listed bot', async () => {
    const event = { user: 'U0BOT', bot_id: 'B0BOT', text: '<@U0PIP> cc fix the build' };
    for (const bots of ['U0BOT', 'B0BOT,U0ELSE']) {
      const { channels, posts } = await mention(event, { bots });
      expect(channels).toHaveLength(1);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.text).toContain(':rocket: Started <#C0NEW>');
    }
    // A classic app's bot_message has no user.
    const classic = { subtype: 'bot_message', bot_id: 'B0BOT', text: '<@U0PIP> cc fix the build' };
    expect((await mention(classic, { bots: 'B0BOT' })).channels).toHaveLength(1);
  });

  it('ignores a bot that is not listed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const event = { user: 'U0BOT', bot_id: 'B0BOT', text: '<@U0PIP> cc fix the build' };
      for (const bots of ['', 'U0ELSE,B0ELSE']) {
        const { channels, posts } = await mention(event, { bots });
        expect(channels).toEqual([]);
        expect(posts).toEqual([]);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores a person who is not the owner', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const event = { user: 'U0SOMEONE', text: '<@U0PIP> cc fix the build' };
      // Listing a person does not let them in: the list is for bots.
      for (const bots of ['', 'U0SOMEONE']) {
        const { channels, posts } = await mention(event, { bots });
        expect(channels).toEqual([]);
        expect(posts).toEqual([]);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('answers an empty prompt with the usage', async () => {
    const { CC_MENTION_USAGE } = await import('../src/worker/slack');
    expect(CC_MENTION_USAGE).toContain('`@pip cc <prompt>`');
    for (const text of ['<@U0PIP> cc', '<@U0PIP> cc   ', '<@U0PIP> cc public:']) {
      const { channels, posts } = await mention({ user: owner, text });
      expect(channels).toEqual([]);
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ text: CC_MENTION_USAGE, thread_ts: '1700000000.000100' });
    }
  });

  it('waves at any other mention from the owner, and at no one else', async () => {
    const waved = await mention({ user: owner, text: 'hey <@U0PIP> cc fix the build' });
    expect(waved.channels).toEqual([]);
    expect(waved.posts).toHaveLength(1);
    expect(waved.posts[0]?.text).toBe(`:wave: <@${owner}>`);

    const event = { user: 'U0BOT', bot_id: 'B0BOT', text: '<@U0PIP> hello' };
    const ignored = await mention(event, { bots: 'U0BOT,B0BOT' });
    expect(ignored.channels).toEqual([]);
    expect(ignored.posts).toEqual([]);
  });

  it("ignores pip's own messages, even when pip is listed", async () => {
    const text = '<@U0PIP> cc fix the build';
    for (const event of [
      { user: 'U0PIP', bot_id: 'B0PIP', text },
      { subtype: 'bot_message', bot_id: 'B0PIP', text },
    ]) {
      const { channels, posts } = await mention(event, { bots: 'U0PIP,B0PIP' });
      expect(channels).toEqual([]);
      expect(posts).toEqual([]);
    }
  });

  it('does not start a second channel when Slack sends the event again', async () => {
    const event = { user: owner, text: '<@U0PIP> cc fix the build' };
    expect((await mention(event)).channels).toHaveLength(1);
    const again = await mention(event, { retry: true });
    expect(again.channels).toEqual([]);
    expect(again.posts).toEqual([]);
  });
});
