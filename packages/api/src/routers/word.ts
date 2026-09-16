import {
  CAPTURE_METHODS,
  type CaptureMethod,
  PREFERENCE_DEFAULTS,
  normalizeTerm,
  parseContext,
} from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { book, folder, type TopicWordGroup } from "@better-vocab/db/schema/book";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { userPreference } from "@better-vocab/db/schema/preference";
import { word } from "@better-vocab/db/schema/word";
import { and, desc, eq, ilike, inArray, isNull, like, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { suggestTopicWords } from "../enrich";
import { protectedProcedure, router } from "../index";
import { rateLimit } from "../rate-limit";
import { keepDictionaryWords } from "./dictionary";

/** Where a word sits in the reader's rotation — the scheme's three states. */
type Mastery = "new" | "learning" | "steady";
import { assertOwned, ownedBy } from "../ownership";

async function assertFolderOwnership(userId: string, folderId: string) {
  const owned = await db.query.folder.findFirst({
    where: ownedBy(folder, folderId, userId),
  });
  return assertOwned(owned, "Folder");
}

/**
 * Whether new captures join the crowdsourced aggregate. Read once per request
 * rather than once per word, since it cannot change mid-batch.
 */
async function contributionDefault(userId: string) {
  const preference = await db.query.userPreference.findFirst({
    where: eq(userPreference.userId, userId),
  });
  return (
    preference?.contributeToAggregateByDefault ?? PREFERENCE_DEFAULTS.contributeToAggregateByDefault
  );
}

/**
 * Writes one capture. The single path into the `word` table, shared by the
 * immediate save and the offline flush so the rules below cannot hold for one
 * and not the other. The caller proves folder ownership first.
 *
 * `definition` is the definition the user's own device showed — from its
 * offline dictionary, or the lookup it just ran — and it is stored on THIS
 * user's row as `definitionOverride`. No screen lets a reader type one, and no
 * procedure edits it afterwards: definitions are not user-editable. It is deliberately NOT written into the shared
 * `dictionaryEntry` cache: definitions are per-device, only lookup counts are
 * shared. Letting a client write the shared table would mean the first person
 * to capture a term defines it, permanently, for every other reader.
 *
 * If `dictionary.lookup` has already resolved this term, the word links to
 * that shared row and no override is stored — the server's answer supersedes
 * an offline gloss, and it is the row AI enrichment will later improve, so
 * every reader gets that improvement for free. The client's `definition` is
 * only kept when no shared row exists, so the word isn't left blank.
 *
 * This never *writes* dictionary_entry. Only dictionary.lookup does.
 */
async function captureWord(args: {
  userId: string;
  folder: { id: string; bookId: string | null };
  term: string;
  definition?: string;
  captureMethod: CaptureMethod;
  page?: number;
  contributesToAggregate: boolean;
}) {
  const normalizedTerm = normalizeTerm(args.term);

  // Read-only: an entry is used if the server already resolved this term,
  // never created here.
  const resolved = await db.query.dictionaryEntry.findFirst({
    where: eq(dictionaryEntry.term, normalizedTerm),
  });

  const [created] = await db
    .insert(word)
    .values({
      userId: args.userId,
      folderId: args.folder.id,
      bookId: args.folder.bookId,
      term: args.term,
      normalizedTerm,
      dictionaryEntryId: resolved?.id ?? null,
      definitionOverride: resolved ? undefined : args.definition,
      captureMethod: args.captureMethod,
      page: args.page,
      // Snapshot at capture time — flipping the toggle later shouldn't
      // retroactively change past contributions.
      contributesToAggregate: args.contributesToAggregate,
    })
    .onConflictDoNothing({ target: [word.folderId, word.normalizedTerm] })
    .returning();

  // Forward only: a word looked up from a flashback page must not pull the
  // shelf's progress back. Runs for a duplicate capture too — the reader still
  // told us where they are, even though the word keeps its first page.
  if (args.page !== undefined) {
    await db
      .update(folder)
      .set({ currentPage: sql`greatest(coalesce(${folder.currentPage}, 0), ${args.page})` })
      .where(eq(folder.id, args.folder.id));
  }

  if (created) return created;

  // Already logged in this folder — return the existing row so tapping a
  // suggestion twice, or replaying a queued capture the server already took,
  // is a no-op rather than an error.
  const existing = await db.query.word.findFirst({
    where: and(eq(word.folderId, args.folder.id), eq(word.normalizedTerm, normalizedTerm)),
  });
  // The conflict above means the row exists.
  return existing!;
}

/**
 * A book's AI-picked words, generated at most once for the whole user base.
 *
 * `topicWordsAt` is claimed with a conditional update before the AI call,
 * exactly like `enrichedAt` on dictionary_entry: two readers opening the
 * add-word form for the same new book buy one call between them. The loser
 * gets nothing this time and sees the words on its next open.
 *
 * Every suggested word must pass the same Datamuse check a looked-up word does,
 * because a prompt does not reliably keep invented words out. A failed call, or
 * an unreachable Datamuse, releases the claim so a later open retries.
 */
async function topicWordsFor(row: typeof book.$inferSelect): Promise<TopicWordGroup[]> {
  if (row.topicWordsAt) return row.topicWords ?? [];

  const [claimed] = await db
    .update(book)
    .set({ topicWordsAt: new Date() })
    .where(and(eq(book.id, row.id), isNull(book.topicWordsAt)))
    .returning({ id: book.id });
  if (!claimed) return [];

  const suggested = await suggestTopicWords(row);
  const known = suggested && (await keepDictionaryWords([...new Set(suggested.flatMap((entry) => entry.terms))]));
  if (!suggested || !known) {
    await db.update(book).set({ topicWordsAt: null }).where(eq(book.id, row.id));
    return [];
  }

  const topics = suggested
    .map((entry) => ({ topic: entry.topic, terms: entry.terms.filter((term) => known.has(term)) }))
    .filter((entry) => entry.terms.length > 0);

  await db.update(book).set({ topicWords: topics }).where(eq(book.id, row.id));
  return topics;
}

const captureSchema = z.object({
  folderId: z.string(),
  term: z.string().min(1),
  definition: z.string().optional(),
  captureMethod: z.enum(CAPTURE_METHODS),
  page: z.number().int().min(1).max(100000).optional(),
});

/** How many queued captures one flush may carry. */
const FLUSH_LIMIT = 100;

/**
 * Per-capture outcome of a flush, so one bad row cannot strand the queue.
 *
 *   saved    written (or already present) — delete it from `pending_sync`
 *   dropped  permanently un-writable, e.g. the folder was deleted on another
 *            device — also delete it; retrying will never succeed
 *
 * Anything else (a lost connection, a database fault) throws and fails the
 * whole call, which is the signal to keep the queue and try again later.
 */
type FlushResult =
  | { localId: string; status: "saved"; wordId: string }
  | { localId: string; status: "dropped"; reason: string };

export const wordRouter = router({
  listByFolder: protectedProcedure.input(z.object({ folderId: z.string() })).query(({ ctx, input }) =>
    db.query.word.findMany({
      where: and(eq(word.folderId, input.folderId), eq(word.userId, ctx.session.user.id)),
      with: { dictionaryEntry: true },
      orderBy: desc(word.createdAt),
    }),
  ),

  // Server-side counterpart to the offline SQLite search — "search/filter
  // words across all folders" from the browsing-inventory flow.
  search: protectedProcedure.input(z.object({ query: z.string().min(1) })).query(({ ctx, input }) =>
    db.query.word.findMany({
      where: and(eq(word.userId, ctx.session.user.id), ilike(word.term, `%${input.query}%`)),
      // The folder's book comes along for the cover on each result.
      with: { dictionaryEntry: true, folder: { with: { book: true } } },
      orderBy: desc(word.createdAt),
      limit: 50,
    }),
  ),

  /** One word, saved the moment the reader taps Save. */
  create: protectedProcedure.input(captureSchema).mutation(async ({ ctx, input }) => {
    const ownedFolder = await assertFolderOwnership(ctx.session.user.id, input.folderId);

    return captureWord({
      userId: ctx.session.user.id,
      folder: ownedFolder,
      term: input.term,
      definition: input.definition,
      captureMethod: input.captureMethod,
      page: input.page,
      contributesToAggregate: await contributionDefault(ctx.session.user.id),
    });
  }),

  /**
   * Drains the device's offline queue (`pending_sync` in
   * apps/native/lib/local-db.ts) in one round trip.
   *
   * Partial success is the whole point: a folder deleted on another device
   * must not wedge every other queued word behind it, so each capture reports
   * its own outcome and the device deletes the rows this call accounted for.
   * See FlushResult for what the caller does with each status.
   *
   * `localId` is the device's own key for the queued row; it is echoed back
   * untouched and never stored, since it means nothing on the server.
   */
  createMany: protectedProcedure
    .input(
      z.object({
        captures: z.array(captureSchema.extend({ localId: z.string().min(1) }))
          .min(1)
          .max(FLUSH_LIMIT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Ownership is per folder and the preference is per user — neither is
      // per word, so both are read once for the batch instead of once per
      // capture. An unowned folder simply never lands in the map, which is
      // what turns it into a `dropped` result below rather than a 404 that
      // would take the whole flush down with it.
      const folderIds = [...new Set(input.captures.map((capture) => capture.folderId))];
      const owned = await db.query.folder.findMany({
        where: and(eq(folder.userId, userId), inArray(folder.id, folderIds)),
      });
      const ownedFolders = new Map(owned.map((row) => [row.id, row]));
      const contributesToAggregate = await contributionDefault(userId);

      const results: FlushResult[] = [];
      // ponytail: one insert per capture. Fine for a queue holding a reading
      // session's worth of words; fold into a single multi-row insert if a
      // flush ever carries hundreds.
      for (const capture of input.captures) {
        const ownedFolder = ownedFolders.get(capture.folderId);
        if (!ownedFolder) {
          results.push({
            localId: capture.localId,
            status: "dropped",
            reason: "That folder no longer exists.",
          });
          continue;
        }

        const saved = await captureWord({
          userId,
          folder: ownedFolder,
          term: capture.term,
          definition: capture.definition,
          captureMethod: capture.captureMethod,
          page: capture.page,
          contributesToAggregate,
        });
        results.push({ localId: capture.localId, status: "saved", wordId: saved.id });
      }

      return results;
    }),

  // "Words other readers of this book looked up, that you don't have yet."
  //
  // Returns terms and reader counts ONLY — no definition text. That is the
  // whole privacy model: readers share how often a word was saved, never what
  // it means. The app resolves each suggested term against its own local
  // dictionary, exactly as it does for a word the user typed.
  //
  // It also means this view structurally cannot leak a context sentence or a
  // personal note, which is the spoiler-safety requirement (SoftwareSpec §10)
  // — there is no column here that could carry one.
  suggestions: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
        // What the reader has typed so far. The add-word screen completes a
        // word from this — mostly names and invented words no dictionary has.
        // Matching only a typed prefix is also what keeps completion from
        // spoiling a word the reader hasn't met yet.
        prefix: z.string().trim().max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ownedFolder = await assertFolderOwnership(ctx.session.user.id, input.folderId);

      // Freeform folders have no book, so there is no shared population to
      // compare against. Empty list, not an error — the tab just stays quiet.
      if (!ownedFolder.bookId) return [];

      const mine = db
        .select({ term: word.normalizedTerm })
        .from(word)
        .where(eq(word.folderId, input.folderId));

      const rows = await db
        .select({
          term: sql<string>`min(${word.term})`,
          normalizedTerm: word.normalizedTerm,
          // Distinct users, not row count: one person who saved a term in ten
          // folders is still one reader.
          readers: sql<number>`count(distinct ${word.userId})::int`,
        })
        .from(word)
        .innerJoin(folder, eq(folder.id, word.folderId))
        .where(
          and(
            eq(word.bookId, ownedFolder.bookId),
            // Only shelves their readers made public count. Read live rather
            // than snapshotted, so switching a shelf back to private hides the
            // words saved on it before as well.
            eq(folder.visibility, "public"),
            eq(word.contributesToAggregate, true),
            // Your own captures never suggest themselves back to you.
            ne(word.userId, ctx.session.user.id),
            notInArray(word.normalizedTerm, mine),
            // LIKE's own wildcards are escaped, so a typed "%" matches a "%".
            // normalized_term is lowercase, so the prefix is normalized too.
            input.prefix
              ? like(word.normalizedTerm, `${normalizeTerm(input.prefix).replace(/[\\%_]/g, "\\$&")}%`)
              : undefined,
          ),
        )
        .groupBy(word.normalizedTerm)
        .orderBy(desc(sql`count(distinct ${word.userId})`), word.normalizedTerm)
        .limit(input.limit);

      return rows;
    }),

  /**
   * AI-picked words for this shelf's book, grouped by subject — the add-word
   * form's second source of new words, next to `suggestions`.
   *
   * The words are shared per book (see topicWordsFor) and are not user data,
   * so unlike `suggestions` there is no count to protect; the result still
   * leaves out words already in this folder, the same way. Empty for a
   * freeform shelf, and whenever AI or Datamuse can't answer — never an error,
   * since the form works without it.
   */
  topicWords: protectedProcedure
    // The first open for a new book waits on an AI call and a Datamuse check
    // per word; every later open is two reads. This only stops a client stuck
    // in a loop.
    .use(rateLimit({ name: "word.topicWords", max: 30, windowSeconds: 60 }))
    .input(z.object({ folderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const ownedFolder = await assertFolderOwnership(ctx.session.user.id, input.folderId);
      if (!ownedFolder.bookId) return [];

      const row = await db.query.book.findFirst({ where: eq(book.id, ownedFolder.bookId) });
      if (!row) return [];

      const [topics, inFolder] = await Promise.all([
        topicWordsFor(row),
        db.select({ term: word.normalizedTerm }).from(word).where(eq(word.folderId, input.folderId)),
      ]);
      const saved = new Set(inFolder.map((entry) => entry.term));

      return topics
        .map((entry) => ({ topic: entry.topic, terms: entry.terms.filter((term) => !saved.has(term)) }))
        .filter((entry) => entry.terms.length > 0);
    }),

  /**
   * Edits one captured word. Every field is optional and only what the caller
   * sends is written, so a flashcard stamping `reviewed` cannot blank the note
   * the user typed on the same row.
   *
   * `mastered` and `reviewed` both carry timestamps the client never sends —
   * the server owns them, so a device with a wrong clock (or an offline
   * capture replayed days later) cannot backdate a review.
   */
  /**
   * A fill-in-the-blank run over the reader's own words (UserFlow §7).
   *
   * Each card is one context sentence with the word blanked out — the reader
   * guesses from the surrounding sentence, then reveals. The sentences come
   * from `dictionary_entry.contexts`, which is shared and term-keyed, so a
   * quiz costs **nothing**: every card was generated by the one enrichment
   * call that term will ever get, however many readers quiz on it.
   *
   * The answer travels with the card. This is self-study over the reader's own
   * vocabulary, not an exam — hiding it would only mean a second round trip on
   * every reveal, and cards that stop working the moment the train enters a
   * tunnel.
   *
   * What gets excluded, and why:
   *   - mastered words, which is what "mastered" is *for* (§7: deprioritize)
   *   - words with no resolved entry, or an entry with no contexts — there is
   *     no sentence to blank, so there is no card to show
   *
   * Least-recently-reviewed first, with never-reviewed ahead of those, so a
   * session opens on what the reader has seen least rather than on whatever
   * sorts first. `word.update({ reviewed: true })` is what moves a card to the
   * back of that queue.
   */
  quiz: protectedProcedure
    .input(
      z.object({
        // Omit for a run across every folder — "pulling from any/all folders",
        // which is how the flow doc describes a review session.
        folderId: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          wordId: word.id,
          folderId: word.folderId,
          term: word.term,
          definitionOverride: word.definitionOverride,
          lastReviewedAt: word.lastReviewedAt,
          definition: dictionaryEntry.definition,
          usageNote: dictionaryEntry.usageNote,
          contexts: dictionaryEntry.contexts,
        })
        .from(word)
        // Inner join, not a left one: a word with no resolved entry cannot
        // produce a card, and carrying it here only to drop it below would
        // make `limit` mean fewer cards than it says.
        .innerJoin(dictionaryEntry, eq(word.dictionaryEntryId, dictionaryEntry.id))
        .where(
          and(
            eq(word.userId, ctx.session.user.id),
            eq(word.mastered, false),
            sql`array_length(${dictionaryEntry.contexts}, 1) > 0`,
            input.folderId ? eq(word.folderId, input.folderId) : undefined,
          ),
        )
        // `word.id` is the tie-break, and it is not decoration: words saved in
        // one batch — an offline flush, or the seed — share `createdAt` to the
        // microsecond, and without a total order Postgres is free to return
        // them differently between runs. A quiz that reshuffles itself on
        // every open would look like a bug in the session, not in a sort.
        .orderBy(sql`${word.lastReviewedAt} asc nulls first`, word.createdAt, word.id)
        .limit(input.limit);

      // ponytail: always the first context, so a word quizzed twice asks the
      // same sentence. Rotate on a stored review count if sessions start
      // feeling stale — the other contexts are already on the row.
      return rows.flatMap((row) => {
        const context = row.contexts.map(parseContext).find((parsed) => parsed !== null);
        // A row whose contexts are all malformed is skipped rather than shown
        // as a sentence with no blank in it. enrich.ts validates on the way in,
        // so this is the seam for anything written before it did.
        if (!context) return [];

        return [
          {
            wordId: row.wordId,
            folderId: row.folderId,
            term: row.term,
            /** The sentence with the word replaced by a blank. */
            prompt: context.prompt,
            /** The word as the sentence inflects it — what to reveal. */
            answer: context.answer,
            // The same rule every other screen displays by: the reader's own
            // wording wins over the shared definition.
            definition: row.definitionOverride ?? row.definition,
            /**
             * Enrichment's note on how the word is actually used — the first
             * reader the AI columns have had. Null when the entry predates
             * enrichment, or when no key was configured for it.
             */
            usageNote: row.usageNote,
            // Where this word sits in the reader's rotation, for the dot the
            // colour scheme reserves for exactly this. Mastered words never
            // reach a card, so `steady` cannot appear here — the union still
            // names it, because a list of *all* words can show one.
            state: (row.lastReviewedAt ? "learning" : "new") satisfies Mastery,
          },
        ];
      });
    }),

  /**
   * The reader's mastered words, most recently mastered first, and how many
   * there are in all. A mastered word leaves `quiz` for good; this is where the
   * Practise tab still lists it and the You tab counts it.
   */
  mastered: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const isMine = and(eq(word.userId, ctx.session.user.id), eq(word.mastered, true));
      const [words, totals] = await Promise.all([
        db.query.word.findMany({
          where: isMine,
          with: { folder: true, dictionaryEntry: true },
          orderBy: [desc(word.masteredAt), word.id],
          limit: input.limit,
        }),
        db.select({ total: sql<number>`count(*)::int` }).from(word).where(isMine),
      ]);
      return { total: totals[0]?.total ?? 0, words };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        // No definition field, on purpose: readers can't edit a definition. It
        // comes from a dictionary or the server's lookup, and a reader's own
        // wording belongs in `personalNote`. zod strips an unknown key, so an
        // old client still sending `definitionOverride` is ignored, not stored.
        // Free-form annotation alongside the definition rather than replacing
        // it (schema/word.ts). Private by construction: it never reaches the
        // aggregate, which is what keeps reading context out of suggestions.
        personalNote: z.string().optional(),
        mastered: z.boolean().optional(),
        // A flashcard turn, not a value: the client says "I just reviewed
        // this" and the server stamps when. UserFlow §7 — mastered words
        // deprioritize, reviewed ones rotate to the back.
        reviewed: z.literal(true).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const changes: Partial<{
        personalNote: string;
        mastered: boolean;
        masteredAt: Date | null;
        lastReviewedAt: Date;
      }> = {};
      if (input.personalNote !== undefined) changes.personalNote = input.personalNote;
      if (input.reviewed) changes.lastReviewedAt = new Date();
      if (input.mastered !== undefined) {
        changes.mastered = input.mastered;
        changes.masteredAt = input.mastered ? new Date() : null;
      }

      const [updated] = await db
        .update(word)
        .set(changes)
        .where(ownedBy(word, input.id, ctx.session.user.id))
        .returning();
      return assertOwned(updated, "Word");
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await db
      .delete(word)
      .where(ownedBy(word, input.id, ctx.session.user.id))
      .returning({ id: word.id });
    return assertOwned(deleted, "Word");
  }),
});
