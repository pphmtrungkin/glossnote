/// <reference types="bun" />
// Builds a pre-populated SQLite asset from an intermediate JSON dictionary
// file. Source-agnostic — doesn't know about WordNet specifically (see
// wordnet-to-dictionary.ts for that). Run at build/content-update time, not
// on-device.
//
// Usage: bun run scripts/build-dictionary-db.ts <core|extended> <source.json> <output.db>
//
// core:     one row per term (source must already be deduped to one sense
//           per term); matches apps/native/lib/local-db.ts's dictionary_core.
// extended: many rows per term allowed (multiple senses), ordered by an
//           optional `rank` field on each entry; matches dictionary_extended.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

type Entry = { term: string; definition: string; partOfSpeech?: string; exampleSentence?: string; rank?: number };

const [, , mode, sourcePath, outputPath] = process.argv;
if ((mode !== "core" && mode !== "extended") || !sourcePath || !outputPath) {
  throw new Error("Usage: bun run scripts/build-dictionary-db.ts <core|extended> <source.json> <output.db>");
}

const entries: Entry[] = JSON.parse(readFileSync(sourcePath, "utf-8"));

const db = new Database(outputPath, { create: true });

if (mode === "core") {
  db.run(`
    CREATE TABLE dictionary_core (
      term TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      part_of_speech TEXT,
      example_sentence TEXT
    );
    CREATE VIRTUAL TABLE dictionary_fts USING fts5(term, content='dictionary_core', content_rowid='rowid');
  `);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO dictionary_core (term, definition, part_of_speech, example_sentence) VALUES (?, ?, ?, ?)",
  );
  const insertFts = db.prepare("INSERT INTO dictionary_fts (rowid, term) SELECT rowid, term FROM dictionary_core WHERE term = ?");

  db.transaction(() => {
    for (const entry of entries) {
      const normalized = entry.term.trim().toLowerCase();
      insert.run(normalized, entry.definition, entry.partOfSpeech ?? null, entry.exampleSentence ?? null);
      insertFts.run(normalized);
    }
  })();
} else {
  db.run(`
    CREATE TABLE dictionary_extended (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      definition TEXT NOT NULL,
      part_of_speech TEXT,
      example_sentence TEXT,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX dictionary_extended_term_idx ON dictionary_extended (term);
  `);
  const insert = db.prepare(
    "INSERT INTO dictionary_extended (term, definition, part_of_speech, example_sentence, rank) VALUES (?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    for (const entry of entries) {
      const normalized = entry.term.trim().toLowerCase();
      insert.run(normalized, entry.definition, entry.partOfSpeech ?? null, entry.exampleSentence ?? null, entry.rank ?? 0);
    }
  })();
}

db.close();
console.log(`Wrote ${entries.length} ${mode} entries to ${outputPath}`);
