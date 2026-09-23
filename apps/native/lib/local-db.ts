import type { SQLiteDatabase } from "expo-sqlite";

export const LOCAL_DB_NAME = "glossnote.db";

const LOCAL_DB_VERSION = 5;

// Runs on every app start via SQLiteProvider's onInit. The dictionary tables
// are declared IF NOT EXISTS only as a safety net for when no bundled asset
// has been wired up yet (see apps/native/scripts/build-dictionary-db.ts) —
// once a pre-populated .db ships via `assetSource`, they already exist with
// data by the time this migration runs, and the statements are no-ops.
export async function migrateLocalDb(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;
  // Keep LOCAL_DB_VERSION equal to the last version this function produces.
  // It was left at 3 when the pending_sync.page migration was added, which
  // made this return early on a device already at 3 — so that device never got
  // the column and every offline capture on it failed to replay its page.
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

  if (version === 1) {
    await db.execAsync(`
      -- Device-local UI preferences (reading theme, and later font size /
      -- line spacing). Deliberately not in the server-side userPreference
      -- table: the chosen page colour should apply from the first frame,
      -- before any session or network round-trip exists.
      CREATE TABLE IF NOT EXISTS app_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    version = 2;
  }

  if (version === 2) {
    // Collapse dictionary_core / dictionary_extended / cached_lookup into one
    // table. They held the same columns and were queried as a three-hop
    // fallthrough; one table with `source` + `rank` makes that a single
    // indexed SELECT, and makes "drop the extended pack" a DELETE rather than
    // a DROP TABLE. Ordering by source also fixes the old priority: a cached
    // online/AI definition should win over a stale bundled one.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS dictionary (
        term TEXT NOT NULL,
        definition TEXT NOT NULL,
        part_of_speech TEXT,
        example_sentence TEXT,
        -- 'core' = bundled base set, 'extended' = downloadable pack,
        -- 'cached' = resolved online and kept for offline reuse.
        source TEXT NOT NULL,
        -- 0 = most frequent sense. Only 'extended' rows use it; the other
        -- tiers are one row per term.
        rank INTEGER NOT NULL DEFAULT 0
      );
      -- Unique rather than plain: it both backs the term lookup and enforces
      -- one row per sense, so re-merging a downloaded pack is idempotent.
      CREATE UNIQUE INDEX IF NOT EXISTS dictionary_term_source_rank_uidx ON dictionary (term, source, rank);

      INSERT OR IGNORE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank)
        SELECT term, definition, part_of_speech, example_sentence, 'core', 0 FROM dictionary_core;
      INSERT OR IGNORE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank)
        SELECT term, definition, part_of_speech, example_sentence, 'extended', rank FROM dictionary_extended;
      INSERT OR IGNORE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank)
        SELECT term, definition, NULL, example_sentence, 'cached', 0 FROM cached_lookup;

      DROP TABLE dictionary_core;
      DROP TABLE dictionary_extended;
      DROP TABLE cached_lookup;
    `);
    version = 3;
  }

  if (version === 3) {
    // The page a queued capture was met on, replayed to word.createMany.
    await db.execAsync(`ALTER TABLE pending_sync ADD COLUMN page INTEGER`);
    version = 4;
  }

  if (version === 4) {
    // Context mode's explanations, kept per device and never on the server.
    // The passage is the book's text rather than the app's, so it is not
    // cached into a shared row the way a definition is — see
    // packages/api/src/routers/passage.ts for why that line is drawn here.
    //
    // Keyed by a hash of the normalized passage rather than the passage
    // itself: it is a lookup key, and a 600-character primary key would be
    // copied into the index for nothing.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS passage_note (
        hash TEXT PRIMARY KEY,
        passage TEXT NOT NULL,
        -- The shelf it was read on, for grouping. Nullable: a passage can be
        -- explained with no book behind it, and the row must outlive a folder
        -- deleted on another device.
        folder_id TEXT,
        plain TEXT NOT NULL,
        -- The {phrase, gloss} list as JSON. It is read and written whole and
        -- never queried into, so a second table would buy nothing.
        notes TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS passage_note_created_at_idx ON passage_note (created_at DESC);
    `);
    version = 5;
  }

  await db.execAsync(`PRAGMA user_version = ${version}`);
}
