import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { searchOpenRouterPerplexity, type OpenRouterPerplexityFetch } from './openrouter-perplexity.js';
import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';

const profile: SourceProfileRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  showId: '11111111-1111-4111-8111-111111111111',
  slug: 'openrouter-sonar',
  name: 'OpenRouter Sonar',
  type: 'openrouter-perplexity',
  enabled: true,
  weight: 1,
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: ['youtube.com'],
  rateLimit: {},
  config: { model: 'perplexity/sonar', topN: 1 },
  createdAt: new Date('2026-04-28T00:00:00Z'),
  updatedAt: new Date('2026-04-28T00:00:00Z'),
};

const query: SourceQueryRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  sourceProfileId: profile.id,
  query: 'new AI model launched today',
  enabled: true,
  weight: 1,
  region: 'US',
  language: 'en',
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: [],
  config: {},
  createdAt: new Date('2026-04-28T00:00:00Z'),
  updatedAt: new Date('2026-04-28T00:00:00Z'),
};

describe('OpenRouter Perplexity source provider', () => {
  it('uses json_schema, harvests annotations, caps top-N, and filters denied/video sources', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: OpenRouterPerplexityFetch = async (_url, init) => {
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      title: 'Anthropic ships Claude Opus 4.7',
                      url: 'https://www.anthropic.com/news/claude-opus-4-7',
                      sourceName: 'Anthropic',
                      summary: 'Official announcement with model details.',
                      date: '2026-04-28',
                      citations: ['1'],
                    },
                    {
                      title: 'Aggregator recap',
                      url: 'https://www.youtube.com/watch?v=example',
                      summary: 'Video recap that should be denied.',
                      publishedAt: null,
                    },
                  ],
                }),
                annotations: [{
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://www.anthropic.com/news/claude-opus-4-7',
                    title: 'Claude Opus 4.7',
                    start_index: 0,
                    end_index: 0,
                  },
                }],
              },
            }],
            usage: { cost: 0.005 },
          };
        },
      };
    };

    const candidates = await searchOpenRouterPerplexity({ apiKey: 'test-key', profile, queries: [query], fetchImpl });

    assert.equal(requestBody?.model, 'perplexity/sonar');
    assert.equal((requestBody?.response_format as { type?: string }).type, 'json_schema');
    assert.ok((requestBody?.response_format as { json_schema?: unknown }).json_schema);
    assert.equal(requestBody?.search_recency_filter, 'day');
    assert.ok((requestBody?.messages as Array<{ content: string }>)[0].content.includes('production approval gates'));
    assert.deepEqual(candidates.map((candidate) => candidate.title), ['Anthropic ships Claude Opus 4.7']);
    assert.equal(candidates[0].publishedAt?.toISOString(), '2026-04-28T00:00:00.000Z');
    assert.deepEqual(candidates[0].metadata.freshness, { requested: 'day', confidence: 'claimed', verified: false });
    assert.deepEqual(candidates[0].metadata.citations, ['https://www.anthropic.com/news/claude-opus-4-7']);
  });

  it('accepts string search domain filters from config', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: OpenRouterPerplexityFetch = async (_url, init) => {
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }] };
        },
      };
    };

    await searchOpenRouterPerplexity({
      apiKey: 'test-key',
      profile: { ...profile, config: { ...profile.config, search_domain_filter: 'example.com' } },
      queries: [query],
      fetchImpl,
    });

    assert.deepEqual(requestBody?.search_domain_filter, ['-example.com']);
  });

  it('normalizes legacy recency aliases before sending OpenRouter search params', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: OpenRouterPerplexityFetch = async (_url, init) => {
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }] };
        },
      };
    };

    await searchOpenRouterPerplexity({
      apiKey: 'test-key',
      profile,
      queries: [{ ...query, config: { search_recency_filter: 'oneDay' } }],
      fetchImpl,
    });

    assert.equal(requestBody?.search_recency_filter, 'day');
  });
});
