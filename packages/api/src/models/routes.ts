import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { isModelRole, MODEL_ROLES } from './roles.js';
import type { ModelProfileStore } from './store.js';
import type { SourceStore } from '../sources/store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ModelRoutesOptions {
  getStore(): SourceStore & Partial<ModelProfileStore>;
}

const modelRoleSchema = z.string().refine(isModelRole, {
  message: `Role must be one of: ${MODEL_ROLES.join(', ')}`,
});

const jsonObjectSchema = z.record(z.string(), z.unknown());

const createModelProfileSchema = z.object({
  showId: z.string().uuid().nullable().optional(),
  showSlug: z.string().trim().min(1).optional(),
  role: modelRoleSchema,
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
  fallbacks: z.array(z.string().trim().min(1)).default([]),
  promptTemplateKey: z.string().trim().min(1).nullable().optional(),
  params: jsonObjectSchema.default({}),
  config: jsonObjectSchema.default({}),
}).refine((value) => !value.showId || !value.showSlug, {
  message: 'Provide showId or showSlug, not both.',
  path: ['showSlug'],
});

const updateModelProfileSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
  fallbacks: z.array(z.string().trim().min(1)).optional(),
  promptTemplateKey: z.string().trim().min(1).nullable().optional(),
  params: jsonObjectSchema.optional(),
  config: jsonObjectSchema.optional(),
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
    });
  }

  throw error;
}

function requireModelProfileStore(store: SourceStore & Partial<ModelProfileStore>): SourceStore & ModelProfileStore {
  const required: Array<keyof ModelProfileStore> = [
    'listModelProfiles',
    'getModelProfile',
    'createModelProfile',
    'updateModelProfile',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'MODEL_PROFILE_STORE_UNAVAILABLE', `Model profile store method is unavailable: ${method}`);
    }
  }

  return store as SourceStore & ModelProfileStore;
}

async function resolveShowId(store: SourceStore, showId?: string | null, showSlug?: string): Promise<string | null> {
  if (showId !== undefined) {
    return showId;
  }

  if (!showSlug) {
    return null;
  }

  const show = (await store.listShows()).find((candidate) => candidate.slug === showSlug);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showSlug}`);
  }

  return show.id;
}

function withParamsConfig(config: Record<string, unknown>, params?: Record<string, unknown>) {
  return params === undefined ? config : { ...config, params };
}

export function registerModelRoutes(app: FastifyInstance, options: ModelRoutesOptions) {
  app.get<{ Querystring: { showId?: string; showSlug?: string; role?: string; includeGlobal?: string } }>('/model-profiles', async (request, reply) => {
    try {
      const store = requireModelProfileStore(options.getStore());
      const role = request.query.role ? modelRoleSchema.parse(request.query.role) : undefined;
      const includeGlobal = request.query.includeGlobal === 'true';
      const modelProfiles = await store.listModelProfiles({
        showId: request.query.showId,
        showSlug: request.query.showSlug,
        role,
        includeGlobal,
      });

      return { ok: true, modelProfiles };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/model-profiles', async (request, reply) => {
    try {
      const store = requireModelProfileStore(options.getStore());
      const body = createModelProfileSchema.parse(request.body);
      const showId = await resolveShowId(store, body.showId, body.showSlug);
      const modelProfile = await store.createModelProfile({
        showId,
        role: body.role,
        provider: body.provider,
        model: body.model,
        temperature: body.temperature ?? null,
        maxTokens: body.maxTokens ?? null,
        budgetUsd: body.budgetUsd ?? null,
        fallbacks: body.fallbacks,
        promptTemplateKey: body.promptTemplateKey ?? null,
        config: withParamsConfig(body.config, body.params),
      });

      return reply.code(201).send({ ok: true, modelProfile });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/model-profiles/:id', async (request, reply) => {
    try {
      const store = requireModelProfileStore(options.getStore());
      const current = await store.getModelProfile(request.params.id);

      if (!current) {
        throw new ApiError(404, 'MODEL_PROFILE_NOT_FOUND', `Model profile not found: ${request.params.id}`);
      }

      const body = updateModelProfileSchema.parse(request.body);
      const config = withParamsConfig(body.config ?? current.config, body.params);
      const modelProfile = await store.updateModelProfile(request.params.id, {
        ...('provider' in body ? { provider: body.provider } : {}),
        ...('model' in body ? { model: body.model } : {}),
        ...('temperature' in body ? { temperature: body.temperature ?? null } : {}),
        ...('maxTokens' in body ? { maxTokens: body.maxTokens ?? null } : {}),
        ...('budgetUsd' in body ? { budgetUsd: body.budgetUsd ?? null } : {}),
        ...('fallbacks' in body ? { fallbacks: body.fallbacks } : {}),
        ...('promptTemplateKey' in body ? { promptTemplateKey: body.promptTemplateKey ?? null } : {}),
        ...('params' in body || 'config' in body ? { config } : {}),
      });

      return { ok: true, modelProfile };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
