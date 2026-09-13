import { normalizeTerm } from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { defineTerm, enrichDefinition } from "../enrich";
import { protectedProcedure, router } from "../index";
import { rateLimit } from "../rate-limit";

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

type DictionaryEntry = typeof dictionaryEntry.$inferSelect;

/**
 * Adds the AI example sentence and usage note to a shared entry — at most once
 * per term, across the entire user base (SoftwareSpec §8.3, §10).
 *
 * `enrichedAt` is both the marker and the lock. Stamping it *before* the call
 * is what makes "at most once" true under concurrency: two readers hitting the
 * same brand-new word buy one enrichment between them, not one each. The
 * conditional update is the claim — losing it means someone else is already
 * paying, so this request returns the base definition and moves on.
 *
 * A failed call releases the claim, so a timeout costs the term nothing worse
 * than staying un-enriched until the next lookup.
 */
async function enrichOnce(entry: DictionaryEntry): Promise<DictionaryEntry> {
  if (entry.enrichedAt) return entry;

  const [claimed] = await db
    .update(dictionaryEntry)
    .set({ enrichedAt: new Date() })
    .where(and(eq(dictionaryEntry.id, entry.id), isNull(dictionaryEntry.enrichedAt)))
    .returning();
  if (!claimed) return entry;

  const enrichment = await enrichDefinition(entry.term, entry.definition);
  if (!enrichment) {
    const [released] = await db
      .update(dictionaryEntry)
      .set({ enrichedAt: null })
      .where(eq(dictionaryEntry.id, entry.id))
      .returning();
    return released ?? entry;
  }

  const [enriched] = await db
    .update(dictionaryEntry)
    // The base definition stays exactly as the dictionary gave it; `source`
    // records that this row has been through the AI pass on top of it.
    .set({ ...enrichment, source: "ai_enhanced" })
    .where(eq(dictionaryEntry.id, entry.id))
    .returning();
  return enriched ?? entry;
}

/** Datamuse's definition for a term, or null. Throws when Datamuse can't be reached. */
async function fetchDatamuseDefinition(normalizedTerm: string): Promise<string | null> {
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

  return pickDefinition(payload, normalizedTerm);
}

/**
 * Inserts a new shared row. onConflictDoNothing covers two requests racing on
 * the same brand-new term; the loser re-reads the winner's row.
 */
async function insertEntry(values: typeof dictionaryEntry.$inferInsert): Promise<DictionaryEntry | null> {
  const [inserted] = await db
    .insert(dictionaryEntry)
    .values(values)
    .onConflictDoNothing({ target: dictionaryEntry.term })
    .returning();
  return (
    inserted ?? (await db.query.dictionaryEntry.findFirst({ where: eq(dictionaryEntry.term, values.term) })) ?? null
  );
}

// A brand-new term has no row yet, so `enrichedAt` has nothing to claim. These
// two stand in for it until the row exists: concurrent lookups of one cold word
// share a single resolution, and a word nobody can define ("gom jabbar")
// doesn't cost a Datamuse request and a model call on every lookup.
//
// ponytail: per-process memory. A second API instance can spend its own call
// on the same cold word, and a restart forgets the unknown words; move both
// into Postgres if the API ever runs more than one instance.
const inFlight = new Map<string, Promise<DictionaryEntry | null>>();
const unknownTerms = new Set<string>();
const UNKNOWN_TERMS_LIMIT = 10_000;

function rememberUnknown(normalizedTerm: string): null {
  if (unknownTerms.size >= UNKNOWN_TERMS_LIMIT) unknownTerms.clear();
  unknownTerms.add(normalizedTerm);
  return null;
}

/**
 * Resolves a term with no shared row. Datamuse decides WHETHER it is a word;
 * the model writes WHAT it means.
 *
 * Datamuse goes first as a gate, not as a source. Told to leave words invented
 * for a book blank, Gemini still defined "sietch" from Dune on every call at
 * temperature 0 — and its own usage note called the word invented. Datamuse
 * has never heard of it, so a word Datamuse doesn't know is never sent to the
 * model. The reverse does not hold: Datamuse's sources include fiction
 * ("horcrux"), so a word the model calls unknown is trusted rather than filled
 * in from Datamuse.
 *
 * The AI path writes definition, contexts and usage note in one call and
 * inserts the row already enriched. When that call fails, Datamuse's own
 * definition is saved and enriched afterwards, so AI stays optional.
 */
async function resolveNewTerm(normalizedTerm: string): Promise<DictionaryEntry | null> {
  // Re-read inside the in-flight slot: a request that missed the cache just
  // before another one inserted the row would otherwise start a second call.
  const existing = await db.query.dictionaryEntry.findFirst({
    where: eq(dictionaryEntry.term, normalizedTerm),
  });
  if (existing) return enrichOnce(existing);

  // Throws when Datamuse can't be reached. Skipping the gate would leave the
  // model as the only spoiler guard, so the lookup fails instead and the app
  // answers from the device dictionary.
  const datamuseDefinition = await fetchDatamuseDefinition(normalizedTerm);
  if (!datamuseDefinition) return rememberUnknown(normalizedTerm);

  const defined = await defineTerm(normalizedTerm);
  if (defined === "unknown") return rememberUnknown(normalizedTerm);
  if (defined) {
    return insertEntry({ term: normalizedTerm, ...defined, source: "ai_enhanced", enrichedAt: new Date() });
  }

  // ponytail: an AI outage saves Datamuse's wording, which for a fiction term
  // Datamuse knows ("horcrux") is the book's meaning. Rare, since it needs a
  // failed call on a fiction word's first lookup; return null here instead if
  // that ever matters more than keeping lookups working through an outage.
  const entry = await insertEntry({ term: normalizedTerm, definition: datamuseDefinition, source: "dictionary_api" });
  return entry ? enrichOnce(entry) : null;
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
    // A cold term costs a Datamuse request (100k a day) and at most one AI
    // call. A reader looks up a word every few minutes; this only stops a
    // client stuck in a loop.
    .use(rateLimit({ name: "dictionary.lookup", max: 60, windowSeconds: 60 }))
    .input(z.object({ term: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const normalizedTerm = normalizeTerm(input.term);

      // Shared cache first — every later reader of this term is free, which is
      // what keeps both the Datamuse quota and AI cost flat. An already-enriched
      // row returns straight out of enrichOnce, so the warm path stays a single
      // read; a row cached before enrichment existed picks it up here.
      const cached = await db.query.dictionaryEntry.findFirst({
        where: eq(dictionaryEntry.term, normalizedTerm),
      });
      if (cached) return enrichOnce(cached);
      if (unknownTerms.has(normalizedTerm)) return null;

      let pending = inFlight.get(normalizedTerm);
      if (!pending) {
        pending = resolveNewTerm(normalizedTerm).finally(() => inFlight.delete(normalizedTerm));
        inFlight.set(normalizedTerm, pending);
      }
      return pending;
    }),
});
