import { env } from 'cloudflare:workers';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { registerCodeChannelTool } from '../../lib/code-channel';
import { NOTE_MAX_LENGTH } from '../../shared/api';
import { addNote, deleteNote, listNotes, parseNoteBody } from '../notes';

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

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

  registerCodeChannelTool(server, env);

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

  return server;
};
