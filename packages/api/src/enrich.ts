import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "@better-vocab/env/server";
import { z } from "zod";

/**
 * The one place an AI provider is called (SoftwareSpec §8.4: "provider is
 * swappable behind a single server-side function"). Everything else asks for
 * an enrichment and gets a plain object back, so changing model or vendor
 * touches this file and nothing else — including no client code, since the
 * Expo app never talks to a provider directly (§8.1).
 *
 * Enrichment is keyed by TERM, on the shared `dictionary_entry` row — never
 * per user. That is the whole cost model: one unique word costs at most one
 * call across the entire user base, forever (§8.3, §10). The caller owns that
 * guarantee; see the claim in routers/dictionary.ts.
 */

// A small/fast tier on purpose (§8.4): an example sentence and a register note
// are not frontier-reasoning work, and this runs once per unique word across
// every reader.
const ENRICHMENT_MODEL = "claude-haiku-4-5";

// Enrichment happens inside a lookup the reader is waiting on, so it gets a
// tighter leash than the SDK's 10-minute default. Timing out is a non-event:
// the base definition is already resolved and the term simply stays
// un-enriched until someone looks it up again.
const ENRICHMENT_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = [
  "You add usage context to a dictionary definition for a vocabulary app used by readers.",
  "",
  "exampleSentence: one natural sentence, at most 25 words, using the word in the sense given.",
  "Invent a neutral everyday sentence. Never quote or paraphrase a book, and never reference a",
  "plot, character, or setting — readers log words mid-book and a borrowed sentence can spoil it.",
  "",
  "usageNote: at most 15 words on register or frequency, e.g. \"Mostly literary; rare in speech.\"",
  "Say something a learner could not read off the definition itself.",
].join("\n");

// Deliberately two plain strings: this is the exact shape of the two nullable
// columns on dictionary_entry, so there is nothing to map on the way in.
const enrichmentSchema = z.object({
  exampleSentence: z.string(),
  usageNote: z.string(),
});

export type Enrichment = z.infer<typeof enrichmentSchema>;

// Built once, but only if there is a key — the app must boot and resolve
// definitions without one, exactly like HARDCOVER_API_TOKEN.
let client: Anthropic | null = null;
function provider() {
  if (!env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: ENRICHMENT_TIMEOUT_MS,
    // One retry, not the SDK's two: the caller is holding a request open.
    maxRetries: 1,
  });
  return client;
}

/**
 * Generates an example sentence and a usage note for an already-resolved
 * definition.
 *
 * Returns null for every failure — no key configured, provider down, refusal,
 * a response that doesn't fit the schema, or a field that came back blank.
 * Enrichment is strictly an upgrade on top of a definition the caller already
 * has, so it must never turn a working lookup into a failed one.
 */
export async function enrichDefinition(term: string, definition: string): Promise<Enrichment | null> {
  const anthropic = provider();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.parse({
      model: ENRICHMENT_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Word: ${term}\nDefinition: ${definition}` }],
      // Structured output rather than free-form text, so the response is
      // validated against the schema instead of parsed out of prose (§8.4).
      output_config: { format: zodOutputFormat(enrichmentSchema) },
    });

    // parsed_output is null when the model refused or the output didn't
    // validate; both mean "no enrichment", not an error to propagate.
    const parsed = response.parsed_output;
    if (!parsed) return null;

    const exampleSentence = parsed.exampleSentence.trim();
    const usageNote = parsed.usageNote.trim();
    // A blank field would occupy the column and make the row look enriched,
    // which is worse than staying null.
    if (!exampleSentence || !usageNote) return null;

    return { exampleSentence, usageNote };
  } catch (error) {
    console.warn(`[enrich] ${term}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
