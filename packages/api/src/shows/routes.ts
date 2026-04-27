import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { MODEL_ROLES, isModelRole, type ModelRole } from '../models/roles.js';
import type { CreateModelProfileInput, ModelProfileRecord, ModelProfileStore } from '../models/store.js';
import { defaultPromptKey } from '../prompts/registry.js';
import type { CreateFeedInput, FeedRecord, ProductionStore, UpdateFeedInput } from '../production/store.js';
import type {
  CreateShowInput,
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  ShowRecord,
  SourceStore,
  UpdateShowInput,
} from '../sources/store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ShowRoutesOptions {
  getStore(): SourceStore & Partial<ModelProfileStore> & Partial<ProductionStore>;
}

const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: 'Slug must use lowercase letters, numbers, and single hyphens.',
});
const jsonObjectSchema = z.record(z.string(), z.unknown()).default({});
const nullableTextSchema = z.string().trim().min(1).nullable().default(null);
const castSchema = z.array(z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  voice: z.string().trim().min(1),
})).default([]);
const sourceTypeSchema = z.enum(['brave', 'rss', 'manual', 'local-json']);

function supportsDiscoveryControls(type: z.infer<typeof sourceTypeSchema>) {
  return type === 'brave' || type === 'rss';
}

const feedFieldsSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullable().optional(),
  rssFeedPath: z.string().trim().min(1).nullable().optional(),
  publicFeedUrl: z.string().trim().min(1).nullable().optional(),
  publicBaseUrl: z.string().trim().min(1).nullable().optional(),
  outputPath: z.string().trim().min(1).nullable().optional(),
  publicAssetBaseUrl: z.string().trim().min(1).nullable().optional(),
  storageType: z.string().trim().min(1).default('local'),
  storageConfig: jsonObjectSchema,
  op3Wrap: z.boolean().default(false),
  episodeNumberPolicy: z.string().trim().min(1).default('increment'),
  metadata: jsonObjectSchema,
});
const feedSchema = feedFieldsSchema.extend({
  slug: slugSchema.default('main'),
}).default({
  slug: 'main',
  storageType: 'local',
  storageConfig: {},
  op3Wrap: false,
  episodeNumberPolicy: 'increment',
  metadata: {},
});

const sourceDefaultsSchema = z.object({
  slug: slugSchema.default('starter-sources'),
  name: z.string().trim().min(1).optional(),
  type: sourceTypeSchema.default('brave'),
  enabled: z.boolean().default(true),
  weight: z.number().finite().nonnegative().default(1),
  freshness: nullableTextSchema.default('pw'),
  includeDomains: z.array(z.string().trim().min(1)).default([]),
  excludeDomains: z.array(z.string().trim().min(1)).default([]),
  queries: z.array(z.string().trim().min(1)).optional(),
  feeds: z.array(z.string().trim().min(1)).default([]),
  rateLimit: jsonObjectSchema,
  config: jsonObjectSchema,
}).default({
  slug: 'starter-sources',
  type: 'brave',
  enabled: true,
  weight: 1,
  freshness: 'pw',
  includeDomains: [],
  excludeDomains: [],
  feeds: [],
  rateLimit: {},
  config: {},
});

const modelProfileSchema = z.object({
  provider: z.string().trim().min(1).default('openai'),
  model: z.string().trim().min(1).default('gpt-5.5'),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
  fallbacks: z.array(z.string().trim().min(1)).default([]),
  promptTemplateKey: z.string().trim().min(1).nullable().optional(),
  params: jsonObjectSchema,
  config: jsonObjectSchema,
});

const modelDefaultsSchema = z.record(z.string(), modelProfileSchema).default({}).superRefine((value, context) => {
  for (const role of Object.keys(value)) {
    if (!isModelRole(role)) {
      context.addIssue({
        code: 'custom',
        message: `Role must be one of: ${MODEL_ROLES.join(', ')}`,
        path: [role],
      });
    }
  }
});

const createShowSchema = z.object({
  name: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  slug: slugSchema,
  description: nullableTextSchema,
  setupStatus: z.enum(['draft', 'active']).default('draft'),
  format: z.string().trim().min(1).nullable().optional(),
  defaultRuntimeMinutes: z.number().int().positive().nullable().optional(),
  hostVoiceDefaults: castSchema,
  cast: castSchema.optional(),
  toneStyleNotes: z.string().trim().min(1).optional(),
  scriptFormatNotes: z.string().trim().min(1).optional(),
  publishingMode: z.enum(['approval-gated', 'autopublish-later']).default('approval-gated'),
  settings: jsonObjectSchema,
  feed: feedSchema,
  sourceProfileDefaults: sourceDefaultsSchema,
  modelRoleDefaults: modelDefaultsSchema,
}).refine((value) => Boolean(value.title || value.name), {
  message: 'Provide a show title or name.',
  path: ['title'],
});

const updateShowSchema = z.object({
  name: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().min(1).nullable().optional(),
  setupStatus: z.enum(['draft', 'active']).optional(),
  format: z.string().trim().min(1).nullable().optional(),
  defaultRuntimeMinutes: z.number().int().positive().nullable().optional(),
  hostVoiceDefaults: castSchema.optional(),
  cast: castSchema.optional(),
  toneStyleNotes: z.string().trim().min(1).optional(),
  scriptFormatNotes: z.string().trim().min(1).optional(),
  publishingMode: z.enum(['approval-gated', 'autopublish-later']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one show field to update.',
});

const feedCreateSchema = feedFieldsSchema.extend({
  title: z.string().trim().min(1),
});
const feedUpdateSchema = feedFieldsSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one feed field to update.',
});

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      ok: false,
      code: 'VALIDATION_ERROR',
      error: 'Request validation failed.',
      errors: error.issues,
    });
  }

  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
    });
  }

  if (isDuplicateError(error)) {
    return reply.code(409).send({
      ok: false,
      code: 'DUPLICATE_SLUG',
      error: 'A record with that slug already exists for this scope.',
    });
  }

  throw error;
}

function isDuplicateError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function requireMethod<T extends object, K extends keyof T>(
  store: T,
  method: K,
  code: string,
): T & Required<Pick<T, K>> {
  if (typeof store[method] !== 'function') {
    throw new ApiError(503, code, `Store method is unavailable: ${String(method)}`);
  }

  return store as T & Required<Pick<T, K>>;
}

function mergeShowSettings(
  current: Record<string, unknown>,
  input: {
    publishingMode?: 'approval-gated' | 'autopublish-later';
    toneStyleNotes?: string;
    scriptFormatNotes?: string;
    settings?: Record<string, unknown>;
  },
) {
  return {
    ...current,
    ...input.settings,
    onboarding: {
      ...(current.onboarding && typeof current.onboarding === 'object' && !Array.isArray(current.onboarding)
        ? current.onboarding as Record<string, unknown>
        : {}),
      publishingMode: input.publishingMode ?? readPublishingMode(current),
      toneStyleNotes: input.toneStyleNotes ?? readOnboardingText(current, 'toneStyleNotes'),
      scriptFormatNotes: input.scriptFormatNotes ?? readOnboardingText(current, 'scriptFormatNotes'),
    },
  };
}

function readPublishingMode(settings: Record<string, unknown>) {
  const onboarding = settings.onboarding;
  if (onboarding && typeof onboarding === 'object' && !Array.isArray(onboarding) && 'publishingMode' in onboarding) {
    return onboarding.publishingMode;
  }

  return 'approval-gated';
}

function readOnboardingText(settings: Record<string, unknown>, key: string) {
  const onboarding = settings.onboarding;
  if (onboarding && typeof onboarding === 'object' && !Array.isArray(onboarding)) {
    const value = (onboarding as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function feedInput(show: ShowRecord, input: z.infer<typeof feedSchema>): CreateFeedInput {
  const metadata = {
    ...input.metadata,
    ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    ...(input.publicAssetBaseUrl ? { publicAssetBaseUrl: input.publicAssetBaseUrl } : {}),
  };

  return {
    showId: show.id,
    slug: input.slug,
    title: input.title ?? show.title,
    description: input.description ?? show.description,
    rssFeedPath: input.rssFeedPath ?? null,
    publicFeedUrl: input.publicFeedUrl ?? null,
    publicBaseUrl: input.publicBaseUrl ?? input.publicAssetBaseUrl ?? null,
    storageType: input.storageType,
    storageConfig: {
      ...input.storageConfig,
      ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    },
    op3Wrap: input.op3Wrap,
    episodeNumberPolicy: input.episodeNumberPolicy,
    metadata,
  };
}

function sourceProfileInput(show: ShowRecord, input: z.infer<typeof sourceDefaultsSchema>): CreateSourceProfileInput {
  const supportsControls = supportsDiscoveryControls(input.type);

  return {
    showId: show.id,
    slug: input.slug,
    name: input.name ?? `${show.title} Starter Sources`,
    type: input.type,
    enabled: input.enabled,
    weight: input.weight,
    freshness: supportsControls ? input.freshness : null,
    includeDomains: supportsControls ? input.includeDomains : [],
    excludeDomains: supportsControls ? input.excludeDomains : [],
    rateLimit: input.rateLimit,
    config: {
      ...input.config,
      feeds: input.feeds,
      starter: true,
    },
  };
}

function modelProfileInputs(showId: string, defaults: Record<ModelRole, z.infer<typeof modelProfileSchema> | undefined>): CreateModelProfileInput[] {
  return MODEL_ROLES.map((role) => {
    const input = defaults[role] ?? {
      provider: 'openai',
      model: 'gpt-5.5',
      fallbacks: [],
      params: { reasoningEffort: 'high' },
      config: {},
    };

    return {
      showId,
      role,
      provider: input.provider,
      model: input.model,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      budgetUsd: input.budgetUsd ?? null,
      fallbacks: input.fallbacks,
      promptTemplateKey: input.promptTemplateKey ?? defaultPromptKey(role),
      config: {
        ...input.config,
        params: input.params,
        starter: true,
      },
    };
  });
}

function updateFeedInput(input: z.infer<typeof feedUpdateSchema>): UpdateFeedInput {
  return {
    ...('slug' in input ? { slug: input.slug } : {}),
    ...('title' in input ? { title: input.title } : {}),
    ...('description' in input ? { description: input.description ?? null } : {}),
    ...('rssFeedPath' in input ? { rssFeedPath: input.rssFeedPath ?? null } : {}),
    ...('publicFeedUrl' in input ? { publicFeedUrl: input.publicFeedUrl ?? null } : {}),
    ...('publicBaseUrl' in input ? { publicBaseUrl: input.publicBaseUrl ?? input.publicAssetBaseUrl ?? null } : {}),
    ...('storageType' in input ? { storageType: input.storageType } : {}),
    ...('storageConfig' in input || 'outputPath' in input ? {
      storageConfig: {
        ...(input.storageConfig ?? {}),
        ...(input.outputPath ? { outputPath: input.outputPath } : {}),
      },
    } : {}),
    ...('op3Wrap' in input ? { op3Wrap: input.op3Wrap } : {}),
    ...('episodeNumberPolicy' in input ? { episodeNumberPolicy: input.episodeNumberPolicy } : {}),
    ...('metadata' in input || 'outputPath' in input || 'publicAssetBaseUrl' in input ? {
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.outputPath ? { outputPath: input.outputPath } : {}),
        ...(input.publicAssetBaseUrl ? { publicAssetBaseUrl: input.publicAssetBaseUrl } : {}),
      },
    } : {}),
  };
}

async function findShow(store: SourceStore, slugOrId: string) {
  return (await store.listShows()).find((show) => show.id === slugOrId || show.slug === slugOrId);
}

export function registerShowRoutes(app: FastifyInstance, options: ShowRoutesOptions) {
  app.post('/shows', async (request, reply) => {
    try {
      const store = options.getStore();
      const showStore = requireMethod(requireMethod(store, 'createShow', 'SHOW_STORE_UNAVAILABLE'), 'updateShow', 'SHOW_STORE_UNAVAILABLE');
      const feedStore = requireMethod(store, 'createFeed', 'FEED_STORE_UNAVAILABLE');
      const modelStore = requireMethod(store, 'createModelProfile', 'MODEL_PROFILE_STORE_UNAVAILABLE');
      const body = createShowSchema.parse(request.body);
      const title = body.title ?? body.name ?? '';
      const existing = (await store.listShows()).find((show) => show.slug === body.slug);

      if (existing) {
        throw new ApiError(409, 'DUPLICATE_SHOW_SLUG', `Show slug already exists: ${body.slug}`);
      }

      const showInput: CreateShowInput = {
        slug: body.slug,
        title,
        description: body.description,
        setupStatus: body.setupStatus,
        format: body.format ?? null,
        defaultRuntimeMinutes: body.defaultRuntimeMinutes ?? null,
        cast: body.cast ?? body.hostVoiceDefaults,
        defaultModelProfile: {},
        settings: mergeShowSettings({}, body),
      };
      let show = await showStore.createShow(showInput);
      const feed = await feedStore.createFeed(feedInput(show, body.feed));
      const sourceProfile = await store.createSourceProfile(sourceProfileInput(show, body.sourceProfileDefaults));
      const queries = body.sourceProfileDefaults.queries ?? [`${show.title} news`];
      const supportsControls = supportsDiscoveryControls(sourceProfile.type);
      const sourceQueries = await Promise.all(queries.map((query) => {
        const queryInput: CreateSourceQueryInput = {
          query,
          enabled: true,
          weight: 1,
          region: null,
          language: null,
          freshness: supportsControls ? body.sourceProfileDefaults.freshness : null,
          includeDomains: [],
          excludeDomains: [],
          config: { starter: true },
        };

        return store.createSourceQuery(sourceProfile.id, queryInput);
      }));
      const modelProfiles: ModelProfileRecord[] = [];

      for (const input of modelProfileInputs(show.id, body.modelRoleDefaults as Record<ModelRole, z.infer<typeof modelProfileSchema> | undefined>)) {
        modelProfiles.push(await modelStore.createModelProfile(input));
      }

      show = await showStore.updateShow(show.id, {
        defaultModelProfile: Object.fromEntries(modelProfiles.map((profile) => [profile.role, profile.id])),
      }) ?? show;

      return reply.code(201).send({
        ok: true,
        show,
        feed,
        sourceProfile,
        sourceQueries: sourceQueries.filter(Boolean),
        modelProfiles,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/shows/:id', async (request, reply) => {
    try {
      const store = options.getStore();
      const showStore = requireMethod(store, 'updateShow', 'SHOW_STORE_UNAVAILABLE');
      const current = await findShow(store, request.params.id);

      if (!current) {
        throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${request.params.id}`);
      }

      const body = updateShowSchema.parse(request.body);
      const newSlug = body.slug;
      if (newSlug && newSlug !== current.slug && (await store.listShows()).some((show) => show.slug === newSlug)) {
        throw new ApiError(409, 'DUPLICATE_SHOW_SLUG', `Show slug already exists: ${newSlug}`);
      }

      const input: UpdateShowInput = {
        ...('slug' in body ? { slug: body.slug } : {}),
        ...('title' in body || 'name' in body ? { title: body.title ?? body.name } : {}),
        ...('description' in body ? { description: body.description ?? null } : {}),
        ...('setupStatus' in body ? { setupStatus: body.setupStatus } : {}),
        ...('format' in body ? { format: body.format ?? null } : {}),
        ...('defaultRuntimeMinutes' in body ? { defaultRuntimeMinutes: body.defaultRuntimeMinutes ?? null } : {}),
        ...('cast' in body || 'hostVoiceDefaults' in body ? { cast: body.cast ?? body.hostVoiceDefaults ?? current.cast } : {}),
        settings: mergeShowSettings(current.settings, body),
      };
      const show = await showStore.updateShow(current.id, input);

      return { ok: true, show };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { showSlug: string } }>('/shows/:showSlug/feeds', async (request, reply) => {
    try {
      const store = options.getStore();
      const feedStore = requireMethod(store, 'listFeeds', 'FEED_STORE_UNAVAILABLE');
      const show = await findShow(store, request.params.showSlug);

      if (!show) {
        throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${request.params.showSlug}`);
      }

      return { ok: true, feeds: await feedStore.listFeeds(show.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { showSlug: string } }>('/shows/:showSlug/feeds', async (request, reply) => {
    try {
      const store = options.getStore();
      const feedStore = requireMethod(store, 'createFeed', 'FEED_STORE_UNAVAILABLE');
      const show = await findShow(store, request.params.showSlug);

      if (!show) {
        throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${request.params.showSlug}`);
      }

      const body = feedCreateSchema.parse(request.body);
      const feed = await feedStore.createFeed(feedInput(show, body));

      return reply.code(201).send({ ok: true, feed });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/feeds/:id', async (request, reply) => {
    try {
      const store = options.getStore();
      const feedStore = requireMethod(requireMethod(store, 'getFeed', 'FEED_STORE_UNAVAILABLE'), 'updateFeed', 'FEED_STORE_UNAVAILABLE');
      const current = await feedStore.getFeed(request.params.id);

      if (!current) {
        throw new ApiError(404, 'FEED_NOT_FOUND', `Feed not found: ${request.params.id}`);
      }

      const body = feedUpdateSchema.parse(request.body);
      const feed = await feedStore.updateFeed(request.params.id, updateFeedInput(body));

      return { ok: true, feed };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
