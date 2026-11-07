import { SlackApp } from 'slack-edge';
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
      // A DM: `note <text>` keeps a note, `notes` lists the last five, anything else is echoed.
      .anyMessage(async ({ context, payload }) => {
        if (payload.channel_type !== 'im' || payload.subtype) {
          return;
        }
        if (payload.user !== env.SLACK_OWNER_USER_ID) {
          return;
        }
        await context.say({ text: await reply(payload.text ?? '', `slack:${payload.user}`) });
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
  );
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
  return `You said: ${trimmed}`;
}
