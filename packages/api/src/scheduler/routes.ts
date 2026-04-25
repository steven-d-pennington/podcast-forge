import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import type { ModelProfileStore } from '../models/store.js';
import type { BraveFetch } from '../search/brave.js';
import type { RssFetch } from '../search/rss.js';
import type { SearchJobStore } from '../search/store.js';
import type { SourceStore } from '../sources/store.js';
import { assertValidCron, nextCronRun } from './cron.js';
import { runScheduledPipeline } from './runner.js';
import type { ScheduledPipelineStage, SchedulerStore } from './store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SchedulerRoutesOptions {
  getStore(): SourceStore & Partial<SearchJobStore> & Partial<SchedulerStore> & Partial<ModelProfileStore>;
  braveApiKey?: string;
  fetchImpl?: BraveFetch;
  rssFetchImpl?: RssFetch;
  sleep?: (ms: number) => Promise<void>;
}

const workflowStageSchema = z.enum(['ingest', 'research', 'script', 'audio', 'publish']);
const jobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const scheduledPipelineFieldsSchema = z.object({
  showId: z.string().uuid().optional(),
  showSlug: z.string().trim().min(1).optional(),
  feedId: z.string().trim().min(1).nullable().optional(),
  sourceProfileId: z.string().trim().min(1).nullable().optional(),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  cron: z.string().trim().min(1),
  timezone: z.string().trim().min(1).default('UTC'),
  workflow: z.array(workflowStageSchema).min(1),
  autopublish: z.boolean().default(false),
  legacyAdapter: z.record(z.string(), z.unknown()).default({}),
  config: z.record(z.string(), z.unknown()).default({}),
});
const scheduledPipelineBodySchema = scheduledPipelineFieldsSchema.refine((value) => value.showId || value.showSlug, {
  message: 'Provide showId or showSlug.',
  path: ['showSlug'],
});
const updateScheduledPipelineBodySchema = scheduledPipelineFieldsSchema
  .omit({ showId: true, showSlug: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });
const runNowBodySchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
});
const heartbeatBodySchema = z.object({
  now: z.string().datetime().optional(),
  runnerId: z.string().trim().min(1).default('local-heartbeat'),
  limit: z.number().int().min(1).max(50).default(10),
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

function requireSchedulerStore(
  store: SourceStore & Partial<SearchJobStore> & Partial<SchedulerStore>,
): SourceStore & SearchJobStore & SchedulerStore {
  const required: Array<keyof SearchJobStore | keyof SchedulerStore> = [
    'createJob',
    'updateJob',
    'getJob',
    'listJobs',
    'listStoryCandidateDedupeKeys',
    'insertStoryCandidate',
    'listStoryCandidates',
    'createScheduledPipeline',
    'updateScheduledPipeline',
    'getScheduledPipeline',
    'listScheduledPipelines',
    'markScheduledPipelineRun',
    'listScheduledRuns',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'SCHEDULER_STORE_UNAVAILABLE', `Scheduler store method is unavailable: ${method}`);
    }
  }

  return store as SourceStore & SearchJobStore & SchedulerStore;
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

function parseLimit(raw: string | undefined) {
  const parsed = raw ? Number(raw) : undefined;
  return parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseJobStatus(raw: string | undefined) {
  return raw ? jobStatusSchema.parse(raw) : undefined;
}

export function registerSchedulerRoutes(app: FastifyInstance, options: SchedulerRoutesOptions) {
  app.get<{ Querystring: { showId?: string; showSlug?: string; enabledOnly?: string } }>('/scheduled-pipelines', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const showId = request.query.showId || request.query.showSlug
        ? await resolveShowId(store, request.query.showId, request.query.showSlug)
        : undefined;
      const scheduledPipelines = await store.listScheduledPipelines({
        showId,
        enabledOnly: request.query.enabledOnly === 'true',
      });

      return { ok: true, scheduledPipelines };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/scheduled-pipelines', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const body = scheduledPipelineBodySchema.parse(request.body);
      assertValidCron(body.cron);
      const showId = await resolveShowId(store, body.showId, body.showSlug);

      if (body.sourceProfileId) {
        const profile = await store.getSourceProfile(body.sourceProfileId);

        if (!profile || profile.showId !== showId) {
          throw new ApiError(400, 'SOURCE_PROFILE_SHOW_MISMATCH', 'Source profile must belong to the scheduled pipeline show.');
        }
      }

      const scheduledPipeline = await store.createScheduledPipeline({
        showId,
        feedId: body.feedId ?? null,
        sourceProfileId: body.sourceProfileId ?? null,
        slug: body.slug,
        name: body.name,
        enabled: body.enabled,
        cron: body.cron,
        timezone: body.timezone,
        workflow: body.workflow as ScheduledPipelineStage[],
        autopublish: body.autopublish,
        legacyAdapter: body.legacyAdapter,
        config: body.config,
        nextRunAt: body.enabled ? nextCronRun(body.cron) : null,
      });

      return reply.code(201).send({ ok: true, scheduledPipeline });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/scheduled-pipelines/:id', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const body = updateScheduledPipelineBodySchema.parse(request.body);

      if (body.cron) {
        assertValidCron(body.cron);
      }

      const current = await store.getScheduledPipeline(request.params.id);

      if (!current) {
        throw new ApiError(404, 'SCHEDULED_PIPELINE_NOT_FOUND', `Scheduled pipeline not found: ${request.params.id}`);
      }

      const cron = body.cron ?? current.cron;
      const enabled = body.enabled ?? current.enabled;
      const scheduledPipeline = await store.updateScheduledPipeline(request.params.id, {
        ...body,
        workflow: body.workflow as ScheduledPipelineStage[] | undefined,
        nextRunAt: enabled ? nextCronRun(cron) : null,
      });

      return { ok: true, scheduledPipeline };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/scheduled-pipelines/:id/run', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const body = runNowBodySchema.parse(request.body ?? {});
      const pipeline = await store.getScheduledPipeline(request.params.id);

      if (!pipeline) {
        throw new ApiError(404, 'SCHEDULED_PIPELINE_NOT_FOUND', `Scheduled pipeline not found: ${request.params.id}`);
      }

      const result = await runScheduledPipeline({
        pipeline,
        store,
        reason: 'manual',
        triggeredBy: body.actor,
        braveApiKey: options.braveApiKey,
        fetchImpl: options.fetchImpl,
        rssFetchImpl: options.rssFetchImpl,
        sleep: options.sleep,
      });

      return reply.code(201).send({ ok: true, job: result.job, stageJobs: result.stageJobs });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/scheduler/heartbeat', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const body = heartbeatBodySchema.parse(request.body ?? {});
      const now = body.now ? new Date(body.now) : new Date();
      const due = await store.listScheduledPipelines({ enabledOnly: true, dueAt: now, limit: body.limit });
      const runs = [];

      for (const pipeline of due) {
        const result = await runScheduledPipeline({
          pipeline,
          store,
          reason: 'heartbeat',
          triggeredBy: body.runnerId,
          now,
          braveApiKey: options.braveApiKey,
          fetchImpl: options.fetchImpl,
          rssFetchImpl: options.rssFetchImpl,
          sleep: options.sleep,
        });
        runs.push(result);
      }

      return { ok: true, dueCount: due.length, runs };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string; limit?: string } }>('/scheduled-pipelines/:id/runs', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const pipeline = await store.getScheduledPipeline(request.params.id);

      if (!pipeline) {
        throw new ApiError(404, 'SCHEDULED_PIPELINE_NOT_FOUND', `Scheduled pipeline not found: ${request.params.id}`);
      }

      const jobs = await store.listScheduledRuns({
        scheduledPipelineId: pipeline.id,
        status: parseJobStatus(request.query.status),
        limit: parseLimit(request.query.limit),
      });

      return { ok: true, jobs };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: { showId?: string; showSlug?: string; status?: string; limit?: string } }>('/scheduled-pipeline-runs', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const showId = request.query.showId || request.query.showSlug
        ? await resolveShowId(store, request.query.showId, request.query.showSlug)
        : undefined;
      const jobs = await store.listScheduledRuns({
        showId,
        status: parseJobStatus(request.query.status),
        limit: parseLimit(request.query.limit),
      });

      return { ok: true, jobs };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { jobId: string } }>('/scheduled-pipeline-runs/:jobId/retry', async (request, reply) => {
    try {
      const store = requireSchedulerStore(options.getStore());
      const body = runNowBodySchema.parse(request.body ?? {});
      const failedJob = await store.getJob(request.params.jobId);

      if (!failedJob || failedJob.type !== 'pipeline.scheduled') {
        throw new ApiError(404, 'SCHEDULED_RUN_NOT_FOUND', `Scheduled run not found: ${request.params.jobId}`);
      }

      if (failedJob.status !== 'failed') {
        throw new ApiError(409, 'SCHEDULED_RUN_NOT_FAILED', 'Only failed scheduled runs can be retried.');
      }

      const scheduledPipelineId = typeof failedJob.input.scheduledPipelineId === 'string'
        ? failedJob.input.scheduledPipelineId
        : undefined;

      if (!scheduledPipelineId) {
        throw new ApiError(409, 'SCHEDULED_RUN_MISSING_PIPELINE', 'Failed run does not reference a scheduled pipeline.');
      }

      const pipeline = await store.getScheduledPipeline(scheduledPipelineId);

      if (!pipeline) {
        throw new ApiError(404, 'SCHEDULED_PIPELINE_NOT_FOUND', `Scheduled pipeline not found: ${scheduledPipelineId}`);
      }

      const result = await runScheduledPipeline({
        pipeline,
        store,
        reason: 'retry',
        retryOfJobId: failedJob.id,
        triggeredBy: body.actor,
        braveApiKey: options.braveApiKey,
        fetchImpl: options.fetchImpl,
        rssFetchImpl: options.rssFetchImpl,
        sleep: options.sleep,
      });

      return reply.code(201).send({ ok: true, job: result.job, stageJobs: result.stageJobs });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
