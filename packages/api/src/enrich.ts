import { isValidContext, parseContext } from "@better-vocab/domain";
import { env } from "@better-vocab/env/server";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * The one place a model is called (SoftwareSpec §8.4: "provider is swappable
 * behind a single server-side function"). Everything else asks for an
 * enrichment and gets a plain object back, so changing model or vendor touches
 * this file and nothing else — including no client code, since the Expo app
 * never talks to a provider directly (§8.1).
 *
 * Requests go through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway),
 * which is what makes "swappable" real rather than aspirational: the model is a
 * `provider/model` string, so moving off Anthropic is a one-line edit and no new
 * SDK, key, or account. One key covers every provider in the catalog, and the
 * gateway retries another provider when one is failing.
 *
 * Enrichment is keyed by TERM, on the shared `dictionary_entry` row — never per
 * user. That is the whole cost model: one unique word costs at most one call
 * across the entire user base, forever (§8.3, §10). The caller owns that
 * guarantee; see the claim in routers/dictionary.ts.
 */

// A small/fast tier on purpose (§8.4): an example sentence and a register note
// are not frontier-reasoning work, and this runs once per unique word across
// every reader. GLM 4.7 FlashX is ~$0.06/$0.40 per million tokens against
// Claude Haiku's $1/$5 — an order of magnitude cheaper for a task where the
// two are hard to tell apart.
//
// Gateway slugs are `provider/model` and must match the catalog exactly —
// `GET https://ai-gateway.vercel.sh/v1/models` lists them, no auth required,
// which is also how to check a replacement before pasting it here. Check the
// model's `supported_parameters` while you're there: this call needs `tools`
// (how the AI SDK asks a non-OpenAI model for a schema-shaped answer).
const ENRICHMENT_MODEL = "zai/glm-4.7-flashx";

// Enrichment happens inside a lookup the reader is waiting on, so it gets a
// tighter leash than the SDK's default. Timing out is a non-event: the base
// definition is already resolved and the term simply stays un-enriched until
// someone looks it up again.
const ENRICHMENT_TIMEOUT_MS = 15_000;

/** How many contexts to ask for. Three fills a panel and a short quiz run. */
const CONTEXT_COUNT = 3;

const SYSTEM_PROMPT = [
  "You add usage context to a dictionary definition for a vocabulary app used by readers.",
  "",
  `contexts: exactly ${CONTEXT_COUNT} sentences, each at most 25 words, showing the word in the sense given.`,
  "Wrap the word itself in braces wherever it appears: The house had an {eldritch} stillness about it.",
  "Mark it exactly once per sentence, and inflect it naturally — {running}, {sietches} — rather than",
  "forcing the dictionary form. Put the braces around the word only, never around the whole phrase.",
  "",
  "Each sentence must give a reader enough around the word to infer its meaning without being told:",
  "these are used as fill-in-the-blank cards, so a sentence that still makes sense with any word in",
  "the gap is a wasted card. Vary them — different subjects, and different registers or senses where",
  "the word has more than one.",
  "",
  "Invent every sentence. Never quote or paraphrase a book, and never reference a plot, character, or",
  "setting — readers log words mid-book and a borrowed sentence can spoil it.",
  "",
  "usageNote: at most 15 words on register or frequency, e.g. \"Mostly literary; rare in speech.\"",
  "Say something a learner could not read off the definition itself.",
].join("\n");

// What the model is asked for. `exampleSentence` is deliberately absent: it is
// derived from the first context below rather than generated separately, so
// there is one artifact to get right instead of two that can disagree.
const enrichmentSchema = z.object({
  contexts: z.array(z.string()),
  usageNote: z.string(),
});

/** What gets written to the shared row — the exact shape of its columns. */
export type Enrichment = {
  contexts: string[];
  exampleSentence: string;
  usageNote: string;
};

/**
 * Unwraps a model answer that arrived one level too deep.
 *
 * Cheap models wrap: GLM returns `{"answer": {contexts, usageNote}}` on
 * roughly half of calls — the right fields, nested — which fails schema
 * validation and would leave the term un-enriched for no good reason. This runs
 * only after parsing or validation has already failed, so it costs nothing on
 * the happy path.
 *
 * One key holding one object is a wrapper. Anything else is a shape we don't
 * recognise, and guessing at it would risk filing something odd in a table
 * every reader shares — so it returns null and the enrichment is simply
 * skipped. Exported (like `pickDefinition`) so `db:smoke` can assert it without
 * spending a call.
 */
export function unwrapWrappedObject(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const values = Object.values(parsed as Record<string, unknown>);
  const [wrapped] = values;
  if (values.length !== 1 || !wrapped || typeof wrapped !== "object" || Array.isArray(wrapped)) {
    return null;
  }
  return JSON.stringify(wrapped);
}

/**
 * Generates an example sentence and a usage note for an already-resolved
 * definition.
 *
 * Returns null for every failure — no key configured, gateway or provider down,
 * a refusal, output that doesn't fit the schema, or a field that came back
 * blank. Enrichment is strictly an upgrade on top of a definition the caller
 * already has, so it must never turn a working lookup into a failed one.
 */
export async function enrichDefinition(term: string, definition: string): Promise<Enrichment | null> {
  // The AI SDK reads AI_GATEWAY_API_KEY from the environment itself; this check
  // is what keeps enrichment *optional*, so the app boots and resolves
  // definitions without a key exactly as it does without HARDCOVER_API_TOKEN.
  if (!env.AI_GATEWAY_API_KEY) return null;

  try {
    // Structured output rather than free-form text, so the response is
    // validated against the schema instead of parsed out of prose (§8.4).
    // generateObject picks whichever mechanism the routed model supports,
    // which is the other half of keeping the model swappable.
    const { object } = await generateObject({
      model: ENRICHMENT_MODEL,
      schema: enrichmentSchema,
      system: SYSTEM_PROMPT,
      prompt: `Word: ${term}\nDefinition: ${definition}`,
      // Filling two short fields from a definition it was handed is not a
      // reasoning task, and output tokens are the expensive half of this
      // model's bill. Treat this as a request, not a guarantee: measured, GLM
      // still spent 250 reasoning tokens with it set. It costs nothing to ask,
      // and a model swapped in later may honour it.
      reasoning: "none",
      // See unwrapWrappedObject: the SDK calls this only once validation has
      // already failed, which for this model is usually a wrapped answer.
      repairText: async ({ text }) => unwrapWrappedObject(text),
      abortSignal: AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS),
      // One retry, not the SDK's two: the caller is holding a request open.
      maxRetries: 1,
    });

    const usageNote = object.usageNote.trim();

    // Contexts that ignored the brace format are dropped rather than repaired:
    // a sentence with no marked span has no blank to make, and one this code
    // guessed at would blank the wrong word. Partial output is still worth
    // keeping — two good contexts beat discarding the call over a third.
    const contexts = object.contexts.map((line) => line.trim()).filter(isValidContext);

    // A blank field would occupy the column and make the row look enriched,
    // which is worse than staying null. No usable context means no quiz card
    // and no panel, so there is nothing here worth writing.
    if (!usageNote || contexts.length === 0) return null;

    // The plain-prose form of the first context. Same sentence the panel would
    // show, minus the braces — which is exactly what this column has always
    // meant, and now costs no extra generation.
    const exampleSentence = parseContext(contexts[0]!)!.sentence;

    return { contexts, exampleSentence, usageNote };
  } catch (error) {
    // Covers the whole surface: a schema the model couldn't satisfy, a 402 from
    // a spent budget, a 429, the timeout above, or the gateway being down.
    console.warn(`[enrich] ${term}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
