// What a Slack workspace besides the home one is added with (`POST /api/workspaces`): the form on
// the Set up a workspace page, and the one Settings changes a workspace with. Each field says where
// its value comes from, as the README does (Adding a second workspace).

import type { SlackWorkspaceInput } from './api.ts';

export interface WorkspaceField {
  readonly name: keyof SlackWorkspaceInput;
  readonly label: string;
  /** What a value looks like, shown in the empty field. */
  readonly placeholder: string;
  /** Where the value comes from and what pip does with it, shown under the field. */
  readonly hint: string;
  /** Whether a workspace can't be added without it. */
  readonly required: boolean;
  /** Write-only: encrypted in D1 and never sent back, so its field always starts empty. */
  readonly secret: boolean;
}

export interface WorkspaceFieldGroup {
  readonly title: string;
  /** What the group's fields have in common, shown under its title. */
  readonly about: string;
  readonly fields: readonly WorkspaceField[];
}

export const WORKSPACE_FIELD_GROUPS: readonly WorkspaceFieldGroup[] = [
  {
    title: 'The workspace',
    about: 'Which workspace it is, and who pip answers there.',
    fields: [
      {
        name: 'team_id',
        label: 'Team ID',
        placeholder: 'T…',
        hint: "The workspace's team ID: with the workspace open in a browser, the address is app.slack.com/client/T…/C…, and it is the part beginning with T. pip asks Slack whose the bot token is and turns it down, naming its team, if it isn't this one.",
        required: true,
        secret: false,
      },
      {
        name: 'label',
        label: 'Label',
        placeholder: 'What to call it',
        hint: "Your name for it, shown on Settings and in the Code page's workspace picker.",
        required: true,
        secret: false,
      },
      {
        name: 'workspace',
        label: 'Host',
        placeholder: 'acme',
        hint: "The subdomain of the workspace's address: acme for acme.slack.com.",
        required: true,
        secret: false,
      },
      {
        name: 'owner_user_id',
        label: 'Owner',
        placeholder: 'U…',
        hint: 'Your member ID in that workspace (Copy member ID on your profile there). pip answers this member and ignores everyone else.',
        required: true,
        secret: false,
      },
      {
        name: 'cc_bot_ids',
        label: 'cc bots',
        placeholder: 'U…, B…',
        hint: "Bots that may also say @pip cc there: their member IDs (Copy member ID on the bot's profile) or bot IDs (B…), comma-separated. A listed bot starts code channels as you, for whoever can get it to post, so list only bots you'd trust with that. Blank: no bot may.",
        required: false,
        secret: false,
      },
    ],
  },
  {
    title: 'Its Slack app',
    about: 'From the pip app made in that workspace. Both are stored encrypted and never shown.',
    fields: [
      {
        name: 'bot_token',
        label: 'Bot token',
        placeholder: 'xoxb-…',
        hint: "The app's bot token, which it has once it is installed: on the app's OAuth & Permissions page in Slack.",
        required: true,
        secret: true,
      },
      {
        name: 'signing_secret',
        label: 'Signing secret',
        placeholder: "The app's signing secret",
        hint: "On the app's Basic Information page in Slack, under App Credentials. pip checks every request from that workspace with it.",
        required: true,
        secret: true,
      },
    ],
  },
  {
    title: 'Code channels and /sitrep',
    about:
      "Optional. Leave all three blank to do without them: pip then says they aren't set up there. The session is a browser's, so with it pip starts code channels and posts /sitrep's asks as you. Its token and cookie are stored encrypted and never shown. They stop working when that browser signs out of the workspace, and are then entered again on Settings.",
    fields: [
      {
        name: 'code_app_id',
        label: 'Code app ID',
        placeholder: 'A…',
        hint: 'The ID of the app code channels are made with in that workspace.',
        required: false,
        secret: false,
      },
      {
        name: 'client_token',
        label: 'Client token',
        placeholder: 'xoxc-…',
        hint: "A browser session's xoxc- token, copied from app.slack.com signed in to that workspace. Each workspace has its own, so take this one's. It goes with the d cookie: give both or neither.",
        required: false,
        secret: true,
      },
      {
        name: 'd_cookie',
        label: 'd cookie',
        placeholder: 'xoxd-…',
        hint: "The same browser session's d cookie, copied from app.slack.com: its value, URL-encoded as the browser keeps it (xoxd-…%2B…) or decoded (xoxd-…+…), either works.",
        required: false,
        secret: true,
      },
    ],
  },
];

/** Every field, in the order the form has them. */
export const WORKSPACE_FIELDS: readonly WorkspaceField[] = WORKSPACE_FIELD_GROUPS.flatMap(
  (group) => group.fields,
);

/** Sets PIP_SECRETS_KEY, the key the workspaces' secrets are encrypted under: once, and kept. */
export const SET_SECRETS_KEY = 'openssl rand -base64 32 | pnpm wrangler secret put PIP_SECRETS_KEY';
