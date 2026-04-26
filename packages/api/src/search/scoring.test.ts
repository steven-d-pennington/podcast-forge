import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeLlmProvider } from '../llm/providers.js';
import { createLlmRuntime } from '../llm/runtime.js';
import { LlmJsonOutputError } from '../llm/types.js';
import { createPromptRegistry } from '../prompts/registry.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import type { ShowRecord, SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import type { StoryCandidateRecord } from './store.js';
import { buildCandidateScoringInput, createLlmCandidateScorer } from './scoring.js';

const now = new Date('2026-04-26T12:00:00Z');

const show: ShowRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'example-show',
  title: 'Example Show',
  description: 'Evidence-first news analysis.',
  setupStatus: 'active',
  format: 'briefing',
  defaultRuntimeMinutes: 8,
  cast: [{ name: 'Host', voice: 'voice-1' }],
  defaultModelProfile: {},
  settings: { tone: 'measured' },
  createdAt: now,
  updatedAt: now,
};

const sourceProfile: SourceProfileRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  showId: show.id,
  slug: 'news',
  name: 'News',
  type: 'brave',
  enabled: true,
  weight: 1.2,
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: [],
  rateLimit: {},
  config: {
    count: 5,
    apiKey: 'do-not-include',
    localPath: '/home/private/source-cache',
  },
  createdAt: now,
  updatedAt: now,
};

const sourceQuery: SourceQueryRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  sourceProfileId: sourceProfile.id,
  query: 'ai policy',
  enabled: true,
  weight: 1,
  region: 'US',
  language: 'en',
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: [],
  config: {},
  createdAt: now,
  updatedAt: now,
};

const candidate: StoryCandidateRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  showId: show.id,
  sourceProfileId: sourceProfile.id,
  sourceQueryId: sourceQuery.id,
  title: 'AI policy report released',
  url: 'https://example.com/ai-policy',
  canonicalUrl: 'https://example.com/ai-policy',
  sourceName: 'Example News',
  author: null,
  summary: 'A detailed report describes a new policy approach with multiple public impacts.',
  publishedAt: now,
  discoveredAt: now,
  score: null,
  scoreBreakdown: {},
  status: 'new',
  rawPayload: {
    provider: 'brave',
    token: 'do-not-include',
    nested: { credentialPath: '/home/private/credential.json' },
  },
  metadata: {},
  createdAt: now,
  updatedAt: now,
};

const modelProfile: ResolvedModelProfile = {
  id: '55555555-5555-4555-8555-555555555555',
  showId: show.id,
  role: 'candidate_scorer',
  provider: 'fake',
  model: 'candidate-score-model',
  params: {},
  fallbacks: [],
  budgetUsd: null,
  promptTemplateKey: null,
  version: now.toISOString(),
};

describe('candidate scoring service', () => {
  it('constructs scoring input without secrets or local-only paths', () => {
    const input = buildCandidateScoringInput({ candidate, show, sourceProfile, sourceQuery });
    const serialized = JSON.stringify(input);

    assert.equal(input.candidate.title, 'AI policy report released');
    assert.equal(input.candidate.domain, 'example.com');
    assert.doesNotMatch(serialized, /do-not-include/);
    assert.doesNotMatch(serialized, /\/home\/private/);
  });

  it('scores with the candidate_scorer prompt schema through the LLM runtime', async () => {
    const runtime = createLlmRuntime({
      adapters: [createFakeLlmProvider({
        handler: () => ({
          text: JSON.stringify({
            score: 87,
            verdict: 'shortlist',
            rationale: 'Strong public impact and timely source context.',
            dimensions: {
              significance: 91,
              showFit: 84,
              novelty: 88,
              sourceQuality: 79,
              urgency: 86,
            },
            warnings: [{ code: 'NEEDS_SECOND_SOURCE', severity: 'warning', message: 'Corroborate before scripting.' }],
            citations: [{ url: 'https://example.com/ai-policy', title: 'AI policy report released' }],
          }),
        }),
      })],
    });
    const scorer = createLlmCandidateScorer({ runtime, promptRegistry: createPromptRegistry() });
    const input = buildCandidateScoringInput({ candidate, show, sourceProfile, sourceQuery });
    const result = await scorer.score({ input, candidate, show, sourceProfile, sourceQuery, modelProfile });

    assert.equal(result.scoringStatus, 'scored');
    assert.equal(result.overallScore, 87);
    assert.equal(result.componentScores.significance, 91);
    assert.equal(result.warnings[0]?.code, 'NEEDS_SECOND_SOURCE');
    assert.equal(result.scorer.type, 'llm');
    assert.equal((result.scorer.modelProfile as { role: string }).role, 'candidate_scorer');
  });

  it('rejects invalid structured scorer output before persistence', async () => {
    const runtime = createLlmRuntime({
      adapters: [createFakeLlmProvider({
        handler: () => ({
          text: JSON.stringify({
            score: 110,
            verdict: 'shortlist',
            rationale: '',
            dimensions: {
              significance: 91,
              showFit: 84,
              novelty: 88,
              sourceQuality: 79,
              urgency: 86,
            },
          }),
        }),
      })],
    });
    const scorer = createLlmCandidateScorer({ runtime, promptRegistry: createPromptRegistry() });
    const input = buildCandidateScoringInput({ candidate, show, sourceProfile, sourceQuery });

    await assert.rejects(
      () => scorer.score({ input, candidate, show, sourceProfile, sourceQuery, modelProfile }),
      LlmJsonOutputError,
    );
  });
});
