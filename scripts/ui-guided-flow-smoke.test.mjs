import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { trustStatusVocabulary } from '../packages/api/public/ui-formatters.js';
import { deriveProductionViewModel } from '../packages/api/public/ui-view-model.js';

const repoRoot = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, repoRoot), 'utf8');
}

const [indexHtml, uiJs, uiApiJs, uiStateJs, uiViewModelJs, stylesCss, appTs] = await Promise.all([
  readProjectFile('packages/api/public/index.html'),
  readProjectFile('packages/api/public/ui.js'),
  readProjectFile('packages/api/public/ui-api.js'),
  readProjectFile('packages/api/public/ui-state.js'),
  readProjectFile('packages/api/public/ui-view-model.js'),
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
  assertContains(indexHtml, 'Produce Episode cockpit header', 'production cockpit header label');
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


test('candidate list exposes non-mutating filters for date and quality triage', () => {
  for (const id of [
    'candidateFilterSummary',
    'candidatePublishedFilter',
    'candidateStatusFilter',
    'candidateQualityFilter',
    'candidateSourceFilter',
    'candidateDomainFilter',
    'clearCandidateFilters',
  ]) {
    assertContains(indexHtml, `id="${id}"`, `candidate filter control ${id}`);
    assertContains(uiStateJs, `document.querySelector('#${id}')`, `candidate filter state binding ${id}`);
  }

  for (const label of [
    'Missing published date',
    'Has published date',
    'High confidence (70+)',
    'Needs review / fallback',
    'Source/provider',
    'Domain or title contains',
  ]) {
    assertContains(indexHtml, label, `candidate filter label ${label}`);
  }

  assertContains(uiStateJs, "candidateFilters: {", 'candidate filter state');
  assertContains(uiJs, 'function candidateMatchesFilters(candidate)', 'candidate filter predicate');
  assertContains(uiJs, "filters.published === 'missing-date'", 'missing published date filter');
  assertContains(uiJs, "filters.published === 'has-date'", 'has published date filter');
  assertContains(uiJs, "candidate.score >= 70", 'high confidence filter threshold');
  assertContains(uiJs, 'candidateHasFallbackScore(candidate)', 'fallback score filter handling');
  assertContains(uiJs, 'Showing ${filteredCandidates.length} of ${visibleTotal}', 'filtered count copy');
  assertContains(uiJs, 'published date: missing', 'candidate missing date chip');
  assertContains(uiJs, 'published date: present', 'candidate present date chip');
  assertContains(uiJs, 'state.selectedCandidateIds = state.selectedCandidateIds.filter', 'filters should prune hidden selected candidates without mutating rows');
  assertContains(uiJs, 'integrityReviewPassed', 'candidate filters should not bypass downstream approval gates');
  assertContains(stylesCss, '.candidate-filter-panel', 'candidate filter panel styles');
  assertContains(stylesCss, '.candidate-filter-grid', 'candidate filter grid styles');
});

test('candidate list renders as a compact editorial review queue', () => {
  for (const expected of [
    'editorial-queue-row',
    'Top recommendation',
    'quality: ${quality.label}',
    'qualityChip.title = quality.detail',
    "qualityChip.setAttribute('aria-label'",
    'source confidence unknown',
    'provider freshness requested:',
    'selected for research brief',
    'Unselect from Brief',
    'Details and AI analysis',
    'AI analysis',
  ]) {
    assertContains(uiJs, expected, `candidate queue renderer ${expected}`);
  }

  assertContains(uiJs, 'const statusWarnings = candidateStatusWarnings(candidate)', 'candidate warnings should be computed once per row');
  assertContains(uiJs, 'for (const warning of statusWarnings)', 'candidate warning chips should reuse computed warnings');
  assertContains(uiJs, 'function rankedCandidateList(candidates)', 'candidate queue should rank without mutating source rows');
  assertContains(uiJs, 'function candidateFreshnessInfo(candidate)', 'candidate queue should separate date and freshness metadata');
  assertContains(uiJs, 'article date ${formatTime(candidate.publishedAt)}', 'candidate published date should be article-specific');
  assertContains(uiJs, 'provider requested ${info.requested}', 'freshness request should not be merged into the article date chip');
  assertContains(stylesCss, '.candidate-rank.recommended', 'candidate queue top recommendation styling');
  assertContains(stylesCss, '.candidate-chip.provider-freshness', 'candidate queue freshness-request chip styling');
  assertContains(stylesCss, '.candidate-detail-block.ai-analysis', 'candidate AI analysis detail styling');
});

test('trust status vocabulary is explicit and reused across produce surfaces', () => {
  assert.equal(trustStatusVocabulary('aiOutput').label, 'AI output');
  assert.equal(trustStatusVocabulary('sourceEvidence').label, 'Source evidence');
  assert.equal(trustStatusVocabulary('reviewDecision').label, 'Review decision');
  assert.equal(trustStatusVocabulary('unresolvedWarning').label, 'Unresolved warning');
  assert.equal(trustStatusVocabulary('blocker').label, 'Blocker');
  assert.equal(trustStatusVocabulary('auditDetail').label, 'Audit detail');
  assert.equal(trustStatusVocabulary('missing-kind').label, 'Status');

  for (const expected of [
    'function trustBadge(kind',
    'function trustPanel(kind',
    'function reviewTrustSummary(items)',
    "appendTrustBadge(sourceHeading, 'sourceEvidence')",
    "appendTrustBadge(aiHeading, 'aiOutput')",
    "appendTrustBadge(summaryHeading, 'auditDetail')",
    'Unresolved warning',
    'Blocker',
    'Source evidence:',
    'Review decision:',
    'AI integrity review issues',
    'Review decision: integrity override',
    'Audit detail: revision history',
    'Source evidence: citation map and provenance warnings',
    'Audit detail: asset metadata',
    'Unresolved warnings and failures',
    'Audit detail: metadata and debug details',
    "mark.textContent = item.passed ? 'Ready' : 'Blocker'",
  ]) {
    assertContains(uiJs, expected, `trust vocabulary UI marker ${expected}`);
  }

  for (const expected of [
    '.trust-badge.ai-output',
    '.trust-badge.source-evidence',
    '.trust-badge.review-decision',
    '.trust-badge.unresolved-warning',
    '.trust-badge.blocker',
    '.trust-badge.audit-detail',
    '.trust-panel.blocker',
    '.trust-summary',
  ]) {
    assertContains(stylesCss, expected, `trust vocabulary style ${expected}`);
  }

  for (const expected of [
    "trustKind: 'sourceEvidence'",
    "trustKind: 'aiOutput'",
    "trustKind: integrity.override ? 'reviewDecision' : 'aiOutput'",
    "blockerTrustKind: integrity.blocking ? 'blocker' : null",
    "warningTrustKind: warnings.some((warning) => !warning.override) ? 'unresolvedWarning' : null",
  ]) {
    assertContains(uiViewModelJs, expected, `trust vocabulary view-model marker ${expected}`);
  }
});

test('editorial stage definitions remain intact and navigable', () => {
  assertContains(uiJs, 'function buildPipelineStages()', 'pipeline stage builder');
  assertOrdered(
    uiJs,
    [
      /title:\s*'Choose show'/,
      /title:\s*'Find story candidates'/,
      /title:\s*'Pick\s*\/\s*cluster story'/,
      /title:\s*'Build research brief'/,
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
  assertContains(uiJs, "card.setAttribute('aria-labelledby', titleId)", 'stage cards should connect article labels to headings');
});

test('stage tracker progressively discloses only the current stage by default', () => {
  assertContains(uiJs, 'function currentPipelineStageId(viewModel, stages)', 'current pipeline stage mapper');
  assertContains(uiJs, "viewModel?.currentStage?.id === 'source'", 'view-model source stage should map into the 8-stage tracker');
  assertContains(uiJs, 'function pipelineStageIsExpanded(stage, currentStageId)', 'stage expansion helper');
  assertContains(uiJs, 'stage.id === currentStageId || state.expandedPipelineStageIds.includes(stage.id)', 'current stage should be expanded by default');
  assertContains(uiJs, 'if (!expanded)', 'collapsed stage branch');
  assertContains(uiJs, "expandButton.textContent = 'Expand stage'", 'collapsed stages should expose an expand control');
  assertContains(uiJs, "expandButton.setAttribute('aria-controls', bodyId)", 'collapsed stage disclosure should name the controlled region');
  assertContains(uiJs, "collapseButton.textContent = 'Collapse stage'", 'expanded non-current stages should expose a collapse control');
  assertContains(uiJs, "collapseButton.setAttribute('aria-controls', bodyId)", 'expanded stage disclosure should name the controlled region');
  assertContains(uiJs, "status.setAttribute('aria-label', `Status: ${statusLabel}`)", 'stage status pills should expose explicit status labels');
  assertContains(uiJs, "card.className = `pipeline-card ${statusClass(statusLabel)}${expanded ? ' expanded' : ' collapsed'}${stage.id === currentStageId ? ' current' : ''}`", 'stage cards should mark collapsed/current state');
  assertContains(uiJs, "button.textContent = stage.actionLabel", 'existing stage action remains available when expanded');
  assertContains(uiJs, "button.className = stage.id === currentStageId || stage.primary ? 'pipeline-primary-action' : 'secondary'", 'current stage action should be visually primary');
  assertContains(uiJs, 'body.append(artifacts, next, button, actionReason)', 'expanded stage body keeps action context');
  assertContains(uiJs, "secondarySummary.textContent = 'More stage options'", 'secondary stage controls should be disclosed behind one affordance');
  assertContains(uiJs, "secondaryDisclosure.className = 'pipeline-secondary-actions'", 'stage secondary actions should use subordinate disclosure styling');
  assertContains(uiJs, 'els.pipelineStages.append(stageCard(stage, currentStageId))', 'render should pass the current stage into each card');
  assertContains(uiJs, "currentBadge.textContent = 'current'", 'current stage should be called out separately from status');
  assertContains(uiJs, "artifactLabel.textContent = 'Active/current artifact'", 'expanded stages should not call archived records latest active artifacts');
  assertContains(uiJs, 'function pruneExpandedPipelineStages(stages)', 'expanded stage state should be pruned during render');
  assertContains(uiJs, 'function syncCurrentPipelineStage(currentStageId)', 'current stage changes should reset manual expansions');
  assertContains(uiJs, 'state.expandedPipelineStageIds = []', 'changing workflow context should reset expanded stage state');
  assertContains(uiJs, 'state.contextDisclosureOpen = {}', 'changing current stage should restore focused disclosure defaults');

  for (const status of ['not started', 'blocked', 'ready', 'complete', 'warning']) {
    assertContains(uiJs, `return '${status}'`, `stage tracker status ${status}`);
  }

  assertContains(stylesCss, '.pipeline-card.collapsed .pipeline-expand', 'collapsed tracker styles');
  assertContains(stylesCss, '.pipeline-card-body', 'expanded tracker body styles');
  assertContains(stylesCss, '.pipeline-secondary-actions', 'secondary stage action disclosure styles');
  assertContains(stylesCss, '.pipeline-card .pipeline-primary-action', 'current stage primary action style');
  assertContains(stylesCss, '.status-pill.current', 'current status style');
  assertContains(stylesCss, '.status-pill.complete', 'complete status style');
});

test('production command bar and concrete blocker copy remain present', () => {
  assertContains(indexHtml, 'Produce Episode cockpit header', 'cockpit header label');
  assertContains(indexHtml, 'production-cockpit-header', 'cockpit header class');
  assertContains(uiJs, 'function renderProductionCommandBar(viewModel, stages)', 'production command bar renderer');
  assertContains(uiJs, 'viewModel.cockpitHeader', 'command bar should render cockpit header view model');
  assertContains(uiJs, 'viewModel.primaryNextAction', 'command bar primary action from view model');
  assertContains(uiJs, 'viewModel.latestActionResult', 'command bar latest result from view model');
  assertContains(uiJs, 'viewModel.workflowActionFeedback', 'command bar workflow feedback from view model');
  assertContains(uiJs, "feedback.status === 'idle'", 'idle workflow feedback should not render as a persistent panel');
  assertContains(uiJs, 'viewModel.warnings.length', 'command bar warning count from view model');
  assertContains(uiJs, 'action: legacyStage?.disabled ? null : legacyStage?.action || null', 'command bar primary action should invoke available stage actions');
  assertContains(uiJs, "appendCommandBarMetric(metrics, 'Active stage'", 'cockpit header should show active stage');
  assertContains(uiJs, "appendCommandBarMetric(metrics, 'Blockers'", 'cockpit header should show blocker count');
  assertContains(uiJs, "appendCommandBarMetric(metrics, 'Warnings'", 'cockpit header should show warning count');
  assertContains(uiJs, 'openCommandBarPanel', 'command bar details should open hidden panels before scrolling');
  assertContains(uiJs, 'primary.disabled = actionBlocked', 'blocked command bar action disabled state');
  assertContains(uiJs, "primary.setAttribute('aria-disabled', actionBlocked ? 'true' : 'false')", 'blocked command bar action disabled semantics');
  assertContains(uiJs, 'action.disabledReason', 'blocked command bar action should explain disabled reason');
  assertContains(uiJs, "viewModel.activeArtifacts?.publishing?.title", 'command bar published episode fallback');
  assertContains(uiJs, 'No active episode or story yet', 'command bar active episode/story fallback');
  assertContains(uiJs, 'command-bar-story', 'cockpit header should show current episode or story');
  assertContains(uiJs, "dataset.commandControl", 'command bar focus restoration control marker');
  assertContains(uiJs, 'Latest failure', 'command bar failure summary label');
  assertContains(uiJs, 'Review current stage', 'command bar stage details button');
  assertContains(uiJs, 'function renderWorkflowFeedbackPanel(feedback', 'workflow feedback panel renderer');
  assertContains(uiJs, 'function renderWorkflowFeedbackDisclosure(viewModel)', 'workflow feedback should be behind contextual disclosure outside the command bar');
  assertContains(uiJs, 'function attachWorkflowFeedback(stages, viewModel, currentStageId)', 'stage feedback attachment helper');
  assertContains(uiJs, "label.textContent = compact ? 'Current stage result' : 'Action result'", 'current stage result label');
  assertContains(uiJs, 'workflowFeedbackDetailText(feedback)', 'feedback details keep warning/debug data available');
  assertContains(stylesCss, '.workflow-feedback-panel.warning', 'workflow feedback warning style');
  assertContains(stylesCss, '.workflow-feedback-panel.blocked', 'workflow feedback blocked style');
  assertContains(stylesCss, '.workflow-feedback-details pre', 'workflow feedback detail style');
  assertContains(stylesCss, '.command-bar-story-detail', 'cockpit header story detail styles');
  assertContains(uiJs, 'function checklistBlockers(checklist', 'checklist blocker helper');
  assertContains(uiJs, 'command-bar-blocker', 'command bar blocker summary');
  assertContains(uiJs, 'function renderAuditHistoryDisclosure(viewModel)', 'archive warnings should render behind an audit/history disclosure');
  assertContains(uiJs, 'function renderStorySourceDisclosure(viewModel)', 'story source detail should render through contextual disclosure');
  assertContains(uiJs, 'viewModel.contextDisclosures?.storySource', 'story source disclosure should be view-model driven');
  assertContains(uiJs, "summaryLabel.textContent = 'Audit/history'", 'audit/history disclosure should be explicitly labeled');
  assertContains(uiStateJs, 'auditHistoryOpen: false', 'audit/history disclosure state should be tracked across renders');
  assertContains(uiStateJs, 'contextDisclosureOpen: {}', 'context disclosures should be tracked across renders');
  assertContains(uiJs, 'details.open = Boolean(state.auditHistoryOpen)', 'audit/history disclosure should restore its open state');
  assertContains(uiJs, 'state.auditHistoryOpen = details.open', 'audit/history disclosure should persist user toggles');
  assertContains(uiViewModelJs, 'function deriveContextDisclosures', 'Produce context disclosure policy should live in the view model');
  assertContains(uiViewModelJs, "defaultOpen: sourceDiscoveryIsCurrent", 'source/search details should default open only while source discovery is current');
  assertContains(uiViewModelJs, "defaultOpen: false", 'task result disclosure should stay closed by default');
  assertContains(uiJs, 'artifactScopeWarnings', 'view model archive warnings should stay accessible for audit');
  assertContains(uiJs, 'History/archive records remain available for audit, but production and publishing actions use active/current artifacts only.', 'workflow should explain active versus archive state');
  assertContains(stylesCss, '.audit-history-disclosure', 'audit/history disclosure styles');
  assertContains(stylesCss, '.context-disclosure', 'contextual disclosure styles');
  assertContains(uiJs, 'const researchPacketId = selectedResearchPacket()?.id', 'script generation should use active/current research packet selection');
  assert.doesNotMatch(uiJs, /const researchPacketId = state\.selectedResearchPacketId/, 'script generation must not post archived saved packet ids');
  assert.doesNotMatch(uiJs, /latestArtifacts\?\.publishing\?\.title/, 'command bar must not present archived/latest episodes as active production context');

  for (const checklistItem of [
    'Research brief approved',
    'Script approved for audio',
    'Integrity review passed or overridden',
    'Publishable final audio asset exists',
    'Cover art asset exists',
    'Feed metadata configured',
    'RSS/public target configured',
    'No review-blocking warnings remain',
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

test('produce workflow labels and live regions stay concrete and accessible', () => {
  assertContains(indexHtml, 'id="status" role="status" aria-live="polite" aria-atomic="true"', 'global status live region');
  assertContains(indexHtml, '<main class="layout" aria-label="Podcast production workspace">', 'main workspace landmark');
  assertContains(indexHtml, '<aside class="sidebar" aria-labelledby="workspaceSidebarTitle">', 'sidebar landmark label');
  assertContains(indexHtml, '<h2 id="workspaceSidebarTitle">Story Sources</h2>', 'sidebar heading');

  for (const label of [
    'Review story candidates',
    'Build research brief',
    'Generate script',
    'Review integrity gate',
    'Create final audio and cover assets',
    'Review publish checklist',
  ]) {
    assertContains(uiJs, label, `concrete stage panel label ${label}`);
  }

  for (const label of [
    'Edit Show Settings',
    'Create New Show',
    'Review Script Draft',
    'Select Script Draft',
    'Review Approval Gates',
    'Refresh Final Audio and Cover Assets',
    'Create Missing Final Audio and Cover',
    'Approve Episode for Publishing',
  ]) {
    assertContains(uiJs, label, `concrete workflow action label ${label}`);
  }

  assertContains(uiJs, "feedback.setAttribute('role', 'status')", 'command bar result live status role');
  assertContains(uiJs, "panel.setAttribute('role', 'status')", 'workflow feedback live status role');
  assertContains(uiJs, 'if (stage.disabled)', 'stage action reason is scoped to disabled actions');
  assertContains(uiJs, "button.setAttribute('aria-describedby', actionReasonId)", 'stage action blocked reason link');
  assertContains(uiJs, "const jobReasonId = `pipeline-run-reason-${stage.id}`", 'disabled run control dedicated reason id');
  assertContains(uiJs, 'jobButton.title = jobReason.textContent', 'disabled run control reason');

  assert.doesNotMatch(uiJs, /Open Stage Panel/, 'normal Produce mode should not expose ambiguous stage panel labels');
  assert.doesNotMatch(uiJs, /Stage details/, 'normal Produce mode should not expose ambiguous command bar labels');
  assert.doesNotMatch(uiJs, /Build evidence brief/, 'normal Produce mode should use research brief terminology');
  assert.doesNotMatch(uiJs, /source profile through the API/i, 'normal settings copy should use story source terminology');
  assert.doesNotMatch(uiJs, /preview audio job|cover art job|production jobs/i, 'normal Produce status copy should use task/run terminology');
});

test('production assets expose local Play Open Download controls', () => {
  assertContains(uiJs, 'function productionAssetContentUrl(asset', 'local asset route URL helper');
  assertContains(uiJs, '/episodes/${encodeURIComponent(asset.episodeId)}/assets/${encodeURIComponent(asset.id)}/content', 'asset route should be episode-scoped');
  assertContains(uiJs, 'function appendAssetAccessControls(container, asset', 'asset control renderer');
  assertContains(uiJs, "play.textContent = 'Play'", 'audio asset play link');
  assertContains(uiJs, "open.textContent = 'Open'", 'asset open link');
  assertContains(uiJs, "download.textContent = 'Download'", 'asset download link');
  assertContains(uiJs, 'Public asset host may be unavailable in local runs', 'public URL local fallback warning');
  assertContains(stylesCss, '.asset-actions', 'asset action styles');
  assertContains(stylesCss, '.asset-access-warning', 'asset warning styles');
});

test('script and audio review use focused workspaces with active and archive separation', () => {
  for (const expected of [
    'function focusedWorkspaceSummary(items)',
    'scriptReviewWorkspace',
    'Current revision',
    'Approval status',
    'Integrity status',
    'Source/citation status',
    'Available AI coaching actions',
    'Each coaching action creates a new draft revision. Prior approval and integrity results stay with the old revision until this one is reviewed.',
    'No AI coaching actions are available. Recovery: refresh the workspace or check the script coaching actions endpoint before relying on AI rewrite help.',
    'Script generation or AI coaching is running. Wait for the task to finish, then refresh if the new revision does not appear.',
  ]) {
    assertContains(uiJs, expected, `focused script workspace marker ${expected}`);
  }

  for (const expected of [
    'audioCoverReviewWorkspace',
    'function productionAssetReviewCard(asset, kind, active = true)',
    'Active/current assets',
    'History/archive assets',
    'Only these active/current assets are used for publish approval and publishing checks.',
    'History/archive assets are kept for audit only; they do not satisfy current publish readiness.',
    'Use Play, Open, or Download to review the final publishable audio.',
    'Recovery: regenerate the asset or inspect the task run for storage metadata.',
  ]) {
    assertContains(uiJs, expected, `focused audio workspace marker ${expected}`);
  }

  for (const expected of [
    'function summarizeScriptReviewWorkspace',
    'Prior approval belongs to revision ${script.approvedRevisionId}; this revision needs a fresh review decision.',
    'each creates a new unapproved revision',
    'function summarizeAudioCoverReviewWorkspace',
    'History/archive assets remain available for audit only and are not used by publish approval.',
  ]) {
    assertContains(uiViewModelJs, expected, `focused workspace view-model marker ${expected}`);
  }

  for (const expected of [
    '.focused-workspace-summary',
    '.focused-status-card',
    '.script-review-coaching',
    '.asset-review-workspace',
    '.asset-preview-grid.focused-assets',
  ]) {
    assertContains(stylesCss, expected, `focused workspace style ${expected}`);
  }
});

test('workflow action feedback view-model covers success warnings and blockers', () => {
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
  const baseState = {
    shows: [show],
    feeds: [],
    profiles: [{ id: 'profile-1', slug: 'demo-sources', name: 'Demo Story Sources', type: 'brave', enabled: true }],
    queries: [query],
    storyCandidates: [],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-1',
  };

  const successModel = deriveProductionViewModel({
    ...baseState,
    recentJobs: [{
      id: 'job-search-ok',
      type: 'source.search',
      status: 'succeeded',
      input: { sourceProfileId: 'profile-1', sourceProfileSlug: 'demo-sources' },
      output: { inserted: 3, updated: 1, skipped: 2 },
      updatedAt: '2026-04-28T12:00:00Z',
    }],
  });

  assert.equal(successModel.workflowActionFeedback.status, 'succeeded');
  assert.equal(successModel.workflowActionFeedback.stage, 'discover');
  assert.match(successModel.workflowActionFeedback.message, /3 inserted, 1 updated, 2 skipped/);
  assert.match(successModel.latestActionResult.conciseMessage, /Source search succeeded/);
  assert.match(successModel.workflowActionFeedback.nextStep, /Review candidate stories/);

  const warningModel = deriveProductionViewModel({
    ...baseState,
    recentJobs: [{
      id: 'job-search-warning',
      type: 'source.search',
      status: 'succeeded',
      input: { sourceProfileId: 'profile-1', sourceProfileSlug: 'demo-sources' },
      output: { inserted: 2, skipped: 1, warnings: [{ code: 'DOMAIN_DROPPED', message: 'Filtered one blocked domain.' }] },
      updatedAt: '2026-04-28T12:05:00Z',
    }],
  });

  assert.equal(warningModel.workflowActionFeedback.status, 'warning');
  assert.equal(warningModel.workflowActionFeedback.warnings.length, 1);
  assert.match(warningModel.workflowActionFeedback.message, /1 warning/);
  assert.match(warningModel.workflowActionFeedback.nextStep, /full warning records/);

  const blockedModel = deriveProductionViewModel({
    ...baseState,
    profiles: [{
      id: 'profile-1',
      slug: 'demo-sources',
      name: 'Demo Story Sources',
      type: 'brave',
      enabled: true,
      credentialStatus: { required: true, available: false, label: 'Brave credential missing' },
    }],
    recentJobs: [{
      id: 'job-stale-warning',
      type: 'source.search',
      status: 'succeeded',
      input: { sourceProfileId: 'profile-1', sourceProfileSlug: 'demo-sources' },
      output: { inserted: 0, warnings: [{ code: 'STALE', message: 'Previous search warning.' }] },
      updatedAt: '2026-04-28T12:10:00Z',
    }],
  });

  assert.equal(blockedModel.workflowActionFeedback.status, 'blocked');
  assert.equal(blockedModel.workflowActionFeedback.stage, 'discover');
  assert.match(blockedModel.workflowActionFeedback.message, /Search Brave blocked: Brave credential missing/);
  assert.equal(blockedModel.workflowActionFeedback.nextStep, 'Brave credential missing');
});

test('workflow action feedback gives failure next-step guidance for jobs', () => {
  const show = {
    id: 'show-1',
    slug: 'demo-show',
    title: 'Demo Show',
  };
  const failureModel = deriveProductionViewModel({
    shows: [show],
    feeds: [],
    profiles: [{ id: 'profile-1', slug: 'demo-sources', name: 'Demo Story Sources', type: 'brave', enabled: true }],
    queries: [{ id: 'query-1', sourceProfileId: 'profile-1', query: 'AI policy', enabled: true }],
    storyCandidates: [{ id: 'candidate-1', title: 'Policy Story', status: 'selected', canonicalUrl: 'https://example.com/story' }],
    selectedCandidateIds: ['candidate-1'],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    recentJobs: [{
      id: 'job-brief-failed',
      type: 'research.packet',
      status: 'failed',
      error: 'Source fetch failed',
      updatedAt: '2026-04-28T13:00:00Z',
    }],
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-1',
  });

  assert.equal(failureModel.workflowActionFeedback.status, 'failed');
  assert.equal(failureModel.workflowActionFeedback.stage, 'brief');
  assert.match(failureModel.workflowActionFeedback.message, /Research brief build failed: Source fetch failed/);
  assert.match(failureModel.workflowActionFeedback.nextStep, /source availability before rebuilding/);
  assert.equal(failureModel.workflowActionFeedback.job.id, 'job-brief-failed');
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
  assert.equal(readyModel.primaryNextAction.label, 'Search Brave');
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

  assert.equal(blockedModel.primaryNextAction.label, 'Review Local JSON Settings');
  assert.equal(blockedModel.primaryNextAction.enabled, false);
  assert.equal(blockedModel.primaryNextAction.blockerReason, 'Local JSON import is not available from the browser workflow yet.');
});

test('story source summaries use editorial labels and hide credential values', () => {
  assertContains(uiJs, 'Selected Story Source / Search Recipe', 'selected story source summary heading');
  assertContains(uiJs, 'sourceProviderLabel(profile.type)', 'source selector provider labels');
  assertContains(uiJs, 'Credential/config', 'credential/config summary label');
  assertContains(uiJs, 'sourceActionDescription(profile, state.queries)', 'source action description');

  const show = {
    id: 'show-1',
    slug: 'demo-show',
    title: 'Demo Show',
  };
  const zaiQuery = {
    id: 'query-zai',
    sourceProfileId: 'profile-zai',
    query: 'AI regulation filings',
    enabled: true,
    freshness: 'pw',
    includeDomains: ['example.com'],
    excludeDomains: ['rumor.example'],
  };
  const zaiModel = deriveProductionViewModel({
    shows: [show],
    feeds: [],
    profiles: [{
      id: 'profile-zai',
      slug: 'zai-signals',
      name: 'Policy Signals',
      type: 'zai-web',
      enabled: true,
      credentialStatus: { required: true, available: true, label: 'Z.AI Web Search credential configured' },
    }],
    queries: [zaiQuery],
    storyCandidates: [],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    recentJobs: [{
      id: 'job-zai',
      type: 'source.search',
      status: 'succeeded',
      input: { sourceProfileId: 'profile-zai', sourceProfileSlug: 'zai-signals' },
      output: { inserted: 2, skipped: 1, warnings: [{ code: 'DOMAIN_DROPPED' }] },
      updatedAt: '2026-04-28T12:00:00Z',
    }],
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-zai',
  });

  assert.equal(zaiModel.selectedStorySourceSummary.providerType, 'Z.AI Web Search');
  assert.equal(zaiModel.selectedStorySourceSummary.nextActionLabel, 'Search Z.AI Web');
  assert.equal(zaiModel.selectedStorySourceSummary.credentialLabel, 'Z.AI Web Search credential configured');
  assert.match(zaiModel.selectedStorySourceSummary.inputSummary, /1 enabled search query/);
  assert.match(zaiModel.selectedStorySourceSummary.constraintsSummary, /freshness Past week/);
  assert.match(zaiModel.selectedStorySourceSummary.lastSearchResult, /2 inserted, 1 skipped, 1 warning/);

  const braveModel = deriveProductionViewModel({
    shows: [show],
    feeds: [],
    profiles: [{
      id: 'profile-brave',
      slug: 'brave-news',
      name: 'Daily News Search',
      type: 'brave',
      enabled: true,
      config: { ['api' + 'Key']: 'hidden' },
      credentialStatus: { required: true, available: false, label: 'Brave credential missing' },
    }],
    queries: [{
      id: 'query-brave',
      sourceProfileId: 'profile-brave',
      query: 'AI product news',
      enabled: true,
    }],
    storyCandidates: [],
    researchPackets: [],
    scripts: [],
    selectedRevisions: [],
    production: { episode: null, assets: [], jobs: [] },
    recentJobs: [],
    episodes: [],
    selectedShowSlug: 'demo-show',
    selectedProfileId: 'profile-brave',
  });

  assert.equal(braveModel.selectedStorySourceSummary.providerType, 'Brave');
  assert.equal(braveModel.selectedStorySourceSummary.credentialStatus, 'missing');
  assert.equal(braveModel.selectedStorySourceSummary.discoveryReady, false);
  assert.equal(braveModel.primaryNextAction.enabled, false);
  assert.equal(braveModel.primaryNextAction.blockerReason, 'Brave credential missing');
  assert.doesNotMatch(JSON.stringify(braveModel.selectedStorySourceSummary), /hidden/);
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

test('settings admin defaults to basic overview with advanced details collapsed', () => {
  for (const [id, tab, label] of [
    ['settingsTabBasic', 'basic', 'Basic Show Settings'],
    ['settingsTabSources', 'sources', 'Content Sources'],
    ['settingsTabPublishing', 'publishing', 'Publishing'],
    ['settingsTabAutomation', 'automation', 'Automation'],
    ['settingsTabAi', 'ai', 'AI Configuration'],
    ['settingsTabAdvanced', 'advanced', 'Advanced/Internal'],
  ]) {
    assertContains(indexHtml, `id="${id}"`, `settings tab id ${id}`);
    assertContains(indexHtml, `data-settings-tab="${tab}"`, `settings tab key ${tab}`);
    assertContains(indexHtml, label, `settings tab label ${label}`);
  }

  assertContains(uiStateJs, "activeSettingsTab: 'basic'", 'basic settings tab default');
  assertContains(uiJs, 'const SETTINGS_TAB_PANELS = {', 'settings tab panel map');
  assertContains(uiJs, 'basic: () => els.settingsShows', 'basic tab panel');
  assertContains(uiJs, 'button.tabIndex = active ? 0 : -1', 'settings tabs roving tab index');
  assertContains(uiJs, "event.key === 'ArrowRight'", 'settings tabs right arrow navigation');
  assertContains(uiJs, "event.key === 'ArrowLeft'", 'settings tabs left arrow navigation');
  assertContains(uiJs, "event.key === 'Home'", 'settings tabs home navigation');
  assertContains(uiJs, "event.key === 'End'", 'settings tabs end navigation');

  for (const expected of [
    'Basic admin overview',
    'settingsOverview(',
    'Save Show',
    'Save Feed',
    'Show title',
    'Publishing feeds',
    'Public feed URL',
  ]) {
    assertContains(uiJs, expected, `basic settings marker ${expected}`);
  }

  for (const expected of [
    'Advanced setup internals',
    '<details class="settings-advanced">',
    'Advanced show internals',
    'Advanced feed routing and storage labels',
    'Advanced source scoring and internal ID',
    'Search query management',
    'Advanced model/provider routing',
    'Prompt internals and output schema',
    'Advanced publishing paths and storage labels',
    'Advanced schedule workflow and publish controls',
    'Sanitized feed metadata',
  ]) {
    assertContains(indexHtml + uiJs, expected, `collapsed advanced settings marker ${expected}`);
  }

  assert.doesNotMatch(indexHtml + uiJs, /<details[^>]*class="[^"]*settings-advanced[^"]*"[^>]*\sopen\b/, 'advanced settings details should be closed by default');
  assertContains(uiJs, '<button class="danger" name="delete" type="button">Delete</button>', 'delete control remains available inside query management');
  assertOrdered(
    uiJs,
    [
      /const queryPanel = document\.createElement\('details'\)/,
      /queryPanel\.className = 'settings-nested settings-advanced settings-query-disclosure'/,
      /<button class="danger" name="delete" type="button">Delete<\/button>/,
    ],
    'destructive query controls should sit behind collapsed query management',
  );

  assertContains(stylesCss, '.settings-overview', 'basic settings overview style');
  assertContains(stylesCss, '.settings-advanced', 'advanced settings disclosure style');
  assertContains(stylesCss, '.settings-section[hidden]', 'inactive settings panels hidden style');
});

test('settings admin demotes story sources sidebar', () => {
  assertContains(indexHtml, '<aside class="sidebar" aria-labelledby="workspaceSidebarTitle">', 'sidebar landmark label');
  assertContains(uiJs, "document.body.dataset.activeSurface = state.activeSurface", 'surface state reflected on body');
  assertContains(uiJs, "classList.toggle('sidebar-admin-mode', state.activeSurface === 'settings')", 'settings surface demotes sidebar');
  assertContains(stylesCss, '.sidebar.sidebar-admin-mode #profileList', 'profile list hidden while settings is active');
  assertContains(stylesCss, 'collapsed while Settings/Admin is active', 'settings sidebar collapsed copy');
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
  assertContains(uiJs, "publish.disabled = !episode || episode.status !== 'approved-for-publish' || !ready || isActionRunning('publish')", 'publish action remains approval-gated');
  assertContains(uiJs, "approve.disabled = !episode || episode.status !== 'audio-ready' || !canApprove || isActionRunning('approval')", 'publish approval remains checklist-gated');
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
  assertContains(uiJs, 'function renderProductionArchiveAssets(archivedAssets)', 'archive production assets should render as labeled audit records');
  assertContains(uiJs, 'History/archive production assets', 'archive production asset heading');
  assertContains(uiJs, 'Kept for audit only; not used by production or publishing actions.', 'archive production assets should not look actionable');
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
  assertContains(stylesCss, 'overflow-x: clip', 'page should not create horizontal scroll');
  assertContains(stylesCss, 'max-width: calc(100vw - 1.5rem)', 'mobile command bar stays within viewport');
  assertContains(stylesCss, 'grid-template-columns: minmax(0, 1fr) minmax(7.75rem, 38vw)', 'mobile command bar preserves content plus action columns');
  assertContains(stylesCss, '.production-row,\n  .scheduler-row', 'mobile action rows should stack');
});

test('shared control state styles cover hover focus disabled loading and error states', () => {
  for (const expected of [
    'button:hover:not(:disabled)',
    'button.secondary:hover:not(:disabled)',
    'button.danger:hover:not(:disabled)',
    'button.secondary.danger:hover:not(:disabled)',
    'button[aria-busy="true"]',
    'button.is-loading',
    'button:focus-visible',
    'summary:focus-visible',
    'input:focus-visible',
    'input[aria-invalid="true"]',
    'button:disabled',
    'cursor: not-allowed',
  ]) {
    assertContains(stylesCss, expected, `shared control state style ${expected}`);
  }

  for (const expected of [
    '.workflow-feedback-panel.error',
    '.workflow-feedback-panel.failed',
    '.command-bar-result.error',
    '.status-pill.failed',
    '.candidate-chip.error',
    '.warning-item.error',
    '.job-message.error',
    '.trust-badge.blocker',
    '.trust-panel.blocker',
  ]) {
    assertContains(stylesCss, expected, `error/blocker state style ${expected}`);
  }

  for (const expected of [
    '.status-pill',
    '.trust-badge',
    '.candidate-chip',
    '.checklist-mark',
    '.scope-pill',
  ]) {
    const index = stylesCss.indexOf(expected);
    assert.ok(index >= 0, `${expected} should exist`);
    assert.ok(stylesCss.slice(index, index + 280).includes('max-width: 100%'), `${expected} should constrain narrow widths`);
  }
});
