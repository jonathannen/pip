import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { Deployment } from '../../shared/api';
import { CODE_CHANNEL_PREAMBLE, CODE_MODELS, DEFAULT_CODE_MODEL } from '../../shared/api';
import styles from './settings.module.css';

const root = getRouteApi('__root__');

export const Route = createFileRoute('/settings')({ component: Settings });

function Settings() {
  const me = root.useLoaderData();
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
              <code>create_code_channel</code> MCP tool or <code>/cc</code> in Slack.
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
              <>
                <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code> are set.
              </>
            ) : (
              <>
                Set <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code> with{' '}
                <code>wrangler secret put</code>: a Slack browser session's xoxc token and d cookie.
              </>
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
            <span className={styles.muted}>unless the prompt is sent raw</span>
          </dd>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>MCP</h2>
            <p>
              <code>/mcp/core</code> gives agents such as Claude Code <code>whoami</code>, the notes
              and <code>create_code_channel</code>.
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
              <code>/pip</code> does the same and <code>/cc</code> starts a code channel. It only
              answers its owner.
            </p>
          </div>
        </div>
      </section>

      <DeployedSection />
    </>
  );
}

/** The build of pip serving this page: its commit, branch, Worker version and when it went up. */
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
