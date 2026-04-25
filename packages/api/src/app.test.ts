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

  it('serves the source profile UI shell', async () => {
    const response = await app.inject({ method: 'GET', url: '/ui' });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Podcast Forge Sources/);
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
