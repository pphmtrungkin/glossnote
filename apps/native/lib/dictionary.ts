import type { DictionaryTier, NormalizedTerm } from "@better-vocab/domain";
import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Storage for on-device definitions: one read, one write, over the single
 * `dictionary` table that holds all three tiers (see local-db.ts).
 *
 * Callers pass a term that has already been through `normalizeTerm` — the
 * table is keyed on the normalized form, so a display-cased term silently
 * matches nothing.
 */

export type LocalDefinition = {
  term: NormalizedTerm;
  definition: string;
  partOfSpeech: string | null;
  exampleSentence: string | null;
  tier: DictionaryTier;
};

/**
 * Best definition this device holds for a term, or null.
 *
 * Priority is cached > core > extended: a definition already resolved online
 * is richer than the bundled one, and within the extended pack the lowest rank
 * is the most frequent sense — matching the "definition displayed instantly,
 * user confirms" flow. Other senses stay queryable if a "see other meanings"
 * UI is ever added.
 */
export async function readLocalDefinition(
  db: SQLiteDatabase,
  term: NormalizedTerm,
): Promise<LocalDefinition | null> {
  const row = await db.getFirstAsync<{
    definition: string;
    part_of_speech: string | null;
    example_sentence: string | null;
    source: DictionaryTier;
  }>(
    `SELECT definition, part_of_speech, example_sentence, source
       FROM dictionary
      WHERE term = ?
      ORDER BY CASE source WHEN 'cached' THEN 0 WHEN 'core' THEN 1 ELSE 2 END, rank
      LIMIT 1`,
    term,
  );
  if (!row) return null;

  return {
    term,
    definition: row.definition,
    partOfSpeech: row.part_of_speech,
    exampleSentence: row.example_sentence,
    tier: row.source,
  };
}

/**
 * Keeps a definition resolved online, so the same word works offline next
 * time. This is the only writer of the `cached` tier — without it the tier's
 * top priority above is unreachable and every online lookup is thrown away.
 *
 * `part_of_speech` is null because the shared `dictionary_entry` table has no
 * such column. That is a storage fact and it stays here, rather than being
 * restated wherever a definition is displayed.
 *
 * REPLACE rather than IGNORE: a re-resolved term is fresher than the copy
 * already cached (AI enrichment may have filled in an example sentence since).
 * The unique index on (term, source, rank) makes it idempotent.
 */
export async function cacheDefinition(
  db: SQLiteDatabase,
  entry: { term: NormalizedTerm; definition: string; exampleSentence: string | null },
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank)
     VALUES (?, ?, NULL, ?, 'cached', 0)`,
    entry.term,
    entry.definition,
    entry.exampleSentence,
  );
}
