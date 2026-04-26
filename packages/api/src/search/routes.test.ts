import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildApp } from '../app.js';
import type { BraveFetch } from './brave.js';
import type { CandidateScorer, CandidateScoringRequest } from './scoring.js';
import type {
  CreateJobInput,
  CreateStoryCandidateInput,
  JobRecord,
  SearchJobStore,
  StoryCandidateListFilter,
  StoryCandidateRecord,
  UpdateJobInput,
  UpdateStoryCandidateScoringInput,
} from './store.js';
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

const show: ShowRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'example-show',
  title: 'Example Show',
  description: 'Evidence-first news analysis.',
  setupStatus: 'active',
  format: 'briefing',
  defaultRuntimeMinutes: 8,
  cast: [],
  defaultModelProfile: {},
  settings: {},
  createdAt: new Date('2026-04-26T00:00:00Z'),
  updatedAt: new Date('2026-04-26T00:00:00Z'),
};

class FakeSearchStore implements SourceStore, SearchJobStore {
  shows = [show];
  profiles: SourceProfileRecord[] = [{
    id: '22222222-2222-4222-8222-222222222222',
    showId: show.id,
    slug: 'brave-news',
    name: 'Brave News',
    type: 'brave',
    enabled: true,
    weight: 1,
    freshness: 'pd',
    includeDomains: [],
    excludeDomains: [],
    rateLimit: {},
    config: { count: 5 },
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
  }];
  queries: SourceQueryRecord[] = [{
    id: '33333333-3333-4333-8333-333333333333',
    sourceProfileId: '22222222-2222-4222-8222-222222222222',
    query: 'ai news',
    enabled: true,
    weight: 1,
    region: 'US',
    language: 'en',
    freshness: 'pd',
    includeDomains: [],
    excludeDomains: [],
    config: {},
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
  }];
  jobs: JobRecord[] = [];
  candidates: StoryCandidateRecord[] = [];

  async listShows() {
    return this.shows;
  }

  async listSourceProfiles(filter: { showSlug?: string; showId?: string } = {}) {
    const showId = filter.showId ?? (filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug)?.id : undefined);
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

  async createSourceQuery(profileId: string, input: CreateSourceQueryInput) {
    const query = { ...input, id: `query-${this.queries.length + 1}`, sourceProfileId: profileId, createdAt: new Date(), updatedAt: new Date() };
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
      createdAt: new Date('2026-04-26T00:00:00Z'),
      updatedAt: new Date('2026-04-26T00:00:00Z'),
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

  async listStoryCandidateDedupeKeys(showId: string) {
    return this.candidates
      .filter((candidate) => candidate.showId === showId)
      .map((candidate) => ({ title: candidate.title, canonicalUrl: candidate.canonicalUrl }));
  }

  async insertStoryCandidate(input: CreateStoryCandidateInput) {
    if (this.candidates.some((candidate) => candidate.showId === input.showId && candidate.canonicalUrl === input.canonicalUrl)) {
      return undefined;
    }

    const candidate: StoryCandidateRecord = {
      ...input,
      id: `candidate-${this.candidates.length + 1}`,
      author: null,
      discoveredAt: new Date(`2026-04-26T00:0${this.candidates.length}:00Z`),
      score: null,
      scoreBreakdown: {},
      status: 'new',
      createdAt: new Date('2026-04-26T00:00:00Z'),
      updatedAt: new Date('2026-04-26T00:00:00Z'),
    };
    this.candidates.push(candidate);
    return candidate;
  }

  async updateStoryCandidateScoring(id: string, input: UpdateStoryCandidateScoringInput) {
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

  async listStoryCandidates(filter: StoryCandidateListFilter) {
    const candidates = this.candidates.filter((candidate) => candidate.showId === filter.showId);
    const sorted = filter.sort === 'discovered'
      ? candidates.sort((a, b) => b.discoveredAt.getTime() - a.discoveredAt.getTime())
      : candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.discoveredAt.getTime() - a.discoveredAt.getTime());

    return sorted.slice(0, filter.limit ?? 50);
  }
}

function braveFetch(results: Array<Record<string, unknown>>): BraveFetch {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return { results };
    },
  });
}

const deterministicScorer: CandidateScorer = {
  async score(request: CandidateScoringRequest) {
    if (request.candidate.title.includes('Fail')) {
      throw new Error('Injected scorer failure.');
    }

    const highValue = request.candidate.title.includes('High');
    const score = highValue ? 92 : 41;

    return {
      overallScore: score,
      componentScores: {
        significance: score,
        showFit: score - 2,
        novelty: score - 3,
        sourceQuality: score - 4,
        urgency: score - 5,
      },
      rationale: highValue ? 'High value for this show.' : 'Lower value for this show.',
      warnings: highValue ? [] : [{ code: 'LOW_RELEVANCE', severity: 'info', message: 'Lower relevance.' }],
      flags: highValue ? ['shortlist'] : ['watch'],
      angle: highValue ? 'Explain the broader impact.' : undefined,
      verdict: highValue ? 'shortlist' : 'watch',
      scoringStatus: 'scored',
      scorer: { type: 'test-fake', fallback: false },
    };
  },
};

describe('search routes candidate scoring', () => {
  it('persists scoring metadata and returns score-sorted candidates by default', async () => {
    const store = new FakeSearchStore();
    const app = buildApp({
      sourceStore: store,
      braveApiKey: 'test-key',
      candidateScorer: deterministicScorer,
      fetchImpl: braveFetch([
        {
          title: 'Low value update',
          url: 'https://example.com/low',
          description: 'A minor update.',
          age: '2026-04-26T00:00:00Z',
          meta_url: { hostname: 'example.com' },
        },
        {
          title: 'High value development',
          url: 'https://example.com/high',
          description: 'A major development with clear public impact.',
          age: '2026-04-26T00:00:00Z',
          meta_url: { hostname: 'example.com' },
        },
      ]),
    });

    try {
      const searchResponse = await app.inject({ method: 'POST', url: '/source-profiles/22222222-2222-4222-8222-222222222222/search' });
      const searchBody = searchResponse.json();

      assert.equal(searchResponse.statusCode, 200);
      assert.equal(searchBody.inserted, 2);
      assert.equal(searchBody.job.output.scoring.scored, 2);
      assert.equal(searchBody.candidates[0].metadata.scoringStatus, 'scored');
      assert.equal(searchBody.candidates[1].scoreBreakdown.rationale, 'High value for this show.');

      const listResponse = await app.inject({ method: 'GET', url: '/story-candidates?showSlug=example-show' });
      const listBody = listResponse.json();

      assert.equal(listResponse.statusCode, 200);
      assert.equal(listBody.storyCandidates[0].title, 'High value development');
      assert.equal(listBody.storyCandidates[0].score, 92);
      assert.equal(listBody.storyCandidates[0].scoreBreakdown.angle, 'Explain the broader impact.');
      assert.equal(listBody.storyCandidates[1].title, 'Low value update');
    } finally {
      await app.close();
    }
  });

  it('keeps inserted candidates and logs fallback when scoring fails', async () => {
    const store = new FakeSearchStore();
    const app = buildApp({
      sourceStore: store,
      braveApiKey: 'test-key',
      candidateScorer: deterministicScorer,
      fetchImpl: braveFetch([{
        title: 'Fail scoring but keep candidate',
        url: 'https://example.com/fail',
        description: 'A candidate that triggers fake scorer failure.',
        age: '2026-04-26T00:00:00Z',
        meta_url: { hostname: 'example.com' },
      }]),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/source-profiles/22222222-2222-4222-8222-222222222222/search' });
      const body = response.json();

      assert.equal(response.statusCode, 200);
      assert.equal(body.inserted, 1);
      assert.equal(body.job.status, 'succeeded');
      assert.equal(body.job.output.scoring.failed, 1);
      assert.equal(body.candidates[0].metadata.scoringStatus, 'failed');
      assert.equal(body.candidates[0].scoreBreakdown.scorer.fallback, true);
      assert.match(JSON.stringify(body.job.logs), /Injected scorer failure/);
    } finally {
      await app.close();
    }
  });
});
