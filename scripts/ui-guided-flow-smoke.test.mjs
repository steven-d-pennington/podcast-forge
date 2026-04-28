import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { deriveProductionViewModel } from '../packages/api/public/ui-view-model.js';

const repoRoot = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, repoRoot), 'utf8');
}

const [indexHtml, uiJs, uiApiJs, uiStateJs, stylesCss, appTs] = await Promise.all([
  readProjectFile('packages/api/public/index.html'),
  readProjectFile('packages/api/public/ui.js'),
  readProjectFile('packages/api/public/ui-api.js'),
  readProjectFile('packages/api/public/ui-state.js'),
  readProjectFile('packages/api/public/styles.css'),
  readProjectFile('packages/api/src/app.ts'),
]);

function assertContains(source, expected, context) {
  assert.ok(source.includes(expected), `${context} should contain ${JSON.stringify(expected)}`);
}

function assertMatches(source, pattern, context) {
  assert.match(source, pattern, context);
}

function assertOrdered(source, patterns, context) {
  let cursor = -1;

  for (const pattern of patterns) {
    const match = pattern instanceof RegExp
      ? pattern.exec(source.slice(cursor + 1))
      : source.slice(cursor + 1).match(pattern);
    assert.ok(match, `${context} should contain ${pattern} after offset ${cursor}`);
    cursor += match.index + match[0].length;
  }
}

test('guided workflow shell stays primary on /ui', () => {
  assertContains(appTs, "app.get('/ui'", '/ui route');
  assertContains(indexHtml, 'Editorial Production Workflow', 'workflow panel');
  assertContains(indexHtml, 'data-surface-tab="workflow"', 'workflow surface tab');
  assertContains(indexHtml, 'Produce Episode', 'workflow surface tab label');
  assertContains(indexHtml, 'id="workflowPanel"', 'workflow panel');
  assertContains(indexHtml, 'id="pipelineStages"', 'pipeline stage container');
  assertContains(indexHtml, 'id="workflowContext"', 'workflow context');
  assertContains(indexHtml, 'id="productionCommandBar"', 'production command bar');
  assertContains(indexHtml, 'Production command bar', 'production command bar label');
  assertMatches(indexHtml, /8-stage journey/i, 'workflow should describe the 8-stage journey');

  assert.ok(
    indexHtml.indexOf('id="workflowPanel"') < indexHtml.indexOf('id="settingsPanel"'),
    'workflow panel should appear before settings/admin panels',
  );
  assertMatches(
    indexHtml,
    /<button class="surface-tab active" data-surface-tab="workflow"[^>]*aria-pressed="true"[^>]*>Produce Episode<\/button>/,
    'Produce Episode should be the active default surface in the static shell',
  );
});

test('editorial stage definitions remain intact and navigable', () => {
  assertContains(uiJs, 'function buildPipelineStages()', 'pipeline stage builder');
  assertOrdered(
    uiJs,
    [
      /title:\s*'Choose show'/,
      /title:\s*'Find story candidates'/,
      /title:\s*'Pick\s*\/\s*cluster story'/,
      /title:\s*'Build evidence brief'/,
      /title:\s*'Generate script'/,
      /title:\s*'Integrity review'/,
      /title:\s*'Produce audio\s*\/\s*cover'/,
      /title:\s*'Approve and publish'/,
    ],
    'pipeline stages',
  );

  const targetIdCount = uiJs.match(/\btargetId:/g)?.length ?? 0;
  assert.ok(targetIdCount >= 8, 'pipeline stages should keep panel target IDs for navigation');
  assertContains(uiJs, 'function stageCard(stage', 'stage card renderer');
  assertContains(uiJs, 'scrollToPanel(stage.targetId)', 'stage card panel navigation');
  assertContains(uiJs, 'function scrollToPanel(id)', 'panel scroll helper');
  assertContains(uiJs, "card.dataset.stage", 'stage cards should expose stage numbers');
});

test('stage tracker progressively discloses only the current stage by default', () => {
  assertContains(uiJs, 'function currentPipelineStageId(viewModel, stages)', 'current pipeline stage mapper');
  assertContains(uiJs, "viewModel?.currentStage?.id === 'source'", 'view-model source stage should map into the 8-stage tracker');
  assertContains(uiJs, 'function pipelineStageIsExpanded(stage, currentStageId)', 'stage expansion helper');
  assertContains(uiJs, 'stage.id === currentStageId || state.expandedPipelineStageIds.includes(stage.id)', 'current stage should be expanded by default');
  assertContains(uiJs, 'if (!expanded)', 'collapsed stage branch');
  assertContains(uiJs, "expandButton.textContent = 'Expand stage'", 'collapsed stages should expose an expand control');
  assertContains(uiJs, "collapseButton.textContent = 'Collapse stage'", 'expanded non-current stages should expose a collapse control');
  assertContains(uiJs, "card.className = `pipeline-card ${statusClass(statusLabel)}${expanded ? ' expanded' : ' collapsed'}${stage.id === currentStageId ? ' current' : ''}`", 'stage cards should mark collapsed/current state');
  assertContains(uiJs, "button.textContent = stage.actionLabel", 'existing stage action remains available when expanded');
  assertContains(uiJs, 'body.append(artifacts, next, button, actionReason)', 'expanded stage body keeps action context');
  assertContains(uiJs, 'els.pipelineStages.append(stageCard(stage, currentStageId))', 'render should pass the current stage into each card');
  assertContains(uiJs, "currentBadge.textContent = 'current'", 'current stage should be called out separately from status');
  assertContains(uiJs, "artifactLabel.textContent = 'Active/current artifact'", 'expanded stages should not call archived records latest active artifacts');
  assertContains(uiJs, 'function pruneExpandedPipelineStages(stages)', 'expanded stage state should be pruned during render');
  assertContains(uiJs, 'state.expandedPipelineStageIds = []', 'changing workflow context should reset expanded stage state');

  for (const status of ['not started', 'blocked', 'ready', 'complete', 'warning']) {
    assertContains(uiJs, `return '${status}'`, `stage tracker status ${status}`);
  }

  assertContains(stylesCss, '.pipeline-card.collapsed .pipeline-expand', 'collapsed tracker styles');
  assertContains(stylesCss, '.pipeline-card-body', 'expanded tracker body styles');
  assertContains(stylesCss, '.status-pill.current', 'current status style');
  assertContains(stylesCss, '.status-pill.complete', 'complete status style');
});

test('production command bar and concrete blocker copy remain present', () => {
  assertContains(uiJs, 'function renderProductionCommandBar(viewModel, stages)', 'production command bar renderer');
  assertContains(uiJs, 'viewModel.primaryNextAction', 'command bar primary action from view model');
  assertContains(uiJs, 'viewModel.latestActionResult', 'command bar latest result from view model');
  assertContains(uiJs, 'viewModel.warnings.length', 'command bar warning count from view model');
  assertContains(uiJs, 'action: legacyStage?.disabled ? null : legacyStage?.action || null', 'command bar primary action should invoke available stage actions');
  assertContains(uiJs, 'commandBarStatusLabel(viewModel.currentStage.status)', 'command bar stage status should stay aligned to the view model');
  assertContains(uiJs, 'openCommandBarPanel', 'command bar details should open hidden panels before scrolling');
  assertContains(uiJs, 'primary.disabled = actionBlocked', 'blocked command bar action disabled state');
  assertContains(uiJs, "viewModel.activeArtifacts?.publishing?.title", 'command bar published episode fallback');
  assertContains(uiJs, 'No active episode yet', 'command bar active episode fallback');
  assertContains(uiJs, "dataset.commandControl", 'command bar focus restoration control marker');
  assertContains(uiJs, 'Latest failure', 'command bar failure summary label');
  assertContains(uiJs, 'Stage details', 'command bar stage details button');
  assertContains(uiJs, 'function checklistBlockers(checklist', 'checklist blocker helper');
  assertContains(uiJs, 'command-bar-blocker', 'command bar blocker summary');
  assertContains(uiJs, 'artifactScopeWarnings', 'view model archive warnings should render in workflow context');
  assertContains(uiJs, 'History/archive records remain available for audit, but production and publishing actions use active/current artifacts only.', 'workflow should explain active versus archive state');
  assert.doesNotMatch(uiJs, /latestArtifacts\?\.publishing\?\.title/, 'command bar must not present archived/latest episodes as active production context');

  for (const checklistItem of [
    'Research brief approved',
    'Script approved for audio',
    'Integrity review passed or overridden',
    'Valid audio asset exists',
    'Cover art asset exists',
    'Feed metadata configured',
    'RSS/public target configured',
    'No blocking warnings remain',
    'Episode approved for publishing',
  ]) {
    assertContains(uiJs, checklistItem, `publish checklist item ${checklistItem}`);
  }

  for (const reason of [
    'Approve the research brief after review.',
    'Approve the selected script revision.',
    'Run the integrity reviewer before production.',
    'Create cover art before publishing.',
    'Configure a feed for this show.',
    'Approve audio and cover assets for publishing.',
  ]) {
    assertContains(uiJs, reason, `blocker reason ${reason}`);
  }
});

test('production command bar view-model fixtures expose primary action and blocker state', () => {
  const show = {
    id: 'show-1',
    slug: 'demo-show',
    title: 'Demo Show',
  };
  const query = {
    id: 'query-1',
    sourceProfileId: 'profile-1',
    query: 'AI policy',
    enabled: true,
  };
  const readyModel = deriveProductionViewModel({
    shows: [show],
    feeds: [],
    profiles: [{ id: 'profile-1', slug: 'demo-sources', name: 'Demo Story Sources', type: 'brave', enabled: true }],
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
    latestActionResult: { status: 'succeeded', message: 'Source search complete: 3 inserted, 0 skipped.', source: 'test' },
  });

  assert.equal(readyModel.currentStage.label, 'Find story candidates');
  assert.equal(readyModel.primaryNextAction.label, 'Run source search');
  assert.equal(readyModel.primaryNextAction.enabled, true);
  assert.equal(readyModel.latestActionResult.message, 'Source search complete: 3 inserted, 0 skipped.');

  const blockedModel = deriveProductionViewModel({
    shows: [show],
    feeds: [],
    profiles: [{ id: 'profile-2', slug: 'archive', name: 'Archive Import', type: 'local-json', enabled: true }],
    queries: [],
    storyCandidates: [],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    recentJobs: [],
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-2',
  });

  assert.equal(blockedModel.primaryNextAction.label, 'Run source search');
  assert.equal(blockedModel.primaryNextAction.enabled, false);
  assert.equal(blockedModel.primaryNextAction.blockerReason, 'Choose a browser-supported story source before discovery.');
});

test('workflow, settings, and debug surfaces stay separated', () => {
  for (const [surface, label] of [
    ['workflow', 'Produce Episode'],
    ['settings', 'Settings / Admin'],
    ['debug', 'Jobs / Debug'],
  ]) {
    assertContains(indexHtml, `data-surface-tab="${surface}"`, `${label} surface tab`);
    assertContains(indexHtml, label, `${label} surface label`);
  }

  assertContains(indexHtml, 'data-surface="workflow"', 'workflow surface panels');
  assertContains(indexHtml, 'data-surface="settings"', 'settings surface panels');
  assertContains(indexHtml, 'data-surface="debug"', 'debug surface panels');
  assertContains(uiStateJs, "activeSurface: 'workflow'", 'workflow default active surface');
  assertContains(uiJs, 'function setActiveSurface(surface)', 'surface switcher');
  assertContains(uiJs, 'function renderSurfaceVisibility()', 'surface visibility renderer');
  assertContains(uiJs, 'SURFACES.has(surface)', 'surface allowlist');
});

test('integrity, source coverage, and confirmation safety affordances remain present', () => {
  assertOrdered(
    uiJs,
    [
      /title:\s*'Generate script'/,
      /title:\s*'Integrity review'/,
      /title:\s*'Produce audio\s*\/\s*cover'/,
    ],
    'integrity review should remain between script generation and production',
  );
  assertContains(uiJs, 'runSelectedIntegrityReview', 'integrity review action');
  assertContains(uiJs, 'integrityReviewState', 'integrity review state helper');
  assertContains(uiJs, 'Claim/source coverage', 'claim/source coverage panel heading');
  assertContains(uiJs, 'coverageStatusLabel', 'coverage status label helper');
  assertContains(uiJs, 'Blocking coverage findings', 'coverage blocker list');
  assertContains(uiJs, 'openConfirmationDialog', 'explicit confirmation dialog helper');
  assertContains(stylesCss, '.confirmation-overlay', 'confirmation overlay styles');
  assertContains(stylesCss, '.confirmation-dialog', 'confirmation dialog styles');
  assert.doesNotMatch(uiJs, /window\.prompt\b/, 'ui.js must not use window.prompt for critical actions');
});

test('active artifacts and archive labels are guarded in static UI modules', () => {
  assertContains(uiJs, 'function artifactScope(kind, id)', 'artifact scope helper');
  assertContains(uiJs, 'Active/current', 'active artifact label');
  assertContains(uiJs, 'History/archive', 'archive artifact label');
  assertContains(uiJs, 'Not part of current production', 'archive warning label');
  assertContains(uiJs, 'activeSelectedScript', 'script actions should use active script state');
  assertContains(uiJs, 'currentProductionViewModel().activeArtifacts?.audioCover', 'asset selection should come from active view-model state');
  assertContains(stylesCss, '.artifact-scope-panel.warning', 'mixed artifact warning style');
  assertContains(stylesCss, '.scope-pill.archive', 'archive pill style');
  assertContains(stylesCss, '.active-artifact', 'active artifact row style');
  assertContains(stylesCss, '.archive-artifact', 'archive artifact row style');
});

test('api helper does not mark empty POSTs as JSON bodies', () => {
  assertContains(uiApiJs, 'export async function api(path, options = {})', 'api helper export');
  assert.doesNotMatch(
    uiApiJs,
    /headers:\s*\{\s*['\"]content-type['\"]:\s*['\"]application\/json['\"]/,
    'api helper should not set JSON content-type unless a request body is present',
  );
});

test('mobile workflow layout affordances are guarded', () => {
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)/, 'mobile breakpoint');
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.production-command-bar,[\s\S]*\.workflow-context,[\s\S]*\.pipeline-grid,[\s\S]*grid-template-columns:\s*1fr/, 'workflow areas stack on mobile');
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.surface-nav,[\s\S]*\.surface-tab,[\s\S]*width:\s*100%/, 'surface tabs become full-width on mobile');
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.confirmation-actions,[\s\S]*\.confirmation-overlay[\s\S]*\.confirmation-dialog/, 'confirmation UI has mobile rules');
});
