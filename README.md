# pip

Jon's personal bot: a website, an MCP server and a Slack bot on one Cloudflare Worker, modelled on noj.

| Path | What | Auth |
| --- | --- | --- |
| `/`, `/code`, `/mcp`, `/schedules`, `/settings`, `/workspaces/new` | React SPA (`src/web/`): notes, a prompt that launches a code channel, how to connect an MCP client, the scheduled tasks (a list in `src/web/routes/schedules.tsx`), settings with the deployed build, setting pip up in another Slack workspace | Cloudflare Access |
| `/api/*` | JSON API for the SPA (`src/worker/index.ts`) | Cloudflare Access |
| `/mcp/<name>` | MCP servers (`src/worker/mcp/`) | Cloudflare Access (user or service token) |
| `/auth/google` | One-time Google sign-in that connects Gmail for the draft tools (`src/worker/google.ts`) | Cloudflare Access |
| `/slack/events` | Slack Events API (`@pip cc`, `cc` in a DM), slash commands `/pip`, `/cc` and `/sitrep` (`src/worker/slack.ts`) | Slack request signature |

The Worker also verifies the `Cf-Access-Jwt-Assertion` header on `/api` and `/mcp`, and is only reachable on its custom domain (`workers_dev` and `preview_urls` are off).

What it does so far is deliberately small: **notes**, short things kept in D1 from the website, the `notes_*` MCP tools or a Slack DM (`note <text>`, `notes`). **Code channels** (`src/lib/code-channel.ts`) start a Slack code channel on a prompt, from the `/code` page (`POST /api/code-channel`), the `create_code_channel` MCP tool or `/cc` (or `@pip cc`, or `cc` in a DM to pip) in Slack; the options and the result are the same on all three (`src/shared/api.ts`). **Gmail drafts** (`src/lib/gmail.ts`): the `drafts_*` MCP tools list, read, create and update drafts in your Gmail; nothing in pip sends mail. Settings shows the build serving the page (`GET /api/deployment`): the commit, its message, the branch and the build time that `vite.config.ts` defines into the bundle at `vite build` (from Workers Builds' env or the checkout's git; the message is always from git, and for a merged pull request is its title and number), plus the Worker version from `CF_VERSION_METADATA`. The site is an installable PWA (`public/manifest.webmanifest`, the icons next to it, and `public/sw.js`, which only caches the hashed build assets; pages and `/api` always hit the network so Access and data stay fresh). Everything else is the shape to hang things off: Access, D1 with migrations, a daily cron, the MCP handler, the Slack app, tests.

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
3. Secrets: `pnpm wrangler secret put SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (`secrets.required`; a deploy fails without them). Optionally `SLACK_CLIENT_TOKEN` and `SLACK_D_COOKIE` for `create_code_channel`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Gmail drafts, and `PIP_SECRETS_KEY` for a second Slack workspace (all below).
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

Tools on `/mcp/core`: `whoami`, `hello`, `create_code_channel`, `notes_list`, `notes_add`, `notes_delete`, `drafts_list`, `drafts_get`, `drafts_create`, `drafts_update`. Add a server by adding a factory to `handlers` in `src/worker/mcp/index.ts`.

### Slack

Create an app named **pip** with the bot scopes `app_mentions:read`, `chat:write`, `commands`, `im:history`. Subscribe to `app_mention` and `message.im` at `https://pip.jonathannen.com/slack/events`. Put its signing secret and bot token in the secrets above. `SLACK_OWNER_USER_ID` in `vars` is your Slack member ID; the bot ignores everyone else.

`/pip <text>` does the same as a DM, answered only to you: add it under **Slash Commands** → **Create New Command** with Request URL `https://pip.jonathannen.com/slack/events`, then reinstall the app for the `commands` scope.

`/cc <prompt>` starts a code channel on the prompt (private, on the default model), sent as you wrote it with no preamble. Start the text with `public:` for a public channel; `raw:`, which used to skip the preamble, is still accepted and does nothing. A first word of `web`, `pyn`, `noj` or `siroj` (after any prefix, in either case) is swapped for a hint saying where the work is: `In the ponhq/pynhq.com repo: `, `In the ponhq/pyn repo: `, `In the ponhq/pyn repo, noj (src/entry/noj): ` and `In the ponhq/pynhq.com repo, siroj: `, so `/cc web fix the header` sends `In the ponhq/pynhq.com repo: fix the header`. The table is `CC_HINTS` in `src/worker/slack.ts`; `@pip cc` and `cc` in a DM take the same words. Add it as a second slash command with the same Request URL. It acks at once and posts the result (a link to the channel, or the error) when Slack has made it.

`@pip cc <prompt>` does the same from any channel pip is in (invite it with `/invite @pip`), with the same `public:` prefix: the message has to start with the mention, then `cc`. pip answers in the thread with the link or the error (not the prompt again, so nobody it mentions is pinged twice). It needs nothing new in the Slack app, as it comes in on `app_mention`. You can say it, and so can the bots listed in `SLACK_CC_BOT_IDS` in `vars`: their member IDs (`U…`, **Copy member ID** on the bot's profile) or bot IDs (`B…`), comma-separated. The list has the Claude bot (`U0A7BM5DE2H`); with it empty no bot can. A mention pip turns down is logged with its `user` and `bot_id`. A listed bot starts code channels as you, for whoever can get it to post, so list only bots you'd trust with that. pip never acts on its own messages, and an event Slack sends a second time never starts a channel.

`cc <prompt>` in a DM to pip does it with no slash and no mention, with the same `public:` prefix: the message has to start with `cc`, in either case, as a word of its own (`ccsomething` is not it). pip answers in the DM with the link or the error. Only you can say it; the bots in `SLACK_CC_BOT_IDS` can't. It needs nothing new in the Slack app, as it comes in on `message.im`. A message in a channel is not read for it: pip only gets those that mention it. `/pip cc <prompt>` doesn't do it either.

`/sitrep` asks every channel in your sidebar section named "Scheduled" for its status: it posts "give me the current status - things in flight, blockers, things that need action. Be concise, use bullets" to each as you, not as pip. The channels are read from the sidebar when it runs, so moving a channel in or out of the section is all the setup there is. Add it as a third slash command with the same Request URL. It acks at once and then says which channels it pinged and which failed. It uses the same browser session as `create_code_channel`, so it needs `SLACK_CLIENT_TOKEN` / `SLACK_D_COOKIE`.

`create_code_channel` uses Slack's undocumented web-client API with a browser session: `SLACK_CLIENT_TOKEN` is the `xoxc-` token and `SLACK_D_COOKIE` the `d` cookie, both copied from app.slack.com. `SLACK_WORKSPACE`, `SLACK_TEAM_ID` and `SLACK_CODE_APP_ID` in `vars` say where the channel is made.

### Adding a second workspace

pip can answer in more than one Slack workspace. The **home** workspace is the one above, set by the Worker's vars and secrets, and works with nothing below. Any other is a row in D1 (`slack_workspaces`, `src/worker/workspaces.ts`) with its own Slack app made by hand in that workspace. A request is checked with the signing secret of the workspace it came from and done there: that workspace's owner and cc bots are the ones allowed, and its code channels and `/sitrep` use its own browser session. The `/cc` repo words and the code channel preamble name home repos, so they apply at home only.

pip's **Set up a workspace** page (`/workspaces/new`, linked from Settings under **Workspaces**) walks through it: the manifest to copy, the form, and where each of its values comes from (`src/shared/workspace-fields.ts`). The order matters, and is:

1. Once, not per workspace: `openssl rand -base64 32 | pnpm wrangler secret put PIP_SECRETS_KEY`. It is the key the workspaces' secrets are encrypted under in D1 (AES-256-GCM, `src/lib/secrets.ts`): 32 random bytes, base64. Keep it as it is: under another key the stored secrets no longer decrypt and have to be entered again. The `slack_workspaces` migration has to be applied too (`pnpm run migrate`, which `pnpm run deploy` runs). The page says whether the key is set.
2. In the other workspace, [create a Slack app](https://api.slack.com/apps?new_app=1) **from a manifest**, pasting in the one on the page, and install it. It is the app described under Slack above (`slackManifest` in `src/shared/slack-manifest.ts`), with `https://pip.jonathannen.com/slack/events` as the URL for everything.
3. Fill in the page's form: the workspace's team ID (the `T…` in `app.slack.com/client/T…/C…`, the address with the workspace open in a browser), a label, its host and your member ID there, and the app's bot token and signing secret. pip asks Slack whose the bot token is and turns it down if it isn't that team's. The cc bots are optional, and so are the code app ID and a browser session's `xoxc-` token and `d` cookie, which code channels and `/sitrep` there need; without them pip says they aren't set up there. The secrets are write-only: Settings, where a workspace is changed or deleted, shows whether each is set, never what it is, and a field left blank on an edit keeps what is stored.
4. Back in the Slack app, verify the Request URL (Slack asks for it on **App Manifest** and **Event Subscriptions**). Slack's manifest reference says an events Request URL set by a manifest has to be verified by hand afterwards, and it has to wait until now: Slack checks the URL with a request signed by this app, which pip only answers once it has the app's signing secret from step 3. Don't count on `@pip` and DMs arriving before it is verified. Should Slack instead refuse the manifest in step 2 over the URL, take `event_subscriptions` out of what you paste, and put it back on the app's **App Manifest** page after step 3.

The Code page gets a workspace picker once there is more than one, and `create_code_channel` takes a `workspace` (the team ID); both default to the home workspace. Without `PIP_SECRETS_KEY`, or before the migration is applied, pip has the home workspace only.

### Gmail drafts

`drafts_list`, `drafts_get`, `drafts_create` and `drafts_update` read and write the drafts in your Gmail, so an MCP client can write an email for you to look over and send yourself. There is no tool that sends or deletes. `drafts_update` replaces a draft with plain text, so it drops formatting and attachments. The only scope asked for is `https://www.googleapis.com/auth/gmail.compose`, the narrowest one that covers all four calls; Google has no drafts-only scope, so not sending is down to pip having no code that does.

Once:

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project and enable the **Gmail API** (APIs & Services → Library).
2. Under **Google Auth Platform**, fill in Branding, then Audience: **Internal** if the project is in your Google Workspace organisation. Otherwise **External**, and press **Publish app**: left in Testing, Google expires the sign-in after seven days. A personal app needs no verification; you click through an "unverified app" warning when signing in.
3. Under **Clients**, **Create client** → **Web application**, with the authorised redirect URI `https://pip.jonathannen.com/auth/google/callback`. Keep the client ID and secret.
4. `pnpm wrangler secret put GOOGLE_CLIENT_ID` and `pnpm wrangler secret put GOOGLE_CLIENT_SECRET`.
5. Deploy with `pnpm run deploy`, which applies the migration that adds the `google_auth` table (or `pnpm run migrate` if the deploy doesn't run it).
6. On pip's Settings page, press **Connect Gmail** on the Gmail card (it goes to `/auth/google`) and approve; you land back on Settings. The refresh token is kept in D1; press **Reconnect** if Google ever revokes it (the tools say when Gmail isn't connected).

Settings' Gmail card shows whether the two secrets are set and when Gmail was connected (`gmail_enabled` and `gmail_connected_at` on `GET /api/me`). Both secrets are optional: without them the tools and `/auth/google` say Gmail is off. Like the other optional secrets, `pnpm dev` doesn't load them from `.dev.vars`.

### Cron

`triggers.crons` runs `scheduled` in `src/worker/index.ts` once a day (`HEARTBEAT_CRON`). It only logs for now.
# pip

## Skills

`.claude/skills/` holds Claude Code skills, which an agent working in this repo picks up by itself.

- `write-like-jon` (`.claude/skills/write-like-jon/SKILL.md`): how to draft a Hacker News, Lobsters or LinkedIn comment in Jon's voice, each rule with his own comments quoted, and what the reply data says about which comments land. The tables behind it are in `reference.md` next to it.
