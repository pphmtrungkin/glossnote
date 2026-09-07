/// <reference types="bun" />
// Builds a pre-populated SQLite asset from an intermediate JSON dictionary
// file. Source-agnostic — doesn't know about WordNet specifically (see
// wordnet-to-dictionary.ts for that). Run at build/content-update time, not
// on-device.
//
// Usage: bun run scripts/build-dictionary-db.ts <core|extended> <source.json> <output.db>
//
// core:     the bundled base set, one row per term (source must already be
//           deduped to one sense per term).
// extended: the downloadable pack, many rows per term allowed (multiple
//           senses), ordered by an optional `rank` field on each entry.
//
// Both write the same `dictionary` table that apps/native/lib/local-db.ts
// creates — the only difference is the `source` value stamped on each row.
import { normalizeTerm } from "@better-vocab/domain";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

type Entry = { term: string; definition: string; partOfSpeech?: string; exampleSentence?: string; rank?: number };

const [, , mode, sourcePath, outputPath] = process.argv;
if ((mode !== "core" && mode !== "extended") || !sourcePath || !outputPath) {
  throw new Error("Usage: bun run scripts/build-dictionary-db.ts <core|extended> <source.json> <output.db>");
}

const entries: Entry[] = JSON.parse(readFileSync(sourcePath, "utf-8"));

const db = new Database(outputPath, { create: true });

// Must match local-db.ts's schema and LOCAL_DB_VERSION exactly: a shipped
// asset opens with this user_version already set, so migrateLocalDb returns
// early and never touches the pre-populated rows.
db.run(`
  CREATE TABLE dictionary (
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    part_of_speech TEXT,
    example_sentence TEXT,
    source TEXT NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX dictionary_term_source_rank_uidx ON dictionary (term, source, rank);
  PRAGMA user_version = 3;
`);

const insert = db.prepare(
  "INSERT OR IGNORE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank) VALUES (?, ?, ?, ?, ?, ?)",
);

db.transaction(() => {
  for (const entry of entries) {
    // Same function the app and the server use. If this ever normalized
    // differently, every lookup against the shipped asset would miss.
    const normalized = normalizeTerm(entry.term);
    // core is one-sense-per-term, so rank is pinned to 0 and the unique index
    // silently drops any duplicate term the source file still carries.
    const rank = mode === "core" ? 0 : (entry.rank ?? 0);
    insert.run(normalized, entry.definition, entry.partOfSpeech ?? null, entry.exampleSentence ?? null, mode, rank);
  }
})();

db.close();
console.log(`Wrote ${entries.length} ${mode} entries to ${outputPath}`);
