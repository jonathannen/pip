import { env } from 'cloudflare:workers';
import type { Note } from '../shared/api';
import { NOTE_MAX_LENGTH } from '../shared/api';

/** The notes, newest first. */
export async function listNotes(limit = 100): Promise<Note[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, body, created_by, created_at FROM notes ORDER BY id DESC LIMIT ?',
  )
    .bind(limit)
    .all<Note>();
  return results;
}

/** Trims the body; undefined when nothing is left or it's too long. */
export function parseNoteBody(body: unknown): string | undefined {
  if (typeof body !== 'string') {
    return undefined;
  }
  const trimmed = body.trim();
  return trimmed === '' || trimmed.length > NOTE_MAX_LENGTH ? undefined : trimmed;
}

export async function addNote(body: string, createdBy: string): Promise<Note> {
  const note = await env.DB.prepare(
    'INSERT INTO notes (body, created_by) VALUES (?, ?) RETURNING id, body, created_by, created_at',
  )
    .bind(body, createdBy)
    .first<Note>();
  if (note === null) {
    throw new Error('notes: insert returned no row');
  }
  return note;
}

/** Whether a note was deleted. */
export async function deleteNote(id: number): Promise<boolean> {
  const { meta } = await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
  return meta.changes > 0;
}
