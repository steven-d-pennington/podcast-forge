import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  approvalEvents,
  createDb,
  episodeAssets,
  episodes,
  feeds,
  jobs,
  modelProfiles,
  promptTemplates,
  publishEvents,
  researchPackets,
  scriptRevisions,
  scripts,
  scheduledPipelines,
  shows,
  sourceDocuments,
  sourceProfiles,
  sourceQueries,
  storyCandidates,
} from '@podcast-forge/db';

import type {
  CandidateDedupeKey,
  CreateJobInput,
  CreateStoryCandidateInput,
  JobRecord,
  SearchJobStore,
  StoryCandidateListFilter,
  StoryCandidateRecord,
  UpdateJobInput,
  UpdateStoryCandidateScoringInput,
} from '../search/store.js';
import type {
  CreateResearchPacketInput,
  CreateSourceDocumentInput,
  OverrideResearchWarningInput,
  ResearchCitation,
  ResearchClaim,
  ResearchPacketRecord,
  ResearchStore,
  ResearchWarning,
  SourceDocumentRecord,
} from '../research/store.js';
import type {
  ApproveScriptRevisionInput,
  CreateScriptRevisionInput,
  CreateScriptWithRevisionInput,
  ListScriptsFilter,
  ScriptRecord,
  ScriptRevisionRecord,
  ScriptStore,
} from '../scripts/store.js';
import { isModelRole } from '../models/roles.js';
import type {
  CreateModelProfileInput,
  ModelProfileRecord,
  ModelProfileStore,
  UpdateModelProfileInput,
} from '../models/store.js';
import { promptTemplateFromDbRow } from '../prompts/store.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type {
  CreateEpisodeAssetInput,
  CreateFeedInput,
  CreateEpisodeFromScriptInput,
  EpisodeAssetRecord,
  EpisodeRecord,
  FeedRecord,
  ProductionStore,
  PublishEventRecord,
  UpdateFeedInput,
  UpdateEpisodeProductionInput,
} from '../production/store.js';
import type {
  CreateScheduledPipelineInput,
  ScheduledPipelineRecord,
  ScheduledRunListFilter,
  SchedulerStore,
  UpdateScheduledPipelineInput,
} from '../scheduler/store.js';
import type {
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  CreateShowInput,
  ShowRecord,
  SourceProfileRecord,
  SourceQueryRecord,
  SourceStore,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
  UpdateShowInput,
} from './store.js';

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asJsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
  }) : [];
}

function asResearchClaims(value: unknown): ResearchClaim[] {
  return Array.isArray(value) ? value.filter((item): item is ResearchClaim => {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
  }) : [];
}

function asResearchCitations(value: unknown): ResearchCitation[] {
  return Array.isArray(value) ? value.filter((item): item is ResearchCitation => {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
  }) : [];
}

function asResearchWarnings(value: unknown): ResearchWarning[] {
  return Array.isArray(value) ? value.filter((item): item is ResearchWarning => {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item));
  }) : [];
}

function asCast(value: unknown): Array<{ name: string; role?: string; voice: string }> {
  return Array.isArray(value) ? value.filter((item): item is { name: string; role?: string; voice: string } => {
    return Boolean(
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && 'name' in item
      && typeof item.name === 'string'
      && 'voice' in item
      && typeof item.voice === 'string',
    );
  }) : [];
}

function toJsonRecords<T extends object>(values: T[]): Array<Record<string, unknown>> {
  return values.map((value) => value as unknown as Record<string, unknown>);
}

function mapShow(row: typeof shows.$inferSelect): ShowRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    setupStatus: row.setupStatus,
    format: row.format,
    defaultRuntimeMinutes: row.defaultRuntimeMinutes,
    cast: asCast(row.cast),
    defaultModelProfile: asJsonObject(row.defaultModelProfile) as Record<string, string>,
    settings: asJsonObject(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProfile(row: typeof sourceProfiles.$inferSelect): SourceProfileRecord {
  return {
    id: row.id,
    showId: row.showId,
    slug: row.slug,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    weight: Number(row.weight),
    freshness: row.freshness,
    includeDomains: row.includeDomains,
    excludeDomains: row.excludeDomains,
    rateLimit: row.rateLimit,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapQuery(row: typeof sourceQueries.$inferSelect): SourceQueryRecord {
  const config = asJsonObject(row.config);

  return {
    id: row.id,
    sourceProfileId: row.sourceProfileId,
    query: row.query,
    enabled: row.enabled,
    weight: Number(row.weight),
    region: row.region,
    language: row.language,
    freshness: typeof config.freshness === 'string' ? config.freshness : null,
    includeDomains: asStringArray(config.includeDomains),
    excludeDomains: asStringArray(config.excludeDomains),
    config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapJob(row: typeof jobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    showId: row.showId,
    episodeId: row.episodeId,
    type: row.type,
    status: row.status,
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    input: row.input,
    output: row.output,
    logs: asJsonArray(row.logs),
    error: row.error,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapScheduledPipeline(row: typeof scheduledPipelines.$inferSelect): ScheduledPipelineRecord {
  return {
    id: row.id,
    showId: row.showId,
    feedId: row.feedId,
    sourceProfileId: row.sourceProfileId,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled,
    cron: row.cron,
    timezone: row.timezone,
    workflow: asStringArray(row.workflow) as ScheduledPipelineRecord['workflow'],
    autopublish: row.autopublish,
    legacyAdapter: asJsonObject(row.legacyAdapter),
    config: asJsonObject(row.config),
    lastRunJobId: row.lastRunJobId,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapStoryCandidate(row: typeof storyCandidates.$inferSelect): StoryCandidateRecord {
  return {
    id: row.id,
    showId: row.showId,
    sourceProfileId: row.sourceProfileId,
    sourceQueryId: row.sourceQueryId,
    title: row.title,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    sourceName: row.sourceName,
    author: row.author,
    summary: row.summary,
    publishedAt: row.publishedAt,
    discoveredAt: row.discoveredAt,
    score: row.score === null ? null : Number(row.score),
    scoreBreakdown: row.scoreBreakdown,
    status: row.status,
    rawPayload: row.rawPayload,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSourceDocument(row: typeof sourceDocuments.$inferSelect): SourceDocumentRecord {
  return {
    id: row.id,
    storyCandidateId: row.storyCandidateId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    fetchedAt: row.fetchedAt,
    fetchStatus: row.fetchStatus,
    httpStatus: row.httpStatus,
    contentType: row.contentType,
    textContent: row.textContent,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapResearchPacket(row: typeof researchPackets.$inferSelect): ResearchPacketRecord {
  return {
    id: row.id,
    showId: row.showId,
    episodeCandidateId: row.episodeCandidateId,
    title: row.title,
    status: row.status,
    sourceDocumentIds: asStringArray(row.sourceDocumentIds),
    claims: asResearchClaims(row.claims),
    citations: asResearchCitations(row.citations),
    warnings: asResearchWarnings(row.warnings),
    content: asJsonObject(row.content),
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapScript(row: typeof scripts.$inferSelect): ScriptRecord {
  return {
    id: row.id,
    showId: row.showId,
    researchPacketId: row.researchPacketId,
    title: row.title,
    format: row.format,
    status: row.status,
    approvedRevisionId: row.approvedRevisionId,
    approvedAt: row.approvedAt,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapScriptRevision(row: typeof scriptRevisions.$inferSelect): ScriptRevisionRecord {
  return {
    id: row.id,
    scriptId: row.scriptId,
    version: row.version,
    title: row.title,
    body: row.body,
    format: row.format,
    speakers: asStringArray(row.speakers),
    author: row.author,
    changeSummary: row.changeSummary,
    modelProfile: asJsonObject(row.modelProfile),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
  };
}

function mapEpisode(row: typeof episodes.$inferSelect): EpisodeRecord {
  return {
    id: row.id,
    showId: row.showId,
    feedId: row.feedId,
    episodeCandidateId: row.episodeCandidateId,
    researchPacketId: row.researchPacketId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    episodeNumber: row.episodeNumber,
    status: row.status,
    scriptText: row.scriptText,
    scriptFormat: row.scriptFormat,
    durationSeconds: row.durationSeconds,
    publishedAt: row.publishedAt,
    feedGuid: row.feedGuid,
    warnings: asJsonArray(row.warnings),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEpisodeAsset(row: typeof episodeAssets.$inferSelect): EpisodeAssetRecord {
  return {
    id: row.id,
    episodeId: row.episodeId,
    type: row.type,
    label: row.label,
    localPath: row.localPath,
    objectKey: row.objectKey,
    publicUrl: row.publicUrl,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    durationSeconds: row.durationSeconds,
    checksum: row.checksum,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFeed(row: typeof feeds.$inferSelect): FeedRecord {
  return {
    id: row.id,
    showId: row.showId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    rssFeedPath: row.rssFeedPath,
    publicFeedUrl: row.publicFeedUrl,
    publicBaseUrl: row.publicBaseUrl,
    storageType: row.storageType,
    storageConfig: asJsonObject(row.storageConfig),
    op3Wrap: row.op3Wrap,
    episodeNumberPolicy: row.episodeNumberPolicy,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPublishEvent(row: typeof publishEvents.$inferSelect): PublishEventRecord {
  return {
    id: row.id,
    episodeId: row.episodeId,
    feedId: row.feedId,
    status: row.status,
    feedGuid: row.feedGuid,
    audioUrl: row.audioUrl,
    coverUrl: row.coverUrl,
    rssUrl: row.rssUrl,
    changelog: row.changelog,
    error: row.error,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapModelProfile(row: typeof modelProfiles.$inferSelect): ModelProfileRecord {
  if (!isModelRole(row.role)) {
    throw new Error(`Unknown model profile role in database: ${row.role}`);
  }

  return {
    id: row.id,
    showId: row.showId,
    role: row.role,
    provider: row.provider,
    model: row.model,
    temperature: row.temperature === null ? null : Number(row.temperature),
    maxTokens: row.maxTokens,
    budgetUsd: row.budgetUsd === null ? null : Number(row.budgetUsd),
    fallbacks: asStringArray(row.fallbacks),
    promptTemplateKey: row.promptTemplateKey,
    config: asJsonObject(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function queryConfig(input: CreateSourceQueryInput | UpdateSourceQueryInput, current: JsonObject = {}): JsonObject {
  const config = { ...current, ...input.config };

  if ('freshness' in input) {
    if (input.freshness) {
      config.freshness = input.freshness;
    } else {
      delete config.freshness;
    }
  }

  if ('includeDomains' in input) {
    config.includeDomains = input.includeDomains ?? [];
  }

  if ('excludeDomains' in input) {
    config.excludeDomains = input.excludeDomains ?? [];
  }

  return config;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);

  return slug || 'episode';
}

export function createDbSourceStore(connectionString = process.env.DATABASE_URL): SourceStore & SearchJobStore & ResearchStore & ModelProfileStore & PromptTemplateStore & ScriptStore & ProductionStore & SchedulerStore {
  const { db, pool } = createDb(connectionString);

  return {
    async listShows() {
      const rows = await db.select().from(shows).orderBy(asc(shows.slug));
      return rows.map(mapShow);
    },

    async createShow(input: CreateShowInput) {
      const [row] = await db.insert(shows).values({
        slug: input.slug,
        title: input.title,
        description: input.description,
        setupStatus: input.setupStatus,
        format: input.format,
        defaultRuntimeMinutes: input.defaultRuntimeMinutes,
        cast: input.cast,
        defaultModelProfile: input.defaultModelProfile,
        settings: input.settings,
      }).returning();

      return mapShow(row);
    },

    async updateShow(id: string, input: UpdateShowInput) {
      const [row] = await db.update(shows)
        .set({
          ...('slug' in input ? { slug: input.slug } : {}),
          ...('title' in input ? { title: input.title } : {}),
          ...('description' in input ? { description: input.description } : {}),
          ...('setupStatus' in input ? { setupStatus: input.setupStatus } : {}),
          ...('format' in input ? { format: input.format } : {}),
          ...('defaultRuntimeMinutes' in input ? { defaultRuntimeMinutes: input.defaultRuntimeMinutes } : {}),
          ...('cast' in input ? { cast: input.cast } : {}),
          ...('defaultModelProfile' in input ? { defaultModelProfile: input.defaultModelProfile } : {}),
          ...('settings' in input ? { settings: input.settings } : {}),
          updatedAt: new Date(),
        })
        .where(eq(shows.id, id))
        .returning();

      return row ? mapShow(row) : undefined;
    },

    async listModelProfiles(filter = {}) {
      let showId = filter.showId;

      if (!showId && filter.showSlug) {
        const [show] = await db.select().from(shows).where(eq(shows.slug, filter.showSlug)).limit(1);

        if (!show) {
          return [];
        }

        showId = show.id;
      }

      const roleWhere = filter.role ? eq(modelProfiles.role, filter.role) : undefined;
      const showWhere = showId
        ? filter.includeGlobal
          ? or(eq(modelProfiles.showId, showId), isNull(modelProfiles.showId))
          : eq(modelProfiles.showId, showId)
        : undefined;
      const where = roleWhere && showWhere ? and(roleWhere, showWhere) : roleWhere ?? showWhere;
      const rows = where
        ? await db.select().from(modelProfiles).where(where).orderBy(asc(modelProfiles.role), desc(modelProfiles.updatedAt))
        : await db.select().from(modelProfiles).orderBy(asc(modelProfiles.role), desc(modelProfiles.updatedAt));

      return rows.map(mapModelProfile);
    },

    async getModelProfile(id) {
      const [row] = await db.select().from(modelProfiles).where(eq(modelProfiles.id, id)).limit(1);
      return row ? mapModelProfile(row) : undefined;
    },

    async createModelProfile(input: CreateModelProfileInput) {
      const [row] = await db.insert(modelProfiles).values({
        showId: input.showId,
        role: input.role,
        provider: input.provider,
        model: input.model,
        temperature: input.temperature === null ? null : input.temperature?.toString(),
        maxTokens: input.maxTokens,
        budgetUsd: input.budgetUsd === null ? null : input.budgetUsd?.toString(),
        fallbacks: input.fallbacks,
        promptTemplateKey: input.promptTemplateKey,
        config: input.config,
      }).returning();

      return mapModelProfile(row);
    },

    async updateModelProfile(id: string, input: UpdateModelProfileInput) {
      const [row] = await db.update(modelProfiles)
        .set({
          ...('provider' in input ? { provider: input.provider } : {}),
          ...('model' in input ? { model: input.model } : {}),
          ...('temperature' in input ? { temperature: input.temperature === null ? null : input.temperature?.toString() } : {}),
          ...('maxTokens' in input ? { maxTokens: input.maxTokens } : {}),
          ...('budgetUsd' in input ? { budgetUsd: input.budgetUsd === null ? null : input.budgetUsd?.toString() } : {}),
          ...('fallbacks' in input ? { fallbacks: input.fallbacks } : {}),
          ...('promptTemplateKey' in input ? { promptTemplateKey: input.promptTemplateKey } : {}),
          ...('config' in input ? { config: input.config } : {}),
          updatedAt: new Date(),
        })
        .where(eq(modelProfiles.id, id))
        .returning();

      return row ? mapModelProfile(row) : undefined;
    },

    async listPromptTemplates(filter = {}) {
      let showId = filter.showId;

      if (!showId && filter.showSlug) {
        const [show] = await db.select().from(shows).where(eq(shows.slug, filter.showSlug)).limit(1);

        if (!show) {
          return [];
        }

        showId = show.id;
      }

      const keyWhere = filter.key ? eq(promptTemplates.key, filter.key) : undefined;
      const roleWhere = filter.role ? eq(promptTemplates.role, filter.role) : undefined;
      const showWhere = showId
        ? filter.includeGlobal
          ? or(eq(promptTemplates.showId, showId), isNull(promptTemplates.showId))
          : eq(promptTemplates.showId, showId)
        : undefined;
      const where = and(keyWhere, roleWhere, showWhere);
      const rows = where
        ? await db.select().from(promptTemplates).where(where).orderBy(asc(promptTemplates.key), desc(promptTemplates.version), desc(promptTemplates.updatedAt))
        : await db.select().from(promptTemplates).orderBy(asc(promptTemplates.key), desc(promptTemplates.version), desc(promptTemplates.updatedAt));

      return rows.map(promptTemplateFromDbRow);
    },

    async getPromptTemplateByKey(key, lookup = {}) {
      const templates = await this.listPromptTemplates({
        key,
        showId: lookup.showId,
        showSlug: lookup.showSlug,
        includeGlobal: lookup.includeGlobal ?? true,
      });
      const matching = templates
        .filter((template) => lookup.version === undefined || template.version === lookup.version)
        .sort((a, b) => {
          const showScore = Number(b.showId !== null) - Number(a.showId !== null);
          return showScore !== 0 ? showScore : b.version - a.version;
        });

      return matching[0];
    },

    async listSourceProfiles(filter = {}) {
      if (filter.showSlug) {
        const [show] = await db.select().from(shows).where(eq(shows.slug, filter.showSlug)).limit(1);

        if (!show) {
          return [];
        }

        const rows = await db.select().from(sourceProfiles)
          .where(eq(sourceProfiles.showId, show.id))
          .orderBy(asc(sourceProfiles.slug));
        return rows.map(mapProfile);
      }

      if (filter.showId) {
        const rows = await db.select().from(sourceProfiles)
          .where(eq(sourceProfiles.showId, filter.showId))
          .orderBy(asc(sourceProfiles.slug));
        return rows.map(mapProfile);
      }

      const rows = await db.select().from(sourceProfiles).orderBy(asc(sourceProfiles.slug));
      return rows.map(mapProfile);
    },

    async getSourceProfile(id) {
      const [row] = await db.select().from(sourceProfiles).where(eq(sourceProfiles.id, id)).limit(1);
      return row ? mapProfile(row) : undefined;
    },

    async createSourceProfile(input) {
      const [row] = await db.insert(sourceProfiles).values({
        showId: input.showId,
        slug: input.slug,
        name: input.name,
        type: input.type,
        enabled: input.enabled,
        weight: input.weight.toString(),
        freshness: input.freshness,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
        rateLimit: input.rateLimit,
        config: input.config,
      }).returning();

      return mapProfile(row);
    },

    async updateSourceProfile(id, input) {
      const [row] = await db.update(sourceProfiles)
        .set({
          ...('slug' in input ? { slug: input.slug } : {}),
          ...('name' in input ? { name: input.name } : {}),
          ...('type' in input ? { type: input.type } : {}),
          ...('enabled' in input ? { enabled: input.enabled } : {}),
          ...('weight' in input ? { weight: input.weight?.toString() } : {}),
          ...('freshness' in input ? { freshness: input.freshness } : {}),
          ...('includeDomains' in input ? { includeDomains: input.includeDomains } : {}),
          ...('excludeDomains' in input ? { excludeDomains: input.excludeDomains } : {}),
          ...('rateLimit' in input ? { rateLimit: input.rateLimit } : {}),
          ...('config' in input ? { config: input.config } : {}),
          updatedAt: new Date(),
        })
        .where(eq(sourceProfiles.id, id))
        .returning();

      return row ? mapProfile(row) : undefined;
    },

    async listSourceQueries(profileId, options = {}) {
      const profile = await this.getSourceProfile(profileId);

      if (!profile || (options.enabledOnly && !profile.enabled)) {
        return [];
      }

      const where = options.enabledOnly
        ? and(eq(sourceQueries.sourceProfileId, profileId), eq(sourceQueries.enabled, true))
        : eq(sourceQueries.sourceProfileId, profileId);
      const rows = await db.select().from(sourceQueries).where(where).orderBy(asc(sourceQueries.createdAt));
      return rows.map(mapQuery);
    },

    async createSourceQuery(profileId, input) {
      const profile = await this.getSourceProfile(profileId);

      if (!profile) {
        return undefined;
      }

      const [row] = await db.insert(sourceQueries).values({
        sourceProfileId: profileId,
        query: input.query,
        enabled: input.enabled,
        weight: input.weight.toString(),
        region: input.region,
        language: input.language,
        config: queryConfig(input),
      }).returning();

      return mapQuery(row);
    },

    async updateSourceQuery(id, input) {
      const [current] = await db.select().from(sourceQueries).where(eq(sourceQueries.id, id)).limit(1);

      if (!current) {
        return undefined;
      }

      const [row] = await db.update(sourceQueries)
        .set({
          ...('query' in input ? { query: input.query } : {}),
          ...('enabled' in input ? { enabled: input.enabled } : {}),
          ...('weight' in input ? { weight: input.weight?.toString() } : {}),
          ...('region' in input ? { region: input.region } : {}),
          ...('language' in input ? { language: input.language } : {}),
          config: queryConfig(input, asJsonObject(current.config)),
          updatedAt: new Date(),
        })
        .where(eq(sourceQueries.id, id))
        .returning();

      return row ? mapQuery(row) : undefined;
    },

    async deleteSourceQuery(id) {
      const deleted = await db.delete(sourceQueries).where(eq(sourceQueries.id, id)).returning({ id: sourceQueries.id });
      return deleted.length > 0;
    },

    async createScheduledPipeline(input: CreateScheduledPipelineInput) {
      const [row] = await db.insert(scheduledPipelines).values({
        showId: input.showId,
        feedId: input.feedId ?? null,
        sourceProfileId: input.sourceProfileId ?? null,
        slug: input.slug,
        name: input.name,
        enabled: input.enabled,
        cron: input.cron,
        timezone: input.timezone,
        workflow: input.workflow,
        autopublish: input.autopublish,
        legacyAdapter: input.legacyAdapter,
        config: input.config,
        nextRunAt: input.nextRunAt,
      }).returning();

      return mapScheduledPipeline(row);
    },

    async updateScheduledPipeline(id: string, input: UpdateScheduledPipelineInput) {
      const [row] = await db.update(scheduledPipelines)
        .set({
          ...('feedId' in input ? { feedId: input.feedId } : {}),
          ...('sourceProfileId' in input ? { sourceProfileId: input.sourceProfileId } : {}),
          ...('slug' in input ? { slug: input.slug } : {}),
          ...('name' in input ? { name: input.name } : {}),
          ...('enabled' in input ? { enabled: input.enabled } : {}),
          ...('cron' in input ? { cron: input.cron } : {}),
          ...('timezone' in input ? { timezone: input.timezone } : {}),
          ...('workflow' in input ? { workflow: input.workflow } : {}),
          ...('autopublish' in input ? { autopublish: input.autopublish } : {}),
          ...('legacyAdapter' in input ? { legacyAdapter: input.legacyAdapter } : {}),
          ...('config' in input ? { config: input.config } : {}),
          ...('nextRunAt' in input ? { nextRunAt: input.nextRunAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(scheduledPipelines.id, id))
        .returning();

      return row ? mapScheduledPipeline(row) : undefined;
    },

    async getScheduledPipeline(id: string) {
      const [row] = await db.select().from(scheduledPipelines).where(eq(scheduledPipelines.id, id)).limit(1);
      return row ? mapScheduledPipeline(row) : undefined;
    },

    async listScheduledPipelines(filter = {}) {
      const showWhere = filter.showId ? eq(scheduledPipelines.showId, filter.showId) : undefined;
      const enabledWhere = filter.enabledOnly ? eq(scheduledPipelines.enabled, true) : undefined;
      const dueWhere = filter.dueAt ? lte(scheduledPipelines.nextRunAt, filter.dueAt) : undefined;
      const where = [showWhere, enabledWhere, dueWhere].filter(Boolean).reduce((current, next) => {
        return current && next ? and(current, next) : current ?? next;
      });
      const rows = where
        ? await db.select().from(scheduledPipelines).where(where).orderBy(asc(scheduledPipelines.nextRunAt)).limit(filter.limit ?? 50)
        : await db.select().from(scheduledPipelines).orderBy(asc(scheduledPipelines.createdAt)).limit(filter.limit ?? 50);

      return rows.map(mapScheduledPipeline);
    },

    async markScheduledPipelineRun(input) {
      const [row] = await db.update(scheduledPipelines)
        .set({
          lastRunJobId: input.jobId,
          lastRunAt: input.lastRunAt,
          nextRunAt: input.nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPipelines.id, input.id))
        .returning();

      return row ? mapScheduledPipeline(row) : undefined;
    },

    async listScheduledRuns(filter: ScheduledRunListFilter = {}) {
      const showWhere = filter.showId ? eq(jobs.showId, filter.showId) : undefined;
      const statusWhere = filter.status ? eq(jobs.status, filter.status) : undefined;
      const where = [eq(jobs.type, 'pipeline.scheduled'), showWhere, statusWhere].filter(Boolean).reduce((current, next) => {
        return current && next ? and(current, next) : current ?? next;
      });
      const rows = await db.select().from(jobs)
        .where(where)
        .orderBy(desc(jobs.createdAt))
        .limit(filter.scheduledPipelineId ? 200 : filter.limit ?? 50);
      const mapped = rows.map(mapJob).filter((job) => {
        return !filter.scheduledPipelineId || job.input.scheduledPipelineId === filter.scheduledPipelineId;
      });

      return mapped.slice(0, filter.limit ?? 50);
    },

    async createJob(input: CreateJobInput) {
      const [row] = await db.insert(jobs).values({
        showId: input.showId,
        episodeId: input.episodeId ?? null,
        type: input.type,
        status: input.status,
        progress: input.progress,
        attempts: input.attempts ?? 0,
        maxAttempts: input.maxAttempts ?? 1,
        input: input.input,
        logs: input.logs ?? [],
        startedAt: input.startedAt,
      }).returning();

      return mapJob(row);
    },

    async updateJob(id: string, input: UpdateJobInput) {
      const [row] = await db.update(jobs)
        .set({
          ...('status' in input ? { status: input.status } : {}),
          ...('progress' in input ? { progress: input.progress } : {}),
          ...('output' in input ? { output: input.output } : {}),
          ...('logs' in input ? { logs: input.logs } : {}),
          ...('error' in input ? { error: input.error } : {}),
          ...('startedAt' in input ? { startedAt: input.startedAt } : {}),
          ...('finishedAt' in input ? { finishedAt: input.finishedAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, id))
        .returning();

      return row ? mapJob(row) : undefined;
    },

    async getJob(id: string) {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      return row ? mapJob(row) : undefined;
    },

    async listJobs(filter = {}) {
      const showWhere = filter.showId ? eq(jobs.showId, filter.showId) : undefined;
      const episodeWhere = filter.episodeId ? eq(jobs.episodeId, filter.episodeId) : undefined;
      const typeWhere = filter.types && filter.types.length > 0 ? inArray(jobs.type, filter.types) : undefined;
      const where = [showWhere, episodeWhere, typeWhere].filter(Boolean).reduce((current, next) => {
        return current && next ? and(current, next) : current ?? next;
      });
      const rows = where
        ? await db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt)).limit(filter.limit ?? 50)
        : await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(filter.limit ?? 50);

      return rows.map(mapJob);
    },

    async listStoryCandidateDedupeKeys(showId: string): Promise<CandidateDedupeKey[]> {
      return db.select({
        title: storyCandidates.title,
        canonicalUrl: storyCandidates.canonicalUrl,
      }).from(storyCandidates).where(eq(storyCandidates.showId, showId));
    },

    async insertStoryCandidate(input: CreateStoryCandidateInput) {
      const [row] = await db.insert(storyCandidates).values({
        showId: input.showId,
        sourceProfileId: input.sourceProfileId,
        sourceQueryId: input.sourceQueryId,
        title: input.title,
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        sourceName: input.sourceName,
        summary: input.summary,
        publishedAt: input.publishedAt,
        rawPayload: input.rawPayload,
        metadata: input.metadata,
      }).onConflictDoNothing({
        target: [storyCandidates.showId, storyCandidates.canonicalUrl],
      }).returning();

      return row ? mapStoryCandidate(row) : undefined;
    },

    async updateStoryCandidateScoring(id: string, input: UpdateStoryCandidateScoringInput) {
      const [row] = await db.update(storyCandidates)
        .set({
          score: input.score === null ? null : String(input.score),
          scoreBreakdown: input.scoreBreakdown,
          metadata: input.metadata,
          updatedAt: new Date(),
        })
        .where(eq(storyCandidates.id, id))
        .returning();

      return row ? mapStoryCandidate(row) : undefined;
    },

    async listStoryCandidates(filter: StoryCandidateListFilter) {
      const orderBy = filter.sort === 'discovered'
        ? [desc(storyCandidates.discoveredAt)]
        : [sql`${storyCandidates.score} desc nulls last`, desc(storyCandidates.discoveredAt)];
      const rows = await db.select()
        .from(storyCandidates)
        .where(eq(storyCandidates.showId, filter.showId))
        .orderBy(...orderBy)
        .limit(filter.limit ?? 50);

      return rows.map(mapStoryCandidate);
    },

    async getStoryCandidate(id: string) {
      const [row] = await db.select().from(storyCandidates).where(eq(storyCandidates.id, id)).limit(1);
      return row ? mapStoryCandidate(row) : undefined;
    },

    async createSourceDocument(input: CreateSourceDocumentInput) {
      const [row] = await db.insert(sourceDocuments).values({
        storyCandidateId: input.storyCandidateId,
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        fetchedAt: input.fetchedAt,
        fetchStatus: input.fetchStatus,
        httpStatus: input.httpStatus,
        contentType: input.contentType,
        textContent: input.textContent,
        metadata: input.metadata,
      }).returning();

      return mapSourceDocument(row);
    },

    async createResearchPacket(input: CreateResearchPacketInput) {
      const [row] = await db.insert(researchPackets).values({
        showId: input.showId,
        episodeCandidateId: input.episodeCandidateId,
        title: input.title,
        status: input.status,
        sourceDocumentIds: input.sourceDocumentIds,
        claims: toJsonRecords(input.claims),
        citations: toJsonRecords(input.citations),
        warnings: toJsonRecords(input.warnings),
        content: input.content,
      }).returning();

      return mapResearchPacket(row);
    },

    async getResearchPacket(id: string) {
      const [row] = await db.select().from(researchPackets).where(eq(researchPackets.id, id)).limit(1);
      return row ? mapResearchPacket(row) : undefined;
    },

    async overrideResearchWarning(id: string, input: OverrideResearchWarningInput) {
      const current = await this.getResearchPacket(id);

      if (!current) {
        return undefined;
      }

      const overriddenAt = new Date().toISOString();
      let matched = false;
      const warnings = current.warnings.map((warning) => {
        const isMatch = input.warningId ? warning.id === input.warningId : warning.code === input.warningCode;

        if (!isMatch) {
          return warning;
        }

        matched = true;
        return {
          ...warning,
          override: {
            actor: input.actor,
            reason: input.reason,
            overriddenAt,
          },
        };
      });

      if (!matched) {
        return undefined;
      }

      await db.insert(approvalEvents).values({
        researchPacketId: id,
        action: 'override',
        gate: 'research-warning',
        actor: input.actor,
        reason: input.reason,
        metadata: {
          warningId: input.warningId,
          warningCode: input.warningCode,
        },
      });

      const [row] = await db.update(researchPackets)
        .set({
          warnings: toJsonRecords(warnings),
          updatedAt: new Date(),
        })
        .where(eq(researchPackets.id, id))
        .returning();

      return row ? mapResearchPacket(row) : undefined;
    },

    async createScriptWithRevision(input: CreateScriptWithRevisionInput) {
      return db.transaction(async (tx) => {
        const [scriptRow] = await tx.insert(scripts).values({
          showId: input.showId,
          researchPacketId: input.researchPacketId,
          title: input.title,
          format: input.format,
          status: 'draft',
          metadata: input.metadata,
        }).returning();
        const [revisionRow] = await tx.insert(scriptRevisions).values({
          scriptId: scriptRow.id,
          version: 1,
          title: input.revision.title,
          body: input.revision.body,
          format: input.revision.format,
          speakers: input.revision.speakers,
          author: input.revision.author,
          changeSummary: input.revision.changeSummary,
          modelProfile: input.revision.modelProfile,
          metadata: input.revision.metadata,
        }).returning();

        return {
          script: mapScript(scriptRow),
          revision: mapScriptRevision(revisionRow),
        };
      });
    },

    async listScripts(filter: ListScriptsFilter = {}) {
      let showId = filter.showId;

      if (!showId && filter.showSlug) {
        const [show] = await db.select().from(shows).where(eq(shows.slug, filter.showSlug)).limit(1);

        if (!show) {
          return [];
        }

        showId = show.id;
      }

      const showWhere = showId ? eq(scripts.showId, showId) : undefined;
      const packetWhere = filter.researchPacketId ? eq(scripts.researchPacketId, filter.researchPacketId) : undefined;
      const where = showWhere && packetWhere ? and(showWhere, packetWhere) : showWhere ?? packetWhere;
      const rows = where
        ? await db.select().from(scripts).where(where).orderBy(desc(scripts.updatedAt)).limit(filter.limit ?? 50)
        : await db.select().from(scripts).orderBy(desc(scripts.updatedAt)).limit(filter.limit ?? 50);

      return rows.map(mapScript);
    },

    async getScript(id: string) {
      const [row] = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
      return row ? mapScript(row) : undefined;
    },

    async listScriptRevisions(scriptId: string) {
      const rows = await db.select()
        .from(scriptRevisions)
        .where(eq(scriptRevisions.scriptId, scriptId))
        .orderBy(desc(scriptRevisions.version));

      return rows.map(mapScriptRevision);
    },

    async getScriptRevision(id: string) {
      const [row] = await db.select().from(scriptRevisions).where(eq(scriptRevisions.id, id)).limit(1);
      return row ? mapScriptRevision(row) : undefined;
    },

    async createScriptRevision(scriptId: string, input: CreateScriptRevisionInput) {
      const current = await this.getScript(scriptId);

      if (!current) {
        return undefined;
      }

      const revisions = await this.listScriptRevisions(scriptId);
      const version = Math.max(0, ...revisions.map((revision) => revision.version)) + 1;
      const [revisionRow] = await db.insert(scriptRevisions).values({
        scriptId,
        version,
        title: input.title,
        body: input.body,
        format: input.format,
        speakers: input.speakers,
        author: input.author,
        changeSummary: input.changeSummary,
        modelProfile: input.modelProfile,
        metadata: input.metadata,
      }).returning();
      const [scriptRow] = await db.update(scripts)
        .set({
          title: input.title,
          format: input.format,
          status: 'draft',
          approvedRevisionId: null,
          approvedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(scripts.id, scriptId))
        .returning();

      return {
        script: mapScript(scriptRow),
        revision: mapScriptRevision(revisionRow),
      };
    },

    async approveScriptRevision(scriptId: string, revisionId: string, input: ApproveScriptRevisionInput) {
      const revision = await this.getScriptRevision(revisionId);

      if (!revision || revision.scriptId !== scriptId) {
        return undefined;
      }

      const approvedAt = new Date();
      await db.insert(approvalEvents).values({
        researchPacketId: null,
        action: 'approve',
        gate: 'script-audio',
        actor: input.actor,
        reason: input.reason,
        metadata: {
          scriptId,
          revisionId,
          version: revision.version,
        },
      });
      const [row] = await db.update(scripts)
        .set({
          status: 'approved-for-audio',
          approvedRevisionId: revisionId,
          approvedAt,
          updatedAt: approvedAt,
        })
        .where(eq(scripts.id, scriptId))
        .returning();

      return row ? mapScript(row) : undefined;
    },

    async getEpisode(id: string) {
      const [row] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
      return row ? mapEpisode(row) : undefined;
    },

    async listEpisodes(filter) {
      const rows = await db.select()
        .from(episodes)
        .where(eq(episodes.showId, filter.showId))
        .orderBy(desc(episodes.updatedAt))
        .limit(filter.limit ?? 50);

      return rows.map(mapEpisode);
    },

    async getEpisodeForScript(scriptId: string, researchPacketId: string) {
      const rows = await db.select()
        .from(episodes)
        .where(eq(episodes.researchPacketId, researchPacketId))
        .orderBy(desc(episodes.updatedAt))
        .limit(20);
      const scriptMatch = rows.find((row) => asJsonObject(row.metadata).scriptId === scriptId);

      return (scriptMatch ?? rows[0]) ? mapEpisode(scriptMatch ?? rows[0]) : undefined;
    },

    async createEpisodeFromScript(input: CreateEpisodeFromScriptInput) {
      const slug = `${slugify(input.title)}-${input.scriptId.slice(0, 8)}`;
      const [row] = await db.insert(episodes).values({
        showId: input.showId,
        researchPacketId: input.researchPacketId,
        slug,
        title: input.title,
        status: 'approved-for-audio',
        scriptText: input.scriptText,
        scriptFormat: input.scriptFormat,
        metadata: {
          scriptId: input.scriptId,
          approvedRevisionId: input.revisionId,
        },
      }).returning();

      return mapEpisode(row);
    },

    async updateEpisodeProduction(id: string, input: UpdateEpisodeProductionInput) {
      const [row] = await db.update(episodes)
        .set({
          ...('feedId' in input ? { feedId: input.feedId } : {}),
          ...('status' in input ? { status: input.status } : {}),
          ...('scriptText' in input ? { scriptText: input.scriptText } : {}),
          ...('scriptFormat' in input ? { scriptFormat: input.scriptFormat } : {}),
          ...('durationSeconds' in input ? { durationSeconds: input.durationSeconds } : {}),
          ...('publishedAt' in input ? { publishedAt: input.publishedAt } : {}),
          ...('feedGuid' in input ? { feedGuid: input.feedGuid } : {}),
          ...('metadata' in input ? { metadata: input.metadata } : {}),
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, id))
        .returning();

      return row ? mapEpisode(row) : undefined;
    },

    async createEpisodeAsset(input: CreateEpisodeAssetInput) {
      const [row] = await db.insert(episodeAssets).values({
        episodeId: input.episodeId,
        type: input.type,
        label: input.label ?? null,
        localPath: input.localPath ?? null,
        objectKey: input.objectKey ?? null,
        publicUrl: input.publicUrl ?? null,
        mimeType: input.mimeType ?? null,
        byteSize: input.byteSize ?? null,
        durationSeconds: input.durationSeconds ?? null,
        checksum: input.checksum ?? null,
        metadata: input.metadata ?? {},
      }).returning();

      return mapEpisodeAsset(row);
    },

    async listEpisodeAssets(episodeId: string) {
      const rows = await db.select()
        .from(episodeAssets)
        .where(eq(episodeAssets.episodeId, episodeId))
        .orderBy(desc(episodeAssets.createdAt));

      return rows.map(mapEpisodeAsset);
    },

    async listFeeds(showId: string) {
      const rows = await db.select()
        .from(feeds)
        .where(eq(feeds.showId, showId))
        .orderBy(asc(feeds.slug));

      return rows.map(mapFeed);
    },

    async getFeed(id: string) {
      const [row] = await db.select().from(feeds).where(eq(feeds.id, id)).limit(1);
      return row ? mapFeed(row) : undefined;
    },

    async createFeed(input: CreateFeedInput) {
      const [row] = await db.insert(feeds).values({
        showId: input.showId,
        slug: input.slug,
        title: input.title,
        description: input.description,
        rssFeedPath: input.rssFeedPath,
        publicFeedUrl: input.publicFeedUrl,
        publicBaseUrl: input.publicBaseUrl,
        storageType: input.storageType,
        storageConfig: input.storageConfig,
        op3Wrap: input.op3Wrap,
        episodeNumberPolicy: input.episodeNumberPolicy,
        metadata: input.metadata,
      }).returning();

      return mapFeed(row);
    },

    async updateFeed(id: string, input: UpdateFeedInput) {
      const [row] = await db.update(feeds)
        .set({
          ...('slug' in input ? { slug: input.slug } : {}),
          ...('title' in input ? { title: input.title } : {}),
          ...('description' in input ? { description: input.description } : {}),
          ...('rssFeedPath' in input ? { rssFeedPath: input.rssFeedPath } : {}),
          ...('publicFeedUrl' in input ? { publicFeedUrl: input.publicFeedUrl } : {}),
          ...('publicBaseUrl' in input ? { publicBaseUrl: input.publicBaseUrl } : {}),
          ...('storageType' in input ? { storageType: input.storageType } : {}),
          ...('storageConfig' in input ? { storageConfig: input.storageConfig } : {}),
          ...('op3Wrap' in input ? { op3Wrap: input.op3Wrap } : {}),
          ...('episodeNumberPolicy' in input ? { episodeNumberPolicy: input.episodeNumberPolicy } : {}),
          ...('metadata' in input ? { metadata: input.metadata } : {}),
          updatedAt: new Date(),
        })
        .where(eq(feeds.id, id))
        .returning();

      return row ? mapFeed(row) : undefined;
    },

    async approveEpisodeForPublish(id: string, input) {
      const current = await this.getEpisode(id);

      if (!current) {
        return undefined;
      }

      const approvedAt = new Date();
      await db.insert(approvalEvents).values({
        episodeId: id,
        researchPacketId: current.researchPacketId,
        action: 'approve',
        gate: 'episode-publish',
        actor: input.actor,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
      });
      const [row] = await db.update(episodes)
        .set({
          status: 'approved-for-publish',
          metadata: {
            ...current.metadata,
            publishApproval: {
              actor: input.actor,
              reason: input.reason ?? null,
              approvedAt: approvedAt.toISOString(),
            },
          },
          updatedAt: approvedAt,
        })
        .where(eq(episodes.id, id))
        .returning();

      return row ? mapEpisode(row) : undefined;
    },

    async createPublishEvent(input) {
      const [row] = await db.insert(publishEvents).values({
        episodeId: input.episodeId,
        feedId: input.feedId ?? null,
        status: input.status,
        feedGuid: input.feedGuid ?? null,
        audioUrl: input.audioUrl ?? null,
        coverUrl: input.coverUrl ?? null,
        rssUrl: input.rssUrl ?? null,
        changelog: input.changelog ?? null,
        error: input.error ?? null,
        metadata: input.metadata ?? {},
      }).returning();

      return mapPublishEvent(row);
    },

    async updatePublishEvent(id: string, input) {
      const [row] = await db.update(publishEvents)
        .set({
          ...('feedId' in input ? { feedId: input.feedId } : {}),
          ...('status' in input ? { status: input.status } : {}),
          ...('feedGuid' in input ? { feedGuid: input.feedGuid } : {}),
          ...('audioUrl' in input ? { audioUrl: input.audioUrl } : {}),
          ...('coverUrl' in input ? { coverUrl: input.coverUrl } : {}),
          ...('rssUrl' in input ? { rssUrl: input.rssUrl } : {}),
          ...('changelog' in input ? { changelog: input.changelog } : {}),
          ...('error' in input ? { error: input.error } : {}),
          ...('metadata' in input ? { metadata: input.metadata } : {}),
          updatedAt: new Date(),
        })
        .where(eq(publishEvents.id, id))
        .returning();

      return row ? mapPublishEvent(row) : undefined;
    },

    async close() {
      await pool.end();
    },
  };
}
