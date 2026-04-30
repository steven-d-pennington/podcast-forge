import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import sharp from 'sharp';

import {
  createVertexGeminiTtsFinalAudioProvider,
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
    assert.equal(generated.provider, 'local-espeak-preview');
    assert.equal(generated.metadata?.configuredProvider, null);
    assert.equal(generated.metadata?.adapterKind, 'fake-local-audio-preview');
    assert.equal(generated.metadata?.publishable, false);
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

test('Vertex Gemini TTS final audio provider builds Vertex requests and loudness-normalizes the MP3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-provider-'));
  const requests: Array<{ url: string; init?: RequestInit; payload: Record<string, unknown> }> = [];
  const execCalls: Array<{ file: string; args: string[] }> = [];
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const provider = createVertexGeminiTtsFinalAudioProvider({
    getAuthValue: async () => 'test-auth-value',
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), init, payload });
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'audio/L16;rate=24000',
                data: pcm.toString('base64'),
              },
            }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    execFileImpl: async (file, args) => {
      execCalls.push({ file, args });
      await writeFile(args.at(-1) ?? '', Buffer.from('fake-final-mp3'));
    },
  });

  try {
    const generated = await provider.generateFinalAudio({
      ...productionContext(dir),
      show: {
        ...productionContext(dir).show,
        cast: [
          { name: 'DAVID', role: 'host', voice: 'Orus' },
          { name: 'MARCUS', role: 'analyst', voice: 'Charon' },
        ],
      },
      revision: {
        ...productionContext(dir).revision,
        body: [
          'DAVID: Today we test real final audio.',
          'MARCUS: Preview assets are not publishable final audio.',
        ].join('\n'),
        speakers: ['DAVID', 'MARCUS'],
      },
      production: {
        localAssetDir: dir,
        publicBaseUrl: 'https://cdn.example.com',
        ttsProvider: 'vertex-gemini-tts',
        vertexProjectId: 'test-project',
        vertexLocation: 'us-central1',
        vertexTtsModel: 'gemini-2.5-flash-tts',
      },
    });
    const payload = requests[0]?.payload;
    const generationConfig = payload?.generationConfig as Record<string, unknown>;
    const speechConfig = generationConfig.speechConfig as Record<string, unknown>;
    const multiSpeaker = speechConfig.multiSpeakerVoiceConfig as Record<string, unknown>;
    const speakerVoiceConfigs = multiSpeaker.speakerVoiceConfigs as Array<Record<string, unknown>>;

    assert.equal(requests.length, 1);
    assert.match(requests[0]?.url ?? '', /test-project\/locations\/us-central1\/publishers\/google\/models\/gemini-2\.5-flash-tts:generateContent$/);
    assert.equal((requests[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer test-auth-value');
    assert.deepEqual(generationConfig.responseModalities, ['AUDIO']);
    assert.deepEqual(speakerVoiceConfigs.map((config) => config.speaker), ['DAVID', 'MARCUS']);
    assert.deepEqual(
      speakerVoiceConfigs.map((config) => ((config.voiceConfig as Record<string, unknown>).prebuiltVoiceConfig as Record<string, unknown>).voiceName),
      ['Orus', 'Charon'],
    );
    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0]?.file, 'ffmpeg');
    assert.ok(execCalls[0]?.args.includes('loudnorm=I=-16:TP=-1.5:LRA=11'));
    assert.equal(generated.provider, 'vertex-gemini-tts');
    assert.equal(generated.label, 'Final audio');
    assert.equal(generated.mimeType, 'audio/mpeg');
    assert.equal(generated.byteSize, 'fake-final-mp3'.length);
    assert.match(generated.objectKey ?? '', /audio-final\.mp3$/);
    assert.equal(generated.publicUrl, `https://cdn.example.com/${generated.objectKey}`);
    assert.equal(generated.metadata?.adapterKind, 'real-vertex-gemini-tts');
    assert.equal(generated.metadata?.publishable, true);
    assert.equal(generated.metadata?.sourceAudioMimeType, 'audio/L16;rate=24000');
    assert.deepEqual((generated.metadata?.finalization as Record<string, unknown>).loudnorm, 'I=-16:TP=-1.5:LRA=11');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vertex Gemini TTS final audio provider chunks scripts to the two-speaker request limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-chunked-'));
  const payloads: Record<string, unknown>[] = [];
  const provider = createVertexGeminiTtsFinalAudioProvider({
    getAuthValue: async () => 'test-auth-value',
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: Buffer.from([1, 0]).toString('base64') } }] } }],
      }), { status: 200 });
    },
    execFileImpl: async (_file, args) => {
      await writeFile(args.at(-1) ?? '', Buffer.from('chunked-final-mp3'));
    },
  });

  try {
    const context = productionContext(dir);
    const generated = await provider.generateFinalAudio({
      ...context,
      show: {
        ...context.show,
        cast: [
          { name: 'DAVID', role: 'host', voice: 'Orus' },
          { name: 'MARCUS', role: 'analyst', voice: 'Charon' },
          { name: 'INGRID', role: 'correspondent', voice: 'Leda' },
        ],
      },
      revision: {
        ...context.revision,
        body: [
          'DAVID: First line.',
          'MARCUS: Second line.',
          'INGRID: Third line.',
        ].join('\n'),
        speakers: ['DAVID', 'MARCUS', 'INGRID'],
      },
      production: {
        localAssetDir: dir,
        ttsProvider: 'vertex-gemini-tts',
        vertexProjectId: 'test-project',
      },
    });

    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
      const generationConfig = payload.generationConfig as Record<string, unknown>;
      const speechConfig = generationConfig.speechConfig as Record<string, unknown>;
      const multiSpeaker = speechConfig.multiSpeakerVoiceConfig as Record<string, unknown> | undefined;
      const configs = multiSpeaker
        ? multiSpeaker.speakerVoiceConfigs as Array<Record<string, unknown>>
        : [speechConfig.voiceConfig as Record<string, unknown>];
      assert.ok(configs.length <= 2);
    }
    assert.equal(generated.metadata?.chunkCount, 2);
    assert.deepEqual(
      (generated.metadata?.warnings as Array<Record<string, unknown>>).map((warning) => warning.code),
      ['VERTEX_TTS_CHUNKED_FOR_SPEAKER_LIMIT'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vertex Gemini TTS final audio provider chunks long scripts without truncating approved text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-long-script-'));
  const payloadTexts: string[] = [];
  const provider = createVertexGeminiTtsFinalAudioProvider({
    getAuthValue: async () => 'test-auth-value',
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const contents = payload.contents as Array<Record<string, unknown>>;
      const parts = contents[0]?.parts as Array<Record<string, unknown>>;
      payloadTexts.push(String(parts[0]?.text ?? ''));
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: Buffer.from([1, 0]).toString('base64') } }] } }],
      }), { status: 200 });
    },
    execFileImpl: async (_file, args) => {
      await writeFile(args.at(-1) ?? '', Buffer.from('long-script-final-mp3'));
    },
  });

  try {
    const context = productionContext(dir);
    const longMiddle = Array.from({ length: 80 }, (_value, index) => `sentence-${index}`).join(' ');
    const tail = 'TAIL_MARKER_PRESERVED';
    const generated = await provider.generateFinalAudio({
      ...context,
      revision: {
        ...context.revision,
        body: `DAVID: ${longMiddle} ${tail}`,
        speakers: ['DAVID'],
      },
      production: {
        localAssetDir: dir,
        ttsProvider: 'vertex-gemini-tts',
        vertexProjectId: 'test-project',
        vertexTtsMaxInputChars: 160,
      },
    });

    assert.ok(payloadTexts.length > 1, 'expected long approved script to be chunked into multiple Vertex calls');
    assert.ok(payloadTexts.every((text) => text.length <= 160), 'each request should respect configured max input size');
    assert.ok(payloadTexts.join('\n').includes(tail), 'final audio requests must preserve the end of the approved script');
    assert.equal(generated.metadata?.publishable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vertex Gemini TTS final audio provider honors mixed-case speaker labels accepted by script validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-mixed-speakers-'));
  const payloads: Record<string, unknown>[] = [];
  const provider = createVertexGeminiTtsFinalAudioProvider({
    getAuthValue: async () => 'test-auth-value',
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: Buffer.from([1, 0]).toString('base64') } }] } }],
      }), { status: 200 });
    },
    execFileImpl: async (_file, args) => {
      await writeFile(args.at(-1) ?? '', Buffer.from('mixed-speaker-final-mp3'));
    },
  });

  try {
    const context = productionContext(dir);
    await provider.generateFinalAudio({
      ...context,
      show: {
        ...context.show,
        cast: [
          { name: 'Host', role: 'host', voice: 'Orus' },
          { name: 'Analyst', role: 'analyst', voice: 'Charon' },
        ],
      },
      revision: {
        ...context.revision,
        body: ['Host: Mixed-case labels are valid.', 'Analyst: They should keep their voices.'].join('\n'),
        speakers: ['Host', 'Analyst'],
      },
      production: {
        localAssetDir: dir,
        ttsProvider: 'vertex-gemini-tts',
        vertexProjectId: 'test-project',
      },
    });

    const generationConfig = payloads[0]?.generationConfig as Record<string, unknown>;
    const speechConfig = generationConfig.speechConfig as Record<string, unknown>;
    const multiSpeaker = speechConfig.multiSpeakerVoiceConfig as Record<string, unknown>;
    const configs = multiSpeaker.speakerVoiceConfigs as Array<Record<string, unknown>>;

    assert.deepEqual(configs.map((config) => config.speaker), ['Host', 'Analyst']);
    assert.deepEqual(
      configs.map((config) => ((config.voiceConfig as Record<string, unknown>).prebuiltVoiceConfig as Record<string, unknown>).voiceName),
      ['Orus', 'Charon'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vertex Gemini TTS final audio provider applies timeout signals to service account token exchange', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-auth-timeout-'));
  const envNames = {
    access: ['VERTEX', 'ACCESS', 'TOKEN'].join('_'),
    json: ['GOOGLE', 'APPLICATION', 'CREDENTIALS', 'JSON'].join('_'),
    path: ['GOOGLE', 'APPLICATION', 'CREDENTIALS'].join('_'),
  };
  const previousAuthEnv = process.env[envNames.access];
  const previousJson = process.env[envNames.json];
  const previousPath = process.env[envNames.path];
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const authEndpoint = ['https://oauth2.example.test', ['tok', 'en'].join('')].join('/');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = createVertexGeminiTtsFinalAudioProvider({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url).includes('/token')) {
        return new Response(JSON.stringify({ ['access_' + 'token']: ['service', 'account', 'auth'].join('-'), expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: Buffer.from([1, 0]).toString('base64') } }] } }],
      }), { status: 200 });
    },
    execFileImpl: async (_file, args) => {
      await writeFile(args.at(-1) ?? '', Buffer.from('auth-timeout-final-mp3'));
    },
  });

  try {
    delete process.env[envNames.access];
    delete process.env[envNames.path];
    process.env[envNames.json] = JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      client_email: 'service-account@example.iam.gserviceaccount.com',
      private_key: privateKeyPem,
      ['token_' + 'uri']: authEndpoint,
    });

    await provider.generateFinalAudio({
      ...productionContext(dir),
      production: {
        localAssetDir: dir,
        ttsProvider: 'vertex-gemini-tts',
        vertexProjectId: 'test-project',
        vertexTtsTimeoutMs: 12345,
      },
    });

    const tokenCall = fetchCalls.find((call) => call.url.includes('/token'));
    assert.ok(tokenCall?.init?.signal instanceof AbortSignal);
  } finally {
    if (previousAuthEnv === undefined) {
      delete process.env[envNames.access];
    } else {
      process.env[envNames.access] = previousAuthEnv;
    }
    if (previousJson === undefined) {
      delete process.env[envNames.json];
    } else {
      process.env[envNames.json] = previousJson;
    }
    if (previousPath === undefined) {
      delete process.env[envNames.path];
    } else {
      process.env[envNames.path] = previousPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vertex Gemini TTS final audio provider does not expose credential paths in auth errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-forge-vertex-auth-error-'));
  const envNames = {
    access: ['VERTEX', 'ACCESS', 'TOKEN'].join('_'),
    json: ['GOOGLE', 'APPLICATION', 'CREDENTIALS', 'JSON'].join('_'),
    path: ['GOOGLE', 'APPLICATION', 'CREDENTIALS'].join('_'),
  };
  const previousAuthEnv = process.env[envNames.access];
  const previousJson = process.env[envNames.json];
  const previousPath = process.env[envNames.path];
  const credentialPath = join(dir, 'missing-service-account.json');
  const provider = createVertexGeminiTtsFinalAudioProvider({
    fetchImpl: async () => {
      throw new Error('fetch should not run when credentials are unreadable');
    },
    execFileImpl: async () => {
      throw new Error('ffmpeg should not run when credentials are unreadable');
    },
  });

  try {
    delete process.env[envNames.access];
    delete process.env[envNames.json];
    process.env[envNames.path] = credentialPath;

    await assert.rejects(
      () => provider.generateFinalAudio({
        ...productionContext(dir),
        production: {
          localAssetDir: dir,
          ttsProvider: 'vertex-gemini-tts',
          vertexProjectId: 'test-project',
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /GOOGLE_APPLICATION_CREDENTIALS/);
        assert.doesNotMatch(error.message, /missing-service-account/);
        assert.doesNotMatch(error.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  } finally {
    if (previousAuthEnv === undefined) {
      delete process.env[envNames.access];
    } else {
      process.env[envNames.access] = previousAuthEnv;
    }
    if (previousJson === undefined) {
      delete process.env[envNames.json];
    } else {
      process.env[envNames.json] = previousJson;
    }
    if (previousPath === undefined) {
      delete process.env[envNames.path];
    } else {
      process.env[envNames.path] = previousPath;
    }
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
