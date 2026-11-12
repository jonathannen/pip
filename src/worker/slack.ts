import { SlackApp } from 'slack-edge';
import { callClientApi, codeChannelsEnabled, launchCodeChannel } from '../lib/code-channel';
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
      // `/sitrep` asks every channel in the owner's "Scheduled" sidebar section for its status, as
      // the owner. Ack first and post the result after, like `/cc`.
      .command(
        '/sitrep',
        async ({ payload }) => {
          if (payload.user_id !== env.SLACK_OWNER_USER_ID) {
            return;
          }
          if (!codeChannelsEnabled(env)) {
            return {
              response_type: 'ephemeral',
              text: 'Sitrep is off: SLACK_CLIENT_TOKEN / SLACK_D_COOKIE are not set.',
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

/** The sidebar section `/sitrep` posts to, and what it posts. */
export const SITREP_SECTION = 'Scheduled';
export const SITREP_PROMPT =
  'give me the current status - things in flight, blockers, things that need action. Be concise, use bullets';

/** A sidebar section in `users.channelSections.list` (undocumented), as far as `/sitrep` reads it. */
interface SidebarSection {
  readonly name?: unknown;
  readonly channel_ids?: unknown;
  readonly channel_ids_page?: { readonly channel_ids?: unknown; readonly cursor?: unknown };
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
  if (page?.cursor) {
    // Slack pages a section's channels, and how to ask for the next page isn't known.
    lines.push(':warning: Slack listed only the first page of the section; some may be missing.');
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
