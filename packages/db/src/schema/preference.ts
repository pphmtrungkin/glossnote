import { PREFERENCE_DEFAULTS } from "@better-vocab/domain";
import { relations } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { offlineDictionaryTierEnum } from "./enums";

// 1:1 extension of Better Auth's `user` table for app-specific settings, kept
// separate so Better Auth's own generated schema/migrations never touch it.
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  contributeToAggregateByDefault: boolean("contribute_to_aggregate_by_default")
    .notNull()
    .default(PREFERENCE_DEFAULTS.contributeToAggregateByDefault),
  offlineDictionaryTier: offlineDictionaryTierEnum("offline_dictionary_tier")
    .notNull()
    .default(PREFERENCE_DEFAULTS.offlineDictionaryTier),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const userPreferenceRelations = relations(userPreference, ({ one }) => ({
  user: one(user, { fields: [userPreference.userId], references: [user.id] }),
}));

export const userPreferenceUserRelations = relations(user, ({ one }) => ({
  preference: one(userPreference, { fields: [user.id], references: [userPreference.userId] }),
}));

