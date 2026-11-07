import { createFileRoute } from '@tanstack/react-router';
import styles from './mcp.module.css';

export const Route = createFileRoute('/mcp')({ component: Mcp });

const ORIGIN =
  typeof window === 'undefined' ? 'https://pip.jonathannen.com' : window.location.origin;
const MCP_URL = `${ORIGIN}/mcp/core`;

const TOOLS: ReadonlyArray<readonly [name: string, what: string]> = [
  ['whoami', 'Who the caller is authenticated as (email or service token name).'],
  ['hello', 'Says hello. A smoke test.'],
  [
    'create_code_channel',
    'Starts a Slack code channel on a prompt, with model and privacy options.',
  ],
  ['notes_list', "pip's notes, newest first."],
  ['notes_add', 'Keeps a note.'],
  ['notes_delete', 'Deletes a note by id.'],
];

/** How to point an MCP client at this Worker. */
function Mcp() {
  return (
    <>
      <h1>MCP</h1>
      <p className={styles.lede}>
        pip serves an MCP server at <code>{MCP_URL}</code> over streamable HTTP, behind Cloudflare
        Access. Sign in with your browser, or use a service token for a headless agent.
      </p>

      <section className={styles.section}>
        <h2>Claude Code</h2>
        <p>Add it with OAuth through Access; a browser window opens to sign in the first time.</p>
        <pre className={styles.code}>{`claude mcp add --transport http pip ${MCP_URL}`}</pre>
        <p>Or with a service token from Zero Trust, for an agent with no browser:</p>
        <pre className={styles.code}>
          {`claude mcp add --transport http pip ${MCP_URL} \\
  --header "CF-Access-Client-Id: $ID" \\
  --header "CF-Access-Client-Secret: $SECRET"`}
        </pre>
      </section>

      <section className={styles.section}>
        <h2>Claude.ai and the desktop app</h2>
        <p>
          Under <b>Settings → Connectors → Add custom connector</b>, enter <code>{MCP_URL}</code>.
          The Access app has Managed OAuth on, so the sign-in is your Cloudflare login.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Any other client</h2>
        <p>
          Send JSON-RPC to the URL above with the <code>Cf-Access-Jwt-Assertion</code> header Access
          gives you, or the <code>CF-Access-Client-Id</code> and{' '}
          <code>CF-Access-Client-Secret</code> headers of a service token. The Worker verifies the
          token itself, so a request that bypasses Access is still refused.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Tools</h2>
        <dl className={styles.tools}>
          {TOOLS.map(([name, what]) => (
            <div className={styles.tool} key={name}>
              <dt>
                <code>{name}</code>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p>
          <code>create_code_channel</code> only works when the Worker has{' '}
          <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code> set; otherwise it says so.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Locally, over stdio</h2>
        <p>
          From a checkout, <code>pnpm mcp:stdio</code> serves <code>hello</code> and{' '}
          <code>create_code_channel</code> without the Worker; the repo's <code>.mcp.json</code>{' '}
          points Claude Code at it. <code>pnpm inspect</code> opens the MCP inspector on it.
        </p>
      </section>
    </>
  );
}
