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
 * A commit's message as Settings shows it: its subject. A GitHub merge commit's subject is "Merge
 * pull request #4 from owner/branch" and its body starts with the pull request's title, so for one
 * it's the title and the number. Undefined when git can't answer.
 */
function commitMessage(commit: string): string | undefined {
  const [subject, ...body] = (git('log', '-1', '--format=%s%n%b', commit) ?? '').split('\n');
  const title = body.find((line) => line.trim() !== '')?.trim();
  const merged = /^Merge pull request (#\d+) from /.exec(subject ?? '');
  return merged && title ? `${title} (${merged[1]})` : subject || undefined;
}

/**
 * The commit and branch a build is of, for Settings' Deployed (`/api/deployment` in
 * src/worker/index.ts): Workers Builds' own, else the checkout's. Workers Builds has no variable
 * for the commit's message, so that is always read from the checkout. `vite dev` defines none, so
 * it reports itself as local.
 */
function buildDefines(): Record<string, string> {
  const commit = process.env.WORKERS_CI_COMMIT_SHA || git('rev-parse', 'HEAD');
  const message = commit && commitMessage(commit);
  const branch = process.env.WORKERS_CI_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = git('status', '--porcelain') !== undefined;
  return {
    'import.meta.env.PIP_COMMIT': JSON.stringify(commit ?? null),
    'import.meta.env.PIP_MESSAGE': JSON.stringify(message || null),
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
