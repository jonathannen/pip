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

/**
 * Sends pip a DM the same way: a `message` event in an `im` channel, D0PIP, with no mention in it.
 */
const dm = (event: Record<string, unknown>, options?: Parameters<typeof mention>[1]) =>
  mention({ type: 'message', channel_type: 'im', channel: 'D0PIP', ...event }, options);

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

  it('sends the /cc prompt with no preamble', async () => {
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
        'fix the login bug',
      );
      expect(text).toBe(`:rocket: Started <#C0123ABC> (${DEFAULT_CODE_MODEL}): fix the login bug`);
      expect(calls).toHaveLength(1);
      const sent = calls[0] as { is_private: string; blocks: string };
      expect(sent.is_private).toBe('true');
      expect(sent.blocks).toContain('"fix the login bug"');
      expect(sent.blocks).not.toContain('pynhq/pyn');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sends the d cookie percent-encoded, whichever way it was copied', async () => {
    const { launchFromSlack } = await import('../src/worker/slack');
    const sent: { cookie: string | null; token: string }[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const form = Object.fromEntries(await request.formData()) as Record<string, string>;
      sent.push({ cookie: request.headers.get('cookie'), token: form.token ?? '' });
      return Response.json({ ok: true, channel_id: 'C0123ABC' });
    });
    try {
      // As the browser keeps it, which is what Slack takes. Developer tools also show it
      // URL-decoded, and sent like that Slack reads the `+` as a space and says invalid_auth.
      const kept = 'xoxd-aB3%2BcD4%2FeF5%3D%3D';
      for (const copied of [
        kept,
        'xoxd-aB3+cD4/eF5==',
        'xoxd-aB3%2BcD4/eF5==',
        // A secret set with `wrangler secret put` is not trimmed as the form's are.
        ' xoxd-aB3+cD4/eF5==\n',
        'd=xoxd-aB3%2BcD4%2FeF5%3D%3D',
      ]) {
        const text = await launchFromSlack(
          { SLACK_CLIENT_TOKEN: 'xoxc-test\n', SLACK_D_COOKIE: copied },
          'fix it',
        );
        expect(text).toContain('<#C0123ABC>');
      }
      expect(sent).toEqual(Array(5).fill({ cookie: `d=${kept}`, token: 'xoxc-test' }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('encodes a d cookie once, and only what is not encoded yet', async () => {
    const { dCookieValue } = await import('../src/lib/code-channel');
    const kept = 'xoxd-aB3%2BcD4%2FeF5%3D%3D';
    for (const [copied, sent] of [
      // Encoded already, in either case of hex: as it is, never encoded twice.
      [kept, kept],
      ['xoxd-aB3%2bcD4%2feF5%3d%3d', 'xoxd-aB3%2bcD4%2feF5%3d%3d'],
      ['xoxd-plain_value.with~safe-characters', 'xoxd-plain_value.with~safe-characters'],
      // Decoded, in whole or in part.
      ['xoxd-aB3+cD4/eF5==', kept],
      ['xoxd-aB3%2BcD4/eF5==', kept],
      ['xoxd-aB3+cD4%2FeF5%3D=', kept],
      // With what gets copied along with it.
      [`d=${kept}`, kept],
      ['  d= xoxd-aB3+cD4/eF5==\t\n', kept],
      // A `%` that begins no escape is a character of the value, with or without others to encode.
      ['xoxd-50%', 'xoxd-50%25'],
      ['xoxd-50%zz', 'xoxd-50%25zz'],
      ['xoxd-50%+1', 'xoxd-50%25%2B1'],
      ['xoxd-a%2', 'xoxd-a%252'],
      ['', ''],
    ] as const) {
      expect([copied, dCookieValue(copied)]).toEqual([copied, sent]);
      // What comes out is what Slack takes, so it comes out of a second pass the same.
      expect(dCookieValue(sent)).toBe(sent);
      // And it is one cookie's value: nothing in it ends the cookie or starts another.
      expect(sent).toMatch(/^[\w.~%!*'()-]*$/);
    }
  });

  it('says whether it is the session Slack turns down, or what it was sent with', async () => {
    const { launchFromSlack } = await import('../src/worker/slack');
    const env = {
      SLACK_CLIENT_TOKEN: 'xoxc-test',
      SLACK_D_COOKIE: 'xoxd-test',
      SLACK_WORKSPACE: 'second',
      SLACK_TEAM_ID: 'T0SECOND01',
      SLACK_CODE_APP_ID: 'A0SECOND01',
    };
    /** Slack's answer to `auth.test` with the same session, after it said invalid_auth. */
    let authTest: () => Response;
    const asked: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      asked.push(request.url);
      expect(request.headers.get('cookie')).toBe('d=xoxd-test');
      expect((await request.formData()).get('token')).toBe('xoxc-test');
      return request.url.endsWith('/api/auth.test')
        ? authTest()
        : Response.json({ ok: false, error: 'invalid_auth' });
    });
    try {
      // The session itself is no good: the token and cookie are what to enter again.
      authTest = () => Response.json({ ok: false, error: 'invalid_auth' });
      const turnedDown = await launchFromSlack(env, 'fix it');
      expect(turnedDown).toContain(
        ":x: Couldn't start the code channel: client.codeChannels.create: invalid_auth. ",
      );
      expect(turnedDown).toContain('second.slack.com');
      expect(turnedDown).toContain('auth.test: invalid_auth');
      expect(turnedDown).toContain('client token and d cookie');
      expect(turnedDown).toContain('Settings');
      expect(asked).toEqual([
        'https://second.slack.com/api/client.codeChannels.create',
        'https://second.slack.com/api/auth.test',
      ]);

      // The session is good, so it is the request: what it was sent with is said.
      authTest = () => Response.json({ ok: true, team_id: 'T0SECOND01', user_id: 'U0OWNER002' });
      const taken = await launchFromSlack(env, 'fix it');
      expect(taken).toContain('client.codeChannels.create: invalid_auth. ');
      expect(taken).toContain('auth.test: team T0SECOND01, member U0OWNER002');
      expect(taken).toContain('team T0SECOND01 and code app A0SECOND01');
      expect(taken).not.toContain('enter them');

      // The session is another workspace's.
      authTest = () => Response.json({ ok: true, team_id: 'T0PIP', user_id: 'U0OWNER001' });
      expect(await launchFromSlack(env, 'fix it')).toContain(
        'That session is team T0PIP’s, and this was sent as team T0SECOND01',
      );

      // Slack can't be asked: what is known is said, and the error is still Slack's.
      authTest = () => new Response('no', { status: 500 });
      const unknown = await launchFromSlack(env, 'fix it');
      expect(unknown).toContain('client.codeChannels.create: invalid_auth. ');
      expect(unknown).toContain('second.slack.com');
      expect(unknown).not.toContain('auth.test');

      // No token or cookie is in any of it.
      for (const text of [turnedDown, taken, unknown]) {
        expect(text).not.toMatch(/xox[cd]-/);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('passes on any other error of Slack’s as it is', async () => {
    const { launchFromSlack } = await import('../src/worker/slack');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ ok: false, error: 'restricted_action' }));
    try {
      expect(
        await launchFromSlack(
          { SLACK_CLIENT_TOKEN: 'xoxc-test', SLACK_D_COOKIE: 'xoxd-test' },
          'fix it',
        ),
      ).toBe(":x: Couldn't start the code channel: client.codeChannels.create: restricted_action");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('swaps a first word that names a repo for a hint', async () => {
    const { withCcHint } = await import('../src/worker/slack');
    expect(withCcHint('web fix the header')).toBe('In the ponhq/pynhq.com repo: fix the header');
    expect(withCcHint('pyn fix the header')).toBe('In the ponhq/pyn repo: fix the header');
    expect(withCcHint('noj fix the header')).toBe(
      'In the ponhq/pyn repo, noj (src/entry/noj): fix the header',
    );
    expect(withCcHint('siroj fix the header')).toBe(
      'In the ponhq/pynhq.com repo, siroj: fix the header',
    );
    // In either case, and whatever the space after it; the rest is kept as written.
    expect(withCcHint('WEB fix the header')).toBe('In the ponhq/pynhq.com repo: fix the header');
    expect(withCcHint('Noj\nFix the\nheader')).toBe(
      'In the ponhq/pyn repo, noj (src/entry/noj): Fix the\nheader',
    );
    // Not a hint: no such word first, a longer word, the word alone, or not followed by a space.
    for (const prompt of [
      'fix the header',
      'fix the web header',
      'website fix the header',
      'pynhq fix the header',
      'web',
      'web: fix the header',
      'constructor fix the header',
    ]) {
      expect(withCcHint(prompt)).toBe(prompt);
    }
  });

  it('sends the hint after the /cc prefixes', async () => {
    const { launchFromSlack } = await import('../src/worker/slack');
    const calls: { is_private: string; blocks: string }[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const form = init?.body as FormData;
      calls.push(Object.fromEntries(form.entries()) as { is_private: string; blocks: string });
      return Response.json({ ok: true, channel_id: 'C0123ABC' });
    });
    try {
      const env = { SLACK_CLIENT_TOKEN: 'xoxc-test', SLACK_D_COOKIE: 'xoxd-test' };
      // The reply echoes the prompt as sent, hint included.
      expect(await launchFromSlack(env, 'public: Web fix the header')).toBe(
        `:rocket: Started <#C0123ABC> (${DEFAULT_CODE_MODEL}): In the ponhq/pynhq.com repo: fix the header`,
      );
      await launchFromSlack(env, 'raw: public: siroj fix the header');
      await launchFromSlack(env, 'pyn fix the header');
      // A word alone is the whole prompt, and a prefix after the word is part of the prompt.
      await launchFromSlack(env, 'public: web');
      await launchFromSlack(env, 'web public: fix the header');
      expect(
        calls.map((sent) => [sent.is_private, sent.blocks.match(/"text":("[^"]*")/)?.[1]]),
      ).toEqual([
        ['false', '"In the ponhq/pynhq.com repo: fix the header"'],
        ['false', '"In the ponhq/pynhq.com repo, siroj: fix the header"'],
        ['true', '"In the ponhq/pyn repo: fix the header"'],
        ['false', '"web"'],
        ['true', '"In the ponhq/pynhq.com repo: public: fix the header"'],
      ]);
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
    expect(channels[0]?.blocks).toContain('"fix the build\\nand tell <@U0SOMEONE>"');
    expect(channels[0]?.blocks).not.toContain('pynhq/pyn');
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

  it('takes the /cc repo words', async () => {
    const { channels } = await mention({ user: owner, text: '<@U0PIP> cc noj fix the build' });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.blocks).toContain(
      '"In the ponhq/pyn repo, noj (src/entry/noj): fix the build"',
    );
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

describe('cc in a DM', () => {
  const owner = env.SLACK_OWNER_USER_ID;

  it('reads the prompt after cc', async () => {
    const { parseCc } = await import('../src/worker/slack');
    expect(parseCc('cc fix the build')).toBe('fix the build');
    expect(parseCc('  CC  fix\nthe build\n')).toBe('fix\nthe build');
    expect(parseCc('cc\nfix the build')).toBe('fix the build');
    expect(parseCc('cc')).toBe('');
    expect(parseCc(' Cc   ')).toBe('');
    // Slack's escaping, undone, as for a mention.
    expect(parseCc('cc a &amp;&amp; b &lt;div&gt; <https://x.test/1|x.test/1>')).toBe(
      'a && b <div> https://x.test/1',
    );
    // Not the command: `cc` is not a word of its own, or not first.
    expect(parseCc('ccsomething')).toBeUndefined();
    expect(parseCc('ccc fix the build')).toBeUndefined();
    expect(parseCc('cc: fix the build')).toBeUndefined();
    expect(parseCc('/cc fix the build')).toBeUndefined();
    expect(parseCc('please cc fix the build')).toBeUndefined();
    expect(parseCc('')).toBeUndefined();
  });

  it('starts a code channel for the owner and answers with the link', async () => {
    const { channels, posts } = await dm({
      user: owner,
      text: 'cc fix the build\nand tell <@U0SOMEONE>',
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.is_private).toBe('true');
    expect(channels[0]?.blocks).toContain('"fix the build\\nand tell <@U0SOMEONE>"');
    expect(channels[0]?.blocks).not.toContain('pynhq/pyn');
    // The same answer as to a mention, in the DM.
    expect(posts).toEqual([
      { channel: 'D0PIP', text: `:rocket: Started <#C0NEW> (${DEFAULT_CODE_MODEL}).` },
    ]);
  });

  it('takes the /cc prefixes', async () => {
    const { channels, posts } = await dm({ user: owner, text: '  CC public: raw: ship it' });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.is_private).toBe('false');
    expect(channels[0]?.blocks).toContain('"ship it"');
    expect(posts).toHaveLength(1);
  });

  it('takes the /cc repo words', async () => {
    const { channels } = await dm({ user: owner, text: 'cc public: web fix the build' });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.is_private).toBe('false');
    expect(channels[0]?.blocks).toContain('"In the ponhq/pynhq.com repo: fix the build"');
  });

  it('answers an empty prompt with the usage', async () => {
    const { CC_DM_USAGE } = await import('../src/worker/slack');
    expect(CC_DM_USAGE).toContain('`cc <prompt>`');
    for (const text of ['cc', 'CC   ', 'cc public:']) {
      const { channels, posts } = await dm({ user: owner, text });
      expect(channels).toEqual([]);
      expect(posts).toEqual([{ channel: 'D0PIP', text: CC_DM_USAGE }]);
    }
  });

  it('answers any other DM from the owner as before', async () => {
    for (const text of ['ccsomething', 'please cc fix the build', 'hello']) {
      const { channels, posts } = await dm({ user: owner, text });
      expect(channels).toEqual([]);
      expect(posts).toEqual([{ channel: 'D0PIP', text: `You said: ${text}` }]);
    }
  });

  it('only echoes someone who is not the owner, or a bot, listed or not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const text = 'cc fix the build';
      for (const event of [
        { user: 'U0SOMEONE', text },
        { user: 'U0BOT', bot_id: 'B0BOT', text },
      ]) {
        const { channels, posts } = await dm(event, { bots: 'U0SOMEONE,U0BOT,B0BOT' });
        expect(channels).toEqual([]);
        expect(posts).toEqual([{ channel: 'D0PIP', text: `You said: ${text}` }]);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores cc outside a DM', async () => {
    const { channels, posts } = await dm({
      user: owner,
      channel_type: 'channel',
      channel: 'C0HERE',
      text: 'cc fix the build',
    });
    expect(channels).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('does not start a second channel when Slack sends the event again', async () => {
    const event = { user: owner, text: 'cc fix the build' };
    expect((await dm(event)).channels).toHaveLength(1);
    const again = await dm(event, { retry: true });
    expect(again.channels).toEqual([]);
    expect(again.posts).toEqual([]);
  });
});

describe('secrets', () => {
  const keyOf = (byte: number, length = 32) => new Uint8Array(length).fill(byte).toBase64();

  it('reads back what it stored, under a fresh IV each time', async () => {
    const { decryptSecret, encryptSecret, importSecretsKey } = await import('../src/lib/secrets');
    const key = await importSecretsKey(keyOf(1));
    const stored = await encryptSecret(key, 'xoxb-the-token', 'T0SECOND01:bot_token');
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('xoxb');
    expect(await decryptSecret(key, stored, 'T0SECOND01:bot_token')).toBe('xoxb-the-token');
    expect(await encryptSecret(key, 'xoxb-the-token', 'T0SECOND01:bot_token')).not.toBe(stored);
  });

  it('refuses a changed value, another key, and another team or column', async () => {
    const { decryptSecret, encryptSecret, importSecretsKey } = await import('../src/lib/secrets');
    const key = await importSecretsKey(keyOf(1));
    const stored = await encryptSecret(key, 'xoxb-the-token', 'T0SECOND01:bot_token');
    const [version, iv = '', sealed = ''] = stored.split(':');
    const flipped = Uint8Array.fromBase64(sealed);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const otherIv = new Uint8Array(12).toBase64();
    for (const [using, value, context] of [
      [key, `${version}:${iv}:${flipped.toBase64()}`, 'T0SECOND01:bot_token'],
      [key, `${version}:${otherIv}:${sealed}`, 'T0SECOND01:bot_token'],
      [await importSecretsKey(keyOf(2)), stored, 'T0SECOND01:bot_token'],
      [key, stored, 'T0THIRD001:bot_token'],
      [key, stored, 'T0SECOND01:signing_secret'],
      [key, `v2:${iv}:${sealed}`, 'T0SECOND01:bot_token'],
      [key, 'xoxb-the-token', 'T0SECOND01:bot_token'],
    ] as const) {
      const error = await decryptSecret(using, value, context).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(sealed);
    }
  });

  it('takes only base64 of exactly 32 bytes as the key', async () => {
    const { importSecretsKey } = await import('../src/lib/secrets');
    for (const bad of ['', 'not base64!', keyOf(1, 16), keyOf(1, 31), keyOf(1, 33)]) {
      await expect(importSecretsKey(bad)).rejects.toThrow('PIP_SECRETS_KEY');
    }
    expect((await importSecretsKey(` ${keyOf(1)}\n`)).algorithm).toMatchObject({ length: 256 });
  });
});

describe('workspaces', () => {
  const owner = env.SLACK_OWNER_USER_ID;

  /** A second workspace as Settings' form sends it. Its last four fields are the secrets. */
  const SECOND = {
    team_id: 'T0SECOND01',
    label: 'Second',
    workspace: 'second',
    owner_user_id: 'U0OWNER002',
    cc_bot_ids: 'U0BOT00002, B0BOT00002',
    code_app_id: 'A0SECOND01',
    bot_token: 'xoxb-second-bot',
    signing_secret: 'second-signing-secret',
    client_token: 'xoxc-second-client',
    d_cookie: 'xoxd-second-cookie',
  };
  const SECRETS = ['bot_token', 'signing_secret', 'client_token', 'd_cookie'] as const;

  /**
   * Stands in for Slack. `xoxb-second-bot` is the second workspace's bot token, `xoxb-third-bot`
   * a third's, and any other the home one's. Gives the code channels started and the messages
   * posted, each with the credentials it was sent with.
   */
  function mockSlack() {
    const channels: Record<string, string | null>[] = [];
    const posts: Record<string, string | null>[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const authorization = request.headers.get('authorization');
      if (request.url === 'https://slack.com/api/auth.test') {
        const team_id =
          authorization === 'Bearer xoxb-second-bot'
            ? SECOND.team_id
            : authorization === 'Bearer xoxb-third-bot'
              ? 'T0THIRD001'
              : 'T0PIP';
        return Response.json({ ok: true, team_id, user_id: 'U0PIP', bot_id: 'B0PIP' });
      }
      const form = Object.fromEntries(await request.formData()) as Record<string, string>;
      if (request.url === 'https://slack.com/api/chat.postMessage') {
        posts.push({ authorization, ...form });
        return Response.json({ ok: true });
      }
      if (request.url.endsWith('/api/client.codeChannels.create')) {
        channels.push({ url: request.url, cookie: request.headers.get('cookie'), ...form });
        return Response.json({ ok: true, channel_id: 'C0NEW' });
      }
      throw new Error(`unexpected fetch: ${request.url}`);
    });
    return { channels, posts, restore: () => spy.mockRestore() };
  }

  const api = (path: string, method: string, body?: unknown) =>
    worker.fetch(`http://pip/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Starts over with the second workspace alone, added as Settings adds it. */
  async function addSecond(overrides: Record<string, unknown> = {}) {
    await env.DB.exec('DELETE FROM slack_workspaces');
    // Under the test's own stand-in for Slack when it has one up already.
    const slack = vi.isMockFunction(globalThis.fetch) ? undefined : mockSlack();
    try {
      const res = await api('workspaces', 'POST', { ...SECOND, ...overrides });
      expect(res.status).toBe(201);
    } finally {
      slack?.restore();
    }
  }

  /** A request to /slack/events through the Worker, signed with `secret`; waits for what it starts. */
  async function slackRequest(
    body: string,
    secret: string,
    contentType = 'application/json',
  ): Promise<Response> {
    const { default: app } = await import('../src/worker/index');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('http://pip/slack/events', {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': await slackSignature(secret, timestamp, body),
        },
        body,
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  /** An `app_mention` from a team, as Slack sends it. */
  const mentionFrom = (team: string, event: Record<string, unknown>) =>
    JSON.stringify({
      type: 'event_callback',
      team_id: team,
      event_id: 'Ev0TEST',
      event: { type: 'app_mention', channel: 'C0HERE', ts: '1700000000.000100', ...event },
    });

  /** A slash command from a team, as Slack sends it. */
  const commandFrom = (team: string, user: string, command: string, text: string) =>
    new URLSearchParams({
      token: 'legacy',
      team_id: team,
      team_domain: 'x',
      channel_id: 'C0HERE',
      channel_name: 'here',
      user_id: user,
      user_name: 'someone',
      command,
      text,
      api_app_id: 'A0PIP',
      response_url: 'https://hooks.slack.com/commands/x',
      trigger_id: '1.2.x',
    }).toString();

  it('adds, lists, changes and deletes a workspace without ever sending a secret back', async () => {
    await env.DB.exec('DELETE FROM slack_workspaces');
    const slack = mockSlack();
    const bodies: string[] = [];
    try {
      const created = await api('workspaces', 'POST', SECOND);
      expect(created.status).toBe(201);
      bodies.push(await created.clone().text());
      expect(await created.json()).toMatchObject({
        team_id: 'T0SECOND01',
        label: 'Second',
        workspace: 'second',
        owner_user_id: 'U0OWNER002',
        cc_bot_ids: 'U0BOT00002,B0BOT00002',
        code_app_id: 'A0SECOND01',
        client_token_set: true,
        d_cookie_set: true,
        code_channels_enabled: true,
      });

      const listed = await api('workspaces', 'GET');
      bodies.push(await listed.clone().text());
      expect(await listed.json()).toMatchObject({
        secrets_key: 'ok',
        home: { team_id: env.SLACK_TEAM_ID, workspace: 'pynhq', code_channels_enabled: true },
        workspaces: [{ team_id: 'T0SECOND01', label: 'Second' }],
      });

      // In D1 each secret is ciphertext, and a different one per column.
      const row = await env.DB.prepare('SELECT * FROM slack_workspaces').first<
        Record<string, string>
      >();
      for (const column of SECRETS) {
        expect(row?.[column]).toMatch(/^v1:/);
        expect(row?.[column]).not.toContain(SECOND[column]);
      }

      // A change with the secrets left blank keeps them; one given replaces it.
      const changed = await api('workspaces/T0SECOND01', 'PUT', {
        ...SECOND,
        label: 'Renamed',
        bot_token: '',
        signing_secret: 'another-signing-secret',
        client_token: '',
        d_cookie: undefined,
      });
      expect(changed.status).toBe(200);
      bodies.push(await changed.clone().text());
      expect(await changed.json()).toMatchObject({ label: 'Renamed', code_channels_enabled: true });
      const after = await env.DB.prepare('SELECT * FROM slack_workspaces').first<
        Record<string, string>
      >();
      expect(after?.bot_token).toBe(row?.bot_token);
      expect(after?.client_token).toBe(row?.client_token);
      expect(after?.d_cookie).toBe(row?.d_cookie);
      expect(after?.signing_secret).not.toBe(row?.signing_secret);

      for (const body of bodies) {
        expect(body).not.toContain('v1:');
        for (const secret of [...SECRETS.map((s) => SECOND[s]), 'another-signing-secret']) {
          expect(body).not.toContain(secret);
        }
        for (const column of SECRETS) {
          expect(body).not.toContain(`"${column}"`);
        }
      }

      expect((await api('workspaces/T0NOSUCH01', 'PUT', SECOND)).status).toBe(404);
      expect((await api('workspaces/T0SECOND01', 'DELETE')).status).toBe(204);
      expect((await api('workspaces/T0SECOND01', 'DELETE')).status).toBe(404);
    } finally {
      slack.restore();
    }
  });

  it('refuses a workspace that is the wrong shape, or whose bot token is another team’s', async () => {
    await addSecond();
    const slack = mockSlack();
    try {
      const third = { ...SECOND, team_id: 'T0THIRD001', bot_token: 'xoxb-third-bot' };
      for (const [status, input] of [
        [400, { ...third, team_id: 'third' }],
        [400, { ...third, team_id: env.SLACK_TEAM_ID }],
        [400, { ...third, label: ' ' }],
        [400, { ...third, workspace: 'evil.example/x' }],
        [400, { ...third, owner_user_id: 'jon' }],
        [400, { ...third, cc_bot_ids: 'U0BOT00002,claude' }],
        [400, { ...third, code_app_id: 'T0THIRD001' }],
        [400, { ...third, bot_token: '' }],
        [400, { ...third, bot_token: 'xoxp-a-user-token' }],
        [400, { ...third, signing_secret: '' }],
        [400, { ...third, d_cookie: '' }],
        // Slack says whose the token is: here the second workspace's, not the third's.
        [400, { ...third, bot_token: SECOND.bot_token }],
        [409, SECOND],
        [400, 'not an object'],
      ] as const) {
        const res = await api('workspaces', 'POST', input);
        expect([res.status, input]).toEqual([status, input]);
        expect(await res.text()).not.toContain('xoxb-third-bot');
      }
      const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM slack_workspaces').first<{
        n: number;
      }>()) ?? { n: -1 };
      expect(n).toBe(1);
      expect((await api('workspaces', 'POST', third)).status).toBe(201);
    } finally {
      slack.restore();
    }
  });

  it("takes a workspace as application/json only, so not from another site's form", async () => {
    await addSecond();
    const slack = mockSlack();
    try {
      const third = { ...SECOND, team_id: 'T0THIRD001', bot_token: 'xoxb-third-bot' };
      const json = JSON.stringify(third);
      // What a form on another site can send with no preflight: JSON as text/plain (the form's
      // `name=value` and line end, made to fall inside a string), or form-encoded.
      const asForm = `${JSON.stringify({ ...third, x: '' }).slice(0, -2)}="}\r\n`;
      expect(JSON.parse(asForm)).toMatchObject(third);
      for (const [type, body] of [
        ['text/plain', json],
        ['text/plain', asForm],
        ['text/plain;charset=UTF-8', json],
        ['application/x-www-form-urlencoded', json],
        ['multipart/form-data; boundary=x', json],
        [undefined, json],
      ] as const) {
        const headers: Record<string, string> = type ? { 'content-type': type } : {};
        for (const [method, path] of [
          ['POST', 'workspaces'],
          ['PUT', 'workspaces/T0SECOND01'],
        ] as const) {
          // A Blob has no type of its own, so the request has the header's or none.
          const res = await worker.fetch(`http://pip/api/${path}`, {
            method,
            headers,
            body: new Blob([body]),
          });
          expect([res.status, type, method]).toEqual([415, type, method]);
        }
      }
      // Nothing was added, changed or even asked of Slack.
      const stored = await env.DB.prepare(
        'SELECT team_id, label FROM slack_workspaces ORDER BY team_id',
      ).all();
      expect(stored.results).toEqual([{ team_id: 'T0SECOND01', label: 'Second' }]);

      const res = await worker.fetch('http://pip/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'Application/JSON; charset=utf-8' },
        body: json,
      });
      expect(res.status).toBe(201);
    } finally {
      slack.restore();
    }
  });

  it('says so, and keeps nothing, when PIP_SECRETS_KEY is unset or not a key', async () => {
    await env.DB.exec('DELETE FROM slack_workspaces');
    const secrets = env as { PIP_SECRETS_KEY?: string };
    const key = secrets.PIP_SECRETS_KEY;
    const slack = mockSlack();
    try {
      for (const [value, state] of [
        [undefined, 'unset'],
        ['dG9vIHNob3J0', 'invalid'],
      ] as const) {
        if (value === undefined) {
          delete secrets.PIP_SECRETS_KEY;
        } else {
          secrets.PIP_SECRETS_KEY = value;
        }
        const listed = await api('workspaces', 'GET');
        expect(await listed.json()).toMatchObject({ secrets_key: state, workspaces: [] });
        const res = await api('workspaces', 'POST', SECOND);
        expect(res.status).toBe(503);
        expect(await res.text()).toContain('PIP_SECRETS_KEY');
      }
      expect(await env.DB.prepare('SELECT team_id FROM slack_workspaces').first()).toBeNull();
    } finally {
      secrets.PIP_SECRETS_KEY = key;
      slack.restore();
    }
  });

  it('reads the team of an event, a slash command and an interaction', async () => {
    const { slackTeamId } = await import('../src/worker/workspaces');
    expect(slackTeamId(mentionFrom('T0SECOND01', {}))).toBe('T0SECOND01');
    expect(slackTeamId(commandFrom('T0SECOND01', 'U0X', '/cc', 'x'))).toBe('T0SECOND01');
    const interaction = { type: 'block_actions', team: { id: 'T0SECOND01' }, user: { id: 'U0X' } };
    expect(
      slackTeamId(new URLSearchParams({ payload: JSON.stringify(interaction) }).toString()),
    ).toBe('T0SECOND01');
    for (const body of ['', '{', '{"type":"url_verification"}', 'payload=%7B', 'ssl_check=1']) {
      expect(slackTeamId(body)).toBeUndefined();
    }
  });

  it('checks a request with the signing secret of the workspace it is from', async () => {
    await addSecond();
    const slack = mockSlack();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const text = '<@U0PIP> cc fix the build';
      const second = mentionFrom('T0SECOND01', { user: SECOND.owner_user_id, text });
      // Signed as the second workspace's app signs: started there, with its own credentials.
      expect((await slackRequest(second, SECOND.signing_secret)).status).toBe(200);
      expect(slack.channels).toHaveLength(1);
      expect(slack.channels[0]).toMatchObject({
        url: 'https://second.slack.com/api/client.codeChannels.create',
        cookie: 'd=xoxd-second-cookie',
        token: 'xoxc-second-client',
        team_id: 'T0SECOND01',
        app_id: 'A0SECOND01',
      });
      expect(slack.posts).toEqual([
        {
          authorization: 'Bearer xoxb-second-bot',
          channel: 'C0HERE',
          thread_ts: '1700000000.000100',
          text: `:rocket: Started <#C0NEW> (${DEFAULT_CODE_MODEL}).`,
        },
      ]);

      // The home secret doesn't open the second workspace, nor the second's the home one or a
      // team pip has never heard of.
      const home = mentionFrom('T0PIP', { user: owner, text });
      expect((await slackRequest(second, 'test-signing-secret')).status).toBe(401);
      expect((await slackRequest(home, SECOND.signing_secret)).status).toBe(401);
      expect(
        (await slackRequest(mentionFrom('T0UNKNOWN1', { user: owner, text }), 'wrong')).status,
      ).toBe(401);
      expect(slack.channels).toHaveLength(1);
      expect(slack.posts).toHaveLength(1);

      // A team with no row is the home workspace's, as it was before there were rows.
      expect((await slackRequest(home, 'test-signing-secret')).status).toBe(200);
      expect(slack.channels).toHaveLength(2);
      expect(slack.channels[1]).toMatchObject({
        url: 'https://pynhq.slack.com/api/client.codeChannels.create',
        cookie: 'd=xoxd-test',
        token: 'xoxc-test',
        team_id: env.SLACK_TEAM_ID,
        app_id: env.SLACK_CODE_APP_ID,
      });
      expect(slack.posts[1]?.authorization).toBe('Bearer xoxb-test');
    } finally {
      error.mockRestore();
      slack.restore();
    }
  });

  it('answers the owner of the workspace a request is from, and nobody from another', async () => {
    await addSecond();
    const slack = mockSlack();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const text = '<@U0PIP> cc fix the build';
      // The home owner is no one in the second workspace, and its owner no one at home.
      await slackRequest(mentionFrom('T0SECOND01', { user: owner, text }), SECOND.signing_secret);
      await slackRequest(
        mentionFrom('T0PIP', { user: SECOND.owner_user_id, text }),
        'test-signing-secret',
      );
      // Nor is a bot listed in one workspace allowed in the other.
      const bot = { user: 'U0BOT00002', bot_id: 'B0BOT00002', text };
      await slackRequest(mentionFrom('T0PIP', bot), 'test-signing-secret');
      expect(slack.channels).toEqual([]);
      expect(slack.posts).toEqual([]);

      await slackRequest(mentionFrom('T0SECOND01', bot), SECOND.signing_secret);
      expect(slack.channels).toHaveLength(1);
      expect(slack.channels[0]?.team_id).toBe('T0SECOND01');

      // `/pip` is the owner's alone too.
      const pip = (user: string) =>
        slackRequest(
          commandFrom('T0SECOND01', user, '/pip', 'hello'),
          SECOND.signing_secret,
          'application/x-www-form-urlencoded',
        );
      expect(await (await pip(SECOND.owner_user_id)).text()).toContain('You said: hello');
      expect(await (await pip(owner)).text()).not.toContain('You said');
    } finally {
      warn.mockRestore();
      slack.restore();
    }
  });

  it('reads the repo words in the home workspace only', async () => {
    await addSecond();
    const slack = mockSlack();
    try {
      const text = '<@U0PIP> cc web fix the header';
      await slackRequest(
        mentionFrom('T0SECOND01', { user: SECOND.owner_user_id, text }),
        SECOND.signing_secret,
      );
      await slackRequest(mentionFrom('T0PIP', { user: owner, text }), 'test-signing-secret');
      expect(slack.channels.map((sent) => sent.blocks?.match(/"text":("[^"]*")/)?.[1])).toEqual([
        '"web fix the header"',
        '"In the ponhq/pynhq.com repo: fix the header"',
      ]);

      // The usage doesn't offer them there either.
      const { CC_USAGE } = await import('../src/worker/slack');
      const usage = async (team: string, user: string, secret: string) => {
        const res = await slackRequest(
          commandFrom(team, user, '/cc', ''),
          secret,
          'application/x-www-form-urlencoded',
        );
        return ((await res.json()) as { text: string }).text;
      };
      expect(await usage('T0PIP', owner, 'test-signing-secret')).toBe(CC_USAGE);
      const there = await usage('T0SECOND01', SECOND.owner_user_id, SECOND.signing_secret);
      expect(CC_USAGE.startsWith(there)).toBe(true);
      expect(there).not.toContain('says which repo');
    } finally {
      slack.restore();
    }
  });

  it('says code channels are not set up in a workspace without a session or an app ID', async () => {
    const slack = mockSlack();
    try {
      for (const missing of [{ client_token: '', d_cookie: '' }, { code_app_id: '' }]) {
        await addSecond(missing);
        const listed = await (await api('workspaces', 'GET')).json<{
          workspaces: { code_channels_enabled: boolean }[];
        }>();
        expect(listed.workspaces[0]?.code_channels_enabled).toBe(false);

        slack.posts.length = 0;
        await slackRequest(
          mentionFrom('T0SECOND01', { user: SECOND.owner_user_id, text: '<@U0PIP> cc fix it' }),
          SECOND.signing_secret,
        );
        expect(slack.channels).toEqual([]);
        expect(slack.posts).toHaveLength(1);
        expect(slack.posts[0]?.text).toContain('Code channels are not set up for this workspace');

        for (const command of ['/cc', '/sitrep']) {
          const res = await slackRequest(
            commandFrom('T0SECOND01', SECOND.owner_user_id, command, 'fix it'),
            SECOND.signing_secret,
            'application/x-www-form-urlencoded',
          );
          expect(await res.text()).toContain('not set up for this workspace');
        }

        const res = await api('code-channel', 'POST', {
          prompt: 'fix it',
          workspace: 'T0SECOND01',
        });
        expect(res.status).toBe(503);
        expect(await res.text()).toContain('not set up for workspace T0SECOND01');
      }
      expect(slack.channels).toEqual([]);
    } finally {
      slack.restore();
    }
  });

  it('answers the url_verification of a workspace added on Settings', async () => {
    await addSecond();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    expect(await (await slackRequest(body, SECOND.signing_secret)).text()).toBe('abc123');
    expect(await (await slackRequest(body, 'test-signing-secret')).text()).toBe('abc123');
    expect((await slackRequest(body, 'nobody-signing-secret')).status).toBe(401);
  });

  it('does not use a workspace whose stored secret was moved or does not decrypt', async () => {
    const slack = mockSlack();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = () =>
      slackRequest(
        mentionFrom('T0SECOND01', { user: SECOND.owner_user_id, text: '<@U0PIP> cc fix it' }),
        SECOND.signing_secret,
      );
    try {
      // Another column's ciphertext, another row's, and one made under another key.
      const { encryptSecret, importSecretsKey } = await import('../src/lib/secrets');
      const otherKey = await importSecretsKey(new Uint8Array(32).fill(9).toBase64());
      const foreign = await encryptSecret(otherKey, 'xoxd-second-cookie', 'T0SECOND01:d_cookie');
      const third = { ...SECOND, team_id: 'T0THIRD001', bot_token: 'xoxb-third-bot' };
      for (const [column, sql] of [
        [
          'signing_secret',
          "UPDATE slack_workspaces SET signing_secret = bot_token WHERE team_id = 'T0SECOND01'",
        ],
        [
          'bot_token',
          "UPDATE slack_workspaces SET bot_token = (SELECT bot_token FROM slack_workspaces WHERE team_id = 'T0THIRD001') WHERE team_id = 'T0SECOND01'",
        ],
        ['d_cookie', `UPDATE slack_workspaces SET d_cookie = '${foreign}'`],
      ] as const) {
        await addSecond();
        expect((await api('workspaces', 'POST', third)).status).toBe(201);
        expect((await request()).status).toBe(200);
        await env.DB.exec(sql);
        error.mockClear();
        slack.channels.length = 0;
        slack.posts.length = 0;
        expect((await request()).status).toBe(401);
        expect(slack.channels).toEqual([]);
        expect(slack.posts).toEqual([]);
        // The log says which team and column, and has no value in it.
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0]?.[1]).toEqual({ team: 'T0SECOND01', column });
        expect(JSON.stringify(error.mock.calls)).not.toMatch(/v1:|xox|signing-secret/);
        // The code channel API turns it down as well.
        const res = await api('code-channel', 'POST', {
          prompt: 'fix it',
          workspace: 'T0SECOND01',
        });
        expect(res.status).toBe(503);
      }
    } finally {
      error.mockRestore();
      slack.restore();
    }
  });

  it('starts a code channel in the workspace the Code page or the MCP tool names', async () => {
    await addSecond();
    const slack = mockSlack();
    try {
      const res = await api('code-channel', 'POST', { prompt: 'fix it', workspace: 'T0SECOND01' });
      expect(res.status).toBe(201);
      // The link is to that workspace, and the preamble, which names a home repo, is left off.
      expect(await res.json()).toMatchObject({
        prompt: 'fix it',
        channel_id: 'C0NEW',
        url: 'https://second.slack.com/archives/C0NEW',
      });
      const viaTool = await callTool('create_code_channel', {
        prompt: 'fix it',
        workspace: 'T0SECOND01',
      });
      expect(viaTool.isError).toBe(false);
      expect(JSON.parse(viaTool.text)).toMatchObject({
        prompt: 'fix it',
        url: 'https://second.slack.com/archives/C0NEW',
      });
      // With no workspace, or the home one's team ID, it is the home workspace, preamble and all.
      for (const workspace of [undefined, env.SLACK_TEAM_ID]) {
        const home = await api('code-channel', 'POST', { prompt: 'fix it', workspace });
        expect(await home.json()).toMatchObject({
          prompt: 'In pynhq/pyn repo fix it',
          url: 'https://pynhq.slack.com/archives/C0NEW',
        });
      }
      expect(slack.channels.map((sent) => [sent.url?.split('/')[2], sent.team_id])).toEqual([
        ['second.slack.com', 'T0SECOND01'],
        ['second.slack.com', 'T0SECOND01'],
        ['pynhq.slack.com', env.SLACK_TEAM_ID],
        ['pynhq.slack.com', env.SLACK_TEAM_ID],
      ]);

      const unknown = await api('code-channel', 'POST', { prompt: 'x', workspace: 'T0NOSUCH01' });
      expect(unknown.status).toBe(404);
      const tool = await callTool('create_code_channel', { prompt: 'x', workspace: 'T0NOSUCH01' });
      expect(tool.isError).toBe(true);
      expect(tool.text).toContain('No workspace T0NOSUCH01');
      expect(slack.channels).toHaveLength(4);
    } finally {
      slack.restore();
    }
  });

  it('uses the session a workspace was added with or changed to, however its cookie was copied', async () => {
    // Added with the d cookie as developer tools show it URL-decoded.
    await addSecond({ d_cookie: 'xoxd-aB3+cD4/eF5==' });
    const slack = mockSlack();
    try {
      const request = () =>
        slackRequest(
          mentionFrom('T0SECOND01', { user: SECOND.owner_user_id, text: '<@U0PIP> cc fix it' }),
          SECOND.signing_secret,
        );
      expect((await request()).status).toBe(200);
      expect(slack.channels[0]).toMatchObject({
        url: 'https://second.slack.com/api/client.codeChannels.create',
        cookie: 'd=xoxd-aB3%2BcD4%2FeF5%3D%3D',
        token: 'xoxc-second-client',
      });

      // Both entered again on Settings, the rest left as it was: the next channel is started
      // with the new pair, and the bot token and signing secret are the ones kept.
      const changed = await api('workspaces/T0SECOND01', 'PUT', {
        ...SECOND,
        bot_token: '',
        signing_secret: '',
        client_token: ' xoxc-second-again ',
        d_cookie: 'xoxd-gH6%2BiJ7%2FkL8%3D',
      });
      expect(changed.status).toBe(200);
      expect((await request()).status).toBe(200);
      expect(slack.channels[1]).toMatchObject({
        url: 'https://second.slack.com/api/client.codeChannels.create',
        cookie: 'd=xoxd-gH6%2BiJ7%2FkL8%3D',
        token: 'xoxc-second-again',
        team_id: 'T0SECOND01',
        app_id: 'A0SECOND01',
      });
      expect(slack.posts.map((post) => post.authorization)).toEqual([
        'Bearer xoxb-second-bot',
        'Bearer xoxb-second-bot',
      ]);

      // One of the pair alone replaces that one and keeps the other.
      const cookieOnly = await api('workspaces/T0SECOND01', 'PUT', {
        ...SECOND,
        bot_token: '',
        signing_secret: '',
        client_token: '',
        d_cookie: 'xoxd-mN9+oP0=',
      });
      expect(cookieOnly.status).toBe(200);
      expect((await request()).status).toBe(200);
      expect(slack.channels[2]).toMatchObject({
        cookie: 'd=xoxd-mN9%2BoP0%3D',
        token: 'xoxc-second-again',
      });
      // In a DM it is the same workspace's session, host, team and code app: nothing of the
      // home workspace's, nor its defaults.
      const dm = mentionFrom('T0SECOND01', {
        type: 'message',
        channel_type: 'im',
        channel: 'D0PIP',
        user: SECOND.owner_user_id,
        text: 'cc fix it',
      });
      expect((await slackRequest(dm, SECOND.signing_secret)).status).toBe(200);
      expect(slack.channels[3]).toMatchObject({
        url: 'https://second.slack.com/api/client.codeChannels.create',
        cookie: 'd=xoxd-mN9%2BoP0%3D',
        token: 'xoxc-second-again',
        team_id: 'T0SECOND01',
        app_id: 'A0SECOND01',
      });
      expect(slack.posts[3]).toMatchObject({
        authorization: 'Bearer xoxb-second-bot',
        channel: 'D0PIP',
        text: `:rocket: Started <#C0NEW> (${DEFAULT_CODE_MODEL}).`,
      });
      expect(JSON.stringify(slack.channels)).not.toMatch(
        /xox[cd]-test|pynhq|TH0RA7683|A08SF47R6P4/,
      );

      // Copied with its name, it is still the cookie; what isn't one is still turned down.
      const named = await api('workspaces/T0SECOND01', 'PUT', {
        ...SECOND,
        bot_token: '',
        signing_secret: '',
        client_token: '',
        d_cookie: ' d=xoxd-qR1/sT2= ',
      });
      expect(named.status).toBe(200);
      expect((await request()).status).toBe(200);
      expect(slack.channels[4]?.cookie).toBe('d=xoxd-qR1%2FsT2%3D');
      for (const d_cookie of ['d=', 'b=xoxd-qR1', 'xoxc-not-a-cookie']) {
        const res = await api('workspaces/T0SECOND01', 'PUT', {
          ...SECOND,
          bot_token: '',
          signing_secret: '',
          client_token: '',
          d_cookie,
        });
        // A name with nothing after it is a field left blank, which keeps what is stored.
        expect([d_cookie, res.status]).toEqual([d_cookie, d_cookie === 'd=' ? 200 : 400]);
      }
      expect((await request()).status).toBe(200);
      expect(slack.channels[5]?.cookie).toBe('d=xoxd-qR1%2FsT2%3D');
    } finally {
      slack.restore();
    }
  });

  it('hands out a manifest for the Slack app the Worker answers', async () => {
    const { SLACK_COMMANDS, slackManifest } = await import('../src/shared/slack-manifest');
    const manifest = slackManifest('https://pip.example.com');
    const url = 'https://pip.example.com/slack/events';
    // The scopes and events the README has for the home app, which is what the Worker handles:
    // `app_mention`, and a `message` in an `im`.
    expect(manifest.oauth_config).toEqual({
      scopes: { bot: ['app_mentions:read', 'chat:write', 'commands', 'im:history'] },
    });
    expect(manifest.settings).toEqual({
      event_subscriptions: { request_url: url, bot_events: ['app_mention', 'message.im'] },
      interactivity: { is_enabled: true, request_url: url },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    });
    expect(manifest.display_information).toEqual({ name: 'pip' });
    expect(manifest.features.bot_user).toEqual({ display_name: 'pip' });
    // DMs to pip need the Messages tab, and it not read-only.
    expect(manifest.features.app_home).toMatchObject({
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
    // Every URL in it is on the origin given, and there is nothing else to call.
    const urls = JSON.stringify(manifest).match(/https?:[^"]*/g);
    expect(urls).toHaveLength(5);
    expect(new Set(urls)).toEqual(new Set([url]));
    for (const key of ['redirect_urls', 'user', 'app_directory']) {
      expect(JSON.stringify(manifest)).not.toContain(`"${key}"`);
    }

    // The commands are SLACK_COMMANDS, each with a description, and the Worker answers each one:
    // a command it has no handler for is a 404.
    const commands = Object.keys(SLACK_COMMANDS);
    expect(commands).toEqual(['/pip', '/cc', '/sitrep']);
    expect(manifest.features.slash_commands.map((item) => item.command)).toEqual(commands);
    for (const item of manifest.features.slash_commands) {
      expect(item.url).toBe(url);
      expect(item.description).not.toBe('');
    }
    // Slack says yes to whatever a command goes on to ask of it, a reply to its response_url too.
    const slack = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const { hostname } = new URL(input instanceof Request ? input.url : String(input));
      return hostname === 'hooks.slack.com'
        ? new Response('ok')
        : Response.json({ ok: true, team_id: 'T0PIP', user_id: 'U0PIP', bot_id: 'B0PIP' });
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const send = (command: string) =>
        slackRequest(
          commandFrom('T0PIP', owner, command, ''),
          'test-signing-secret',
          'application/x-www-form-urlencoded',
        );
      for (const command of commands) {
        const res = await send(command);
        expect([command, res.status]).toEqual([command, 200]);
        expect(((await res.json()) as { text: string }).text).not.toBe('');
      }
      expect((await send('/nope')).status).toBe(404);
    } finally {
      log.mockRestore();
      slack.mockRestore();
    }
  });

  it('asks on the setup page for what the API takes, and says which of it is needed', async () => {
    const { WORKSPACE_FIELDS, WORKSPACE_FIELD_GROUPS } = await import(
      '../src/shared/workspace-fields'
    );
    const names = WORKSPACE_FIELDS.map((field) => field.name);
    // Every field the form sends is one the API reads, each once and under a group's title, with
    // where its value comes from.
    expect([...names].sort()).toEqual(Object.keys(SECOND).sort());
    for (const group of WORKSPACE_FIELD_GROUPS) {
      expect(group.title).not.toBe('');
      expect(group.about).not.toBe('');
    }
    for (const field of WORKSPACE_FIELDS) {
      expect([field.name, field.label, field.placeholder, field.hint]).not.toContain('');
    }
    // The write-only fields are the four encrypted columns, so no other field is typed out of
    // sight and none of these is ever filled in from the server.
    expect(WORKSPACE_FIELDS.filter((field) => field.secret).map((field) => field.name)).toEqual([
      ...SECRETS,
    ]);

    // What the form marks as needed is what the API needs: a workspace is added with those fields
    // alone, and not without any one of them.
    const required = WORKSPACE_FIELDS.filter((field) => field.required).map((field) => field.name);
    const needed = Object.fromEntries(
      required.map((name) => [name, SECOND[name as keyof typeof SECOND]]),
    );
    await env.DB.exec('DELETE FROM slack_workspaces');
    const slack = mockSlack();
    try {
      for (const name of required) {
        const res = await api('workspaces', 'POST', { ...needed, [name]: '' });
        expect([name, res.status]).toEqual([name, 400]);
      }
      const res = await api('workspaces', 'POST', needed);
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        team_id: SECOND.team_id,
        cc_bot_ids: '',
        code_app_id: null,
        code_channels_enabled: false,
      });
    } finally {
      slack.restore();
    }
  });

  it("has the home workspace only when the table isn't there yet", async () => {
    await env.DB.exec('DELETE FROM slack_workspaces');
    await env.DB.exec('ALTER TABLE slack_workspaces RENAME TO slack_workspaces_later');
    const slack = mockSlack();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const listed = await api('workspaces', 'GET');
      expect(await listed.json()).toMatchObject({ secrets_key: 'ok', workspaces: [] });
      const res = await api('workspaces', 'POST', SECOND);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('pnpm run migrate');

      const text = '<@U0PIP> cc fix the build';
      const home = mentionFrom('T0PIP', { user: owner, text });
      expect((await slackRequest(home, 'test-signing-secret')).status).toBe(200);
      expect(slack.channels).toHaveLength(1);
      expect(slack.channels[0]?.url).toBe('https://pynhq.slack.com/api/client.codeChannels.create');
      const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
      expect(await (await slackRequest(body, 'test-signing-secret')).text()).toBe('abc123');
      expect((await slackRequest(body, 'nobody-signing-secret')).status).toBe(401);
    } finally {
      warn.mockRestore();
      slack.restore();
      await env.DB.exec('ALTER TABLE slack_workspaces_later RENAME TO slack_workspaces');
    }
  });

  it("never reads D1 for the home workspace's own team", async () => {
    const { slackEnvForRequest } = await import('../src/worker/workspaces');
    const prepare = vi.spyOn(env.DB, 'prepare');
    try {
      const body = mentionFrom(env.SLACK_TEAM_ID, { user: owner, text: 'hello' });
      expect(await slackEnvForRequest(new Headers(), body)).toBeUndefined();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
    }
  });
});
