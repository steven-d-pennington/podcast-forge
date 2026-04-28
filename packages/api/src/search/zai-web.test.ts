import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { searchZaiWeb, type ZaiWebFetch } from './zai-web.js';
import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';

const profile: SourceProfileRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  showId: '11111111-1111-4111-8111-111111111111',
  slug: 'zai-news',
  name: 'Z.AI News',
  type: 'zai-web',
  enabled: true,
  weight: 1,
  freshness: 'pd',
  includeDomains: ['example.com'],
  excludeDomains: [],
  rateLimit: {},
  config: { count: 2 },
  createdAt: new Date('2026-04-26T00:00:00Z'),
  updatedAt: new Date('2026-04-26T00:00:00Z'),
};

const query: SourceQueryRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  sourceProfileId: profile.id,
  query: 'latest AI model releases',
  enabled: true,
  weight: 1,
  region: null,
  language: 'en',
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: [],
  config: {},
  createdAt: new Date('2026-04-26T00:00:00Z'),
  updatedAt: new Date('2026-04-26T00:00:00Z'),
};

describe('Z.AI web search adapter', () => {
  it('posts structured search requests and maps results to source candidates', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl: ZaiWebFetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body) as Record<string, unknown>;

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'search-1',
            search_result: [{
              title: 'OpenAI announces GPT-5.5',
              link: 'https://example.com/gpt-5-5',
              content: 'A concise search result summary.',
              media: 'Example News',
              publish_date: '2026-04-23',
              refer: 'ref_1',
            }],
          };
        },
      };
    };

    const candidates = await searchZaiWeb({ apiKey: 'test-key', profile, queries: [query], fetchImpl });

    assert.equal(capturedBody?.search_engine, 'search-prime');
    assert.equal(capturedBody?.search_query, 'latest AI model releases');
    assert.equal(capturedBody?.count, 2);
    assert.equal(capturedBody?.search_domain_filter, 'example.com');
    assert.equal(capturedBody?.search_recency_filter, 'oneDay');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].title, 'OpenAI announces GPT-5.5');
    assert.equal(candidates[0].url, 'https://example.com/gpt-5-5');
    assert.equal(candidates[0].sourceName, 'Example News');
    const metadata = candidates[0].metadata as Record<string, { id: string } | string>;
    assert.equal(metadata.provider, 'zai-web');
    assert.equal((metadata.query as { id: string }).id, query.id);
  });
});
