import { createFileRoute, Link } from '@tanstack/react-router';
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
        <dt>Code channels</dt>
        <dd>
          Start a Slack code channel on a prompt from the <Link to="/code">Code</Link> page, the{' '}
          <code>create_code_channel</code> MCP tool or <code>/cc</code> in Slack.
        </dd>
        <dt>MCP</dt>
        <dd>
          <code>/mcp/core</code> gives agents such as Claude Code <code>whoami</code>, the notes and{' '}
          <code>create_code_channel</code>. <Link to="/mcp">How to connect</Link>.
        </dd>
        <dt>Slack</dt>
        <dd>
          Mention <b>@pip</b> or DM it; <code>/pip</code> does the same. It only answers its owner.
        </dd>
      </dl>
    </>
  ),
});
