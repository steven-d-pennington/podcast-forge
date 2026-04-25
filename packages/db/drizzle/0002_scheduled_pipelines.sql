CREATE TABLE "scheduled_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"feed_id" uuid,
	"source_profile_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"workflow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"autopublish" boolean DEFAULT false NOT NULL,
	"legacy_adapter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_job_id" uuid,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_pipelines" ADD CONSTRAINT "scheduled_pipelines_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_pipelines" ADD CONSTRAINT "scheduled_pipelines_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_pipelines" ADD CONSTRAINT "scheduled_pipelines_source_profile_id_source_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."source_profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_pipelines_show_slug_idx" ON "scheduled_pipelines" USING btree ("show_id","slug");
--> statement-breakpoint
CREATE INDEX "scheduled_pipelines_show_enabled_idx" ON "scheduled_pipelines" USING btree ("show_id","enabled");
--> statement-breakpoint
CREATE INDEX "scheduled_pipelines_next_run_idx" ON "scheduled_pipelines" USING btree ("enabled","next_run_at");
