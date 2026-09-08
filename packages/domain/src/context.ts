/**
 * Usage contexts, and the cloze card built from one.
 *
 * A context is one invented sentence showing a term in use, stored with the
 * term itself wrapped in braces:
 *
 *   "The house had an {eldritch} stillness about it."
 *
 * The braces are the whole trick. They let one stored string serve both
 * features without either side guessing where the word is:
 *
 *   the word view   →  sentence  "The house had an eldritch stillness about it."
 *   a quiz card     →  prompt    "The house had an ______ stillness about it."
 *                      answer    "eldritch"
 *
 * Marking beats searching for the term at read time, because the sentence
 * rarely contains the term as it was captured: a context for "run" may well
 * say "running", and one for "sietch" may capitalise it at the start of a
 * sentence. A search would blank the wrong span, or none at all. The marked
 * span also gives the reveal the inflected form the reader should have
 * guessed, rather than the dictionary headword.
 *
 * This lives in the dependency-free package for the same reason
 * {@link normalizeTerm} does: `packages/api` builds quiz cards with it,
 * `apps/native` renders context panels with it, and `packages/api/src/enrich.ts`
 * validates model output with it. Three callers, one definition of the format
 * — a drift between them would put the blank in the wrong place, or reject
 * contexts that are fine.
 */

/** What a blanked-out word looks like on a quiz card. */
export const CONTEXT_BLANK = "______";

export type ParsedContext = {
  /** The sentence as prose, braces removed — what a context panel shows. */
  sentence: string;
  /** The word as it appears in the sentence, inflection and casing intact. */
  answer: string;
  /** The sentence with the answer replaced by {@link CONTEXT_BLANK}. */
  prompt: string;
};

// One brace pair, with at least one non-brace character inside. Nested or
// unbalanced braces fail to match, which is what makes malformed model output
// fall out rather than render a half-blanked sentence.
const MARKED_SPAN = /^([^{}]*)\{([^{}]+)\}([^{}]*)$/;

/**
 * Reads one stored context. Returns null when the string isn't a well-formed
 * context — no braces, more than one span, an empty span, or nothing but the
 * marked word.
 *
 * Null is a normal outcome, not an error: it is how a model that ignored the
 * format gets dropped at the door instead of reaching a reader as a sentence
 * with no blank in it (or, worse, a quiz card whose answer is already visible).
 */
export function parseContext(raw: string): ParsedContext | null {
  const match = MARKED_SPAN.exec(raw.trim());
  if (!match) return null;

  const [, before, marked, after] = match;
  const answer = marked!.trim();
  if (!answer) return null;

  // A context has to be a sentence *around* the word. "{eldritch}" on its own
  // is a card whose prompt is a bare blank with nothing to reason from.
  if (!before!.trim() && !after!.trim()) return null;

  return {
    sentence: `${before}${answer}${after}`.trim(),
    answer,
    prompt: `${before}${CONTEXT_BLANK}${after}`.trim(),
  };
}

/** Whether a string is a context this codebase will accept and can render. */
export function isValidContext(raw: string): boolean {
  return parseContext(raw) !== null;
}
