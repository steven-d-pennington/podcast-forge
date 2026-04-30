import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildApp } from '../app.js';
import type { StoryCandidateRecord } from '../search/store.js';
import type {
  CreateResearchPacketInput,
  CreateSourceDocumentInput,
  OverrideResearchWarningInput,
  ResearchPacketRecord,
  SourceDocumentRecord,
} from './store.js';

const showId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

function storyCandidate(): StoryCandidateRecord {
  const now = new Date();
  return {
    id: candidateId,
    showId,
    sourceProfileId: 'profile-1',
    sourceQueryId: 'query-1',
    title: 'Anthropic potential $900B valuation round could happen within two weeks',
    url: 'https://techcrunch.com/anthropic-900b-valuation-round',
    canonicalUrl: 'https://techcrunch.com/anthropic-900b-valuation-round',
    sourceName: 'TechCrunch',
    author: 'Reporter',
    summary: 'Anthropic may raise at a $900 billion valuation within two weeks.',
    publishedAt: now,
    discoveredAt: now,
    score: 88,
    scoreBreakdown: {},
    status: 'new',
    rawPayload: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

class FakeResearchRouteStore {
  candidates = [storyCandidate()];
  documents: SourceDocumentRecord[] = [];
  packets: ResearchPacketRecord[] = [];

  async getStoryCandidate(id: string) {
    return this.candidates.find((candidate) => candidate.id === id);
  }

  async createSourceDocument(input: CreateSourceDocumentInput) {
    const document: SourceDocumentRecord = {
      ...input,
      id: `source-${this.documents.length + 1}`,
      fetchedAt: input.fetchedAt ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.documents.push(document);
    return document;
  }

  async createResearchPacket(input: CreateResearchPacketInput) {
    const packet: ResearchPacketRecord = {
      ...input,
      id: `packet-${this.packets.length + 1}`,
      approvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.packets.push(packet);
    return packet;
  }

  async getResearchPacket(id: string) {
    return this.packets.find((packet) => packet.id === id);
  }

  async listResearchPackets() {
    return this.packets;
  }

  async overrideResearchWarning(_id: string, _input: OverrideResearchWarningInput) {
    return undefined;
  }

  async excludeResearchClaim() {
    return undefined;
  }

  async markResearchSourcePrimary() {
    return undefined;
  }

  async approveResearchPacket(id: string) {
    const packet = await this.getResearchPacket(id);
    if (!packet) {
      return undefined;
    }
    packet.status = 'approved';
    packet.approvedAt = new Date();
    packet.updatedAt = new Date();
    return packet;
  }
}

describe('research packet corroboration search workflow', () => {
  it('runs an automatic claim-guided corroboration source search before saving a single-source breaking packet', async () => {
    const store = new FakeResearchRouteStore();
    const searches: Array<{ query: string; excludeDomains: string[] }> = [];
    const app = buildApp({
      sourceStore: store as never,
      researchFetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        async text() {
          return `<html><head><title>Anthropic could raise at $900B valuation within two weeks</title></head><body>${'Anthropic could raise a new funding round at a $900 billion valuation within two weeks. Investors are discussing the deal according to people familiar with the talks. '.repeat(8)}</body></html>`;
        },
      }),
      corroborationSearchRunner: async (request) => {
        searches.push({ query: request.query, excludeDomains: request.excludeDomains });
        return {
          status: 'succeeded',
          query: request.query,
          excludeDomains: request.excludeDomains,
          inserted: 2,
          skipped: 0,
          jobId: 'job-corroboration-1',
          sourceProfileId: 'profile-search-1',
          sourceProfileType: 'zai-web',
        };
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/story-candidates/${candidateId}/research-packet`,
      payload: {},
    });

    assert.equal(response.statusCode, 201);
    assert.equal(searches.length, 1);
    assert.match(searches[0].query, /Anthropic/i);
    assert.match(searches[0].query, /valuation/i);
    assert.deepEqual(searches[0].excludeDomains, ['techcrunch.com']);

    const body = response.json() as { researchPacket: ResearchPacketRecord };
    const corroboration = body.researchPacket.content.corroboration as {
      attempted: boolean;
      automatedSearch: { status: string; inserted: number; jobId: string; sourceProfileType: string };
    };
    assert.equal(corroboration.attempted, true);
    assert.equal(corroboration.automatedSearch.status, 'succeeded');
    assert.equal(corroboration.automatedSearch.inserted, 2);
    assert.equal(corroboration.automatedSearch.jobId, 'job-corroboration-1');
    assert.equal(corroboration.automatedSearch.sourceProfileType, 'zai-web');
  });

  it('allows approval after a warning-only blocked brief has all warnings overridden', async () => {
    const store = new FakeResearchRouteStore();
    const app = buildApp({ sourceStore: store as never });
    const packet = await store.createResearchPacket({
      showId,
      episodeCandidateId: null,
      title: 'Warning-only blocked packet',
      status: 'blocked',
      sourceDocumentIds: ['source-1', 'source-2'],
      claims: [{
        id: 'claim-1',
        text: 'A sourced claim is ready after review.',
        sourceDocumentIds: ['source-1'],
        citationUrls: ['https://example.com/source'],
      }],
      citations: [],
      warnings: [{
        id: 'warning-1',
        code: 'SOURCE_PARSE_FAILURE',
        severity: 'error',
        message: 'A source parse warning requires review.',
        override: {
          actor: 'editor@example.com',
          reason: 'Reviewed and acceptable.',
          overriddenAt: new Date().toISOString(),
        },
      }],
      content: {
        readiness: {
          status: 'blocked',
          reasons: ['At least one error-level warning requires editorial review.'],
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/approve`,
      payload: {
        actor: 'editor@example.com',
        reason: 'All warning-only blockers were reviewed.',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().researchPacket.status, 'approved');
    await app.close();
  });
});
