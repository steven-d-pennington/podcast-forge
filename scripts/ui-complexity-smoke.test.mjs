import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveProductionViewModel } from '../packages/api/public/ui-view-model.js';

const TRACKER_STAGES = [
  { id: 'show', label: 'Choose show' },
  { id: 'discover', label: 'Find story candidates' },
  { id: 'story', label: 'Pick / cluster story' },
  { id: 'brief', label: 'Build research brief' },
  { id: 'script', label: 'Generate script' },
  { id: 'review', label: 'Integrity review' },
  { id: 'production', label: 'Produce audio / cover' },
  { id: 'publishing', label: 'Approve and publish' },
];

const NORMAL_PRODUCE_COMPLEXITY_LIMITS = Object.freeze({
  stageCards: 8,
  maxExpandedStageCards: 1,
  maxCollapsedStageCards: 7,
  maxCommandBarControls: 3,
  maxStageTrackerControls: 8,
  maxVisibleControls: 10,
  maxElementNodes: 115,
});

const AMBIGUOUS_NORMAL_CONTROL_LABELS = [
  /\bOpen Stage Panel\b/i,
  /\bStage details\b/i,
  /\bDo action\b/i,
  /^\s*Next\s*$/i,
  /\bRun job\b/i,
  /\bProduction jobs\b/i,
  /\bPreview audio job\b/i,
  /\bCover art job\b/i,
  /\bBuild evidence brief\b/i,
];

function normalInitialProduceInput() {
  return {
    shows: [{
      id: 'show-1',
      slug: 'demo-show',
      title: 'Demo Show',
      setupStatus: 'active',
      format: 'daily-briefing',
      defaultRuntimeMinutes: 8,
    }],
    feeds: [],
    profiles: [{
      id: 'profile-1',
      slug: 'demo-sources',
      name: 'Demo Story Sources',
      type: 'brave',
      enabled: true,
      weight: 1,
      freshness: 'pd',
    }],
    queries: [{
      id: 'query-1',
      sourceProfileId: 'profile-1',
      query: 'AI policy',
      enabled: true,
      freshness: 'pd',
    }],
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
    latestActionResult: { status: 'idle', message: '', source: 'test' },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function trackerStageIdForViewModel(viewModel) {
  const stageId = viewModel?.currentStage?.id === 'source'
    ? 'show'
    : viewModel?.currentStage?.id;
  return TRACKER_STAGES.some((stage) => stage.id === stageId)
    ? stageId
    : TRACKER_STAGES[0].id;
}

function trackerStatus(stageId, viewModel) {
  if (stageId === 'show') {
    const show = viewModel.stages.find((stage) => stage.id === 'show');
    const source = viewModel.stages.find((stage) => stage.id === 'source');
    return show?.status === 'done' && source?.status === 'done'
      ? 'done'
      : source?.status || show?.status || 'blocked';
  }

  return viewModel.stages.find((stage) => stage.id === stageId)?.status || 'blocked';
}

function expandedStageControls(stageId, viewModel) {
  const controls = [];
  if (viewModel.primaryNextAction.targetStage === stageId) {
    controls.push(viewModel.primaryNextAction.label);
  } else if (stageId === 'show') {
    controls.push('Edit Show Settings');
  } else {
    controls.push(`Review ${TRACKER_STAGES.find((stage) => stage.id === stageId)?.label || 'current stage'}`);
  }

  return controls;
}

function renderNormalProduceSnapshot(viewModel) {
  const currentStageId = trackerStageIdForViewModel(viewModel);
  const header = viewModel.cockpitHeader;
  const episodeStory = header.currentEpisodeStory;
  const commandBarControls = [
    viewModel.primaryNextAction.label,
    'Review current stage',
  ];
  const labels = [
    'Produce Episode cockpit header',
    'Selected show',
    header.selectedShow?.title || 'No show selected',
    episodeStory.title,
    `Active stage ${header.activeStage.label} | ${header.activeStage.statusLabel}`,
    'Warnings',
    'Blockers',
    'Latest result',
    ...commandBarControls,
  ];

  const commandBarHtml = `
    <section id="productionCommandBar" class="production-command-bar production-cockpit-header" aria-label="Produce Episode cockpit header">
      <div class="command-bar-context">
        <span>Selected show</span>
        <h2>${escapeHtml(header.selectedShow?.title || 'No show selected')}</h2>
        <p><span>${escapeHtml(episodeStory.label)}</span><strong>${escapeHtml(episodeStory.title)}</strong></p>
      </div>
      <div class="command-bar-metrics">
        <div><span>Active stage</span><strong>${escapeHtml(header.activeStage.label)} | ${escapeHtml(header.activeStage.statusLabel)}</strong></div>
        <div><span>Blockers</span><strong>${header.blockerCount}</strong></div>
        <div><span>Warnings</span><strong>${header.warningCount}</strong></div>
      </div>
      <div class="command-bar-result" role="status"><span>${escapeHtml(header.latestResult.title)}</span><strong>${escapeHtml(header.latestResult.message)}</strong></div>
      <div class="command-bar-controls">
        ${commandBarControls.map((label) => `<button type="button">${escapeHtml(label)}</button>`).join('')}
      </div>
    </section>`;

  const sourceDisclosureOpen = Boolean(viewModel.contextDisclosures?.storySource?.defaultOpen);
  const sourceDisclosureHtml = `
    <details class="context-disclosure storySource${sourceDisclosureOpen ? ' prominent' : ''}"${sourceDisclosureOpen ? ' open' : ''}>
      <summary><span>${escapeHtml(viewModel.contextDisclosures.storySource.label)}</span><strong>${escapeHtml(viewModel.contextDisclosures.storySource.summary)}</strong></summary>
      <div class="context-disclosure-body">Story-source/search-recipe detail</div>
    </details>`;

  const stageCards = TRACKER_STAGES.map((stage, index) => {
    const expanded = stage.id === currentStageId;
    const controls = expanded ? expandedStageControls(stage.id, viewModel) : ['Expand stage'];
    const secondaryDisclosure = expanded ? ['More stage options'] : [];
    labels.push(stage.label, trackerStatus(stage.id, viewModel), ...controls, ...secondaryDisclosure);
    return {
      ...stage,
      number: index + 1,
      current: expanded,
      expanded,
      collapsed: !expanded,
      status: trackerStatus(stage.id, viewModel),
      controls,
      secondaryDisclosure,
    };
  });

  const stageHtml = `
    <div id="pipelineStages" class="pipeline-grid">
      ${stageCards.map((stage) => `
        <article class="pipeline-card ${stage.expanded ? 'expanded current' : 'collapsed'}" data-stage="${stage.number}" data-stage-id="${stage.id}" data-stage-status="${escapeHtml(stage.status)}">
          <div class="pipeline-top"><div><div>Stage ${stage.number}</div><h3>${escapeHtml(stage.label)}</h3></div><span>${escapeHtml(stage.status)}</span>${stage.current ? '<span>current</span>' : ''}</div>
          <div class="pipeline-summary"><p>${escapeHtml(stage.label)}</p><p>${stage.expanded ? 'Next step' : 'Collapsed until current'}</p></div>
          ${stage.expanded ? `<div class="pipeline-card-body">${stage.controls.map((label) => `<button type="button">${escapeHtml(label)}</button>`).join('')}<details><summary>More stage options</summary></details></div>` : `<button type="button" aria-expanded="false">Expand stage</button>`}
        </article>
      `).join('')}
    </div>`;

  const html = `${commandBarHtml}${sourceDisclosureHtml}${stageHtml}`;
  const commandBarControlCount = commandBarControls.length;
  const stageTrackerControlCount = stageCards.reduce((total, stage) => total + stage.controls.length, 0);
  const elementNodes = html.match(/<[a-z][a-z0-9-]*(?:\s|>)/gi)?.length ?? 0;

  return {
    html,
    labels,
    commandBarControls,
    stageCards,
    sourceDisclosureOpen,
    metrics: {
      commandBarControlCount,
      stageTrackerControlCount,
      visibleControlCount: commandBarControlCount + stageTrackerControlCount,
      elementNodes,
      stageCards: stageCards.length,
      expandedStageCards: stageCards.filter((stage) => stage.expanded).length,
      collapsedStageCards: stageCards.filter((stage) => stage.collapsed).length,
    },
  };
}

test('normal Produce view-model snapshot has command bar and one expanded current stage', () => {
  const viewModel = deriveProductionViewModel(normalInitialProduceInput());
  const snapshot = renderNormalProduceSnapshot(viewModel);
  const currentStage = snapshot.stageCards.find((stage) => stage.current);

  assert.equal(viewModel.currentStage.id, 'discover');
  assert.equal(viewModel.primaryNextAction.label, 'Search Brave');
  assert.match(snapshot.html, /id="productionCommandBar"/);
  assert.match(snapshot.html, /id="pipelineStages"/);
  assert.equal(snapshot.metrics.stageCards, NORMAL_PRODUCE_COMPLEXITY_LIMITS.stageCards);
  assert.equal(snapshot.metrics.expandedStageCards, 1);
  assert.equal(snapshot.sourceDisclosureOpen, true, 'source/search detail should default open while discovery is current');
  assert.equal(currentStage?.id, 'discover');
  assert.deepEqual(
    snapshot.stageCards.filter((stage) => stage.collapsed).map((stage) => stage.id),
    ['show', 'story', 'brief', 'script', 'review', 'production', 'publishing'],
  );
});

test('normal Produce workflow controls avoid ambiguous button soup copy', () => {
  const viewModel = deriveProductionViewModel(normalInitialProduceInput());
  const snapshot = renderNormalProduceSnapshot(viewModel);
  const controlLabels = [
    ...snapshot.commandBarControls,
    ...snapshot.stageCards.flatMap((stage) => stage.controls),
  ];

  assert.equal(snapshot.commandBarControls[0], viewModel.primaryNextAction.label, 'command bar should expose the view-model primary action');
  assert.match(snapshot.commandBarControls[0], /\bSearch\b/i, 'primary action should describe source discovery');
  assert.match(snapshot.commandBarControls[0], new RegExp(`\\b${viewModel.selectedStorySourceSummary.providerType}\\b`, 'i'));
  assert.equal(snapshot.commandBarControls.length, 2, 'command bar should keep controls focused');
  assert.ok(
    snapshot.stageCards.filter((stage) => stage.collapsed).every((stage) => stage.controls.length === 1),
    'collapsed stages should expose one disclosure control each',
  );
  assert.deepEqual(
    snapshot.stageCards.find((stage) => stage.current)?.controls,
    [viewModel.primaryNextAction.label],
    'current stage card should expose one primary button by default',
  );
  assert.deepEqual(
    snapshot.stageCards.find((stage) => stage.current)?.secondaryDisclosure,
    ['More stage options'],
    'current stage secondary controls should be disclosed instead of rendered as peer buttons',
  );

  for (const pattern of AMBIGUOUS_NORMAL_CONTROL_LABELS) {
    for (const label of controlLabels) {
      assert.doesNotMatch(label, pattern, `normal Produce control label should not include ${pattern}`);
    }
  }
});

test('non-discovery Produce states keep story-source detail collapsed by default', () => {
  const viewModel = deriveProductionViewModel({
    ...normalInitialProduceInput(),
    storyCandidates: [{
      id: 'candidate-1',
      title: 'Regulators publish new AI safety guidance',
      status: 'new',
      canonicalUrl: 'https://example.com/story',
    }],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [{
      id: 'brief-1',
      title: 'AI safety guidance brief',
      status: 'ready',
      warnings: [],
      citations: [{ url: 'https://example.com/story' }],
      content: { candidateIds: ['candidate-1'] },
      updatedAt: '2026-04-28T10:00:00.000Z',
    }],
    selectedResearchPacketId: 'brief-1',
  });
  const snapshot = renderNormalProduceSnapshot(viewModel);

  assert.equal(viewModel.currentStage.id, 'script');
  assert.equal(snapshot.sourceDisclosureOpen, false, 'source/search detail should be collapsed after discovery is no longer current');
  assert.match(snapshot.html, /Story-source details/);
});

test('normal Produce DOM/control complexity stays below the documented guardrail', () => {
  const viewModel = deriveProductionViewModel(normalInitialProduceInput());
  const { metrics } = renderNormalProduceSnapshot(viewModel);

  assert.ok(
    metrics.expandedStageCards <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxExpandedStageCards,
    `expanded stage cards ${metrics.expandedStageCards} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxExpandedStageCards}`,
  );
  assert.ok(
    metrics.collapsedStageCards <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxCollapsedStageCards,
    `collapsed stage cards ${metrics.collapsedStageCards} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxCollapsedStageCards}`,
  );
  assert.ok(
    metrics.commandBarControlCount <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxCommandBarControls,
    `command bar controls ${metrics.commandBarControlCount} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxCommandBarControls}`,
  );
  assert.ok(
    metrics.stageTrackerControlCount <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxStageTrackerControls,
    `stage tracker controls ${metrics.stageTrackerControlCount} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxStageTrackerControls}`,
  );
  assert.ok(
    metrics.visibleControlCount <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxVisibleControls,
    `visible controls ${metrics.visibleControlCount} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxVisibleControls}`,
  );
  assert.ok(
    metrics.elementNodes <= NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxElementNodes,
    `element nodes ${metrics.elementNodes} should stay <= ${NORMAL_PRODUCE_COMPLEXITY_LIMITS.maxElementNodes}`,
  );
});
