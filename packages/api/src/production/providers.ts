import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

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

export function localAssetRoot(production: ProductionConfig) {
  return production.localAssetDir ?? production.outputDir ?? join('/tmp', 'podcast-forge-production-assets');
}

const execFile = promisify(execFileCallback);

function assetUrl(publicBaseUrl: string | undefined, objectKey: string) {
  if (!publicBaseUrl) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/$/, '')}/${objectKey}`;
}

function checksum(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileByteSize(path: string) {
  return (await stat(path)).size;
}

function plainSpeechText(context: ProductionProviderContext) {
  return [
    `${context.show.title}.`,
    context.script.title,
    context.revision.body,
  ]
    .join('\n\n')
    .replace(/^[A-Z][A-Z0-9_-]{1,20}:\s*/gm, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000) || 'Podcast Forge preview audio.';
}

async function renderLocalMp3(context: ProductionProviderContext, localPath: string) {
  const tempDir = await mkdtemp(join(tmpdir(), 'podcast-forge-preview-audio-'));
  const textPath = join(tempDir, 'script.txt');
  const wavPath = join(tempDir, 'preview.wav');

  try {
    await writeFile(textPath, plainSpeechText(context), 'utf8');
    await execFile('espeak-ng', ['-v', 'en-us', '-s', '158', '-w', wavPath, '-f', textPath], { timeout: 120_000 });
    await mkdir(dirname(localPath), { recursive: true });
    await execFile('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      wavPath,
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '5',
      localPath,
    ], { timeout: 120_000 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapWords(value: string, maxLineLength: number, maxLines: number) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  return lines;
}

function colorFromText(value: string, offset: number) {
  const digest = createHash('sha256').update(value).digest();
  return `#${digest.subarray(offset, offset + 3).toString('hex')}`;
}

async function renderLocalCoverPng(context: ProductionProviderContext & { prompt: string }) {
  const titleLines = wrapWords(context.script.title, 22, 3);
  const promptLines = wrapWords(context.prompt, 48, 5);
  const accent = colorFromText(context.prompt, 0);
  const accentTwo = colorFromText(context.script.title, 3);
  const texture = Array.from({ length: 42 }, (_, index) => {
    const x = 80 + ((index * 97) % 1240);
    const y = 120 + ((index * 173) % 1080);
    const opacity = 0.05 + ((index % 5) * 0.018);
    return `<circle cx="${x}" cy="${y}" r="${18 + (index % 7) * 8}" fill="white" opacity="${opacity.toFixed(3)}" />`;
  }).join('\n');
  const titleSvg = titleLines.map((line, index) => (
    `<text x="110" y="${430 + index * 86}" font-family="Inter, Arial, sans-serif" font-size="72" font-weight="800" fill="#f8fafc">${escapeXml(line)}</text>`
  )).join('\n');
  const promptSvg = promptLines.map((line, index) => (
    `<text x="112" y="${830 + index * 44}" font-family="Inter, Arial, sans-serif" font-size="30" fill="#cbd5e1">${escapeXml(line)}</text>`
  )).join('\n');
  const castLine = context.show.cast.map((member) => member.name).filter(Boolean).slice(0, 5).join(' • ');
  const svg = `
<svg width="1400" height="1400" viewBox="0 0 1400 1400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#020617" />
      <stop offset="0.52" stop-color="${accent}" />
      <stop offset="1" stop-color="${accentTwo}" />
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="25%" r="55%">
      <stop offset="0" stop-color="#e0f2fe" stop-opacity="0.42" />
      <stop offset="1" stop-color="#020617" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1400" height="1400" fill="url(#bg)" />
  <rect width="1400" height="1400" fill="url(#glow)" />
  ${texture}
  <rect x="78" y="78" width="1244" height="1244" rx="58" fill="#020617" opacity="0.42" stroke="#e2e8f0" stroke-opacity="0.32" stroke-width="3" />
  <text x="110" y="185" font-family="Inter, Arial, sans-serif" font-size="36" letter-spacing="8" font-weight="700" fill="#93c5fd">${escapeXml(context.show.title.toUpperCase())}</text>
  <line x1="110" y1="245" x2="610" y2="245" stroke="#f8fafc" stroke-width="8" stroke-linecap="round" opacity="0.72" />
  ${titleSvg}
  <text x="112" y="760" font-family="Inter, Arial, sans-serif" font-size="28" letter-spacing="4" font-weight="700" fill="#93c5fd">EDITORIAL COVER • LOCAL PREVIEW</text>
  ${promptSvg}
  <text x="112" y="1210" font-family="Inter, Arial, sans-serif" font-size="28" fill="#e2e8f0">${escapeXml(castLine || 'Podcast Forge')}</text>
  <text x="112" y="1260" font-family="Inter, Arial, sans-serif" font-size="24" fill="#94a3b8">Generated from the approved script revision for production review.</text>
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
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
    const localPath = join(localAssetRoot(context.production), objectKey);
    await renderLocalMp3(context, localPath);
    const bytes = await readFile(localPath);
    const byteSize = await fileByteSize(localPath);
    const words = context.revision.body.split(/\s+/).filter(Boolean).length;

    return {
      provider,
      label: 'Preview audio',
      mimeType: 'audio/mpeg',
      byteSize,
      durationSeconds: Math.max(1, Math.round(words / 2.6)),
      checksum: checksum(bytes),
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
    const body = await renderLocalCoverPng(context);
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
