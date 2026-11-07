import { createFileRoute } from '@tanstack/react-router';
import styles from './about.module.css';

export const Route = createFileRoute('/about')({
  component: () => (
    <>
      <h1>About</h1>
      <p className={styles.lede}>
        pip is Jon's personal bot: a website, an MCP server and a Slack bot on one Cloudflare
        Worker, behind Cloudflare Access.
      </p>
      <dl className={styles.features}>
        <dt>Notes</dt>
        <dd>
          Short things to keep, from this page, the <code>notes_*</code> MCP tools or a Slack DM (
          <code>note …</code>, <code>notes</code>).
        </dd>
        <dt>MCP</dt>
        <dd>
          <code>/mcp/core</code> gives agents such as Claude Code <code>whoami</code>, the notes and{' '}
          <code>create_code_channel</code>, which starts a Slack code channel on a prompt.
        </dd>
        <dt>Slack</dt>
        <dd>
          Mention <b>@pip</b> or DM it; <code>/pip</code> does the same. It only answers its owner.
        </dd>
      </dl>
    </>
  ),
});
