CREATE TYPE "public"."approval_action" AS ENUM('approve', 'reject', 'override', 'revoke');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('script', 'audio-preview', 'audio-final', 'cover-art', 'research-packet', 'source-snapshot');--> statement-breakpoint
CREATE TYPE "public"."episode_candidate_status" AS ENUM('draft', 'researching', 'ready', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('draft', 'research-ready', 'script-ready', 'approved-for-audio', 'audio-ready', 'approved-for-publish', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('started', 'succeeded', 'failed', 'rolled-back');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('brave', 'rss', 'manual', 'local-json');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('new', 'shortlisted', 'ignored', 'merged');--> statement-breakpoint
CREATE TABLE "approval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid,
	"research_packet_id" uuid,
	"action" "approval_action" NOT NULL,
	"gate" text NOT NULL,
	"actor" text DEFAULT 'local-user' NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"type" "asset_type" NOT NULL,
	"label" text,
	"local_path" text,
	"object_key" text,
	"public_url" text,
	"mime_type" text,
	"byte_size" integer,
	"duration_seconds" integer,
	"checksum" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"title" text NOT NULL,
	"angle" text,
	"summary" text,
	"status" "episode_candidate_status" DEFAULT 'draft' NOT NULL,
	"score" numeric(8, 3),
	"story_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"feed_id" uuid,
	"episode_candidate_id" uuid,
	"research_packet_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"episode_number" integer,
	"status" "episode_status" DEFAULT 'draft' NOT NULL,
	"script_text" text,
	"script_format" text,
	"duration_seconds" integer,
	"published_at" timestamp with time zone,
	"feed_guid" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rss_feed_path" text,
	"public_feed_url" text,
	"public_base_url" text,
	"storage_type" text DEFAULT 'local' NOT NULL,
	"storage_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"op3_wrap" boolean DEFAULT false NOT NULL,
	"episode_number_policy" text DEFAULT 'increment' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid,
	"episode_id" uuid,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid,
	"role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"temperature" numeric(4, 2),
	"max_tokens" integer,
	"budget_usd" numeric(10, 4),
	"fallbacks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_template_key" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"role" text,
	"title" text,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"feed_id" uuid,
	"status" "publish_status" NOT NULL,
	"feed_guid" text,
	"audio_url" text,
	"cover_url" text,
	"rss_url" text,
	"changelog" text,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"episode_candidate_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"format" text,
	"default_runtime_minutes" integer,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_model_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shows_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_candidate_id" uuid,
	"url" text NOT NULL,
	"canonical_url" text,
	"title" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_status" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"content_type" text,
	"raw_html_path" text,
	"markdown_path" text,
	"text_content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" numeric(8, 3) DEFAULT '1' NOT NULL,
	"freshness" text,
	"include_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclude_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_profile_id" uuid NOT NULL,
	"query" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" numeric(8, 3) DEFAULT '1' NOT NULL,
	"region" text,
	"language" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"source_profile_id" uuid,
	"source_query_id" uuid,
	"title" text NOT NULL,
	"url" text,
	"canonical_url" text,
	"source_name" text,
	"author" text,
	"summary" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" numeric(8, 3),
	"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "story_status" DEFAULT 'new' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_research_packet_id_research_packets_id_fk" FOREIGN KEY ("research_packet_id") REFERENCES "public"."research_packets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_assets" ADD CONSTRAINT "episode_assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_candidates" ADD CONSTRAINT "episode_candidates_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_episode_candidate_id_episode_candidates_id_fk" FOREIGN KEY ("episode_candidate_id") REFERENCES "public"."episode_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_research_packet_id_research_packets_id_fk" FOREIGN KEY ("research_packet_id") REFERENCES "public"."research_packets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_events" ADD CONSTRAINT "publish_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_events" ADD CONSTRAINT "publish_events_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_packets" ADD CONSTRAINT "research_packets_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_packets" ADD CONSTRAINT "research_packets_episode_candidate_id_episode_candidates_id_fk" FOREIGN KEY ("episode_candidate_id") REFERENCES "public"."episode_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_story_candidate_id_story_candidates_id_fk" FOREIGN KEY ("story_candidate_id") REFERENCES "public"."story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_profiles" ADD CONSTRAINT "source_profiles_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_queries" ADD CONSTRAINT "source_queries_source_profile_id_source_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."source_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD CONSTRAINT "story_candidates_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD CONSTRAINT "story_candidates_source_profile_id_source_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."source_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD CONSTRAINT "story_candidates_source_query_id_source_queries_id_fk" FOREIGN KEY ("source_query_id") REFERENCES "public"."source_queries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_events_episode_idx" ON "approval_events" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "approval_events_packet_idx" ON "approval_events" USING btree ("research_packet_id");--> statement-breakpoint
CREATE INDEX "episode_assets_episode_type_idx" ON "episode_assets" USING btree ("episode_id","type");--> statement-breakpoint
CREATE INDEX "episode_candidates_show_status_idx" ON "episode_candidates" USING btree ("show_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_show_slug_idx" ON "episodes" USING btree ("show_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_show_number_idx" ON "episodes" USING btree ("show_id","episode_number");--> statement-breakpoint
CREATE INDEX "episodes_show_status_idx" ON "episodes" USING btree ("show_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_show_slug_idx" ON "feeds" USING btree ("show_id","slug");--> statement-breakpoint
CREATE INDEX "jobs_status_type_idx" ON "jobs" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "jobs_episode_idx" ON "jobs" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_profiles_show_role_idx" ON "model_profiles" USING btree ("show_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_key_version_idx" ON "prompt_templates" USING btree ("show_id","key","version");--> statement-breakpoint
CREATE INDEX "publish_events_episode_status_idx" ON "publish_events" USING btree ("episode_id","status");--> statement-breakpoint
CREATE INDEX "research_packets_show_status_idx" ON "research_packets" USING btree ("show_id","status");--> statement-breakpoint
CREATE INDEX "source_documents_url_idx" ON "source_documents" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "source_documents_story_idx" ON "source_documents" USING btree ("story_candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_profiles_show_slug_idx" ON "source_profiles" USING btree ("show_id","slug");--> statement-breakpoint
CREATE INDEX "source_profiles_show_idx" ON "source_profiles" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_queries_profile_query_idx" ON "source_queries" USING btree ("source_profile_id","query");--> statement-breakpoint
CREATE UNIQUE INDEX "story_candidates_show_url_idx" ON "story_candidates" USING btree ("show_id","canonical_url");--> statement-breakpoint
CREATE INDEX "story_candidates_show_status_idx" ON "story_candidates" USING btree ("show_id","status");--> statement-breakpoint
CREATE INDEX "story_candidates_show_score_idx" ON "story_candidates" USING btree ("show_id","score");