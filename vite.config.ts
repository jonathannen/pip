import { execFileSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** `git <args>`'s output, or undefined when git can't answer (no repository, a detached HEAD's branch). */
function git(...args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' || out === 'HEAD' ? undefined : out;
  } catch {
    return undefined;
  }
}

/**
 * The commit and branch a build is of, for Settings' Deployed (`/api/deployment` in
 * src/worker/index.ts): Workers Builds' own, else the checkout's. `vite dev` defines none, so it
 * reports itself as local.
 */
function buildDefines(): Record<string, string> {
  const commit = process.env.WORKERS_CI_COMMIT_SHA || git('rev-parse', 'HEAD');
  const branch = process.env.WORKERS_CI_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = git('status', '--porcelain') !== undefined;
  return {
    'import.meta.env.PIP_COMMIT': JSON.stringify(commit ?? null),
    'import.meta.env.PIP_BRANCH': JSON.stringify(branch ?? null),
    'import.meta.env.PIP_DIRTY': JSON.stringify(dirty),
    'import.meta.env.PIP_BUILT_AT': JSON.stringify(new Date().toISOString()),
  };
}

export default defineConfig(({ command }) => ({
  define: command === 'build' ? buildDefines() : {},
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: 'src/web/routes',
      generatedRouteTree: 'src/web/routeTree.gen.ts',
    }),
    react(),
    cloudflare(),
  ],
}));
