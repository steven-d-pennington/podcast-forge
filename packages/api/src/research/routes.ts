import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { canonicalizeUrl } from '../search/candidate.js';
import type { ResearchFetch } from './fetch.js';
import { fetchSourceSnapshot } from './fetch.js';
import { buildResearchPacketInput } from './builder.js';
import type { ResearchStore } from './store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ResearchRoutesOptions {
  getStore(): Partial<ResearchStore>;
  fetchImpl?: ResearchFetch;
}

const createPacketSchema = z.object({
  extraUrls: z.array(z.string().trim().url()).max(10).default([]),
});

const overrideWarningSchema = z.object({
  warningId: z.string().trim().min(1).optional(),
  warningCode: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1).default('local-user'),
  reason: z.string().trim().min(1),
}).refine((value) => value.warningId || value.warningCode, {
  message: 'Provide warningId or warningCode.',
  path: ['warningId'],
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

function requireResearchStore(store: Partial<ResearchStore>): ResearchStore {
  const required: Array<keyof ResearchStore> = [
    'getStoryCandidate',
    'createSourceDocument',
    'createResearchPacket',
    'getResearchPacket',
    'overrideResearchWarning',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'RESEARCH_STORE_UNAVAILABLE', `Research store method is unavailable: ${method}`);
    }
  }

  return store as ResearchStore;
}

function sourceUrlsFor(candidate: { url: string | null; canonicalUrl: string | null }, extraUrls: string[]): string[] {
  const urls = [candidate.canonicalUrl, candidate.url, ...extraUrls].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const key = canonicalizeUrl(url);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(url);
  }

  return result;
}

export function registerResearchRoutes(app: FastifyInstance, options: ResearchRoutesOptions) {
  app.post<{ Params: { id: string } }>('/story-candidates/:id/research-packet', async (request, reply) => {
    try {
      const store = requireResearchStore(options.getStore());
      const body = createPacketSchema.parse(request.body ?? {});
      const candidate = await store.getStoryCandidate(request.params.id);

      if (!candidate) {
        throw new ApiError(404, 'STORY_CANDIDATE_NOT_FOUND', `Story candidate not found: ${request.params.id}`);
      }

      const urls = sourceUrlsFor(candidate, body.extraUrls);

      if (urls.length === 0) {
        throw new ApiError(400, 'SOURCE_URL_REQUIRED', 'Candidate has no URL and no extraUrls were provided.');
      }

      const documentInputs = await Promise.all(urls.map((url) => {
        return fetchSourceSnapshot(candidate.id, url, options.fetchImpl);
      }));
      const documents = [];

      for (const input of documentInputs) {
        documents.push(await store.createSourceDocument(input));
      }

      const packet = await store.createResearchPacket(buildResearchPacketInput(candidate, documents));

      return reply.code(201).send({ ok: true, researchPacket: packet, sourceDocuments: documents });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/research-packets/:id', async (request, reply) => {
    try {
      const store = requireResearchStore(options.getStore());
      const packet = await store.getResearchPacket(request.params.id);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${request.params.id}`);
      }

      return { ok: true, researchPacket: packet };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/research-packets/:id/override-warning', async (request, reply) => {
    try {
      const store = requireResearchStore(options.getStore());
      const body = overrideWarningSchema.parse(request.body);
      const packet = await store.overrideResearchWarning(request.params.id, body);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_OR_WARNING_NOT_FOUND', `Research packet or warning not found: ${request.params.id}`);
      }

      return { ok: true, researchPacket: packet };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
