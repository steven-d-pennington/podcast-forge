CREATE TYPE "public"."show_setup_status" AS ENUM('draft', 'active');--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "setup_status" "show_setup_status" DEFAULT 'active' NOT NULL;
