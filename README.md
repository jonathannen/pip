# pip

Jon's personal bot: a website, an MCP server and a Slack bot on one Cloudflare Worker, modelled on noj.

| Path | What | Auth |
| --- | --- | --- |
| `/`, `/code`, `/mcp`, `/about` | React SPA (`src/web/`): notes, a prompt that launches a code channel, how to connect an MCP client | Cloudflare Access |
| `/api/*` | JSON API for the SPA (`src/worker/index.ts`) | Cloudflare Access |
| `/mcp/<name>` | MCP servers (`src/worker/mcp/`) | Cloudflare Access (user or service token) |
| `/slack/events` | Slack Events API, slash commands `/pip` and `/cc` (`src/worker/slack.ts`) | Slack request signature |

The Worker also verifies the `Cf-Access-Jwt-Assertion` header on `/api` and `/mcp`, and is only reachable on its custom domain (`workers_dev` and `preview_urls` are off).

What it does so far is deliberately small: **notes**, short things kept in D1 from the website, the `notes_*` MCP tools or a Slack DM (`note <text>`, `notes`). **Code channels** (`src/lib/code-channel.ts`) start a Slack code channel on a prompt, from the `/code` page (`POST /api/code-channel`), the `create_code_channel` MCP tool or `/cc` in Slack; the options and the result are the same on all three (`src/shared/api.ts`). The site is an installable PWA (`public/manifest.webmanifest`, the icons next to it, and `public/sw.js`, which only caches the hashed build assets; pages and `/api` always hit the network so Access and data stay fresh). Everything else is the shape to hang things off: Access, D1 with migrations, a daily cron, the MCP handler, the Slack app, tests.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in
pnpm wrangler d1 migrations apply pip --local
pnpm dev                         # Access is skipped in dev; you are dev@localhost
pnpm test && pnpm typecheck && pnpm lint
```

After changing `wrangler.jsonc`, run `pnpm types`. Schema changes go in a new file under `migrations/` (`pnpm wrangler d1 migrations create pip <name>`).

Wrangler only loads `secrets.required` names from `.dev.vars`, so in `pnpm dev` the optional `SLACK_CLIENT_TOKEN` / `SLACK_D_COOKIE` aren't set and `create_code_channel` reports it's off. The stdio entry (below) reads all of `.dev.vars`.

### MCP over stdio

`pnpm mcp:stdio` (`src/entry/stdio.ts`) serves `hello` and `create_code_channel` over stdio without the Worker, for a local client; `.mcp.json` points Claude Code at it. `pnpm inspect` opens the MCP inspector on it. The notes tools need D1, so they're only on the Worker.

## Deploy

1. Once: `pnpm wrangler d1 create pip` and put the printed `database_id` in `d1_databases` in `wrangler.jsonc`.
2. Set `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `vars` in `wrangler.jsonc` (Zero Trust, below).
3. Secrets: `pnpm wrangler secret put SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (`secrets.required`; a deploy fails without them). Optionally `SLACK_CLIENT_TOKEN` and `SLACK_D_COOKIE` for `create_code_channel`.
4. `pnpm run deploy` builds, applies pending D1 migrations, then deploys (plain `pnpm deploy` is a pnpm built-in, not this script).

`pnpm run migrate` applies pending D1 migrations to the remote database; `pnpm run release` runs `migrate` then `wrangler deploy` without building. The custom domain `pip.jonathannen.com` is created on first deploy; `jonathannen.com` must be a zone in the account wrangler is logged into.

### Zero Trust

- **Access app** on `pip.jonathannen.com`: Allow policy for your email; Service Auth policy for agent service tokens. Turn on **Managed OAuth** so MCP clients (Claude Code, Claude.ai) can sign in. Copy its AUD tag into `ACCESS_AUD`, and the team domain (`https://<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.
- **Second Access app** on `pip.jonathannen.com/slack` with a **Bypass** policy, so Slack can reach `/slack/events`; the Worker checks Slack's signature instead.

### MCP clients

```sh
# OAuth through Access
claude mcp add --transport http pip https://pip.jonathannen.com/mcp/core
# or a service token (headless agents)
claude mcp add --transport http pip https://pip.jonathannen.com/mcp/core \
  --header "CF-Access-Client-Id: $ID" --header "CF-Access-Client-Secret: $SECRET"
```

Tools on `/mcp/core`: `whoami`, `hello`, `create_code_channel`, `notes_list`, `notes_add`, `notes_delete`. Add a server by adding a factory to `handlers` in `src/worker/mcp/index.ts`.

### Slack

Create an app named **pip** with the bot scopes `app_mentions:read`, `chat:write`, `commands`, `im:history`. Subscribe to `app_mention` and `message.im` at `https://pip.jonathannen.com/slack/events`. Put its signing secret and bot token in the secrets above. `SLACK_OWNER_USER_ID` in `vars` is your Slack member ID; the bot ignores everyone else.

`/pip <text>` does the same as a DM, answered only to you: add it under **Slash Commands** → **Create New Command** with Request URL `https://pip.jonathannen.com/slack/events`, then reinstall the app for the `commands` scope.

`/cc <prompt>` starts a code channel on the prompt (private, with the "In pynhq/pyn repo" preamble, on the default model). Start the text with `public:` for a public channel or `raw:` to skip the preamble. Add it as a second slash command with the same Request URL. It acks at once and posts the result (a link to the channel, or the error) when Slack has made it.

`create_code_channel` uses Slack's undocumented web-client API with a browser session: `SLACK_CLIENT_TOKEN` is the `xoxc-` token and `SLACK_D_COOKIE` the `d` cookie, both copied from app.slack.com. `SLACK_WORKSPACE`, `SLACK_TEAM_ID` and `SLACK_CODE_APP_ID` in `vars` say where the channel is made.

### Cron

`triggers.crons` runs `scheduled` in `src/worker/index.ts` once a day (`HEARTBEAT_CRON`). It only logs for now.
# pip
