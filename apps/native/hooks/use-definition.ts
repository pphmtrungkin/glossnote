import { normalizeTerm } from "@better-vocab/domain";
import { useQuery } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

import { useIsOnline } from "@/hooks/use-is-online";
import { cacheDefinition, readLocalDefinition } from "@/lib/dictionary";
import { trpcClient } from "@/utils/trpc";

/**
 * "Get me a definition for this term."
 *
 * One interface over what used to be three separate decisions: the SQL that
 * ranks the on-device tiers, the screen that chose between device and server,
 * and the server procedure that chose between its cache and its providers. A
 * screen now asks once and renders the answer.
 *
 * Online, the server answers: its definitions are AI-written (see
 * routers/dictionary.ts), so the device's own dictionary is the offline
 * fallback — used with no connection, when the server can't be reached, or
 * when the server has no entry for the term. A definition that does come from
 * the server is written back into the local `cached` tier, which outranks the
 * bundled ones, so the same word still resolves on a plane.
 */

export type Resolution =
  /** Somebody had it. `fromNetwork` says whether this particular lookup went out. */
  | {
      status: "found";
      term: string;
      definition: string;
      partOfSpeech: string | null;
      exampleSentence: string | null;
      /** Brace-marked AI sentences (see `parseContext`). Server-only, so `[]` offline. */
      contexts: string[];
      /** The AI's note on where the word is used. Server-only, so null offline. */
      usageNote: string | null;
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
  const isOnline = useIsOnline();
  const db = useSQLiteContext();
  const normalized = normalizeTerm(term);

  return useQuery({
    // Connectivity is part of the key, so regaining a signal re-resolves an
    // answer the device gave while offline.
    queryKey: ["definition", normalized, online, isOnline],
    enabled: normalized.length > 0,
    retry: false,
    queryFn: async (): Promise<Resolution> => {
      let isUnreachable = online && !isOnline;

      if (online && isOnline && normalized.length >= MIN_NETWORK_LENGTH) {
        try {
          const entry = await trpcClient.dictionary.lookup.query({ term: normalized });
          if (entry) {
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
              contexts: entry.contexts,
              usageNote: entry.usageNote,
              fromNetwork: true,
            };
          }
          // No entry: usually an invented word ("gom jabbar"), but a rare real
          // one may still be in the offline dictionary, so ask it below.
        } catch {
          // The server is down, or its providers are. Ordinary while reading,
          // not a broken screen — the device still gets its say.
          isUnreachable = true;
        }
      }

      const local = await readLocalDefinition(db, normalized);
      if (local) {
        return {
          status: "found",
          term: local.term,
          definition: local.definition,
          partOfSpeech: local.partOfSpeech,
          exampleSentence: local.exampleSentence,
          // The device table has no columns for either: they only exist on
          // the server's shared row.
          contexts: [],
          usageNote: null,
          fromNetwork: false,
        };
      }

      return isUnreachable ? { status: "unreachable" } : { status: "missing" };
    },
  });
}
