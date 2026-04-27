import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import type { LlmRuntime } from '../llm/types.js';
import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import { createPromptRegistry } from '../prompts/registry.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type { CreateJobInput, JobRecord, SearchJobStore, StoryCandidateRecord, UpdateJobInput } from '../search/store.js';
import type { ShowRecord, SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { buildEpisodePlan, EpisodePlanError } from './episode-plan.js';

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

export interface EpisodePlanningRoutesOptions {
  getStore(): Partial<EpisodePlanningStore> & Partial<SearchJobStore> & Partial<ModelProfileStore> & Partial<PromptTemplateStore>;
  llmRuntime?: LlmRuntime;
}

interface EpisodePlanningStore {
  listShows(): Promise<ShowRecord[]>;
  getStoryCandidate(id: string): Promise<StoryCandidateRecord | undefined>;
  getSourceProfile(id: string): Promise<SourceProfileRecord | undefined>;
  getSourceQuery(id: string): Promise<SourceQueryRecord | undefined>;
}

const createEpisodePlanSchema = z.object({
  candidateIds: z.array(z.string().trim().min(1)).min(1).max(20),
  notes: z.string().trim().min(1).max(2_000).nullable().optional(),
  targetFormat: z.string().trim().min(1).max(120).nullable().optional(),
  targetRuntime: z.string().trim().min(1).max(120).nullable().optional(),
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

  if (error instanceof ApiError || error instanceof EpisodePlanError) {
    return reply.code(error.statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
    });
  }

  throw error;
}

function requirePlanningStore(store: Partial<EpisodePlanningStore>): Pick<EpisodePlanningStore, 'listShows' | 'getStoryCandidate'> {
  for (const method of ['listShows', 'getStoryCandidate'] as const) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'EPISODE_PLANNING_STORE_UNAVAILABLE', `Planning store method is unavailable: ${method}`);
    }
  }

  return store as Pick<EpisodePlanningStore, 'listShows' | 'getStoryCandidate'>;
}

function hasJobStore(store: object): store is Pick<SearchJobStore, 'createJob' | 'updateJob'> {
  return (
    'createJob' in store
    && typeof store.createJob === 'function'
    && 'updateJob' in store
    && typeof store.updateJob === 'function'
  );
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

async function selectedCandidates(store: Pick<EpisodePlanningStore, 'getStoryCandidate'>, candidateIds: string[]) {
  const duplicateIds = duplicatedValues(candidateIds);
  const uniqueIds = [...new Set(candidateIds)];
  const candidates = await Promise.all(uniqueIds.map(async (id) => {
    const candidate = await store.getStoryCandidate(id);

    if (!candidate) {
      throw new ApiError(404, 'STORY_CANDIDATE_NOT_FOUND', `Story candidate not found: ${id}`);
    }

    if (candidate.status === 'ignored') {
      throw new ApiError(400, 'STORY_CANDIDATE_IGNORED', `Ignored story candidate cannot be used for episode planning: ${id}`);
    }

    return candidate;
  }));
  const showIds = new Set(candidates.map((candidate) => candidate.showId));

  if (showIds.size > 1) {
    throw new ApiError(400, 'CANDIDATE_SHOW_MISMATCH', 'All story candidates in an episode plan must belong to the same show.');
  }

  return { candidates, duplicateIds };
}

async function showForCandidates(store: Pick<EpisodePlanningStore, 'listShows'>, candidates: StoryCandidateRecord[]) {
  const showId = candidates[0]?.showId;
  const show = (await store.listShows()).find((candidate) => candidate.id === showId);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found for selected candidates: ${showId}`);
  }

  return show;
}

async function sourceProfilesFor(
  store: Partial<EpisodePlanningStore>,
  candidates: StoryCandidateRecord[],
): Promise<Map<string, SourceProfileRecord>> {
  const profiles = new Map<string, SourceProfileRecord>();

  if (typeof store.getSourceProfile !== 'function') {
    return profiles;
  }

  for (const id of new Set(candidates.map((candidate) => candidate.sourceProfileId).filter((id): id is string => Boolean(id)))) {
    const profile = await store.getSourceProfile(id);
    if (profile) {
      profiles.set(id, profile);
    }
  }

  return profiles;
}

async function sourceQueriesFor(
  store: Partial<EpisodePlanningStore>,
  candidates: StoryCandidateRecord[],
): Promise<Map<string, SourceQueryRecord>> {
  const queries = new Map<string, SourceQueryRecord>();

  if (typeof store.getSourceQuery !== 'function') {
    return queries;
  }

  for (const id of new Set(candidates.map((candidate) => candidate.sourceQueryId).filter((id): id is string => Boolean(id)))) {
    const query = await store.getSourceQuery(id);
    if (query) {
      queries.set(id, query);
    }
  }

  return queries;
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

async function createPlanningJob(
  store: Pick<SearchJobStore, 'createJob'>,
  input: CreateJobInput,
): Promise<JobRecord> {
  return store.createJob(input);
}

async function updatePlanningJob(
  store: Pick<SearchJobStore, 'updateJob'>,
  id: string,
  input: UpdateJobInput,
): Promise<JobRecord | undefined> {
  return store.updateJob(id, input);
}

function failurePayload(error: unknown): Record<string, unknown> {
  const code = error instanceof ApiError || error instanceof EpisodePlanError ? error.code : 'EPISODE_PLAN_FAILED';

  return {
    failure: {
      code,
      message: error instanceof Error ? error.message : 'Episode planning failed.',
      retryable: code !== 'STORY_CANDIDATE_NOT_FOUND' && code !== 'CANDIDATE_SHOW_MISMATCH',
    },
  };
}

export function registerEpisodePlanningRoutes(app: FastifyInstance, options: EpisodePlanningRoutesOptions) {
  app.post('/story-candidates/episode-plan', async (request, reply) => {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const body = createEpisodePlanSchema.parse(request.body ?? {});
      const rawStore = options.getStore();
      const store = requirePlanningStore(rawStore);
      const selection = await selectedCandidates(store, body.candidateIds);
      const candidates = selection.candidates;
      const show = await showForCandidates(store, candidates);

      if (!options.llmRuntime) {
        throw new ApiError(409, 'EPISODE_PLANNER_RUNTIME_REQUIRED', 'Episode planning requires an LLM runtime.');
      }

      if (!hasModelProfileStore(rawStore)) {
        throw new ApiError(409, 'EPISODE_PLANNER_MODEL_PROFILE_REQUIRED', 'No episode_planner model profile store is configured.');
      }

      const modelProfile = await resolveModelProfile(rawStore, { showId: show.id, role: 'episode_planner' });

      if (!modelProfile) {
        throw new ApiError(409, 'EPISODE_PLANNER_MODEL_PROFILE_REQUIRED', 'No episode_planner model profile is configured for this show.');
      }

      logs.push(log('info', 'Starting episode.plan job.', {
        candidateIds: candidates.map((candidate) => candidate.id),
        duplicateCandidateIds: selection.duplicateIds,
        modelRole: modelProfile.role,
      }));

      if (hasJobStore(rawStore)) {
        jobStore = rawStore;
        job = await createPlanningJob(rawStore, {
          showId: show.id,
          type: 'episode.plan',
          status: 'running',
          progress: 0,
          attempts: 1,
          input: {
            candidateIds: body.candidateIds,
            selectedCandidateIds: candidates.map((candidate) => candidate.id),
            duplicateCandidateIds: selection.duplicateIds,
            notes: body.notes ?? null,
            targetFormat: body.targetFormat ?? null,
            targetRuntime: body.targetRuntime ?? null,
            modelProfiles: { episode_planner: modelProfile },
            advisoryOnly: true,
          },
          logs,
          startedAt: new Date(),
        });
      }

      const episodePlan = await buildEpisodePlan({
        show,
        candidates,
        duplicateCandidateIds: selection.duplicateIds,
        sourceProfiles: await sourceProfilesFor(rawStore as unknown as Partial<EpisodePlanningStore>, candidates),
        sourceQueries: await sourceQueriesFor(rawStore as unknown as Partial<EpisodePlanningStore>, candidates),
        modelProfile,
        runtime: options.llmRuntime,
        promptRegistry: createPromptRegistry({ store: rawStore as unknown as Partial<PromptTemplateStore> }),
        notes: body.notes,
        targetFormat: body.targetFormat,
        targetRuntime: body.targetRuntime,
      });

      logs.push(log('info', 'Completed episode.plan job.', {
        candidateIds: episodePlan.candidateIds,
        warningCount: episodePlan.warnings.length,
        advisoryOnly: true,
      }));

      if (jobStore && job) {
        job = await updatePlanningJob(jobStore, job.id, {
          status: 'succeeded',
          progress: 100,
          logs,
          output: {
            episodePlanId: episodePlan.id,
            candidateIds: episodePlan.candidateIds,
            duplicateCandidateIds: episodePlan.duplicateCandidateIds,
            episodePlan,
            warnings: episodePlan.warnings,
            modelProfiles: { episode_planner: modelProfile },
            advisoryOnly: true,
          },
          finishedAt: new Date(),
        }) ?? job;
      }

      return reply.code(201).send({ ok: true, episodePlan, job });
    } catch (error) {
      if (jobStore && job) {
        logs.push(log('error', error instanceof Error ? error.message : 'Episode planning failed.'));
        job = await updatePlanningJob(jobStore, job.id, {
          status: 'failed',
          progress: job.progress,
          logs,
          error: error instanceof Error ? error.message : 'Episode planning failed.',
          output: failurePayload(error),
          finishedAt: new Date(),
        }) ?? job;
      }

      return sendError(reply, error);
    }
  });
}
