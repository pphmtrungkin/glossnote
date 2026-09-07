import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { dictionarySourceEnum } from "./enums";

// Shared cache of resolved definitions, keyed by normalized term. Looked up
// (and upgraded from bundled -> dictionary_api/ai_enhanced) once per term
// rather than per user/word, so repeated lookups of the same word are free.
//
// `term` holds the NORMALIZED form (trimmed + lowercased, the same way
// word.normalizedTerm is built) — it is a match key, not a display string.
// Anything joining to this table must normalize first; joining a display-cased
// term like "Serendipity" silently matches nothing.
//
// Deliberately one row per term, not one per sense (contrast with the on-device
// `dictionary` table in apps/native/lib/local-db.ts, which stores multiple
// ranked WordNet senses per term). This represents "the one best known
// resolution" for a term, which is also exactly what the crowdsourced
// discovery view needs — one word, one definition, no sense picker.
//
// AI enrichment (exampleSentence + usageNote) lives here, keyed by term and
// not by user, because that is what makes the spec's cost-control target
// hold: "each unique word triggers at most one AI enrichment call" across the
// entire user base (SoftwareSpec §8.3, §10). Enrich once, serve forever.
//
// Spoiler safety (SoftwareSpec §10) is a *query* constraint, not a storage
// one: the crowdsourced aggregate view must select only term + definition and
// never exampleSentence, since a sentence drawn from a book can leak plot.
// Storing the column here is fine; selecting it in that one view is not.
export const dictionaryEntry = pgTable(
  "dictionary_entry",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    term: text("term").notNull(),
    // Base definition from the bundled dataset or dictionary API — the
    // deterministic part, never AI-generated.
    definition: text("definition").notNull(),
    // AI-generated, shared across every user who looks this term up. Null
    // until enrichment runs, which is why `source` can still be "bundled" or
    // "dictionary_api" on a row that has a definition but no example yet.
    exampleSentence: text("example_sentence"),
    usageNote: text("usage_note"),
    source: dictionarySourceEnum("source").notNull(),
    // Set when AI enrichment last succeeded. Distinct from updatedAt, which
    // also moves on non-AI edits — this is the field that answers "has this
    // term already cost us an AI call?"
    enrichedAt: timestamp("enriched_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("dictionary_entry_term_uidx").on(table.term)],
);
