DROP TABLE "book_word_aggregate" CASCADE;--> statement-breakpoint
DROP TABLE "push_token" CASCADE;--> statement-breakpoint
ALTER TABLE "book" DROP COLUMN "topics";--> statement-breakpoint
ALTER TABLE "book" DROP COLUMN "raw";--> statement-breakpoint
ALTER TABLE "dictionary_entry" DROP COLUMN "audio_url";--> statement-breakpoint
ALTER TABLE "word" DROP COLUMN "example_sentence";