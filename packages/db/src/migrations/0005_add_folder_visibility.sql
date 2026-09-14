CREATE TYPE "public"."folder_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "folder" ADD COLUMN "visibility" "folder_visibility" DEFAULT 'private' NOT NULL;