import { useQuery } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

type DictionarySource = "core" | "extended" | "cached";

type DictionaryLookup = {
  term: string;
  definition: string;
  partOfSpeech: string | null;
  exampleSentence: string | null;
  source: DictionarySource;
};

// Offline-first: one indexed read over the local `dictionary` table, which
// holds all three tiers (bundled core, downloaded extended pack, and lookups
// previously resolved online). Priority is cached > core > extended: a
// definition already resolved online is richer than the bundled one, and
// within the extended pack the lowest rank is the most frequent sense —
// matching the "definition displayed instantly, user confirms" flow. Other
// senses stay queryable if a "see other meanings" UI is ever added.
export function useDictionaryLookup(term: string) {
  const db = useSQLiteContext();
  const normalized = term.trim().toLowerCase();

  return useQuery({
    queryKey: ["local-dictionary", normalized],
    enabled: normalized.length > 0,
    queryFn: async (): Promise<DictionaryLookup | null> => {
      const row = await db.getFirstAsync<{
        definition: string;
        part_of_speech: string | null;
        example_sentence: string | null;
        source: DictionarySource;
      }>(
        `SELECT definition, part_of_speech, example_sentence, source
           FROM dictionary
          WHERE term = ?
          ORDER BY CASE source WHEN 'cached' THEN 0 WHEN 'core' THEN 1 ELSE 2 END, rank
          LIMIT 1`,
        normalized,
      );
      if (!row) return null;

      return {
        term: normalized,
        definition: row.definition,
        partOfSpeech: row.part_of_speech,
        exampleSentence: row.example_sentence,
        source: row.source,
      };
    },
  });
}
