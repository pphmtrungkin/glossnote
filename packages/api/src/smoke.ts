/**
 * Smoke test for the database + router layer.
 *
 *   bun run db:seed && bun run db:smoke     (from the repo root)
 *
 * Drives the real appRouter against the seeded local Postgres, asserting the
 * things the schema — not the TypeScript — is responsible for: relation joins,
 * ownership scoping, the partial unique index on (user_id, book_id), capture
 * idempotency, cascade deletes, and the live crowdsourced aggregate query that
 * replaced the old book_word_aggregate counter table.
 *
 * Self-cleaning and re-runnable: it deletes every row it creates and asserts
 * the seed is back to its original shape, so it can run repeatedly without a
 * reseed. It still refuses nothing on its own — only ever point DATABASE_URL
 * at a local database, same rule as seed.ts.
 */
import assert from "node:assert/strict";
import { book } from "@better-vocab/db/schema/book";
import { mapSearchResults } from "./routers/book";
import { appRouter } from "./routers/index";
import { db } from "@better-vocab/db";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { folder } from "@better-vocab/db/schema/book";
import { word } from "@better-vocab/db/schema/word";
import { and, eq, notLike, sql } from "drizzle-orm";

const USER_ID = "seed_user_reader";
const caller = (userId: string) =>
  appRouter.createCaller({ auth: null, session: { user: { id: userId } } } as never);
const api = caller(USER_ID);

const pass: string[] = [];
const ok = (name: string) => pass.push(name);

// Drizzle wraps driver errors, so the Postgres constraint name lives on
// `cause`, not on the top-level message — walk the chain before matching.
async function rejectsWith(fn: () => Promise<unknown>, pattern: RegExp, why: string) {
  try {
    await fn();
  } catch (error) {
    let chain = "";
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) chain += `${e}`;
    assert.match(chain, pattern, why);
    return;
  }
  assert.fail(`expected a rejection: ${why}`);
}

// A previous run that failed mid-way can leave folders behind, and every
// assertion below counts rows. Clear anything this script created before
// starting — `seed_%` ids are the seed's, everything else is ours.
await db.delete(folder).where(and(eq(folder.userId, USER_ID), notLike(folder.id, "seed_%")));
await db.delete(book).where(eq(book.provider, "hardcover"));

// ---- reads over the seeded state ----------------------------------------
const folders = await api.folder.list();
assert.equal(folders.length, 3, "seed creates 3 folders");
assert.equal(folders.filter((f) => f.book).length, 2, "2 book-linked folders join a book row");
assert.equal(folders.find((f) => f.id === "seed_folder_misc")!.book, null, "freeform folder has no book");
ok("folder.list joins book, freeform stays null");

const dune = await api.word.listByFolder({ folderId: "seed_folder_dune" });
assert.equal(dune.length, 3);
assert.equal(dune.find((w) => w.term === "sietch")!.dictionaryEntry!.definition, "A Fremen cave community; a place of refuge.");
assert.equal(dune.find((w) => w.term === "gom jabbar")!.dictionaryEntry, null, "pending-definition word has no entry");
ok("word.listByFolder joins dictionary_entry, renders pending state");

assert.equal((await api.word.search({ query: "presc" })).length, 1);
assert.equal((await api.word.search({ query: "zzz" })).length, 0);
ok("word.search matches partial term");

// ---- ownership boundary --------------------------------------------------
assert.equal(
  (await caller("someone_else").word.listByFolder({ folderId: "seed_folder_dune" })).length,
  0,
  "listByFolder must scope to the caller, not just the folder",
);
await rejectsWith(
  () => caller("someone_else").word.create({ folderId: "seed_folder_dune", term: "trespass", captureMethod: "manual" }),
  /Folder not found/,
  "writing into someone else's folder must 404",
);
ok("another user cannot read or write into this user's folder");

// ---- unlimited freeform folders ------------------------------------------
// The one-folder-per-book half of that index is exercised in the Hardcover
// section below, where a book id actually exists to collide on.
const free1 = await api.folder.create({ title: "Scratch A", status: "misc" });
const free2 = await api.folder.create({ title: "Scratch B", status: "misc" });
assert.equal(free1.bookId, null, "a folder created without a book stays freeform");
ok("freeform folders are unlimited and carry no bookId");

// ---- create: idempotency + shared dictionary_entry -----------------------
const again = await api.word.create({ folderId: "seed_folder_dune", term: "Sietch", captureMethod: "manual" });
assert.equal(again!.id, "seed_word_sietch", "re-capturing a term returns the existing row, not a duplicate");
assert.equal((await api.word.listByFolder({ folderId: "seed_folder_dune" })).length, 3);
ok("word.create is idempotent per (folder, normalized term)");

const created = await api.word.create({
  folderId: free1.id,
  term: "  Petrichor ",
  definition: "The smell of rain on dry earth.",
  exampleSentence: "Petrichor rose off the pavement after the storm.",
  captureMethod: "voice",
});
assert.equal(created!.normalizedTerm, "petrichor", "term is trimmed + lowercased into the match key");
assert.equal(created!.term, "  Petrichor ", "display form is preserved verbatim");
assert.equal(created!.bookId, null, "freeform folder cannot feed the aggregate");
const entry = (await api.word.listByFolder({ folderId: free1.id }))[0].dictionaryEntry!;
assert.equal(entry.term, "petrichor", "dictionary_entry is keyed by the normalized term");
assert.equal(entry.exampleSentence, "Petrichor rose off the pavement after the storm.");
ok("example sentence lands on the shared dictionary_entry, not on the word");

// second user capturing the same term reuses that one entry (the AI-cost rule)
const shared = await api.word.create({ folderId: free2.id, term: "petrichor", definition: "ignored", captureMethod: "manual" });
assert.equal(shared!.dictionaryEntryId, created!.dictionaryEntryId, "same term must never create a second entry");
ok("a term is only ever resolved once, globally");

// ---- Hardcover search mapping -------------------------------------------
// A trimmed real Typesense payload. `image` is deliberately absent from the
// second hit: it is NOT in Hardcover's documented book field list, so a cover
// must never be assumed present.
const mapped = mapSearchResults({
  found: 2,
  hits: [
    {
      document: {
        id: 32897,
        title: "Dune",
        author_names: ["Frank Herbert"],
        image: { url: "https://assets.hardcover.app/dune.jpg", color: "orange" },
        release_year: 1965,
        users_count: 41231,
      },
    },
    { document: { id: "1913699", title: "Pale Fire", author_names: [] } },
  ],
});
assert.equal(mapped.length, 2);
assert.deepEqual(mapped[0], {
  externalId: "32897",
  title: "Dune",
  authors: ["Frank Herbert"],
  coverImageUrl: "https://assets.hardcover.app/dune.jpg",
  description: null,
  releaseYear: 1965,
});
assert.equal(mapped[1].coverImageUrl, null, "a hit with no image maps to a null cover, not a crash");
assert.equal(mapped[1].externalId, "1913699", "numeric and string ids both normalize to string");
assert.deepEqual(mapSearchResults({ found: 0, hits: [] }), [], "no matches is an empty list");
assert.throws(() => mapSearchResults({ unexpected: true }), /Unexpected search response/);
ok("search results map from Typesense hits, tolerating a missing cover");

// ---- linking a book to a new folder --------------------------------------
const hit = {
  externalId: "32897",
  title: "Dune",
  authors: ["Frank Herbert"],
  coverImageUrl: "https://assets.hardcover.app/dune.jpg",
};
const linked = await api.folder.create({ title: hit.title, status: "reading", book: hit });
assert.ok(linked.bookId, "folder.create upserts the picked book and links it");
const linkedRow = (await api.folder.list()).find((f) => f.id === linked.id)!;
assert.equal(linkedRow.book!.provider, "hardcover");
assert.equal(linkedRow.book!.externalId, "32897");
assert.deepEqual(linkedRow.book!.authors, ["Frank Herbert"]);
ok("folder.create upserts a Hardcover book and joins it back on list");

await rejectsWith(
  () => api.folder.create({ title: "Dune reread", book: hit }),
  /already have a folder for this book/,
  "a second folder for the same book returns a clean CONFLICT, not a raw 23505",
);
ok("duplicate book link fails with a readable message");

// A word captured in a linked folder inherits book_id, so it reaches the
// aggregate — this is the denormalization word.ts warns about.
const inBook = await api.word.create({ folderId: linked.id, term: "melange", captureMethod: "manual" });
assert.equal(inBook!.bookId, linked.bookId, "capture snapshots the folder's bookId onto the word");
ok("words captured in a linked folder carry bookId for the aggregate");

// Re-picking the same book after deleting the folder must reuse the row and
// refresh its metadata, never create a duplicate.
await api.folder.delete({ id: linked.id });
const relinked = await api.folder.create({
  title: "Dune",
  book: { ...hit, title: "Dune (Deluxe Edition)", coverImageUrl: "https://assets.hardcover.app/dune-deluxe.jpg" },
});
assert.equal(relinked.bookId, linked.bookId, "unique(provider, external_id) keeps one row per Hardcover book");
const refreshed = (await db.select().from(book).where(eq(book.id, relinked.bookId!)))[0];
assert.equal(refreshed.title, "Dune (Deluxe Edition)", "upsert refreshes metadata rather than DO NOTHING");
assert.equal(refreshed.coverImageUrl, "https://assets.hardcover.app/dune-deluxe.jpg");
await api.folder.delete({ id: relinked.id });
await db.delete(book).where(eq(book.id, relinked.bookId!));
ok("re-picking a book reuses one row and refreshes its metadata");

// ---- update --------------------------------------------------------------
const mastered = await api.word.update({ id: created!.id, mastered: true, definitionOverride: "Rain smell." });
assert.equal(mastered!.mastered, true);
assert.ok(mastered!.masteredAt instanceof Date, "masteredAt is stamped alongside mastered");
assert.equal((await api.word.update({ id: created!.id, mastered: false }))!.masteredAt, null, "unmastering clears the timestamp");
ok("word.update sets/clears masteredAt with mastered");

// ---- crowdsourced aggregate (live query, no counter table) ---------------
const agg = async (bookId: string) =>
  (await db.execute(sql`
    select w.normalized_term, min(w.term) as term, count(distinct w.user_id)::int as freq, d.definition
      from word w left join dictionary_entry d on d.term = w.normalized_term
     where w.book_id = ${bookId} and w.contributes_to_aggregate
     group by w.normalized_term, d.definition
     order by freq desc, w.normalized_term`)).rows as { normalized_term: string; definition: string | null }[];

const duneAgg = await agg("seed_book_dune");
assert.deepEqual(duneAgg.map((r) => r.normalized_term).sort(), ["gom jabbar", "prescience", "sietch"]);
assert.equal(duneAgg.find((r) => r.normalized_term === "sietch")!.definition, "A Fremen cave community; a place of refuge.");
const paleAgg = await agg("seed_book_pale_fire");
assert.ok(!paleAgg.some((r) => r.normalized_term === "iridescent"), "contributesToAggregate=false must exclude the word");
assert.ok(!Object.keys(duneAgg[0]).some((k) => /note|example|sentence/.test(k)), "aggregate must expose no spoiler columns");
ok("aggregate ranks by distinct readers, honours opt-out, joins on normalized term");

// ---- cascade -------------------------------------------------------------
await api.folder.delete({ id: free1.id });
await api.folder.delete({ id: free2.id });
assert.equal((await db.select().from(word).where(eq(word.folderId, free1.id))).length, 0, "deleting a folder cascades its words");
assert.equal(
  (await db.select().from(word).where(and(eq(word.userId, USER_ID)))).length,
  6,
  "back to exactly the 6 seeded words",
);
// The shared cache is global, not seed-scoped, so clean up the one term this
// script resolved — otherwise a re-run starts from a warm cache and stops
// exercising the insert path.
await db.delete(dictionaryEntry).where(eq(dictionaryEntry.term, "petrichor"));
ok("folder.delete cascades to words, leaving the seed intact");

console.log(pass.map((p) => `  ✓ ${p}`).join("\n"));
console.log(`\n${pass.length} checks passed`);
process.exit(0);
