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
  it('validates the bundled example config', async () => {
    const result = await loadConfigFromFile(EXAMPLE_CONFIG_PATH);

    assert.equal(result.config.show.slug, 'the-synthetic-lens');
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
