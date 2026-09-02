import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { dictionarySourceEnum } from "./enums";

// Shared cache of resolved definitions, keyed by normalized term. Looked up
// (and upgraded from bundled -> dictionary_api/ai_enhanced) once per term
// rather than per user/word, so repeated lookups of the same word are free.
//
// Deliberately one row per term, not one per sense (contrast with the
// on-device dictionary_extended table in apps/native/lib/local-db.ts, which
// does store multiple ranked WordNet senses per term). There's no mismatch
// here: dictionary_extended is static bundled reference data with no server
// equivalent, while this table's true on-device analog is cached_lookup
// (also single-row-per-term). This represents "the one best known
// resolution" for a term, which is also exactly what the crowdsourced
// discovery view needs — one word, one definition, no sense picker.
export const dictionaryEntry = pgTable(
  "dictionary_entry",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    term: text("term").notNull(),
    definition: text("definition").notNull(),
    source: dictionarySourceEnum("source").notNull(),
    audioUrl: text("audio_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("dictionary_entry_term_uidx").on(table.term)],
);
