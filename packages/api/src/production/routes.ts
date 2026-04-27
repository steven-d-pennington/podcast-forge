import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { LlmJsonOutputError, LlmRuntimeError, type LlmRuntime } from '../llm/types.js';
import { hasModelProfileStore, resolveModelProfile } from '../models/resolver.js';
import type { ModelProfileStore } from '../models/store.js';
import { createPromptRegistry } from '../prompts/registry.js';
import { PromptRenderError, renderPromptTemplate } from '../prompts/renderer.js';
import { PROMPT_OUTPUT_SCHEMAS, type CoverPromptResult } from '../prompts/schemas.js';
import type { PromptTemplateStore } from '../prompts/types.js';
import type { ResearchPacketRecord, ResearchStore } from '../research/store.js';
import type { CreateJobInput, JobRecord, SearchJobStore, UpdateJobInput } from '../search/store.js';
import { integrityGateState } from '../scripts/integrity.js';
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
import {
  createPublishStorageAdapter,
  defaultPublishObjectKey,
  localRssUpdateAdapter,
  op3Wrap,
  strictPublicUrlValidator,
  type PublishStorageAdapter,
  type PublishUrlValidator,
  type RssUpdateAdapter,
  type UploadedPublishAsset,
} from './publishing.js';
import type {
  CreateEpisodeAssetInput,
  EpisodeAssetRecord,
  EpisodeRecord,
  FeedRecord,
  PublishEventRecord,
  ProductionStore,
} from './store.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface ProductionRoutesOptions {
  getStore(): SourceStore
    & Partial<SearchJobStore>
    & Partial<ModelProfileStore>
    & Partial<PromptTemplateStore>
    & Partial<ResearchStore>
    & Partial<ScriptStore>
    & Partial<ProductionStore>;
  llmRuntime?: LlmRuntime;
  audioPreviewProvider?: AudioPreviewProvider;
  coverArtProvider?: CoverArtProvider;
  publishStorageAdapterFactory?: (feed: FeedRecord) => PublishStorageAdapter;
  rssUpdateAdapter?: RssUpdateAdapter;
  publishUrlValidator?: PublishUrlValidator;
}

const requestSchema = z.object({
  actor: z.string().trim().min(1).default('local-user'),
  retryOfJobId: z.string().trim().min(1).optional(),
});
const approvePublishSchema = requestSchema.extend({
  reason: z.string().trim().min(1).optional(),
});
const publishRssSchema = requestSchema.extend({
  feedId: z.string().trim().min(1).optional(),
  changelog: z.string().trim().min(1).optional(),
  republish: z.boolean().default(false),
});
const coverArtSchema = requestSchema.extend({
  prompt: z.string().trim().min(1).optional(),
  artDirection: z.string().trim().min(1).optional(),
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
      ...error.details,
      job,
    });
  }

  if (error instanceof LlmJsonOutputError) {
    return reply.code(502).send({
      ok: false,
      code: 'MALFORMED_MODEL_OUTPUT',
      error: error.message,
      details: error.details,
      metadata: error.metadata,
      job,
    });
  }

  if (error instanceof LlmRuntimeError) {
    return reply.code(502).send({
      ok: false,
      code: 'MODEL_INVOCATION_FAILED',
      error: error.message,
      metadata: error.metadata,
      job,
    });
  }

  if (error instanceof PromptRenderError) {
    return reply.code(500).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
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
    'listEpisodes',
    'getEpisodeForScript',
    'createEpisodeFromScript',
    'updateEpisodeProduction',
    'createEpisodeAsset',
    'listEpisodeAssets',
    'listFeeds',
    'getFeed',
    'approveEpisodeForPublish',
    'createPublishEvent',
    'updatePublishEvent',
  ];

  for (const method of required) {
    if (typeof store[method] !== 'function') {
      throw new ApiError(503, 'PRODUCTION_STORE_UNAVAILABLE', `Production store method is unavailable: ${method}`);
    }
  }

  return store as ProductionStore;
}

async function resolveShowId(store: SourceStore, showId?: string, showSlug?: string): Promise<string> {
  if (showId) {
    const show = (await store.listShows()).find((candidate) => candidate.id === showId);

    if (!show) {
      throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showId}`);
    }

    return show.id;
  }

  if (!showSlug) {
    throw new ApiError(400, 'SHOW_FILTER_REQUIRED', 'Provide showId or showSlug.');
  }

  const show = (await store.listShows()).find((candidate) => candidate.slug === showSlug);

  if (!show) {
    throw new ApiError(404, 'SHOW_NOT_FOUND', `Show not found: ${showSlug}`);
  }

  return show.id;
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

function hasResearchStore(store: object): store is Pick<ResearchStore, 'getResearchPacket'> {
  return 'getResearchPacket' in store && typeof store.getResearchPacket === 'function';
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

function retryableFailure(error: unknown) {
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }

  if (error instanceof LlmJsonOutputError || error instanceof PromptRenderError) {
    return false;
  }

  if (error instanceof LlmRuntimeError) {
    return error.metadata.attempts.some((attempt) => attempt.error?.retryable);
  }

  return true;
}

function failureOutput(stage: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : 'Production job failed.';
  return {
    stage,
    retryable: retryableFailure(error),
    failure: {
      message,
      retryable: retryableFailure(error),
      code: error instanceof ApiError ? error.code : error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    },
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

function revisionValidation(revision: ScriptRevisionRecord) {
  const validation = revision.metadata.validation;
  return validation && typeof validation === 'object' && !Array.isArray(validation)
    ? validation as Record<string, unknown>
    : {};
}

function revisionWarnings(revision: ScriptRevisionRecord): Array<Record<string, unknown>> {
  const validation = revisionValidation(revision);
  const provenance = validation.provenance && typeof validation.provenance === 'object' && !Array.isArray(validation.provenance)
    ? validation.provenance as Record<string, unknown>
    : {};
  const warnings = provenance.warnings;

  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is Record<string, unknown> => {
      return Boolean(warning && typeof warning === 'object' && !Array.isArray(warning));
    })
    : [];
}

function assertRevisionReadyForAudio(revision: ScriptRevisionRecord) {
  if (!revision.body.trim()) {
    throw new ApiError(409, 'SCRIPT_REVISION_EMPTY', 'Approved script revision has no body to render.');
  }

  const validation = revisionValidation(revision);
  if (validation.readyForAudio === false) {
    throw new ApiError(409, 'SCRIPT_REVISION_NOT_READY_FOR_AUDIO', 'Approved script revision failed readiness validation.', {
      validation,
    });
  }

  const integrity = integrityGateState(revision);
  if (integrity.blocking) {
    throw new ApiError(
      409,
      integrity.status === 'missing' ? 'INTEGRITY_REVIEW_REQUIRED' : 'INTEGRITY_REVIEW_BLOCKED',
      integrity.status === 'missing'
        ? 'Approved script revision requires an integrity review or explicit override before production jobs can run.'
        : 'Approved script revision has blocking integrity review issues that must be fixed or explicitly overridden before production jobs can run.',
      {
        integrityReview: integrity.review,
        blockedReasons: [{
          code: integrity.status === 'missing' ? 'INTEGRITY_REVIEW_REQUIRED' : 'INTEGRITY_REVIEW_BLOCKED',
          message: integrity.status === 'missing'
            ? 'Run the integrity reviewer for the approved script revision.'
            : 'Resolve the failed integrity review or record an explicit override reason.',
          metadata: {
            status: integrity.status,
            revisionId: revision.id,
          },
        }],
      },
    );
  }
}

function assertEpisodeReadyForPublishApproval(episode: EpisodeRecord) {
  if (!['audio-ready', 'approved-for-publish', 'published'].includes(episode.status)) {
    throw new ApiError(409, 'EPISODE_NOT_AUDIO_READY', 'Episode must have production audio before publish approval.');
  }
}

function assertApprovedForPublish(episode: EpisodeRecord) {
  if (episode.status === 'approved-for-publish') {
    return;
  }

  if (episode.status === 'published' && episode.feedGuid) {
    return;
  }

  throw new ApiError(409, 'EPISODE_NOT_APPROVED_FOR_PUBLISH', 'Episode must be approved for publish before RSS publishing can run.');
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

  assertRevisionReadyForAudio(revision);

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

function scriptExcerpt(revision: ScriptRevisionRecord) {
  return revision.body.length > 1500 ? `${revision.body.slice(0, 1500)}...` : revision.body;
}

function coverPrompt(
  show: ShowRecord,
  script: ScriptRecord,
  revision: ScriptRevisionRecord,
  modelProfile: Record<string, unknown>,
  researchPacket?: ResearchPacketRecord | null,
  artDirection?: string,
) {
  return [
    `${show.title} cover art for "${script.title}".`,
    `Editorial tone: sourced, restrained news analysis.`,
    `Script format: ${revision.format}.`,
    researchPacket ? `Research packet: ${researchPacket.title}; status ${researchPacket.status}.` : '',
    artDirection ? `Art direction: ${artDirection}.` : '',
    Object.keys(modelProfile).length > 0 ? `Prompt model: ${modelProfile.provider}/${modelProfile.model}.` : '',
  ].filter(Boolean).join(' ');
}

async function resolveResearchPacket(
  store: object,
  script: ScriptRecord,
): Promise<ResearchPacketRecord | null> {
  if (!hasResearchStore(store)) {
    return null;
  }

  return await store.getResearchPacket(script.researchPacketId) ?? null;
}

async function resolveCoverPrompt(input: {
  store: SourceStore & Partial<ModelProfileStore> & Partial<PromptTemplateStore>;
  show: ShowRecord;
  script: ScriptRecord;
  revision: ScriptRevisionRecord;
  researchPacket: ResearchPacketRecord | null;
  providedPrompt?: string;
  artDirection?: string;
  llmRuntime?: LlmRuntime;
  modelProfile: Awaited<ReturnType<typeof resolveModelProfile>>;
}): Promise<{ prompt: string; promptResult?: CoverPromptResult; promptMetadata: Record<string, unknown> }> {
  if (input.providedPrompt) {
    return {
      prompt: input.providedPrompt,
      promptMetadata: {
        source: 'provided',
        artDirection: input.artDirection ?? null,
      },
    };
  }

  if (input.llmRuntime && input.modelProfile) {
    const rendered = await renderPromptTemplate(createPromptRegistry({ store: input.store }), {
      key: input.modelProfile.promptTemplateKey ?? undefined,
      role: input.modelProfile.promptTemplateKey ? undefined : 'cover_prompt_writer',
      showId: input.show.id,
      variables: {
        episode_metadata: {
          title: input.script.title,
          showTitle: input.show.title,
          format: input.revision.format,
          researchPacket: input.researchPacket
            ? {
              id: input.researchPacket.id,
              title: input.researchPacket.title,
              status: input.researchPacket.status,
              summary: input.researchPacket.content.summary,
              warnings: input.researchPacket.warnings,
            }
            : null,
        },
        script_excerpt: scriptExcerpt(input.revision),
        art_direction: input.artDirection ?? 'restrained editorial cover art for a news podcast episode',
      },
    });
    const result = await input.llmRuntime.generateJson<CoverPromptResult>({
      profile: input.modelProfile,
      messages: rendered.messages,
      schemaName: 'cover_prompt_result',
      schemaHint: PROMPT_OUTPUT_SCHEMAS.cover_prompt_result.schemaHint,
      validate: (value) => PROMPT_OUTPUT_SCHEMAS.cover_prompt_result.validate(value) as CoverPromptResult,
      requestMetadata: {
        scriptId: input.script.id,
        revisionId: input.revision.id,
        researchPacketId: input.researchPacket?.id ?? null,
        promptTemplateKey: rendered.template.key,
        promptTemplateVersion: rendered.template.version,
      },
    });

    return {
      prompt: result.value.prompt,
      promptResult: result.value,
      promptMetadata: {
        source: 'cover_prompt_writer',
        modelProfile: input.modelProfile,
        invocation: result.metadata,
        template: {
          key: rendered.template.key,
          version: rendered.template.version,
        },
        negativePrompt: result.value.negativePrompt ?? null,
        altText: result.value.altText,
        safetyNotes: result.value.safetyNotes,
        artDirection: input.artDirection ?? null,
      },
    };
  }

  return {
    prompt: coverPrompt(
      input.show,
      input.script,
      input.revision,
      modelProfileRecord(input.modelProfile),
      input.researchPacket,
      input.artDirection,
    ),
    promptMetadata: {
      source: 'deterministic-fallback',
      modelProfile: modelProfileRecord(input.modelProfile),
      artDirection: input.artDirection ?? null,
    },
  };
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

function selectAsset(assets: EpisodeAssetRecord[], types: Array<EpisodeAssetRecord['type']>, label: string) {
  const asset = assets.find((candidate) => types.includes(candidate.type));

  if (!asset) {
    throw new ApiError(409, 'EPISODE_ASSET_REQUIRED', `Episode is missing required ${label} asset.`);
  }

  return asset;
}

interface PublishBlockedReason {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function researchReadinessStatus(packet: ResearchPacketRecord) {
  const readiness = packet.content.readiness;
  const contentStatus = readiness && typeof readiness === 'object' && !Array.isArray(readiness)
    ? (readiness as Record<string, unknown>).status
    : undefined;

  return typeof contentStatus === 'string' ? contentStatus : packet.status;
}

function unresolvedResearchWarnings(packet: ResearchPacketRecord) {
  return packet.warnings.filter((warning) => !warning.override);
}

async function loadEpisodeResearchPacket(store: object, episode: EpisodeRecord) {
  if (!episode.researchPacketId) {
    return null;
  }

  if (!hasResearchStore(store)) {
    throw new ApiError(503, 'RESEARCH_STORE_UNAVAILABLE', 'Research store method is unavailable: getResearchPacket');
  }

  return store.getResearchPacket(episode.researchPacketId);
}

function researchBlockers(episode: EpisodeRecord, researchPacket: ResearchPacketRecord | null | undefined): PublishBlockedReason[] {
  if (!episode.researchPacketId) {
    return [{
      code: 'RESEARCH_BRIEF_REQUIRED',
      message: 'Episode must be linked to an approved research brief before publishing.',
    }];
  }

  if (!researchPacket) {
    return [{
      code: 'RESEARCH_BRIEF_NOT_FOUND',
      message: 'Linked research brief could not be loaded for publish review.',
      metadata: { researchPacketId: episode.researchPacketId },
    }];
  }

  const blockers: PublishBlockedReason[] = [];
  const readiness = researchReadinessStatus(researchPacket);
  const unresolvedWarnings = unresolvedResearchWarnings(researchPacket);

  if (!['ready', 'approved', 'research-ready'].includes(readiness)) {
    blockers.push({
      code: 'RESEARCH_BRIEF_NOT_READY',
      message: 'Research brief is not ready for publishing review.',
      metadata: { researchPacketId: researchPacket.id, status: researchPacket.status, readiness },
    });
  }

  if (!researchPacket.approvedAt) {
    blockers.push({
      code: 'RESEARCH_BRIEF_NOT_APPROVED',
      message: 'Research brief must have a recorded review decision before publishing.',
      metadata: { researchPacketId: researchPacket.id },
    });
  }

  if (unresolvedWarnings.length > 0) {
    blockers.push({
      code: 'RESEARCH_WARNINGS_UNRESOLVED',
      message: 'Research warnings must be resolved with explicit editorial overrides before publishing.',
      metadata: {
        researchPacketId: researchPacket.id,
        warningIds: unresolvedWarnings.map((warning) => warning.id),
      },
    });
  }

  return blockers;
}

function normalizedHttpUrl(value: string | null) {
  if (!value || value !== value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function validOptionalHttpUrl(value: string | null) {
  return !value || normalizedHttpUrl(value) !== null;
}

function resolvedAssetPublicUrl(feed: FeedRecord, episode: EpisodeRecord, asset: EpisodeAssetRecord) {
  if (asset.publicUrl) {
    return normalizedHttpUrl(asset.publicUrl);
  }

  const publicBaseUrl = normalizedHttpUrl(feed.publicBaseUrl);

  if (!publicBaseUrl) {
    return null;
  }

  return normalizedHttpUrl(`${publicBaseUrl.replace(/\/$/, '')}/${defaultPublishObjectKey(episode, asset).replace(/^\//, '')}`);
}

function resolvedRssPublicUrl(feed: FeedRecord) {
  const publicFeedUrl = normalizedHttpUrl(feed.publicFeedUrl);

  if (publicFeedUrl) {
    return publicFeedUrl;
  }

  const publicBaseUrl = normalizedHttpUrl(feed.publicBaseUrl);

  if (!publicBaseUrl || !feed.rssFeedPath) {
    return null;
  }

  return normalizedHttpUrl(`${publicBaseUrl.replace(/\/$/, '')}/feed.xml`);
}

function assertUploadedAssetReady(label: string, upload: UploadedPublishAsset) {
  const publicUrl = normalizedHttpUrl(upload.publicUrl);

  if (!publicUrl) {
    throw new ApiError(502, 'PUBLISHED_ASSET_URL_INVALID', `${label} upload returned a non-public URL.`, {
      upload,
    });
  }

  return { ...upload, publicUrl };
}

function publishBlockers(
  episode: EpisodeRecord,
  assets: EpisodeAssetRecord[],
  feed: FeedRecord | null,
  options: { republish: boolean; changelog?: string | null; requirePublishApproval?: boolean },
  researchPacket?: ResearchPacketRecord | null,
): PublishBlockedReason[] {
  const blockers: PublishBlockedReason[] = [];
  const audioAsset = assets.find((asset) => ['audio-final', 'audio-preview'].includes(asset.type));
  const coverAsset = assets.find((asset) => asset.type === 'cover-art');

  if (episode.status === 'published' && episode.feedGuid && !options.republish) {
    return [];
  }

  blockers.push(...researchBlockers(episode, researchPacket));

  if (episode.status === 'published' && options.republish && !options.changelog) {
    blockers.push({
      code: 'REPUBLISH_CHANGELOG_REQUIRED',
      message: 'Re-publishing an already published episode requires an explicit changelog.',
    });
  } else if (options.requirePublishApproval !== false && episode.status !== 'approved-for-publish' && !(episode.status === 'published' && episode.feedGuid)) {
    blockers.push({
      code: 'EPISODE_NOT_APPROVED_FOR_PUBLISH',
      message: 'Episode must be approved for publish before RSS publishing can run.',
      metadata: { status: episode.status },
    });
  }

  if (!feed) {
    blockers.push({
      code: 'PUBLISH_FEED_REQUIRED',
      message: 'Show has no configured RSS feed.',
    });
  } else {
    if (!validOptionalHttpUrl(feed.publicFeedUrl) || !validOptionalHttpUrl(feed.publicBaseUrl)) {
      blockers.push({
        code: 'PUBLISH_FEED_PUBLIC_URL_INVALID',
        message: 'Feed public URLs must be valid http(s) URLs when configured.',
        metadata: { publicFeedUrl: feed.publicFeedUrl, publicBaseUrl: feed.publicBaseUrl },
      });
    }

    if (!resolvedRssPublicUrl(feed)) {
      blockers.push({
        code: 'PUBLISH_FEED_PUBLIC_URL_REQUIRED',
        message: 'RSS publishing requires a public feed URL or a public base URL with an RSS feed path.',
        metadata: { publicFeedUrl: feed.publicFeedUrl, publicBaseUrl: feed.publicBaseUrl, rssFeedPath: feed.rssFeedPath },
      });
    }
  }

  if (!audioAsset) {
    blockers.push({
      code: 'AUDIO_ASSET_REQUIRED',
      message: 'Episode is missing required audio asset.',
    });
  } else {
    if (!audioAsset.mimeType?.startsWith('audio/')) {
      blockers.push({
        code: 'AUDIO_ASSET_MIME_INVALID',
        message: 'Audio asset must have an audio MIME type.',
        metadata: { assetId: audioAsset.id, mimeType: audioAsset.mimeType },
      });
    }

    if (audioAsset.byteSize !== null && audioAsset.byteSize <= 0) {
      blockers.push({
        code: 'AUDIO_ASSET_SIZE_INVALID',
        message: 'Audio asset byte size must be positive when known before RSS publishing.',
        metadata: { assetId: audioAsset.id, byteSize: audioAsset.byteSize },
      });
    }

    if (audioAsset.publicUrl && !normalizedHttpUrl(audioAsset.publicUrl)) {
      blockers.push({
        code: 'AUDIO_ASSET_PUBLIC_URL_INVALID',
        message: 'Audio asset public URL must be a valid http(s) URL when configured.',
        metadata: { assetId: audioAsset.id, publicUrl: audioAsset.publicUrl },
      });
    } else if (feed && !resolvedAssetPublicUrl(feed, episode, audioAsset)) {
      blockers.push({
        code: 'AUDIO_ASSET_PUBLIC_URL_REQUIRED',
        message: 'Audio asset needs a public URL or a feed public base URL before RSS publishing.',
        metadata: { assetId: audioAsset.id, objectKey: audioAsset.objectKey, publicBaseUrl: feed.publicBaseUrl },
      });
    }
  }

  if (!coverAsset) {
    blockers.push({
      code: 'COVER_ART_ASSET_REQUIRED',
      message: 'Episode is missing required cover art asset.',
    });
  } else if (!coverAsset.mimeType?.startsWith('image/')) {
    blockers.push({
      code: 'COVER_ART_ASSET_MIME_INVALID',
      message: 'Cover art asset must have an image MIME type.',
      metadata: { assetId: coverAsset.id, mimeType: coverAsset.mimeType },
    });
  } else if (coverAsset.publicUrl && !normalizedHttpUrl(coverAsset.publicUrl)) {
    blockers.push({
      code: 'COVER_ART_ASSET_PUBLIC_URL_INVALID',
      message: 'Cover art asset public URL must be a valid http(s) URL when configured.',
      metadata: { assetId: coverAsset.id, publicUrl: coverAsset.publicUrl },
    });
  } else if (feed && !resolvedAssetPublicUrl(feed, episode, coverAsset)) {
    blockers.push({
      code: 'COVER_ART_ASSET_PUBLIC_URL_REQUIRED',
      message: 'Cover art asset needs a public URL or a feed public base URL before RSS publishing.',
      metadata: { assetId: coverAsset.id, objectKey: coverAsset.objectKey, publicBaseUrl: feed.publicBaseUrl },
    });
  }

  return blockers;
}

async function resolveFeed(
  productionStore: ProductionStore,
  episode: EpisodeRecord,
  requestedFeedId?: string,
) {
  const feedId = requestedFeedId ?? episode.feedId ?? undefined;

  if (feedId) {
    const feed = await productionStore.getFeed(feedId);

    if (!feed) {
      throw new ApiError(404, 'FEED_NOT_FOUND', `Feed not found: ${feedId}`);
    }

    if (feed.showId !== episode.showId) {
      throw new ApiError(409, 'FEED_SHOW_MISMATCH', 'Publish feed does not belong to the episode show.');
    }

    return feed;
  }

  const feeds = await productionStore.listFeeds(episode.showId);
  const feed = feeds[0];

  if (!feed) {
    throw new ApiError(409, 'PUBLISH_FEED_REQUIRED', 'Show has no configured RSS feed.');
  }

  return feed;
}

async function maybeResolveFeed(
  productionStore: ProductionStore,
  episode: EpisodeRecord,
  requestedFeedId?: string,
) {
  try {
    return await resolveFeed(productionStore, episode, requestedFeedId);
  } catch (error) {
    if (error instanceof ApiError && ['PUBLISH_FEED_REQUIRED', 'FEED_NOT_FOUND', 'FEED_SHOW_MISMATCH'].includes(error.code)) {
      return null;
    }

    throw error;
  }
}

function feedGuid(episode: EpisodeRecord, feed: FeedRecord) {
  return episode.feedGuid ?? `podcast-forge:${feed.id}:${episode.id}`;
}

export function registerProductionRoutes(app: FastifyInstance, options: ProductionRoutesOptions) {
  const audioPreviewProvider = options.audioPreviewProvider ?? deterministicAudioPreviewProvider;
  const coverArtProvider = options.coverArtProvider ?? deterministicCoverArtProvider;
  const rssUpdateAdapter = options.rssUpdateAdapter ?? localRssUpdateAdapter;
  const urlValidator = options.publishUrlValidator ?? strictPublicUrlValidator;

  app.get<{ Querystring: { showId?: string; showSlug?: string; limit?: string } }>('/episodes', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const productionStore = requireProductionStore(rawStore);
      const showId = await resolveShowId(rawStore, request.query.showId, request.query.showSlug);
      const parsedLimit = request.query.limit ? Number(request.query.limit) : undefined;
      const limit = parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
      const episodeRows = await productionStore.listEpisodes({ showId, limit });

      return { ok: true, episodes: episodeRows };
    } catch (error) {
      return sendError(reply, error);
    }
  });

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

  app.post<{ Params: { id: string } }>('/episodes/:id/approve-for-publish', async (request, reply) => {
    try {
      const rawStore = options.getStore();
      const body = approvePublishSchema.parse(request.body ?? {});
      const productionStore = requireProductionStore(rawStore);
      const episode = await productionStore.getEpisode(request.params.id);

      if (!episode) {
        throw new ApiError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${request.params.id}`);
      }

      assertEpisodeReadyForPublishApproval(episode);
      const assets = await productionStore.listEpisodeAssets(episode.id);
      const feed = await maybeResolveFeed(productionStore, episode);
      const researchPacket = await loadEpisodeResearchPacket(rawStore, episode);
      const blockers = publishBlockers(episode, assets, feed, { republish: false, requirePublishApproval: false }, researchPacket);

      if (blockers.length > 0) {
        throw new ApiError(409, 'PUBLISH_APPROVAL_BLOCKED', 'Episode cannot be approved for publishing until checklist items are complete.', {
          blockedReasons: blockers,
        });
      }

      const approved = await productionStore.approveEpisodeForPublish(episode.id, {
        actor: body.actor,
        reason: body.reason ?? null,
        metadata: {
          previousStatus: episode.status,
        },
      });

      return reply.code(201).send({ ok: true, episode: approved });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/episodes/:id/publish/rss', async (request, reply) => {
    let job: JobRecord | undefined;
    let publishEvent: PublishEventRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    let productionStore: ProductionStore | undefined;
    const logs: Array<Record<string, unknown>> = [];
    let stage = 'initializing';

    try {
      const rawStore = options.getStore();
      const body = publishRssSchema.parse(request.body ?? {});
      productionStore = requireProductionStore(rawStore);
      jobStore = requireJobStore(rawStore);
      const episode = await productionStore.getEpisode(request.params.id);

      if (!episode) {
        throw new ApiError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${request.params.id}`);
      }

      const assets = await productionStore.listEpisodeAssets(episode.id);
      const maybeFeed = await maybeResolveFeed(productionStore, episode, body.feedId);
      const researchPacket = await loadEpisodeResearchPacket(rawStore, episode);
      const blockers = publishBlockers(episode, assets, maybeFeed, {
        republish: body.republish,
        changelog: body.changelog ?? null,
      }, researchPacket);

      if (blockers.length > 0) {
        throw new ApiError(409, 'PUBLISH_BLOCKED', 'Episode cannot be published until blocking issues are resolved.', {
          blockedReasons: blockers,
        });
      }

      const feed = maybeFeed;

      if (!feed) {
        throw new ApiError(409, 'PUBLISH_BLOCKED', 'Episode cannot be published until blocking issues are resolved.', {
          blockedReasons: [{
            code: 'PUBLISH_FEED_REQUIRED',
            message: 'Show has no configured RSS feed.',
          }],
        });
      }

      const audioAsset = selectAsset(assets, ['audio-final', 'audio-preview'], 'audio');
      const coverAsset = selectAsset(assets, ['cover-art'], 'cover art');
      const guid = feedGuid(episode, feed);
      const expectedRssUrl = resolvedRssPublicUrl(feed) ?? '';

      const storageAdapter = options.publishStorageAdapterFactory?.(feed) ?? createPublishStorageAdapter(feed);

      if (episode.status === 'published' && episode.feedGuid && !body.republish) {
        const previousPublish = episode.metadata.publish && typeof episode.metadata.publish === 'object' && !Array.isArray(episode.metadata.publish)
          ? episode.metadata.publish as Record<string, unknown>
          : {};

        logs.push(log('info', 'Episode is already published; returning idempotent publish result.', {
          episodeId: episode.id,
          feedId: feed.id,
          feedGuid: guid,
          actor: body.actor,
        }));
        job = await createJob(jobStore, {
          showId: episode.showId,
          episodeId: episode.id,
          type: 'publish.rss',
          status: 'running',
          progress: 0,
          attempts: 1,
          input: {
            stage: 'idempotent',
            episodeId: episode.id,
            feedId: feed.id,
            feedGuid: guid,
            actor: body.actor,
            republish: false,
            changelog: body.changelog ?? null,
          },
          logs,
          startedAt: new Date(),
        });
        job = await updateJob(jobStore, job.id, {
          status: 'succeeded',
          progress: 100,
          logs,
          output: {
            stage: 'idempotent',
            idempotent: true,
            episodeId: episode.id,
            feedId: feed.id,
            feedGuid: guid,
            audioUrl: previousPublish.audioUrl ?? null,
            unwrappedAudioUrl: previousPublish.unwrappedAudioUrl ?? null,
            coverUrl: previousPublish.coverUrl ?? null,
            rssUrl: previousPublish.rssUrl ?? feed.publicFeedUrl,
            rssInserted: false,
          },
          finishedAt: new Date(),
        }) ?? job;

        return reply.code(200).send({
          ok: true,
          idempotent: true,
          job,
          episode,
          publishEvent: null,
        });
      }

      logs.push(log('info', 'Starting publish.rss job.', {
        episodeId: episode.id,
        feedId: feed.id,
        feedGuid: guid,
        actor: body.actor,
        republish: body.republish,
      }));
      job = await createJob(jobStore, {
        showId: episode.showId,
        episodeId: episode.id,
        type: 'publish.rss',
        status: 'running',
        progress: 5,
        attempts: 1,
        input: {
          episodeId: episode.id,
          feedId: feed.id,
          feedGuid: guid,
          actor: body.actor,
          changelog: body.changelog ?? null,
          republish: body.republish,
          stage,
        },
        logs,
        startedAt: new Date(),
      });
      publishEvent = await productionStore.createPublishEvent({
        episodeId: episode.id,
        feedId: feed.id,
        status: 'started',
        feedGuid: guid,
        changelog: body.changelog ?? null,
        metadata: {
          jobId: job.id,
          actor: body.actor,
          republish: body.republish,
        },
      });

      stage = 'uploading-assets';
      logs.push(log('info', 'Uploading publish assets.', {
        audioAssetId: audioAsset.id,
        coverAssetId: coverAsset.id,
      }));
      job = await updateJob(jobStore, job.id, {
        progress: 35,
        logs,
        output: { stage },
      }) ?? job;
      const [rawAudioUpload, rawCoverUpload] = await Promise.all([
        storageAdapter.uploadAsset({ feed, episode, asset: audioAsset }),
        storageAdapter.uploadAsset({ feed, episode, asset: coverAsset }),
      ]);
      const audioUpload = assertUploadedAssetReady('Audio asset', rawAudioUpload);
      const coverUpload = assertUploadedAssetReady('Cover art asset', rawCoverUpload);
      const audioByteSize = audioUpload.byteSize ?? audioAsset.byteSize;

      if (audioByteSize === null || audioByteSize <= 0) {
        throw new ApiError(502, 'PUBLISHED_ASSET_SIZE_INVALID', 'Audio upload did not provide a positive byte size.', {
          assetId: audioAsset.id,
          uploadByteSize: audioUpload.byteSize,
          assetByteSize: audioAsset.byteSize,
        });
      }

      const rssAudioUrl = feed.op3Wrap ? op3Wrap(audioUpload.publicUrl) : audioUpload.publicUrl;

      stage = 'validating-public-urls';
      logs.push(log('info', 'Validating publish URLs before RSS mutation.', {
        audioUrl: rssAudioUrl,
        coverUrl: coverUpload.publicUrl,
        rssUrl: expectedRssUrl,
      }));
      job = await updateJob(jobStore, job.id, {
        progress: 65,
        logs,
        output: { stage },
      }) ?? job;
      const validations = await urlValidator.validate([rssAudioUrl, coverUpload.publicUrl, expectedRssUrl]);
      const invalidUrl = validations.find((validation) => !validation.ok);

      if (invalidUrl) {
        throw new ApiError(502, 'PUBLISHED_URL_VALIDATION_FAILED', `Published URL failed validation: ${invalidUrl.url}`);
      }

      stage = 'updating-rss';
      logs.push(log('info', 'Updating RSS feed.', {
        op3Wrapped: feed.op3Wrap,
        audioUrl: rssAudioUrl,
        coverUrl: coverUpload.publicUrl,
      }));
      job = await updateJob(jobStore, job.id, {
        progress: 70,
        logs,
        output: { stage },
      }) ?? job;
      const publishedAt = episode.publishedAt ?? new Date();
      const rss = await rssUpdateAdapter.upsertEpisode({
        feed,
        episode,
        entry: {
          guid,
          title: episode.title,
          description: episode.description ?? episode.title,
          audioUrl: rssAudioUrl,
          audioMimeType: audioAsset.mimeType ?? 'audio/mpeg',
          audioByteSize,
          coverUrl: coverUpload.publicUrl,
          durationSeconds: audioAsset.durationSeconds ?? episode.durationSeconds,
          publishedAt,
        },
      });
      const finalRssUrl = normalizedHttpUrl(rss.rssUrl);

      if (!finalRssUrl) {
        throw new ApiError(502, 'PUBLISHED_URL_VALIDATION_FAILED', `RSS adapter returned a non-public feed URL: ${rss.rssUrl}`);
      }

      const finalRssValidations = finalRssUrl === expectedRssUrl
        ? []
        : await urlValidator.validate([finalRssUrl]);
      const finalInvalidUrl = finalRssValidations.find((validation) => !validation.ok);

      if (finalInvalidUrl) {
        throw new ApiError(502, 'PUBLISHED_URL_VALIDATION_FAILED', `Published RSS URL failed validation: ${finalInvalidUrl.url}`);
      }

      const publishValidations = [...validations, ...finalRssValidations];

      const updatedEpisode = await productionStore.updateEpisodeProduction(episode.id, {
        feedId: feed.id,
        status: 'published',
        publishedAt,
        feedGuid: guid,
        metadata: {
          ...episode.metadata,
          publish: {
            feedId: feed.id,
            feedGuid: guid,
            jobId: job.id,
            publishEventId: publishEvent.id,
            rssUrl: finalRssUrl,
            audioUrl: rssAudioUrl,
            unwrappedAudioUrl: audioUpload.publicUrl,
            coverUrl: coverUpload.publicUrl,
            op3Wrapped: feed.op3Wrap,
            op3: {
              enabled: feed.op3Wrap,
              originalAudioUrl: audioUpload.publicUrl,
              wrappedAudioUrl: rssAudioUrl,
            },
            republished: body.republish,
            changelog: body.changelog ?? null,
            validatedUrls: publishValidations,
          },
        },
      }) ?? episode;
      publishEvent = await productionStore.updatePublishEvent(publishEvent.id, {
        status: 'succeeded',
        feedGuid: guid,
        audioUrl: rssAudioUrl,
        coverUrl: coverUpload.publicUrl,
        rssUrl: finalRssUrl,
        metadata: {
          ...publishEvent.metadata,
          jobId: job.id,
          actor: body.actor,
          audioUpload,
          coverUpload,
          rss,
          op3: {
            enabled: feed.op3Wrap,
            originalAudioUrl: audioUpload.publicUrl,
            wrappedAudioUrl: rssAudioUrl,
          },
          validatedUrls: publishValidations,
        },
      }) ?? publishEvent;

      logs.push(log('info', 'Completed publish.rss job.', {
        publishEventId: publishEvent.id,
        rssUrl: finalRssUrl,
        inserted: rss.inserted,
      }));
      job = await updateJob(jobStore, job.id, {
        status: 'succeeded',
        progress: 100,
        logs,
        output: {
          stage: 'completed',
          episodeId: updatedEpisode.id,
          feedId: feed.id,
          publishEventId: publishEvent.id,
          feedGuid: guid,
          audioUrl: rssAudioUrl,
          unwrappedAudioUrl: audioUpload.publicUrl,
          coverUrl: coverUpload.publicUrl,
          rssUrl: finalRssUrl,
          rssInserted: rss.inserted,
          validatedUrls: publishValidations,
        },
        finishedAt: new Date(),
      }) ?? job;

      return reply.code(201).send({ ok: true, job, episode: updatedEpisode, publishEvent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RSS publish job failed.';

      if (jobStore && job) {
        logs.push(log('error', message));
        job = await updateJob(jobStore, job.id, {
          status: 'failed',
          progress: job.progress,
          logs,
          error: message,
          output: failureOutput(stage, error, {
            episodeId: job.episodeId,
            publishEventId: publishEvent?.id ?? null,
          }),
          finishedAt: new Date(),
        }) ?? job;
      }

      if (productionStore && publishEvent) {
        publishEvent = await productionStore.updatePublishEvent(publishEvent.id, {
          status: 'failed',
          error: message,
        }) ?? publishEvent;
      }

      return sendError(reply, error, job);
    }
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/production/audio-preview', async (request, reply) => {
    let job: JobRecord | undefined;
    let jobStore: Pick<SearchJobStore, 'createJob' | 'updateJob'> | undefined;
    const logs: Array<Record<string, unknown>> = [];
    let stage = 'initializing';

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
      const warnings = revisionWarnings(revision);
      const integrityReview = integrityGateState(revision);

      logs.push(log('info', 'Starting audio.preview job.', {
        scriptId: script.id,
        revisionId: revision.id,
        episodeId: episode.id,
        provider: production.ttsProvider ?? 'vertex-gemini-tts',
        warningCount: warnings.length,
        integrityStatus: integrityReview.status,
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
          retryOfJobId: body.retryOfJobId,
          stage,
          warnings,
          integrityReview,
        },
        logs,
        startedAt: new Date(),
      });

      stage = 'rendering-audio';
      logs.push(log('info', 'Rendering preview audio.', { provider: production.ttsProvider ?? 'vertex-gemini-tts' }));
      job = await updateJob(jobStore, job.id, { progress: 45, logs, output: { stage } }) ?? job;
      const generated = await audioPreviewProvider.generatePreviewAudio({
        show,
        script,
        revision,
        episodeId: episode.id,
        episodeSlug: episode.slug,
        production,
      });
      stage = 'persisting-asset';
      const asset = await productionStore.createEpisodeAsset(assetInput(episode, 'audio-preview', generated, {
        scriptId: script.id,
        revisionId: revision.id,
        jobId: job.id,
        warnings,
        integrityReview,
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
          stage: 'completed',
          episodeId: updatedEpisode.id,
          assetId: asset.id,
          publicUrl: asset.publicUrl,
          objectKey: asset.objectKey,
          durationSeconds: asset.durationSeconds,
          byteSize: asset.byteSize,
          mimeType: asset.mimeType,
          checksum: asset.checksum,
          provider: asset.metadata.provider,
          adapter: asset.metadata.adapter,
          retryable: false,
          warnings,
          integrityReview,
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
          output: failureOutput(stage, error, {
            scriptId: request.params.id,
            provider: job.input.provider,
          }),
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
    let stage = 'initializing';

    try {
      const rawStore = options.getStore();
      const body = coverArtSchema.parse(request.body ?? {});
      const scriptStore = requireScriptStore(rawStore);
      const productionStore = requireProductionStore(rawStore);
      jobStore = requireJobStore(rawStore);
      const { script, revision } = await loadApprovedScript(scriptStore, request.params.id);
      const show = await getShow(rawStore, script.showId);
      const episode = await getOrCreateEpisode(productionStore, script, revision);
      const researchPacket = await resolveResearchPacket(rawStore, script);
      const production = productionConfig(show);
      const integrityReview = integrityGateState(revision);
      const modelProfile = hasModelProfileStore(rawStore)
        ? await resolveModelProfile(rawStore, { showId: show.id, role: 'cover_prompt_writer' })
        : undefined;
      const resolvedPrompt = await resolveCoverPrompt({
        store: rawStore,
        show,
        script,
        revision,
        researchPacket,
        providedPrompt: body.prompt,
        artDirection: body.artDirection,
        llmRuntime: options.llmRuntime,
        modelProfile,
      });
      const prompt = resolvedPrompt.prompt;

      logs.push(log('info', 'Starting art.generate job.', {
        scriptId: script.id,
        revisionId: revision.id,
        episodeId: episode.id,
        provider: production.artProvider ?? 'configured-art-provider',
        modelProfileId: modelProfile?.id,
        promptSource: resolvedPrompt.promptMetadata.source,
        integrityStatus: integrityReview.status,
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
          promptMetadata: resolvedPrompt.promptMetadata,
          modelProfile,
          actor: body.actor,
          retryOfJobId: body.retryOfJobId,
          stage,
          integrityReview,
        },
        logs,
        startedAt: new Date(),
      });

      stage = 'generating-cover-art';
      logs.push(log('info', 'Generating cover art.', { provider: production.artProvider ?? 'configured-art-provider' }));
      job = await updateJob(jobStore, job.id, { progress: 50, logs, output: { stage } }) ?? job;
      const generated = await coverArtProvider.generateCoverArt({
        show,
        script,
        revision,
        episodeId: episode.id,
        episodeSlug: episode.slug,
        researchPacket,
        production,
        prompt,
      });
      stage = 'persisting-asset';
      const asset = await productionStore.createEpisodeAsset(assetInput(episode, 'cover-art', generated, {
        scriptId: script.id,
        revisionId: revision.id,
        jobId: job.id,
        prompt,
        promptResult: resolvedPrompt.promptResult,
        promptMetadata: resolvedPrompt.promptMetadata,
        researchPacketId: researchPacket?.id ?? null,
        modelProfile,
        integrityReview,
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
          stage: 'completed',
          episodeId: updatedEpisode.id,
          assetId: asset.id,
          publicUrl: asset.publicUrl,
          objectKey: asset.objectKey,
          byteSize: asset.byteSize,
          mimeType: asset.mimeType,
          checksum: asset.checksum,
          prompt,
          promptResult: resolvedPrompt.promptResult,
          promptMetadata: resolvedPrompt.promptMetadata,
          provider: asset.metadata.provider,
          adapter: asset.metadata.adapter,
          modelProfile,
          integrityReview,
          retryable: false,
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
          output: failureOutput(stage, error, {
            scriptId: request.params.id,
            provider: job.input.provider,
          }),
          finishedAt: new Date(),
        }) ?? job;
      }

      return sendError(reply, error, job);
    }
  });
}
