import { SlackApp } from 'slack-edge';
import type { CodeChannelEnv } from '../lib/code-channel';
import { callClientApi, codeChannelsEnabled, launchCodeChannel } from '../lib/code-channel';
import type { SlackCommand } from '../shared/slack-manifest';
import { addNote, listNotes, parseNoteBody } from './notes';

/**
 * Slack signs every request; slack-edge rejects anything unsigned. Only the owner gets answers;
 * everyone else gets nothing. The one exception is `@pip cc`, which the bots named in
 * SLACK_CC_BOT_IDS may also say; `cc` in a DM, with no mention, is the owner's alone.
 *
 * `env` is one workspace's: the Worker's own for the home workspace, or one made from a
 * `slack_workspaces` row (src/worker/workspaces.ts), with `home` false. What a request starts, it
 * starts in the workspace it came from.
 */
export function slack(env: SlackEnv, home = true) {
  const app = new SlackApp({ env, routes: { events: '/slack/events' } });
  return (
    app
      .event('app_mention', async ({ context, payload, retryNum }) => {
        // `@pip cc <prompt>` in a channel pip is in starts a code channel on the prompt, like
        // `/cc`, and answers in the thread. The answer leaves the prompt out: the mention above it
        // has it, and said again by pip it would ping whoever it mentions a second time.
        const prompt = parseCcMention(payload.text, context.botUserId);
        if (prompt !== undefined) {
          // slack-edge already drops pip's own events; said again here so that no allowlist entry
          // can have pip start channels off its own messages.
          if (payload.user === context.botUserId || payload.bot_id === context.botId) {
            return;
          }
          if (!mayMentionCc(env, payload)) {
            console.warn('pip: cc mention from someone not allowed', {
              user: payload.user,
              bot_id: payload.bot_id,
            });
            return;
          }
          // Slack sends an event again when the first delivery wasn't answered in time. Starting a
          // channel can't be undone, so a redelivery never starts one: at most one per mention.
          if (retryNum) {
            return;
          }
          await context.say({
            text: await answerCc(env, prompt, ccUsage('@pip cc', home), home),
            thread_ts: payload.thread_ts ?? payload.ts,
          });
          return;
        }
        if (payload.user !== env.SLACK_OWNER_USER_ID) {
          return;
        }
        await context.say({ text: `:wave: <@${payload.user}>`, thread_ts: payload.ts });
      })
      // A DM: for the owner, `cc <prompt>` starts a code channel like `@pip cc` without the mention,
      // `note <text>` keeps a note, `notes` lists the last five, anything else is echoed. Anyone
      // else only gets the echo.
      .anyMessage(async ({ context, payload, retryNum }) => {
        if (payload.channel_type !== 'im' || payload.subtype) {
          return;
        }
        const text = payload.text ?? '';
        const owner = payload.user === env.SLACK_OWNER_USER_ID;
        if (!owner) {
          console.warn('pip: DM from a non-owner', payload.user);
        }
        const prompt = owner ? parseCc(text) : undefined;
        // As for a mention: an event Slack sends again never starts a second channel.
        if (prompt !== undefined && retryNum) {
          return;
        }
        try {
          let answer: string;
          if (prompt !== undefined) {
            answer = await answerCc(env, prompt, ccUsage('cc', home), home);
          } else {
            answer = owner ? await reply(text, `slack:${payload.user}`) : echo(text);
          }
          await context.say({ text: answer });
        } catch (error) {
          // chat.postMessage failed (bad SLACK_BOT_TOKEN, missing chat:write, ...). Log which
          // workspace the token belongs to against the one that sent the event.
          const whoami = await context.client.auth
            .test()
            .catch((e: unknown) => ({ error: String(e) }));
          console.error('pip: reply failed', error, {
            event: { team: payload.team, channel: payload.channel, user: payload.user },
            token: whoami,
          });
          throw error;
        }
      })
      // `/pip <text>`, the same as a DM, answered only to you.
      .command(command('/pip'), async ({ payload }) => {
        if (payload.user_id !== env.SLACK_OWNER_USER_ID) {
          return;
        }
        return {
          response_type: 'ephemeral',
          text: await reply(payload.text, `slack:${payload.user_id}`),
        };
      })
      // `/cc <prompt>` starts a Slack code channel on the prompt. Slack wants an answer within three
      // seconds and creating the channel can take longer, so ack first and post the result after.
      .command(
        command('/cc'),
        async ({ payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID) {
            return;
          }
          if (payload.text.trim() === '') {
            return { response_type: 'ephemeral', text: ccUsage('/cc', home) };
          }
          if (!codeChannelsEnabled(env)) {
            return { response_type: 'ephemeral', text: ccOff(home) };
          }
          return { response_type: 'ephemeral', text: ':hourglass: Starting a code channel…' };
        },
        async ({ context, payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID || payload.text.trim() === '') {
            return;
          }
          if (!codeChannelsEnabled(env)) {
            return;
          }
          await context.respond({
            response_type: 'ephemeral',
            text: await launchFromSlack(env, payload.text, {
              usage: ccUsage('/cc', home),
              hints: home,
            }),
          });
        },
      )
      // `/sitrep` asks every channel in the owner's "Scheduled" sidebar section for its status, as
      // the owner. Ack first and post the result after, like `/cc`.
      .command(
        command('/sitrep'),
        async ({ payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID) {
            return;
          }
          if (!codeChannelsEnabled(env)) {
            return {
              response_type: 'ephemeral',
              text: home
                ? 'Sitrep is off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set.'
                : `Sitrep is not set up for this workspace. ${SET_UP_HERE}`,
            };
          }
          return { response_type: 'ephemeral', text: ':hourglass: Asking the Scheduled channels…' };
        },
        async ({ context, payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID || !codeChannelsEnabled(env)) {
            return;
          }
          await context.respond({ response_type: 'ephemeral', text: await sitrepFromSlack(env) });
        },
      )
  );
}

/**
 * A slash command's name. It has to be one the app's manifest declares (SLACK_COMMANDS), so the
 * manifest Settings hands out can't fall behind the commands answered here.
 */
const command = (name: SlackCommand) => name;

/** One workspace's Slack app and what it may do, under the env's names. */
export interface SlackEnv extends CodeChannelEnv {
  readonly SLACK_SIGNING_SECRET: string;
  readonly SLACK_BOT_TOKEN: string;
  readonly SLACK_OWNER_USER_ID: string;
  readonly SLACK_CC_BOT_IDS?: string | undefined;
}

/**
 * First words of a `/cc` prompt that stand for a repo, or a place in one, and the hint each puts
 * before the rest of the prompt. They name the home workspace's repos, so they are read there only.
 */
const CC_HINTS: Record<string, string> = {
  web: 'In the ponhq/pynhq.com repo: ',
  pyn: 'In the ponhq/pyn repo: ',
  noj: 'In the ponhq/pyn repo, noj (src/entry/noj): ',
  siroj: 'In the ponhq/pynhq.com repo, siroj: ',
};
const CC_HINT_WORDS = Object.keys(CC_HINTS);
const CC_HINT_WORD = new RegExp(`^(${CC_HINT_WORDS.join('|')})\\s+(?=\\S)`, 'i');

const ccUsage = (say: string, hints = true) =>
  `Say \`${say} <prompt>\` to start a code channel on the prompt. Begin with \`public:\` for a public channel.${hints ? ` A first word of ${CC_HINT_WORDS.map((word) => `\`${word}\``).join(', ')} says which repo.` : ''}`;
export const CC_USAGE = ccUsage('/cc');
export const CC_MENTION_USAGE = ccUsage('@pip cc');
export const CC_DM_USAGE = ccUsage('cc');
const CC_OFF = 'Code channels are off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set.';
/** What a workspace from Settings is missing when code channels and `/sitrep` are off in it. */
const SET_UP_HERE =
  "Add its browser session (client token and d cookie) and code app ID on pip's Settings page.";
const ccOff = (home: boolean) =>
  home ? CC_OFF : `Code channels are not set up for this workspace. ${SET_UP_HERE}`;

/**
 * The prompt in `@pip cc <prompt>`: the mention of pip first, then `cc <prompt>` as parseCc reads
 * it. Undefined when the message isn't that.
 */
export function parseCcMention(text: string, botUserId: string | undefined): string | undefined {
  const match = /^\s*<@([A-Z0-9]+)(?:\|[^>]*)?>([\s\S]*)$/i.exec(text);
  if (!match || botUserId === undefined || match[1] !== botUserId) {
    return undefined;
  }
  return parseCc(match[2] ?? '');
}

/**
 * The prompt in `cc <prompt>`: `cc` first, in either case, then the rest, newlines kept; empty when
 * nothing follows `cc`. Undefined when the message isn't that (`ccc`, or `cc` further in).
 */
export function parseCc(text: string): string | undefined {
  const match = /^\s*cc(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) {
    return undefined;
  }
  // An event's text has links as `<url>` or `<url|label>`, and `&`, `<` and `>` escaped.
  return (match[1] ?? '')
    .replace(/<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/g, '$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim();
}

/**
 * What pip says back to `@pip cc <prompt>` or a DM's `cc <prompt>`, having started the code channel:
 * a link to it or what went wrong, without the prompt again. `usage` when there is no prompt.
 */
async function answerCc(
  env: Parameters<typeof launchCodeChannel>[0],
  prompt: string,
  usage: string,
  home: boolean,
): Promise<string> {
  if (prompt === '') {
    return usage;
  }
  if (!codeChannelsEnabled(env)) {
    return ccOff(home);
  }
  return launchFromSlack(env, prompt, { usage, echo: false, hints: home });
}

/**
 * Who may say `@pip cc`: the owner, or a bot named in SLACK_CC_BOT_IDS (comma-separated member IDs
 * or bot IDs). A bot's message has a `bot_id`, and a `user` too unless it's from a classic app.
 * With the list empty no bot may.
 */
export function mayMentionCc(
  env: { readonly SLACK_OWNER_USER_ID: string; readonly SLACK_CC_BOT_IDS?: string | undefined },
  sender: { readonly user?: string | undefined; readonly bot_id?: string | undefined },
): boolean {
  if (sender.user && sender.user === env.SLACK_OWNER_USER_ID) {
    return true;
  }
  if (!sender.bot_id) {
    return false;
  }
  const allowed = (env.SLACK_CC_BOT_IDS ?? '').split(',').map((id) => id.trim());
  return [sender.bot_id, sender.user].some((id) => id && allowed.includes(id));
}

/**
 * A `/cc` prompt with its first word, when that is one of CC_HINTS (in either case) and more
 * follows, swapped for the hint. Any other prompt as it is: `website …`, or `web` alone.
 */
export function withCcHint(prompt: string): string {
  const match = CC_HINT_WORD.exec(prompt);
  const hint = CC_HINTS[match?.[1]?.toLowerCase() ?? ''];
  return match && hint ? hint + prompt.slice(match[0].length) : prompt;
}

/**
 * `/cc` text: an optional `public:` prefix, then the prompt, sent as it is with no preamble, bar a
 * first word in CC_HINTS (see withCcHint). A `raw:` prefix, which used to skip the preamble, is
 * still taken off and does nothing. Replies with a link to the channel, or what went wrong; with
 * `usage` when there is no prompt. `echo` says whether the reply repeats the prompt; `hints`
 * whether CC_HINTS are read, which they are in the home workspace only.
 */
export async function launchFromSlack(
  env: Parameters<typeof launchCodeChannel>[0],
  text: string,
  {
    usage = CC_USAGE,
    echo = true,
    hints = true,
  }: { usage?: string; echo?: boolean; hints?: boolean } = {},
): Promise<string> {
  let prompt = text.trim();
  let isPrivate = true;
  for (;;) {
    const match = /^(public|raw):\s*/i.exec(prompt);
    if (!match) {
      break;
    }
    if (match[1]?.toLowerCase() === 'public') {
      isPrivate = false;
    }
    prompt = prompt.slice(match[0].length);
  }
  if (prompt === '') {
    return usage;
  }
  try {
    const result = await launchCodeChannel(env, {
      prompt: hints ? withCcHint(prompt) : prompt,
      is_private: isPrivate,
      add_preamble: false,
    });
    const where = result.channel_id ? `<#${result.channel_id}>` : 'a code channel';
    return `:rocket: Started ${where} (${result.model})${echo ? `: ${result.prompt}` : '.'}`;
  } catch (error) {
    return `:x: Couldn't start the code channel: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The sidebar section `/sitrep` posts to, and what it posts. */
export const SITREP_SECTION = 'Scheduled';
export const SITREP_PROMPT =
  'give me the current status - things in flight, blockers, things that need action. Be concise, use bullets';

/** A sidebar section in `users.channelSections.list` (undocumented), as far as `/sitrep` reads it. */
interface SidebarSection {
  readonly name?: unknown;
  readonly channel_ids?: unknown;
  readonly channel_ids_page?: { readonly channel_ids?: unknown; readonly count?: unknown };
}

/**
 * `/sitrep`: posts SITREP_PROMPT as the owner to every channel in the sidebar section named
 * SITREP_SECTION. Replies with the channels pinged, or what went wrong.
 */
export async function sitrepFromSlack(env: Parameters<typeof callClientApi>[0]): Promise<string> {
  let sections: (SidebarSection | undefined)[];
  try {
    const response = await callClientApi(env, 'users.channelSections.list', {});
    sections = Array.isArray(response.channel_sections) ? response.channel_sections : [];
  } catch (error) {
    return `:x: Couldn't read the sidebar sections: ${error instanceof Error ? error.message : String(error)}`;
  }
  const names = sections.map((s) => (typeof s?.name === 'string' ? s.name.trim() : ''));
  const index = names.findIndex((name) => name.toLowerCase() === SITREP_SECTION.toLowerCase());
  const section = sections[index];
  if (!section) {
    const found = names.filter(Boolean).join(', ') || 'none';
    return `:x: No sidebar section named "${SITREP_SECTION}". Sections found: ${found}.`;
  }
  // The IDs are in `channel_ids_page`; a plain `channel_ids` on the section is the fallback.
  const page = section.channel_ids_page;
  const ids = page?.channel_ids ?? section.channel_ids;
  const channels: string[] = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  if (channels.length === 0) {
    return `:x: The "${SITREP_SECTION}" sidebar section has no channels.`;
  }
  const results = await Promise.allSettled(
    channels.map((channel) =>
      callClientApi(env, 'chat.postMessage', { channel, text: SITREP_PROMPT }),
    ),
  );
  const pinged: string[] = [];
  const failed: string[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      pinged.push(`<#${channels[i]}>`);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failed.push(`:x: <#${channels[i]}>: ${reason}`);
    }
  }
  const lines = pinged.length > 0 ? [`:mega: Pinged ${pinged.join(', ')}.`] : [];
  lines.push(...failed);
  const count = page?.count;
  if (typeof count === 'number' && count > channels.length) {
    // `count` looks to be the section's size. Slack can list fewer, and how to ask for the rest
    // isn't known; the page's `cursor` is set on a complete list too, so it says nothing.
    lines.push(
      `:warning: Slack listed only ${channels.length} of ${count} channels in the section.`,
    );
  }
  return lines.join('\n');
}

export const USAGE =
  'Say `note <text>` to keep a note, `notes` to list the latest, or anything else.';

/** What the bot says back to a DM or `/pip`. */
export async function reply(text: string, from: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'help') {
    return USAGE;
  }
  if (trimmed === 'notes') {
    const notes = await listNotes(5);
    if (notes.length === 0) {
      return 'No notes yet.';
    }
    return notes.map((note) => `• #${note.id} ${note.body}`).join('\n');
  }
  const noteMatch = /^note\s+([\s\S]+)$/i.exec(trimmed);
  if (noteMatch) {
    const body = parseNoteBody(noteMatch[1]);
    if (body === undefined) {
      return 'That note is empty or too long.';
    }
    const note = await addNote(body, from);
    return `Noted #${note.id}.`;
  }
  return echo(trimmed);
}

export function echo(text: string): string {
  return `You said: ${text.trim()}`;
}
