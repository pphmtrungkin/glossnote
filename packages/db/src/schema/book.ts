import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { folderStatusEnum, folderVisibilityEnum } from "./enums";

/** One subject area a book draws on, and dictionary words worth knowing for it. */
export type TopicWordGroup = { topic: string; terms: string[] };

export const book = pgTable(
  "book",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // Free text, not an enum. `hardcover` is the only value written today (by
    // book.search, and by the seed), but a Postgres enum would need a
    // migration every time another source — Google Books, Open Library, manual
    // entry — is added, and the unique index below is what actually matters.
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    authors: text("authors").array().notNull().default([]),
    coverImageUrl: text("cover_image_url"),
    description: text("description"),
    // The add-word form's AI-picked words for this book: Datamuse-checked
    // dictionary words, grouped by subject. Keyed by book and shared by every
    // reader of it, so a book costs one AI call however many readers add words
    // to it — the same cost model as dictionary_entry. Never user data.
    topicWords: jsonb("topic_words").$type<TopicWordGroup[]>(),
    // Marker and lock, like dictionary_entry.enriched_at: claimed with a
    // conditional update before the call, released if the call fails.
    topicWordsAt: timestamp("topic_words_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("book_provider_externalId_uidx").on(table.provider, table.externalId)],
);

export const folder = pgTable(
  "folder",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null for freeform/misc folders that skip book search entirely.
    bookId: text("book_id").references(() => book.id, { onDelete: "set null" }),
    // Denormalized from book.title (or freely typed for freeform folders) so the
    // home list renders without a join.
    title: text("title").notNull(),
    status: folderStatusEnum("status").notNull().default("reading"),
    // Private by default: a shelf's words count toward what other readers of
    // the same book see only once its reader makes it public — and even then
    // only as counts, never definitions, notes or the shelf itself. Read live
    // by word.suggestions, so switching back to private hides earlier words too.
    visibility: folderVisibilityEnum("visibility").notNull().default("private"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("folder_userId_idx").on(table.userId),
    index("folder_bookId_idx").on(table.bookId),
    // SoftwareSpec §4.1: unique(user_id, book_id) where book_id is not null.
    // Partial by necessity — a user may hold many freeform folders, which all
    // carry bookId null, and in Postgres nulls never collide in a plain unique
    // index anyway. Stated explicitly so the intent survives a future edit:
    // one folder per book per user, unlimited freeform folders.
    uniqueIndex("folder_userId_bookId_uidx")
      .on(table.userId, table.bookId)
      .where(sql`${table.bookId} is not null`),
  ],
);

export const bookRelations = relations(book, ({ many }) => ({
  folders: many(folder),
}));

export const folderRelations = relations(folder, ({ one }) => ({
  user: one(user, { fields: [folder.userId], references: [user.id] }),
  book: one(book, { fields: [folder.bookId], references: [book.id] }),
}));

export const userFolderRelations = relations(user, ({ many }) => ({
  folders: many(folder),
}));
