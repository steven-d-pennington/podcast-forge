import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ConfigLoadError,
  EXAMPLE_CONFIG_PATH,
  loadConfigFromFile,
  validateConfig,
} from './loader.js';

describe('config loader', () => {
  it('validates the bundled example config with topic-based source profiles', async () => {
    const result = await loadConfigFromFile(EXAMPLE_CONFIG_PATH);

    assert.equal(result.config.show.slug, 'the-synthetic-lens');
    assert.equal(result.config.sources.length, 6);

    const byCategory = new Map(result.config.sources.map((source) => [source.category, source]));
    for (const category of ['ai-news', 'politics-policy', 'world-affairs', 'markets-finance', 'data-research', 'breaking-news']) {
      assert.ok(byCategory.has(category), `expected bundled source category ${category}`);
    }

    const aiNews = byCategory.get('ai-news');
    assert.equal(aiNews?.name, 'AI News');
    assert.equal(aiNews?.type, 'zai-web');
    assert.ok(aiNews?.queries?.some((query) => query.includes('OpenAI Anthropic Google DeepMind')));
    assert.ok(aiNews?.includeDomains?.includes('reuters.com'));
    assert.ok(aiNews?.includeDomains?.includes('apnews.com'));
    assert.ok(aiNews?.includeDomains?.includes('techcrunch.com'));

    const politics = byCategory.get('politics-policy');
    assert.ok(politics?.includeDomains?.includes('whitehouse.gov'));
    assert.ok(politics?.includeDomains?.includes('federalregister.gov'));
    assert.ok(politics?.includeDomains?.includes('justice.gov'));

    const worldAffairs = byCategory.get('world-affairs');
    assert.ok(worldAffairs?.includeDomains?.includes('bbc.com'));
    assert.ok(worldAffairs?.includeDomains?.includes('aljazeera.com'));
    assert.ok(worldAffairs?.includeDomains?.includes('dw.com'));
  });

  it('returns validation errors for schema-invalid configs', async () => {
    const result = await validateConfig({
      show: { slug: 'missing-title' },
      sources: [],
      models: {},
      production: {},
    });

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some((error) => error.path === '/show'));
    }
  });

  it('throws a clear error for missing config files', async () => {
    const missingPath = './does-not-exist/podcast-forge.config.json';

    await assert.rejects(
      () => loadConfigFromFile(missingPath),
      (error) => {
        assert.ok(error instanceof ConfigLoadError);
        assert.equal(error.code, 'CONFIG_FILE_NOT_FOUND');
        assert.match(error.message, /Config file not found:/);
        return true;
      },
    );
  });

  it('throws a clear error for invalid JSON files', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'podcast-forge-config-'));
    const configPath = path.join(tempDir, 'invalid.json');
    await writeFile(configPath, '{ "show": ', 'utf8');

    await assert.rejects(
      () => loadConfigFromFile(configPath),
      (error) => {
        assert.ok(error instanceof ConfigLoadError);
        assert.equal(error.code, 'CONFIG_INVALID_JSON');
        assert.match(error.message, /Invalid JSON in config file:/);
        return true;
      },
    );
  });
});
