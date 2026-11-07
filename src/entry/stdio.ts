#!/usr/bin/env node
// The MCP server over stdio for a local client, without the Worker: only the tools that need no D1.
import '../env.ts';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { registerCodeChannelTool } from '../lib/code-channel.ts';

serveStdio(() => {
  const server = new McpServer({ name: 'pip', version: '0.1.0' });
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
  registerCodeChannelTool(server, process.env);
  return server;
});
