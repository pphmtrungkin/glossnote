import type { TopicWordGroup } from "@better-vocab/db/schema/book";
import { isValidContext, normalizeTerm, parseContext } from "@better-vocab/domain";
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
  'usageNote: at most 15 words on register or frequency, e.g. "Mostly literary; rare in speech."',
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
export async function enrichDefinition(
  term: string,
  definition: string,
): Promise<Enrichment | null> {
  const object = await generate(
    term,
    enrichmentSchema,
    ENRICH_PROMPT,
    `Word: ${term}\nDefinition: ${definition}`,
  );
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

const TOPIC_COUNT = 3;
const WORDS_PER_TOPIC = 6;

const TOPICS_PROMPT = [
  "You pick vocabulary for a reading app. Given a book, name the subject areas its world and themes draw on,",
  "and for each give words worth knowing for someone reading it.",
  "",
  `topics: ${TOPIC_COUNT} subject areas, each a short plain label of at most 4 words, e.g. "Desert ecology",`,
  '"Regency manners", "Court politics".',
  `words: ${WORDS_PER_TOPIC} single English words per topic, found in any ordinary dictionary, lowercase, no phrases.`,
  "Pick words a curious adult reader may not know yet; skip everyday words like sand or king.",
  "",
  "Never give names, places, or words invented for this book or its franchise, and never draw on its plot,",
  "characters or ending: readers see these mid-book, and a word from the story can spoil it.",
].join("\n");

const topicsSchema = z.object({
  topics: z.array(z.object({ topic: z.string(), words: z.array(z.string()) })),
});

/**
 * Subject areas a book draws on, each with words worth learning — the add-word
 * form's AI suggestions, next to other readers' saved words.
 *
 * Returns null for any failure, like everything here. The words are only a
 * model's suggestion: the caller checks each against Datamuse before a reader
 * sees it, because the prompt alone does not keep invented words out (see
 * resolveNewTerm in routers/dictionary.ts).
 */
export async function suggestTopicWords(book: {
  title: string;
  authors: string[];
  description: string | null;
}): Promise<TopicWordGroup[] | null> {
  const prompt = [
    `Title: ${book.title}`,
    book.authors.length ? `Author: ${book.authors.join(", ")}` : null,
    book.description ? `Description: ${book.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const object = await generate(book.title, topicsSchema, TOPICS_PROMPT, prompt);
  if (!object) return null;

  const topics = object.topics
    .map(({ topic, words }) => ({
      topic: topic.trim(),
      // One plain word each: the Datamuse check and every term join match on
      // the normalized form, and a phrase would match neither.
      terms: [
        ...new Set(
          words.map((w) => normalizeTerm(w)).filter((w) => /^[a-z]+(?:-[a-z]+)?$/.test(w)),
        ),
      ],
    }))
    .filter((entry) => entry.topic && entry.terms.length > 0);

  return topics.length > 0 ? topics : null;
}

/** At most this many phrases are picked out of a passage. */
const NOTE_COUNT = 4;

const EXPLAIN_PROMPT = [
  "You help a reader who understands every word of a passage but not what it is saying. The obstacle is",
  "almost never vocabulary — it is metaphor, allusion, irony, understatement, or a phrase borrowed from",
  "one register and dropped into another.",
  "",
  "plain: what the passage actually says, in one or two plain sentences. Strip the figures of speech and",
  "state the point directly, as you would to someone who asked what the author was getting at. Never",
  'open with a formula ("This passage means...", "The author is saying...") — just say it.',
  "",
  `notes: up to ${NOTE_COUNT} phrases from the passage that carry the difficulty, each with an`,
  "explanation of at most 30 words. Quote each phrase exactly as it appears, and pick the SHORT phrase",
  "that does the work, not the whole clause around it.",
  "",
  "Be thorough here — this is the part the reader came for, and a passage worth asking about usually has",
  "two or three of these, not one. Work through the passage looking for each of:",
  "  - an allusion: name what it refers to and what the reference brings with it;",
  "  - a metaphor or comparison: say what maps onto what;",
  "  - irony, overstatement or a joke: say where the humour sits, because a deadpan line read straight",
  "    means the opposite of what it says;",
  "  - a word from one world used about another (a modern, commercial or journalistic idiom applied to",
  "    something ancient or grave, or the reverse): say what the mismatch is doing.",
  "Skip only what a reader would take at first glance. Do not pad, but do not stop at the first one.",
  "",
  "Explain only what is on the page in front of you. Never say what the passage foreshadows, never draw",
  "on what happens later in the book, and never mention a character, event or ending the passage does",
  "not itself name: the reader is in the middle of the book and is trusting you not to get ahead of them.",
  "Identifying an allusion to something outside the book — scripture, myth, history, another author —",
  "is exactly the job and is not a spoiler.",
  "",
  "If the passage is genuinely plain — it states its meaning outright, with no figure of speech, allusion",
  "or irony anywhere in it — return an empty string for plain and an empty notes list. Do not echo the",
  "passage back as its own paraphrase, and do not invent difficulty that is not there.",
].join("\n");

/** Case, punctuation and spacing dropped, for comparing prose to prose. */
function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const explanationSchema = z.object({
  plain: z.string(),
  notes: z.array(z.object({ phrase: z.string(), gloss: z.string() })),
});

/** A passage explained: the paraphrase, plus the phrases that made it hard. */
export type PassageExplanation = {
  plain: string;
  notes: { phrase: string; gloss: string }[];
};

/**
 * Explains a passage a reader is stuck on — the other half of "I'm stuck",
 * beside the word lookup above.
 *
 * This one breaks the pattern the rest of this file holds to, and the break is
 * deliberate. Everything else is keyed by TERM on a shared row, so one unique
 * word costs one call across every reader, forever. A passage has no term to
 * key on, and the text belongs to the book rather than to the app — so the
 * answer is NOT cached server-side and NOT shared between readers. The caller
 * keeps it on the reader's own device (apps/native/lib/passage.ts). That makes
 * this the one call here whose cost scales with use rather than with the
 * vocabulary, which is why the caller rate-limits it and why the passage is
 * capped above.
 *
 * `book` is title and author only, never the description: it is here so the
 * model can place an allusion's register, and the plot is exactly what must
 * not reach it. Returns null for every failure, like everything else here.
 */
export async function explainPassage(
  passage: string,
  book: { title: string; authors: string[] } | null,
): Promise<PassageExplanation | null> {
  const prompt = [
    book ? `The reader is reading: ${book.title}` : null,
    book?.authors.length ? `By: ${book.authors.join(", ")}` : null,
    "",
    "Passage:",
    passage,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const object = await generate(passage.slice(0, 40), explanationSchema, EXPLAIN_PROMPT, prompt);
  if (!object) return null;

  // Nothing to say is a real answer — the caller renders it as "this reads
  // plainly" rather than as a failure, which a null would become.
  const notes = object.notes
    .map((note) => ({ phrase: note.phrase.trim(), gloss: note.gloss.trim() }))
    .filter((note) => note.phrase && note.gloss)
    .slice(0, NOTE_COUNT);

  // Asking for an empty `plain` on a passage that needs no explaining does not
  // work: measured on Gemini 2.5 Flash-Lite, "The cat sat on the mat and went
  // to sleep." comes back with the same sentence as its own paraphrase however
  // the instruction is worded, because the field's main instruction pulls the
  // other way. So the gate is here, not in the prompt — the same reason the
  // entry schema carries no `known: boolean` and Datamuse rather than the
  // model decides whether a word is real. An echo with nothing picked out of
  // it is the model saying there was nothing to pick.
  const plain = object.plain.trim();
  const isEcho = notes.length === 0 && flatten(plain) === flatten(passage);

  return { plain: isEcho ? "" : plain, notes };
}
