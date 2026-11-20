import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import type {
  Deployment,
  SlackWorkspace,
  SlackWorkspaceInput,
  SlackWorkspaces,
} from '../../shared/api';
import { CODE_CHANNEL_PREAMBLE, CODE_MODELS, DEFAULT_CODE_MODEL } from '../../shared/api';
import styles from './settings.module.css';

const root = getRouteApi('__root__');

export const Route = createFileRoute('/settings')({ component: Settings });

function Settings() {
  const me = root.useLoaderData();
  // The draft tools work once the OAuth client is set and Gmail has been connected with it.
  const gmailOn = me.gmail_enabled && me.gmail_connected_at !== null;
  return (
    <>
      <h1>Settings</h1>
      <p className={styles.lede}>
        pip is Jon's personal bot: a website, an MCP server and a Slack bot on one Cloudflare
        Worker, behind Cloudflare Access.
      </p>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Account</h2>
            <p>Who Cloudflare Access let through.</p>
          </div>
        </div>
        <dl className={styles.facts}>
          <dt>Signed in as</dt>
          <dd>{me.email}</dd>
          <dt>Through</dt>
          <dd>{me.service_token ? 'An Access service token' : 'Cloudflare Access login'}</dd>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Code channels</h2>
            <p>
              Start a Slack code channel on a prompt from the <Link to="/code">Code</Link> page, the{' '}
              <code>create_code_channel</code> MCP tool, or <code>/cc</code> or <code>@pip cc</code>{' '}
              in Slack.
            </p>
          </div>
          <span className={styles.status} data-off={!me.code_channels_enabled || undefined}>
            <span className={styles.dot} data-error={!me.code_channels_enabled || undefined} />
            {me.code_channels_enabled ? 'On' : 'Off'}
          </span>
        </div>
        <dl className={styles.facts}>
          <dt>Session</dt>
          <dd>
            {me.code_channels_enabled ? (
              <span>
                <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code> are set.
              </span>
            ) : (
              <span>
                Set <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code> with{' '}
                <code>wrangler secret put</code>: a Slack browser session's xoxc token and d cookie.
              </span>
            )}
          </dd>
          <dt>Default model</dt>
          <dd>
            {DEFAULT_CODE_MODEL}
            <span className={styles.muted}>of {CODE_MODELS.join(', ')}</span>
          </dd>
          <dt>Preamble</dt>
          <dd>
            <code>{CODE_CHANNEL_PREAMBLE.trim()}</code>
            <span className={styles.muted}>from the Code page and MCP tool, not Slack</span>
          </dd>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Gmail</h2>
            <p>
              Read and write Gmail drafts through the <code>drafts_*</code> MCP tools. pip has no
              tool that sends.
            </p>
          </div>
          <span className={styles.status} data-off={!gmailOn || undefined}>
            <span className={styles.dot} data-error={!gmailOn || undefined} />
            {gmailOn ? 'On' : 'Off'}
          </span>
        </div>
        <dl className={styles.facts}>
          <dt>Client</dt>
          <dd>
            {me.gmail_enabled ? (
              <span>
                <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> are set.
              </span>
            ) : (
              <span>
                Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> with{' '}
                <code>wrangler secret put</code>: a Google OAuth client's ID and secret.
              </span>
            )}
          </dd>
          <dt>Connection</dt>
          <dd>
            {me.gmail_connected_at === null ? (
              <span>Not connected</span>
            ) : (
              <span>
                Connected{' '}
                <time dateTime={me.gmail_connected_at}>
                  {new Date(me.gmail_connected_at).toLocaleString()}
                </time>
              </span>
            )}
            {/* A plain link: the sign-in is the Worker's, not a page of this app. */}
            {me.gmail_enabled && (
              <a className={styles.view} href="/auth/google">
                {me.gmail_connected_at === null ? 'Connect Gmail' : 'Reconnect'}
              </a>
            )}
          </dd>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>MCP</h2>
            <p>
              <code>/mcp/core</code> gives agents such as Claude Code <code>whoami</code>, the
              notes, <code>create_code_channel</code> and the Gmail <code>drafts_*</code> tools.
            </p>
          </div>
          <Link className={styles.view} to="/mcp">
            How to connect
          </Link>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Slack</h2>
            <p>
              Mention <b>@pip</b> or DM it (<code>note …</code>, <code>notes</code>);{' '}
              <code>/pip</code> does the same, <code>/cc</code> or <code>@pip cc …</code> starts a
              code channel and <code>/sitrep</code> asks the channels in your Scheduled sidebar
              section for their status. It only answers its owner, and for <code>@pip cc</code> the
              bots in <code>SLACK_CC_BOT_IDS</code>.
            </p>
          </div>
        </div>
      </section>

      <WorkspacesSection />

      <DeployedSection />
    </>
  );
}

type WorkspaceForm = Required<SlackWorkspaceInput>;

const EMPTY_WORKSPACE: WorkspaceForm = {
  team_id: '',
  label: '',
  workspace: '',
  owner_user_id: '',
  cc_bot_ids: '',
  code_app_id: '',
  bot_token: '',
  signing_secret: '',
  client_token: '',
  d_cookie: '',
};

/** The form's plain fields: the name, its label and what to put in it. */
const WORKSPACE_FIELDS = [
  ['team_id', 'Team ID', 'T…'],
  ['label', 'Label', 'What to call it'],
  ['workspace', 'Host', 'acme, as in acme.slack.com'],
  ['owner_user_id', 'Owner', 'Your member ID there (U…): the one pip answers'],
  ['cc_bot_ids', 'cc bots', 'Bots that may say @pip cc: member or bot IDs, comma-separated'],
  ['code_app_id', 'Code app ID', 'A…, for code channels'],
] as const;

/** The secrets: write-only, so their fields start empty and are never filled from the server. */
const WORKSPACE_SECRETS = [
  ['bot_token', 'Bot token', 'xoxb-…'],
  ['signing_secret', 'Signing secret', "The app's signing secret"],
  ['client_token', 'Client token', 'xoxc-…, for code channels and /sitrep'],
  ['d_cookie', 'd cookie', 'xoxd-…, for code channels and /sitrep'],
] as const;

const SET_SECRETS_KEY = 'openssl rand -base64 32 | pnpm wrangler secret put PIP_SECRETS_KEY';

async function fetchWorkspaces(): Promise<SlackWorkspaces> {
  const res = await fetch('/api/workspaces');
  if (!res.ok) {
    throw new Error(`/api/workspaces ${res.status}`);
  }
  return res.json();
}

/** What a failed request said went wrong: the API's `error`, else the status. */
async function apiError(res: Response): Promise<string> {
  const json: unknown = await res.json().catch(() => null);
  return json !== null && typeof json === 'object' && 'error' in json
    ? String((json as { error: unknown }).error)
    : `HTTP ${res.status}`;
}

/**
 * The Slack workspaces pip answers in: the home one, from the Worker's vars and secrets, and any
 * added here, each with a Slack app made by hand in it. Their secrets go in and never come back.
 */
function WorkspacesSection() {
  const [data, setData] = useState<SlackWorkspaces>();
  const [error, setError] = useState<string>();
  /** The open form, and the workspace it changes; a new one when there is a form and no `editing`. */
  const [form, setForm] = useState<WorkspaceForm>();
  const [editing, setEditing] = useState<SlackWorkspace>();
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  useEffect(() => {
    fetchWorkspaces()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function open(workspace?: SlackWorkspace) {
    setError(undefined);
    setEditing(workspace);
    setForm(
      workspace
        ? { ...EMPTY_WORKSPACE, ...workspace, code_app_id: workspace.code_app_id ?? '' }
        : EMPTY_WORKSPACE,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(editing ? `/api/workspaces/${editing.team_id}` : '/api/workspaces', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(
            [...WORKSPACE_FIELDS, ...WORKSPACE_SECRETS].map(([name]) => [name, form[name]]),
          ),
        ),
      });
      if (!res.ok) {
        throw new Error(await apiError(res));
      }
      setForm(undefined);
      setData(await fetchWorkspaces());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(workspace: SlackWorkspace) {
    if (!window.confirm(`Delete ${workspace.label} and its stored secrets?`)) {
      return;
    }
    setError(undefined);
    try {
      const res = await fetch(`/api/workspaces/${workspace.team_id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(await apiError(res));
      }
      setForm(undefined);
      setData(await fetchWorkspaces());
    } catch (err) {
      fail(err);
    }
  }

  const keyOk = data?.secrets_key === 'ok';
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Workspaces</h2>
          <p>
            The Slack workspaces pip answers in. What you ask in one is done in that one. The home
            workspace is this Worker's vars and secrets; another is a Slack app made by hand in it,
            added here.
          </p>
        </div>
        {keyOk && !form && (
          <button onClick={() => open()} type="button">
            Add a workspace
          </button>
        )}
      </div>
      {data && !keyOk && (
        <p className={styles.notice}>
          {data.secrets_key === 'unset' ? (
            <>
              <code>PIP_SECRETS_KEY</code> is not set, so no workspace can be added or used: it is
              the key their secrets are encrypted under in D1.
            </>
          ) : (
            <>
              <code>PIP_SECRETS_KEY</code> is not base64 of exactly 32 bytes, so no workspace can be
              added or used.
            </>
          )}{' '}
          Set it once with <code>{SET_SECRETS_KEY}</code>
        </p>
      )}
      {data && (
        <ul className={styles.workspaces}>
          <li>
            <span>
              <b>{data.home.workspace}</b>
              <span className={styles.muted}>Home</span>
            </span>
            <span className={styles.muted}>
              <span className={styles.mono}>{data.home.team_id}</span> · code channels{' '}
              {data.home.code_channels_enabled ? 'on' : 'off'}
            </span>
          </li>
          {data.workspaces.map((workspace) => (
            <li key={workspace.team_id}>
              <span>
                <b>{workspace.label}</b>
                <span className={styles.muted}>{workspace.workspace}.slack.com</span>
              </span>
              <span className={styles.muted}>
                <span className={styles.mono}>{workspace.team_id}</span> · owner{' '}
                <span className={styles.mono}>{workspace.owner_user_id}</span> · code channels{' '}
                {workspace.code_channels_enabled ? 'on' : 'off'}
              </span>
              <span className={styles.actions}>
                {keyOk && (
                  <button className={styles.quiet} onClick={() => open(workspace)} type="button">
                    Edit
                  </button>
                )}
                <button className={styles.quiet} onClick={() => remove(workspace)} type="button">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form className={styles.form} onSubmit={submit}>
          {WORKSPACE_FIELDS.map(([name, label, hint]) => (
            <label key={name}>
              {label}
              <input
                autoCapitalize="off"
                autoComplete="off"
                disabled={name === 'team_id' && editing !== undefined}
                onChange={(event) => setForm({ ...form, [name]: event.target.value })}
                placeholder={hint}
                spellCheck={false}
                value={form[name]}
              />
            </label>
          ))}
          {WORKSPACE_SECRETS.map(([name, label, hint]) => {
            const stored =
              editing !== undefined &&
              (name === 'client_token'
                ? editing.client_token_set
                : name === 'd_cookie'
                  ? editing.d_cookie_set
                  : true);
            return (
              <label key={name}>
                {label}
                <input
                  autoComplete="new-password"
                  onChange={(event) => setForm({ ...form, [name]: event.target.value })}
                  placeholder={stored ? 'Stored. Leave blank to keep it' : hint}
                  type="password"
                  value={form[name]}
                />
              </label>
            );
          })}
          <span className={styles.actions}>
            <button disabled={busy} type="submit">
              {busy ? 'Saving…' : editing ? 'Save' : 'Add'}
            </button>
            <button className={styles.quiet} onClick={() => setForm(undefined)} type="button">
              Cancel
            </button>
          </span>
        </form>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

/** The build serving this page: its commit, message, branch, Worker version and when it went up. */
function DeployedSection() {
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch('/api/deployment')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`/api/deployment ${res.status}`);
        }
        setDeployment(await res.json());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Deployed</h2>
          <p>The build of pip serving this page.</p>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {deployment && (
        <dl className={styles.facts}>
          <dt>Commit</dt>
          <dd>
            {deployment.commit === null ? (
              <span className={styles.mono}>local</span>
            ) : (
              <a
                className={styles.mono}
                href={`https://github.com/${deployment.repo}/commit/${deployment.commit}`}
                rel="noreferrer"
                target="_blank"
              >
                {deployment.commit.slice(0, 7)}
              </a>
            )}
            {deployment.dirty && <span className={styles.muted}>with uncommitted changes</span>}
          </dd>
          {deployment.message && (
            <>
              <dt>Message</dt>
              <dd>{deployment.message}</dd>
            </>
          )}
          {deployment.branch && (
            <>
              <dt>Branch</dt>
              <dd className={styles.mono}>{deployment.branch}</dd>
            </>
          )}
          <dt>Built</dt>
          <dd>
            {deployment.built_at === null ? (
              <span className={styles.muted}>not built (vite dev)</span>
            ) : (
              <time dateTime={deployment.built_at}>
                {new Date(deployment.built_at).toLocaleString()}
              </time>
            )}
          </dd>
          <dt>Deployed</dt>
          <dd>
            {deployment.deployed_at === null ? (
              <span className={styles.muted}>local</span>
            ) : (
              <time dateTime={deployment.deployed_at}>
                {new Date(deployment.deployed_at).toLocaleString()}
              </time>
            )}
          </dd>
          <dt>Version</dt>
          <dd>
            <span className={styles.mono}>{deployment.version_id}</span>
            {deployment.version_tag && (
              <span className={styles.muted}>{deployment.version_tag}</span>
            )}
          </dd>
        </dl>
      )}
    </section>
  );
}
