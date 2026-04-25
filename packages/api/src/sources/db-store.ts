import { and, asc, eq } from 'drizzle-orm';
import {
  createDb,
  shows,
  sourceProfiles,
  sourceQueries,
} from '@podcast-forge/db';

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

export function createDbSourceStore(connectionString = process.env.DATABASE_URL): SourceStore {
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

    async close() {
      await pool.end();
    },
  };
}
