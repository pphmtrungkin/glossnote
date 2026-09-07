import { normalizeTerm } from "@better-vocab/domain";
import { useQuery } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

import { cacheDefinition, readLocalDefinition } from "@/lib/dictionary";
import { trpcClient } from "@/utils/trpc";

/**
 * "Get me a definition for this term."
 *
 * One interface over what used to be three separate decisions: the SQL that
 * ranks the on-device tiers, the screen that chose between device and server,
 * and the server procedure that chose between its cache and Datamuse. A screen
 * now asks once and renders the answer.
 *
 * Offline first, network second: the device's own dictionary is consulted
 * before any request goes out, so a capture of a common word never reaches the
 * network. A definition that does come from the server is written back into
 * the local `cached` tier, so the second lookup of that word works on a plane.
 */

export type Resolution =
  /** Somebody had it. `fromNetwork` says whether this particular lookup went out. */
  | {
      status: "found";
      term: string;
      definition: string;
      partOfSpeech: string | null;
      exampleSentence: string | null;
      fromNetwork: boolean;
    }
  /** Asked everywhere available and it is genuinely not a word we know. */
  | { status: "missing" }
  /** Not on the device, and the server could not be reached to ask. */
  | { status: "unreachable" };

/** Below this length a term is still being typed; not worth a round trip. */
const MIN_NETWORK_LENGTH = 2;

export function useDefinition(term: string, options: { online?: boolean } = {}) {
  // Suggestion lists resolve one term per row, so they opt out of the network
  // rather than firing a request per visible row.
  const online = options.online ?? true;
  const db = useSQLiteContext();
  const normalized = normalizeTerm(term);

  return useQuery({
    queryKey: ["definition", normalized, online],
    enabled: normalized.length > 0,
    retry: false,
    queryFn: async (): Promise<Resolution> => {
      const local = await readLocalDefinition(db, normalized);
      if (local) {
        return {
          status: "found",
          term: local.term,
          definition: local.definition,
          partOfSpeech: local.partOfSpeech,
          exampleSentence: local.exampleSentence,
          fromNetwork: false,
        };
      }

      if (!online || normalized.length < MIN_NETWORK_LENGTH) return { status: "missing" };

      let entry: Awaited<ReturnType<typeof trpcClient.dictionary.lookup.query>>;
      try {
        entry = await trpcClient.dictionary.lookup.query({ term: normalized });
      } catch {
        // Offline, or the server could not reach its dictionary provider.
        // Both are ordinary while reading, not a broken screen — the caller
        // shows a different message and still lets the word be saved.
        return { status: "unreachable" };
      }

      // Invented words ("gom jabbar") resolve to nothing. Normal for a reading
      // app, so there is nothing to cache and nothing to report as an error.
      if (!entry) return { status: "missing" };

      await cacheDefinition(db, {
        term: normalized,
        definition: entry.definition,
        exampleSentence: entry.exampleSentence,
      });

      return {
        status: "found",
        term: normalized,
        definition: entry.definition,
        partOfSpeech: null,
        exampleSentence: entry.exampleSentence,
        fromNetwork: true,
      };
    },
  });
}
