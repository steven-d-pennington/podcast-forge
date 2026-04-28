import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
  assertContains(indexHtml, 'id="nextActionPanel"', 'next action panel');
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
  assertContains(uiJs, 'function stageCard(stage)', 'stage card renderer');
  assertContains(uiJs, 'scrollToPanel(stage.targetId)', 'stage card panel navigation');
  assertContains(uiJs, 'function scrollToPanel(id)', 'panel scroll helper');
  assertContains(uiJs, "card.dataset.stage", 'stage cards should expose stage numbers');
});

test('next-best-action and concrete blocker copy remain present', () => {
  assertContains(uiJs, 'function renderNextAction(stages)', 'next-best-action renderer');
  assertContains(uiJs, 'function checklistBlockers(checklist', 'checklist blocker helper');
  assertContains(uiJs, 'next-action-blockers', 'next action blocker list');
  assertContains(uiJs, 'Review Blockers', 'blocked action fallback');

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
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.workflow-context,[\s\S]*\.next-action-panel,[\s\S]*\.pipeline-grid,[\s\S]*grid-template-columns:\s*1fr/, 'workflow areas stack on mobile');
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.surface-nav,[\s\S]*\.surface-tab,[\s\S]*width:\s*100%/, 'surface tabs become full-width on mobile');
  assertMatches(stylesCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.confirmation-actions,[\s\S]*\.confirmation-overlay[\s\S]*\.confirmation-dialog/, 'confirmation UI has mobile rules');
});
