// Slack's internal web-client API (undocumented). Auth is the browser session:
// an xoxc token in the form body plus the matching `d` (xoxd) cookie, percent-encoded.
// Shared by the Worker's MCP server, the API, the Slack app and the stdio entry, so it takes its env.

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { CodeChannelRequest, CodeChannelResult, CodeModel } from '../shared/api.ts';
import {
  CODE_CHANNEL_PREAMBLE,
  CODE_MODEL_IDS,
  CODE_MODELS,
  DEFAULT_CODE_MODEL,
} from '../shared/api.ts';

export interface CodeChannelEnv {
  readonly SLACK_CLIENT_TOKEN?: string | undefined;
  readonly SLACK_D_COOKIE?: string | undefined;
  readonly SLACK_WORKSPACE?: string | undefined;
  readonly SLACK_TEAM_ID?: string | undefined;
  readonly SLACK_CODE_APP_ID?: string | undefined;
}

const DEFAULTS = { workspace: 'pynhq', teamId: 'TH0RA7683', codeAppId: 'A08SF47R6P4' };

/**
 * Finds the env of the workspace with a team ID, and whether it is the home one. Throws, saying
 * why, when there is no such workspace or code channels aren't set up in it.
 */
export type CodeChannelWorkspaces = (
  teamId: string,
) => Promise<{ readonly env: CodeChannelEnv; readonly home: boolean }>;

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

/** Whether the browser-session secrets are set, so channels can be created. */
export function codeChannelsEnabled(env: CodeChannelEnv): boolean {
  return Boolean(env.SLACK_CLIENT_TOKEN && env.SLACK_D_COOKIE);
}

function requireEnv(env: CodeChannelEnv, name: 'SLACK_CLIENT_TOKEN' | 'SLACK_D_COOKIE'): string {
  // Trimmed: a workspace's are when Settings saves them, a secret set with wrangler is not.
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set (wrangler secret put ${name}, or .dev.vars locally)`);
  }
  return value;
}

/**
 * The `d` cookie's value as Slack takes it: percent-encoded, which is how the browser keeps it
 * (`xoxd-…%2B…%2F…%3D`). It also gets copied URL-decoded (`xoxd-…+…/…=`), and sent like that
 * Slack reads a `+` as a space and answers `invalid_auth`. So one already encoded comes back as
 * it is, never encoded twice, and one that isn't, or is only in part, comes back encoded. A `d=`
 * before it and the space around it are taken off. Giving it its own result changes nothing.
 */
export function dCookieValue(copied: string): string {
  const value = copied.trim().replace(/^d=\s*/, '');
  if (/^(?:[\w.~-]|%[0-9A-Fa-f]{2})*$/.test(value)) {
    return value;
  }
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    // A `%` that begins no escape is one of the value's own characters: nothing to decode first.
    return encodeURIComponent(value);
  }
}

const host = (env: CodeChannelEnv) => `${env.SLACK_WORKSPACE || DEFAULTS.workspace}.slack.com`;

/** One call to the web-client API as the session: Slack's answer, `ok` or not. */
async function post(
  env: CodeChannelEnv,
  method: string,
  fields: Record<string, string>,
): Promise<SlackResponse> {
  const form = new FormData();
  form.set('token', requireEnv(env, 'SLACK_CLIENT_TOKEN'));
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  const res = await fetch(`https://${host(env)}/api/${method}`, {
    method: 'POST',
    headers: {
      cookie: `d=${dCookieValue(requireEnv(env, 'SLACK_D_COOKIE'))}`,
      origin: 'https://app.slack.com',
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`);
  }
  return (await res.json()) as SlackResponse;
}

/** What Slack answers when it is who is asking that it turns down, whatever was asked. */
const SESSION_ERRORS = ['invalid_auth', 'not_authed', 'token_revoked', 'token_expired'];

/**
 * What to make of Slack turning a call down with one of SESSION_ERRORS, which reads the same
 * whether the token and cookie are no good or it is what they were sent with. Slack is asked
 * `auth.test` with the same session to tell the two apart. Names the host and the IDs sent, never
 * the token or the cookie.
 */
async function sessionTurnedDown(
  env: CodeChannelEnv,
  fields: Record<string, string>,
): Promise<string> {
  const enterAgain =
    "Copy both again from one browser signed in to that workspace (they stop working when it signs out) and enter them: on pip's Settings for a workspace added there, as the SLACK_CLIENT_TOKEN and SLACK_D_COOKIE secrets for the home one.";
  const test = await post(env, 'auth.test', {}).catch(() => undefined);
  if (!test) {
    return `Slack turned down the browser session sent to ${host(env)}: its client token and d cookie. ${enterAgain}`;
  }
  if (!test.ok) {
    return `Slack turns down the browser session sent to ${host(env)} whatever is asked (auth.test: ${test.error ?? 'unknown error'}), so it is the client token and d cookie. ${enterAgain}`;
  }
  const id = (value: unknown) => (typeof value === 'string' && value !== '' ? value : 'unknown');
  const sentAs = fields.team_id || env.SLACK_TEAM_ID || DEFAULTS.teamId;
  const sent = `team ${sentAs}${fields.app_id ? ` and code app ${fields.app_id}` : ''}`;
  const where = typeof test.url === 'string' ? `, ${test.url}` : '';
  const taken = `Slack takes the browser session at ${host(env)} (auth.test: team ${id(test.team_id)}, member ${id(test.user_id)}${where}), so the client token and d cookie are a working pair.`;
  return test.team_id === sentAs
    ? `${taken} It is this request it turns down, sent with ${sent}: check those and the host.`
    : `${taken} That session is team ${id(test.team_id)}’s, and this was sent as ${sent}: the client token is another workspace’s, or the team ID is not this one’s.`;
}

export async function callClientApi(
  env: CodeChannelEnv,
  method: string,
  fields: Record<string, string>,
) {
  const body = await post(env, method, fields);
  if (!body.ok) {
    const error = body.error ?? 'unknown error';
    const why = SESSION_ERRORS.includes(error) ? `. ${await sessionTurnedDown(env, fields)}` : '';
    throw new Error(`${method}: ${error}${why}`);
  }
  return body;
}

export function createCodeChannel(
  env: CodeChannelEnv,
  prompt: string,
  isPrivate: boolean,
  model: CodeModel,
) {
  const blocks = [
    {
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: prompt }] }],
    },
  ];

  return callClientApi(env, 'client.codeChannels.create', {
    app_id: env.SLACK_CODE_APP_ID || DEFAULTS.codeAppId,
    team_id: env.SLACK_TEAM_ID || DEFAULTS.teamId,
    is_private: String(isPrivate),
    blocks: JSON.stringify(blocks),
    model: CODE_MODEL_IDS[model],
    entrypoint: 'fe_sidebar_context_menu',
  });
}

/** Slack's response names the channel in one of a few places; the first ID that looks like one. */
function findChannelId(response: Record<string, unknown>): string | null {
  const candidates = [
    response.channel_id,
    response.channel,
    (response.channel as { id?: unknown } | undefined)?.id,
    (response.code_channel as { channel_id?: unknown } | undefined)?.channel_id,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[CDG][A-Z0-9]+$/.test(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Creates a code channel with the same options the MCP tool takes, applying the defaults and the
 * preamble. Throws when the secrets are missing or Slack says no. `env` is the workspace it is
 * made in (`request.workspace` is not read here); the preamble names a home repo, so outside the
 * home workspace it is left off.
 */
export async function launchCodeChannel(
  env: CodeChannelEnv,
  request: CodeChannelRequest,
  home = true,
): Promise<CodeChannelResult> {
  const { is_private = true, add_preamble = true, model = DEFAULT_CODE_MODEL } = request;
  const prompt = add_preamble && home ? CODE_CHANNEL_PREAMBLE + request.prompt : request.prompt;
  const response = await createCodeChannel(env, prompt, is_private, model);
  const channelId = findChannelId(response);
  return {
    prompt,
    model,
    channel_id: channelId,
    url: channelId ? `https://${host(env)}/archives/${channelId}` : null,
    response,
  };
}

/**
 * The `create_code_channel` tool, on the Worker's MCP server and the stdio one alike. With
 * `workspaces` (the Worker's, which has D1) it also takes the workspace to make the channel in.
 */
export function registerCodeChannelTool(
  server: McpServer,
  env: CodeChannelEnv,
  workspaces?: CodeChannelWorkspaces,
): void {
  server.registerTool(
    'create_code_channel',
    {
      title: 'Create Slack code channel',
      description:
        'Create a Slack code channel: a new channel where the coding agent starts working on the given prompt',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('The task for the coding agent'),
        is_private: z.boolean().default(true).describe('Create the channel as private'),
        add_preamble: z
          .boolean()
          .default(true)
          .describe(`Prefix the prompt with "${CODE_CHANNEL_PREAMBLE}"`),
        model: z
          .enum(CODE_MODELS)
          .default(DEFAULT_CODE_MODEL)
          .describe('Model for the coding agent'),
        ...(workspaces && {
          workspace: z
            .string()
            .optional()
            .describe(
              'Team ID (T…) of the Slack workspace to create the channel in, from those on Settings; the home workspace when left out. The preamble is only added in the home workspace',
            ),
        }),
      }),
      annotations: { openWorldHint: true },
    },
    async ({ workspace, ...request }) => {
      try {
        const target =
          workspaces && typeof workspace === 'string'
            ? await workspaces(workspace)
            : { env, home: true };
        const result = await launchCodeChannel(target.env, request, target.home);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
