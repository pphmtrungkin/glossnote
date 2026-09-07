import { CAPTURE_METHODS, type CaptureMethod, PREFERENCE_DEFAULTS, normalizeTerm } from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { folder } from "@better-vocab/db/schema/book";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { userPreference } from "@better-vocab/db/schema/preference";
import { word } from "@better-vocab/db/schema/word";
import { and, desc, eq, ilike, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
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
 * `definition` is whatever the user's own device resolved — from the bundled
 * dictionary offline, or typed by hand — and it is stored on THIS user's row
 * as `definitionOverride`. It is deliberately NOT written into the shared
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
      // Snapshot at capture time — flipping the toggle later shouldn't
      // retroactively change past contributions.
      contributesToAggregate: args.contributesToAggregate,
    })
    .onConflictDoNothing({ target: [word.folderId, word.normalizedTerm] })
    .returning();

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

const captureSchema = z.object({
  folderId: z.string(),
  term: z.string().min(1),
  definition: z.string().optional(),
  captureMethod: z.enum(CAPTURE_METHODS),
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
      with: { dictionaryEntry: true, folder: true },
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
    .input(z.object({ folderId: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
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
        .where(
          and(
            eq(word.bookId, ownedFolder.bookId),
            eq(word.contributesToAggregate, true),
            // Your own captures never suggest themselves back to you.
            ne(word.userId, ctx.session.user.id),
            notInArray(word.normalizedTerm, mine),
          ),
        )
        .groupBy(word.normalizedTerm)
        .orderBy(desc(sql`count(distinct ${word.userId})`), word.normalizedTerm)
        .limit(input.limit);

      return rows;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        definitionOverride: z.string().optional(),
        mastered: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const changes: Partial<{ definitionOverride: string; mastered: boolean; masteredAt: Date | null }> = {};
      if (input.definitionOverride !== undefined) changes.definitionOverride = input.definitionOverride;
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
