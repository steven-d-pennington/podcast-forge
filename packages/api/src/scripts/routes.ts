import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { LlmJsonOutputError, LlmRuntimeError, type LlmRuntime } from '../llm/types.js';
import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import { createPromptRegistry } from '../prompts/registry.js';
import { PromptRenderError } from '../prompts/renderer.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type { ResearchStore } from '../research/store.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import type { SourceStore, ShowRecord } from '../sources/store.js';
import {
  buildDeterministicScriptDraft,
  buildLlmScriptDraft,
  extractSpeakerLabels,
  invalidSpeakerLabels,
  provenanceWarnings,
} from './builder.js';
import { buildIntegrityReview } from './integrity.js';
import type { ScriptStore } from './store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ScriptRoutesOptions {
  getStore(): SourceStore
    & Partial<ResearchStore>
    & Partial<SearchJobStore>
    & Partial<ModelProfileStore>
    & Partial<PromptTemplateStore>
    & Partial<ScriptStore>;
  llmRuntime?: LlmRuntime;
}

const generateScriptSchema = z.object({
  format: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1).default('local-user'),
});

const createRevisionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1),
  format: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1).default('local-user'),
  changeSummary: z.string().trim().min(1).nullable().optional(),
});

const approveSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
  reason: z.string().trim().min(1).nullable().optional(),
});

const integrityReviewSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
});

const overrideIntegrityReviewSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
  reason: z.string().trim().min(1),
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

  if (error instanceof LlmJsonOutputError) {
    return reply.code(502).send({
      ok: false,
      code: 'MALFORMED_MODEL_OUTPUT',
      error: error.message,
      details: error.details,
      metadata: error.metadata,
    });
  }

  if (error instanceof LlmRuntimeError) {
    return reply.code(502).send({
      ok: false,
      code: 'MODEL_INVOCATION_FAILED',
      error: error.message,
      metadata: error.metadata,
    });
  }

  if (error instanceof PromptRenderError) {
    return reply.code(500).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
    });
  }

  throw error;
}

function requireResearchStore(store: Partial<ResearchStore>): Pick<ResearchStore, 'getResearchPacket'> {
  if (typeof store.getResearchPacket !== 'function') {
    throw new ApiError(503, 'RESEARCH_STORE_UNAVAILABLE', 'Research store method is unavailable: getResearchPacket');
  }

  return store as Pick<ResearchStore, 'getResearchPacket'>;
}

function requireScriptStore(store: Partial<ScriptStore>): ScriptStore {
  const required: Array<keyof ScriptStore> = [
    'createScriptWithRevision',
    'listScripts',
    'getScript',
    'listScriptRevisions',
    'getScriptRevision',
    'createScriptRevision',
    'updateScriptRevisionMetadata',
    'overrideIntegrityReview',
    'approveScriptRevision',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'SCRIPT_STORE_UNAVAILABLE', `Script store method is unavailable: ${method}`);
    }
  }

  return store as ScriptStore;
}

function hasScriptJobStore(store: object): store is Pick<SearchJobStore, 'createJob' | 'updateJob'> {
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

async function createScriptJob(
  store: Pick<SearchJobStore, 'createJob'>,
  input: CreateJobInput,
): Promise<JobRecord> {
  return store.createJob(input);
}

async function updateScriptJob(
  store: Pick<SearchJobStore, 'updateJob'>,
  id: string,
  input: UpdateJobInput,
): Promise<JobRecord | undefined> {
  return store.updateJob(id, input);
}

async function getShow(store: SourceStore, id: string): Promise<ShowRecord> {
  const show = (await store.listShows()).find((candidate) => candidate.id === id);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${id}`);
  }

  return show;
}

function assertCast(show: ShowRecord) {
  if (show.cast.length === 0) {
    throw new ApiError(400, 'SHOW_CAST_REQUIRED', `Show has no cast configured: ${show.slug}`);
  }
}

function assertValidSpeakers(body: string, show: ShowRecord) {
  const invalid = invalidSpeakerLabels(body, show.cast);

  if (invalid.length > 0) {
    throw new ApiError(
      400,
      'INVALID_SCRIPT_SPEAKER',
      `Speaker label(s) are not in the show cast: ${invalid.join(', ')}`,
    );
  }
}

function assertPacketCanGenerate(packet: { id: string; status: string; content: Record<string, unknown> }) {
  const readiness = packet.content.readiness;
  const readinessStatus = readiness && typeof readiness === 'object' && !Array.isArray(readiness)
    ? (readiness as Record<string, unknown>).status
    : undefined;

  if (packet.status === 'blocked' || readinessStatus === 'blocked') {
    throw new ApiError(
      409,
      'RESEARCH_PACKET_BLOCKED',
      `Research packet is blocked and cannot generate a script until source or warning issues are resolved: ${packet.id}`,
    );
  }
}

function modelProfileRecord(profile: Awaited<ReturnType<typeof resolveModelProfile>>): Record<string, unknown> {
  return profile ? { ...profile } : {};
}

function validationMetadata(body: string, show: ShowRecord, packet: { id: string; status: string; sourceDocumentIds: string[]; claims: Array<{ id: string; sourceDocumentIds: string[]; citationUrls: string[] }>; citations: Array<{ sourceDocumentId: string; url: string }>; content: Record<string, unknown> }) {
  const speakers = extractSpeakerLabels(body);
  const invalid = invalidSpeakerLabels(body, show.cast);
  const provenance = provenanceWarnings(packet, []);

  return {
    speakerLabels: {
      valid: invalid.length === 0,
      labels: speakers,
      invalid,
    },
    provenance: {
      valid: provenance.every((warning) => warning.severity !== 'error'),
      warningCount: provenance.length,
      warnings: provenance,
    },
    readyForAudio: invalid.length === 0 && provenance.every((warning) => warning.severity !== 'error'),
  };
}

function historicalMetadataValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

function inheritedRevisionMetadata(
  previousRevision: { id: string; metadata: Record<string, unknown> } | undefined,
  previousApprovedRevisionId: string | null,
  body: string,
  show: ShowRecord,
  packet: Parameters<typeof validationMetadata>[2],
) {
  const previous = previousRevision?.metadata;
  const inheritedCitationMap = previous?.citationMap !== undefined;
  const inheritedProvenance = previous?.provenance !== undefined;
  const inheritedIntegrityReview = previous?.integrityReview !== undefined;

  return {
    source: 'human-edit',
    previousSource: previous?.source ?? null,
    previousRevisionId: previousRevision?.id ?? null,
    previousApprovedRevisionId,
    provenanceStatus: {
      status: 'stale',
      verified: false,
      reason: 'human_edit',
      message: 'Script text changed in a human edit; citation mapping and provenance must be reviewed or rebuilt for this revision.',
      previousRevisionId: previousRevision?.id ?? null,
      previousApprovedRevisionId,
      previousSource: previous?.source ?? null,
      staleCitationMap: inheritedCitationMap,
      staleProvenance: inheritedProvenance,
      staleIntegrityReview: inheritedIntegrityReview,
    },
    staleCitationMap: historicalMetadataValue(previous?.citationMap),
    previousProvenanceSnapshot: historicalMetadataValue(previous?.provenance),
    previousIntegrityReviewSnapshot: historicalMetadataValue(previous?.integrityReview),
    inheritedProvenance: inheritedCitationMap || inheritedProvenance,
    validation: validationMetadata(body, show, packet),
  };
}

export function registerScriptRoutes(app: FastifyInstance, options: ScriptRoutesOptions) {
  app.post<{ Params: { id: string } }>('/research-packets/:id/script', async (request, reply) => {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const rawStore = options.getStore();
      const sourceStore = rawStore;
      const researchStore = requireResearchStore(rawStore);
      const scriptStore = requireScriptStore(rawStore);
      const body = generateScriptSchema.parse(request.body ?? {});
      const packet = await researchStore.getResearchPacket(request.params.id);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${request.params.id}`);
      }

      const show = await getShow(sourceStore, packet.showId);
      assertCast(show);
      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: packet.showId, role: 'script_writer' })
        : undefined;
      logs.push(log('info', 'Starting script.generate job.', {
        researchPacketId: packet.id,
        modelRole: modelProfile?.role,
        modelProfileId: modelProfile?.id,
      }));

      if (hasScriptJobStore(rawStore)) {
        jobStore = rawStore;
        job = await createScriptJob(rawStore, {
          showId: packet.showId,
          type: 'script.generate',
          status: 'running',
          progress: 0,
          attempts: 1,
          input: {
            researchPacketId: packet.id,
            format: body.format ?? show.format ?? 'feature-analysis',
            modelProfile,
            actor: body.actor,
          },
          logs,
          startedAt: new Date(),
        });
      }

      assertPacketCanGenerate(packet);
      const draft = options.llmRuntime && modelProfile
        ? await buildLlmScriptDraft(show, packet, modelProfile, body.format, {
          runtime: options.llmRuntime,
          promptRegistry: createPromptRegistry({ store: rawStore }),
        })
        : buildDeterministicScriptDraft(show, packet, modelProfile, body.format);
      assertValidSpeakers(draft.body, show);
      const result = await scriptStore.createScriptWithRevision({
        showId: packet.showId,
        researchPacketId: packet.id,
        title: draft.title,
        format: draft.format,
        metadata: draft.metadata,
        revision: {
          title: draft.title,
          body: draft.body,
          format: draft.format,
          speakers: draft.speakers,
          author: body.actor,
          changeSummary: 'Initial deterministic draft from research packet.',
          modelProfile: modelProfileRecord(modelProfile),
          metadata: draft.metadata,
        },
      });

      logs.push(log('info', 'Completed script.generate job.', {
        scriptId: result.script.id,
        revisionId: result.revision.id,
        version: result.revision.version,
      }));
      if (jobStore && job) {
        job = await updateScriptJob(jobStore, job.id, {
          status: 'succeeded',
          progress: 100,
          logs,
          output: {
            scriptId: result.script.id,
            revisionId: result.revision.id,
            version: result.revision.version,
            modelProfile,
            validation: result.revision.metadata.validation,
            provenance: result.revision.metadata.provenance,
            citationMap: result.revision.metadata.citationMap,
          },
          finishedAt: new Date(),
        }) ?? job;
      }

      return reply.code(201).send({ ok: true, job, script: result.script, revision: result.revision });
    } catch (error) {
      if (jobStore && job) {
        const message = error instanceof Error ? error.message : 'Script generation failed.';
        logs.push(log('error', message));
        job = await updateScriptJob(jobStore, job.id, {
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

  app.get<{ Querystring: { showSlug?: string; researchPacketId?: string; limit?: string } }>('/scripts', async (request, reply) => {
    try {
      const scriptStore = requireScriptStore(options.getStore());
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const scripts = await scriptStore.listScripts({
        showSlug: request.query.showSlug,
        researchPacketId: request.query.researchPacketId,
        limit: Number.isFinite(limit) ? limit : undefined,
      });

      return { ok: true, scripts };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/scripts/:id', async (request, reply) => {
    try {
      const scriptStore = requireScriptStore(options.getStore());
      const script = await scriptStore.getScript(request.params.id);

      if (!script) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      const revisions = await scriptStore.listScriptRevisions(script.id);
      return { ok: true, script, revisions, latestRevision: revisions[0] };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/scripts/:id/revisions', async (request, reply) => {
    try {
      const scriptStore = requireScriptStore(options.getStore());
      const script = await scriptStore.getScript(request.params.id);

      if (!script) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      return { ok: true, revisions: await scriptStore.listScriptRevisions(script.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/revisions', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const scriptStore = requireScriptStore(rawStore);
      const body = createRevisionSchema.parse(request.body);
      const script = await scriptStore.getScript(request.params.id);

      if (!script) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      const show = await getShow(rawStore, script.showId);
      assertCast(show);
      assertValidSpeakers(body.body, show);
      const researchStore = requireResearchStore(rawStore);
      const packet = await researchStore.getResearchPacket(script.researchPacketId);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${script.researchPacketId}`);
      }

      const revisions = await scriptStore.listScriptRevisions(script.id);
      const latestRevision = revisions[0];
      const result = await scriptStore.createScriptRevision(script.id, {
        title: body.title ?? script.title,
        body: body.body,
        format: body.format ?? script.format,
        speakers: extractSpeakerLabels(body.body),
        author: body.actor,
        changeSummary: body.changeSummary ?? 'Human edit.',
        modelProfile: {},
        metadata: {
          ...inheritedRevisionMetadata(latestRevision, script.approvedRevisionId, body.body, show, packet),
        },
      });

      if (!result) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      return reply.code(201).send({ ok: true, script: result.script, revision: result.revision });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string; revisionId: string } }>('/scripts/:id/revisions/:revisionId/integrity-review', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const scriptStore = requireScriptStore(rawStore);
      const researchStore = requireResearchStore(rawStore);
      const body = integrityReviewSchema.parse(request.body ?? {});
      const script = await scriptStore.getScript(request.params.id);

      if (!script) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      const revision = await scriptStore.getScriptRevision(request.params.revisionId);

      if (!revision || revision.scriptId !== script.id) {
        throw new ApiError(404, 'SCRIPT_REVISION_NOT_FOUND', `Script revision not found: ${request.params.revisionId}`);
      }

      const packet = await researchStore.getResearchPacket(script.researchPacketId);

      if (!packet) {
        throw new ApiError(404, 'RESEARCH_PACKET_NOT_FOUND', `Research packet not found: ${script.researchPacketId}`);
      }

      const show = await getShow(rawStore, script.showId);
      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: script.showId, role: 'integrity_reviewer' })
        : undefined;

      if (!options.llmRuntime) {
        throw new ApiError(503, 'INTEGRITY_REVIEW_RUNTIME_UNAVAILABLE', 'Integrity review requires an injected LLM runtime.');
      }

      if (!modelProfile) {
        throw new ApiError(409, 'INTEGRITY_REVIEW_MODEL_PROFILE_REQUIRED', 'No integrity_reviewer model profile is configured for this show.');
      }

      const review = await buildIntegrityReview(show, packet, script, revision, modelProfile, body.actor, {
        runtime: options.llmRuntime,
        promptRegistry: createPromptRegistry({ store: rawStore }),
      });
      const updatedRevision = await scriptStore.updateScriptRevisionMetadata(revision.id, {
        ...revision.metadata,
        integrityReview: review,
      });

      if (!updatedRevision) {
        throw new ApiError(404, 'SCRIPT_REVISION_NOT_FOUND', `Script revision not found: ${request.params.revisionId}`);
      }

      return reply.code(201).send({ ok: true, script, revision: updatedRevision, integrityReview: review });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string; revisionId: string } }>('/scripts/:id/revisions/:revisionId/integrity-review/override', async (request, reply) => {
    try {
      const scriptStore = requireScriptStore(options.getStore());
      const body = overrideIntegrityReviewSchema.parse(request.body ?? {});
      const revision = await scriptStore.overrideIntegrityReview(request.params.id, request.params.revisionId, {
        actor: body.actor,
        reason: body.reason,
      });

      if (!revision) {
        throw new ApiError(404, 'SCRIPT_REVISION_NOT_FOUND', `Script revision not found: ${request.params.revisionId}`);
      }

      return reply.code(201).send({ ok: true, revision, integrityReview: revision.metadata.integrityReview });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string; revisionId: string } }>('/scripts/:id/revisions/:revisionId/approve-for-audio', async (request, reply) => {
    try {
      const scriptStore = requireScriptStore(options.getStore());
      const body = approveSchema.parse(request.body ?? {});
      const script = await scriptStore.approveScriptRevision(request.params.id, request.params.revisionId, {
        actor: body.actor,
        reason: body.reason ?? null,
      });

      if (!script) {
        throw new ApiError(404, 'SCRIPT_REVISION_NOT_FOUND', `Script revision not found: ${request.params.revisionId}`);
      }

      return { ok: true, script };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
