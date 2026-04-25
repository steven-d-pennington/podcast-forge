import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { canonicalizeUrl } from '../search/candidate.js';
import { modelProfileMap, hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
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
  getStore(): Partial<ResearchStore> & Partial<SearchJobStore> & Partial<ModelProfileStore>;
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

function hasResearchJobStore(store: object): store is Pick<SearchJobStore, 'createJob' | 'updateJob'> {
  return (
    'createJob' in store
    && typeof store.createJob === 'function'
    && 'updateJob' in store
    && typeof store.updateJob === 'function'
  );
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

async function createResearchJob(
  store: Pick<SearchJobStore, 'createJob'>,
  input: CreateJobInput,
): Promise<JobRecord> {
  return store.createJob(input);
}

async function updateResearchJob(
  store: Pick<SearchJobStore, 'updateJob'>,
  id: string,
  input: UpdateJobInput,
): Promise<JobRecord | undefined> {
  return store.updateJob(id, input);
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
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const rawStore = options.getStore();
      const store = requireResearchStore(rawStore);
      const body = createPacketSchema.parse(request.body ?? {});
      const candidate = await store.getStoryCandidate(request.params.id);

      if (!candidate) {
        throw new ApiError(404, 'STORY_CANDIDATE_NOT_FOUND', `Story candidate not found: ${request.params.id}`);
      }

      const urls = sourceUrlsFor(candidate, body.extraUrls);
      const modelProfiles = hasModelProfileStore(rawStore)
        ? modelProfileMap(await Promise.all([
          resolveModelProfile(rawStore, { showId: candidate.showId, role: 'source_summarizer' }),
          resolveModelProfile(rawStore, { showId: candidate.showId, role: 'claim_extractor' }),
          resolveModelProfile(rawStore, { showId: candidate.showId, role: 'research_synthesizer' }),
        ]))
        : {};

      if (urls.length === 0) {
        throw new ApiError(400, 'SOURCE_URL_REQUIRED', 'Candidate has no URL and no extraUrls were provided.');
      }

      logs.push(log('info', 'Starting research.packet job.', {
        storyCandidateId: candidate.id,
        sourceUrlCount: urls.length,
        modelRoles: Object.keys(modelProfiles),
      }));

      if (hasResearchJobStore(rawStore)) {
        jobStore = rawStore;
        job = await createResearchJob(rawStore, {
          showId: candidate.showId,
          type: 'research.packet',
          status: 'running',
          progress: 0,
          attempts: 1,
          input: {
            storyCandidateId: candidate.id,
            extraUrls: body.extraUrls,
            modelProfiles,
          },
          logs,
          startedAt: new Date(),
        });
      }

      const documentInputs = await Promise.all(urls.map((url) => {
        return fetchSourceSnapshot(candidate.id, url, options.fetchImpl);
      }));
      const documents = [];

      for (const input of documentInputs) {
        documents.push(await store.createSourceDocument(input));
      }

      const packetInput = buildResearchPacketInput(candidate, documents);
      const packet = await store.createResearchPacket({
        ...packetInput,
        content: {
          ...packetInput.content,
          modelProfiles,
        },
      });

      logs.push(log('info', 'Completed research.packet job.', {
        researchPacketId: packet.id,
        sourceDocumentCount: documents.length,
      }));
      if (jobStore && job) {
        job = await updateResearchJob(jobStore, job.id, {
          status: 'succeeded',
          progress: 100,
          logs,
          output: {
            researchPacketId: packet.id,
            sourceDocumentIds: documents.map((document) => document.id),
            modelProfiles,
          },
          finishedAt: new Date(),
        }) ?? job;
      }

      return reply.code(201).send({ ok: true, job, researchPacket: packet, sourceDocuments: documents });
    } catch (error) {
      if (jobStore && job) {
        const message = error instanceof Error ? error.message : 'Research packet generation failed.';
        logs.push(log('error', message));
        job = await updateResearchJob(jobStore, job.id, {
          status: 'failed',
          progress: job.progress,
          logs,
          error: message,
          finishedAt: new Date(),
        }) ?? job;
      }

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
