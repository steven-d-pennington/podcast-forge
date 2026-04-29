import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import type { BraveFetch } from './brave.js';
import { runSourceIngest, runSourceSearch } from './job.js';
import { submitManualCandidate } from './manual.js';
import { resolveRssFeedRefs, type RssFetch } from './rss.js';
import { createLlmCandidateScorer, type CandidateScorer } from './scoring.js';
import type { SearchJobStore } from './store.js';
import type { ZaiWebFetch } from './zai-web.js';
import type { OpenRouterPerplexityFetch } from './openrouter-perplexity.js';
import { createLlmRuntime } from '../llm/runtime.js';
import type { LlmRuntime } from '../llm/types.js';
import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import { createPromptRegistry } from '../prompts/registry.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type { SourceStore } from '../sources/store.js';
import { normalizeJobRecord } from '../jobs/summary.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SearchRoutesOptions {
  getStore(): SourceStore & Partial<SearchJobStore> & Partial<ModelProfileStore> & Partial<PromptTemplateStore>;
  braveApiKey?: string;
  zaiApiKey?: string;
  openRouterApiKey?: string;
  fetchImpl?: BraveFetch;
  zaiFetchImpl?: ZaiWebFetch;
  openRouterPerplexityFetchImpl?: OpenRouterPerplexityFetch;
  rssFetchImpl?: RssFetch;
  candidateScorer?: CandidateScorer;
  llmRuntime?: LlmRuntime;
  sleep?: (ms: number) => Promise<void>;
}

const candidateStatusSchema = z.enum(['new', 'shortlisted', 'ignored', 'merged']);

const candidateStatusUpdateSchema = z.object({
  status: candidateStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

const clearCandidatesSchema = z.object({
  showId: z.string().uuid().optional(),
  showSlug: z.string().min(1).optional(),
  sourceProfileId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});

const manualCandidateSchema = z.object({
  showId: z.string().uuid().optional(),
  showSlug: z.string().trim().min(1).optional(),
  url: z.string().trim().url(),
  title: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).optional(),
  sourceName: z.string().trim().min(1).optional(),
}).refine((value) => value.showId || value.showSlug, {
  message: 'Provide showId or showSlug.',
  path: ['showSlug'],
});

const jobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

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

  if (error && typeof error === 'object' && 'job' in error) {
    const job = error.job as { type?: string };
    const isIngest = job.type === 'source.ingest';

    return reply.code(502).send({
      ok: false,
      code: isIngest ? 'SOURCE_INGEST_FAILED' : 'SOURCE_SEARCH_FAILED',
      error: error instanceof Error ? error.message : isIngest ? 'Source ingest failed.' : 'Source search failed.',
      job: error.job,
    });
  }

  throw error;
}

function requireSearchStore(store: SourceStore & Partial<SearchJobStore>): SourceStore & SearchJobStore {
  const required: Array<keyof SearchJobStore> = [
    'createJob',
    'updateJob',
    'getJob',
    'listJobs',
    'listStoryCandidateDedupeKeys',
    'insertStoryCandidate',
    'updateStoryCandidateScoring',
    'listStoryCandidates',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'SEARCH_STORE_UNAVAILABLE', `Search store method is unavailable: ${method}`);
    }
  }

  return store as SourceStore & SearchJobStore;
}

function parseLimit(raw: string | undefined, fallback = 50) {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
}

function parseJobStatus(raw: string | undefined) {
  return raw ? jobStatusSchema.parse(raw) : undefined;
}

function parseJobTypes(raw: string | undefined) {
  return raw
    ? raw.split(',').map((type) => type.trim()).filter(Boolean)
    : undefined;
}

function candidateScorerFor(
  options: SearchRoutesOptions,
  rawStore: SourceStore & Partial<SearchJobStore> & Partial<ModelProfileStore> & Partial<PromptTemplateStore>,
  modelProfile: Awaited<ReturnType<typeof resolveModelProfile>>,
): CandidateScorer | undefined {
  if (options.candidateScorer) {
    return options.candidateScorer;
  }

  if (!modelProfile) {
    return undefined;
  }

  return createLlmCandidateScorer({
    runtime: options.llmRuntime ?? createLlmRuntime(),
    promptRegistry: createPromptRegistry({ store: rawStore }),
  });
}

function resolveZaiApiKey(options: SearchRoutesOptions): string | undefined {
  return options.zaiApiKey
    ?? process.env.ZAI_API_KEY
    ?? process.env.GLM_API_KEY
    ?? process.env.GLM_API
    ?? process.env.ZHIPU_API_KEY
    ?? process.env.ZHIPUAI_API_KEY;
}

function resolveOpenRouterApiKey(options: SearchRoutesOptions): string | undefined {
  return options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY;
}

function searchCredentialForSource(profileType: string, options: SearchRoutesOptions): string {
  if (profileType === 'brave') {
    const apiKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;

    if (!apiKey) {
      throw new ApiError(400, 'BRAVE_API_KEY_REQUIRED', 'Set BRAVE_API_KEY before running a Brave source search.');
    }

    return apiKey;
  }

  if (profileType === 'zai-web') {
    const apiKey = resolveZaiApiKey(options);

    if (!apiKey) {
      throw new ApiError(400, 'ZAI_API_KEY_REQUIRED', 'Set ZAI_API_KEY or GLM_API_KEY before running a Z.AI web source search.');
    }

    return apiKey;
  }

  if (profileType === 'openrouter-perplexity') {
    const apiKey = resolveOpenRouterApiKey(options);

    if (!apiKey) {
      throw new ApiError(400, 'OPENROUTER_API_KEY_REQUIRED', 'Set OPENROUTER_API_KEY before running an OpenRouter Perplexity source search.');
    }

    return apiKey;
  }

  throw new ApiError(400, 'UNSUPPORTED_SOURCE_TYPE', `source.search supports brave, zai-web, and openrouter-perplexity profiles, not ${profileType}.`);
}

async function resolveShowId(store: SourceStore, showId?: string, showSlug?: string): Promise<string> {
  if (showId) {
    const show = (await store.listShows()).find((candidate) => candidate.id === showId);

    if (!show) {
      throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showId}`);
    }

    return show.id;
  }

  if (!showSlug) {
    throw new ApiError(400, 'SHOW_FILTER_REQUIRED', 'Provide showId or showSlug.');
  }

  const show = (await store.listShows()).find((candidate) => candidate.slug === showSlug);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showSlug}`);
  }

  return show.id;
}

export function registerSearchRoutes(app: FastifyInstance, options: SearchRoutesOptions) {
  app.post<{ Params: { id: string } }>('/source-profiles/:id/search', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const store = requireSearchStore(rawStore);
      const profile = await store.getSourceProfile(request.params.id);

      if (!profile) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      if (profile.type !== 'brave' && profile.type !== 'zai-web' && profile.type !== 'openrouter-perplexity') {
        throw new ApiError(400, 'UNSUPPORTED_SOURCE_TYPE', `source.search supports brave, zai-web, and openrouter-perplexity profiles, not ${profile.type}.`);
      }

      if (!profile.enabled) {
        throw new ApiError(400, 'SOURCE_PROFILE_DISABLED', `Source profile is disabled: ${profile.slug}`);
      }

      const credential = searchCredentialForSource(profile.type, options);

      const queries = await store.listSourceQueries(profile.id, { enabledOnly: true });

      if (queries.length === 0) {
        throw new ApiError(400, 'NO_ENABLED_SOURCE_QUERIES', `Source profile has no enabled queries: ${profile.slug}`);
      }

      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: profile.showId, role: 'candidate_scorer' })
        : undefined;
      const candidateScorer = candidateScorerFor(options, rawStore, modelProfile);
      const result = await runSourceSearch({
        apiKey: credential,
        profile,
        queries,
        store,
        fetchImpl: options.fetchImpl,
        zaiFetchImpl: options.zaiFetchImpl,
        openRouterPerplexityFetchImpl: options.openRouterPerplexityFetchImpl,
        sleep: options.sleep,
        modelProfile,
        candidateScorer,
      });

      return {
        ok: true,
        job: result.job,
        inserted: result.inserted,
        skipped: result.skipped,
        candidates: result.candidates,
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/source-profiles/:id/ingest', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const store = requireSearchStore(rawStore);
      const profile = await store.getSourceProfile(request.params.id);

      if (!profile) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      if (profile.type !== 'rss') {
        throw new ApiError(400, 'UNSUPPORTED_SOURCE_TYPE', `source.ingest supports rss profiles, not ${profile.type}.`);
      }

      if (!profile.enabled) {
        throw new ApiError(400, 'SOURCE_PROFILE_DISABLED', `Source profile is disabled: ${profile.slug}`);
      }

      const queries = await store.listSourceQueries(profile.id, { enabledOnly: true });

      if (resolveRssFeedRefs(profile, queries).length === 0) {
        throw new ApiError(400, 'NO_RSS_FEEDS', `RSS profile has no enabled feed URLs: ${profile.slug}`);
      }

      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: profile.showId, role: 'candidate_scorer' })
        : undefined;
      const candidateScorer = candidateScorerFor(options, rawStore, modelProfile);
      const result = await runSourceIngest({
        profile,
        queries,
        store,
        fetchImpl: options.rssFetchImpl,
        modelProfile,
        candidateScorer,
      });

      return {
        ok: true,
        job: result.job,
        inserted: result.inserted,
        skipped: result.skipped,
        candidates: result.candidates,
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showId?: string; showSlug?: string; status?: string; types?: string; limit?: string } }>('/jobs', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const showId = request.query.showId || request.query.showSlug
        ? await resolveShowId(store, request.query.showId, request.query.showSlug)
        : undefined;
      const status = parseJobStatus(request.query.status);
      const jobs = await store.listJobs({
        showId,
        types: parseJobTypes(request.query.types),
        limit: parseLimit(request.query.limit),
      });
      const filtered = status ? jobs.filter((job) => job.status === status) : jobs;

      return { ok: true, jobs: filtered.map(normalizeJobRecord) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const job = await store.getJob(request.params.id);

      if (!job) {
        throw new ApiError(404, 'JOB_NOT_FOUND', `Job not found: ${request.params.id}`);
      }

      return { ok: true, job: normalizeJobRecord(job) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showId?: string; showSlug?: string; limit?: string; sort?: string; includeIgnored?: string } }>('/story-candidates', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const showId = await resolveShowId(store, request.query.showId, request.query.showSlug);
      const parsedLimit = request.query.limit ? Number(request.query.limit) : undefined;
      const limit = parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
      const sort = request.query.sort ?? 'score';
      const includeIgnored = request.query.includeIgnored === 'true';

      if (sort !== 'score' && sort !== 'discovered') {
        throw new ApiError(400, 'INVALID_CANDIDATE_SORT', 'Sort must be "score" or "discovered".');
      }

      const candidates = await store.listStoryCandidates({ showId, limit, sort, includeIgnored });

      return { ok: true, storyCandidates: candidates };
    } catch (error) {
      return sendError(reply, error);
    }
  });


  app.patch<{ Params: { id: string } }>('/story-candidates/:id', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const body = candidateStatusUpdateSchema.parse(request.body);
      const updated = await store.updateStoryCandidateStatus(request.params.id, {
        status: body.status,
        metadata: body.reason ? {
          statusReason: body.reason,
          statusUpdatedAt: new Date().toISOString(),
        } : {
          statusUpdatedAt: new Date().toISOString(),
        },
      });

      if (!updated) {
        throw new ApiError(404, 'CANDIDATE_NOT_FOUND', `Story candidate not found: ${request.params.id}`);
      }

      return { ok: true, candidate: updated };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/story-candidates/clear', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const body = clearCandidatesSchema.parse(request.body);
      const showId = await resolveShowId(store, body.showId, body.showSlug);
      const result = await store.clearStoryCandidates({
        showId,
        sourceProfileId: body.sourceProfileId,
        status: 'ignored',
        metadata: {
          clearReason: body.reason || 'Cleared from candidate review queue',
          clearedAt: new Date().toISOString(),
        },
      });

      return reply.code(200).send({ ok: true, updated: result.updated });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/story-candidates/manual', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const body = manualCandidateSchema.parse(request.body);
      const showId = await resolveShowId(store, body.showId, body.showSlug);
      let result;

      try {
        result = await submitManualCandidate(store, {
          showId,
          url: body.url,
          title: body.title,
          summary: body.summary,
          sourceName: body.sourceName,
        });
      } catch (error) {
        throw new ApiError(400, 'INVALID_MANUAL_URL', error instanceof Error ? error.message : 'Manual candidate URL is invalid.');
      }

      return reply.code(result.inserted ? 201 : 200).send({
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        reason: result.reason,
        candidate: result.candidate,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
