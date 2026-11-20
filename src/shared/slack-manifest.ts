// The Slack app pip needs in a workspace, as a manifest to paste into Slack's "create an app from
// a manifest". Settings shows it for the workspace being added (see README, Adding a second
// workspace); the home workspace's app was made by hand to the same shape.

/** The slash commands the Worker answers (src/worker/slack.ts), with what Slack shows for each. */
export const SLACK_COMMANDS = {
  '/pip': { description: 'Keep a note, or list the latest', usage_hint: 'note <text> | notes' },
  '/cc': { description: 'Start a code channel on a prompt', usage_hint: '[public:] <prompt>' },
  '/sitrep': {
    description: 'Ask the channels in your Scheduled sidebar section for their status',
    usage_hint: '',
  },
} as const;

export type SlackCommand = keyof typeof SLACK_COMMANDS;

/** What the bot token may do: read mentions and DMs, post, and take slash commands. */
export const SLACK_BOT_SCOPES = ['app_mentions:read', 'chat:write', 'commands', 'im:history'];

/** The events the Worker listens for: `@pip …` in a channel, and a DM. */
export const SLACK_BOT_EVENTS = ['app_mention', 'message.im'];

/**
 * The manifest of pip's Slack app for a pip served at `origin` (`https://pip.example.com`).
 * Everything Slack sends goes to the one URL, `/slack/events`. One workspace only: no socket mode,
 * org-wide install, token rotation, OAuth redirect or user scopes.
 */
export function slackManifest(origin: string) {
  const url = `${origin}/slack/events`;
  return {
    display_information: { name: 'pip' },
    features: {
      // The Messages tab, writable, so pip can be sent a DM.
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { display_name: 'pip' },
      slash_commands: Object.entries(SLACK_COMMANDS).map(([command, shown]) => ({
        command,
        url,
        description: shown.description,
        ...(shown.usage_hint && { usage_hint: shown.usage_hint }),
        should_escape: false,
      })),
    },
    oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
    settings: {
      event_subscriptions: { request_url: url, bot_events: SLACK_BOT_EVENTS },
      interactivity: { is_enabled: true, request_url: url },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
