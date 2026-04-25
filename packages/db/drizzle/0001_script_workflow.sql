CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"research_packet_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_revision_id" uuid,
	"approved_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"format" text NOT NULL,
	"speakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author" text DEFAULT 'local-user' NOT NULL,
	"change_summary" text,
	"model_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_research_packet_id_research_packets_id_fk" FOREIGN KEY ("research_packet_id") REFERENCES "public"."research_packets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "script_revisions" ADD CONSTRAINT "script_revisions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scripts_research_packet_idx" ON "scripts" USING btree ("research_packet_id");
--> statement-breakpoint
CREATE INDEX "scripts_show_status_idx" ON "scripts" USING btree ("show_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "script_revisions_script_version_idx" ON "script_revisions" USING btree ("script_id","version");
--> statement-breakpoint
CREATE INDEX "script_revisions_script_idx" ON "script_revisions" USING btree ("script_id");
