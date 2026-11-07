// Slack's internal web-client API (undocumented). Auth is the browser session:
// an xoxc token in the form body plus the matching `d` (xoxd) cookie.
// Shared by the Worker's MCP server and the stdio entry, so it takes its env.

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

export interface CodeChannelEnv {
  readonly SLACK_CLIENT_TOKEN?: string | undefined;
  readonly SLACK_D_COOKIE?: string | undefined;
  readonly SLACK_WORKSPACE?: string | undefined;
  readonly SLACK_TEAM_ID?: string | undefined;
  readonly SLACK_CODE_APP_ID?: string | undefined;
}

const DEFAULTS = { workspace: 'pynhq', teamId: 'TH0RA7683', codeAppId: 'A08SF47R6P4' };

const PREAMBLE = 'In pynhq/pyn repo ';

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

/** Whether the browser-session secrets are set, so channels can be created. */
export function codeChannelsEnabled(env: CodeChannelEnv): boolean {
  return Boolean(env.SLACK_CLIENT_TOKEN && env.SLACK_D_COOKIE);
}

function requireEnv(env: CodeChannelEnv, name: 'SLACK_CLIENT_TOKEN' | 'SLACK_D_COOKIE'): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set (wrangler secret put ${name}, or .dev.vars locally)`);
  }
  return value;
}

async function callClientApi(env: CodeChannelEnv, method: string, fields: Record<string, string>) {
  const form = new FormData();
  form.set('token', requireEnv(env, 'SLACK_CLIENT_TOKEN'));
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  const workspace = env.SLACK_WORKSPACE || DEFAULTS.workspace;
  const res = await fetch(`https://${workspace}.slack.com/api/${method}`, {
    method: 'POST',
    // Cookie value is sent as copied from the browser (already URL-encoded)
    headers: { cookie: `d=${requireEnv(env, 'SLACK_D_COOKIE')}`, origin: 'https://app.slack.com' },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`);
  }

  const body = (await res.json()) as SlackResponse;
  if (!body.ok) {
    throw new Error(`${method}: ${body.error ?? 'unknown error'}`);
  }
  return body;
}

const MODEL_IDS = {
  'Opus 5.5': 'claude-opus-5-5',
  'Fable 5.1': 'claude-fable-5-1',
} as const;

export type CodeModel = keyof typeof MODEL_IDS;
export const CODE_MODELS = Object.keys(MODEL_IDS) as [CodeModel, ...CodeModel[]];

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
    model: MODEL_IDS[model],
    entrypoint: 'fe_sidebar_context_menu',
  });
}

/** The `create_code_channel` tool, on the Worker's MCP server and the stdio one alike. */
export function registerCodeChannelTool(server: McpServer, env: CodeChannelEnv): void {
  server.registerTool(
    'create_code_channel',
    {
      title: 'Create Slack code channel',
      description:
        'Create a Slack code channel: a new channel where the coding agent starts working on the given prompt',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('The task for the coding agent'),
        is_private: z.boolean().default(true).describe('Create the channel as private'),
        add_preamble: z.boolean().default(true).describe(`Prefix the prompt with "${PREAMBLE}"`),
        model: z.enum(CODE_MODELS).default('Opus 5.5').describe('Model for the coding agent'),
      }),
      annotations: { openWorldHint: true },
    },
    async ({ prompt, is_private, add_preamble, model }) => {
      try {
        const fullPrompt = add_preamble ? PREAMBLE + prompt : prompt;
        const result = await createCodeChannel(env, fullPrompt, is_private, model);
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
