import { db } from "@better-vocab/db";
import { folder } from "@better-vocab/db/schema/book";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { bookInputSchema, upsertBook } from "./book";

const folderStatus = z.enum(["reading", "finished", "misc"]);

// Drizzle wraps driver errors, so the Postgres constraint name is on `cause`,
// not on the top-level message — walk the chain.
function violates(error: unknown, constraint: string) {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { constraint?: string }).constraint === constraint) return true;
  }
  return false;
}

export const folderRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    db.query.folder.findMany({
      where: eq(folder.userId, ctx.session.user.id),
      with: { book: true },
      orderBy: desc(folder.createdAt),
    }),
  ),

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
        return created;
      } catch (error) {
        // folder_userId_bookId_uidx: one folder per book per user. Unreachable
        // before book search existed; a normal mistake now that it does.
        if (violates(error, "folder_userId_bookId_uidx")) {
          throw new TRPCError({ code: "CONFLICT", message: "You already have a folder for this book." });
        }
        throw error;
      }
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: folderStatus }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(folder)
        .set({ status: input.status })
        .where(and(eq(folder.id, input.id), eq(folder.userId, ctx.session.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      return updated;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await db.delete(folder).where(and(eq(folder.id, input.id), eq(folder.userId, ctx.session.user.id)));
    return { id: input.id };
  }),
});
