import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';

import { createFakeLlmProvider } from '../llm/providers.js';
import { createLlmRuntime } from '../llm/runtime.js';
import type { LlmProviderRequest, LlmProviderResult } from '../llm/types.js';
import type { ModelRole } from '../models/roles.js';
import type { CreateModelProfileInput, ModelProfileListFilter, ModelProfileRecord, UpdateModelProfileInput } from '../models/store.js';
import type { CreateJobInput, JobRecord, StoryCandidateRecord, UpdateJobInput } from '../search/store.js';
import type { ShowRecord, SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { registerEpisodePlanningRoutes } from './routes.js';

type PlannerMode = 'valid' | 'malformed';

class FakePlanningStore {
  shows: ShowRecord[] = [{
    id: 'show-1',
    slug: 'example-show',
    title: 'Example Show',
    description: 'Evidence-first technology news.',
    setupStatus: 'active',
    format: 'feature-analysis',
    defaultRuntimeMinutes: 8,
    cast: [{ name: 'HOST', role: 'host', voice: 'Nova' }],
    defaultModelProfile: {},
    settings: { editorial: { avoidSensationalism: true } },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }, {
    id: 'show-2',
    slug: 'other-show',
    title: 'Other Show',
    description: null,
    setupStatus: 'active',
    format: null,
    defaultRuntimeMinutes: null,
    cast: [],
    defaultModelProfile: {},
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  sourceProfiles: SourceProfileRecord[] = [{
    id: 'profile-1',
    showId: 'show-1',
    slug: 'ai-news',
    name: 'AI News',
    type: 'brave',
    enabled: true,
    weight: 1,
    freshness: 'pd',
    includeDomains: ['example.com'],
    excludeDomains: [],
    rateLimit: {},
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  sourceQueries: SourceQueryRecord[] = [{
    id: 'query-1',
    sourceProfileId: 'profile-1',
    query: 'AI policy product news',
    enabled: true,
    weight: 1,
    region: null,
    language: null,
    freshness: 'pd',
    includeDomains: ['example.com'],
    excludeDomains: [],
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  candidates: StoryCandidateRecord[] = [
    this.candidate('candidate-1', 'show-1', 'New AI policy changes model release planning'),
    this.candidate('candidate-2', 'show-1', 'Developers respond to model release policy'),
    this.candidate('candidate-other-show', 'show-2', 'Unrelated show candidate'),
  ];
  modelProfiles: ModelProfileRecord[] = [this.modelProfile('episode_planner')];
  jobs: JobRecord[] = [];
  researchPacketsCreated = 0;
  approvalsCreated = 0;

  candidate(id: string, showId: string, title: string): StoryCandidateRecord {
    return {
      id,
      showId,
      sourceProfileId: showId === 'show-1' ? 'profile-1' : null,
      sourceQueryId: showId === 'show-1' ? 'query-1' : null,
      title,
      url: `https://example.com/${id}`,
      canonicalUrl: `https://example.com/${id}`,
      sourceName: 'Example News',
      author: null,
      summary: `${title} with enough candidate context for planning.`,
      publishedAt: new Date('2026-01-02T12:00:00Z'),
      discoveredAt: new Date('2026-01-02T13:00:00Z'),
      score: 82,
      scoreBreakdown: {
        rationale: 'High relevance and good source quality.',
        sourceQuality: 78,
      },
      status: 'new',
      rawPayload: { provider: 'test' },
      metadata: { query: { text: 'AI policy product news' } },
      createdAt: new Date('2026-01-02T13:00:00Z'),
      updatedAt: new Date('2026-01-02T13:00:00Z'),
    };
  }

  modelProfile(role: ModelRole): ModelProfileRecord {
    return {
      id: `model-${role}`,
      showId: 'show-1',
      role,
      provider: 'openai',
      model: 'planner-model',
      temperature: 0.2,
      maxTokens: 1200,
      budgetUsd: null,
      fallbacks: [],
      promptTemplateKey: null,
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  async listShows() {
    return this.shows;
  }

  async getStoryCandidate(id: string) {
    return this.candidates.find((candidate) => candidate.id === id);
  }

  async getSourceProfile(id: string) {
    return this.sourceProfiles.find((profile) => profile.id === id);
  }

  async getSourceQuery(id: string) {
    return this.sourceQueries.find((query) => query.id === id);
  }

  async listModelProfiles(filter: ModelProfileListFilter = {}) {
    return this.modelProfiles.filter((profile) => {
      const showMatches = !filter.showId || profile.showId === filter.showId || (filter.includeGlobal && profile.showId === null);
      const roleMatches = !filter.role || profile.role === filter.role;
      return showMatches && roleMatches;
    });
  }

  async getModelProfile(id: string) {
    return this.modelProfiles.find((profile) => profile.id === id);
  }

  async createModelProfile(input: CreateModelProfileInput) {
    const profile = {
      ...input,
      id: `model-${this.modelProfiles.length + 1}`,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.modelProfiles.push(profile);
    return profile;
  }

  async updateModelProfile(id: string, input: UpdateModelProfileInput) {
    const profile = await this.getModelProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return profile;
  }

  async createJob(input: CreateJobInput) {
    const job: JobRecord = {
      id: `job-${this.jobs.length + 1}`,
      showId: input.showId,
      episodeId: input.episodeId ?? null,
      type: input.type,
      status: input.status,
      progress: input.progress,
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 1,
      input: input.input,
      output: {},
      logs: input.logs ?? [],
      error: null,
      lockedBy: null,
      lockedAt: null,
      startedAt: input.startedAt ?? null,
      finishedAt: null,
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    };
    this.jobs.push(job);
    return job;
  }

  async updateJob(id: string, input: UpdateJobInput) {
    const job = this.jobs.find((candidate) => candidate.id === id);

    if (!job) {
      return undefined;
    }

    Object.assign(job, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return job;
  }
}

function plannerResult(request: LlmProviderRequest, mode: PlannerMode): LlmProviderResult {
  if (request.attempt.role !== 'episode_planner') {
    const text = JSON.stringify({ ok: true });
    return { text, rawOutput: text };
  }

  if (mode === 'malformed') {
    return { text: '{"proposedAngle":"Incomplete"}', rawOutput: '{"proposedAngle":"Incomplete"}' };
  }

  const text = JSON.stringify({
    proposedAngle: 'The product story behind new AI policy pressure',
    whyNow: 'The selected candidate records point to fresh policy and developer reaction this week.',
    audienceRelevance: 'Listeners need to know what is verified before relying on the story.',
    knownFacts: ['Two candidate stories were selected from Example News records.'],
    unknownsSourceGaps: ['No primary company post or filing has been fetched yet.'],
    questionsToAnswer: ['What did the primary source actually announce?'],
    recommendedSources: [{
      sourceType: 'primary company post',
      rationale: 'Start with the origin of the claim before summarizing reaction.',
      suggestedQuery: 'AI policy announcement primary source',
      priority: 'high',
    }],
    warnings: [{
      code: 'ADVISORY_ONLY',
      severity: 'info',
      message: 'Use this as planning guidance, not evidence.',
    }],
  });

  return {
    text,
    rawOutput: text,
    metadata: { adapter: 'test-planner' },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: { usd: 0, currency: 'USD' },
  };
}

function buildPlanningApp(store: FakePlanningStore, mode: PlannerMode = 'valid') {
  const app = Fastify();
  const llmRuntime = createLlmRuntime({
    adapters: [
      createFakeLlmProvider({
        provider: 'openai',
        handler: (request) => plannerResult(request, mode),
      }),
    ],
  });

  registerEpisodePlanningRoutes(app, {
    getStore() {
      return store;
    },
    llmRuntime,
  });

  return app;
}

describe('episode planning routes', () => {
  let store: FakePlanningStore;

  beforeEach(() => {
    store = new FakePlanningStore();
  });

  it('generates an advisory episode plan from selected candidates', async () => {
    const app = buildPlanningApp(store);
    const response = await app.inject({
      method: 'POST',
      url: '/story-candidates/episode-plan',
      payload: {
        candidateIds: ['candidate-1', 'candidate-2', 'candidate-1'],
        notes: 'Plan this before building research.',
        targetFormat: 'feature-analysis',
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 201);
    assert.equal(body.ok, true);
    assert.equal(body.episodePlan.aiGenerated, true);
    assert.equal(body.episodePlan.advisoryOnly, true);
    assert.equal(body.episodePlan.evidenceStatus, 'not_verified_evidence');
    assert.deepEqual(body.episodePlan.candidateIds, ['candidate-1', 'candidate-2']);
    assert.deepEqual(body.episodePlan.duplicateCandidateIds, ['candidate-1']);
    assert.equal(body.episodePlan.proposedAngle, 'The product story behind new AI policy pressure');
    assert.equal(body.episodePlan.unknownsSourceGaps.length, 1);
    assert.equal(body.job.type, 'episode.plan');
    assert.equal(body.job.status, 'succeeded');
    assert.equal(store.jobs[0].output.advisoryOnly, true);
    await app.close();
  });

  it('fails clearly and records a failed job for malformed model output', async () => {
    const app = buildPlanningApp(store, 'malformed');
    const response = await app.inject({
      method: 'POST',
      url: '/story-candidates/episode-plan',
      payload: { candidateIds: ['candidate-1'] },
    });
    const body = response.json();

    assert.equal(response.statusCode, 502);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'EPISODE_PLAN_MODEL_OUTPUT_INVALID');
    assert.equal(store.jobs.length, 1);
    assert.equal(store.jobs[0].type, 'episode.plan');
    assert.equal(store.jobs[0].status, 'failed');
    assert.equal((store.jobs[0].output.failure as { code: string }).code, 'EPISODE_PLAN_MODEL_OUTPUT_INVALID');
    assert.equal((store.jobs[0].output.failure as { retryable: boolean }).retryable, false);
    await app.close();
  });

  it('rejects missing candidate IDs', async () => {
    const app = buildPlanningApp(store);
    const response = await app.inject({
      method: 'POST',
      url: '/story-candidates/episode-plan',
      payload: { candidateIds: ['missing-candidate'] },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'STORY_CANDIDATE_NOT_FOUND');
    assert.equal(store.jobs.length, 0);
    await app.close();
  });

  it('rejects cross-show candidate selections', async () => {
    const app = buildPlanningApp(store);
    const response = await app.inject({
      method: 'POST',
      url: '/story-candidates/episode-plan',
      payload: { candidateIds: ['candidate-1', 'candidate-other-show'] },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'CANDIDATE_SHOW_MISMATCH');
    assert.equal(store.jobs.length, 0);
    await app.close();
  });

  it('does not create or approve research artifacts', async () => {
    const app = buildPlanningApp(store);
    await app.inject({
      method: 'POST',
      url: '/story-candidates/episode-plan',
      payload: { candidateIds: ['candidate-1'] },
    });

    assert.equal(store.researchPacketsCreated, 0);
    assert.equal(store.approvalsCreated, 0);
    assert.equal(store.candidates.find((candidate) => candidate.id === 'candidate-1')?.status, 'new');
    await app.close();
  });
});
