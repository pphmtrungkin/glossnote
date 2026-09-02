CREATE TYPE "public"."capture_method" AS ENUM('manual', 'voice');--> statement-breakpoint
CREATE TYPE "public"."dictionary_source" AS ENUM('bundled', 'dictionary_api', 'ai_enhanced');--> statement-breakpoint
CREATE TYPE "public"."folder_status" AS ENUM('reading', 'finished', 'misc');--> statement-breakpoint
CREATE TYPE "public"."offline_dictionary_tier" AS ENUM('core', 'extended');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"authors" text[] DEFAULT '{}' NOT NULL,
	"cover_image_url" text,
	"description" text,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"book_id" text,
	"title" text NOT NULL,
	"status" "folder_status" DEFAULT 'reading' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"source" "dictionary_source" NOT NULL,
	"audio_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"book_id" text,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"dictionary_entry_id" text,
	"definition_override" text,
	"example_sentence" text,
	"capture_method" "capture_method" NOT NULL,
	"contributes_to_aggregate" boolean DEFAULT true NOT NULL,
	"mastered" boolean DEFAULT false NOT NULL,
	"mastered_at" timestamp,
	"last_reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"contribute_to_aggregate_by_default" boolean DEFAULT true NOT NULL,
	"offline_dictionary_tier" "offline_dictionary_tier" DEFAULT 'core' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word" ADD CONSTRAINT "word_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word" ADD CONSTRAINT "word_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word" ADD CONSTRAINT "word_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word" ADD CONSTRAINT "word_dictionary_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("dictionary_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "book_provider_externalId_uidx" ON "book" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "folder_userId_idx" ON "folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folder_bookId_idx" ON "folder" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_entry_term_uidx" ON "dictionary_entry" USING btree ("term");--> statement-breakpoint
CREATE INDEX "word_userId_idx" ON "word" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "word_folderId_idx" ON "word" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "word_normalizedTerm_idx" ON "word" USING btree ("normalized_term");--> statement-breakpoint
CREATE UNIQUE INDEX "word_folderId_normalizedTerm_uidx" ON "word" USING btree ("folder_id","normalized_term");--> statement-breakpoint
CREATE INDEX "word_bookId_contributesToAggregate_idx" ON "word" USING btree ("book_id","contributes_to_aggregate");--> statement-breakpoint
CREATE UNIQUE INDEX "push_token_token_uidx" ON "push_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_token_userId_idx" ON "push_token" USING btree ("user_id");