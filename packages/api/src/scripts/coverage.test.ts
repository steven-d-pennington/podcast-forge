import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ResearchPacketRecord } from '../research/store.js';
import type { ScriptRevisionRecord } from './store.js';
import { buildClaimCoverageSummary } from './coverage.js';

function packet(overrides: Partial<ResearchPacketRecord> = {}): ResearchPacketRecord {
  return {
    id: 'packet-1',
    showId: 'show-1',
    episodeCandidateId: null,
    title: 'Coverage test packet',
    status: 'ready',
    sourceDocumentIds: ['source-1', 'source-2'],
    claims: [],
    citations: [],
    warnings: [],
    content: { readiness: { status: 'ready' } },
    approvedAt: null,
    createdAt: new Date('2026-04-20T00:00:00Z'),
    updatedAt: new Date('2026-04-20T00:00:00Z'),
    ...overrides,
  };
}

function revision(overrides: Partial<ScriptRevisionRecord> = {}): ScriptRevisionRecord {
  return {
    id: 'revision-1',
    scriptId: 'script-1',
    version: 1,
    title: 'Coverage test script',
    body: 'HOST: A sourced line.',
    format: 'feature-analysis',
    speakers: ['HOST'],
    author: 'test',
    changeSummary: null,
    modelProfile: {},
    metadata: {
      citationMap: [],
      validation: {
        provenance: {
          valid: true,
          warnings: [],
        },
      },
    },
    createdAt: new Date('2026-04-20T00:00:00Z'),
    ...overrides,
  };
}

describe('claim coverage summary', () => {
  it('surfaces weak and unsupported claim coverage with blocking integrity findings', () => {
    const summary = buildClaimCoverageSummary(
      packet({
        claims: [{
          id: 'claim-weak',
          text: 'The investigation proves a high-stakes security breach.',
          sourceDocumentIds: [],
          citationUrls: [],
          claimType: 'fact',
          confidence: 'low',
          supportLevel: 'single_source',
          highStakes: true,
        }],
      }),
      revision({
        metadata: {
          citationMap: [],
          validation: { provenance: { valid: true, warnings: [] } },
          integrityReview: {
            status: 'fail',
            result: {
              claimIssues: [{
                claimId: 'claim-weak',
                scriptExcerpt: 'proves a high-stakes security breach',
                issue: 'The script upgrades weak research into certainty.',
                severity: 'critical',
                suggestedFix: 'Soften the claim and fetch primary evidence.',
              }],
            },
          },
        },
      }),
      { now: new Date('2026-04-20T00:00:00Z') },
    );

    assert.equal(summary.status, 'blocking');
    assert.equal(summary.counts.totalClaims, 1);
    assert.ok(summary.blockers.some((item) => item.code === 'INTEGRITY_CLAIM_ISSUE'));
    assert.ok(summary.needsAttention.some((item) => item.code === 'CLAIM_MISSING_CITATIONS'));
    assert.ok(summary.needsAttention.some((item) => item.code === 'CLAIM_SINGLE_SOURCE'));
    assert.ok(summary.needsAttention.some((item) => item.code === 'CLAIM_MISSING_PRIMARY_SOURCE'));
    assert.match(summary.headline, /blocking coverage finding/);
  });

  it('marks corroborated cited claims covered when no blockers are present', () => {
    const summary = buildClaimCoverageSummary(
      packet({
        claims: [{
          id: 'claim-covered',
          text: 'Two independent fetched sources support the product launch timing.',
          sourceDocumentIds: ['source-1', 'source-2'],
          citationUrls: ['https://primary.example/launch', 'https://independent.example/report'],
          claimType: 'fact',
          confidence: 'high',
          supportLevel: 'corroborated',
          highStakes: false,
        }],
        citations: [{
          sourceDocumentId: 'source-1',
          url: 'https://primary.example/launch',
          title: 'Launch source',
          fetchedAt: '2026-04-20T00:00:00.000Z',
          status: 'fetched',
        }, {
          sourceDocumentId: 'source-2',
          url: 'https://independent.example/report',
          title: 'Independent source',
          fetchedAt: '2026-04-20T00:00:00.000Z',
          status: 'fetched',
        }],
      }),
      revision({
        metadata: {
          citationMap: [{
            line: 'HOST: Two independent sources support the product launch timing.',
            claimId: 'claim-covered',
            sourceDocumentIds: ['source-1', 'source-2'],
          }],
          validation: { provenance: { valid: true, warnings: [] } },
          integrityReview: {
            status: 'pass',
            result: {
              claimIssues: [],
              missingCitations: [],
              unsupportedCertainty: [],
              attributionWarnings: [],
              balanceWarnings: [],
              biasSensationalismWarnings: [],
            },
          },
        },
      }),
      { now: new Date('2026-04-20T00:00:00Z') },
    );

    assert.equal(summary.status, 'covered');
    assert.equal(summary.counts.covered, 1);
    assert.equal(summary.counts.blockingFindings, 0);
    assert.equal(summary.counts.needsAttentionFindings, 0);
    assert.equal(summary.claims[0]?.independentSourceCount, 2);
    assert.match(summary.headline, /adequate citation coverage/);
  });
});
