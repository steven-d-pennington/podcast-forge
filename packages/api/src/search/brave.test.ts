import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { searchBraveNews, type BraveFetch } from './brave.js';
import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';

const profile: SourceProfileRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  showId: '11111111-1111-4111-8111-111111111111',
  slug: 'brave-news',
  name: 'Brave News',
  type: 'brave',
  enabled: true,
  weight: 1,
  freshness: 'pd',
  includeDomains: [],
  excludeDomains: [],
  rateLimit: {},
  config: { count: 2 },
  createdAt: new Date('2026-04-26T00:00:00Z'),
  updatedAt: new Date('2026-04-26T00:00:00Z'),
};

function makeQuery(id: string, queryText: string): SourceQueryRecord {
  return {
    id,
    sourceProfileId: profile.id,
    query: queryText,
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
}

function okResponse(title = 'OpenAI announces GPT-5.5') {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        results: [{
          title,
          url: `https://example.com/${encodeURIComponent(title)}`,
          description: 'A concise search result summary.',
          source: 'Example News',
          published: '2026-04-23T00:00:00Z',
        }],
      };
    },
  };
}

describe('Brave news search adapter', () => {
  it('paces multiple query requests to respect Brave free-plan request-per-second limits', async () => {
    const waits: number[] = [];
    const requestedUrls: string[] = [];
    const fetchImpl: BraveFetch = async (url) => {
      requestedUrls.push(url);
      return okResponse(`result ${requestedUrls.length}`);
    };

    const candidates = await searchBraveNews({
      apiKey: 'test-key',
      profile,
      queries: [
        makeQuery('33333333-3333-4333-8333-333333333333', 'latest AI model releases'),
        makeQuery('44444444-4444-4444-8444-444444444444', 'AI funding news'),
      ],
      fetchImpl,
      rateLimitDelayMs: 1_100,
      sleep: async (ms) => { waits.push(ms); },
    });

    assert.equal(requestedUrls.length, 2);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 0);
    assert.equal(candidates.length, 2);
  });

  it('retries once after a Brave 429 rate-limit response', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl: BraveFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          async json() { return {}; },
        };
      }
      return okResponse('retried result');
    };

    const candidates = await searchBraveNews({
      apiKey: 'test-key',
      profile,
      queries: [makeQuery('33333333-3333-4333-8333-333333333333', 'latest AI model releases')],
      fetchImpl,
      rateLimitDelayMs: 1_100,
      sleep: async (ms) => { waits.push(ms); },
    });

    assert.equal(calls, 2);
    assert.deepEqual(waits, [1_100]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].title, 'retried result');
  });
});
