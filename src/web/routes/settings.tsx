import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { Deployment, SlackWorkspace, SlackWorkspaces } from '../../shared/api';
import { CODE_CHANNEL_PREAMBLE, CODE_MODELS, DEFAULT_CODE_MODEL } from '../../shared/api';
import { SET_SECRETS_KEY } from '../../shared/workspace-fields';
import { apiError } from '../api-error';
import { WorkspaceForm } from '../workspace-form';
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

async function fetchWorkspaces(): Promise<SlackWorkspaces> {
  const res = await fetch('/api/workspaces');
  if (!res.ok) {
    throw new Error(`/api/workspaces ${res.status}`);
  }
  return res.json();
}

/**
 * The Slack workspaces pip answers in: the home one, from the Worker's vars and secrets, and any
 * set up on the Set up a workspace page (workspaces.new.tsx), each with a Slack app made by hand in
 * it. One is changed or deleted here. Their secrets go in and never come back.
 */
function WorkspacesSection() {
  const [data, setData] = useState<SlackWorkspaces>();
  const [error, setError] = useState<string>();
  /** The workspace whose form is open. */
  const [editing, setEditing] = useState<SlackWorkspace>();

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  useEffect(() => {
    fetchWorkspaces()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  /** After a change is saved: the form closes and the list is read again. */
  async function saved() {
    setEditing(undefined);
    setError(undefined);
    try {
      setData(await fetchWorkspaces());
    } catch (err) {
      fail(err);
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
      setEditing(undefined);
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
            set up step by step on its own page.
          </p>
        </div>
        <Link className={styles.view} to="/workspaces/new">
          Set up a workspace
        </Link>
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
                  <button
                    className={styles.quiet}
                    onClick={() => {
                      setError(undefined);
                      setEditing(workspace);
                    }}
                    type="button"
                  >
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
      {editing && (
        <div className={styles.edit}>
          <WorkspaceForm
            editing={editing}
            // A form of its own for each workspace, so one's values are never left in another's.
            key={editing.team_id}
            onCancel={() => setEditing(undefined)}
            onSaved={saved}
          />
        </div>
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
