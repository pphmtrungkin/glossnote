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
  CONTEXT_BLANK,
  CAPTURE_METHODS,
  DICTIONARY_SOURCES,
  FOLDER_STATUSES,
  FOLDER_VISIBILITIES,
  OFFLINE_DICTIONARY_TIERS,
  PREFERENCE_DEFAULTS,
  normalizeTerm,
  parseContext,
} from "@better-vocab/domain";
import { book } from "@better-vocab/db/schema/book";
import { env } from "@better-vocab/env/server";
import { defineTerm, unwrapWrappedObject } from "./enrich";
import { resetRateLimits } from "./rate-limit";
import { mapSearchResults, openLibraryCoverUrl } from "./routers/book";
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
assert.deepEqual(await enumLabels("folder_visibility"), [...FOLDER_VISIBILITIES]);
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
// A trimmed real Typesense payload. Covers come from Open Library, built from
// the hit's `isbns`, never from Hardcover's user-uploaded `image` — which is
// still in the payload and must be ignored. `isbns` is absent from the second
// hit and empty on the third, and both must map to no cover without a crash.
const mapped = mapSearchResults({
  found: 4,
  hits: [
    {
      document: {
        id: 32897,
        title: "Dune",
        author_names: ["Frank Herbert"],
        // Hardcover's own image is present and must be ignored: its covers are
        // user uploads, and the app takes Open Library's instead.
        image: { url: "https://assets.hardcover.app/dune.jpg", color: "orange" },
        // Hardcover's real order: a French edition first, English ones after.
        isbns: ["2221127513", "9782221127513", "0441294677", "9780441294671"],
        release_year: 1965,
        users_count: 41231,
      },
    },
    { document: { id: "1913699", title: "Pale Fire", author_names: [] } },
    { document: { id: 8675309, title: "Untitled", author_names: [], image: {}, isbns: [] } },
    { document: { id: 555, title: "Hyphenated", author_names: [], isbns: ["978-3-16-148410-0"] } },
  ],
});
assert.equal(mapped.length, 4);
assert.deepEqual(mapped[0], {
  externalId: "32897",
  title: "Dune",
  authors: ["Frank Herbert"],
  coverImageUrl: "https://covers.openlibrary.org/b/isbn/9780441294671-M.jpg?default=false",
  description: null,
  releaseYear: 1965,
});
assert.equal(mapped[1].coverImageUrl, null, "a hit with no isbns maps to a null cover, not a crash");
assert.equal(mapped[1].externalId, "1913699", "numeric and string ids both normalize to string");
assert.equal(mapped[2].coverImageUrl, null, "an empty isbn list is a coverless book, not a broken payload");
assert.equal(
  mapped[3].coverImageUrl,
  "https://covers.openlibrary.org/b/isbn/9783161484100-M.jpg?default=false",
  "hyphens are stripped, and a non-English ISBN-13 is still better than no cover",
);
assert.equal(
  openLibraryCoverUrl(["9791092429213", "9798749854572"]),
  "https://covers.openlibrary.org/b/isbn/9798749854572-M.jpg?default=false",
  "979-1 is France and Korea, not English; 979-8 is the US",
);
assert.deepEqual(mapSearchResults({ found: 0, hits: [] }), [], "no matches is an empty list");
assert.throws(() => mapSearchResults({ unexpected: true }), /Unexpected search response/);
ok("search results map from Typesense hits, with Open Library covers picked by English ISBN");

// ---- the proxy request budget --------------------------------------------
// book.search and dictionary.lookup spend an external quota — Hardcover caps
// the whole token at 60 requests a minute — so both carry a per-caller budget
// (see rate-limit.ts). The middleware runs before the handler, which is what
// lets this assert the limit without a token, a network call, or a real query:
// an over-budget call must be refused before it can decide anything else.
//
// Skipped when a token IS configured, on the same principle as the enrichment
// checks below: db:smoke never spends someone's quota.
if (env.HARDCOVER_API_TOKEN) {
  ok("proxy budget skipped: HARDCOVER_API_TOKEN is set and db:smoke makes no external calls");
} else {
  resetRateLimits();
  const budget = 20;
  for (let attempt = 0; attempt < budget; attempt++) {
    await rejectsWith(
      () => api.book.search({ query: "dune" }),
      /HARDCOVER_API_TOKEN is not set/,
      "inside the budget the call reaches the handler",
    );
  }
  await rejectsWith(
    () => api.book.search({ query: "dune" }),
    /Too many requests/,
    "the call past the budget is refused before the handler runs",
  );
  // A second caller has their own budget: the limit is per user, not global,
  // or one reader searching would lock out everybody else.
  await rejectsWith(
    () => caller("someone_else").book.search({ query: "dune" }),
    /HARDCOVER_API_TOKEN is not set/,
    "another caller starts from a full budget",
  );
  resetRateLimits();
  ok("the proxy budget refuses an over-budget caller, per user, before the handler");
}

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
  coverImageUrl: "https://covers.openlibrary.org/b/isbn/9780441294671-M.jpg?default=false",
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
  book: {
    ...hit,
    title: "Dune (Deluxe Edition)",
    coverImageUrl: "https://covers.openlibrary.org/b/isbn/9780593099322-M.jpg?default=false",
  },
});
assert.equal(relinked.bookId, linked.bookId, "unique(provider, external_id) keeps one row per Hardcover book");
const refreshed = (await db.select().from(book).where(eq(book.id, relinked.bookId!)))[0];
assert.equal(refreshed.title, "Dune (Deluxe Edition)", "upsert refreshes metadata rather than DO NOTHING");
assert.equal(refreshed.coverImageUrl, "https://covers.openlibrary.org/b/isbn/9780593099322-M.jpg?default=false");
await api.folder.delete({ id: relinked.id });
ok("re-picking a book reuses one row and refreshes its metadata");

// The book row is shared by every reader of that book, so a client's cover link
// is kept only when it is an Open Library cover the server would build. Any
// other URL would be one reader's image shown to all of them.
const foreignCover = await api.folder.create({
  title: "Dune",
  book: { ...hit, coverImageUrl: "https://assets.hardcover.app/dune.jpg" },
});
const foreignRow = (await db.select().from(book).where(eq(book.id, foreignCover.bookId!)))[0];
assert.equal(foreignRow.coverImageUrl, null, "a cover link that is not Open Library's is stored as no cover");
await api.folder.delete({ id: foreignCover.id });
await db.delete(book).where(eq(book.id, relinked.bookId!));
ok("folder.create only stores Open Library cover links on the shared book row");

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

// ---- the context format --------------------------------------------------
// One stored string has to serve a context panel and a cloze card, and three
// packages read it: the quiz builder, the app's panel, and enrichment's own
// validation. A drift between them puts the blank in the wrong place.
const parsed = parseContext("The house had an {eldritch} stillness about it.")!;
assert.equal(parsed.sentence, "The house had an eldritch stillness about it.", "the panel gets prose");
assert.equal(parsed.answer, "eldritch", "the reveal gets the word");
assert.equal(parsed.prompt, `The house had an ${CONTEXT_BLANK} stillness about it.`, "the card gets a blank");
assert.ok(!parsed.prompt.includes("eldritch"), "a card must never ship the answer inside its own prompt");

// The reason the word is marked rather than searched for at read time: the
// sentence rarely contains the term as it was captured.
assert.equal(parseContext("She was {running} late again.")!.answer, "running", "inflection is preserved");
assert.equal(parseContext("{Sietches} are carved into rock.")!.answer, "Sietches", "so is sentence casing");

assert.equal(parseContext("A sentence with no marked word at all."), null, "no braces is not a context");
assert.equal(parseContext("Both {this} and {that} are marked."), null, "two spans have no single answer");
assert.equal(parseContext("An empty {} span."), null, "an empty span has no answer");
assert.equal(parseContext("{eldritch}"), null, "a bare word is a blank with nothing to reason from");
assert.equal(parseContext("Unbalanced {braces here."), null, "unbalanced braces are not a context");
ok("a context parses into panel prose, a quiz prompt, and the inflected answer");

// ---- cheap models wrap their answers ------------------------------------
// The repair the enrichment call falls back to when validation fails. GLM
// returns the right two fields nested under a key it invented on roughly half
// of calls; without this, half the terms would stay un-enriched for no reason
// worth having. Real payloads, captured from the gateway.
assert.equal(
  unwrapWrappedObject('{"answer":{"exampleSentence":"The house had an eldritch stillness.","usageNote":"Literary."}}'),
  '{"exampleSentence":"The house had an eldritch stillness.","usageNote":"Literary."}',
  "one key holding one object is a wrapper, and the object inside it is the answer",
);
assert.equal(
  unwrapWrappedObject('{"exampleSentence":"a","usageNote":"b"}'),
  null,
  "an answer that is already flat is not a wrapper — two keys, nothing to unwrap",
);
assert.equal(
  unwrapWrappedObject('{"result":{"exampleSentence":"a","usageNote":"b"},"note":"extra"}'),
  null,
  "a shape with more than one key is not recognised, and guessing would file something odd in a shared table",
);
assert.equal(unwrapWrappedObject('{"answer":"just a string"}'), null, "a wrapper must hold an object, not a scalar");
assert.equal(unwrapWrappedObject('[{"exampleSentence":"a"}]'), null, "an array is not a wrapper");
assert.equal(unwrapWrappedObject("Sure! Here is the JSON:"), null, "prose is unrepairable, not a crash");
ok("a wrapped model answer is unwrapped; anything else is left unrepaired");

// ---- AI enrichment: at most one call per term, ever ----------------------
// Enrichment is keyed by term on the shared row, never by user — that is what
// holds the spec's cost target (§8.3: one unique word, at most one AI call,
// across the entire user base). `enrichedAt` is both the marker and the claim.
//
// Like the Hardcover section, this never calls the gateway: the assertions
// below are the unconfigured path, which is also the failure path. A key in
// the environment would make the run cost money and depend on the network, so
// it is skipped instead.
await db.insert(dictionaryEntry).values({
  id: "smoke_dict_enrich",
  term: "eldritch",
  definition: "Strange in a way that inspires fear; otherworldly.",
  source: "dictionary_api",
});
if (env.AI_GATEWAY_API_KEY) {
  ok("enrichment path skipped: AI_GATEWAY_API_KEY is set and db:smoke makes no external calls");
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
  assert.equal(
    await defineTerm("eldritch"),
    null,
    "without a key, AI defining is unavailable rather than an error, so a new term falls back to Datamuse",
  );
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

// Shelves are private until their reader says otherwise: nothing on one
// reaches another reader, however many words are saved on it.
assert.equal(otherFolder.visibility, "private", "a new shelf is private by default");
assert.deepEqual(await api.word.suggestions({ folderId: myFolder.id }), [], "a private shelf's words reach no other reader");
await caller(OTHER_ID).folder.update({ id: otherFolder.id, visibility: "public" });

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

// The add-word screen completes a typed word from these.
assert.deepEqual(
  (await api.word.suggestions({ folderId: myFolder.id, prefix: " SI" })).map((row) => row.normalizedTerm),
  ["sietch"],
  "a prefix narrows suggestions to matching terms, trimmed and case-insensitive",
);
assert.deepEqual(
  await api.word.suggestions({ folderId: myFolder.id, prefix: "%" }),
  [],
  "LIKE wildcards in a typed prefix match literally, not every term",
);
ok("suggestions complete a typed prefix, treating wildcards literally");

// The add-word form's AI words. Generating them is an AI call, and db:smoke
// makes no external calls, so the book's row is pre-filled and served as is.
await db
  .update(book)
  .set({ topicWordsAt: new Date(), topicWords: [{ topic: "Desert ecology", terms: ["arid", "melange", "oasis"] }] })
  .where(eq(book.id, myFolder.bookId!));
assert.deepEqual(
  await api.word.topicWords({ folderId: myFolder.id }),
  [{ topic: "Desert ecology", terms: ["arid", "oasis"] }],
  "a topic word already in the folder is left out",
);
assert.deepEqual(await api.word.topicWords({ folderId: free2.id }), [], "a freeform folder has no book to pick words for");
await rejectsWith(
  () => caller("someone_else").word.topicWords({ folderId: myFolder.id }),
  /not found/i,
  "another reader cannot read a folder's topic words",
);
await db.update(book).set({ topicWordsAt: null, topicWords: null }).where(eq(book.id, myFolder.bookId!));
ok("word.topicWords serves a book's AI words minus the folder's own, to the folder's owner only");

// Visibility is read live, not snapshotted: going private again takes back the
// words that shelf had already contributed.
await caller(OTHER_ID).folder.update({ id: otherFolder.id, visibility: "private" });
assert.deepEqual(
  await api.word.suggestions({ folderId: myFolder.id }),
  [],
  "making a shelf private again hides the words saved on it before",
);
await rejectsWith(
  () => api.folder.update({ id: otherFolder.id, visibility: "public" }),
  /not found/i,
  "only a shelf's own reader can change its visibility",
);
ok("only public shelves reach other readers, and switching back to private takes effect at once");

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

// ---- the quiz ------------------------------------------------------------
// Cards are built from the shared, term-keyed contexts, so a quiz costs no AI
// call of its own. The seed is deliberately shaped to exercise every reason a
// word is left out: of the six seeded words only two have an entry carrying
// contexts, and the rest are excluded for a different reason each.
const cards = await api.word.quiz({});
assert.deepEqual(
  cards.map((card) => card.term).sort(),
  ["prescience", "sietch"],
  "only words whose resolved entry actually carries contexts can produce a card",
);

const sietchCard = cards.find((card) => card.term === "sietch")!;
assert.equal(sietchCard.prompt, `They retreated to the ${CONTEXT_BLANK} before the storm arrived.`);
assert.equal(sietchCard.answer, "sietch", "the answer is the form the sentence uses");
assert.ok(!sietchCard.prompt.includes("sietch"), "the prompt cannot contain the word being guessed");
assert.equal(sietchCard.definition, "A Fremen cave community; a place of refuge.");
assert.equal(sietchCard.wordId, "seed_word_sietch", "a card carries the word id `reviewed` is stamped on");
ok("word.quiz blanks the term out of a shared context and reveals the definition");

// Each of these is excluded for its own reason, and all four are seeded rows:
// no resolved entry (gom jabbar, apophenia), an entry with no contexts
// (iridescent), and mastered (lemniscate) — which is what mastering is for.
for (const term of ["gom jabbar", "apophenia", "iridescent", "lemniscate"]) {
  assert.ok(!cards.some((card) => card.term === term), `${term} must not be quizzed`);
}
ok("mastered words, unresolved words, and context-free entries are all left out");

assert.deepEqual(
  await api.word.quiz({ folderId: "seed_folder_pale_fire" }),
  [],
  "a folder whose words are mastered or context-free yields an empty run, not an error",
);
assert.equal((await api.word.quiz({ folderId: "seed_folder_dune" })).length, 2, "and a folder filter scopes the run");
assert.equal((await caller("someone_else").word.quiz({})).length, 0, "the quiz only ever draws on the caller's own words");
ok("quiz runs scope to a folder and to their owner");

// Least-recently-reviewed first, never-reviewed ahead of those — so a session
// opens on what the reader has seen least.
// Both seeded words were inserted in one statement and so share `createdAt`
// exactly; the id tie-break is what stops that pair from swapping places
// between runs, which is how this assertion caught the missing sort key.
assert.equal(
  (await api.word.quiz({ limit: 1 }))[0]!.term,
  "prescience",
  "with nothing reviewed the order is total and stable, not whatever the heap returns",
);
await api.word.update({ id: "seed_word_prescience", reviewed: true });
assert.equal(
  (await api.word.quiz({ limit: 1 }))[0]!.term,
  "sietch",
  "reviewing a word moves it behind the ones still unseen",
);
// Hand the seed back exactly as found: `reviewed` is the one assertion here
// that writes to a seeded row.
await db.update(word).set({ lastReviewedAt: null }).where(eq(word.id, "seed_word_prescience"));
ok("a reviewed card drops to the back of the queue");

// ---- update --------------------------------------------------------------
const mastered = await api.word.update({ id: created!.id, mastered: true });
assert.equal(mastered!.mastered, true);
assert.ok(mastered!.masteredAt instanceof Date, "masteredAt is stamped alongside mastered");
const masteredList = await api.word.mastered({});
assert.ok(masteredList.words.some((w) => w.id === created!.id), "a mastered word is listed for the Practise tab");
assert.ok(masteredList.total >= masteredList.words.length && masteredList.total >= 1, "and counted for the You tab");
assert.ok(
  !(await caller("someone_else").word.mastered({})).words.some((w) => w.id === created!.id),
  "another reader never sees it",
);
assert.equal((await api.word.update({ id: created!.id, mastered: false }))!.masteredAt, null, "unmastering clears the timestamp");
assert.ok(
  !(await api.word.mastered({})).words.some((w) => w.id === created!.id),
  "unmastering takes a word off the mastered list",
);
ok("word.update sets/clears masteredAt with mastered");

// A note and a review stamp are separate axes from the definition: a flashcard
// turn must not blank the note, and neither may touch definitionOverride.
const noted = await api.word.update({ id: created!.id, personalNote: "Mum uses this after storms." });
assert.equal(noted!.personalNote, "Mum uses this after storms.");
assert.equal(
  noted!.definitionOverride,
  "The smell of rain on dry earth.",
  "a note is stored alongside the definition, not instead of it",
);

// Definitions are not user-editable. An old client that still sends one has it
// stripped, not stored — asserted, because the regression would be silent: the
// edit would simply start working again.
const edited = await api.word.update({
  id: created!.id,
  personalNote: "Mum uses this after storms.",
  definitionOverride: "Rain smell.",
} as never);
assert.equal(edited!.definitionOverride, "The smell of rain on dry earth.", "word.update has no way to change a definition");
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
