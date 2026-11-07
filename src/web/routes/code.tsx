import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { useState } from 'react';
import type { CodeChannelResult, CodeModel } from '../../shared/api';
import { CODE_CHANNEL_PREAMBLE, CODE_MODELS, DEFAULT_CODE_MODEL } from '../../shared/api';
import styles from './code.module.css';

const root = getRouteApi('__root__');

export const Route = createFileRoute('/code')({ component: Code });

/** A prompt box that starts a Slack code channel, the same as the MCP tool and `/cc`. */
function Code() {
  const me = root.useLoaderData();
  const [prompt, setPrompt] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [addPreamble, setAddPreamble] = useState(true);
  const [model, setModel] = useState<CodeModel>(DEFAULT_CODE_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<(CodeChannelResult & { key: number })[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/code-channel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, is_private: isPrivate, add_preamble: addPreamble, model }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          json !== null && typeof json === 'object' && 'error' in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`;
        throw new Error(message);
      }
      setLaunched([{ ...(json as CodeChannelResult), key: Date.now() }, ...launched]);
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Code channel</h1>
      <p className={styles.lede}>
        Start a Slack code channel: a new channel where the coding agent gets to work on your
        prompt.
      </p>
      {!me.code_channels_enabled && (
        <p className={styles.off}>
          Code channels are off: <code>SLACK_CLIENT_TOKEN</code> and <code>SLACK_D_COOKIE</code>{' '}
          aren't set on this Worker.
        </p>
      )}
      <form className={styles.form} onSubmit={submit}>
        <textarea
          aria-label="Prompt for the coding agent"
          className={styles.prompt}
          disabled={!me.code_channels_enabled}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What should the agent do?"
          rows={6}
          value={prompt}
        />
        <div className={styles.options}>
          <label className={styles.option}>
            <input
              checked={addPreamble}
              onChange={(event) => setAddPreamble(event.target.checked)}
              type="checkbox"
            />
            Prefix with <code>{CODE_CHANNEL_PREAMBLE.trim()}</code>
          </label>
          <label className={styles.option}>
            <input
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
              type="checkbox"
            />
            Private channel
          </label>
          <label className={styles.option}>
            Model
            <select
              className={styles.select}
              onChange={(event) => setModel(event.target.value as CodeModel)}
              value={model}
            >
              {CODE_MODELS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.launch}
            disabled={busy || !me.code_channels_enabled || prompt.trim() === ''}
            type="submit"
          >
            {busy ? 'Starting…' : 'Launch'}
          </button>
        </div>
        <p className={styles.hint}>⌘↩ to launch.</p>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {launched.length > 0 && (
        <ul className={styles.list}>
          {launched.map((item) => (
            <li className={styles.item} key={item.key}>
              <span className={styles.body}>{item.prompt}</span>
              <span className={styles.meta}>
                {item.model}
                {item.channel_id && (
                  <>
                    {' · '}
                    <a href={item.url ?? undefined} rel="noreferrer" target="_blank">
                      Open in Slack
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
