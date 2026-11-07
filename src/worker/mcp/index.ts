import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import type { Identity } from '../access';
import { requireAccess } from '../access';
import { core } from './core';

/** Each entry is served at /mcp/<name>. Add a server by adding a factory here. */
const handlers: Record<string, McpHttpHandler> = {
  core: createMcpHandler(core),
};

export const mcp = new Hono<{ Variables: { identity: Identity } }>()
  .use(requireAccess)
  .all('/:name', (c) => {
    const handler = handlers[c.req.param('name')];
    if (!handler) {
      return c.notFound();
    }
    const identity = c.get('identity');
    return handler.fetch(c.req.raw, {
      authInfo: { token: '', clientId: identity.email, scopes: [], extra: { ...identity } },
    });
  });
