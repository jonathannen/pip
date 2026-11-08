// Optional secrets, which `wrangler types` leaves out of Env as they aren't in `secrets.required`.
declare global {
  namespace Cloudflare {
    interface Env {
      /** A Slack browser session's xoxc token, for create_code_channel (src/lib/code-channel.ts). */
      SLACK_CLIENT_TOKEN?: string;
      /** The matching `d` cookie. */
      SLACK_D_COOKIE?: string;
    }
  }
}

/** What vite.config.ts builds in for Settings' Deployed; absent under `vite dev` and in tests. */
// biome-ignore lint/correctness/noUnusedVariables: merges into Vite's ImportMetaEnv
interface ImportMetaEnv {
  /** The commit pip was built from. */
  readonly PIP_COMMIT?: string | null;
  /** The branch pip was built from. */
  readonly PIP_BRANCH?: string | null;
  /** Whether the checkout had uncommitted changes. */
  readonly PIP_DIRTY?: boolean;
  /** When the build ran, ISO 8601. */
  readonly PIP_BUILT_AT?: string | null;
}

export {};
