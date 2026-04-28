import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveProductionViewModel } from '../packages/api/public/ui-view-model.js';

const show = {
  id: 'show-1',
  slug: 'demo-show',
  title: 'Demo Show',
  setupStatus: 'active',
  format: 'daily-briefing',
  defaultRuntimeMinutes: 8,
};

const profile = {
  id: 'profile-1',
  slug: 'demo-sources',
  name: 'Demo Story Sources',
  type: 'brave',
  enabled: true,
  weight: 1,
  freshness: 'pd',
};

const query = {
  id: 'query-1',
  sourceProfileId: 'profile-1',
  query: 'AI policy',
  enabled: true,
};

const candidate = {
  id: 'candidate-1',
  showId: 'show-1',
  sourceProfileId: 'profile-1',
  title: 'Regulators publish new AI safety guidance',
  status: 'new',
  canonicalUrl: 'https://example.com/ai-safety',
  sourceName: 'Example News',
  score: 82,
  discoveredAt: '2026-04-27T12:00:00.000Z',
};

const readyBrief = {
  id: 'brief-1',
  title: 'AI safety guidance brief',
  status: 'ready',
  approvedAt: '2026-04-27T13:00:00.000Z',
  warnings: [],
  citations: [{ url: 'https://example.com/ai-safety' }],
  createdAt: '2026-04-27T12:30:00.000Z',
  updatedAt: '2026-04-27T13:00:00.000Z',
};

const warningBrief = {
  ...readyBrief,
  id: 'brief-warning',
  warnings: [{ code: 'LOW_CORROBORATION', message: 'Needs another independent source.' }],
};

const script = {
  id: 'script-1',
  researchPacketId: 'brief-1',
  title: 'AI safety guidance script',
  status: 'draft',
  approvedRevisionId: null,
  createdAt: '2026-04-27T13:30:00.000Z',
  updatedAt: '2026-04-27T13:30:00.000Z',
};

const missingReviewRevision = {
  id: 'revision-1',
  scriptId: 'script-1',
  version: 1,
  title: 'AI safety guidance script',
  metadata: {},
  createdAt: '2026-04-27T13:30:00.000Z',
  updatedAt: '2026-04-27T13:30:00.000Z',
};

const passedReviewRevision = {
  ...missingReviewRevision,
  metadata: {
    integrityReview: {
      status: 'pass',
      reviewedAt: '2026-04-27T14:00:00.000Z',
    },
  },
  updatedAt: '2026-04-27T14:00:00.000Z',
};

const failedReviewRevision = {
  ...missingReviewRevision,
  metadata: {
    integrityReview: {
      status: 'fail',
      reviewedAt: '2026-04-27T14:00:00.000Z',
    },
  },
  updatedAt: '2026-04-27T14:00:00.000Z',
};

const approvedScript = {
  ...script,
  status: 'approved-for-audio',
  approvedRevisionId: 'revision-1',
  updatedAt: '2026-04-27T14:05:00.000Z',
};

const audioAsset = {
  id: 'asset-audio-1',
  type: 'audio-preview',
  status: 'ready',
  mimeType: 'audio/mpeg',
  byteSize: 1024,
  durationSeconds: 420,
  createdAt: '2026-04-27T14:30:00.000Z',
  updatedAt: '2026-04-27T14:30:00.000Z',
};

const coverAsset = {
  id: 'asset-cover-1',
  type: 'cover-art',
  status: 'ready',
  mimeType: 'image/png',
  byteSize: 2048,
  createdAt: '2026-04-27T14:35:00.000Z',
  updatedAt: '2026-04-27T14:35:00.000Z',
};

const episode = {
  id: 'episode-1',
  feedId: 'feed-1',
  title: 'AI safety guidance episode',
  slug: 'ai-safety-guidance',
  status: 'audio-ready',
  createdAt: '2026-04-27T14:40:00.000Z',
  updatedAt: '2026-04-27T14:40:00.000Z',
};

const feed = {
  id: 'feed-1',
  showId: 'show-1',
  title: 'Demo Feed',
  rssFeedPath: 'feeds/demo.xml',
  publicFeedUrl: 'https://podcasts.example.com/demo.xml',
  publicBaseUrl: 'https://podcasts.example.com/assets/',
  storageType: 'local',
};

function baseInput(overrides = {}) {
  return {
    shows: [show],
    feeds: [feed],
    profiles: [profile],
    queries: [query],
    storyCandidates: [],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    recentJobs: [],
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-1',
    selectedCandidateIds: [],
    selectedResearchPacketId: '',
    selectedScriptId: '',
    selectedScript: null,
    selectedRevision: null,
    selectedEpisodeId: '',
    selectedAssetIds: [],
    activeSurface: 'workflow',
    latestActionResult: { status: 'info', message: 'Fixture loaded.', source: 'test' },
    ...overrides,
  };
}

test('view model covers no show selected', () => {
  const model = deriveProductionViewModel(baseInput({
    selectedShowSlug: '',
    selectedProfileId: '',
    shows: [],
    profiles: [],
    queries: [],
    feeds: [],
  }));

  assert.equal(model.selectedShowSummary, null);
  assert.equal(model.currentStage.id, 'show');
  assert.equal(model.currentStage.status, 'blocked');
  assert.deepEqual(model.primaryNextAction, {
    label: 'Select or create show',
    targetStage: 'show',
    enabled: true,
    blockerReason: null,
  });
  assert.equal(model.activeArtifacts.brief, null);
  assert.equal(model.historicalArtifacts.briefs.length, 0);
});

test('view model marks source choice ready after show selection', () => {
  const model = deriveProductionViewModel(baseInput({
    selectedProfileId: '',
    profiles: [],
    queries: [],
  }));

  assert.equal(model.selectedShowSummary.slug, 'demo-show');
  assert.equal(model.currentStage.id, 'source');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Choose story source');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model covers source selected with no candidate stories', () => {
  const model = deriveProductionViewModel(baseInput());

  assert.equal(model.selectedStorySourceSummary.name, 'Demo Story Sources');
  assert.equal(model.selectedStorySourceSummary.queryCount, 1);
  assert.equal(model.stages.find((stage) => stage.id === 'source').artifact.queryCount, 1);
  assert.equal(model.stages.find((stage) => stage.id === 'source').artifact.enabledQueryCount, 1);
  assert.equal(model.currentStage.id, 'discover');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Run source search');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model covers candidates loaded but no story selected', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: [],
  }));

  assert.equal(model.selectedCandidateStorySummary.count, 0);
  assert.equal(model.currentStage.id, 'story');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Pick or cluster story');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model covers candidate selected with no research brief', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
  }));

  assert.equal(model.selectedCandidateStorySummary.count, 1);
  assert.equal(model.selectedCandidateStorySummary.primary.title, candidate.title);
  assert.equal(model.currentStage.id, 'brief');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Build research brief');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model blocks drafting while research warnings are unresolved', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [warningBrief],
    selectedResearchPacketId: 'brief-warning',
  }));

  assert.equal(model.currentStage.id, 'brief');
  assert.equal(model.currentStage.status, 'needs-review');
  assert.equal(model.primaryNextAction.label, 'Resolve research warnings');
  assert.equal(model.primaryNextAction.enabled, true);
  assert.equal(model.primaryNextAction.blockerReason, null);
  assert.ok(model.warnings.some((warning) => warning.stage === 'brief'));
});

test('view model covers research brief ready with no script', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
  }));

  assert.equal(model.activeArtifacts.brief.id, 'brief-1');
  assert.equal(model.latestArtifacts.brief.status, 'ready');
  assert.equal(model.currentStage.id, 'script');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Generate script draft');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model recovers downstream workflow when candidate selection is stale', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [],
    selectedCandidateIds: [],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [script],
    selectedScriptId: 'script-1',
    selectedScript: script,
    selectedRevision: null,
  }));

  assert.equal(model.stages.find((stage) => stage.id === 'discover').status, 'done');
  assert.equal(model.stages.find((stage) => stage.id === 'story').status, 'done');
  assert.equal(model.currentStage.id, 'review');
  assert.equal(model.primaryNextAction.label, 'Select script revision');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model uses selected script provenance over stale selected brief', () => {
  const scriptFromWarningBrief = { ...approvedScript, researchPacketId: 'brief-warning' };
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief, warningBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [scriptFromWarningBrief],
    selectedScriptId: 'script-1',
    selectedScript: scriptFromWarningBrief,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
  }));

  assert.equal(model.activeArtifacts.brief.id, 'brief-warning');
  assert.equal(model.primaryNextAction.label, 'Resolve research warnings');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model covers script ready with required integrity review', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [script],
    selectedScriptId: 'script-1',
    selectedScript: script,
    selectedRevision: missingReviewRevision,
    selectedRevisions: [missingReviewRevision],
  }));

  assert.equal(model.activeArtifacts.script.id, 'script-1');
  assert.equal(model.activeArtifacts.review.status, 'missing');
  assert.equal(model.currentStage.id, 'review');
  assert.equal(model.currentStage.status, 'needs-review');
  assert.equal(model.primaryNextAction.label, 'Run integrity review');
  assert.equal(model.primaryNextAction.enabled, true);
  assert.ok(model.blockers.some((blocker) => blocker.message.includes('Integrity review has not been run')));
});

test('view model keeps failed integrity review retry actionable', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [script],
    selectedScriptId: 'script-1',
    selectedScript: script,
    selectedRevision: failedReviewRevision,
    selectedRevisions: [failedReviewRevision],
  }));

  assert.equal(model.activeArtifacts.review.status, 'fail');
  assert.equal(model.currentStage.id, 'review');
  assert.equal(model.currentStage.status, 'needs-review');
  assert.equal(model.primaryNextAction.label, 'Rerun integrity review');
  assert.equal(model.primaryNextAction.enabled, true);
  assert.ok(model.blockers.some((blocker) => blocker.message.includes('Integrity review failed')));
});

test('view model covers audio produced with cover still active work', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode, assets: [audioAsset], jobs: [] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1'],
  }));

  assert.equal(model.activeArtifacts.audioCover.status, 'partial');
  assert.equal(model.latestArtifacts.audioCover.audio.id, 'asset-audio-1');
  assert.equal(model.latestArtifacts.audioCover.cover, null);
  assert.equal(model.currentStage.id, 'production');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Create missing cover art');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model treats publish approval as actionable when prerequisites are ready', () => {
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode, assets: [audioAsset, coverAsset], jobs: [] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  }));

  assert.equal(model.currentStage.id, 'publishing');
  assert.equal(model.currentStage.status, 'ready');
  assert.equal(model.primaryNextAction.label, 'Approve for publishing');
  assert.equal(model.primaryNextAction.enabled, true);
});

test('view model blocks publish approval until episode is audio-ready', () => {
  const draftEpisode = { ...episode, status: 'draft' };
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode: draftEpisode, assets: [audioAsset, coverAsset], jobs: [] },
    episodes: [draftEpisode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  }));

  assert.equal(model.primaryNextAction.label, 'Approve for publishing');
  assert.equal(model.primaryNextAction.enabled, false);
  assert.match(model.primaryNextAction.blockerReason, /audio-ready/);
});

test('view model covers publish blocked with concrete blocker reason', () => {
  const model = deriveProductionViewModel(baseInput({
    feeds: [],
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode, assets: [audioAsset, coverAsset], jobs: [] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  }));

  assert.equal(model.currentStage.id, 'publishing');
  assert.equal(model.currentStage.status, 'blocked');
  assert.equal(model.primaryNextAction.label, 'Approve for publishing');
  assert.equal(model.primaryNextAction.enabled, false);
  assert.match(model.primaryNextAction.blockerReason, /Feed metadata configured/);
  assert.ok(model.blockers.some((blocker) => blocker.stage === 'publishing'));
});

test('view model does not treat private local feed paths as publish targets', () => {
  const localPathFeed = {
    ...feed,
    rssFeedPath: '/private/demo.xml',
    publicFeedUrl: '',
    publicBaseUrl: '',
  };
  const model = deriveProductionViewModel(baseInput({
    feeds: [localPathFeed],
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode, assets: [audioAsset, coverAsset], jobs: [] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  }));

  assert.equal(model.currentStage.id, 'publishing');
  assert.equal(model.currentStage.status, 'blocked');
  assert.match(model.primaryNextAction.blockerReason, /RSS\/public target configured/);
  assert.ok(model.blockers.some((blocker) => blocker.stage === 'publishing' && blocker.message.includes('RSS/public target configured')));
});

test('view model accepts raw rss path with a public asset base as publish target without exposing the path', () => {
  const localPathFeed = {
    ...feed,
    rssFeedPath: '/private/demo.xml',
    publicFeedUrl: '',
    publicBaseUrl: 'https://podcasts.example.com/assets/',
  };
  const model = deriveProductionViewModel(baseInput({
    feeds: [localPathFeed],
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    production: { episode, assets: [audioAsset, coverAsset], jobs: [] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  }));

  assert.equal(model.currentStage.id, 'publishing');
  assert.equal(model.primaryNextAction.label, 'Approve for publishing');
  assert.equal(model.primaryNextAction.enabled, true);
  assert.equal(model.blockers.some((blocker) => blocker.message.includes('RSS/public target configured')), false);
});

test('view model deduplicates overlapping recent and production jobs', () => {
  const recentJob = {
    id: 'job-1',
    type: 'production.audio',
    status: 'running',
    createdAt: '2026-04-27T14:20:00.000Z',
    updatedAt: '2026-04-27T14:30:00.000Z',
    summary: { warnings: [{ message: 'Stale warning.' }] },
  };
  const duplicateJob = {
    ...recentJob,
    status: 'succeeded',
    updatedAt: '2026-04-27T14:45:00.000Z',
    summary: { warnings: [{ message: 'Preview asset needs review.' }] },
  };

  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [passedReviewRevision],
    recentJobs: [recentJob],
    production: { episode, assets: [audioAsset, coverAsset], jobs: [duplicateJob] },
    episodes: [episode],
    selectedEpisodeId: 'episode-1',
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
    latestActionResult: { status: '', message: '', source: 'test' },
  }));

  assert.equal(model.latestActionResult.job.id, 'job-1');
  assert.equal(model.latestActionResult.status, 'succeeded');
  assert.equal(model.warnings.filter((warning) => warning.message === 'Preview asset needs review.').length, 1);
  assert.equal(model.warnings.filter((warning) => warning.message === 'Stale warning.').length, 0);
});

test('view model keeps latest artifacts independent from active selection', () => {
  const olderBrief = { ...readyBrief, id: 'brief-old', title: 'Older brief', updatedAt: '2026-04-26T10:00:00.000Z' };
  const newestBrief = { ...readyBrief, id: 'brief-new', title: 'Newest brief', updatedAt: '2026-04-28T10:00:00.000Z' };
  const model = deriveProductionViewModel(baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [olderBrief, newestBrief],
    selectedResearchPacketId: 'brief-old',
  }));

  assert.equal(model.activeArtifacts.brief.id, 'brief-old');
  assert.equal(model.latestArtifacts.brief.id, 'brief-new');
});

test('view model separates active artifacts from historical artifacts', () => {
  const olderBrief = {
    ...readyBrief,
    id: 'brief-old',
    title: 'Older brief',
    createdAt: '2026-04-26T10:00:00.000Z',
    updatedAt: '2026-04-26T10:00:00.000Z',
  };
  const olderScript = {
    ...approvedScript,
    id: 'script-old',
    title: 'Older script',
    researchPacketId: 'brief-old',
    approvedRevisionId: 'revision-old',
    createdAt: '2026-04-26T11:00:00.000Z',
    updatedAt: '2026-04-26T11:00:00.000Z',
  };
  const olderRevision = {
    ...passedReviewRevision,
    id: 'revision-old',
    scriptId: 'script-old',
    createdAt: '2026-04-26T11:00:00.000Z',
    updatedAt: '2026-04-26T11:00:00.000Z',
  };
  const olderAudio = {
    ...audioAsset,
    id: 'asset-audio-old',
    createdAt: '2026-04-26T12:00:00.000Z',
    updatedAt: '2026-04-26T12:00:00.000Z',
  };
  const olderEpisode = {
    ...episode,
    id: 'episode-old',
    title: 'Older episode',
    slug: 'older-episode',
    status: 'published',
    createdAt: '2026-04-26T13:00:00.000Z',
    updatedAt: '2026-04-26T13:00:00.000Z',
    publishedAt: '2026-04-26T13:05:00.000Z',
  };

  const input = baseInput({
    storyCandidates: [candidate],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [olderBrief, readyBrief],
    selectedResearchPacketId: 'brief-1',
    scripts: [olderScript, approvedScript],
    selectedScriptId: 'script-1',
    selectedScript: approvedScript,
    selectedRevision: passedReviewRevision,
    selectedRevisions: [olderRevision, passedReviewRevision],
    production: { episode, assets: [olderAudio, audioAsset, coverAsset], jobs: [] },
    episodes: [olderEpisode, episode],
    selectedEpisodeId: 'episode-1',
  });
  const selectedModel = deriveProductionViewModel({
    ...input,
    selectedAssetIds: ['asset-audio-1', 'asset-cover-1'],
  });
  const defaultModel = deriveProductionViewModel(input);

  for (const model of [selectedModel, defaultModel]) {
    assert.equal(model.activeArtifacts.brief.id, 'brief-1');
    assert.equal(model.activeArtifacts.script.id, 'script-1');
    assert.equal(model.activeArtifacts.audioCover.audio.id, 'asset-audio-1');
    assert.deepEqual(model.historicalArtifacts.briefs.map((item) => item.id), ['brief-old']);
    assert.deepEqual(model.historicalArtifacts.scripts.map((item) => item.id), ['script-old']);
    assert.deepEqual(model.historicalArtifacts.reviews.map((item) => item.id), ['revision-old']);
    assert.deepEqual(model.historicalArtifacts.audioCover.map((item) => item.id), ['asset-audio-old']);
    assert.deepEqual(model.historicalArtifacts.publishing.map((item) => item.id), ['episode-old']);
    assert.equal(model.visibility.groups.history, true);
  }
});
