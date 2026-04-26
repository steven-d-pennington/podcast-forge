import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ResearchPacketRecord } from '../research/store.js';
import type { ShowRecord } from '../sources/store.js';
import type { ScriptRecord, ScriptRevisionRecord } from '../scripts/store.js';

export interface ProductionConfig {
  ttsProvider?: string;
  artProvider?: string;
  publicBaseUrl?: string;
  storage?: string;
  localAssetDir?: string;
  outputDir?: string;
  failAudioPreview?: boolean | string;
  failCoverArt?: boolean | string;
}

export interface ProductionProviderContext {
  show: ShowRecord;
  script: ScriptRecord;
  revision: ScriptRevisionRecord;
  episodeId: string;
  episodeSlug: string;
  researchPacket?: ResearchPacketRecord | null;
  production: ProductionConfig;
}

export interface GeneratedProductionAsset {
  provider: string;
  label: string;
  mimeType: string;
  byteSize: number;
  durationSeconds?: number | null;
  checksum: string;
  localPath?: string | null;
  objectKey?: string | null;
  publicUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AudioPreviewProvider {
  generatePreviewAudio(context: ProductionProviderContext): Promise<GeneratedProductionAsset>;
}

export interface CoverArtProvider {
  generateCoverArt(context: ProductionProviderContext & { prompt: string }): Promise<GeneratedProductionAsset>;
}

function localAssetRoot(production: ProductionConfig) {
  return production.localAssetDir ?? production.outputDir ?? join('/tmp', 'podcast-forge-production-assets');
}

function assetUrl(publicBaseUrl: string | undefined, objectKey: string) {
  if (!publicBaseUrl) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/$/, '')}/${objectKey}`;
}

function checksum(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeDeterministicAsset(production: ProductionConfig, objectKey: string, body: Buffer | string) {
  const localPath = join(localAssetRoot(production), objectKey);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, body);
  return localPath;
}

export const deterministicAudioPreviewProvider: AudioPreviewProvider = {
  async generatePreviewAudio(context) {
    if (context.production.failAudioPreview) {
      const message = typeof context.production.failAudioPreview === 'string'
        ? context.production.failAudioPreview
        : 'Configured fake audio preview failure.';
      throw new Error(message);
    }

    const provider = context.production.ttsProvider ?? 'vertex-gemini-tts';
    const objectKey = `shows/${context.show.slug}/episodes/${context.episodeSlug}/audio-preview.mp3`;
    const body = [
      'ID3',
      context.show.title,
      context.script.title,
      context.revision.id,
      context.revision.body,
    ].join('\n');
    const byteSize = Buffer.byteLength(body);
    const words = context.revision.body.split(/\s+/).filter(Boolean).length;
    const localPath = await writeDeterministicAsset(context.production, objectKey, body);

    return {
      provider,
      label: 'Preview audio',
      mimeType: 'audio/mpeg',
      byteSize,
      durationSeconds: Math.max(1, Math.round(words / 2.6)),
      checksum: checksum(body),
      localPath,
      objectKey,
      publicUrl: assetUrl(context.production.publicBaseUrl, objectKey),
      metadata: {
        adapter: provider,
        adapterKind: 'fake-local-audio-preview',
        voiceMap: context.show.cast.map((member) => ({ speaker: member.name, voice: member.voice })),
        generatedBy: 'deterministic-preview-adapter',
      },
    };
  },
};

export const deterministicCoverArtProvider: CoverArtProvider = {
  async generateCoverArt(context) {
    if (context.production.failCoverArt) {
      const message = typeof context.production.failCoverArt === 'string'
        ? context.production.failCoverArt
        : 'Configured fake cover art failure.';
      throw new Error(message);
    }

    const provider = context.production.artProvider ?? 'configured-art-provider';
    const objectKey = `shows/${context.show.slug}/episodes/${context.episodeSlug}/cover.png`;
    const body = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    );
    const localPath = await writeDeterministicAsset(context.production, objectKey, body);

    return {
      provider,
      label: 'Cover art',
      mimeType: 'image/png',
      byteSize: body.byteLength,
      checksum: checksum(body),
      localPath,
      objectKey,
      publicUrl: assetUrl(context.production.publicBaseUrl, objectKey),
      metadata: {
        adapter: provider,
        adapterKind: 'fake-local-cover-art',
        prompt: context.prompt,
        generatedBy: 'deterministic-cover-adapter',
      },
    };
  },
};
