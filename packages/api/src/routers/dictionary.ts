import { normalizeTerm } from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

const DATAMUSE_ENDPOINT = "https://api.datamuse.com/words";

// Datamuse asks that apps using it acknowledge it in their documentation; see
// apps/fumadocs/content/docs/offline-dictionary.mdx. No API key is required
// today. From 2027-01-01 a (still free) key is needed, 100k requests/day.
const DATAMUSE_TIMEOUT_MS = 5000;

// `defs` entries are "<part of speech>\t<definition>", e.g.
// "adj\tLasting for a short period of time. ". Only the definition text is
// kept: dictionary_entry has no part-of-speech column, and nothing displays
// one today.
const datamuseHitSchema = z.looseObject({
  word: z.string(),
  defs: z.array(z.string()).nullish(),
});

const datamuseResponseSchema = z.array(datamuseHitSchema);

/**
 * Picks the definition for `normalizedTerm` out of a Datamuse response.
 *
 * The `sp` ("spelled like") parameter is a FUZZY match: asking for a word that
 * doesn't exist returns a similar one instead of an empty list — "sietch"
 * comes back as "sketch". Returning that would file a completely wrong
 * definition under the user's word, so the exact-word check below is the whole
 * point of this function, not a detail.
 *
 * Returns null when there is no exact match, or the match carries no
 * definitions (Datamuse indexes many words it cannot define).
 */
export function pickDefinition(payload: unknown, normalizedTerm: string): string | null {
  const parsed = datamuseResponseSchema.safeParse(payload);
  if (!parsed.success) return null;

  const exact = parsed.data.find((hit) => normalizeTerm(hit.word) === normalizedTerm);
  const first = exact?.defs?.[0];
  if (!first) return null;

  // Split on the first tab only — a definition may itself contain tabs.
  const tab = first.indexOf("\t");
  const text = (tab === -1 ? first : first.slice(tab + 1)).trim();
  return text.length > 0 ? text : null;
}

export const dictionaryRouter = router({
  /**
   * Resolves one term to a definition, and caches the result.
   *
   * This is the ONLY legitimate writer of `dictionary_entry` outside the seed.
   * Definitions are never accepted from a device (see word.create) — otherwise
   * the first person to capture a term would define it permanently for every
   * other reader.
   *
   * Returns null rather than throwing when the word simply isn't in the
   * dictionary: invented words ("gom jabbar") are a normal case for a reading
   * app, not an error.
   */
  lookup: protectedProcedure
    .input(z.object({ term: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const normalizedTerm = normalizeTerm(input.term);

      // 1. Shared cache first — every later reader of this term is free, which
      //    is what keeps both the Datamuse quota and (later) AI cost flat.
      const cached = await db.query.dictionaryEntry.findFirst({
        where: eq(dictionaryEntry.term, normalizedTerm),
      });
      if (cached) return cached;

      // 2. Miss: ask Datamuse.
      let payload: unknown;
      try {
        const url = new URL(DATAMUSE_ENDPOINT);
        url.searchParams.set("sp", normalizedTerm);
        url.searchParams.set("md", "d");
        // More than one, because the exact match is not always ranked first
        // once the fuzzy matcher is involved.
        url.searchParams.set("max", "5");

        const response = await fetch(url, { signal: AbortSignal.timeout(DATAMUSE_TIMEOUT_MS) });
        if (!response.ok) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `Dictionary lookup failed (${response.status} ${response.statusText}).`,
          });
        }
        payload = await response.json();
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        // Timeout or network failure. The app already has an offline answer to
        // fall back on, so this is a soft failure, not a broken screen.
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Dictionary lookup timed out." });
      }

      const definition = pickDefinition(payload, normalizedTerm);
      if (!definition) return null;

      // 3. Cache it. onConflictDoNothing covers two requests racing on the same
      //    brand-new term; the loser re-reads the winner's row.
      const [inserted] = await db
        .insert(dictionaryEntry)
        .values({ term: normalizedTerm, definition, source: "dictionary_api" })
        .onConflictDoNothing({ target: dictionaryEntry.term })
        .returning();

      return (
        inserted ??
        (await db.query.dictionaryEntry.findFirst({ where: eq(dictionaryEntry.term, normalizedTerm) })) ??
        null
      );
    }),
});
