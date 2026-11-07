import { SlackApp } from 'slack-edge';
import { codeChannelsEnabled, launchCodeChannel } from '../lib/code-channel';
import { addNote, listNotes, parseNoteBody } from './notes';

/**
 * Slack signs every request; slack-edge rejects anything unsigned. Only the owner gets answers;
 * everyone else gets nothing.
 */
export function slack(env: Env) {
  const app = new SlackApp({ env, routes: { events: '/slack/events' } });
  return (
    app
      .event('app_mention', async ({ context, payload }) => {
        if (payload.user !== env.SLACK_OWNER_USER_ID) {
          return;
        }
        await context.say({ text: `:wave: <@${payload.user}>`, thread_ts: payload.ts });
      })
      // A DM: for the owner, `note <text>` keeps a note, `notes` lists the last five, anything else
      // is echoed. Anyone else only gets the echo.
      .anyMessage(async ({ context, payload }) => {
        if (payload.channel_type !== 'im' || payload.subtype) {
          return;
        }
        const text = payload.text ?? '';
        const owner = payload.user === env.SLACK_OWNER_USER_ID;
        if (!owner) {
          console.warn('pip: DM from a non-owner', payload.user);
        }
        try {
          await context.say({
            text: owner ? await reply(text, `slack:${payload.user}`) : echo(text),
          });
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
      .command('/pip', async ({ payload }) => {
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
        '/cc',
        async ({ payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID) {
            return;
          }
          if (payload.text.trim() === '') {
            return { response_type: 'ephemeral', text: CC_USAGE };
          }
          if (!codeChannelsEnabled(env)) {
            return {
              response_type: 'ephemeral',
              text: 'Code channels are off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set.',
            };
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
            text: await launchFromSlack(env, payload.text),
          });
        },
      )
  );
}

export const CC_USAGE =
  'Say `/cc <prompt>` to start a code channel on the prompt. Begin with `public:` for a public channel, or `raw:` to skip the "In pynhq/pyn repo" preamble.';

/**
 * `/cc` text: optional `public:` and `raw:` prefixes, then the prompt. Replies with a link to the
 * channel, or what went wrong.
 */
export async function launchFromSlack(
  env: Parameters<typeof launchCodeChannel>[0],
  text: string,
): Promise<string> {
  let prompt = text.trim();
  let isPrivate = true;
  let addPreamble = true;
  for (;;) {
    const match = /^(public|raw):\s*/i.exec(prompt);
    if (!match) {
      break;
    }
    if (match[1]?.toLowerCase() === 'public') {
      isPrivate = false;
    } else {
      addPreamble = false;
    }
    prompt = prompt.slice(match[0].length);
  }
  if (prompt === '') {
    return CC_USAGE;
  }
  try {
    const result = await launchCodeChannel(env, {
      prompt,
      is_private: isPrivate,
      add_preamble: addPreamble,
    });
    const where = result.channel_id ? `<#${result.channel_id}>` : 'a code channel';
    return `:rocket: Started ${where} (${result.model}): ${result.prompt}`;
  } catch (error) {
    return `:x: Couldn't start the code channel: ${error instanceof Error ? error.message : String(error)}`;
  }
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
