import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import type { BraveFetch } from '../search/brave.js';
import { runSourceIngest, runSourceSearch } from '../search/job.js';
import type { RssFetch } from '../search/rss.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import type { SourceProfileRecord, SourceStore } from '../sources/store.js';
import { nextCronRun } from './cron.js';
import type { ScheduledPipelineRecord, ScheduledPipelineStage, SchedulerStore } from './store.js';

type JsonObject = Record<string, unknown>;
type WaitingStageCategory = 'queued' | 'blocked';

export interface RunScheduledPipelineOptions {
  pipeline: ScheduledPipelineRecord;
  store: SourceStore & SearchJobStore & SchedulerStore & Partial<ModelProfileStore>;
  reason: 'manual' | 'heartbeat' | 'retry';
  retryOfJobId?: string;
  triggeredBy?: string;
  now?: Date;
  braveApiKey?: string;
  fetchImpl?: BraveFetch;
  rssFetchImpl?: RssFetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunScheduledPipelineResult {
  job: JobRecord;
  stageJobs: JobRecord[];
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: JsonObject = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function jobFromError(error: unknown): JobRecord | undefined {
  return error && typeof error === 'object' && 'job' in error
    ? error.job as JobRecord
    : undefined;
}

function stageJobType(stage: ScheduledPipelineStage, profile?: SourceProfileRecord) {
  if (stage === 'ingest') {
    return profile?.type === 'brave' ? 'source.search' : 'source.ingest';
  }

  if (stage === 'research') {
    return 'research.packet';
  }

  if (stage === 'script') {
    return 'script.generate';
  }

  if (stage === 'audio') {
    return 'audio.final';
  }

  return 'publish.rss';
}

async function createStageJob(
  store: Pick<SearchJobStore, 'createJob'>,
  input: CreateJobInput,
) {
  return store.createJob(input);
}

async function updateJob(
  store: Pick<SearchJobStore, 'updateJob'>,
  id: string,
  input: UpdateJobInput,
) {
  return store.updateJob(id, input);
}

async function createWaitingStageJob(options: {
  store: Pick<SearchJobStore, 'createJob'>;
  pipeline: ScheduledPipelineRecord;
  parentJob: JobRecord;
  stage: ScheduledPipelineStage;
  type: string;
  reason: string;
  category?: WaitingStageCategory;
  status?: JobRecord['status'];
}) {
  const category = options.category ?? 'queued';
  const logs = [
    log(options.status === 'failed' ? 'error' : 'info', options.reason, {
      scheduledPipelineId: options.pipeline.id,
      parentJobId: options.parentJob.id,
      stage: options.stage,
      waitCategory: category,
    }),
  ];

  return createStageJob(options.store, {
    showId: options.pipeline.showId,
    type: options.type,
    status: options.status ?? 'queued',
    progress: options.status === 'failed' ? 0 : 5,
    attempts: 0,
    input: {
      scheduledPipelineId: options.pipeline.id,
      parentJobId: options.parentJob.id,
      stage: options.stage,
      feedId: options.pipeline.feedId,
      sourceProfileId: options.pipeline.sourceProfileId,
      autopublish: options.pipeline.autopublish,
      waitReason: options.reason,
      waitCategory: category,
    },
    logs,
  });
}

function stageOutput(stageJobs: JobRecord[]) {
  const failedStageJobs = stageJobs.filter((job) => job.status === 'failed');
  const waitingStageJobs = stageJobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const blockedStageJobs = waitingStageJobs.filter((job) => job.input.waitCategory === 'blocked');
  const completedStageJobs = stageJobs.filter((job) => job.status === 'succeeded');
  const semanticStatus = failedStageJobs.length > 0
    ? 'failed'
    : blockedStageJobs.length > 0
      ? 'blocked'
      : waitingStageJobs.length > 0
        ? completedStageJobs.length > 0
          ? 'partial'
          : 'queued'
        : 'succeeded';

  return {
    semanticStatus,
    stageJobIds: stageJobs.map((job) => job.id),
    failedStageJobIds: failedStageJobs.map((job) => job.id),
    waitingStageJobIds: waitingStageJobs.map((job) => job.id),
    blockedStageJobIds: blockedStageJobs.map((job) => job.id),
    stageStatuses: stageJobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      stage: job.input.stage ?? null,
      waitCategory: job.input.waitCategory ?? null,
      waitReason: job.input.waitReason ?? null,
      error: job.error,
    })),
  };
}

async function runIngestStage(options: RunScheduledPipelineOptions, parentJob: JobRecord) {
  const profile = options.pipeline.sourceProfileId
    ? await options.store.getSourceProfile(options.pipeline.sourceProfileId)
    : undefined;

  if (!profile) {
    return createWaitingStageJob({
      store: options.store,
      pipeline: options.pipeline,
      parentJob,
      stage: 'ingest',
      type: 'source.ingest',
      status: 'failed',
      reason: 'Scheduled ingest requires a source profile.',
    });
  }

  if (!profile.enabled) {
    return createWaitingStageJob({
      store: options.store,
      pipeline: options.pipeline,
      parentJob,
      stage: 'ingest',
      type: stageJobType('ingest', profile),
      status: 'failed',
      reason: `Source profile is disabled: ${profile.slug}`,
    });
  }

  const queries = await options.store.listSourceQueries(profile.id, { enabledOnly: true });

  if (profile.type === 'rss') {
    try {
      const result = await runSourceIngest({
        profile,
        queries,
        store: options.store,
        fetchImpl: options.rssFetchImpl,
      });

      return result.job;
    } catch (error) {
      const job = jobFromError(error);

      if (job) {
        return job;
      }

      throw error;
    }
  }

  if (profile.type === 'brave') {
    const apiKey = options.braveApiKey ?? process.env.BRAVE_API_KEY;

    if (!apiKey) {
      return createWaitingStageJob({
        store: options.store,
        pipeline: options.pipeline,
        parentJob,
        stage: 'ingest',
        type: 'source.search',
        status: 'failed',
        reason: 'Set BRAVE_API_KEY before running a scheduled Brave source search.',
      });
    }

    const modelProfile = hasModelProfileStore(options.store)
      ? await resolveModelProfile(options.store, { showId: profile.showId, role: 'candidate_scorer' })
      : undefined;
    try {
      const result = await runSourceSearch({
        apiKey,
        profile,
        queries,
        store: options.store,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        modelProfile,
      });

      return result.job;
    } catch (error) {
      const job = jobFromError(error);

      if (job) {
        return job;
      }

      throw error;
    }
  }

  return createWaitingStageJob({
    store: options.store,
    pipeline: options.pipeline,
    parentJob,
    stage: 'ingest',
    type: 'source.ingest',
    status: 'failed',
    reason: `Scheduled ingest does not support ${profile.type} source profiles yet.`,
  });
}

async function runStage(options: RunScheduledPipelineOptions, parentJob: JobRecord, stage: ScheduledPipelineStage) {
  if (stage === 'ingest') {
    return runIngestStage(options, parentJob);
  }

  const config = asObject(options.pipeline.config);
  const stageInputs = asObject(config.stageInputs);
  const input = asObject(stageInputs[stage]);
  const type = stageJobType(stage);

  if (stage === 'publish' && !options.pipeline.autopublish) {
    return createWaitingStageJob({
      store: options.store,
      pipeline: options.pipeline,
      parentJob,
      stage,
      type,
      category: 'blocked',
      reason: 'Publishing is waiting for explicit approval; autopublish is disabled for this scheduled pipeline.',
    });
  }

  const requiredId = stage === 'research'
    ? 'storyCandidateId'
    : stage === 'script'
      ? 'researchPacketId'
      : stage === 'audio'
        ? 'scriptId'
        : 'episodeId';

  if (typeof input[requiredId] !== 'string' || !input[requiredId]) {
    return createWaitingStageJob({
      store: options.store,
      pipeline: options.pipeline,
      parentJob,
      stage,
      type,
      category: 'blocked',
      reason: `Scheduled ${stage} stage is waiting for config.stageInputs.${stage}.${requiredId}.`,
    });
  }

  return createWaitingStageJob({
    store: options.store,
    pipeline: options.pipeline,
    parentJob,
    stage,
    type,
    reason: `Scheduled ${stage} stage is queued for a worker adapter.`,
  });
}

export async function runScheduledPipeline(options: RunScheduledPipelineOptions): Promise<RunScheduledPipelineResult> {
  const now = options.now ?? new Date();
  const logs: Array<Record<string, unknown>> = [
    log('info', 'Starting scheduled pipeline run.', {
      scheduledPipelineId: options.pipeline.id,
      scheduledPipelineSlug: options.pipeline.slug,
      reason: options.reason,
      retryOfJobId: options.retryOfJobId,
      triggeredBy: options.triggeredBy,
    }),
  ];

  let parentJob = await options.store.createJob({
    showId: options.pipeline.showId,
    type: 'pipeline.scheduled',
    status: 'running',
    progress: 0,
    attempts: 1,
    input: {
      scheduledPipelineId: options.pipeline.id,
      scheduledPipelineSlug: options.pipeline.slug,
      reason: options.reason,
      retryOfJobId: options.retryOfJobId,
      triggeredBy: options.triggeredBy,
      feedId: options.pipeline.feedId,
      sourceProfileId: options.pipeline.sourceProfileId,
      workflow: options.pipeline.workflow,
      autopublish: options.pipeline.autopublish,
      legacyAdapter: options.pipeline.legacyAdapter,
    },
    logs,
    startedAt: now,
  });
  const stageJobs: JobRecord[] = [];

  try {
    if (options.pipeline.workflow.length === 0) {
      throw new Error('Scheduled pipeline workflow must contain at least one stage.');
    }

    for (const [index, stage] of options.pipeline.workflow.entries()) {
      logs.push(log('info', 'Launching scheduled pipeline stage.', { stage }));
      const stageJob = await runStage(options, parentJob, stage);
      stageJobs.push(stageJob);

      const failed = stageJob.status === 'failed';
      logs.push(log(failed ? 'error' : 'info', 'Scheduled pipeline stage recorded.', {
        stage,
        jobId: stageJob.id,
        jobType: stageJob.type,
        status: stageJob.status,
        error: stageJob.error,
      }));
      parentJob = await updateJob(options.store, parentJob.id, {
        progress: Math.round(((index + 1) / options.pipeline.workflow.length) * 90),
        logs,
        output: stageOutput(stageJobs),
      }) ?? parentJob;

      if (failed) {
        throw new Error(stageJob.error || `${stageJob.type} failed.`);
      }
    }

    const legacyAdapter = asObject(options.pipeline.legacyAdapter);

    if (typeof legacyAdapter.command === 'string' && legacyAdapter.command.trim()) {
      const legacyJob = await createWaitingStageJob({
        store: options.store,
        pipeline: options.pipeline,
        parentJob,
        stage: 'ingest',
        type: 'legacy.shell',
        reason: 'Legacy shell pipeline adapter recorded for migration; external cron can execute this command while the workflow moves into Podcast Forge.',
      });
      stageJobs.push(legacyJob);
    }

    const output = stageOutput(stageJobs);
    const hasWaitingStages = output.waitingStageJobIds.length > 0;
    const status = hasWaitingStages ? 'running' : 'succeeded';
    const progress = hasWaitingStages ? 90 : 100;

    logs.push(log('info', hasWaitingStages ? 'Scheduled pipeline run recorded; downstream stages pending.' : 'Completed scheduled pipeline run.', {
      status,
      semanticStatus: output.semanticStatus,
      stageJobCount: stageJobs.length,
      waitingStageJobCount: output.waitingStageJobIds.length,
    }));

    if (hasWaitingStages) {
      logs.push(log(output.blockedStageJobIds.length > 0 ? 'warn' : 'info', 'Scheduled pipeline has downstream stages that are not complete.', {
        semanticStatus: output.semanticStatus,
        waitingStageJobIds: output.waitingStageJobIds,
        blockedStageJobIds: output.blockedStageJobIds,
      }));
    }

    parentJob = await updateJob(options.store, parentJob.id, {
      status,
      progress,
      logs,
      output,
      finishedAt: hasWaitingStages ? null : new Date(),
    }) ?? parentJob;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled pipeline run failed.';
    logs.push(log('error', message));
    const output = { ...stageOutput(stageJobs), semanticStatus: 'failed' };
    parentJob = await updateJob(options.store, parentJob.id, {
      status: 'failed',
      progress: parentJob.progress,
      logs,
      error: message,
      output,
      finishedAt: new Date(),
    }) ?? parentJob;
  }

  const nextRunAt = options.pipeline.enabled ? nextCronRun(options.pipeline.cron, now) : null;
  const updatedPipeline = await options.store.markScheduledPipelineRun({
    id: options.pipeline.id,
    jobId: parentJob.id,
    lastRunAt: now,
    nextRunAt,
  });

  if (updatedPipeline) {
    options.pipeline.lastRunJobId = updatedPipeline.lastRunJobId;
    options.pipeline.lastRunAt = updatedPipeline.lastRunAt;
    options.pipeline.nextRunAt = updatedPipeline.nextRunAt;
  }

  return { job: parentJob, stageJobs };
}
