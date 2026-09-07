import { db } from "@better-vocab/db";
import { folder } from "@better-vocab/db/schema/book";
import { dictionaryEntry } from "@better-vocab/db/schema/dictionary";
import { userPreference } from "@better-vocab/db/schema/preference";
import { word } from "@better-vocab/db/schema/word";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

async function assertFolderOwnership(userId: string, folderId: string) {
  const owned = await db.query.folder.findFirst({
    where: and(eq(folder.id, folderId), eq(folder.userId, userId)),
  });
  if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
  return owned;
}

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

  // Covers both the offline-sync flush and the immediate online-save path —
  // the only difference is whether `definition` is already known (online) or
  // omitted, leaving the word "pending definition" (dictionaryEntryId null)
  // until a later lookup resolves it.
  create: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        term: z.string().min(1),
        definition: z.string().optional(),
        exampleSentence: z.string().optional(),
        captureMethod: z.enum(["manual", "voice"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownedFolder = await assertFolderOwnership(ctx.session.user.id, input.folderId);

      const normalizedTerm = input.term.trim().toLowerCase();

      let dictionaryEntryId: string | null = null;
      if (input.definition) {
        const [inserted] = await db
          .insert(dictionaryEntry)
          .values({
            term: normalizedTerm,
            definition: input.definition,
            exampleSentence: input.exampleSentence,
            source: "dictionary_api",
          })
          .onConflictDoNothing({ target: dictionaryEntry.term })
          .returning();
        dictionaryEntryId =
          inserted?.id ??
          (
            await db.query.dictionaryEntry.findFirst({
              where: eq(dictionaryEntry.term, normalizedTerm),
            })
          )?.id ??
          null;
      }

      const preference = await db.query.userPreference.findFirst({
        where: eq(userPreference.userId, ctx.session.user.id),
      });

      const [created] = await db
        .insert(word)
        .values({
          userId: ctx.session.user.id,
          folderId: input.folderId,
          bookId: ownedFolder.bookId,
          term: input.term,
          normalizedTerm,
          dictionaryEntryId,
          captureMethod: input.captureMethod,
          // Snapshot at capture time — flipping the global toggle later
          // shouldn't retroactively change past contributions.
          contributesToAggregate: preference?.contributeToAggregateByDefault ?? true,
        })
        .onConflictDoNothing({ target: [word.folderId, word.normalizedTerm] })
        .returning();

      if (created) return created;

      // Already logged in this folder — return the existing row so tapping a
      // crowdsourced suggestion twice (or retrying a flaky sync) is a no-op
      // rather than an error.
      return db.query.word.findFirst({
        where: and(eq(word.folderId, input.folderId), eq(word.normalizedTerm, normalizedTerm)),
      });
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
        .where(and(eq(word.id, input.id), eq(word.userId, ctx.session.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Word not found" });
      return updated;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await db.delete(word).where(and(eq(word.id, input.id), eq(word.userId, ctx.session.user.id)));
    return { id: input.id };
  }),
});
