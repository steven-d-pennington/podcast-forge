import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StoryCandidateRecord } from '../search/store.js';
import { buildResearchPacketInputFromCandidates } from './builder.js';
import type { ResearchClaim, SourceDocumentRecord } from './store.js';

function candidate(overrides: Partial<StoryCandidateRecord> = {}): StoryCandidateRecord {
  const now = new Date();
  return {
    id: 'candidate-1',
    showId: 'show-1',
    sourceProfileId: 'profile-1',
    sourceQueryId: 'query-1',
    title: 'Anthropic potential $900B valuation round could happen within two weeks',
    url: 'https://techcrunch.com/anthropic-900b-valuation-round',
    canonicalUrl: 'https://techcrunch.com/anthropic-900b-valuation-round',
    sourceName: 'TechCrunch',
    author: 'Reporter',
    summary: 'Anthropic may raise at a $900 billion valuation within two weeks, according to people familiar with the talks.',
    publishedAt: now,
    discoveredAt: now,
    score: 88,
    scoreBreakdown: {},
    status: 'new',
    rawPayload: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sourceDocument(overrides: Partial<SourceDocumentRecord> = {}): SourceDocumentRecord {
  const now = new Date();
  return {
    id: 'source-1',
    storyCandidateId: 'candidate-1',
    url: 'https://techcrunch.com/anthropic-900b-valuation-round',
    canonicalUrl: 'https://techcrunch.com/anthropic-900b-valuation-round',
    title: 'Anthropic could raise at $900B valuation within two weeks',
    fetchedAt: now,
    fetchStatus: 'fetched',
    httpStatus: 200,
    contentType: 'text/html',
    textContent: 'Anthropic could raise a new funding round at a $900 billion valuation within two weeks. Investors are discussing the deal according to people familiar with the talks.',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('buildResearchPacketInputFromCandidates corroboration guidance', () => {
  it('classifies fresh single-host research as single-source breaking and emits claim-derived corroboration queries', () => {
    const claim: ResearchClaim = {
      id: 'claim-valuation',
      text: 'Anthropic could raise at a $900 billion valuation within two weeks.',
      sourceDocumentIds: ['source-1'],
      citationUrls: ['https://techcrunch.com/anthropic-900b-valuation-round'],
      claimType: 'fact',
      confidence: 'medium',
      supportLevel: 'single_source',
      highStakes: false,
    };

    const packet = buildResearchPacketInputFromCandidates({
      candidates: [candidate()],
      documents: [sourceDocument()],
      claims: [claim],
    });

    assert.equal(packet.status, 'single_source_breaking');
    assert.deepEqual((packet.content.readiness as { status: string }).status, 'single_source_breaking');
    assert.ok(packet.warnings.some((warning) => warning.code === 'SINGLE_SOURCE_BREAKING_NEWS'));

    const corroboration = packet.content.corroboration as {
      classification: string;
      excludedHosts: string[];
      queries: string[];
      requiresAttribution: boolean;
    };
    assert.equal(corroboration.classification, 'single_source_breaking');
    assert.equal(corroboration.requiresAttribution, true);
    assert.deepEqual(corroboration.excludedHosts, ['techcrunch.com']);
    assert.ok(corroboration.queries.some((query) => query.includes('Anthropic') && query.includes('$900 billion valuation')));
    assert.ok(corroboration.queries.every((query) => query.length <= 180));
  });

  it('does not add fallback source-summary claims when model claims are available', () => {
    const claim: ResearchClaim = {
      id: 'claim-model',
      text: 'Emergency managers say fabricated disaster images spread faster than corrections.',
      sourceDocumentIds: ['source-1'],
      citationUrls: ['https://techcrunch.com/anthropic-900b-valuation-round'],
      claimType: 'fact',
      confidence: 'medium',
      supportLevel: 'single_source',
      highStakes: false,
    };

    const packet = buildResearchPacketInputFromCandidates({
      candidates: [candidate()],
      documents: [sourceDocument()],
      claims: [claim],
    });

    assert.deepEqual(packet.claims.map((item) => item.id), ['claim-model']);
    assert.ok(!packet.claims.some((item) => item.text.includes('reports:')));
  });

  it('deduplicates and caps noisy model claim lists before coverage review', () => {
    const noisyClaims = Array.from({ length: 16 }, (_, index): ResearchClaim => ({
      id: `claim-${index + 1}`,
      text: index === 1
        ? 'Emergency managers say fabricated disaster images spread faster than corrections!'
        : `Distinct sourced claim number ${index + 1} about the disaster misinformation response.`,
      sourceDocumentIds: ['source-1'],
      citationUrls: ['https://techcrunch.com/anthropic-900b-valuation-round'],
      claimType: 'fact',
      confidence: 'medium',
      supportLevel: 'single_source',
      highStakes: false,
    }));
    noisyClaims[0] = {
      ...noisyClaims[0]!,
      text: 'Emergency managers say fabricated disaster images spread faster than corrections.',
    };

    const packet = buildResearchPacketInputFromCandidates({
      candidates: [candidate()],
      documents: [sourceDocument()],
      claims: noisyClaims,
    });

    assert.equal(packet.claims.length, 12);
    assert.equal(packet.claims.filter((item) => item.text.includes('fabricated disaster images')).length, 1);
  });

  it('prioritizes broad story-level corroboration queries before narrow claim sentences', () => {
    const packet = buildResearchPacketInputFromCandidates({
      candidates: [candidate({
        title: 'How natural disasters are exploited to manipulate people online - CBS News',
        summary: 'White nationalists and conspiracy theorists used Hurricane Helene relief efforts to recruit online.',
      })],
      documents: [sourceDocument({
        title: 'How natural disasters are exploited to manipulate people online - CBS News',
        canonicalUrl: 'https://www.cbsnews.com/news/how-natural-disasters-are-exploited-to-manipulate-people-online-60-minutes',
        url: 'https://www.cbsnews.com/news/how-natural-disasters-are-exploited-to-manipulate-people-online-60-minutes',
      })],
      claims: [{
        id: 'claim-too-specific',
        text: 'In September 2024, Hurricane Helene caused massive floods in the mountains of North Carolina, uprooting trees and sweeping away homes.',
        sourceDocumentIds: ['source-1'],
        citationUrls: ['https://www.cbsnews.com/news/how-natural-disasters-are-exploited-to-manipulate-people-online-60-minutes'],
        claimType: 'fact',
        confidence: 'medium',
        supportLevel: 'single_source',
        highStakes: false,
      }],
    });

    const corroboration = packet.content.corroboration as { queries: string[] };
    assert.equal(corroboration.queries[0], 'How natural disasters are exploited to manipulate people online');
    assert.doesNotMatch(corroboration.queries[0], /September 2024|uprooting trees|CBS News/);
  });

  it('keeps stale single-host research blocked as needs_more_sources while preserving corroboration queries', () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');
    const packet = buildResearchPacketInputFromCandidates({
      candidates: [candidate({ publishedAt: oldDate, discoveredAt: oldDate })],
      documents: [sourceDocument({ fetchedAt: oldDate, createdAt: oldDate, updatedAt: oldDate })],
    });

    assert.equal(packet.status, 'needs_more_sources');
    const corroboration = packet.content.corroboration as { classification: string; queries: string[] };
    assert.equal(corroboration.classification, 'uncorroborated_single_source');
    assert.ok(corroboration.queries.length > 0);
  });
});
