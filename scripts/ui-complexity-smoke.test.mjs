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
  maxStageTrackerControls: 12,
  maxVisibleControls: 15,
  maxElementNodes: 110,
});

const AMBIGUOUS_NORMAL_WORKFLOW_LABELS = [
  /\bOpen Stage Panel\b/i,
  /\bStage details\b/i,
  /\bDo action\b/i,
  /\bNext\b/i,
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

  controls.push(stageId === 'discover' ? 'Edit story source settings' : `Review ${TRACKER_STAGES.find((stage) => stage.id === stageId)?.label || 'stage'}`);

  if (['discover', 'brief', 'script', 'production', 'publishing'].includes(stageId)) {
    controls.push('View Latest Run');
  }

  return controls;
}

function renderNormalProduceSnapshot(viewModel) {
  const currentStageId = trackerStageIdForViewModel(viewModel);
  const commandBarControls = [
    viewModel.primaryNextAction.label,
    'Review current stage',
  ];
  const labels = [
    'Production command bar',
    'Producing',
    viewModel.selectedShowSummary?.title || 'No show selected',
    viewModel.activeArtifacts?.publishing?.title || 'No active episode yet',
    `Stage ${viewModel.currentStage.label} | ${viewModel.currentStage.status}`,
    'Story source',
    'Warnings',
    'Blockers',
    'Latest result',
    ...commandBarControls,
  ];

  const commandBarHtml = `
    <section id="productionCommandBar" class="production-command-bar" aria-label="Production command bar">
      <div class="command-bar-context">
        <span>Producing</span>
        <h2>${escapeHtml(viewModel.selectedShowSummary?.title || 'No show selected')}</h2>
        <p>${escapeHtml(viewModel.activeArtifacts?.publishing?.title || 'No active episode yet')}</p>
      </div>
      <div class="command-bar-metrics">
        <div><span>Stage</span><strong>${escapeHtml(viewModel.currentStage.label)} | ${escapeHtml(viewModel.currentStage.status)}</strong></div>
        <div><span>Story source</span><strong>${escapeHtml(viewModel.selectedStorySourceSummary?.providerType || 'Choose source')}</strong></div>
        <div><span>Warnings</span><strong>${viewModel.warnings.length}</strong></div>
        <div><span>Blockers</span><strong>${viewModel.blockers.length}</strong></div>
      </div>
      <div class="command-bar-result" role="status"><span>Latest result</span><strong>${escapeHtml(viewModel.latestActionResult.conciseMessage || viewModel.latestActionResult.message || 'No action result recorded yet.')}</strong></div>
      <div class="command-bar-controls">
        ${commandBarControls.map((label) => `<button type="button">${escapeHtml(label)}</button>`).join('')}
      </div>
    </section>`;

  const stageCards = TRACKER_STAGES.map((stage, index) => {
    const expanded = stage.id === currentStageId;
    const controls = expanded ? expandedStageControls(stage.id, viewModel) : ['Expand stage'];
    labels.push(stage.label, trackerStatus(stage.id, viewModel), ...controls);
    return {
      ...stage,
      number: index + 1,
      current: expanded,
      expanded,
      collapsed: !expanded,
      status: trackerStatus(stage.id, viewModel),
      controls,
    };
  });

  const stageHtml = `
    <div id="pipelineStages" class="pipeline-grid">
      ${stageCards.map((stage) => `
        <article class="pipeline-card ${stage.expanded ? 'expanded current' : 'collapsed'}" data-stage="${stage.number}" data-stage-id="${stage.id}" data-stage-status="${escapeHtml(stage.status)}">
          <div class="pipeline-top"><div><div>Stage ${stage.number}</div><h3>${escapeHtml(stage.label)}</h3></div><span>${escapeHtml(stage.status)}</span>${stage.current ? '<span>current</span>' : ''}</div>
          <div class="pipeline-summary"><p>${escapeHtml(stage.label)}</p><p>${stage.expanded ? 'Next step' : 'Collapsed until current'}</p></div>
          ${stage.expanded ? `<div class="pipeline-card-body">${stage.controls.map((label) => `<button type="button">${escapeHtml(label)}</button>`).join('')}</div>` : `<button type="button" aria-expanded="false">Expand stage</button>`}
        </article>
      `).join('')}
    </div>`;

  const html = `${commandBarHtml}${stageHtml}`;
  const commandBarControlCount = commandBarControls.length;
  const stageTrackerControlCount = stageCards.reduce((total, stage) => total + stage.controls.length, 0);
  const elementNodes = html.match(/<[a-z][a-z0-9-]*(?:\s|>)/gi)?.length ?? 0;

  return {
    html,
    labels,
    commandBarControls,
    stageCards,
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
  assert.equal(currentStage?.id, 'discover');
  assert.deepEqual(
    snapshot.stageCards.filter((stage) => stage.collapsed).map((stage) => stage.id),
    ['show', 'story', 'brief', 'script', 'review', 'production', 'publishing'],
  );
});

test('normal Produce workflow labels avoid ambiguous button soup copy', () => {
  const viewModel = deriveProductionViewModel(normalInitialProduceInput());
  const snapshot = renderNormalProduceSnapshot(viewModel);
  const visibleText = snapshot.labels.join('\n');

  assert.ok(snapshot.labels.includes('Search Brave'), 'primary action should name the concrete source adapter action');
  assert.ok(snapshot.labels.includes('Review current stage'), 'command bar details should use current-stage language');
  assert.ok(snapshot.labels.includes('Expand stage'), 'collapsed stages should expose a named disclosure control');

  for (const pattern of AMBIGUOUS_NORMAL_WORKFLOW_LABELS) {
    assert.doesNotMatch(visibleText, pattern, `normal Produce labels should not include ${pattern}`);
  }
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
