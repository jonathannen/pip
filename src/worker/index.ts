import { env } from 'cloudflare:workers';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { codeChannelsEnabled, launchCodeChannel } from '../lib/code-channel';
import { gmailEnabled } from '../lib/gmail';
import type {
  CodeChannelRequest,
  CodeChannelResult,
  Deployment,
  Me,
  Note,
  SlackWorkspace,
  SlackWorkspaces,
} from '../shared/api';
import { CODE_MODELS } from '../shared/api';
import type { Identity } from './access';
import { requireAccess } from './access';
import { gmailConnectedAt, google } from './google';
import { mcp } from './mcp';
import { addNote, deleteNote, listNotes, parseNoteBody } from './notes';
import { slack } from './slack';
import {
  codeChannelWorkspace,
  deleteWorkspace,
  listWorkspaces,
  saveWorkspace,
  slackEnvForRequest,
  WorkspaceError,
} from './workspaces';

const api = new Hono<{ Variables: { identity: Identity } }>()
  .use(requireAccess)
  .get('/me', async (c) => {
    const { email, serviceToken } = c.get('identity');
    return c.json<Me>({
      email,
      code_channels_enabled: codeChannelsEnabled(env),
      gmail_enabled: gmailEnabled(env),
      gmail_connected_at: await gmailConnectedAt(),
      service_token: serviceToken,
      version: import.meta.env.DEV ? 'local' : env.CF_VERSION_METADATA.id,
    });
  })
  .get('/deployment', (c) => c.json<Deployment>(deployment()))
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
    const json: unknown = await c.req.json().catch(() => null);
    const request = parseCodeChannelRequest(json);
    // The workspace to make it in: the home one unless the form names another.
    let target = { env: env as Parameters<typeof launchCodeChannel>[0], home: true };
    if (request?.workspace !== undefined) {
      try {
        target = await codeChannelWorkspace(request.workspace);
      } catch (error) {
        return workspaceError(c, error);
      }
    }
    if (!codeChannelsEnabled(target.env)) {
      return c.json(
        { error: 'Code channels are off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set' },
        503,
      );
    }
    if (request === undefined) {
      return c.json({ error: 'prompt must be a non-empty string' }, 400);
    }
    try {
      return c.json<CodeChannelResult>(
        await launchCodeChannel(target.env, request, target.home),
        201,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  })
  // Settings' Workspaces: the Slack workspaces besides the home one. No secret is ever sent back.
  .get('/workspaces', async (c) => c.json<SlackWorkspaces>(await listWorkspaces()))
  .post('/workspaces', async (c) => {
    try {
      const json: unknown = await c.req.json().catch(() => null);
      return c.json<SlackWorkspace>(await saveWorkspace(json), 201);
    } catch (error) {
      return workspaceError(c, error);
    }
  })
  .put('/workspaces/:team_id', async (c) => {
    try {
      const json: unknown = await c.req.json().catch(() => null);
      return c.json<SlackWorkspace>(await saveWorkspace(json, c.req.param('team_id')));
    } catch (error) {
      return workspaceError(c, error);
    }
  })
  .delete('/workspaces/:team_id', async (c) => {
    if (!(await deleteWorkspace(c.req.param('team_id')))) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.body(null, 204);
  });

/** A WorkspaceError as the API answers it; anything else is thrown on. */
function workspaceError(c: Context, error: unknown) {
  if (error instanceof WorkspaceError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
}

/** The GitHub repository pip's source is in, for the commit link on Settings. */
const PIP_REPO = 'jonathannen/pip';

/** The build serving this request: what vite.config.ts built in, and the Worker version. */
function deployment(): Deployment {
  const version = import.meta.env.DEV ? null : env.CF_VERSION_METADATA;
  return {
    repo: PIP_REPO,
    commit: import.meta.env.PIP_COMMIT ?? null,
    message: import.meta.env.PIP_MESSAGE ?? null,
    branch: import.meta.env.PIP_BRANCH ?? null,
    dirty: import.meta.env.PIP_DIRTY ?? false,
    built_at: import.meta.env.PIP_BUILT_AT ?? null,
    version_id: version?.id ?? 'local',
    version_tag: version?.tag || null,
    deployed_at: version?.timestamp ?? null,
  };
}

/** The form's JSON, checked; undefined when the prompt is missing or an option is the wrong type. */
function parseCodeChannelRequest(json: unknown): CodeChannelRequest | undefined {
  if (json === null || typeof json !== 'object') {
    return undefined;
  }
  const { prompt, is_private, add_preamble, model, workspace } = json as Record<string, unknown>;
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
    ...(typeof workspace === 'string' && workspace !== '' && { workspace }),
  };
}

const app = new Hono<{ Bindings: Env }>()
  .route('/api', api)
  .route('/mcp', mcp)
  .route('/auth/google', google)
  // Not behind Access (Slack can't sign in); authenticated by Slack's request signature, checked
  // with the signing secret of the workspace the request is from (the home one's by default).
  .post('/slack/events', async (c) => {
    // Read as bytes: `text()` warns about a slash command's form-encoded body.
    const body = new TextDecoder().decode(await c.req.raw.clone().arrayBuffer());
    const workspace = await slackEnvForRequest(c.req.raw.headers, body);
    if (workspace === null) {
      return c.text('Unauthorized', 401);
    }
    const app = workspace ? slack(workspace, false) : slack(c.env);
    return app.run(c.req.raw, c.executionCtx);
  });

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
