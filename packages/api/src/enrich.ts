import { isValidContext, parseContext } from "@better-vocab/domain";
import { env } from "@better-vocab/env/server";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * The one place a model is called (SoftwareSpec §8.4: "provider is swappable
 * behind a single server-side function"). Everything else asks for an entry or
 * an enrichment and gets a plain object back, so changing model or vendor
 * touches this file and nothing else — including no client code, since the
 * Expo app never talks to a provider directly (§8.1).
 *
 * Requests go through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway),
 * which is what makes "swappable" real rather than aspirational: the model is a
 * `provider/model` string, so moving off Anthropic is a one-line edit and no new
 * SDK, key, or account. One key covers every provider in the catalog, and the
 * gateway retries another provider when one is failing.
 *
 * Everything here is keyed by TERM, on the shared `dictionary_entry` row — never
 * per user. That is the whole cost model: one unique word costs at most one call
 * across the entire user base, forever (§8.3, §10). The caller owns that
 * guarantee; see routers/dictionary.ts.
 */

// A small/fast tier on purpose (§8.4): a one-sentence definition, an example
// sentence and a register note are not frontier-reasoning work, and this runs
// once per unique word across every reader. Chosen from a live run of 14 cheap
// gateway models (2026-09-13): Gemini 2.5 Flash-Lite answered in ~1.3s for
// ~$0.08 per 1,000 new words. Correctness decided it, not price alone — several
// cheaper models defined "sietch" and "gom jabbar" from Dune, which is a
// spoiler, and GLM 4.7 FlashX (the previous model) timed out or broke the
// schema on 3 of 5 words at ~$0.35 per 1,000.
//
// Gateway slugs are `provider/model` and must match the catalog exactly —
// `GET https://ai-gateway.vercel.sh/v1/models` lists them, no auth required,
// which is also how to check a replacement before pasting it here. Check the
// model's `supported_parameters` while you're there: this call needs `tools`
// (how the AI SDK asks a non-OpenAI model for a schema-shaped answer).
const ENRICHMENT_MODEL = "google/gemini-2.5-flash-lite";

// Every call happens inside a lookup the reader is waiting on, so it gets a
// tighter leash than the SDK's default. Timing out is a non-event: a new term
// falls back to Datamuse, and an existing one keeps the definition it has.
const ENRICHMENT_TIMEOUT_MS = 15_000;

/** How many contexts to ask for. Three fills a panel and a short quiz run. */
const CONTEXT_COUNT = 3;

// Shared by both prompts, so a defined term and an enriched one get contexts
// written to the same rules.
const CONTEXT_RULES = [
  `contexts: exactly ${CONTEXT_COUNT} sentences, each at most 25 words, showing the word in the sense defined.`,
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
];

const ENRICH_PROMPT = [
  "You add usage context to a dictionary definition for a vocabulary app used by readers.",
  "",
  ...CONTEXT_RULES,
].join("\n");

const DEFINE_PROMPT = [
  "You write the dictionary entry for a word in a vocabulary app used by readers — the short answer a",
  "search engine shows above its results.",
  "",
  "definition: the word's most common sense in general English, in one plain sentence of at most 30",
  "words. No part-of-speech label, no quotation marks, and do not use the word itself.",
  "",
  "Only if the word is not used in general English at all — a name, a misspelling, or a word invented for",
  "one book or franchise — return an empty definition, no contexts and an empty usageNote. Never define a",
  "word from how one book uses it: readers look words up mid-book, and that can spoil it.",
  "",
  ...CONTEXT_RULES,
].join("\n");

// What the model is asked for. `exampleSentence` is deliberately absent: it is
// derived from the first context below rather than generated separately, so
// there is one artifact to get right instead of two that can disagree.
const enrichmentSchema = z.object({
  contexts: z.array(z.string()),
  usageNote: z.string(),
});

// No `known: boolean` flag. Measured, GLM answered `known: false` for
// "ephemeral"; an empty definition is the signal instead, which is much harder
// for a cheap model to get backwards.
const entrySchema = enrichmentSchema.extend({ definition: z.string() });

/** What gets written to the shared row — the exact shape of its columns. */
export type Enrichment = {
  contexts: string[];
  exampleSentence: string;
  usageNote: string;
};

/** A whole new row's worth of AI output: the definition and its enrichment. */
export type DefinedTerm = Enrichment & { definition: string };

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
 * One structured call, or null for every failure — no key configured, gateway
 * or provider down, a refusal, or output that doesn't fit the schema.
 */
async function generate<T extends z.ZodType>(
  term: string,
  schema: T,
  system: string,
  prompt: string,
): Promise<z.infer<T> | null> {
  // The AI SDK reads AI_GATEWAY_API_KEY from the environment itself; this check
  // is what keeps AI *optional*, so the app boots and resolves definitions
  // without a key exactly as it does without HARDCOVER_API_TOKEN.
  if (!env.AI_GATEWAY_API_KEY) return null;

  try {
    // Structured output rather than free-form text, so the response is
    // validated against the schema instead of parsed out of prose (§8.4).
    // generateObject picks whichever mechanism the routed model supports,
    // which is the other half of keeping the model swappable.
    const { object } = await generateObject({
      model: ENRICHMENT_MODEL,
      schema,
      system,
      prompt,
      // The first answer for a term is saved for every reader, so a model that
      // answers the same word two ways is a coin toss on a permanent row.
      // Measured on Gemini 2.5 Flash-Lite at its default temperature: "sietch",
      // "dementor" and "mellon" each came back blank once and defined once.
      temperature: 0,
      // Filling a few short fields is not a reasoning task, and output tokens
      // are the expensive half of the bill. Treat this as a request, not a
      // guarantee: GLM, the previous model, still spent 250 reasoning tokens
      // with it set. And check a replacement with one live call, because some
      // providers reject it outright — OpenAI's gpt-5-nano answers every
      // request with a 400.
      reasoning: "none",
      // See unwrapWrappedObject: the SDK calls this only once validation has
      // already failed, which for this model is usually a wrapped answer.
      repairText: async ({ text }) => unwrapWrappedObject(text),
      abortSignal: AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS),
      // One retry, not the SDK's two: the caller is holding a request open.
      maxRetries: 1,
    });
    return object as z.infer<T>;
  } catch (error) {
    // Covers the whole surface: a schema the model couldn't satisfy, a 402 from
    // a spent budget, a 429, the timeout above, or the gateway being down.
    console.warn(`[enrich] ${term}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Validates the context and note fields both calls return, or null. */
function toEnrichment(object: z.infer<typeof enrichmentSchema>): Enrichment | null {
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
}

/**
 * Generates an example sentence and a usage note for an already-resolved
 * definition.
 *
 * Returns null for every failure, including a field that came back blank.
 * Enrichment is strictly an upgrade on top of a definition the caller already
 * has, so it must never turn a working lookup into a failed one.
 */
export async function enrichDefinition(term: string, definition: string): Promise<Enrichment | null> {
  const object = await generate(term, enrichmentSchema, ENRICH_PROMPT, `Word: ${term}\nDefinition: ${definition}`);
  return object && toEnrichment(object);
}

/**
 * Writes a term's whole entry — definition, contexts and usage note — in one
 * call, the way a search engine answers "define X".
 *
 * `"unknown"` means the model left the definition blank: not a general English
 * word, but a name or a word invented for a book. It is deliberately not
 * defined from the book, which could spoil it — though the prompt is not the
 * only guard; see resolveNewTerm in routers/dictionary.ts. `null` means the
 * call failed or came back incomplete, and the caller saves Datamuse's
 * definition instead, so AI stays optional.
 */
export async function defineTerm(term: string): Promise<DefinedTerm | "unknown" | null> {
  const object = await generate(term, entrySchema, DEFINE_PROMPT, `Word: ${term}`);
  if (!object) return null;

  const definition = object.definition.trim();
  if (!definition) return "unknown";

  const enrichment = toEnrichment(object);
  // All or nothing: the row is inserted already enriched, so a missing half
  // would never be filled in later.
  if (!enrichment) return null;

  return { definition, ...enrichment };
}
