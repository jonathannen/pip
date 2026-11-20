import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { SlackWorkspace, SlackWorkspaces } from '../../shared/api';
import {
  SLACK_BOT_EVENTS,
  SLACK_BOT_SCOPES,
  SLACK_COMMANDS,
  slackManifest,
} from '../../shared/slack-manifest';
import { SET_SECRETS_KEY } from '../../shared/workspace-fields';
import { WorkspaceForm } from '../workspace-form';
import styles from './workspaces.new.module.css';

export const Route = createFileRoute('/workspaces/new')({ component: NewWorkspace });

/** Slack's page for making an app, where "from a manifest" is one of the ways offered. */
const CREATE_SLACK_APP = 'https://api.slack.com/apps?new_app=1';

/**
 * Setting pip up in another Slack workspace, start to finish and in the order it has to go: the key
 * the secrets are kept under, the Slack app from pip's manifest, the workspace's row, and then the
 * Request URL, which Slack can only verify once pip has the app's signing secret. The README's
 * "Adding a second workspace" is the short form of this page.
 */
function NewWorkspace() {
  const [secretsKey, setSecretsKey] = useState<SlackWorkspaces['secrets_key']>();
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<SlackWorkspace>();

  useEffect(() => {
    fetch('/api/workspaces')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`/api/workspaces ${res.status}`);
        }
        setSecretsKey(((await res.json()) as SlackWorkspaces).secrets_key);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const origin = window.location.origin;
  const manifest = JSON.stringify(slackManifest(origin), null, 2);
  const keyOk = secretsKey === 'ok';

  return (
    <>
      <h1>Set up a workspace</h1>
      <p className={styles.lede}>
        pip can answer in more than one Slack workspace. The home one is this Worker's vars and
        secrets. Any other gets its own Slack app, made by hand in that workspace, and is added
        here; what you ask there is done there. Four steps, in this order. The workspaces already
        set up are on <Link to="/settings">Settings</Link>.
      </p>

      <ol className={styles.steps}>
        <li className={styles.step}>
          <h2>Before the first one: the secrets key and the migration</h2>
          <p>
            Once for this pip, not once per workspace. <code>PIP_SECRETS_KEY</code> is the key the
            workspaces' secrets are encrypted under in D1 (AES-256-GCM): base64 of 32 random bytes,
            a secret of this Worker.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          {keyOk && (
            <p className={styles.status}>
              <span className={styles.dot} />
              <span>
                <code>PIP_SECRETS_KEY</code> is set. Leave it as it is: under another key the stored
                secrets no longer decrypt and have to be entered again.
              </span>
            </p>
          )}
          {secretsKey !== undefined && !keyOk && (
            <>
              <p className={styles.status}>
                <span className={styles.dot} data-error />
                <span>
                  <code>PIP_SECRETS_KEY</code>{' '}
                  {secretsKey === 'unset' ? 'is not set' : 'is not base64 of exactly 32 bytes'}, so
                  no workspace can be added or used. Set it from a checkout of pip, then keep it:
                  under another key the stored secrets no longer decrypt and have to be entered
                  again.
                </span>
              </p>
              <pre className={styles.code}>{SET_SECRETS_KEY}</pre>
              <Copy text={SET_SECRETS_KEY} />
            </>
          )}
          <p>
            The workspaces are kept in the <code>slack_workspaces</code> table, which comes with a
            D1 migration. <code>pnpm run deploy</code> applies it, or run{' '}
            <code>pnpm run migrate</code> if the deploy doesn't. If the table isn't there yet, step
            3 says so when you save.
          </p>
        </li>

        <li className={styles.step}>
          <h2>Create the Slack app from pip's manifest</h2>
          <p>
            In the other workspace,{' '}
            <a href={CREATE_SLACK_APP} rel="noreferrer" target="_blank">
              create an app
            </a>{' '}
            <b>from a manifest</b> and paste this in. Then install the app to that workspace.
          </p>
          <textarea aria-label="Slack app manifest" readOnly rows={12} value={manifest} />
          <Copy text={manifest} />
          <p>
            It is the same for every workspace and has no secret in it: a bot user named pip, the
            bot scopes {codes(SLACK_BOT_SCOPES)}, the events {codes(SLACK_BOT_EVENTS)}, the slash
            commands {codes(Object.keys(SLACK_COMMANDS))}, and <code>{origin}/slack/events</code> as
            the URL for all of them.
          </p>
          <p>
            Slack can't verify that URL yet (that is step 4). Should it refuse the manifest over it,
            take <code>event_subscriptions</code> out of what you paste, and put it back on the
            app's <b>App Manifest</b> page after step 3.
          </p>
        </li>

        <li className={styles.step}>
          <h2>Add the workspace to pip</h2>
          {added ? (
            <p className={styles.status}>
              <span className={styles.dot} />
              <span>
                <b>{added.label}</b> (<code>{added.team_id}</code>) is added, and is on{' '}
                <Link to="/settings">Settings</Link> to change or delete. One step left.
              </span>
            </p>
          ) : (
            <>
              <p>
                Each field says where its value comes from. The secrets are write-only: Settings
                shows whether each is set, never what it is.
              </p>
              {secretsKey !== undefined && !keyOk && (
                <p className={styles.status}>
                  <span className={styles.dot} data-error />
                  <span>
                    Nothing can be saved until <code>PIP_SECRETS_KEY</code> is set (step 1).
                  </span>
                </p>
              )}
              <WorkspaceForm disabled={!keyOk} onSaved={setAdded} />
            </>
          )}
        </li>

        <li className={styles.step}>
          <h2>Verify the Request URL in Slack</h2>
          <p>
            Back in the Slack app, verify the Request URL: Slack asks for it on <b>App Manifest</b>{' '}
            and <b>Event Subscriptions</b>. An events Request URL set by a manifest has to be
            verified by hand, and it has to wait until now: Slack checks the URL with a request
            signed by this app, which pip can only answer once it has the app's signing secret from
            step 3.
          </p>
          <p>
            Don't count on <code>@pip</code> and DMs arriving before it is verified. Once it is, DM
            pip <code>notes</code> from the owner's account, or <code>/invite @pip</code> to a
            channel and mention it there.
          </p>
        </li>
      </ol>
    </>
  );
}

/** Names as code, with commas between them. */
function codes(names: readonly string[]) {
  return names.map((name, index) => (
    <span key={name}>
      {index > 0 && ', '}
      <code>{name}</code>
    </span>
  ));
}

/** A button that copies `text`, and says so once it has. */
function Copy({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={styles.quiet}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
      type="button"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
