import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Context mode's explanations, on this device only.
 *
 * The server writes none of these (packages/api/src/routers/passage.ts says
 * why: the passage is the book's text, and an answer nobody shares can be
 * wrong once rather than wrong for every reader forever). So "my explanations"
 * means "the ones this phone asked for" — which is also why there is no sync
 * and no conflict to resolve here.
 *
 * Reads and writes go through this module, like `dictionary.ts`: screens never
 * touch the table.
 */

export type PassageNote = {
  passage: string;
  folderId: string | null;
  plain: string;
  notes: { phrase: string; gloss: string }[];
  createdAt: number;
};

/**
 * The cache key for a passage: its text with whitespace collapsed and case
 * dropped, hashed.
 *
 * Normalizing first means the same sentence typed twice with a stray double
 * space is one entry — this is the same reasoning as `normalizeTerm`, but it
 * deliberately does NOT use it: that function is the match key the server and
 * the dictionary agree on, and widening it to prose would change what every
 * word lookup matches. Punctuation stays, because in a passage it is content.
 */
export function passageKey(passage: string): string {
  const normalized = passage.trim().replace(/\s+/g, " ").toLowerCase();

  // FNV-1a. A passage key never leaves the device and guards nothing, so this
  // is a dictionary key, not a digest — expo-crypto would be a dependency and
  // an async call for no gain.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + normalized.length.toString(16);
}

/** A previously explained passage, or null. */
export async function readPassageNote(
  db: SQLiteDatabase,
  passage: string,
): Promise<PassageNote | null> {
  const row = await db.getFirstAsync<{
    passage: string;
    folder_id: string | null;
    plain: string;
    notes: string;
    created_at: number;
  }>(
    `SELECT passage, folder_id, plain, notes, created_at
       FROM passage_note
      WHERE hash = ?`,
    passageKey(passage),
  );
  return row && toNote(row);
}

/**
 * The most recent explanations, newest first — what context mode shows when
 * the field is empty, the way word mode shows recommendations there.
 */
export async function listPassageNotes(
  db: SQLiteDatabase,
  options: { folderId?: string; limit: number },
): Promise<PassageNote[]> {
  const rows = await db.getAllAsync<{
    passage: string;
    folder_id: string | null;
    plain: string;
    notes: string;
    created_at: number;
  }>(
    `SELECT passage, folder_id, plain, notes, created_at
       FROM passage_note
      ${options.folderId ? "WHERE folder_id = ?" : ""}
      ORDER BY created_at DESC
      LIMIT ?`,
    ...(options.folderId ? [options.folderId, options.limit] : [options.limit]),
  );
  return rows.map(toNote);
}

/**
 * Keeps an explanation so the same passage costs nothing the second time.
 *
 * REPLACE rather than IGNORE, matching `cacheDefinition`: asking again means
 * the reader wanted another answer, and the fresh one is the one to keep.
 */
export async function savePassageNote(
  db: SQLiteDatabase,
  note: Omit<PassageNote, "createdAt">,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO passage_note (hash, passage, folder_id, plain, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    passageKey(note.passage),
    note.passage,
    note.folderId,
    note.plain,
    JSON.stringify(note.notes),
    Date.now(),
  );
}

/** Forgets one explanation — the reader's only way to take it back. */
export async function deletePassageNote(db: SQLiteDatabase, passage: string): Promise<void> {
  await db.runAsync(`DELETE FROM passage_note WHERE hash = ?`, passageKey(passage));
}

function toNote(row: {
  passage: string;
  folder_id: string | null;
  plain: string;
  notes: string;
  created_at: number;
}): PassageNote {
  let notes: PassageNote["notes"] = [];
  try {
    // Written by savePassageNote above and by nothing else, but a row that
    // survived a half-finished write should cost the reader the notes, not
    // the whole screen.
    notes = JSON.parse(row.notes);
  } catch {
    notes = [];
  }

  return {
    passage: row.passage,
    folderId: row.folder_id,
    plain: row.plain,
    notes,
    createdAt: row.created_at,
  };
}
