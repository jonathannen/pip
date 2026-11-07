import { exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

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
      service_token: false,
      version: 'local',
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
