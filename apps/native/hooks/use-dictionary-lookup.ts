import { useQuery } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

type DictionaryLookup = {
  term: string;
  definition: string;
  partOfSpeech: string | null;
  exampleSentence: string | null;
  source: "core" | "extended" | "cached";
};

type DictionaryRow = { definition: string; part_of_speech: string | null; example_sentence: string | null };

// Offline-first: checks the bundled core dictionary, then the optional
// downloaded extended pack, then previously cached online lookups — the same
// order described in the manual-entry flow (bundled/cached first, network
// only as a fallback). `dictionary_extended` can hold multiple senses per
// term (see local-db.ts), so it's queried ordered by rank and only the most
// frequent sense is surfaced here, matching the "definition displayed
// instantly, user confirms" flow — other senses stay queryable later if a
// "see other meanings" UI is added.
export function useDictionaryLookup(term: string) {
  const db = useSQLiteContext();
  const normalized = term.trim().toLowerCase();

  return useQuery({
    queryKey: ["local-dictionary", normalized],
    enabled: normalized.length > 0,
    queryFn: async (): Promise<DictionaryLookup | null> => {
      const core = await db.getFirstAsync<DictionaryRow>(
        "SELECT definition, part_of_speech, example_sentence FROM dictionary_core WHERE term = ?",
        normalized,
      );
      if (core) {
        return {
          term: normalized,
          definition: core.definition,
          partOfSpeech: core.part_of_speech,
          exampleSentence: core.example_sentence,
          source: "core",
        };
      }

      const extended = await db.getFirstAsync<DictionaryRow>(
        "SELECT definition, part_of_speech, example_sentence FROM dictionary_extended WHERE term = ? ORDER BY rank ASC LIMIT 1",
        normalized,
      );
      if (extended) {
        return {
          term: normalized,
          definition: extended.definition,
          partOfSpeech: extended.part_of_speech,
          exampleSentence: extended.example_sentence,
          source: "extended",
        };
      }

      const cached = await db.getFirstAsync<{ definition: string; example_sentence: string | null }>(
        "SELECT definition, example_sentence FROM cached_lookup WHERE term = ?",
        normalized,
      );
      if (cached) {
        return {
          term: normalized,
          definition: cached.definition,
          partOfSpeech: null,
          exampleSentence: cached.example_sentence,
          source: "cached",
        };
      }

      return null;
    },
  });
}
