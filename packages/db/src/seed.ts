import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { feeds, modelProfiles, shows, sourceProfiles, sourceQueries } from './schema.js';

type ExampleConfig = {
  show: {
    slug: string;
    title: string;
    description?: string;
    format?: string;
    defaultRuntimeMinutes?: number;
    cast?: Array<{ name: string; role?: string; voice: string }>;
  };
  sources: Array<{
    id: string;
    type: 'brave' | 'rss' | 'manual' | 'local-json';
    enabled: boolean;
    weight?: number;
    freshness?: string;
    queries?: string[];
    feeds?: string[];
    includeDomains?: string[];
    excludeDomains?: string[];
  }>;
  models: Record<string, {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    params?: Record<string, unknown>;
    fallbacks?: string[];
    promptTemplate?: string;
    budgetUsd?: number;
  }>;
  production: {
    storage?: string;
    rssFeedPath?: string;
    publicBaseUrl?: string;
    op3Wrap?: boolean;
    [key: string]: unknown;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = resolve(__dirname, '../../../config/examples/the-synthetic-lens.json');
const configPath = process.argv[2] ? resolve(process.argv[2]) : defaultConfigPath;

const config = JSON.parse(await readFile(configPath, 'utf8')) as ExampleConfig;
const { db, pool } = createDb();

try {
  const showConfig = config.show;
  const defaultModelProfile = Object.fromEntries(Object.keys(config.models).map((role) => [role, role]));

  const [show] = await db.insert(shows).values({
    slug: showConfig.slug,
    title: showConfig.title,
    description: showConfig.description,
    setupStatus: 'active',
    format: showConfig.format,
    defaultRuntimeMinutes: showConfig.defaultRuntimeMinutes,
    cast: showConfig.cast ?? [],
    defaultModelProfile,
    settings: { production: config.production }
  }).onConflictDoUpdate({
    target: shows.slug,
    set: {
      title: showConfig.title,
      description: showConfig.description,
      setupStatus: 'active',
      format: showConfig.format,
      defaultRuntimeMinutes: showConfig.defaultRuntimeMinutes,
      cast: showConfig.cast ?? [],
      defaultModelProfile,
      settings: { production: config.production },
      updatedAt: new Date()
    }
  }).returning();

  await db.insert(feeds).values({
    showId: show.id,
    slug: 'main',
    title: show.title,
    description: show.description,
    rssFeedPath: config.production.rssFeedPath,
    publicBaseUrl: config.production.publicBaseUrl,
    storageType: config.production.storage ?? 'local',
    op3Wrap: config.production.op3Wrap ?? false,
    storageConfig: config.production
  }).onConflictDoUpdate({
    target: [feeds.showId, feeds.slug],
    set: {
      title: show.title,
      description: show.description,
      rssFeedPath: config.production.rssFeedPath,
      publicBaseUrl: config.production.publicBaseUrl,
      storageType: config.production.storage ?? 'local',
      op3Wrap: config.production.op3Wrap ?? false,
      storageConfig: config.production,
      updatedAt: new Date()
    }
  });

  for (const [role, model] of Object.entries(config.models)) {
    await db.insert(modelProfiles).values({
      showId: show.id,
      role,
      provider: model.provider,
      model: model.model,
      temperature: model.temperature?.toString(),
      maxTokens: model.maxTokens,
      budgetUsd: model.budgetUsd?.toString(),
      fallbacks: model.fallbacks ?? [],
      promptTemplateKey: model.promptTemplate,
      config: { params: model.params ?? {} }
    }).onConflictDoUpdate({
      target: [modelProfiles.showId, modelProfiles.role],
      set: {
        provider: model.provider,
        model: model.model,
        temperature: model.temperature?.toString(),
        maxTokens: model.maxTokens,
        budgetUsd: model.budgetUsd?.toString(),
        fallbacks: model.fallbacks ?? [],
        promptTemplateKey: model.promptTemplate,
        config: { params: model.params ?? {} },
        updatedAt: new Date()
      }
    });
  }

  for (const source of config.sources) {
    const [profile] = await db.insert(sourceProfiles).values({
      showId: show.id,
      slug: source.id,
      name: source.id,
      type: source.type,
      enabled: source.enabled,
      weight: source.weight?.toString() ?? '1',
      freshness: source.freshness,
      includeDomains: source.includeDomains ?? [],
      excludeDomains: source.excludeDomains ?? [],
      config: {
        feeds: source.feeds ?? []
      }
    }).onConflictDoUpdate({
      target: [sourceProfiles.showId, sourceProfiles.slug],
      set: {
        type: source.type,
        enabled: source.enabled,
        weight: source.weight?.toString() ?? '1',
        freshness: source.freshness,
        includeDomains: source.includeDomains ?? [],
        excludeDomains: source.excludeDomains ?? [],
        config: { feeds: source.feeds ?? [] },
        updatedAt: new Date()
      }
    }).returning();

    for (const query of source.queries ?? []) {
      await db.insert(sourceQueries).values({
        sourceProfileId: profile.id,
        query
      }).onConflictDoNothing({
        target: [sourceQueries.sourceProfileId, sourceQueries.query]
      });
    }
  }

  const sourceCount = await db.select().from(sourceProfiles).where(eq(sourceProfiles.showId, show.id));
  console.log(`Seeded ${show.title} (${show.slug}) with ${sourceCount.length} source profile(s).`);
} finally {
  await pool.end();
}
