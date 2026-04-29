import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  deterministicAudioPreviewProvider,
  deterministicCoverArtProvider,
} from './providers.js';

function productionContext(localAssetDir: string) {
  const show = {
    id: 'show-1',
    slug: 'the-synthetic-lens',
    title: 'The Synthetic Lens',
    description: 'A sourced AI news show.',
    language: 'en',
    explicit: false,
    author: 'Podcast Forge',
    ownerEmail: 'producer@example.com',
    imageUrl: null,
    feedUrl: null,
    websiteUrl: null,
    setupStatus: 'active' as const,
    format: 'roundtable',
    defaultRuntimeMinutes: 30,
    defaultModelProfile: {},
    cast: [{ name: 'DAVID', role: 'host', voice: 'Orus' }],
    settings: { production: { localAssetDir } },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const script = {
    id: 'script-1',
    showId: show.id,
    researchPacketId: 'packet-1',
    title: 'AI Infrastructure Gets Real',
    format: 'feature-analysis',
    status: 'draft',
    approvedRevisionId: 'revision-1',
    approvedAt: new Date(),
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const revision = {
    id: 'revision-1',
    scriptId: script.id,
    version: 1,
    title: script.title,
    body: 'DAVID: Today we test whether generated preview assets are real enough to inspect. MARCUS: Empty placeholders are not production artifacts.',
    format: script.format,
    speakers: ['DAVID', 'MARCUS'],
    author: 'model',
    changeSummary: null,
    modelProfile: {},
    metadata: {},
    createdAt: new Date(),
  };

  return {
    show,
    script,
    revision,
    episodeId: 'episode-1',
    episodeSlug: 'episode-1',
    production: { localAssetDir },
  };
}

test('deterministic preview audio provider writes a playable MP3 artifact, not an ID3 text placeholder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-audio-provider-'));
  try {
    const generated = await deterministicAudioPreviewProvider.generatePreviewAudio(productionContext(dir));
    const bytes = await readFile(generated.localPath ?? '');

    assert.equal(generated.mimeType, 'audio/mpeg');
    assert.equal(generated.byteSize, bytes.byteLength);
    assert.ok(bytes.byteLength > 1000);
    assert.notEqual(bytes.subarray(0, 4).toString('utf8'), 'ID3\n');
    assert.ok(
      bytes.includes(Buffer.from([0xff, 0xfb])) || bytes.includes(Buffer.from([0xff, 0xf3])) || bytes.includes(Buffer.from([0xff, 0xf2])),
      'expected an MPEG audio frame sync marker',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deterministic cover art provider writes visible cover art, not a 1x1 placeholder pixel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-cover-provider-'));
  try {
    const generated = await deterministicCoverArtProvider.generateCoverArt({
      ...productionContext(dir),
      prompt: 'Editorial cover art for an AI infrastructure episode.',
    });
    const bytes = await readFile(generated.localPath ?? '');
    const metadata = await sharp(bytes).metadata();

    assert.equal(generated.mimeType, 'image/png');
    assert.equal(generated.byteSize, bytes.byteLength);
    assert.ok(bytes.byteLength > 10_000);
    assert.ok((metadata.width ?? 0) >= 1024);
    assert.ok((metadata.height ?? 0) >= 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
