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
    assert.match(response.body, /Settings/);
    assert.match(response.body, /Shows &amp; Feeds/);
    assert.match(response.body, /Prompt Templates/);
    assert.match(response.body, /Editorial Production Workflow/);
    assert.match(response.body, /8-stage journey from show selection through sourced evidence, script, integrity review, production assets, approval, and publishing/);
  });

  it('serves guided pipeline client state helpers', async () => {
    const response = await app.inject({ method: 'GET', url: '/ui.js' });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /selectedCandidateIds/);
    assert.match(response.body, /selectedResearchPacketId/);
    assert.match(response.body, /renderSettings/);
    assert.match(response.body, /saveModelProfile/);
    assert.match(response.body, /renderPipeline/);
    assert.match(response.body, /runSelectedIntegrityReview/);
    assert.match(response.body, /workflowStoryContext/);
    assert.match(response.body, /scrollToPanel/);
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
