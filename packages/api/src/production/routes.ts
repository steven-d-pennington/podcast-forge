import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import type { ScriptRecord, ScriptRevisionRecord, ScriptStore } from '../scripts/store.js';
import type { SourceStore, ShowRecord } from '../sources/store.js';
import {
  deterministicAudioPreviewProvider,
  deterministicCoverArtProvider,
  type AudioPreviewProvider,
  type CoverArtProvider,
  type GeneratedProductionAsset,
  type ProductionConfig,
} from './providers.js';
import type {
  CreateEpisodeAssetInput,
  EpisodeRecord,
  ProductionStore,
} from './store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ProductionRoutesOptions {
  getStore(): SourceStore
    & Partial<SearchJobStore>
    & Partial<ModelProfileStore>
    & Partial<ScriptStore>
    & Partial<ProductionStore>;
  audioPreviewProvider?: AudioPreviewProvider;
  coverArtProvider?: CoverArtProvider;
}

const requestSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
});

function sendError(reply: FastifyReply, error: unknown, job?: JobRecord) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      ok: false,
      code: 'VALIDATION_ERROR',
      error: 'Request validation failed.',
      errors: error.issues,
      job,
    });
  }

  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
      job,
    });
  }

  const message = error instanceof Error ? error.message : 'Production job failed.';
  return reply.code(500).send({
    ok: false,
    code: 'PRODUCTION_JOB_FAILED',
    error: message,
    job,
  });
}

function requireScriptStore(store: Partial<ScriptStore>): Pick<ScriptStore, 'getScript' | 'getScriptRevision'> {
  if (typeof store.getScript !== 'function') {
    throw new ApiError(503, 'SCRIPT_STORE_UNAVAILABLE', 'Script store method is unavailable: getScript');
  }

  if (typeof store.getScriptRevision !== 'function') {
    throw new ApiError(503, 'SCRIPT_STORE_UNAVAILABLE', 'Script store method is unavailable: getScriptRevision');
  }

  return store as Pick<ScriptStore, 'getScript' | 'getScriptRevision'>;
}

function requireProductionStore(store: Partial<ProductionStore>): ProductionStore {
  const required: Array<keyof ProductionStore> = [
    'getEpisode',
    'getEpisodeForScript',
    'createEpisodeFromScript',
    'updateEpisodeProduction',
    'createEpisodeAsset',
    'listEpisodeAssets',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'PRODUCTION_STORE_UNAVAILABLE', `Production store method is unavailable: ${method}`);
    }
  }

  return store as ProductionStore;
}

function requireJobStore(store: Partial<SearchJobStore>): Pick<SearchJobStore, 'createJob' | 'updateJob' | 'getJob' | 'listJobs'> {
  const required: Array<keyof Pick<SearchJobStore, 'createJob' | 'updateJob' | 'getJob' | 'listJobs'>> = [
    'createJob',
    'updateJob',
    'getJob',
    'listJobs',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'JOB_STORE_UNAVAILABLE', `Job store method is unavailable: ${method}`);
    }
  }

  return store as Pick<SearchJobStore, 'createJob' | 'updateJob' | 'getJob' | 'listJobs'>;
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

async function updateJob(
  store: Pick<SearchJobStore, 'updateJob'>,
  id: string,
  input: UpdateJobInput,
) {
  return store.updateJob(id, input);
}

async function createJob(
  store: Pick<SearchJobStore, 'createJob'>,
  input: CreateJobInput,
) {
  return store.createJob(input);
}

async function getShow(store: SourceStore, id: string): Promise<ShowRecord> {
  const show = (await store.listShows()).find((candidate) => candidate.id === id);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${id}`);
  }

  return show;
}

function productionConfig(show: ShowRecord): ProductionConfig {
  const settingsProduction = show.settings.production;
  return settingsProduction && typeof settingsProduction === 'object' && !Array.isArray(settingsProduction)
    ? settingsProduction as ProductionConfig
    : {};
}

function assertApprovedScript(script: ScriptRecord): asserts script is ScriptRecord & { approvedRevisionId: string } {
  if (script.status !== 'approved-for-audio' || !script.approvedRevisionId) {
    throw new ApiError(409, 'SCRIPT_NOT_APPROVED_FOR_AUDIO', 'Script must be approved for audio before production jobs can run.');
  }
}

async function loadApprovedScript(
  scriptStore: Pick<ScriptStore, 'getScript' | 'getScriptRevision'>,
  scriptId: string,
) {
  const script = await scriptStore.getScript(scriptId);

  if (!script) {
    throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${scriptId}`);
  }

  assertApprovedScript(script);
  const revision = await scriptStore.getScriptRevision(script.approvedRevisionId);

  if (!revision || revision.scriptId !== script.id) {
    throw new ApiError(404, 'SCRIPT_REVISION_NOT_FOUND', `Script revision not found: ${script.approvedRevisionId}`);
  }

  return { script, revision };
}

async function getOrCreateEpisode(
  productionStore: ProductionStore,
  script: ScriptRecord,
  revision: ScriptRevisionRecord,
) {
  const existing = await productionStore.getEpisodeForScript(script.id, script.researchPacketId);

  if (existing) {
    return await productionStore.updateEpisodeProduction(existing.id, {
      scriptText: revision.body,
      scriptFormat: revision.format,
      metadata: {
        ...existing.metadata,
        scriptId: script.id,
        approvedRevisionId: revision.id,
      },
    }) ?? existing;
  }

  return productionStore.createEpisodeFromScript({
    showId: script.showId,
    researchPacketId: script.researchPacketId,
    scriptId: script.id,
    revisionId: revision.id,
    title: script.title,
    scriptText: revision.body,
    scriptFormat: revision.format,
  });
}

function modelProfileRecord(profile: Awaited<ReturnType<typeof resolveModelProfile>>): Record<string, unknown> {
  return profile ? { ...profile } : {};
}

function coverPrompt(show: ShowRecord, script: ScriptRecord, revision: ScriptRevisionRecord, modelProfile: Record<string, unknown>) {
  return [
    `${show.title} cover art for "${script.title}".`,
    `Editorial tone: sourced, restrained news analysis.`,
    `Script format: ${revision.format}.`,
    Object.keys(modelProfile).length > 0 ? `Prompt model: ${modelProfile.provider}/${modelProfile.model}.` : '',
  ].filter(Boolean).join(' ');
}

function assetInput(
  episode: EpisodeRecord,
  type: 'audio-preview' | 'cover-art',
  generated: GeneratedProductionAsset,
  metadata: Record<string, unknown>,
): CreateEpisodeAssetInput {
  return {
    episodeId: episode.id,
    type,
    label: generated.label,
    localPath: generated.localPath ?? null,
    objectKey: generated.objectKey ?? null,
    publicUrl: generated.publicUrl ?? null,
    mimeType: generated.mimeType,
    byteSize: generated.byteSize,
    durationSeconds: generated.durationSeconds ?? null,
    checksum: generated.checksum,
    metadata: {
      provider: generated.provider,
      ...generated.metadata,
      ...metadata,
    },
  };
}

export function registerProductionRoutes(app: FastifyInstance, options: ProductionRoutesOptions) {
  const audioPreviewProvider = options.audioPreviewProvider ?? deterministicAudioPreviewProvider;
  const coverArtProvider = options.coverArtProvider ?? deterministicCoverArtProvider;

  app.get<{ Params: { id: string } }>('/scripts/:id/production', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const scriptStore = requireScriptStore(rawStore);
      const productionStore = requireProductionStore(rawStore);
      const jobStore = requireJobStore(rawStore);
      const script = await scriptStore.getScript(request.params.id);

      if (!script) {
        throw new ApiError(404, 'SCRIPT_NOT_FOUND', `Script not found: ${request.params.id}`);
      }

      const episode = await productionStore.getEpisodeForScript(script.id, script.researchPacketId);
      const assets = episode ? await productionStore.listEpisodeAssets(episode.id) : [];
      const jobs = episode ? await jobStore.listJobs({ episodeId: episode.id, types: ['audio.preview', 'art.generate'] }) : [];

      return { ok: true, episode, assets, jobs };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/production/audio-preview', async (request, reply) => {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const rawStore = options.getStore();
      const body = requestSchema.parse(request.body ?? {});
      const scriptStore = requireScriptStore(rawStore);
      const productionStore = requireProductionStore(rawStore);
      jobStore = requireJobStore(rawStore);
      const { script, revision } = await loadApprovedScript(scriptStore, request.params.id);
      const show = await getShow(rawStore, script.showId);
      const episode = await getOrCreateEpisode(productionStore, script, revision);
      const production = productionConfig(show);

      logs.push(log('info', 'Starting audio.preview job.', {
        scriptId: script.id,
        revisionId: revision.id,
        episodeId: episode.id,
        provider: production.ttsProvider ?? 'vertex-gemini-tts',
      }));
      job = await createJob(jobStore, {
        showId: script.showId,
        episodeId: episode.id,
        type: 'audio.preview',
        status: 'running',
        progress: 5,
        attempts: 1,
        input: {
          scriptId: script.id,
          revisionId: revision.id,
          episodeId: episode.id,
          provider: production.ttsProvider ?? 'vertex-gemini-tts',
          actor: body.actor,
        },
        logs,
        startedAt: new Date(),
      });

      logs.push(log('info', 'Rendering preview audio.', { provider: production.ttsProvider ?? 'vertex-gemini-tts' }));
      job = await updateJob(jobStore, job.id, { progress: 45, logs }) ?? job;
      const generated = await audioPreviewProvider.generatePreviewAudio({ show, script, revision, episodeSlug: episode.slug, production });
      const asset = await productionStore.createEpisodeAsset(assetInput(episode, 'audio-preview', generated, {
        scriptId: script.id,
        revisionId: revision.id,
        jobId: job.id,
      }));
      const updatedEpisode = await productionStore.updateEpisodeProduction(episode.id, {
        status: 'audio-ready',
        durationSeconds: asset.durationSeconds,
        metadata: {
          ...episode.metadata,
          scriptId: script.id,
          approvedRevisionId: revision.id,
          audioPreviewAssetId: asset.id,
        },
      }) ?? episode;

      logs.push(log('info', 'Completed audio.preview job.', {
        assetId: asset.id,
        publicUrl: asset.publicUrl,
      }));
      job = await updateJob(jobStore, job.id, {
        status: 'succeeded',
        progress: 100,
        logs,
        output: {
          episodeId: updatedEpisode.id,
          assetId: asset.id,
          publicUrl: asset.publicUrl,
          objectKey: asset.objectKey,
          durationSeconds: asset.durationSeconds,
        },
        finishedAt: new Date(),
      }) ?? job;

      return reply.code(201).send({ ok: true, job, episode: updatedEpisode, asset });
    } catch (error) {
      if (jobStore && job) {
        const message = error instanceof Error ? error.message : 'Audio preview job failed.';
        logs.push(log('error', message));
        job = await updateJob(jobStore, job.id, {
          status: 'failed',
          progress: job.progress,
          logs,
          error: message,
          finishedAt: new Date(),
        }) ?? job;
      }

      return sendError(reply, error, job);
    }
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/production/cover-art', async (request, reply) => {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];

    try {
      const rawStore = options.getStore();
      const body = requestSchema.parse(request.body ?? {});
      const scriptStore = requireScriptStore(rawStore);
      const productionStore = requireProductionStore(rawStore);
      jobStore = requireJobStore(rawStore);
      const { script, revision } = await loadApprovedScript(scriptStore, request.params.id);
      const show = await getShow(rawStore, script.showId);
      const episode = await getOrCreateEpisode(productionStore, script, revision);
      const production = productionConfig(show);
      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: show.id, role: 'cover_prompt_writer' })
        : undefined;
      const prompt = coverPrompt(show, script, revision, modelProfileRecord(modelProfile));

      logs.push(log('info', 'Starting art.generate job.', {
        scriptId: script.id,
        revisionId: revision.id,
        episodeId: episode.id,
        provider: production.artProvider ?? 'configured-art-provider',
        modelProfileId: modelProfile?.id,
      }));
      job = await createJob(jobStore, {
        showId: script.showId,
        episodeId: episode.id,
        type: 'art.generate',
        status: 'running',
        progress: 5,
        attempts: 1,
        input: {
          scriptId: script.id,
          revisionId: revision.id,
          episodeId: episode.id,
          provider: production.artProvider ?? 'configured-art-provider',
          prompt,
          modelProfile,
          actor: body.actor,
        },
        logs,
        startedAt: new Date(),
      });

      logs.push(log('info', 'Generating cover art.', { provider: production.artProvider ?? 'configured-art-provider' }));
      job = await updateJob(jobStore, job.id, { progress: 50, logs }) ?? job;
      const generated = await coverArtProvider.generateCoverArt({ show, script, revision, episodeSlug: episode.slug, production, prompt });
      const asset = await productionStore.createEpisodeAsset(assetInput(episode, 'cover-art', generated, {
        scriptId: script.id,
        revisionId: revision.id,
        jobId: job.id,
        modelProfile,
      }));
      const updatedEpisode = await productionStore.updateEpisodeProduction(episode.id, {
        metadata: {
          ...episode.metadata,
          scriptId: script.id,
          approvedRevisionId: revision.id,
          coverArtAssetId: asset.id,
        },
      }) ?? episode;

      logs.push(log('info', 'Completed art.generate job.', {
        assetId: asset.id,
        publicUrl: asset.publicUrl,
      }));
      job = await updateJob(jobStore, job.id, {
        status: 'succeeded',
        progress: 100,
        logs,
        output: {
          episodeId: updatedEpisode.id,
          assetId: asset.id,
          publicUrl: asset.publicUrl,
          objectKey: asset.objectKey,
          modelProfile,
        },
        finishedAt: new Date(),
      }) ?? job;

      return reply.code(201).send({ ok: true, job, episode: updatedEpisode, asset });
    } catch (error) {
      if (jobStore && job) {
        const message = error instanceof Error ? error.message : 'Cover art job failed.';
        logs.push(log('error', message));
        job = await updateJob(jobStore, job.id, {
          status: 'failed',
          progress: job.progress,
          logs,
          error: message,
          finishedAt: new Date(),
        }) ?? job;
      }

      return sendError(reply, error, job);
    }
  });
}
