CREATE TABLE "book_word_aggregate" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"frequency_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dictionary_entry" ADD COLUMN "example_sentence" text;--> statement-breakpoint
ALTER TABLE "dictionary_entry" ADD COLUMN "usage_note" text;--> statement-breakpoint
ALTER TABLE "dictionary_entry" ADD COLUMN "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "word" ADD COLUMN "personal_note" text;--> statement-breakpoint
ALTER TABLE "book_word_aggregate" ADD CONSTRAINT "book_word_aggregate_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_word_aggregate_bookId_normalizedTerm_uidx" ON "book_word_aggregate" USING btree ("book_id","normalized_term");--> statement-breakpoint
CREATE INDEX "book_word_aggregate_bookId_frequency_idx" ON "book_word_aggregate" USING btree ("book_id","frequency_count" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "folder_userId_bookId_uidx" ON "folder" USING btree ("user_id","book_id") WHERE "folder"."book_id" is not null;