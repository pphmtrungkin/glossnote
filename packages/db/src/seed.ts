/**
 * Development seed data for GlossNote.
 *
 *   bun run db:seed          (from the repo root)
 *
 * Safe to re-run: every row it writes carries a `seed_` id prefix, and the
 * script deletes exactly those rows first. It will never touch data you
 * created by hand through the app, so you can seed on top of a database you're
 * already using without losing your own folders.
 *
 * Refuses to run against anything but a local database — see assertLocal().
 */
import { hashPassword } from "better-auth/crypto";
import { like } from "drizzle-orm";

import { db } from "./index";
import { account, user } from "./schema/auth";
import { book, folder } from "./schema/book";
import { dictionaryEntry } from "./schema/dictionary";
import { userPreference } from "./schema/preference";
import { word } from "./schema/word";

const SEED_EMAIL = "seed@glossnote.app";
const SEED_PASSWORD = "glossnote123";
const USER_ID = "seed_user_reader";

// Seeding is destructive by nature (it deletes its own rows), and a
// DATABASE_URL pointing at staging or Railway is one copy-paste away. Bail
// unless the host is unmistakably local.
function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^:/?]+)/)?.[1] ?? "";
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(
      `Refusing to seed: DATABASE_URL host is "${host}", which is not local.\n` +
        `Seeding deletes and rewrites rows — point DATABASE_URL at your local\n` +
        `Postgres (bun run db:start) before running this.`,
    );
  }
}

async function clearPreviousSeed() {
  // Order matters: word references book, and word/folder/preference all
  // cascade from user. Deleting the user first would leave orphaned books.
  await db.delete(word).where(like(word.id, "seed_%"));
  await db.delete(folder).where(like(folder.id, "seed_%"));
  await db.delete(userPreference).where(like(userPreference.userId, "seed_%"));
  await db.delete(account).where(like(account.id, "seed_%"));
  await db.delete(user).where(like(user.id, "seed_%"));
  await db.delete(book).where(like(book.id, "seed_%"));
  await db.delete(dictionaryEntry).where(like(dictionaryEntry.id, "seed_%"));
}

async function seed() {
  assertLocal();
  await clearPreviousSeed();

  // --- Account -------------------------------------------------------------
  // Hashed with Better Auth's own scrypt implementation rather than a
  // hand-rolled one, so this user can actually sign in through the app.
  await db.insert(user).values({
    id: USER_ID,
    name: "Seed Reader",
    email: SEED_EMAIL,
    emailVerified: true,
  });

  await db.insert(account).values({
    id: "seed_account_credential",
    // "local:credential", not "credential" — Better Auth namespaces the issuer
    // for its own (non-OAuth) provider, and sign-in silently returns
    // INVALID_EMAIL_OR_PASSWORD if this doesn't match exactly. Verified against
    // a real sign-up row rather than guessed.
    issuer: "local:credential",
    accountId: USER_ID,
    providerId: "credential",
    userId: USER_ID,
    password: await hashPassword(SEED_PASSWORD),
    updatedAt: new Date(),
  });

  await db.insert(userPreference).values({
    userId: USER_ID,
    contributeToAggregateByDefault: true,
    offlineDictionaryTier: "core",
  });

  // --- Books ---------------------------------------------------------------
  // `hardcover` is the only provider anything writes (see HARDCOVER_PROVIDER in
  // packages/api/src/routers/book.ts). These were `open_library` until the
  // metadata source was settled, which left dev databases full of books from a
  // provider the app never queries.
  //
  // The external ids are the real Hardcover ones, and must stay distinct from
  // the fixture id in packages/api/src/smoke.ts: `book` is unique on
  // (provider, external_id), so a collision would make the smoke test's upsert
  // rewrite a seeded row instead of creating its own.
  const books = [
    {
      id: "seed_book_dune",
      provider: "hardcover",
      externalId: "312460",
      title: "Dune",
      authors: ["Frank Herbert"],
      description: "Political intrigue and ecology on the desert planet Arrakis.",
    },
    {
      id: "seed_book_pale_fire",
      provider: "hardcover",
      externalId: "141104",
      title: "Pale Fire",
      authors: ["Vladimir Nabokov"],
      description: "A 999-line poem and its increasingly unreliable commentary.",
    },
  ];
  await db.insert(book).values(books);

  // --- Shared dictionary cache --------------------------------------------
  // A deliberate mix: two entries fully AI-enriched (enrichedAt set, so the
  // enrichment path knows not to spend another call), one dictionary-API only,
  // one bundled-offline only. Exercises every dictionary_source value.
  await db.insert(dictionaryEntry).values([
    {
      id: "seed_dict_sietch",
      term: "sietch",
      definition: "A Fremen cave community; a place of refuge.",
      source: "ai_enhanced",
      exampleSentence: "They retreated to the sietch before the storm arrived.",
      usageNote: "Coined for Dune; not standard English outside the novel.",
      enrichedAt: new Date(),
    },
    {
      id: "seed_dict_prescience",
      term: "prescience",
      definition: "Knowledge of events before they take place; foresight.",
      source: "ai_enhanced",
      exampleSentence: "His prescience made the ambush feel inevitable rather than surprising.",
      usageNote: "Mostly formal or literary; 'foresight' is the everyday equivalent.",
      enrichedAt: new Date(),
    },
    {
      id: "seed_dict_iridescent",
      term: "iridescent",
      definition: "Showing luminous colours that seem to change when seen from different angles.",
      source: "dictionary_api",
    },
    {
      id: "seed_dict_lemniscate",
      term: "lemniscate",
      definition: "A figure-eight shaped curve.",
      source: "bundled",
    },
  ]);

  // --- Folders -------------------------------------------------------------
  // One per folder_status value. Note the partial unique index means one
  // book-linked folder per book per user; the freeform folder carries a null
  // bookId and is exempt.
  await db.insert(folder).values([
    { id: "seed_folder_dune", userId: USER_ID, bookId: "seed_book_dune", title: "Dune", status: "reading" },
    {
      id: "seed_folder_pale_fire",
      userId: USER_ID,
      bookId: "seed_book_pale_fire",
      title: "Pale Fire",
      status: "finished",
    },
    { id: "seed_folder_misc", userId: USER_ID, bookId: null, title: "Words from podcasts", status: "misc" },
  ]);

  // --- Captured words ------------------------------------------------------
  // Covers the states the UI has to render: resolved, pending-definition
  // (offline capture not yet looked up), personally overridden, mastered,
  // voice-captured, and opted out of the crowdsourced aggregate.
  await db.insert(word).values([
    {
      id: "seed_word_sietch",
      userId: USER_ID,
      folderId: "seed_folder_dune",
      bookId: "seed_book_dune",
      term: "sietch",
      normalizedTerm: "sietch",
      dictionaryEntryId: "seed_dict_sietch",
      captureMethod: "manual",
    },
    {
      id: "seed_word_prescience",
      userId: USER_ID,
      folderId: "seed_folder_dune",
      bookId: "seed_book_dune",
      term: "prescience",
      normalizedTerm: "prescience",
      dictionaryEntryId: "seed_dict_prescience",
      personalNote: "Keeps coming up in the Bene Gesserit chapters.",
      captureMethod: "voice",
    },
    {
      // Pending definition: captured offline, never resolved. dictionaryEntryId
      // is null, which is what the UI keys "pending" off.
      id: "seed_word_gom_jabbar",
      userId: USER_ID,
      folderId: "seed_folder_dune",
      bookId: "seed_book_dune",
      term: "gom jabbar",
      normalizedTerm: "gom jabbar",
      dictionaryEntryId: null,
      captureMethod: "manual",
    },
    {
      // Opted out of the aggregate — must never appear in the crowdsourced
      // count for Pale Fire.
      id: "seed_word_iridescent",
      userId: USER_ID,
      folderId: "seed_folder_pale_fire",
      bookId: "seed_book_pale_fire",
      term: "iridescent",
      normalizedTerm: "iridescent",
      dictionaryEntryId: "seed_dict_iridescent",
      contributesToAggregate: false,
      captureMethod: "manual",
    },
    {
      id: "seed_word_lemniscate",
      userId: USER_ID,
      folderId: "seed_folder_pale_fire",
      bookId: "seed_book_pale_fire",
      term: "lemniscate",
      normalizedTerm: "lemniscate",
      dictionaryEntryId: "seed_dict_lemniscate",
      definitionOverride: "The infinity symbol shape — ∞.",
      mastered: true,
      masteredAt: new Date(),
      lastReviewedAt: new Date(),
      captureMethod: "manual",
    },
    {
      // Freeform folder: no book, so it can never feed the aggregate.
      id: "seed_word_apophenia",
      userId: USER_ID,
      folderId: "seed_folder_misc",
      bookId: null,
      term: "apophenia",
      normalizedTerm: "apophenia",
      dictionaryEntryId: null,
      personalNote: "From a podcast on conspiracy thinking.",
      captureMethod: "voice",
    },
  ]);

  console.log("Seeded GlossNote dev data:");
  console.log(`  user        ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log("  books       2   folders 3   words 6");
  console.log("  dictionary  4");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
