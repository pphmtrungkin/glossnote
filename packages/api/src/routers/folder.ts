import { FOLDER_STATUSES, FOLDER_VISIBILITIES } from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { folder } from "@better-vocab/db/schema/book";
import { word } from "@better-vocab/db/schema/word";
import { TRPCError } from "@trpc/server";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { assertOwned, ownedBy } from "../ownership";
import { bookInputSchema, upsertBook } from "./book";

const folderStatus = z.enum(FOLDER_STATUSES);
const folderVisibility = z.enum(FOLDER_VISIBILITIES);

// Drizzle wraps driver errors, so the Postgres constraint name is on `cause`,
// not on the top-level message — walk the chain.
function violates(error: unknown, constraint: string) {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { constraint?: string }).constraint === constraint) return true;
  }
  return false;
}

export const folderRouter = router({
  /**
   * Every folder on the shelf, newest first, with its word count.
   *
   * The count is one grouped query rather than a subquery per row: the shelf
   * and the home page both show it, and a folder with no words never appears
   * in the group-by, which is what the `?? 0` covers.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [folders, counts] = await Promise.all([
      db.query.folder.findMany({
        where: eq(folder.userId, ctx.session.user.id),
        with: { book: true },
        orderBy: desc(folder.createdAt),
      }),
      db
        .select({ folderId: word.folderId, words: count() })
        .from(word)
        .where(eq(word.userId, ctx.session.user.id))
        .groupBy(word.folderId),
    ]);

    const byFolder = new Map(counts.map((row) => [row.folderId, row.words]));
    return folders.map((row) => ({ ...row, wordCount: byFolder.get(row.id) ?? 0 }));
  }),

  // Takes the picked search result, not a bookId: the book row is upserted
  // here so linking is one round trip, and so a client can't hand us an
  // arbitrary foreign key. Omit `book` entirely for a freeform folder, or when
  // the user typed a title offline and book search never ran.
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        status: folderStatus.default("reading"),
        book: bookInputSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bookId = input.book ? await upsertBook(input.book) : null;

      try {
        const [created] = await db
          .insert(folder)
          .values({
            userId: ctx.session.user.id,
            title: input.title,
            status: input.status,
            bookId,
          })
          .returning();
        // A successful insert returns exactly one row; the only failure mode
        // is the unique-index conflict caught below.
        return created!;
      } catch (error) {
        // folder_userId_bookId_uidx: one folder per book per user. Unreachable
        // before book search existed; a normal mistake now that it does.
        if (violates(error, "folder_userId_bookId_uidx")) {
          throw new TRPCError({ code: "CONFLICT", message: "You already have a folder for this book." });
        }
        throw error;
      }
    }),

  /**
   * Renames a folder and/or moves its status chip. Both fields are optional so
   * the shelf's status chips send only `status`, exactly as they did when this
   * was `updateStatus`.
   *
   * `title` is the folder's own label, not the book's: it is denormalized from
   * `book.title` at creation and diverges deliberately after ("Dune — book
   * club"). Renaming never touches the shared `book` row, which every other
   * reader of that book joins to.
   *
   * There is still no way to change `bookId` — see the aggregate note in
   * CLAUDE.md: `word.bookId` is snapshotted at capture time, so relinking a
   * folder would strand its existing words unless the same transaction moved
   * them too.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        status: folderStatus.optional(),
        // Private by default. Public lets this shelf's words count toward
        // what other readers of the book see (word.suggestions).
        visibility: folderVisibility.optional(),
        // Any page, backwards included (a re-read); null clears it. Not checked
        // against book.pages, which is one edition's count.
        currentPage: z.number().int().min(0).max(100000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(folder)
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.visibility !== undefined && { visibility: input.visibility }),
          ...(input.currentPage !== undefined && { currentPage: input.currentPage }),
          // Also keeps the SET clause non-empty when a caller sends neither.
          updatedAt: new Date(),
        })
        .where(ownedBy(folder, input.id, ctx.session.user.id))
        .returning();
      return assertOwned(updated, "Folder");
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const [deleted] = await db
      .delete(folder)
      .where(ownedBy(folder, input.id, ctx.session.user.id))
      .returning({ id: folder.id });
    return assertOwned(deleted, "Folder");
  }),
});
