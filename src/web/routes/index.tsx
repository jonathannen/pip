import { createFileRoute, useRouter } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { useState } from 'react';
import type { Note } from '../../shared/api';
import { NOTE_MAX_LENGTH } from '../../shared/api';
import styles from './index.module.css';

export const Route = createFileRoute('/')({
  loader: async (): Promise<Note[]> => {
    const res = await fetch('/api/notes');
    if (!res.ok) {
      throw new Error(`/api/notes ${res.status}`);
    }
    return res.json();
  },
  component: Notes,
});

function Notes() {
  const notes = Route.useLoaderData();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        throw new Error(`Couldn't add the note (${res.status})`);
      }
      setBody('');
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(`Couldn't delete #${id} (${res.status})`);
      return;
    }
    await router.invalidate();
  }

  return (
    <>
      <h1>Notes</h1>
      <form className={styles.form} onSubmit={submit}>
        <input
          aria-label="New note"
          className={styles.input}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Keep a note…"
          value={body}
        />
        <button disabled={busy || body.trim() === ''} type="submit">
          Add
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {notes.length === 0 ? (
        <p className={styles.empty}>No notes yet. Add one here, by MCP, or DM pip in Slack.</p>
      ) : (
        <ul className={styles.list}>
          {notes.map((note) => (
            <li className={styles.note} key={note.id}>
              <span className={styles.body}>{note.body}</span>
              <span className={styles.meta}>
                #{note.id} · {note.created_by} · {new Date(note.created_at).toLocaleString()}
              </span>
              <button className={styles.delete} onClick={() => remove(note.id)} type="button">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
