import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { buildApp } from './app.js';

const app = buildApp();

describe('api config endpoints', () => {
  after(async () => {
    await app.close();
  });

  it('keeps the health endpoint available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, service: 'podcast-forge-api' });
  });

  it('serves the local command center UI shell', async () => {
    const response = await app.inject({ method: 'GET', url: '/ui' });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Podcast Forge Command Center/);
    assert.match(response.body, /Produce Episode/);
    assert.match(response.body, /Settings \/ Admin/);
    assert.match(response.body, /Jobs \/ Debug/);
    assert.match(response.body, /Shows &amp; Feeds/);
    assert.match(response.body, /Prompt Templates/);
    assert.match(response.body, /Editorial Production Workflow/);
    assert.match(response.body, /data-surface="workflow"/);
    assert.match(response.body, /data-surface="settings"/);
    assert.match(response.body, /data-surface="debug"/);
    assert.match(response.body, /nextActionPanel/);
    assert.match(response.body, /8-stage journey from show selection through sourced evidence, script, integrity review, production assets, approval, and publishing/);
  });

  it('serves guided pipeline client state helpers', async () => {
    const response = await app.inject({ method: 'GET', url: '/ui.js' });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] ?? ''), /application\/javascript/);
    for (const modulePath of ['./ui-api.js', './ui-constants.js', './ui-state.js', './ui-formatters.js']) {
      assert.match(response.body, new RegExp(`from\\s+['\"]${modulePath.replace(/[./]/g, '\\$&')}['\"]`));
    }
    assert.match(response.body, /renderSettings/);
    assert.match(response.body, /saveModelProfile/);
    assert.match(response.body, /renderPipeline/);
    assert.match(response.body, /setActiveSurface/);
    assert.match(response.body, /renderSurfaceVisibility/);
    assert.match(response.body, /runSelectedIntegrityReview/);
    assert.match(response.body, /workflowStoryContext/);
    assert.match(response.body, /renderNextAction/);
    assert.match(response.body, /checklistBlockers/);
    assert.match(response.body, /scrollToPanel/);
    assert.match(response.body, /Claim\/source coverage/);
    assert.match(response.body, /coverageStatusLabel/);
    assert.match(response.body, /scriptCoachingActions/);
    assert.match(response.body, /runScriptCoachingAction/);
  });

  it('serves guided pipeline module dependencies', async () => {
    const assets = [
      {
        path: '/ui-state.js',
        patterns: [/selectedCandidateIds/, /selectedResearchPacketId/, /activeSurface: 'workflow'/],
      },
      {
        path: '/ui-api.js',
        patterns: [/ApiRequestError/, /friendlyApiMessage/, /EPISODE_PLANNER_RUNTIME_REQUIRED/],
      },
      {
        path: '/ui-constants.js',
        patterns: [/MODEL_ROLE_LABELS/, /SETTINGS_SECTIONS/, /SURFACES/],
      },
      {
        path: '/ui-formatters.js',
        patterns: [/sourceControlsSupported/, /safeVisiblePath/, /linesToCast/],
      },
    ];

    for (const asset of assets) {
      const response = await app.inject({ method: 'GET', url: asset.path });

      assert.equal(response.statusCode, 200, asset.path);
      assert.match(String(response.headers['content-type'] ?? ''), /application\/javascript/, asset.path);
      for (const pattern of asset.patterns) {
        assert.match(response.body, pattern, asset.path);
      }
    }
  });

  it('returns the bundled example config', async () => {
    const response = await app.inject({ method: 'GET', url: '/config/example' });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.show.slug, 'the-synthetic-lens');
  });

  it('returns validation errors without throwing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/config/validate',
      payload: {
        show: { slug: 'missing-title' },
        sources: [],
        models: {},
        production: {},
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, false);
    assert.ok(body.errors.length > 0);
  });
});
