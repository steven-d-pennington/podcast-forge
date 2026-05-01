import { createHash, createSign } from 'node:crypto';
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
  failAudioFinal?: boolean | string;
  failCoverArt?: boolean | string;
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexTtsModel?: string;
  vertexTtsEndpoint?: string;
  vertexTtsTimeoutMs?: number;
  vertexTtsSampleRateHz?: number;
  vertexTtsMaxInputChars?: number;
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

export interface AudioFinalProvider {
  generateFinalAudio(context: ProductionProviderContext): Promise<GeneratedProductionAsset>;
}

export interface CoverArtProvider {
  generateCoverArt(context: ProductionProviderContext & { prompt: string }): Promise<GeneratedProductionAsset>;
}

export type ProductionFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ProductionExecFile = (file: string, args: string[], options?: { timeout?: number }) => Promise<unknown>;
export type VertexAuthValueProvider = (context: ProductionProviderContext) => Promise<string>;

export interface VertexGeminiTtsProviderOptions {
  fetchImpl?: ProductionFetch;
  execFileImpl?: ProductionExecFile;
  getAuthValue?: VertexAuthValueProvider;
  now?: () => number;
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

    const provider = 'local-espeak-preview';
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
        configuredProvider: context.production.ttsProvider ?? null,
        adapter: provider,
        adapterKind: 'fake-local-audio-preview',
        voiceMap: context.show.cast.map((member) => ({ speaker: member.name, voice: member.voice })),
        generatedBy: 'deterministic-preview-adapter',
        publishable: false,
      },
    };
  },
};

function envString(key: string) {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : null;
}

function configString(production: ProductionConfig, keys: Array<keyof ProductionConfig>) {
  for (const key of keys) {
    const value = production[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function base64url(value: string | Buffer) {
  return (typeof value === 'string' ? Buffer.from(value) : value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

interface VertexServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id?: string;
}

function parseServiceAccount(value: unknown): VertexServiceAccount | null {
  if (!isRecord(value)) {
    return null;
  }

  const clientEmail = value.client_email;
  const privateKey = value.private_key;
  const tokenUri = value.token_uri;

  if (typeof clientEmail !== 'string' || typeof privateKey !== 'string' || typeof tokenUri !== 'string') {
    return null;
  }

  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
    project_id: typeof value.project_id === 'string' ? value.project_id : undefined,
  };
}

async function loadVertexServiceAccount(_production: ProductionConfig): Promise<VertexServiceAccount | null> {
  const json = envString('GOOGLE_APPLICATION_CREDENTIALS_JSON');

  if (json) {
    const parsed = parseServiceAccount(JSON.parse(json));

    if (!parsed) {
      throw new Error('Vertex service account JSON is missing required auth fields.');
    }

    return parsed;
  }

  const credentialsPath = envString('GOOGLE_APPLICATION_CREDENTIALS');

  if (!credentialsPath) {
    return null;
  }

  let fileBody: string;
  try {
    fileBody = await readFile(credentialsPath, 'utf8');
  } catch {
    throw new Error('Vertex service account file could not be read from GOOGLE_APPLICATION_CREDENTIALS.');
  }

  const parsed = parseServiceAccount(JSON.parse(fileBody));

  if (!parsed) {
    throw new Error('Vertex service account file is missing required auth fields.');
  }

  return parsed;
}

function createJwtAssertion(serviceAccount: VertexServiceAccount, nowMs: number) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const audience = serviceAccount['token_uri'];
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: audience,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = base64url(signer.sign(serviceAccount.private_key));

  return `${header}.${payload}.${signature}`;
}

function createDefaultVertexAuthProvider(fetchImpl: ProductionFetch, now: () => number): VertexAuthValueProvider {
  let cachedToken: string | null = null;
  let expiresAt = 0;

  return async (context) => {
    const configuredToken = envString('VERTEX_ACCESS_TOKEN');

    if (configuredToken) {
      return configuredToken;
    }

    if (cachedToken && now() < expiresAt - 60_000) {
      return cachedToken;
    }

    const serviceAccount = await loadVertexServiceAccount(context.production);

    if (!serviceAccount) {
      throw new Error('Vertex Gemini TTS requires VERTEX_ACCESS_TOKEN or Google service account credentials.');
    }

    const assertion = createJwtAssertion(serviceAccount, now());
    const response = await fetchImpl(serviceAccount.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(context.production.vertexTtsTimeoutMs ?? 120_000),
    });

    if (!response.ok) {
      throw new Error(`Vertex token exchange failed with HTTP ${response.status}.`);
    }

    const body = await response.json() as unknown;

    if (!isRecord(body) || typeof body.access_token !== 'string') {
      throw new Error('Vertex token exchange response did not include an access token.');
    }

    cachedToken = body.access_token;
    expiresAt = now() + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
    return cachedToken;
  };
}

async function resolveVertexProjectId(production: ProductionConfig) {
  const configured = configString(production, ['vertexProjectId'])
    ?? envString('VERTEX_PROJECT_ID')
    ?? envString('GOOGLE_CLOUD_PROJECT')
    ?? envString('GCLOUD_PROJECT');

  if (configured) {
    return configured;
  }

  const serviceAccount = await loadVertexServiceAccount(production);

  if (serviceAccount?.project_id) {
    return serviceAccount.project_id;
  }

  throw new Error('Vertex Gemini TTS requires a project id from production.vertexProjectId, VERTEX_PROJECT_ID, or service account JSON.');
}

function vertexLocation(production: ProductionConfig) {
  return configString(production, ['vertexLocation'])
    ?? envString('VERTEX_LOCATION')
    ?? 'us-central1';
}

function vertexTtsModel(production: ProductionConfig) {
  return configString(production, ['vertexTtsModel'])
    ?? envString('VERTEX_GEMINI_TTS_MODEL')
    ?? envString('VERTEX_TTS_MODEL')
    ?? 'gemini-2.5-flash-tts';
}

async function vertexTtsEndpoint(production: ProductionConfig) {
  const configured = configString(production, ['vertexTtsEndpoint'])
    ?? envString('VERTEX_TTS_ENDPOINT');

  if (configured) {
    return configured;
  }

  const projectId = await resolveVertexProjectId(production);
  const location = vertexLocation(production);
  const model = vertexTtsModel(production);

  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

interface ScriptTurn {
  speaker: string | null;
  text: string;
}

function isStructuralScriptCue(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(intro|introduction|opening|cold open|segment( [a-z0-9-]+)?|closing|outro|recap|summary|takeaway|key insight|the key insight|first|second|third|fourth|fifth|finally|and finally)$/.test(normalized);
}

function scriptTurns(body: string): ScriptTurn[] {
  const turns: ScriptTurn[] = [];
  let current: ScriptTurn | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]{0,63}):\s*(.*)$/);

    if (match) {
      const label = match[1].trim();
      if (!isStructuralScriptCue(label)) {
        current = { speaker: label, text: match[2].trim() };
        turns.push(current);
        continue;
      }
    }

    if (current) {
      current.text = `${current.text} ${line}`.trim();
    } else {
      current = { speaker: null, text: line };
      turns.push(current);
    }
  }

  return turns.length > 0 ? turns : [{ speaker: null, text: body.trim() }];
}

function splitTextForVertex(text: string, maxChars: number) {
  if (maxChars < 100) {
    throw new Error('Vertex Gemini TTS max input size is too small to preserve script text.');
  }

  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const boundary = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('; '),
      window.lastIndexOf(', '),
      window.lastIndexOf(' '),
    );

    if (boundary <= 0) {
      throw new Error('Vertex Gemini TTS input contains a segment longer than the configured max input size and cannot be split safely.');
    }

    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function splitTurnsByInputLimit(turns: ScriptTurn[], maxInputChars: number) {
  return turns.flatMap((turn) => {
    const prefixLength = turn.speaker ? `${turn.speaker}: `.length : 0;
    const maxTextChars = maxInputChars - prefixLength;

    if (chunkText([turn]).length <= maxInputChars) {
      return [turn];
    }

    return splitTextForVertex(turn.text, maxTextChars).map((text) => ({ ...turn, text }));
  });
}

function chunkTurns(turns: ScriptTurn[], maxSpeakers: number, maxInputChars?: number) {
  const chunks: ScriptTurn[][] = [];
  let current: ScriptTurn[] = [];
  let speakers = new Set<string>();

  for (const turn of turns) {
    const nextSpeakers = new Set(speakers);
    if (turn.speaker) {
      nextSpeakers.add(turn.speaker);
    }

    const speakerLimitExceeded = current.length > 0 && nextSpeakers.size > maxSpeakers;
    const inputLimitExceeded = Boolean(
      maxInputChars
        && current.length > 0
        && chunkText([...current, turn]).length > maxInputChars,
    );

    if (speakerLimitExceeded || inputLimitExceeded) {
      chunks.push(current);
      current = [];
      speakers = new Set<string>();
    }

    if (maxInputChars && chunkText([turn]).length > maxInputChars) {
      throw new Error('Vertex Gemini TTS input chunk exceeds the configured max input size.');
    }

    current.push(turn);
    if (turn.speaker) {
      speakers.add(turn.speaker);
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function chunkText(turns: ScriptTurn[]) {
  return turns.map((turn) => turn.speaker ? `${turn.speaker}: ${turn.text}` : turn.text).join('\n');
}

function voiceMap(context: ProductionProviderContext) {
  return new Map(context.show.cast.map((member) => [member.name.toUpperCase(), member.voice]));
}

function speakerVoiceConfigs(context: ProductionProviderContext, speakers: string[]) {
  const voices = voiceMap(context);

  return speakers.map((speaker) => {
    const voice = voices.get(speaker.toUpperCase());

    if (!voice) {
      throw new Error(`No configured TTS voice for script speaker "${speaker}".`);
    }

    return {
      speaker,
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice,
        },
      },
    };
  });
}

function defaultSingleSpeakerVoice(context: ProductionProviderContext) {
  const voice = context.show.cast.find((member) => typeof member.voice === 'string' && member.voice.trim())?.voice;

  if (!voice) {
    throw new Error('Vertex Gemini TTS requires at least one configured cast voice.');
  }

  return voice;
}

function vertexTtsPayload(context: ProductionProviderContext, text: string, speakers: string[]) {
  const speechConfig = speakers.length > 1
    ? {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakerVoiceConfigs(context, speakers),
        },
      }
    : {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: speakers.length === 1
              ? speakerVoiceConfigs(context, speakers)[0]?.voiceConfig.prebuiltVoiceConfig.voiceName
              : defaultSingleSpeakerVoice(context),
          },
        },
      };

  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig,
    },
  };
}

function inlineAudioFromVertexResponse(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidate = candidates.find(isRecord);
  const content = candidate && isRecord(candidate.content) ? candidate.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  for (const part of parts) {
    if (!isRecord(part) || !isRecord(part.inlineData)) {
      continue;
    }

    const data = part.inlineData.data;
    const mimeType = part.inlineData.mimeType;

    if (typeof data === 'string' && data.trim()) {
      return {
        data,
        mimeType: typeof mimeType === 'string' ? mimeType : 'audio/L16',
      };
    }
  }

  return null;
}

function sampleRateFromMimeType(mimeType: string, fallback: number) {
  const match = mimeType.match(/(?:rate|sample_rate)=(\d+)/i);
  const parsed = match ? Number(match[1]) : NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function wavFromPcm(pcm: Buffer, sampleRate: number) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return header;
}

function durationSecondsForPcm(pcmByteLength: number, sampleRate: number) {
  return Math.max(1, Math.round(pcmByteLength / (sampleRate * 2)));
}

function finalAudioWarnings(context: ProductionProviderContext, chunkCount: number) {
  const warnings: Array<Record<string, unknown>> = [];

  if (chunkCount > 1) {
    warnings.push({
      code: 'VERTEX_TTS_CHUNKED_FOR_SPEAKER_LIMIT',
      message: 'Final audio was rendered in multiple Vertex Gemini TTS calls because Gemini TTS supports at most two speakers per request.',
      metadata: {
        scriptId: context.script.id,
        revisionId: context.revision.id,
        chunkCount,
      },
    });
  }

  return warnings;
}

export function createVertexGeminiTtsFinalAudioProvider(options: VertexGeminiTtsProviderOptions = {}): AudioFinalProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  if (!fetchImpl) {
    throw new Error('Vertex Gemini TTS requires a fetch implementation.');
  }

  const execFileImpl = options.execFileImpl ?? execFile;
  const now = options.now ?? Date.now;
  const authValue = options.getAuthValue ?? createDefaultVertexAuthProvider(fetchImpl, now);

  return {
    async generateFinalAudio(context) {
      if (context.production.failAudioFinal) {
        const message = typeof context.production.failAudioFinal === 'string'
          ? context.production.failAudioFinal
          : 'Configured final audio failure.';
        throw new Error(message);
      }

      const provider = context.production.ttsProvider ?? 'vertex-gemini-tts';
      if (provider !== 'vertex-gemini-tts') {
        throw new Error(`Unsupported final audio TTS provider: ${provider}`);
      }

      const maxInputChars = context.production.vertexTtsMaxInputChars ?? 18_000;
      const trimmedBody = context.revision.body.trim();
      const turns = splitTurnsByInputLimit(scriptTurns(trimmedBody), maxInputChars);
      const chunks = chunkTurns(turns, 2, maxInputChars);
      const url = await vertexTtsEndpoint(context.production);
      const authHeaderValue = await authValue(context);
      const timeout = context.production.vertexTtsTimeoutMs ?? 120_000;
      const fallbackSampleRate = context.production.vertexTtsSampleRateHz ?? 24_000;
      const pcmBuffers: Buffer[] = [];
      const requests: Array<Record<string, unknown>> = [];
      let sampleRate = fallbackSampleRate;
      let sourceAudioMimeType: string | null = null;

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index] ?? [];
        const speakers = [...new Set(chunk.map((turn) => turn.speaker).filter((speaker): speaker is string => Boolean(speaker)))];
        const text = chunkText(chunk);
        const payload = vertexTtsPayload(context, text, speakers);
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authHeaderValue}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          throw new Error(`Vertex Gemini TTS request failed with HTTP ${response.status}.`);
        }

        const inlineAudio = inlineAudioFromVertexResponse(await response.json() as unknown);

        if (!inlineAudio) {
          throw new Error('Vertex Gemini TTS response did not include inline audio data.');
        }

        sampleRate = sampleRateFromMimeType(inlineAudio.mimeType, fallbackSampleRate);
        sourceAudioMimeType ??= inlineAudio.mimeType;
        pcmBuffers.push(Buffer.from(inlineAudio.data, 'base64'));
        requests.push({
          index,
          speakerCount: speakers.length,
          speakers,
          characterCount: text.length,
          mimeType: inlineAudio.mimeType,
          sampleRate,
        });
      }

      const pcm = Buffer.concat(pcmBuffers);
      const wav = Buffer.concat([wavFromPcm(pcm, sampleRate), pcm]);
      const objectKey = `shows/${context.show.slug}/episodes/${context.episodeSlug}/audio-final.mp3`;
      const localPath = join(localAssetRoot(context.production), objectKey);
      const tempDir = await mkdtemp(join(tmpdir(), 'podcast-forge-final-audio-'));
      const wavPath = join(tempDir, 'vertex-gemini-tts.wav');

      try {
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(wavPath, wav);
        await execFileImpl('ffmpeg', [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          wavPath,
          '-af',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          '-codec:a',
          'libmp3lame',
          '-q:a',
          '2',
          localPath,
        ], { timeout });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      const bytes = await readFile(localPath);
      const warnings = finalAudioWarnings(context, chunks.length);

      return {
        provider,
        label: 'Final audio',
        mimeType: 'audio/mpeg',
        byteSize: bytes.byteLength,
        durationSeconds: durationSecondsForPcm(pcm.byteLength, sampleRate),
        checksum: checksum(bytes),
        localPath,
        objectKey,
        publicUrl: assetUrl(context.production.publicBaseUrl, objectKey),
        metadata: {
          adapter: provider,
          adapterKind: 'real-vertex-gemini-tts',
          model: vertexTtsModel(context.production),
          location: vertexLocation(context.production),
          endpoint: new URL(url).origin,
          voiceMap: context.show.cast.map((member) => ({ speaker: member.name, voice: member.voice })),
          scriptId: context.script.id,
          revisionId: context.revision.id,
          episodeId: context.episodeId,
          sampleRateHz: sampleRate,
          sourceAudioMimeType,
          chunkCount: chunks.length,
          requests,
          finalization: {
            inputFormat: 'pcm_s16le_wav',
            outputFormat: 'mp3',
            loudnorm: 'I=-16:TP=-1.5:LRA=11',
            ffmpeg: true,
          },
          warnings,
          generatedBy: 'vertex-gemini-tts-final-audio-adapter',
          publishable: true,
        },
      };
    },
  };
}

export const vertexGeminiTtsFinalAudioProvider: AudioFinalProvider = createVertexGeminiTtsFinalAudioProvider();

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
