import type { FastifyInstance, FastifyReply } from 'fastify';

import type { BraveFetch } from './brave.js';
import { runSourceSearch } from './job.js';
import type { SearchJobStore } from './store.js';
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

export interface SearchRoutesOptions {
  getStore(): SourceStore & Partial<SearchJobStore>;
  braveApiKey?: string;
  fetchImpl?: BraveFetch;
  sleep?: (ms: number) => Promise<void>;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
    });
  }

  if (error && typeof error === 'object' && 'job' in error) {
    return reply.code(502).send({
      ok: false,
      code: 'SOURCE_SEARCH_FAILED',
      error: error instanceof Error ? error.message : 'Source search failed.',
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
    'listStoryCandidateDedupeKeys',
    'insertStoryCandidate',
    'listStoryCandidates',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'SEARCH_STORE_UNAVAILABLE', `Search store method is unavailable: ${method}`);
    }
  }

  return store as SourceStore & SearchJobStore;
}

async function resolveShowId(store: SourceStore, showId?: string, showSlug?: string): Promise<string> {
  if (showId) {
    return showId;
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
      const store = requireSearchStore(options.getStore());
      const profile = await store.getSourceProfile(request.params.id);

      if (!profile) {
        throw new ApiError(404, 'SOURCE_PROFILE_NOT_FOUND', `Source profile not found: ${request.params.id}`);
      }

      if (profile.type !== 'brave') {
        throw new ApiError(400, 'UNSUPPORTED_SOURCE_TYPE', `source.search supports brave profiles, not ${profile.type}.`);
      }

      if (!profile.enabled) {
        throw new ApiError(400, 'SOURCE_PROFILE_DISABLED', `Source profile is disabled: ${profile.slug}`);
      }

      const apiKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;

      if (!apiKey) {
        throw new ApiError(400, 'BRAVE_API_KEY_REQUIRED', 'Set BRAVE_API_KEY before running a Brave source search.');
      }

      const queries = await store.listSourceQueries(profile.id, { enabledOnly: true });

      if (queries.length === 0) {
        throw new ApiError(400, 'NO_ENABLED_SOURCE_QUERIES', `Source profile has no enabled queries: ${profile.slug}`);
      }

      const result = await runSourceSearch({
        apiKey,
        profile,
        queries,
        store,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
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

  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const job = await store.getJob(request.params.id);

      if (!job) {
        throw new ApiError(404, 'JOB_NOT_FOUND', `Job not found: ${request.params.id}`);
      }

      return { ok: true, job };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showId?: string; showSlug?: string; limit?: string } }>('/story-candidates', async (request, reply) => {
    try {
      const store = requireSearchStore(options.getStore());
      const showId = await resolveShowId(store, request.query.showId, request.query.showSlug);
      const parsedLimit = request.query.limit ? Number(request.query.limit) : undefined;
      const limit = parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
      const candidates = await store.listStoryCandidates({ showId, limit });

      return { ok: true, storyCandidates: candidates };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
