import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { book, folder } from "./book";
import { dictionaryEntry } from "./dictionary";
import { captureMethodEnum } from "./enums";

export const word = pgTable(
  "word",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // Denormalized alongside folderId so "search/filter across all folders"
    // doesn't need a join through folder just to scope by owner.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => folder.id, { onDelete: "cascade" }),
    // Denormalized from folder.bookId at capture time so the crowdsourced
    // "words other readers found in this book" query doesn't need to join
    // through folder. Safe: no mutation reassigns folder.bookId after
    // creation today (see packages/api/src/routers/folder.ts) — if that ever
    // changes, this column needs a backfill alongside it.
    bookId: text("book_id").references(() => book.id, { onDelete: "set null" }),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    // Null while "pending definition" (offline, not yet resolved).
    dictionaryEntryId: text("dictionary_entry_id").references(() => dictionaryEntry.id, { onDelete: "set null" }),
    // Personal edit that overrides the shared dictionaryEntry.definition for
    // this user's copy, without mutating the shared cache other users read.
    definitionOverride: text("definition_override"),
    // AI-generated, contextual to this capture — deliberately not on
    // dictionaryEntry, since the crowdsourced view must never show it.
    exampleSentence: text("example_sentence"),
    captureMethod: captureMethodEnum("capture_method").notNull(),
    // Snapshot of the user's opt-out preference at capture time, so flipping
    // the global toggle later doesn't retroactively change past contributions.
    contributesToAggregate: boolean("contributes_to_aggregate").notNull().default(true),
    mastered: boolean("mastered").notNull().default(false),
    masteredAt: timestamp("mastered_at"),
    lastReviewedAt: timestamp("last_reviewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("word_userId_idx").on(table.userId),
    index("word_folderId_idx").on(table.folderId),
    // Backs dictionary lookups.
    index("word_normalizedTerm_idx").on(table.normalizedTerm),
    // Prevents the same term being logged twice in one folder — also what
    // makes "tap a crowdsourced suggestion to add it to my folder" idempotent.
    uniqueIndex("word_folderId_normalizedTerm_uidx").on(table.folderId, table.normalizedTerm),
    // Backs the crowdsourced frequency aggregate: WHERE bookId = ? AND
    // contributesToAggregate = true GROUP BY normalizedTerm.
    index("word_bookId_contributesToAggregate_idx").on(table.bookId, table.contributesToAggregate),
  ],
);

export const wordRelations = relations(word, ({ one }) => ({
  user: one(user, { fields: [word.userId], references: [user.id] }),
  folder: one(folder, { fields: [word.folderId], references: [folder.id] }),
  book: one(book, { fields: [word.bookId], references: [book.id] }),
  dictionaryEntry: one(dictionaryEntry, {
    fields: [word.dictionaryEntryId],
    references: [dictionaryEntry.id],
  }),
}));

export const folderWordsRelations = relations(folder, ({ many }) => ({ words: many(word) }));
export const bookWordsRelations = relations(book, ({ many }) => ({ words: many(word) }));
export const dictionaryEntryWordsRelations = relations(dictionaryEntry, ({ many }) => ({ words: many(word) }));
export const userWordsRelations = relations(user, ({ many }) => ({ words: many(word) }));
