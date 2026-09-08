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
import {
  CAPTURE_METHODS,
  DICTIONARY_SOURCES,
  FOLDER_STATUSES,
  OFFLINE_DICTIONARY_TIERS,
  PREFERENCE_DEFAULTS,
  normalizeTerm,
} from "@better-vocab/domain";
import { book } from "@better-vocab/db/schema/book";
import { env } from "@better-vocab/env/server";
import { mapSearchResults } from "./routers/book";
import { pickDefinition } from "./routers/dictionary";
import { appRouter } from "./routers/index";
import { db } from "@better-vocab/db";
import { user } from "@better-vocab/db/schema/auth";
import { userPreference } from "@better-vocab/db/schema/preference";
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

// ---- the match key -------------------------------------------------------
// Every join between a word and a definition matches on this and nothing else
// — the shared dictionary_entry table, the on-device dictionary table, and the
// crowdsourced aggregate's group-by. Four callers across three packages share
// this one function; one of them stamps the bundled asset at build time, so a
// drift here would make every offline lookup miss in silence.
assert.equal(normalizeTerm("  Petrichor "), "petrichor", "trimmed and lowercased");
assert.equal(normalizeTerm("SIETCH"), "sietch", "display casing never reaches the key");
assert.equal(
  normalizeTerm("gom  jabbar"),
  "gom  jabbar",
  "interior spacing is part of the term, not whitespace to strip",
);
assert.equal(normalizeTerm(normalizeTerm("  Dune ")), normalizeTerm("  Dune "), "idempotent");
ok("normalizeTerm is the one match key: trim + lowercase, idempotent");

// A previous run that failed mid-way can leave folders behind, and every
// assertion below counts rows. Clear anything this script created before
// starting — `seed_%` ids are the seed's, everything else is ours.
await db.delete(folder).where(and(eq(folder.userId, USER_ID), notLike(folder.id, "seed_%")));
// Seeded books carry the `hardcover` provider too, so this can no longer key
// on provider alone — it would delete the seed. Same `seed_%` rule as folders.
await db.delete(book).where(and(eq(book.provider, "hardcover"), notLike(book.id, "seed_%")));

// ---- reads over the seeded state ----------------------------------------
const folders = await api.folder.list();
assert.equal(folders.length, 3, "seed creates 3 folders");
assert.equal(folders.filter((f) => f.book).length, 2, "2 book-linked folders join a book row");
assert.equal(folders.find((f) => f.id === "seed_folder_misc")!.book, null, "freeform folder has no book");
assert.equal(
  folders.filter((f) => f.book?.provider === "hardcover").length,
  2,
  "seeded books use the provider the app actually writes, and survive this script's own cleanup",
);
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

// Both deletes used to return { id } without checking whether a row matched,
// so deleting someone else's word reported success. They now fail the same way
// an unowned update does.
await rejectsWith(
  () => caller("someone_else").word.delete({ id: "seed_word_sietch" }),
  /Word not found/,
  "deleting another user's word must 404, not report success",
);
await rejectsWith(
  () => caller("someone_else").folder.delete({ id: "seed_folder_dune" }),
  /Folder not found/,
  "deleting another user's folder must 404, not report success",
);
assert.equal(
  (await api.word.listByFolder({ folderId: "seed_folder_dune" })).length,
  3,
  "a rejected delete leaves the rows alone",
);
ok("delete refuses another user's row instead of silently reporting success");

// ---- the vocabulary Postgres actually holds ------------------------------
// The enum values live in @better-vocab/domain and the Drizzle pgEnums are
// built from them, so asserting those match each other proves nothing. This
// asks the database: adding a value to the domain lists without generating a
// migration fails here rather than at runtime.
async function enumLabels(typeName: string) {
  const result = await db.execute<{ label: string }>(sql`
    select e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = ${typeName}
     order by e.enumsortorder`);
  return result.rows.map((r) => r.label);
}
assert.deepEqual(await enumLabels("folder_status"), [...FOLDER_STATUSES]);
assert.deepEqual(await enumLabels("capture_method"), [...CAPTURE_METHODS]);
assert.deepEqual(await enumLabels("dictionary_source"), [...DICTIONARY_SOURCES]);
assert.deepEqual(await enumLabels("offline_dictionary_tier"), [...OFFLINE_DICTIONARY_TIERS]);
ok("every Postgres enum matches the shared domain vocabulary");

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
  captureMethod: "voice",
});
assert.equal(created!.normalizedTerm, "petrichor", "term is trimmed + lowercased into the match key");
assert.equal(created!.term, "  Petrichor ", "display form is preserved verbatim");
assert.equal(created!.bookId, null, "freeform folder cannot feed the aggregate");
ok("word.create normalizes the term and preserves the display form");

// The privacy model, asserted: a definition supplied by a device stays on that
// user's own row and never reaches the shared cache. If this ever regresses,
// the first person to capture a term defines it for every other reader.
assert.equal(created!.definitionOverride, "The smell of rain on dry earth.");
assert.equal(created!.dictionaryEntryId, null, "only a server-side resolver may fill dictionaryEntryId");
assert.equal(
  (await db.select().from(dictionaryEntry).where(eq(dictionaryEntry.term, "petrichor"))).length,
  0,
  "a client-supplied definition must never be written to the shared dictionary_entry",
);
ok("definitions stay on the user's own row; the shared cache is server-only");

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
// Must not match a seeded book's external id: `book` is unique on
// (provider, external_id), so a collision would upsert onto the seed row and
// the metadata-refresh assertion below would rewrite seeded data.
assert.ok(
  !folders.some((f) => f.book?.externalId === "32897"),
  "the fixture's external id collides with a seeded book",
);
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

// ---- Datamuse definition parsing ----------------------------------------
// Real payloads, captured from api.datamuse.com.
assert.equal(
  pickDefinition([{ word: "ephemeral", defs: ["adj\tLasting for a short period of time. "] }], "ephemeral"),
  "Lasting for a short period of time.",
  "the part-of-speech prefix is stripped and the text trimmed",
);

// The trap: `sp` is a fuzzy match, so a word that does not exist comes back as
// a DIFFERENT word. Asking Datamuse for "sietch" really does return "sketch".
// Without the exact-word check this files the wrong definition under the
// user's word, silently and permanently.
assert.equal(
  pickDefinition(
    [{ word: "sketch", score: 15046, tags: ["n", "v", "adj"], defs: ["n\tA rapidly executed freehand drawing. "] }],
    "sietch",
  ),
  null,
  "a fuzzy near-match must never be accepted as the definition",
);

assert.equal(pickDefinition([], "gom jabbar"), null, "no matches at all is null, not an error");
assert.equal(
  pickDefinition([{ word: "zyzzyva", tags: ["n"] }], "zyzzyva"),
  null,
  "an indexed word with no definitions is null",
);
assert.equal(
  pickDefinition([{ word: "Ephemeral", defs: ["adj\tShort-lived."] }], "ephemeral"),
  "Short-lived.",
  "the exact-word check is case-insensitive",
);
assert.equal(pickDefinition({ error: "nope" }, "ephemeral"), null, "an unrecognised payload is null, not a crash");
ok("Datamuse parsing strips the part of speech and rejects fuzzy near-matches");

// ---- word.create links a server-resolved entry ---------------------------
// dictionary.lookup is the only writer of dictionary_entry; word.create may
// only read it. When a shared row exists the word points at it and stores no
// override, so later AI enrichment of that row reaches every reader.
await db.insert(dictionaryEntry).values({
  id: "smoke_dict_lookup",
  term: "quixotic",
  definition: "Exceedingly idealistic; unrealistic and impractical.",
  source: "dictionary_api",
});
const linkedWord = await api.word.create({
  folderId: free1.id,
  term: "Quixotic",
  definition: "an offline gloss that should lose",
  captureMethod: "manual",
});
assert.equal(linkedWord!.dictionaryEntryId, "smoke_dict_lookup", "an existing shared entry is linked");
assert.equal(linkedWord!.definitionOverride, null, "the server's answer supersedes the device's gloss");
await db.delete(dictionaryEntry).where(eq(dictionaryEntry.id, "smoke_dict_lookup"));
ok("word.create links a server-resolved entry instead of storing an override");

// ---- AI enrichment: at most one call per term, ever ----------------------
// Enrichment is keyed by term on the shared row, never by user — that is what
// holds the spec's cost target (§8.3: one unique word, at most one AI call,
// across the entire user base). `enrichedAt` is both the marker and the claim.
//
// Like the Hardcover section, this never calls the provider: the assertions
// below are the unconfigured path, which is also the failure path. A key in
// the environment would make the run cost money and depend on the network, so
// it is skipped instead.
await db.insert(dictionaryEntry).values({
  id: "smoke_dict_enrich",
  term: "eldritch",
  definition: "Strange in a way that inspires fear; otherworldly.",
  source: "dictionary_api",
});
if (env.ANTHROPIC_API_KEY) {
  ok("enrichment path skipped: ANTHROPIC_API_KEY is set and db:smoke makes no external calls");
} else {
  const unenriched = await api.dictionary.lookup({ term: "  Eldritch " });
  assert.equal(unenriched!.id, "smoke_dict_enrich", "a term already in the shared cache is served from it");
  assert.equal(
    unenriched!.definition,
    "Strange in a way that inspires fear; otherworldly.",
    "the AI pass adds columns; it never rewrites the deterministic definition",
  );
  assert.equal(
    unenriched!.enrichedAt,
    null,
    "an enrichment that cannot run releases its claim, so the term can be enriched later",
  );
  assert.equal(unenriched!.exampleSentence, null, "and leaves no half-filled row behind");
  assert.equal(unenriched!.source, "dictionary_api", "source only becomes ai_enhanced once enrichment lands");
  ok("a lookup still resolves when enrichment is unavailable, and stays retryable");
}

// A row that has already been through the pass is returned untouched: this is
// the guard that stops every later reader of the word buying another call.
await db
  .update(dictionaryEntry)
  .set({
    enrichedAt: new Date(),
    exampleSentence: "The house had an eldritch stillness about it.",
    usageNote: "Literary; mostly in horror writing.",
    source: "ai_enhanced",
  })
  .where(eq(dictionaryEntry.id, "smoke_dict_enrich"));
const alreadyEnriched = await api.dictionary.lookup({ term: "ELDRITCH" });
assert.ok(alreadyEnriched!.enrichedAt instanceof Date, "an enriched row keeps its stamp");
assert.equal(alreadyEnriched!.exampleSentence, "The house had an eldritch stillness about it.");
assert.equal(alreadyEnriched!.usageNote, "Literary; mostly in horror writing.");
ok("an enriched term is served from the shared row, never enriched twice");

// The shared cache is global rather than seed-scoped, so this row goes back
// out again — a re-run must start cold or it stops exercising the claim.
await db.delete(dictionaryEntry).where(eq(dictionaryEntry.id, "smoke_dict_enrich"));

// ---- suggestions: shared counts, private definitions ---------------------
// A second reader of the same book, so there is a population to aggregate.
const OTHER_ID = "smoke_user_other";
await db.delete(user).where(eq(user.id, OTHER_ID));
await db.insert(user).values({ id: OTHER_ID, name: "Other Reader", email: "other@smoke.test", emailVerified: true });
const otherFolder = await caller(OTHER_ID).folder.create({ title: "Dune", book: hit });
for (const term of ["melange", "sietch", "gom jabbar"]) {
  await caller(OTHER_ID).word.create({ folderId: otherFolder.id, term, captureMethod: "manual" });
}
// One capture the other reader opted out of — it must stay invisible.
await db
  .update(word)
  .set({ contributesToAggregate: false })
  .where(and(eq(word.userId, OTHER_ID), eq(word.normalizedTerm, "gom jabbar")));

const myFolder = await api.folder.create({ title: "Dune", book: hit });
await api.word.create({ folderId: myFolder.id, term: "melange", captureMethod: "manual" });

const suggested = await api.word.suggestions({ folderId: myFolder.id });
const terms = suggested.map((row) => row.normalizedTerm);
assert.ok(terms.includes("sietch"), "a term other readers saved is suggested");
assert.ok(!terms.includes("melange"), "a term already in my folder is not suggested back to me");
assert.ok(!terms.includes("gom jabbar"), "an opted-out capture never appears in suggestions");
assert.equal(suggested.find((r) => r.normalizedTerm === "sietch")!.readers, 1, "counts distinct readers");
assert.deepEqual(
  Object.keys(suggested[0]!).sort(),
  ["normalizedTerm", "readers", "term"],
  "suggestions expose counts only — no definition, sentence, or note can leak",
);
ok("suggestions rank others' saved words, minus mine, minus opt-outs");

assert.deepEqual(await api.word.suggestions({ folderId: free2.id }), [], "a freeform folder has no book to compare against");
ok("freeform folders return no suggestions rather than an error");

await api.folder.delete({ id: myFolder.id });
await caller(OTHER_ID).folder.delete({ id: otherFolder.id });
await db.delete(user).where(eq(user.id, OTHER_ID));

// ---- preferences ---------------------------------------------------------
// The opt-out the privacy model promises: word.create reads this column, and
// until now nothing could write it.
//
// A reader with no row yet gets the shared defaults, and asking must not
// create one — the settings screen opens without a write.
const unseen = await caller("someone_else").preference.get();
assert.equal(unseen.contributeToAggregateByDefault, PREFERENCE_DEFAULTS.contributeToAggregateByDefault);
assert.equal(unseen.offlineDictionaryTier, PREFERENCE_DEFAULTS.offlineDictionaryTier);
assert.equal(
  (await db.select().from(userPreference).where(eq(userPreference.userId, "someone_else"))).length,
  0,
  "reading preferences must not create a row",
);
ok("preference.get returns the shared defaults without writing a row");

// This user is seeded with a row, so these exercise the conflict path.
const optedOut = await api.preference.update({ contributeToAggregateByDefault: false });
assert.equal(optedOut.contributeToAggregateByDefault, false);
assert.equal(optedOut.offlineDictionaryTier, "core", "a partial update leaves the other field alone");
const tiered = await api.preference.update({ offlineDictionaryTier: "extended" });
assert.equal(tiered.offlineDictionaryTier, "extended");
assert.equal(tiered.contributeToAggregateByDefault, false, "and does not resurrect the field it omits");
ok("preference.update accepts one field at a time without clobbering the other");

// The insert path needs a real user with no row of their own.
const FRESH_ID = "smoke_user_fresh";
await db.delete(user).where(eq(user.id, FRESH_ID));
await db.insert(user).values({ id: FRESH_ID, name: "Fresh Reader", email: "fresh@smoke.test", emailVerified: true });
const firstWrite = await caller(FRESH_ID).preference.update({ offlineDictionaryTier: "extended" });
assert.equal(firstWrite.offlineDictionaryTier, "extended", "the first update creates the row");
assert.equal(
  firstWrite.contributeToAggregateByDefault,
  PREFERENCE_DEFAULTS.contributeToAggregateByDefault,
  "a field the caller omitted takes the shared default, not undefined",
);
await db.delete(user).where(eq(user.id, FRESH_ID));
ok("preference.update creates the row on a user's first write");

// The opt-out has to actually reach a capture, not merely persist.
await api.preference.update({ contributeToAggregateByDefault: false });
const quiet = await api.word.create({ folderId: free2.id, term: "susurrus", captureMethod: "manual" });
assert.equal(quiet.contributesToAggregate, false, "a capture honours the user's opt-out");
// Also restores the seeded values, so the seed is back to its original shape.
await api.preference.update({ contributeToAggregateByDefault: true, offlineDictionaryTier: "core" });
const loud = await api.word.create({ folderId: free2.id, term: "lambent", captureMethod: "manual" });
assert.equal(loud.contributesToAggregate, true, "and follows the toggle back");
ok("word.create reads the preference the router writes");

// ---- offline flush -------------------------------------------------------
// One bad row must not strand the rest of the queue, so results are per
// capture rather than all-or-nothing.
const flushed = await api.word.createMany({
  captures: [
    { localId: "local-1", folderId: free2.id, term: "  Halcyon ", captureMethod: "manual" },
    { localId: "local-2", folderId: free2.id, term: "susurrus", captureMethod: "voice" },
    { localId: "local-3", folderId: "folder_deleted_elsewhere", term: "orphan", captureMethod: "manual" },
  ],
});
assert.equal(flushed.length, 3, "every queued capture gets an outcome");
assert.equal(flushed[0]!.status, "saved");
assert.equal(flushed[2]!.status, "dropped", "a folder that no longer exists is dropped, not retried forever");
assert.equal(flushed[2]!.localId, "local-3", "localId is echoed back so the device can match rows");

const halcyon = (await api.word.listByFolder({ folderId: free2.id })).find((w) => w.term === "  Halcyon ");
assert.equal(halcyon!.normalizedTerm, "halcyon", "a flushed capture normalizes exactly like a live one");

// local-2 replays a word already captured above: the same row comes back, so a
// device that crashed mid-flush can resend the whole queue safely.
const replayed = flushed[1]!;
assert.equal(replayed.status === "saved" && replayed.wordId, quiet.id, "a replayed capture is idempotent");
ok("word.createMany flushes a queue, reports each row, and is safe to resend");

const rejectedBatch = await caller("someone_else").word.createMany({
  captures: [{ localId: "x", folderId: free2.id, term: "trespass", captureMethod: "manual" }],
});
assert.equal(rejectedBatch[0]!.status, "dropped", "another user's folder is never writable through the batch");
ok("createMany scopes folder ownership to the caller");

// ---- update --------------------------------------------------------------
const mastered = await api.word.update({ id: created!.id, mastered: true, definitionOverride: "Rain smell." });
assert.equal(mastered!.mastered, true);
assert.ok(mastered!.masteredAt instanceof Date, "masteredAt is stamped alongside mastered");
assert.equal((await api.word.update({ id: created!.id, mastered: false }))!.masteredAt, null, "unmastering clears the timestamp");
ok("word.update sets/clears masteredAt with mastered");

// A note and a review stamp are separate axes from the definition: a flashcard
// turn must not blank the note, and neither may touch definitionOverride.
const noted = await api.word.update({ id: created!.id, personalNote: "Mum uses this after storms." });
assert.equal(noted!.personalNote, "Mum uses this after storms.");
assert.equal(noted!.definitionOverride, "Rain smell.", "a note is stored alongside the definition, not instead of it");
const reviewed = await api.word.update({ id: created!.id, reviewed: true });
assert.ok(reviewed!.lastReviewedAt instanceof Date, "the server stamps the review time, the client only says it happened");
assert.equal(reviewed!.personalNote, "Mum uses this after storms.", "a review turn leaves every other field alone");
assert.equal(reviewed!.mastered, false, "and reviewing is not mastering");
ok("word.update writes personal notes and review stamps without clobbering the rest");

// ---- rename --------------------------------------------------------------
// The folder's own label, not the book's: it diverges from book.title on
// purpose, and renaming must never reach the shared book row other readers of
// that book join to.
const renamed = await api.folder.update({ id: free1.id, title: "Scratch A (book club)" });
assert.equal(renamed.title, "Scratch A (book club)");
assert.equal(renamed.status, "misc", "a rename leaves the status chip where it was");
assert.equal((await api.folder.update({ id: free1.id, status: "finished" })).title, "Scratch A (book club)", "and a status change leaves the name");
await rejectsWith(
  () => caller("someone_else").folder.update({ id: free1.id, title: "mine now" }),
  /Folder not found/,
  "renaming another user's folder must 404, not report success",
);
ok("folder.update renames and re-files, scoped to the owner");

// ---- cascade -------------------------------------------------------------
assert.deepEqual(await api.folder.delete({ id: free1.id }), { id: free1.id }, "delete returns the row it removed");
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
