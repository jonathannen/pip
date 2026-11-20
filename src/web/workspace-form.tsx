import type { FormEvent } from 'react';
import { useId, useState } from 'react';
import type { SlackWorkspace } from '../shared/api';
import type { WorkspaceField } from '../shared/workspace-fields';
import { WORKSPACE_FIELD_GROUPS, WORKSPACE_FIELDS } from '../shared/workspace-fields';
import { apiError } from './api-error';
import styles from './workspace-form.module.css';

type Values = Record<WorkspaceField['name'], string>;

/** Whether a workspace has a secret stored. The bot token and signing secret always are. */
function stored(workspace: SlackWorkspace, name: WorkspaceField['name']): boolean {
  return name === 'client_token'
    ? workspace.client_token_set
    : name === 'd_cookie'
      ? workspace.d_cookie_set
      : true;
}

/**
 * The form a Slack workspace is added with, or `editing` changed with: its fields, each with where
 * the value comes from (src/shared/workspace-fields.ts). The secrets are write-only: their fields
 * start empty, are never filled from the server, and one left blank on a change keeps what is
 * stored.
 */
export function WorkspaceForm({
  editing,
  disabled = false,
  onSaved,
  onCancel,
}: {
  /** The workspace to change; a new one is added without it. */
  readonly editing?: SlackWorkspace;
  /** Whether nothing can be saved yet, as when PIP_SECRETS_KEY isn't set. */
  readonly disabled?: boolean;
  readonly onSaved: (workspace: SlackWorkspace) => void;
  readonly onCancel?: () => void;
}) {
  const [values, setValues] = useState<Values>(
    () =>
      Object.fromEntries(
        WORKSPACE_FIELDS.map(({ name, secret }) => [
          name,
          secret ? '' : String(editing?.[name as keyof SlackWorkspace] ?? ''),
        ]),
      ) as Values,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      // As JSON: the API takes nothing else, so another site's form can't post one.
      const res = await fetch(editing ? `/api/workspaces/${editing.team_id}` : '/api/workspaces', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        throw new Error(await apiError(res));
      }
      onSaved(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {WORKSPACE_FIELD_GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend>{group.title}</legend>
          <p>{group.about}</p>
          {group.fields.map(({ name, label, placeholder, hint, required, secret }) => {
            const kept = secret && editing !== undefined && stored(editing, name);
            return (
              <div className={styles.field} key={name}>
                <label htmlFor={`${id}-${name}`}>
                  {label}
                  {!required && <span className={styles.optional}>Optional</span>}
                </label>
                <input
                  aria-describedby={`${id}-${name}-hint`}
                  autoCapitalize="off"
                  autoComplete={secret ? 'new-password' : 'off'}
                  disabled={name === 'team_id' && editing !== undefined}
                  id={`${id}-${name}`}
                  onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                  placeholder={kept ? 'Stored. Leave blank to keep it' : placeholder}
                  required={required && !kept}
                  spellCheck={false}
                  type={secret ? 'password' : 'text'}
                  value={values[name]}
                />
                <p className={styles.hint} id={`${id}-${name}-hint`}>
                  {hint}
                </p>
              </div>
            );
          })}
        </fieldset>
      ))}
      <span className={styles.actions}>
        <button disabled={busy || disabled} type="submit">
          {busy ? 'Saving…' : editing ? 'Save' : 'Add the workspace'}
        </button>
        {onCancel && (
          <button className={styles.quiet} onClick={onCancel} type="button">
            Cancel
          </button>
        )}
      </span>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
