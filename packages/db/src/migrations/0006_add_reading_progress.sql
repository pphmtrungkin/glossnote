ALTER TABLE "book" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "folder" ADD COLUMN "current_page" integer;--> statement-breakpoint
ALTER TABLE "word" ADD COLUMN "page" integer;