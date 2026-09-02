import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { offlineDictionaryTierEnum } from "./enums";

// 1:1 extension of Better Auth's `user` table for app-specific settings, kept
// separate so Better Auth's own generated schema/migrations never touch it.
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  contributeToAggregateByDefault: boolean("contribute_to_aggregate_by_default").notNull().default(true),
  offlineDictionaryTier: offlineDictionaryTierEnum("offline_dictionary_tier").notNull().default("core"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const pushToken = pgTable(
  "push_token",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_token_token_uidx").on(table.token),
    index("push_token_userId_idx").on(table.userId),
  ],
);

export const userPreferenceRelations = relations(userPreference, ({ one }) => ({
  user: one(user, { fields: [userPreference.userId], references: [user.id] }),
}));

export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, { fields: [pushToken.userId], references: [user.id] }),
}));

export const userPreferenceUserRelations = relations(user, ({ one }) => ({
  preference: one(userPreference, { fields: [user.id], references: [userPreference.userId] }),
}));

export const userPushTokenRelations = relations(user, ({ many }) => ({
  pushTokens: many(pushToken),
}));
