import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// @ts-expect-error public browser modules are plain JavaScript and intentionally do not ship TS declarations.
import { deriveBroaderCorroborationRetryQuery, deriveCorroborationQuery, deriveOtherSourceSearchResult, derivePreferredSourceProfileId, deriveProductionViewModel, shouldOfferOtherSourceSearch } from '../public/ui-view-model.js';

function researchPacket(id: string, title: string, updatedAt: string) {
  return {
    id,
    showId: 'show-1',
    title,
    status: 'single_source_breaking',
    warnings: [],
    citations: [],
    claims: [],
    content: { readiness: { status: 'single_source_breaking' } },
    createdAt: updatedAt,
    updatedAt,
  };
}

function script(id: string, researchPacketId: string, updatedAt: string) {
  return {
    id,
    researchPacketId,
    title: `Script ${id}`,
    status: 'draft',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('source profile selection', () => {
  it('defaults to the first enabled discoverable source instead of the first disabled profile', () => {
    const profiles = [
      { id: 'disabled-brave', showId: 'show-1', slug: 'ai-news-brave', name: 'AI News Brave', type: 'brave', enabled: false },
      { id: 'enabled-breaking', showId: 'show-1', slug: 'breaking-news-zai', name: 'Breaking News', type: 'brave', enabled: true },
    ];

    assert.equal(derivePreferredSourceProfileId({ profiles }), 'enabled-breaking');
  });

  it('keeps an existing enabled selected source profile', () => {
    const profiles = [
      { id: 'enabled-brave', showId: 'show-1', slug: 'ai-news-brave', name: 'AI News Brave', type: 'brave', enabled: true },
      { id: 'enabled-breaking', showId: 'show-1', slug: 'breaking-news-zai', name: 'Breaking News', type: 'brave', enabled: true },
    ];

    assert.equal(derivePreferredSourceProfileId({ profiles, selectedProfileId: 'enabled-breaking' }), 'enabled-breaking');
  });
});

describe('other-source search availability', () => {
  it('offers other-source search for current single-source breaking research briefs', () => {
    assert.equal(shouldOfferOtherSourceSearch({
      packet: researchPacket('brief-single', 'Single source story', '2026-05-04T00:00:00.000Z'),
      scopeClassName: 'current',
    }), true);
  });

  it('does not offer other-source search for archived research briefs', () => {
    assert.equal(shouldOfferOtherSourceSearch({
      packet: researchPacket('brief-archive', 'Archived story', '2026-05-04T00:00:00.000Z'),
      scopeClassName: 'archive',
    }), false);
  });
});

describe('other-source search query selection', () => {
  it('prefers broad packet titles over stale narrow claim-derived packet queries', () => {
    const packet: any = researchPacket(
      'brief-current',
      'Dogfood source extraction and claim/source coverage quality after source-cleaning patch',
      '2026-05-04T00:00:00.000Z',
    );
    packet.content = {
      ...packet.content,
      synthesis: {
        claims: [{
          citations: [{ title: 'How natural disasters are exploited to manipulate people online - CBS News' }],
        }],
      },
      corroboration: {
        queries: ['In September 2024, Hurricane Helene caused massive floods in the mountains of North Carolina, uprooting trees and sweeping away homes.'],
      },
    };

    assert.equal(
      deriveCorroborationQuery({ packet }),
      'How natural disasters are exploited to manipulate people online',
    );
  });
});

describe('corroboration retry query derivation', () => {
  it('builds a broader keyword search from a failed question-style corroboration query', () => {
    const query = deriveBroaderCorroborationRetryQuery({
      previousQuery: 'How natural disasters are exploited to manipulate people online',
      packet: {
        title: 'How natural disasters are exploited to manipulate people online',
        citations: [{ title: 'Scammers exploit Hurricane Aurora rumors on social platforms' }],
        content: {
          corroboration: {
            queries: ['How natural disasters are exploited to manipulate people online'],
          },
        },
      },
    });

    assert.match(query, /natural disasters exploited manipulate people online/);
    assert.match(query, /independent reporting/);
    assert.doesNotMatch(query, /^how\b/i);
    assert.ok(query.length < 'How natural disasters are exploited to manipulate people online independent reporting'.length + 30);
  });
});

describe('other-source search result handoff', () => {
  it('summarizes inserted candidates with review guidance before rebuilding a research brief', () => {
    const result = deriveOtherSourceSearchResult({
      inserted: 1,
      skipped: 0,
      candidates: [{
        id: 'candidate-low-fit',
        title: 'Wikipedia founder brands Australia’s social media ban an unmitigated disaster',
        score: 32,
        metadata: {
          scoring: {
            verdict: 'ignore',
            warnings: [{ code: 'TOPIC_MISMATCH', message: 'Article content does not match the episode focus.' }],
          },
        },
      }],
    });

    assert.equal(result.status, 'warning');
    assert.deepEqual(result.candidateIds, ['candidate-low-fit']);
    assert.match(result.message, /1 inserted, 0 skipped/);
    assert.match(result.message, /Review 1 inserted candidate/);
    assert.match(result.message, /score 32/);
    assert.match(result.message, /verdict ignore/);
    assert.match(result.nextStep, /Do not rebuild/);
    assert.match(result.nextStep, /another search or add a manual source URL/);
    assert.deepEqual(result.safeCandidateIds, []);
    assert.deepEqual(result.weakCandidateIds, ['candidate-low-fit']);
  });

  it('allows rebuild guidance when inserted candidates clear score and verdict checks', () => {
    const result = deriveOtherSourceSearchResult({
      inserted: 1,
      skipped: 0,
      candidates: [{
        id: 'candidate-good-fit',
        title: 'Independent source confirms disaster misinformation campaign',
        score: 74,
        metadata: { scoring: { verdict: 'shortlist', warnings: [] } },
      }],
    });

    assert.equal(result.status, 'info');
    assert.deepEqual(result.safeCandidateIds, ['candidate-good-fit']);
    assert.deepEqual(result.weakCandidateIds, []);
    assert.match(result.nextStep, /Select independent, relevant results/);
    assert.match(result.nextStep, /rebuild the research brief/);
  });

  it('keeps candidate IDs from persisted jobs even when candidate records are loaded separately', () => {
    const result = deriveOtherSourceSearchResult({
      inserted: 1,
      skipped: 0,
      candidateIds: ['persisted-candidate'],
    });

    assert.deepEqual(result.candidateIds, ['persisted-candidate']);
    assert.match(result.message, /Review 1 inserted candidate/);
  });
});

describe('production view model active artifact selection', () => {
  it('prefers an explicitly selected research brief over a stale selected script path', () => {
    const oldBrief = researchPacket('brief-old', 'Old audio-ready story', '2026-04-20T00:00:00.000Z');
    const newBrief = researchPacket('brief-new', 'Fresh dogfood source-cleaning story', '2026-05-04T00:00:00.000Z');

    const viewModel = deriveProductionViewModel({
      selectedShowSlug: 'the-synthetic-lens',
      shows: [{ id: 'show-1', slug: 'the-synthetic-lens', title: 'The Synthetic Lens' }],
      selectedResearchPacketId: newBrief.id,
      selectedScriptId: 'script-old',
      researchPackets: [oldBrief, newBrief],
      scripts: [script('script-old', oldBrief.id, '2026-04-21T00:00:00.000Z')],
      selectedCandidateIds: [],
      episodes: [{
        id: 'episode-old',
        title: 'Old audio-ready story',
        status: 'audio-ready',
        researchPacketId: oldBrief.id,
        metadata: { researchPacketId: oldBrief.id, scriptId: 'script-old' },
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
      }],
      production: { assets: [], jobs: [] },
    });

    assert.equal(viewModel.activeArtifacts.brief?.id, newBrief.id);
    assert.equal(viewModel.activeArtifacts.brief?.title, newBrief.title);
    assert.equal(viewModel.activeArtifacts.script, null);
    assert.equal(viewModel.activeArtifacts.publishing, null);
  });
});
