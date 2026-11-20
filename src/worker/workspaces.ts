// Slack workspaces besides the home one. The home workspace is the Worker's vars and secrets, as it
// always was. Any other is a row in `slack_workspaces`, added on Settings: a Slack app made by hand
// in that workspace, with its secrets encrypted under PIP_SECRETS_KEY (src/lib/secrets.ts).

import { env } from 'cloudflare:workers';
import { verifySlackRequest } from 'slack-edge';
import type { CodeChannelWorkspaces } from '../lib/code-channel';
import { codeChannelsEnabled } from '../lib/code-channel';
import { decryptSecret, encryptSecret, importSecretsKey } from '../lib/secrets';
import type { SlackWorkspace, SlackWorkspaces } from '../shared/api';
import type { SlackEnv } from './slack';

/** The encrypted columns. */
const SECRETS = ['bot_token', 'signing_secret', 'client_token', 'd_cookie'] as const;
type Secret = (typeof SECRETS)[number];

/** A row as stored: the four secrets are ciphertext. */
interface Row {
  readonly team_id: string;
  readonly label: string;
  readonly workspace: string;
  readonly owner_user_id: string;
  readonly cc_bot_ids: string;
  readonly code_app_id: string | null;
  readonly bot_token: string;
  readonly signing_secret: string;
  readonly client_token: string | null;
  readonly d_cookie: string | null;
}

/** Why a request about a workspace was turned down, with the HTTP status that says so. */
export class WorkspaceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

const TEAM_ID = /^T[A-Z0-9]{8,}$/;
const USER_ID = /^[UW][A-Z0-9]{8,}$/;
const BOT_ID = /^[UWB][A-Z0-9]{8,}$/;
const APP_ID = /^A[A-Z0-9]{8,}$/;
/** A host's subdomain: it goes into `https://<workspace>.slack.com`, so nothing else gets in. */
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const LABEL_MAX_LENGTH = 80;
const SECRET_MAX_LENGTH = 4000;
/** What each secret starts with, where Slack gives it a prefix. */
const SECRET_PREFIX: Partial<Record<Secret, string>> = {
  bot_token: 'xoxb-',
  client_token: 'xoxc-',
  d_cookie: 'xoxd-',
};

/** What a secret is encrypted for: its row and column, so it can't be read from another. */
const context = (teamId: string, column: Secret) => `${teamId}:${column}`;

/** PIP_SECRETS_KEY as a key: undefined when it isn't set. Throws when it is set and isn't a key. */
async function secretsKey(): Promise<CryptoKey | undefined> {
  return env.PIP_SECRETS_KEY ? importSecretsKey(env.PIP_SECRETS_KEY) : undefined;
}

/**
 * A row's secrets read back, as the env the Slack app takes. Null when any of them doesn't
 * decrypt (or there is no key to try with): the workspace is then not used at all. Logs the team
 * and the column, never a value.
 */
async function open(row: Row): Promise<SlackEnv | null> {
  const key = await secretsKey().catch(() => undefined);
  if (!key) {
    console.error('pip: PIP_SECRETS_KEY is not set or not a key; workspace unusable', {
      team: row.team_id,
    });
    return null;
  }
  const read = async (column: Secret) => {
    const stored = row[column];
    return stored === null ? undefined : decryptSecret(key, stored, context(row.team_id, column));
  };
  const secrets: Partial<Record<Secret, string>> = {};
  for (const column of SECRETS) {
    try {
      secrets[column] = await read(column);
    } catch {
      console.error('pip: a workspace secret does not decrypt; workspace unusable', {
        team: row.team_id,
        column,
      });
      return null;
    }
  }
  const { bot_token, signing_secret, client_token, d_cookie } = secrets;
  if (!bot_token || !signing_secret) {
    return null;
  }
  return {
    SLACK_SIGNING_SECRET: signing_secret,
    SLACK_BOT_TOKEN: bot_token,
    SLACK_OWNER_USER_ID: row.owner_user_id,
    SLACK_CC_BOT_IDS: row.cc_bot_ids,
    SLACK_WORKSPACE: row.workspace,
    SLACK_TEAM_ID: row.team_id,
    // Code channels and /sitrep take the session and the app ID together. With any of them
    // missing they are off here, rather than falling back to the home workspace's.
    ...(row.code_app_id && client_token && d_cookie
      ? {
          SLACK_CODE_APP_ID: row.code_app_id,
          SLACK_CLIENT_TOKEN: client_token,
          SLACK_D_COOKIE: d_cookie,
        }
      : {}),
  };
}

/**
 * The rows, or the one with a team ID. None when the table can't be read, which is how it is until
 * its migration has been applied: pip then has the home workspace only.
 */
async function rows(teamId?: string): Promise<Row[]> {
  try {
    const { results } = await (teamId === undefined
      ? env.DB.prepare('SELECT * FROM slack_workspaces ORDER BY label, team_id')
      : env.DB.prepare('SELECT * FROM slack_workspaces WHERE team_id = ?').bind(teamId)
    ).all<Row>();
    return results;
  } catch (error) {
    console.warn('pip: slack_workspaces could not be read', error);
    return [];
  }
}

/** The team a request from Slack is about: an event's, a slash command's or an interaction's. */
export function slackTeamId(body: string): string | undefined {
  let teamId: unknown;
  try {
    if (body.startsWith('{')) {
      teamId = (JSON.parse(body) as { team_id?: unknown }).team_id;
    } else {
      const form = new URLSearchParams(body);
      const payload = form.get('payload');
      teamId = payload
        ? (JSON.parse(payload) as { team?: { id?: unknown } }).team?.id
        : form.get('team_id');
    }
  } catch {
    return undefined;
  }
  return typeof teamId === 'string' && teamId !== '' ? teamId : undefined;
}

/**
 * Which workspace's Slack app a request to /slack/events is for, read from the body before
 * anything is acted on: undefined for the home one, a row's env for another, null for a row that
 * can't be used. Nothing is trusted here: the app made from the answer checks the signature with
 * that workspace's signing secret, and the home app's does for any team that has no row.
 *
 * A request that names no team (Slack's `url_verification`, sent when an app's Request URL is set)
 * goes to the home app if its secret signed it, else to the row whose secret did.
 */
export async function slackEnvForRequest(
  headers: Headers,
  body: string,
): Promise<SlackEnv | null | undefined> {
  const teamId = slackTeamId(body);
  // The home workspace never touches D1, so it works as it did whatever state the table is in.
  if (teamId === env.SLACK_TEAM_ID) {
    return undefined;
  }
  if (teamId !== undefined) {
    const [row] = await rows(teamId);
    return row && open(row);
  }
  if (
    !headers.has('x-slack-signature') ||
    (await verifySlackRequest(env.SLACK_SIGNING_SECRET, headers, body))
  ) {
    return undefined;
  }
  for (const row of await rows()) {
    const found = await open(row);
    if (found && (await verifySlackRequest(found.SLACK_SIGNING_SECRET, headers, body))) {
      return found;
    }
  }
  return undefined;
}

/** The env to start a code channel with in a workspace, by team ID: see CodeChannelWorkspaces. */
export const codeChannelWorkspace: CodeChannelWorkspaces = async (teamId) => {
  if (teamId === env.SLACK_TEAM_ID) {
    return { env, home: true };
  }
  const [row] = TEAM_ID.test(teamId) ? await rows(teamId) : [];
  if (!row) {
    throw new WorkspaceError(404, `No workspace ${teamId}: add it on Settings`);
  }
  const found = await open(row);
  if (!found) {
    throw new WorkspaceError(503, `Workspace ${teamId} can't be used: its secrets don't decrypt`);
  }
  if (!codeChannelsEnabled(found)) {
    throw new WorkspaceError(
      503,
      `Code channels are not set up for workspace ${teamId}: add its browser session and code app ID on Settings`,
    );
  }
  return { env: found, home: false };
};

const PUBLIC_COLUMNS = `team_id, label, workspace, owner_user_id, cc_bot_ids, code_app_id,
  client_token IS NOT NULL AS client_token_set, d_cookie IS NOT NULL AS d_cookie_set,
  created_at, updated_at`;

type PublicRow = Omit<
  SlackWorkspace,
  'client_token_set' | 'd_cookie_set' | 'code_channels_enabled'
> & { readonly client_token_set: number; readonly d_cookie_set: number };

/** A row as Settings gets it. The secrets aren't selected, so they can't be in it. */
function toPublic(row: PublicRow): SlackWorkspace {
  const client_token_set = Boolean(row.client_token_set);
  const d_cookie_set = Boolean(row.d_cookie_set);
  return {
    ...row,
    client_token_set,
    d_cookie_set,
    code_channels_enabled: Boolean(row.code_app_id) && client_token_set && d_cookie_set,
  };
}

/** `GET /api/workspaces`. No workspaces when the table isn't there yet. */
export async function listWorkspaces(): Promise<SlackWorkspaces> {
  let workspaces: SlackWorkspace[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM slack_workspaces ORDER BY label, team_id`,
    ).all<PublicRow>();
    workspaces = results.map(toPublic);
  } catch (error) {
    console.warn('pip: slack_workspaces could not be read', error);
  }
  return {
    secrets_key: await secretsKey().then(
      (key) => (key ? 'ok' : 'unset'),
      () => 'invalid' as const,
    ),
    home: {
      team_id: env.SLACK_TEAM_ID,
      workspace: env.SLACK_WORKSPACE,
      code_channels_enabled: codeChannelsEnabled(env),
    },
    workspaces,
  };
}

/** A field of the form's JSON as a trimmed string; '' when it is missing or not a string. */
const field = (json: Record<string, unknown>, name: string) => {
  const value = json[name];
  return typeof value === 'string' ? value.trim() : '';
};

/** The team a bot token belongs to, from Slack's `auth.test`. Throws when Slack turns it down. */
async function botTokenTeam(botToken: string): Promise<string> {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { authorization: `Bearer ${botToken}` },
  });
  const body = res.ok
    ? ((await res.json()) as { ok?: boolean; error?: string; team_id?: string })
    : {};
  if (!body.ok || !body.team_id) {
    throw new WorkspaceError(
      400,
      `Slack did not accept the bot token: ${body.error ?? `HTTP ${res.status}`}`,
    );
  }
  return body.team_id;
}

/**
 * Adds a workspace (`POST /api/workspaces`), or changes the one with `existing` as its team ID
 * (`PUT /api/workspaces/:team_id`), from the form's JSON. A secret left blank on a change keeps
 * what is stored. Throws a WorkspaceError when PIP_SECRETS_KEY isn't usable, something is the
 * wrong shape, or the bot token is not that team's.
 */
export async function saveWorkspace(json: unknown, existing?: string): Promise<SlackWorkspace> {
  const key = await secretsKey().catch((error: Error) => {
    throw new WorkspaceError(503, error.message);
  });
  if (!key) {
    throw new WorkspaceError(503, 'PIP_SECRETS_KEY is not set');
  }
  if (json === null || typeof json !== 'object') {
    throw new WorkspaceError(400, 'The body must be a JSON object');
  }
  const input = json as Record<string, unknown>;
  const teamId = existing ?? field(input, 'team_id');
  const label = field(input, 'label');
  const workspace = field(input, 'workspace');
  const ownerUserId = field(input, 'owner_user_id');
  const ccBotIds = field(input, 'cc_bot_ids')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const codeAppId = field(input, 'code_app_id');
  const bad = (message: string) => new WorkspaceError(400, message);
  if (!TEAM_ID.test(teamId)) {
    throw bad('team_id must be a Slack team ID (T…)');
  }
  if (teamId === env.SLACK_TEAM_ID) {
    throw bad('That is the home workspace, which is set in wrangler.jsonc');
  }
  if (label === '' || label.length > LABEL_MAX_LENGTH) {
    throw bad(`label must be 1 to ${LABEL_MAX_LENGTH} characters`);
  }
  if (!WORKSPACE.test(workspace)) {
    throw bad('workspace must be the subdomain in <workspace>.slack.com');
  }
  if (!USER_ID.test(ownerUserId)) {
    throw bad('owner_user_id must be a Slack member ID (U…)');
  }
  if (!ccBotIds.every((id) => BOT_ID.test(id))) {
    throw bad('cc_bot_ids must be member IDs (U…) or bot IDs (B…), comma-separated');
  }
  if (codeAppId !== '' && !APP_ID.test(codeAppId)) {
    throw bad('code_app_id must be a Slack app ID (A…)');
  }
  const [stored] = await rows(teamId);
  if (existing !== undefined && !stored) {
    throw new WorkspaceError(404, `No workspace ${teamId}`);
  }
  if (existing === undefined && stored) {
    throw new WorkspaceError(409, `Workspace ${teamId} is already here`);
  }

  // The secrets as given; one that is blank stays as stored, which for a new workspace is unset.
  const given: Partial<Record<Secret, string>> = {};
  for (const column of SECRETS) {
    const value = field(input, column);
    if (value === '') {
      continue;
    }
    const prefix = SECRET_PREFIX[column];
    if (value.length > SECRET_MAX_LENGTH || (prefix && !value.startsWith(prefix))) {
      throw bad(`${column} is not one${prefix ? `: it starts with ${prefix}` : ''}`);
    }
    given[column] = value;
  }
  for (const column of ['bot_token', 'signing_secret'] as const) {
    if (!given[column] && !stored) {
      throw bad(`${column} is required`);
    }
  }
  const has = (column: Secret) => Boolean(given[column]) || Boolean(stored?.[column]);
  if (has('client_token') !== has('d_cookie')) {
    throw bad('client_token and d_cookie go together: give both or neither');
  }
  if (given.bot_token) {
    const team = await botTokenTeam(given.bot_token);
    if (team !== teamId) {
      throw bad(`That bot token is for team ${team}, not ${teamId}`);
    }
  }

  const sealed = async (column: Secret) => {
    const value = given[column];
    return value ? encryptSecret(key, value, context(teamId, column)) : null;
  };
  // An insert for a new one and an update for a change, where a secret not given keeps its value.
  const statement = stored
    ? `UPDATE slack_workspaces SET
         label = ?2, workspace = ?3, owner_user_id = ?4, cc_bot_ids = ?5, code_app_id = ?6,
         bot_token = COALESCE(?7, bot_token), signing_secret = COALESCE(?8, signing_secret),
         client_token = COALESCE(?9, client_token), d_cookie = COALESCE(?10, d_cookie),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE team_id = ?1`
    : `INSERT INTO slack_workspaces
         (team_id, label, workspace, owner_user_id, cc_bot_ids, code_app_id,
          bot_token, signing_secret, client_token, d_cookie)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`;
  const row = await env.DB.prepare(`${statement} RETURNING ${PUBLIC_COLUMNS}`)
    .bind(
      teamId,
      label,
      workspace,
      ownerUserId,
      ccBotIds.join(','),
      codeAppId || null,
      await sealed('bot_token'),
      await sealed('signing_secret'),
      await sealed('client_token'),
      await sealed('d_cookie'),
    )
    .first<PublicRow>()
    .catch((error: Error) => {
      // The table comes with a migration; until it has been applied nothing can be kept.
      if (error.message.includes('no such table')) {
        throw new WorkspaceError(
          503,
          'The slack_workspaces table is not there yet: apply the migrations (pnpm run migrate)',
        );
      }
      throw error;
    });
  if (row === null) {
    throw new Error('slack_workspaces: insert returned no row');
  }
  return toPublic(row);
}

/** Whether a workspace was deleted, its stored secrets with it. */
export async function deleteWorkspace(teamId: string): Promise<boolean> {
  const { meta } = await env.DB.prepare('DELETE FROM slack_workspaces WHERE team_id = ?')
    .bind(teamId)
    .run();
  return meta.changes > 0;
}
