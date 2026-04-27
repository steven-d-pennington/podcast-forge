import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { canonicalizeUrl } from '../search/candidate.js';
import { modelProfileMap, hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import type { LlmRuntime } from '../llm/types.js';
import { createPromptRegistry } from '../prompts/registry.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import type { ResearchFetch } from './fetch.js';
import { fetchSourceSnapshot } from './fetch.js';
import { buildResearchPacketInputFromCandidates } from './builder.js';
import { createLlmResearchModelServices, type ResearchModelServices } from './models.js';
import type { ResearchStore, ResearchWarning } from './store.js';

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
  getStore(): Partial<ResearchStore> & Partial<SearchJobStore> & Partial<ModelProfileStore> & Partial<PromptTemplateStore>;
  fetchImpl?: ResearchFetch;
  llmRuntime?: LlmRuntime;
  researchModelServices?: ResearchModelServices;
}

const createPacketSchema = z.object({
  extraUrls: z.array(z.string().trim().url()).max(10).default([]),
});

const createMultiCandidatePacketSchema = z.object({
  candidateIds: z.array(z.string().trim().min(1)).min(1).max(20),
  extraUrls: z.array(z.string().trim().url()).max(10).default([]),
  angle: z.string().trim().min(1).max(500).nullable().optional(),
  notes: z.string().trim().min(1).max(2_000).nullable().optional(),
  targetFormat: z.string().trim().min(1).max(120).nullable().optional(),
  targetRuntime: z.string().trim().min(1).max(120).nullable().optional(),
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

const approveResearchSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
  reason: z.string().trim().min(1).nullable().optional(),
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
    'listResearchPackets',
    'overrideResearchWarning',
    'approveResearchPacket',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'RESEARCH_STORE_UNAVAILABLE', `Research store method is unavailable: ${method}`);
    }
  }

  return store as ResearchStore;
}

function readinessStatus(packet: { status: string; content: Record<string, unknown> }) {
  const readiness = packet.content.readiness;
  const contentStatus = readiness && typeof readiness === 'object' && !Array.isArray(readiness)
    ? (readiness as Record<string, unknown>).status
    : undefined;

  return typeof contentStatus === 'string' ? contentStatus : packet.status;
}

function unresolvedWarnings(packet: { warnings: ResearchWarning[] }) {
  return packet.warnings.filter((warning) => !warning.override);
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

function sourceInputsFor(
  candidates: Array<{ id: string; url: string | null; canonicalUrl: string | null }>,
  extraUrls: string[],
): { sources: Array<{ url: string; storyCandidateId: string | null }>; warnings: ResearchWarning[] } {
  const urls = [
    ...candidates.flatMap((candidate) => {
      return [candidate.canonicalUrl, candidate.url]
        .filter((value): value is string => Boolean(value))
        .map((url) => ({ url, storyCandidateId: candidate.id }));
    }),
    ...extraUrls.map((url) => ({ url, storyCandidateId: null })),
  ];
  const seen = new Set<string>();
  const sources: Array<{ url: string; storyCandidateId: string | null }> = [];
  const warnings: ResearchWarning[] = [];

  for (const source of urls) {
    const key = canonicalizeUrl(source.url);

    if (seen.has(key)) {
      warnings.push({
        id: `DUPLICATE_SOURCE_URL:${key}`,
        code: 'DUPLICATE_SOURCE_URL',
        severity: 'info',
        message: `Duplicate source URL skipped: ${source.url}`,
        url: source.url,
        metadata: { canonicalUrl: key },
      });
      continue;
    }

    seen.add(key);
    sources.push(source);
  }

  return { sources, warnings };
}

function duplicatedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }

    seen.add(value);
  }

  return [...duplicated];
}

async function selectedCandidates(
  store: ResearchStore,
  candidateIds: string[],
) {
  const duplicateIds = duplicatedValues(candidateIds);
  const uniqueIds = [...new Set(candidateIds)];
  const candidates = await Promise.all(uniqueIds.map(async (id) => {
    const candidate = await store.getStoryCandidate(id);

    if (!candidate) {
      throw new ApiError(404, 'STORY_CANDIDATE_NOT_FOUND', `Story candidate not found: ${id}`);
    }

    if (candidate.status === 'ignored') {
      throw new ApiError(400, 'STORY_CANDIDATE_IGNORED', `Ignored story candidate cannot be used for research: ${id}`);
    }

    return candidate;
  }));
  const showIds = new Set(candidates.map((candidate) => candidate.showId));

  if (showIds.size > 1) {
    throw new ApiError(400, 'CANDIDATE_SHOW_MISMATCH', 'All story candidates in a research packet must belong to the same show.');
  }

  const warnings = duplicateIds.map((id): ResearchWarning => ({
    id: `DUPLICATE_CANDIDATE_ID:${id}`,
    code: 'DUPLICATE_CANDIDATE_ID',
    severity: 'info',
    message: `Duplicate candidate ID was provided once and ignored on repeat: ${id}`,
    metadata: { candidateId: id },
  }));

  return { candidates, warnings, duplicateIds, uniqueIds };
}

function researchModelsFor(options: ResearchRoutesOptions, store: Partial<PromptTemplateStore>): ResearchModelServices | undefined {
  if (options.researchModelServices) {
    return options.researchModelServices;
  }

  if (!options.llmRuntime) {
    return undefined;
  }

  return createLlmResearchModelServices({
    runtime: options.llmRuntime,
    promptRegistry: createPromptRegistry({ store }),
  });
}

function modelFailureWarning(code: string, message: string): ResearchWarning {
  return {
    id: `${code}:research.packet`,
    code,
    severity: 'warning',
    message,
  };
}

export function registerResearchRoutes(app: FastifyInstance, options: ResearchRoutesOptions) {
  async function createPacket(
    rawStore: Partial<ResearchStore> & Partial<SearchJobStore> & Partial<ModelProfileStore> & Partial<PromptTemplateStore>,
    input: {
      candidateIds: string[];
      extraUrls: string[];
      angle?: string | null;
      notes?: string | null;
      targetFormat?: string | null;
      targetRuntime?: string | null;
    },
  ) {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const store = requireResearchStore(rawStore);
      const selection = await selectedCandidates(store, input.candidateIds);
      const candidates = selection.candidates;
      const showId = candidates[0].showId;
      const sourceInput = sourceInputsFor(candidates, input.extraUrls);
      const warnings = [...selection.warnings, ...sourceInput.warnings];
      const modelProfiles = hasModelProfileStore(rawStore)
        ? modelProfileMap(await Promise.all([
          resolveModelProfile(rawStore, { showId, role: 'source_summarizer' }),
          resolveModelProfile(rawStore, { showId, role: 'claim_extractor' }),
          resolveModelProfile(rawStore, { showId, role: 'research_synthesizer' }),
        ]))
        : {};

      if (sourceInput.sources.length === 0) {
        throw new ApiError(400, 'SOURCE_URL_REQUIRED', 'Selected candidates have no URLs and no extraUrls were provided.');
      }

      logs.push(log('info', 'Starting research.packet job.', {
        candidateIds: candidates.map((candidate) => candidate.id),
        sourceUrlCount: sourceInput.sources.length,
        modelRoles: Object.keys(modelProfiles),
      }));

      if (hasResearchJobStore(rawStore)) {
        jobStore = rawStore;
        job = await createResearchJob(rawStore, {
          showId,
          type: 'research.packet',
          status: 'running',
          progress: 0,
          attempts: 1,
          input: {
            candidateIds: input.candidateIds,
            selectedCandidateIds: candidates.map((candidate) => candidate.id),
            duplicateCandidateIds: selection.duplicateIds,
            extraUrls: input.extraUrls,
            angle: input.angle ?? null,
            notes: input.notes ?? null,
            targetFormat: input.targetFormat ?? null,
            targetRuntime: input.targetRuntime ?? null,
            modelProfiles,
          },
          logs,
          startedAt: new Date(),
        });
      }

      const documentInputs = await Promise.all(sourceInput.sources.map((source) => {
        return fetchSourceSnapshot(source.storyCandidateId, source.url, options.fetchImpl);
      }));
      const documents = [];

      for (const input of documentInputs) {
        documents.push(await store.createSourceDocument(input));
      }

      const modelServices = researchModelsFor(options, rawStore);
      let extracted = { claims: [], warnings: [], invocations: [] } as Awaited<ReturnType<ResearchModelServices['extractClaims']>>;
      let synthesized = { synthesis: null, claims: [], warnings: [], invocations: [] } as Awaited<ReturnType<ResearchModelServices['synthesize']>>;

      if (modelServices) {
        try {
          extracted = await modelServices.extractClaims({
            showId,
            candidates,
            documents,
            modelProfile: modelProfiles.claim_extractor,
          });
        } catch (error) {
          extracted = {
            claims: [],
            warnings: [modelFailureWarning(
              'MODEL_CLAIM_EXTRACTION_FAILED',
              error instanceof Error ? error.message : 'Claim extraction model failed.',
            )],
            invocations: [],
          };
        }

        try {
          synthesized = await modelServices.synthesize({
            showId,
            candidates,
            documents,
            claims: extracted.claims,
            warnings: [...warnings, ...extracted.warnings],
            angle: input.angle,
            notes: input.notes,
            targetFormat: input.targetFormat,
            targetRuntime: input.targetRuntime,
            modelProfile: modelProfiles.research_synthesizer,
          });
        } catch (error) {
          synthesized = {
            synthesis: null,
            claims: [],
            warnings: [modelFailureWarning(
              'MODEL_RESEARCH_SYNTHESIS_FAILED',
              error instanceof Error ? error.message : 'Research synthesis model failed.',
            )],
            invocations: [],
          };
        }
      }
      const packetInput = buildResearchPacketInputFromCandidates({
        candidates,
        documents,
        angle: input.angle,
        notes: input.notes,
        targetFormat: input.targetFormat,
        targetRuntime: input.targetRuntime,
        warnings: [...warnings, ...extracted.warnings, ...synthesized.warnings],
        claims: [...extracted.claims, ...synthesized.claims],
        synthesis: synthesized.synthesis,
        modelProfiles,
        modelInvocations: [...extracted.invocations, ...synthesized.invocations].map((invocation) => {
          return invocation as unknown as Record<string, unknown>;
        }),
      });
      const packet = await store.createResearchPacket(packetInput);
      const failedDocuments = documents.filter((document) => document.fetchStatus !== 'fetched');

      logs.push(log('info', 'Completed research.packet job.', {
        researchPacketId: packet.id,
        sourceDocumentCount: documents.length,
        warningCount: packet.warnings.length,
        readinessStatus: packet.status,
      }));
      if (jobStore && job) {
        job = await updateResearchJob(jobStore, job.id, {
          status: 'succeeded',
          progress: 100,
          logs,
          output: {
            researchPacketId: packet.id,
            sourceDocumentIds: documents.map((document) => document.id),
            fetchedSourceDocumentIds: documents.filter((document) => document.fetchStatus === 'fetched').map((document) => document.id),
            failedSourceDocumentIds: failedDocuments.map((document) => document.id),
            modelProfiles,
            warnings: packet.warnings,
            warningCount: packet.warnings.length,
            readiness: packet.content.readiness,
          },
          finishedAt: new Date(),
        }) ?? job;
      }

      return { job, researchPacket: packet, sourceDocuments: documents };
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

      throw error;
    }
  }

  app.post<{ Params: { id: string } }>('/story-candidates/:id/research-packet', async (request, reply) => {
    try {
      const body = createPacketSchema.parse(request.body ?? {});
      const result = await createPacket(options.getStore(), {
        candidateIds: [request.params.id],
        extraUrls: body.extraUrls,
      });

      return reply.code(201).send({ ok: true, ...result });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/research-packets', async (request, reply) => {
    try {
      const body = createMultiCandidatePacketSchema.parse(request.body ?? {});
      const result = await createPacket(options.getStore(), {
        candidateIds: body.candidateIds,
        extraUrls: body.extraUrls,
        angle: body.angle,
        notes: body.notes,
        targetFormat: body.targetFormat,
        targetRuntime: body.targetRuntime,
      });

      return reply.code(201).send({ ok: true, ...result });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showSlug?: string; limit?: string } }>('/research-packets', async (request, reply) => {
    try {
      const store = requireResearchStore(options.getStore());
      const limit = request.query.limit ? Number(request.query.limit) : undefined;

      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
        throw new ApiError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 200.');
      }

      const packets = await store.listResearchPackets({
        showSlug: request.query.showSlug,
        limit,
      });

      return { ok: true, researchPackets: packets };
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

  app.post<{ Params: { id: string } }>('/research-packets/:id/approve', async (request, reply) => {
    try {
      const store = requireResearchStore(options.getStore());
      const body = approveResearchSchema.parse(request.body ?? {});
      const packet = await store.getResearchPacket(request.params.id);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${request.params.id}`);
      }

      const status = readinessStatus(packet);
      const unresolved = unresolvedWarnings(packet);

      if (!['ready', 'approved', 'research-ready'].includes(status) || unresolved.length > 0) {
        throw new ApiError(
          409,
          'RESEARCH_APPROVAL_BLOCKED',
          'Research brief cannot be approved until it is ready and warnings are overridden.',
        );
      }

      const approved = await store.approveResearchPacket(packet.id, {
        actor: body.actor,
        reason: body.reason ?? null,
        metadata: {
          previousStatus: packet.status,
          readinessStatus: status,
          warningCount: packet.warnings.length,
        },
      });

      if (!approved) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${request.params.id}`);
      }

      return reply.code(201).send({ ok: true, researchPacket: approved });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
