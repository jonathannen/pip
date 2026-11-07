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

export {};
