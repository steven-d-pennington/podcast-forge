import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import { normalizeDomainList } from '../search/controls.js';
import type {
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  SourceStore,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
} from './store.js';

const sourceTypeSchema = z.enum(['brave', 'zai-web', 'rss', 'manual', 'local-json']);
const domainListSchema = z.array(z.string().trim().min(1)).default([]);
const jsonObjectSchema = z.record(z.string(), z.unknown()).default({});
const nullableTextSchema = z.string().trim().min(1).nullable().default(null);

const profileCreateSchema = z.object({
  showId: z.string().uuid().optional(),
  showSlug: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: sourceTypeSchema,
  enabled: z.boolean().default(true),
  weight: z.number().finite().nonnegative().default(1),
  freshness: nullableTextSchema,
  includeDomains: domainListSchema,
  excludeDomains: domainListSchema,
  rateLimit: jsonObjectSchema,
  config: jsonObjectSchema,
}).refine((value) => value.showId || value.showSlug, {
  message: 'Provide either showId or showSlug.',
  path: ['showSlug'],
});

const profilePatchSchema = z.object({
  slug: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  type: sourceTypeSchema.optional(),
  enabled: z.boolean().optional(),
  weight: z.number().finite().nonnegative().optional(),
  freshness: z.string().trim().min(1).nullable().optional(),
  includeDomains: z.array(z.string().trim().min(1)).optional(),
  excludeDomains: z.array(z.string().trim().min(1)).optional(),
  rateLimit: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one profile field to update.',
});

const queryCreateSchema = z.object({
  query: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  weight: z.number().finite().nonnegative().default(1),
  region: nullableTextSchema,
  language: nullableTextSchema,
  freshness: nullableTextSchema,
  includeDomains: domainListSchema,
  excludeDomains: domainListSchema,
  config: jsonObjectSchema,
});

const queryPatchSchema = z.object({
  query: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  weight: z.number().finite().nonnegative().optional(),
  region: z.string().trim().min(1).nullable().optional(),
  language: z.string().trim().min(1).nullable().optional(),
  freshness: z.string().trim().min(1).nullable().optional(),
  includeDomains: z.array(z.string().trim().min(1)).optional(),
  excludeDomains: z.array(z.string().trim().min(1)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one query field to update.',
});

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

function supportsDiscoveryControls(type: z.infer<typeof sourceTypeSchema> | undefined): boolean {
  return type === 'brave' || type === 'zai-web' || type === 'rss';
}

function normalizeProfileCreateInput(body: z.infer<typeof profileCreateSchema>): Omit<CreateSourceProfileInput, 'showId'> {
  return {
    slug: body.slug,
    name: body.name,
    type: body.type,
    enabled: body.enabled,
    weight: body.weight,
    freshness: supportsDiscoveryControls(body.type) ? body.freshness : null,
    includeDomains: supportsDiscoveryControls(body.type) ? normalizeDomainList(body.includeDomains) : [],
    excludeDomains: supportsDiscoveryControls(body.type) ? normalizeDomainList(body.excludeDomains) : [],
    rateLimit: body.rateLimit,
    config: body.config,
  };
}

function normalizeProfilePatchInput(
  input: z.infer<typeof profilePatchSchema>,
  existingType: z.infer<typeof sourceTypeSchema>,
): UpdateSourceProfileInput {
  const output: UpdateSourceProfileInput = { ...input };
  const effectiveType = output.type ?? existingType;
  const controlsSupported = supportsDiscoveryControls(effectiveType);

  if (controlsSupported) {
    if ('includeDomains' in output) {
      output.includeDomains = normalizeDomainList(output.includeDomains);
    }

    if ('excludeDomains' in output) {
      output.excludeDomains = normalizeDomainList(output.excludeDomains);
    }
  } else {
    output.freshness = null;
    output.includeDomains = [];
    output.excludeDomains = [];
  }

  return output;
}

function normalizeQueryInput<T extends CreateSourceQueryInput | UpdateSourceQueryInput>(
  input: T,
  controlsSupported = true,
): T {
  const output = { ...input };

  if (!controlsSupported) {
    output.freshness = null;
    output.includeDomains = [];
    output.excludeDomains = [];
    return output as T;
  }

  if ('includeDomains' in output) {
    output.includeDomains = normalizeDomainList(output.includeDomains);
  }

  if ('excludeDomains' in output) {
    output.excludeDomains = normalizeDomainList(output.excludeDomains);
  }

  return output as T;
}

async function findSourceQueryProfile(store: SourceStore, queryId: string): Promise<z.infer<typeof sourceTypeSchema> | undefined> {
  const query = await store.getSourceQuery(queryId);

  if (!query) {
    return undefined;
  }

  return (await store.getSourceProfile(query.sourceProfileId))?.type;
}

export interface SourceRoutesOptions {
  getStore(): SourceStore;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function isDuplicateError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function isDatabaseAvailabilityError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return ['3D000', '28P01', '42P01', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(String(error.code));
}

async function resolveShowId(store: SourceStore, showId?: string, showSlug?: string): Promise<string> {
  if (showId) {
    const show = (await store.listShows()).find((candidate) => candidate.id === showId);

    if (!show) {
      throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showId}`);
    }

    return show.id;
  }

  const show = (await store.listShows()).find((candidate) => candidate.slug === showSlug);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showSlug}`);
  }

  return show.id;
}

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
      code: 'DUPLICATE_SOURCE',
      error: 'A source profile or query with the same unique key already exists.',
    });
  }

  if (isDatabaseAvailabilityError(error)) {
    return reply.code(503).send({
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      error: error instanceof Error ? error.message : 'The source profile database is unavailable.',
    });
  }

  throw error;
}

export function registerSourceRoutes(app: FastifyInstance, options: SourceRoutesOptions) {
  const getStore = () => {
    try {
      return options.getStore();
    } catch (error) {
      throw new ApiError(
        503,
        'DATABASE_UNAVAILABLE',
        error instanceof Error ? error.message : 'The source profile database is unavailable.',
      );
    }
  };

  app.get('/shows', async (_request, reply) => {
    try {
      return { ok: true, shows: await getStore().listShows() };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showSlug?: string } }>('/source-profiles', async (request, reply) => {
    try {
      const profiles = await getStore().listSourceProfiles({ showSlug: request.query.showSlug });
      return { ok: true, sourceProfiles: profiles };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/source-profiles', async (request: FastifyRequest, reply) => {
    try {
      const body = parseBody(profileCreateSchema, request.body);
      const store = getStore();
      const showId = await resolveShowId(store, body.showId, body.showSlug);
      const input: CreateSourceProfileInput = {
        ...normalizeProfileCreateInput(body),
        showId,
      };
      const profile = await store.createSourceProfile(input);

      return reply.code(201).send({ ok: true, sourceProfile: profile });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/source-profiles/:id', async (request, reply) => {
    try {
      const store = getStore();
      const existing = await store.getSourceProfile(request.params.id);

      if (!existing) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      const rawInput = parseBody(profilePatchSchema, request.body);
      const input = normalizeProfilePatchInput(rawInput, existing.type);
      const profile = await store.updateSourceProfile(request.params.id, input);

      if (!profile) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      const hasSourceControlPatch = rawInput.freshness !== undefined
        || rawInput.includeDomains !== undefined
        || rawInput.excludeDomains !== undefined;
      const shouldClearQueryControls = !supportsDiscoveryControls(profile.type)
        && (supportsDiscoveryControls(existing.type) || hasSourceControlPatch);

      if (shouldClearQueryControls) {
        const queries = await store.listSourceQueries(profile.id);
        await Promise.all(queries
          .filter((query) => query.freshness || query.includeDomains.length > 0 || query.excludeDomains.length > 0)
          .map((query) => store.updateSourceQuery(query.id, {
            freshness: null,
            includeDomains: [],
            excludeDomains: [],
          })));
      }

      return { ok: true, sourceProfile: profile };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { enabledOnly?: string } }>(
    '/source-profiles/:id/queries',
    async (request, reply) => {
      try {
        const store = getStore();
        const profile = await store.getSourceProfile(request.params.id);

        if (!profile) {
          throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
        }

        const queries = await store.listSourceQueries(request.params.id, {
          enabledOnly: request.query.enabledOnly === 'true' || request.query.enabledOnly === '1',
        });
        return { ok: true, sourceQueries: queries };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/source-profiles/:id/queries', async (request, reply) => {
    try {
      const store = getStore();
      const profile = await store.getSourceProfile(request.params.id);

      if (!profile) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      const input = normalizeQueryInput(
        parseBody(queryCreateSchema, request.body) as CreateSourceQueryInput,
        supportsDiscoveryControls(profile.type),
      );
      const query = await store.createSourceQuery(request.params.id, input);

      if (!query) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      return reply.code(201).send({ ok: true, sourceQuery: query });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/source-queries/:id', async (request, reply) => {
    try {
      const store = getStore();
      const profileType = await findSourceQueryProfile(store, request.params.id);

      if (!profileType) {
        throw new ApiError(404, 'SOURCE_QUERY_NOT_FOUND', `Source query not found: ${request.params.id}`);
      }

      const input = normalizeQueryInput(
        parseBody(queryPatchSchema, request.body) as UpdateSourceQueryInput,
        supportsDiscoveryControls(profileType),
      );
      const query = await store.updateSourceQuery(request.params.id, input);

      if (!query) {
        throw new ApiError(404, 'SOURCE_QUERY_NOT_FOUND', `Source query not found: ${request.params.id}`);
      }

      return { ok: true, sourceQuery: query };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/source-queries/:id', async (request, reply) => {
    try {
      const deleted = await getStore().deleteSourceQuery(request.params.id);

      if (!deleted) {
        throw new ApiError(404, 'SOURCE_QUERY_NOT_FOUND', `Source query not found: ${request.params.id}`);
      }

      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
