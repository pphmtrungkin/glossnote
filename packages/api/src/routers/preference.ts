import { OFFLINE_DICTIONARY_TIERS, PREFERENCE_DEFAULTS } from "@better-vocab/domain";
import { db } from "@better-vocab/db";
import { userPreference } from "@better-vocab/db/schema/preference";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

/**
 * The user's own settings. One row per user, created on first write.
 *
 * `user_preference` had no router at all: `word.create` read
 * `contributeToAggregateByDefault` to decide whether a capture joins the
 * crowdsourced aggregate, but nothing let a reader change it — the opt-out the
 * privacy model promises existed only as a column.
 */
export const preferenceRouter = router({
  /**
   * Never writes. A user who has not saved a setting has no row, and gets the
   * same defaults the column would have applied — so the settings screen can
   * render immediately without a write on first open.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const saved = await db.query.userPreference.findFirst({
      where: eq(userPreference.userId, ctx.session.user.id),
    });
    return saved ?? { userId: ctx.session.user.id, ...PREFERENCE_DEFAULTS };
  }),

  /**
   * Upsert, so the first change creates the row. Fields are individually
   * optional: a toggle sends only what it changed rather than having to echo
   * back the rest of the settings screen.
   *
   * `updatedAt` is always in the SET clause, which both keeps the timestamp
   * honest on the conflict path (`$onUpdate` only fires for a plain UPDATE)
   * and means the clause is never empty when the caller sends no fields.
   */
  update: protectedProcedure
    .input(
      z.object({
        contributeToAggregateByDefault: z.boolean().optional(),
        offlineDictionaryTier: z.enum(OFFLINE_DICTIONARY_TIERS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const changes = {
        ...(input.contributeToAggregateByDefault !== undefined && {
          contributeToAggregateByDefault: input.contributeToAggregateByDefault,
        }),
        ...(input.offlineDictionaryTier !== undefined && {
          offlineDictionaryTier: input.offlineDictionaryTier,
        }),
      };

      const [saved] = await db
        .insert(userPreference)
        .values({ userId: ctx.session.user.id, ...changes })
        .onConflictDoUpdate({
          target: userPreference.userId,
          set: { ...changes, updatedAt: new Date() },
        })
        .returning();

      // An upsert always returns its row.
      return saved!;
    }),
});
