import { and, asc, desc, eq } from 'drizzle-orm';
import {
  createDb,
  jobs,
  shows,
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
} from '../search/store.js';
import type {
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  ShowRecord,
  SourceProfileRecord,
  SourceQueryRecord,
  SourceStore,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
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

function mapShow(row: typeof shows.$inferSelect): ShowRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
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

export function createDbSourceStore(connectionString = process.env.DATABASE_URL): SourceStore & SearchJobStore {
  const { db, pool } = createDb(connectionString);

  return {
    async listShows() {
      const rows = await db.select().from(shows).orderBy(asc(shows.slug));
      return rows.map(mapShow);
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

    async createJob(input: CreateJobInput) {
      const [row] = await db.insert(jobs).values({
        showId: input.showId,
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

    async listStoryCandidates(filter: StoryCandidateListFilter) {
      const rows = await db.select()
        .from(storyCandidates)
        .where(eq(storyCandidates.showId, filter.showId))
        .orderBy(desc(storyCandidates.discoveredAt))
        .limit(filter.limit ?? 50);

      return rows.map(mapStoryCandidate);
    },

    async close() {
      await pool.end();
    },
  };
}
