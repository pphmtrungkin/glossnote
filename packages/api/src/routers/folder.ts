import { db } from "@better-vocab/db";
import { folder } from "@better-vocab/db/schema/book";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

const folderStatus = z.enum(["reading", "finished", "misc"]);

export const folderRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    db.query.folder.findMany({
      where: eq(folder.userId, ctx.session.user.id),
      with: { book: true },
      orderBy: desc(folder.createdAt),
    }),
  ),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        status: folderStatus.default("reading"),
        bookId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await db
        .insert(folder)
        .values({
          userId: ctx.session.user.id,
          title: input.title,
          status: input.status,
          bookId: input.bookId,
        })
        .returning();
      return created;
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
