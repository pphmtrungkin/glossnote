/**
 * The match key.
 *
 * Every join between a captured word and a definition — the shared
 * `dictionary_entry` table on the server, the `dictionary` table on the
 * device, and the crowdsourced aggregate that groups by `normalized_term` —
 * matches on the output of this function and nothing else.
 *
 * It lives here, in a package with no dependencies, because all four callers
 * must agree and two of them cannot import `@better-vocab/db` (a React Native
 * bundle must not pull in Postgres drivers):
 *
 *   - packages/api/src/routers/word.ts        capture
 *   - packages/api/src/routers/dictionary.ts  server-side resolution
 *   - apps/native/lib/dictionary.ts           on-device resolution
 *   - apps/native/scripts/build-dictionary-db.ts   the bundled asset
 *
 * That last one is why this is a module and not a convention. It stamps the
 * shipped `.db` at build time; if it ever normalized differently from the
 * runtime lookups, every offline lookup would miss and nothing would raise an
 * error — the app would just quietly stop finding words.
 */

declare const normalized: unique symbol;

/**
 * A term that has been through {@link normalizeTerm}. Structurally a string,
 * so it passes straight into Drizzle and SQLite bindings, but a raw string
 * will not satisfy a parameter that asks for one.
 */
export type NormalizedTerm = string & { readonly [normalized]: true };

/** Trim surrounding whitespace, fold to lower case. Nothing else. */
export function normalizeTerm(raw: string): NormalizedTerm {
  return raw.trim().toLowerCase() as NormalizedTerm;
}
