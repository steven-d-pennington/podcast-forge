import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { buildApp } from '../app.js';
import type { CreateJobInput, CreateStoryCandidateInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import type { RssFetch } from '../search/rss.js';
import type {
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  ShowRecord,
  SourceProfileRecord,
  SourceQueryRecord,
  SourceStore,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
} from '../sources/store.js';
import type {
  CreateScheduledPipelineInput,
  ScheduledPipelineRecord,
  ScheduledRunListFilter,
  SchedulerStore,
  UpdateScheduledPipelineInput,
} from './store.js';

class FakeSchedulerStore implements SourceStore, SearchJobStore, SchedulerStore {
  shows: ShowRecord[] = [{
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'the-synthetic-lens',
    title: 'The Synthetic Lens',
    description: 'AI news',
    setupStatus: 'active',
    format: 'feature-analysis',
    defaultRuntimeMinutes: 8,
    cast: [],
    defaultModelProfile: {},
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  profiles: SourceProfileRecord[] = [{
    id: '22222222-2222-4222-8222-222222222222',
    showId: '11111111-1111-4111-8111-111111111111',
    slug: 'ai-rss',
    name: 'AI RSS',
    type: 'rss',
    enabled: true,
    weight: 1,
    freshness: null,
    includeDomains: [],
    excludeDomains: [],
    rateLimit: {},
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  queries: SourceQueryRecord[] = [{
    id: '33333333-3333-4333-8333-333333333333',
    sourceProfileId: '22222222-2222-4222-8222-222222222222',
    query: 'https://example.com/feed.xml',
    enabled: true,
    weight: 1,
    region: null,
    language: null,
    freshness: null,
    includeDomains: [],
    excludeDomains: [],
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  scheduledPipelines: ScheduledPipelineRecord[] = [];
  jobs: JobRecord[] = [];
  candidates: Array<{
    id: string;
    showId: string;
    sourceProfileId: string | null;
    sourceQueryId: string | null;
    title: string;
    url: string | null;
    canonicalUrl: string | null;
    sourceName: string | null;
    author: string | null;
    summary: string | null;
    publishedAt: Date | null;
    discoveredAt: Date;
    score: number | null;
    scoreBreakdown: Record<string, unknown>;
    status: 'new' | 'shortlisted' | 'ignored' | 'merged';
    rawPayload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  async listShows() {
    return this.shows;
  }

  async listSourceProfiles(filter: { showSlug?: string; showId?: string } = {}) {
    const show = filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug) : undefined;
    const showId = filter.showId ?? show?.id;
    return showId ? this.profiles.filter((profile) => profile.showId === showId) : this.profiles;
  }

  async getSourceProfile(id: string) {
    return this.profiles.find((profile) => profile.id === id);
  }

  async createSourceProfile(input: CreateSourceProfileInput) {
    const profile = { ...input, id: `profile-${this.profiles.length + 1}`, createdAt: new Date(), updatedAt: new Date() };
    this.profiles.push(profile);
    return profile;
  }

  async updateSourceProfile(id: string, input: UpdateSourceProfileInput) {
    const profile = await this.getSourceProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date() });
    return profile;
  }

  async listSourceQueries(profileId: string, options: { enabledOnly?: boolean } = {}) {
    return this.queries.filter((query) => query.sourceProfileId === profileId && (!options.enabledOnly || query.enabled));
  }

  async getSourceQuery(id: string) {
    return this.queries.find((query) => query.id === id);
  }

  async createSourceQuery(profileId: string, input: CreateSourceQueryInput) {
    const query = {
      ...input,
      id: `query-${this.queries.length + 1}`,
      sourceProfileId: profileId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.queries.push(query);
    return query;
  }

  async updateSourceQuery(id: string, input: UpdateSourceQueryInput) {
    const query = this.queries.find((candidate) => candidate.id === id);

    if (!query) {
      return undefined;
    }

    Object.assign(query, input, { updatedAt: new Date() });
    return query;
  }

  async deleteSourceQuery(id: string) {
    const before = this.queries.length;
    this.queries = this.queries.filter((query) => query.id !== id);
    return this.queries.length !== before;
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
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.jobs.push(job);
    return job;
  }

  async updateJob(id: string, input: UpdateJobInput) {
    const job = this.jobs.find((candidate) => candidate.id === id);

    if (!job) {
      return undefined;
    }

    Object.assign(job, input, { updatedAt: new Date() });
    return job;
  }

  async getJob(id: string) {
    return this.jobs.find((job) => job.id === id);
  }

  async listJobs() {
    return this.jobs;
  }

  async listStoryCandidateDedupeKeys() {
    return this.candidates.map((candidate) => ({ title: candidate.title, canonicalUrl: candidate.canonicalUrl }));
  }

  async insertStoryCandidate(input: CreateStoryCandidateInput) {
    if (this.candidates.some((candidate) => candidate.canonicalUrl === input.canonicalUrl)) {
      return undefined;
    }

    const candidate = {
      ...input,
      id: `candidate-${this.candidates.length + 1}`,
      author: null,
      discoveredAt: new Date('2026-01-01T00:00:00Z'),
      score: null,
      scoreBreakdown: {},
      status: 'new' as const,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.candidates.push(candidate);
    return candidate;
  }

  async updateStoryCandidateScoring(id: string, input: { score: number | null; scoreBreakdown: Record<string, unknown>; metadata: Record<string, unknown> }) {
    const candidate = this.candidates.find((item) => item.id === id);

    if (!candidate) {
      return undefined;
    }

    candidate.score = input.score;
    candidate.scoreBreakdown = input.scoreBreakdown;
    candidate.metadata = input.metadata;
    candidate.updatedAt = new Date();
    return candidate;
  }

  async updateStoryCandidateStatus(id: string, input: { status: 'new' | 'shortlisted' | 'ignored' | 'merged'; metadata?: Record<string, unknown> }) {
    const candidate = this.candidates.find((item) => item.id === id);
    if (!candidate) {
      return undefined;
    }
    candidate.status = input.status;
    candidate.metadata = { ...candidate.metadata, ...(input.metadata ?? {}) };
    return candidate;
  }

  async clearStoryCandidates(input: { showId: string; sourceProfileId?: string; status?: 'ignored'; metadata?: Record<string, unknown> }) {
    let updated = 0;
    for (const candidate of this.candidates) {
      if (candidate.showId !== input.showId || candidate.status === 'ignored') {
        continue;
      }
      if (input.sourceProfileId && candidate.sourceProfileId !== input.sourceProfileId) {
        continue;
      }
      candidate.status = input.status ?? 'ignored';
      candidate.metadata = { ...candidate.metadata, ...(input.metadata ?? {}) };
      updated += 1;
    }
    return { updated };
  }

  async listStoryCandidates() {
    return this.candidates;
  }

  async createScheduledPipeline(input: CreateScheduledPipelineInput) {
    const scheduledPipeline: ScheduledPipelineRecord = {
      ...input,
      id: `schedule-${this.scheduledPipelines.length + 1}`,
      feedId: input.feedId ?? null,
      sourceProfileId: input.sourceProfileId ?? null,
      lastRunJobId: null,
      lastRunAt: null,
      nextRunAt: input.nextRunAt ?? null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.scheduledPipelines.push(scheduledPipeline);
    return scheduledPipeline;
  }

  async updateScheduledPipeline(id: string, input: UpdateScheduledPipelineInput) {
    const scheduledPipeline = await this.getScheduledPipeline(id);

    if (!scheduledPipeline) {
      return undefined;
    }

    Object.assign(scheduledPipeline, input, { updatedAt: new Date() });
    return scheduledPipeline;
  }

  async getScheduledPipeline(id: string) {
    return this.scheduledPipelines.find((pipeline) => pipeline.id === id);
  }

  async listScheduledPipelines(filter: { showId?: string; enabledOnly?: boolean; dueAt?: Date; limit?: number } = {}) {
    return this.scheduledPipelines
      .filter((pipeline) => (!filter.showId || pipeline.showId === filter.showId)
        && (!filter.enabledOnly || pipeline.enabled)
        && (!filter.dueAt || (pipeline.nextRunAt && pipeline.nextRunAt <= filter.dueAt)))
      .slice(0, filter.limit ?? 50);
  }

  async markScheduledPipelineRun(input: { id: string; jobId: string; lastRunAt: Date; nextRunAt: Date | null }) {
    const scheduledPipeline = await this.getScheduledPipeline(input.id);

    if (!scheduledPipeline) {
      return undefined;
    }

    scheduledPipeline.lastRunJobId = input.jobId;
    scheduledPipeline.lastRunAt = input.lastRunAt;
    scheduledPipeline.nextRunAt = input.nextRunAt;
    scheduledPipeline.updatedAt = new Date();
    return scheduledPipeline;
  }

  async listScheduledRuns(filter: ScheduledRunListFilter = {}) {
    return this.jobs
      .filter((job) => job.type === 'pipeline.scheduled'
        && (!filter.showId || job.showId === filter.showId)
        && (!filter.status || job.status === filter.status)
        && (!filter.scheduledPipelineId || job.input.scheduledPipelineId === filter.scheduledPipelineId))
      .slice(0, filter.limit ?? 50);
  }
}

const feedXml = `<?xml version="1.0"?>
<rss><channel><title>Example Feed</title>
<item><title>Scheduled AI Story</title><link>https://example.com/story</link><description>Story summary</description><pubDate>Sat, 25 Apr 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('scheduler routes', () => {
  let store: FakeSchedulerStore;
  let rssFetch: RssFetch;

  beforeEach(() => {
    store = new FakeSchedulerStore();
    rssFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => feedXml,
    });
  });

  it('persists cron-style scheduled pipeline definitions per show and source profile', async () => {
    const app = buildApp({ sourceStore: store, rssFetchImpl: rssFetch });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-pipelines',
      payload: {
        showSlug: 'the-synthetic-lens',
        sourceProfileId: store.profiles[0].id,
        slug: 'weekday-ai-brief',
        name: 'Weekday AI Brief',
        cron: '*/15 * * * *',
        timezone: 'UTC',
        workflow: ['ingest', 'research', 'script', 'audio', 'publish'],
        autopublish: false,
        legacyAdapter: { command: '/opt/openclaw/run-tsl.sh' },
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.scheduledPipeline.slug, 'weekday-ai-brief');
    assert.equal(body.scheduledPipeline.sourceProfileId, store.profiles[0].id);
    assert.deepEqual(body.scheduledPipeline.workflow, ['ingest', 'research', 'script', 'audio', 'publish']);
    assert.equal(body.scheduledPipeline.autopublish, false);
    assert.ok(body.scheduledPipeline.nextRunAt);

    const listResponse = await app.inject({ method: 'GET', url: '/scheduled-pipelines?showSlug=the-synthetic-lens' });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().scheduledPipelines.length, 1);
  });

  it('supports dashboard run-now triggers and records scheduled stage jobs', async () => {
    const app = buildApp({ sourceStore: store, rssFetchImpl: rssFetch });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/scheduled-pipelines',
      payload: {
        showSlug: 'the-synthetic-lens',
        sourceProfileId: store.profiles[0].id,
        slug: 'full-pipeline',
        name: 'Full Pipeline',
        cron: '0 * * * *',
        workflow: ['ingest', 'research', 'script', 'audio', 'publish'],
      },
    });
    const pipelineId = createResponse.json().scheduledPipeline.id;

    const runResponse = await app.inject({
      method: 'POST',
      url: `/scheduled-pipelines/${pipelineId}/run`,
      payload: { actor: 'dashboard-user' },
    });

    assert.equal(runResponse.statusCode, 201);
    const body = runResponse.json();
    assert.equal(body.job.type, 'pipeline.scheduled');
    assert.equal(body.job.status, 'running');
    assert.equal(body.job.output.semanticStatus, 'blocked');
    assert.equal(body.job.input.triggeredBy, 'dashboard-user');
    assert.deepEqual(
      body.stageJobs.map((job: JobRecord) => job.type),
      ['source.ingest', 'research.packet', 'script.generate', 'audio.preview', 'publish.rss'],
    );
    assert.equal(body.stageJobs[0].status, 'succeeded');
    assert.equal(body.job.output.stageStatuses[0].stage, null);
    assert.equal(body.stageJobs[4].status, 'queued');
    assert.equal(body.stageJobs[4].input.waitCategory, 'blocked');
    assert.match(body.stageJobs[4].logs[0].message, /approval/i);
  });

  it('exposes failed scheduled runs and retries them as new scheduled jobs', async () => {
    let shouldFail = true;
    rssFetch = async () => {
      if (shouldFail) {
        throw new Error('temporary rss outage');
      }

      return {
        ok: true,
        status: 200,
        text: async () => feedXml,
      };
    };
    const app = buildApp({ sourceStore: store, rssFetchImpl: rssFetch });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/scheduled-pipelines',
      payload: {
        showSlug: 'the-synthetic-lens',
        sourceProfileId: store.profiles[0].id,
        slug: 'retryable-pipeline',
        name: 'Retryable Pipeline',
        cron: '0 * * * *',
        workflow: ['ingest'],
      },
    });
    const pipelineId = createResponse.json().scheduledPipeline.id;
    const failedResponse = await app.inject({ method: 'POST', url: `/scheduled-pipelines/${pipelineId}/run`, payload: {} });
    const failedJob = failedResponse.json().job as JobRecord;

    assert.equal(failedJob.status, 'failed');
    assert.match(failedJob.error ?? '', /temporary rss outage/);

    const failedListResponse = await app.inject({ method: 'GET', url: `/scheduled-pipelines/${pipelineId}/runs?status=failed` });
    assert.equal(failedListResponse.statusCode, 200);
    assert.equal(failedListResponse.json().jobs.length, 1);

    shouldFail = false;
    const retryResponse = await app.inject({
      method: 'POST',
      url: `/scheduled-pipeline-runs/${failedJob.id}/retry`,
      payload: { actor: 'dashboard-user' },
    });

    assert.equal(retryResponse.statusCode, 201);
    assert.equal(retryResponse.json().job.status, 'succeeded');
    assert.equal(retryResponse.json().job.output.semanticStatus, 'succeeded');
    assert.equal(retryResponse.json().job.input.retryOfJobId, failedJob.id);
  });
});
