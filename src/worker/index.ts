import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { codeChannelsEnabled, launchCodeChannel } from '../lib/code-channel';
import type { CodeChannelRequest, CodeChannelResult, Me, Note } from '../shared/api';
import { CODE_MODELS } from '../shared/api';
import type { Identity } from './access';
import { requireAccess } from './access';
import { mcp } from './mcp';
import { addNote, deleteNote, listNotes, parseNoteBody } from './notes';
import { slack } from './slack';

const api = new Hono<{ Variables: { identity: Identity } }>()
  .use(requireAccess)
  .get('/me', (c) => {
    const { email, serviceToken } = c.get('identity');
    return c.json<Me>({
      email,
      code_channels_enabled: codeChannelsEnabled(env),
      service_token: serviceToken,
      version: import.meta.env.DEV ? 'local' : env.CF_VERSION_METADATA.id,
    });
  })
  .get('/notes', async (c) => c.json<Note[]>(await listNotes()))
  .post('/notes', async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const body = parseNoteBody(
      json !== null && typeof json === 'object' ? (json as { body?: unknown }).body : undefined,
    );
    if (body === undefined) {
      return c.json({ error: 'body must be a non-empty string' }, 400);
    }
    return c.json<Note>(await addNote(body, c.get('identity').email), 201);
  })
  .delete('/notes/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || !(await deleteNote(id))) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.body(null, 204);
  })
  // The website's "launch a code channel" form: the same options as the MCP tool and `/cc`.
  .post('/code-channel', async (c) => {
    if (!codeChannelsEnabled(env)) {
      return c.json(
        { error: 'Code channels are off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set' },
        503,
      );
    }
    const request = parseCodeChannelRequest(await c.req.json().catch(() => null));
    if (request === undefined) {
      return c.json({ error: 'prompt must be a non-empty string' }, 400);
    }
    try {
      return c.json<CodeChannelResult>(await launchCodeChannel(env, request), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

/** The form's JSON, checked; undefined when the prompt is missing or an option is the wrong type. */
function parseCodeChannelRequest(json: unknown): CodeChannelRequest | undefined {
  if (json === null || typeof json !== 'object') {
    return undefined;
  }
  const { prompt, is_private, add_preamble, model } = json as Record<string, unknown>;
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return undefined;
  }
  const bool = (value: unknown) => (value === undefined ? undefined : Boolean(value));
  if (model !== undefined && !CODE_MODELS.includes(model as (typeof CODE_MODELS)[number])) {
    return undefined;
  }
  return {
    prompt: prompt.trim(),
    is_private: bool(is_private),
    add_preamble: bool(add_preamble),
    model: model as CodeChannelRequest['model'],
  };
}

const app = new Hono<{ Bindings: Env }>()
  .route('/api', api)
  .route('/mcp', mcp)
  // Not behind Access (Slack can't sign in); authenticated by Slack's request signature.
  .post('/slack/events', (c) => slack(c.env).run(c.req.raw, c.executionCtx));

/** The entry in `triggers.crons` in wrangler.jsonc: once a day. */
export const HEARTBEAT_CRON = '0 20 * * *';

export default {
  fetch: app.fetch,
  async scheduled(controller) {
    // Nothing to do yet; this is where daily work goes.
    console.warn(
      'pip: heartbeat',
      controller.cron,
      new Date(controller.scheduledTime).toISOString(),
    );
  },
} satisfies ExportedHandler<Env>;
