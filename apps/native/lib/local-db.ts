import type { SQLiteDatabase } from "expo-sqlite";

export const LOCAL_DB_NAME = "lexishelf.db";

const LOCAL_DB_VERSION = 1;

// Runs on every app start via SQLiteProvider's onInit. `dictionary_core` is
// declared IF NOT EXISTS only as a safety net for when no bundled asset has
// been wired up yet (see apps/native/scripts/build-dictionary-db.ts) — once a
// pre-populated .db ships via `assetSource`, this table already exists with
// data by the time this migration runs, and the statement is a no-op.
export async function migrateLocalDb(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;
  if (version >= LOCAL_DB_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';

      -- One row per term (source data pre-deduped to its most frequent sense).
      CREATE TABLE IF NOT EXISTS dictionary_core (
        term TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        part_of_speech TEXT,
        example_sentence TEXT
      );

      -- Downloadable pack, toggled on/off from Settings ("offline dictionary
      -- size/coverage"). Populated by merging a downloaded .db into this table;
      -- dropping/truncating it reclaims the storage when toggled off. Unlike
      -- dictionary_core, a term can have multiple rows (one per WordNet sense),
      -- ordered by rank (0 = most frequent).
      CREATE TABLE IF NOT EXISTS dictionary_extended (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        definition TEXT NOT NULL,
        part_of_speech TEXT,
        example_sentence TEXT,
        rank INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS dictionary_extended_term_idx ON dictionary_extended (term);

      -- Definitions resolved online (dictionary API / AI-enhanced), cached so
      -- the same word is available offline on every later lookup.
      CREATE TABLE IF NOT EXISTS cached_lookup (
        term TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        source TEXT NOT NULL,
        example_sentence TEXT,
        cached_at INTEGER NOT NULL
      );

      -- Words captured while offline; flushed to the server on reconnect,
      -- then deleted locally once the server confirms the write.
      CREATE TABLE IF NOT EXISTS pending_sync (
        local_id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        term TEXT NOT NULL,
        definition TEXT,
        definition_source TEXT NOT NULL,
        example_sentence TEXT,
        capture_method TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    version = 1;
  }

  await db.execAsync(`PRAGMA user_version = ${version}`);
}
