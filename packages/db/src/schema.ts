import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const sourceType = pgEnum('source_type', ['brave', 'zai-web', 'openrouter-perplexity', 'rss', 'manual', 'local-json']);
export const showSetupStatus = pgEnum('show_setup_status', ['draft', 'active']);
export const storyStatus = pgEnum('story_status', ['new', 'shortlisted', 'ignored', 'merged']);
export const episodeCandidateStatus = pgEnum('episode_candidate_status', ['draft', 'researching', 'ready', 'rejected']);
export const episodeStatus = pgEnum('episode_status', [
  'draft',
  'research-ready',
  'script-ready',
  'approved-for-audio',
  'audio-ready',
  'approved-for-publish',
  'published',
  'archived'
]);
export const assetType = pgEnum('asset_type', ['script', 'audio-preview', 'audio-final', 'cover-art', 'research-packet', 'source-snapshot']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const approvalAction = pgEnum('approval_action', ['approve', 'reject', 'override', 'revoke']);
export const publishStatus = pgEnum('publish_status', ['started', 'succeeded', 'failed', 'rolled-back']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const shows = pgTable('shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  setupStatus: showSetupStatus('setup_status').notNull().default('draft'),
  format: text('format'),
  defaultRuntimeMinutes: integer('default_runtime_minutes'),
  cast: jsonb('cast').$type<Array<{ name: string; role?: string; voice: string }>>().notNull().default([]),
  defaultModelProfile: jsonb('default_model_profile').$type<Record<string, string>>().notNull().default({}),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
});

export const feeds = pgTable('feeds', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  rssFeedPath: text('rss_feed_path'),
  publicFeedUrl: text('public_feed_url'),
  publicBaseUrl: text('public_base_url'),
  storageType: text('storage_type').notNull().default('local'),
  storageConfig: jsonb('storage_config').$type<Record<string, unknown>>().notNull().default({}),
  op3Wrap: boolean('op3_wrap').notNull().default(false),
  episodeNumberPolicy: text('episode_number_policy').notNull().default('increment'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showSlugIdx: uniqueIndex('feeds_show_slug_idx').on(table.showId, table.slug)
}));

export const sourceProfiles = pgTable('source_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  type: sourceType('type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  weight: numeric('weight', { precision: 8, scale: 3 }).notNull().default('1'),
  freshness: text('freshness'),
  includeDomains: jsonb('include_domains').$type<string[]>().notNull().default([]),
  excludeDomains: jsonb('exclude_domains').$type<string[]>().notNull().default([]),
  rateLimit: jsonb('rate_limit').$type<Record<string, unknown>>().notNull().default({}),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showSlugIdx: uniqueIndex('source_profiles_show_slug_idx').on(table.showId, table.slug),
  showIdx: index('source_profiles_show_idx').on(table.showId)
}));

export const sourceQueries = pgTable('source_queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceProfileId: uuid('source_profile_id').notNull().references(() => sourceProfiles.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  weight: numeric('weight', { precision: 8, scale: 3 }).notNull().default('1'),
  region: text('region'),
  language: text('language'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  profileQueryIdx: uniqueIndex('source_queries_profile_query_idx').on(table.sourceProfileId, table.query)
}));

export const scheduledPipelines = pgTable('scheduled_pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
  sourceProfileId: uuid('source_profile_id').references(() => sourceProfiles.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  workflow: jsonb('workflow').$type<string[]>().notNull().default([]),
  autopublish: boolean('autopublish').notNull().default(false),
  legacyAdapter: jsonb('legacy_adapter').$type<Record<string, unknown>>().notNull().default({}),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  lastRunJobId: uuid('last_run_job_id'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  ...timestamps
}, (table) => ({
  showSlugIdx: uniqueIndex('scheduled_pipelines_show_slug_idx').on(table.showId, table.slug),
  showEnabledIdx: index('scheduled_pipelines_show_enabled_idx').on(table.showId, table.enabled),
  nextRunIdx: index('scheduled_pipelines_next_run_idx').on(table.enabled, table.nextRunAt),
}));

export const modelProfiles = pgTable('model_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').references(() => shows.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  temperature: numeric('temperature', { precision: 4, scale: 2 }),
  maxTokens: integer('max_tokens'),
  budgetUsd: numeric('budget_usd', { precision: 10, scale: 4 }),
  fallbacks: jsonb('fallbacks').$type<string[]>().notNull().default([]),
  promptTemplateKey: text('prompt_template_key'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showRoleIdx: uniqueIndex('model_profiles_show_role_idx').on(table.showId, table.role)
}));

export const promptTemplates = pgTable('prompt_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').references(() => shows.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  version: integer('version').notNull().default(1),
  role: text('role'),
  title: text('title'),
  body: text('body').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  keyVersionIdx: uniqueIndex('prompt_templates_key_version_idx').on(table.showId, table.key, table.version)
}));

export const storyCandidates = pgTable('story_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  sourceProfileId: uuid('source_profile_id').references(() => sourceProfiles.id, { onDelete: 'set null' }),
  sourceQueryId: uuid('source_query_id').references(() => sourceQueries.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  url: text('url'),
  canonicalUrl: text('canonical_url'),
  sourceName: text('source_name'),
  author: text('author'),
  summary: text('summary'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  score: numeric('score', { precision: 8, scale: 3 }),
  scoreBreakdown: jsonb('score_breakdown').$type<Record<string, unknown>>().notNull().default({}),
  status: storyStatus('status').notNull().default('new'),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showUrlIdx: uniqueIndex('story_candidates_show_url_idx').on(table.showId, table.canonicalUrl),
  showStatusIdx: index('story_candidates_show_status_idx').on(table.showId, table.status),
  showScoreIdx: index('story_candidates_show_score_idx').on(table.showId, table.score)
}));

export const sourceDocuments = pgTable('source_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  storyCandidateId: uuid('story_candidate_id').references(() => storyCandidates.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url'),
  title: text('title'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  fetchStatus: text('fetch_status').notNull().default('pending'),
  httpStatus: integer('http_status'),
  contentType: text('content_type'),
  rawHtmlPath: text('raw_html_path'),
  markdownPath: text('markdown_path'),
  textContent: text('text_content'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  urlIdx: index('source_documents_url_idx').on(table.canonicalUrl),
  storyIdx: index('source_documents_story_idx').on(table.storyCandidateId)
}));

export const episodeCandidates = pgTable('episode_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  angle: text('angle'),
  summary: text('summary'),
  status: episodeCandidateStatus('status').notNull().default('draft'),
  score: numeric('score', { precision: 8, scale: 3 }),
  storyCandidateIds: jsonb('story_candidate_ids').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showStatusIdx: index('episode_candidates_show_status_idx').on(table.showId, table.status)
}));

export const researchPackets = pgTable('research_packets', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  episodeCandidateId: uuid('episode_candidate_id').references(() => episodeCandidates.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  sourceDocumentIds: jsonb('source_document_ids').$type<string[]>().notNull().default([]),
  claims: jsonb('claims').$type<Array<Record<string, unknown>>>().notNull().default([]),
  citations: jsonb('citations').$type<Array<Record<string, unknown>>>().notNull().default([]),
  warnings: jsonb('warnings').$type<Array<Record<string, unknown>>>().notNull().default([]),
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  ...timestamps
}, (table) => ({
  showStatusIdx: index('research_packets_show_status_idx').on(table.showId, table.status)
}));

export const scripts = pgTable('scripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  researchPacketId: uuid('research_packet_id').notNull().references(() => researchPackets.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  format: text('format').notNull(),
  status: text('status').notNull().default('draft'),
  approvedRevisionId: uuid('approved_revision_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  packetIdx: index('scripts_research_packet_idx').on(table.researchPacketId),
  showStatusIdx: index('scripts_show_status_idx').on(table.showId, table.status)
}));

export const scriptRevisions = pgTable('script_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scriptId: uuid('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  format: text('format').notNull(),
  speakers: jsonb('speakers').$type<string[]>().notNull().default([]),
  author: text('author').notNull().default('local-user'),
  changeSummary: text('change_summary'),
  modelProfile: jsonb('model_profile').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  scriptVersionIdx: uniqueIndex('script_revisions_script_version_idx').on(table.scriptId, table.version),
  scriptIdx: index('script_revisions_script_idx').on(table.scriptId)
}));

export const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
  episodeCandidateId: uuid('episode_candidate_id').references(() => episodeCandidates.id, { onDelete: 'set null' }),
  researchPacketId: uuid('research_packet_id').references(() => researchPackets.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  episodeNumber: integer('episode_number'),
  status: episodeStatus('status').notNull().default('draft'),
  scriptText: text('script_text'),
  scriptFormat: text('script_format'),
  durationSeconds: integer('duration_seconds'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  feedGuid: text('feed_guid'),
  warnings: jsonb('warnings').$type<Array<Record<string, unknown>>>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  showSlugIdx: uniqueIndex('episodes_show_slug_idx').on(table.showId, table.slug),
  showNumberIdx: uniqueIndex('episodes_show_number_idx').on(table.showId, table.episodeNumber),
  showStatusIdx: index('episodes_show_status_idx').on(table.showId, table.status)
}));

export const episodeAssets = pgTable('episode_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  type: assetType('type').notNull(),
  label: text('label'),
  localPath: text('local_path'),
  objectKey: text('object_key'),
  publicUrl: text('public_url'),
  mimeType: text('mime_type'),
  byteSize: integer('byte_size'),
  durationSeconds: integer('duration_seconds'),
  checksum: text('checksum'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  episodeTypeIdx: index('episode_assets_episode_type_idx').on(table.episodeId, table.type)
}));

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').references(() => shows.id, { onDelete: 'cascade' }),
  episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: jobStatus('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(1),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>().notNull().default({}),
  logs: jsonb('logs').$type<Array<Record<string, unknown>>>().notNull().default([]),
  error: text('error'),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ...timestamps
}, (table) => ({
  statusTypeIdx: index('jobs_status_type_idx').on(table.status, table.type),
  episodeIdx: index('jobs_episode_idx').on(table.episodeId)
}));

export const approvalEvents = pgTable('approval_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
  researchPacketId: uuid('research_packet_id').references(() => researchPackets.id, { onDelete: 'cascade' }),
  action: approvalAction('action').notNull(),
  gate: text('gate').notNull(),
  actor: text('actor').notNull().default('local-user'),
  reason: text('reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  episodeIdx: index('approval_events_episode_idx').on(table.episodeId),
  packetIdx: index('approval_events_packet_idx').on(table.researchPacketId)
}));

export const publishEvents = pgTable('publish_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
  status: publishStatus('status').notNull(),
  feedGuid: text('feed_guid'),
  audioUrl: text('audio_url'),
  coverUrl: text('cover_url'),
  rssUrl: text('rss_url'),
  changelog: text('changelog'),
  error: text('error'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  episodeStatusIdx: index('publish_events_episode_status_idx').on(table.episodeId, table.status)
}));

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
