import { createHash } from 'node:crypto';

import type { ShowRecord } from '../sources/store.js';
import type { ScriptRecord, ScriptRevisionRecord } from '../scripts/store.js';

export interface ProductionConfig {
  ttsProvider?: string;
  artProvider?: string;
  publicBaseUrl?: string;
  storage?: string;
}

export interface ProductionProviderContext {
  show: ShowRecord;
  script: ScriptRecord;
  revision: ScriptRevisionRecord;
  episodeSlug: string;
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

function assetUrl(publicBaseUrl: string | undefined, objectKey: string) {
  if (!publicBaseUrl) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/$/, '')}/${objectKey}`;
}

function checksum(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export const deterministicAudioPreviewProvider: AudioPreviewProvider = {
  async generatePreviewAudio(context) {
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

    return {
      provider,
      label: 'Preview audio',
      mimeType: 'audio/mpeg',
      byteSize,
      durationSeconds: Math.max(1, Math.round(words / 2.6)),
      checksum: checksum(body),
      objectKey,
      publicUrl: assetUrl(context.production.publicBaseUrl, objectKey),
      metadata: {
        adapter: provider,
        voiceMap: context.show.cast.map((member) => ({ speaker: member.name, voice: member.voice })),
        generatedBy: 'deterministic-preview-adapter',
      },
    };
  },
};

const pngOneByOneByteSize = 68;
const pngOneByOneChecksum = checksum('podcast-forge-cover-art-placeholder-v1');

export const deterministicCoverArtProvider: CoverArtProvider = {
  async generateCoverArt(context) {
    const provider = context.production.artProvider ?? 'configured-art-provider';
    const objectKey = `shows/${context.show.slug}/episodes/${context.episodeSlug}/cover.png`;

    return {
      provider,
      label: 'Cover art',
      mimeType: 'image/png',
      byteSize: pngOneByOneByteSize,
      checksum: pngOneByOneChecksum,
      objectKey,
      publicUrl: assetUrl(context.production.publicBaseUrl, objectKey),
      metadata: {
        adapter: provider,
        prompt: context.prompt,
        generatedBy: 'deterministic-cover-adapter',
      },
    };
  },
};
