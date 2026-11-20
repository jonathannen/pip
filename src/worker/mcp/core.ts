import { env } from 'cloudflare:workers';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { registerCodeChannelTool } from '../../lib/code-channel';
import {
  accessToken,
  createDraft,
  DRAFTS_LIST_MAX,
  getDraft,
  gmailEnabled,
  listDrafts,
  updateDraft,
} from '../../lib/gmail';
import { NOTE_MAX_LENGTH } from '../../shared/api';
import { getRefreshToken } from '../google';
import { addNote, deleteNote, listNotes, parseNoteBody } from '../notes';
import { codeChannelWorkspace } from '../workspaces';

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

/**
 * Runs a Gmail call with a fresh access token. An error result when Gmail isn't connected, or when
 * Google says no.
 */
async function withGmail(run: (token: string) => Promise<unknown>) {
  const refreshToken = gmailEnabled(env) ? await getRefreshToken() : null;
  if (refreshToken === null) {
    return {
      content: [
        {
          type: 'text' as const,
          text: "Gmail is not connected. Visit /auth/google on pip's host in a browser to connect it (the Worker needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set).",
        },
      ],
      isError: true,
    };
  }
  try {
    return text(await run(await accessToken(env, refreshToken)));
  } catch (error) {
    return {
      content: [
        { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
      ],
      isError: true,
    };
  }
}

/** What `drafts_create` and `drafts_update` write a draft from. */
const draftFields = {
  to: z
    .array(z.string())
    .optional()
    .describe('Recipients, each "ann@example.com" or "Ann <ann@example.com>"'),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string(),
  body: z.string().describe('The message, as plain text'),
};

export const core: McpServerFactory = ({ authInfo }) => {
  const server = new McpServer({ name: 'pip-core', version: '0.1.0' });
  const caller = authInfo?.clientId ?? 'unknown';

  server.registerTool(
    'whoami',
    {
      description: 'Who the caller is authenticated as.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => text(authInfo?.extra ?? null),
  );

  server.registerTool(
    'hello',
    {
      title: 'Hello',
      description: 'Say hello',
      inputSchema: z.object({ name: z.string().default('world') }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] }),
  );

  registerCodeChannelTool(server, env, codeChannelWorkspace);

  server.registerTool(
    'notes_list',
    {
      description:
        "pip's notes, newest first: short things kept by MCP, the website or a Slack DM.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => text(await listNotes(limit)),
  );

  server.registerTool(
    'notes_add',
    {
      description: `Keep a note (trimmed, at most ${NOTE_MAX_LENGTH} characters). Returns it as stored.`,
      inputSchema: z.object({ body: z.string().min(1).max(NOTE_MAX_LENGTH) }),
      annotations: { destructiveHint: false, readOnlyHint: false },
    },
    async ({ body }) => {
      const parsed = parseNoteBody(body);
      if (parsed === undefined) {
        return { content: [{ type: 'text', text: 'The note is empty.' }], isError: true };
      }
      return text(await addNote(parsed, caller));
    },
  );

  server.registerTool(
    'notes_delete',
    {
      description: 'Delete a note by id.',
      inputSchema: z.object({ id: z.number().int() }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      if (!(await deleteNote(id))) {
        return { content: [{ type: 'text', text: `No note #${id}` }], isError: true };
      }
      return text({ deleted: id });
    },
  );

  server.registerTool(
    'drafts_list',
    {
      description:
        'Gmail drafts: the id, recipients, subject and a snippet of each. Read one in full with drafts_get.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(DRAFTS_LIST_MAX).default(DRAFTS_LIST_MAX),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => withGmail((token) => listDrafts(token, limit)),
  );

  server.registerTool(
    'drafts_get',
    {
      description: 'A Gmail draft by id: recipients, subject and the body as plain text.',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => withGmail((token) => getDraft(token, id)),
  );

  server.registerTool(
    'drafts_create',
    {
      description:
        'Write a new plain-text Gmail draft, to be reviewed and sent from Gmail. Nothing is sent. Returns the draft id.',
      inputSchema: z.object(draftFields),
      annotations: { destructiveHint: false, readOnlyHint: false },
    },
    async (fields) => withGmail((token) => createDraft(token, fields)),
  );

  server.registerTool(
    'drafts_update',
    {
      description:
        "Replace a Gmail draft's whole content: give every field, not only what changed. The draft becomes plain text: formatting and attachments are not kept, and a reply may lose its thread. Nothing is sent.",
      inputSchema: z.object({ id: z.string().min(1), ...draftFields }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id, ...fields }) => withGmail((token) => updateDraft(token, id, fields)),
  );

  return server;
};
