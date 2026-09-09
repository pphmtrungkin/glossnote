/**
 * Where a saved word sits in the reader's rotation.
 *
 * Derived from the two columns `word.update` already writes rather than stored
 * as a third — the folder, search and word screens all label a row with it, so
 * the derivation lives in one place instead of three.
 *
 * Timestamps arrive as strings: the tRPC client has no date transformer, so
 * what the server typed as `Date` is JSON by the time a screen reads it.
 */
export type Mastery = "new" | "learning" | "steady";

export function masteryOf(word: {
  mastered: boolean;
  lastReviewedAt: string | Date | null;
}): Mastery {
  if (word.mastered) return "steady";
  if (word.lastReviewedAt) return "learning";
  return "new";
}

/**
 * The mastery colour, as a className.
 *
 * `new` is deliberately grey and `learning` carries the accent — an unpractised
 * word shouldn't shout, and the accent marks what the reader is working on.
 */
export const MASTERY_CLASS: Record<Mastery, string> = {
  new: "text-state-new",
  learning: "text-state-learning",
  steady: "text-state-steady",
};
