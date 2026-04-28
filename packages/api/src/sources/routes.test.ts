import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { buildApp } from '../app.js';
import { createFakeLlmProvider } from '../llm/providers.js';
import { createLlmRuntime } from '../llm/runtime.js';
import type { LlmProviderRequest, LlmProviderResult } from '../llm/types.js';
import type { ModelRole } from '../models/roles.js';
import type {
  CreateModelProfileInput,
  ModelProfileListFilter,
  ModelProfileRecord,
  ModelProfileStore,
  UpdateModelProfileInput,
} from '../models/store.js';
import type { AudioPreviewProvider } from '../production/providers.js';
import type {
  PublishStorageAdapter,
  PublishUrlValidator,
  RssEpisodeEntry,
  RssUpdateAdapter,
} from '../production/publishing.js';
import type {
  ApproveEpisodeForPublishInput,
  CreatePublishEventInput,
  CreateEpisodeAssetInput,
  CreateEpisodeFromScriptInput,
  EpisodeAssetRecord,
  EpisodeRecord,
  FeedRecord,
  ProductionStore,
  PublishEventRecord,
  UpdatePublishEventInput,
  UpdateEpisodeProductionInput,
} from '../production/store.js';
import type { ResearchFetch } from '../research/fetch.js';
import type {
  ApproveResearchPacketInput,
  CreateResearchPacketInput,
  CreateSourceDocumentInput,
  OverrideResearchWarningInput,
  ResearchPacketListFilter,
  ResearchPacketRecord,
  ResearchStore,
  ResearchWarning,
  SourceDocumentRecord,
} from '../research/store.js';
import type { ResearchModelServices } from '../research/models.js';
import type {
  ApproveScriptRevisionInput,
  CreateScriptRevisionInput,
  CreateScriptWithRevisionInput,
  ListScriptsFilter,
  OverrideIntegrityReviewInput,
  ScriptRecord,
  ScriptRevisionRecord,
  ScriptStore,
} from '../scripts/store.js';
import type { BraveFetch } from '../search/brave.js';
import type { RssFetch } from '../search/rss.js';
import type {
  CandidateDedupeKey,
  CreateJobInput,
  CreateStoryCandidateInput,
  JobRecord,
  SearchJobStore,
  StoryCandidateListFilter,
  StoryCandidateRecord,
  UpdateJobInput,
} from '../search/store.js';
import type {
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  ShowRecord,
  SourceProfileRecord,
  SourceQueryRecord,
  SourceStore,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
} from './store.js';

class FakeSourceStore implements SourceStore, SearchJobStore, ResearchStore, ModelProfileStore, ScriptStore, ProductionStore {
  shows: ShowRecord[] = [{
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'the-synthetic-lens',
    title: 'The Synthetic Lens',
    description: 'AI news',
    setupStatus: 'active',
    format: 'feature-analysis',
    defaultRuntimeMinutes: 8,
    cast: [
      { name: 'DAVID', role: 'host', voice: 'Orus' },
      { name: 'MARCUS', role: 'analyst', voice: 'Charon' },
      { name: 'INGRID', role: 'correspondent', voice: 'Leda' },
    ],
    defaultModelProfile: {},
    settings: {
      production: {
        ttsProvider: 'vertex-gemini-tts',
        artProvider: 'openai-gpt-image',
        publicBaseUrl: 'https://podcast.example.com/the-synthetic-lens',
        storage: 'local',
      },
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];

  profiles: SourceProfileRecord[] = [{
    id: '22222222-2222-4222-8222-222222222222',
    showId: '11111111-1111-4111-8111-111111111111',
    slug: 'ai-news-brave',
    name: 'AI News Brave',
    type: 'brave',
    enabled: true,
    weight: 1,
    freshness: 'pd',
    includeDomains: [],
    excludeDomains: [],
    rateLimit: {},
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];

  queries: SourceQueryRecord[] = [
    this.queryRecord('33333333-3333-4333-8333-333333333333', 'OpenAI announcement product news 2026', true),
    this.queryRecord('44444444-4444-4444-8444-444444444444', 'Anthropic Claude news 2026', false),
  ];

  jobs: JobRecord[] = [];
  candidates: StoryCandidateRecord[] = [];
  sourceDocuments: SourceDocumentRecord[] = [];
  researchPackets: ResearchPacketRecord[] = [];
  scripts: ScriptRecord[] = [];
  scriptRevisions: ScriptRevisionRecord[] = [];
  modelProfiles: ModelProfileRecord[] = [
    this.modelProfileRecord('episode_planner', 'openai', 'gpt-5.5'),
    this.modelProfileRecord('candidate_scorer', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('source_summarizer', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('claim_extractor', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('research_synthesizer', 'google-gemini-cli', 'gemini-3-pro-preview'),
    this.modelProfileRecord('script_writer', 'openai-codex', 'gpt-5.3-codex'),
    this.modelProfileRecord('script_editor', 'openai-codex', 'gpt-5.3-codex'),
    this.modelProfileRecord('integrity_reviewer', 'openai', 'gpt-5.5'),
    this.modelProfileRecord('cover_prompt_writer', 'openai', 'gpt-5.5'),
  ];
  episodes: EpisodeRecord[] = [];
  episodeAssets: EpisodeAssetRecord[] = [];
  feeds: FeedRecord[] = [{
    id: 'feed-1',
    showId: '11111111-1111-4111-8111-111111111111',
    slug: 'main',
    title: 'The Synthetic Lens',
    description: 'AI news feed',
    rssFeedPath: null,
    publicFeedUrl: 'https://podcast.example.com/the-synthetic-lens/feed.xml',
    publicBaseUrl: 'https://podcast.example.com/the-synthetic-lens',
    storageType: 'local',
    storageConfig: {},
    op3Wrap: true,
    episodeNumberPolicy: 'increment',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  publishEvents: PublishEventRecord[] = [];
  approvalEvents: Array<{
    artifactType: string;
    artifactId: string;
    action: string;
    gate: string;
    actor: string;
    reason: string | null;
    createdAt: Date;
  }> = [];

  async listShows() {
    return this.shows;
  }

  async listModelProfiles(filter: ModelProfileListFilter = {}) {
    const show = filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug) : undefined;
    const showId = filter.showId ?? show?.id;

    return this.modelProfiles.filter((profile) => {
      const roleMatches = !filter.role || profile.role === filter.role;
      const showMatches = showId
        ? profile.showId === showId || (filter.includeGlobal && profile.showId === null)
        : true;

      return roleMatches && showMatches;
    });
  }

  async getModelProfile(id: string) {
    return this.modelProfiles.find((profile) => profile.id === id);
  }

  async createModelProfile(input: CreateModelProfileInput) {
    const profile: ModelProfileRecord = {
      ...input,
      id: `model-profile-${this.modelProfiles.length + 1}`,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.modelProfiles.push(profile);
    return profile;
  }

  async updateModelProfile(id: string, input: UpdateModelProfileInput) {
    const profile = await this.getModelProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date('2026-01-04T00:00:00Z') });
    return profile;
  }

  async listSourceProfiles(filter: { showSlug?: string; showId?: string } = {}) {
    const show = filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug) : undefined;
    const showId = filter.showId ?? show?.id;
    return showId ? this.profiles.filter((profile) => profile.showId === showId) : this.profiles;
  }

  async getSourceProfile(id: string) {
    return this.profiles.find((profile) => profile.id === id);
  }

  async createSourceProfile(input: CreateSourceProfileInput) {
    const profile: SourceProfileRecord = {
      ...input,
      id: `profile-${this.profiles.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.profiles.push(profile);
    return profile;
  }

  async updateSourceProfile(id: string, input: UpdateSourceProfileInput) {
    const profile = await this.getSourceProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date() });
    return profile;
  }

  async listSourceQueries(profileId: string, options: { enabledOnly?: boolean } = {}) {
    const profile = await this.getSourceProfile(profileId);

    if (!profile || (options.enabledOnly && !profile.enabled)) {
      return [];
    }

    return this.queries.filter((query) => {
      return query.sourceProfileId === profileId && (!options.enabledOnly || query.enabled);
    });
  }

  async getSourceQuery(id: string) {
    return this.queries.find((query) => query.id === id);
  }

  async createSourceQuery(profileId: string, input: CreateSourceQueryInput) {
    const profile = await this.getSourceProfile(profileId);

    if (!profile) {
      return undefined;
    }

    const query = this.queryRecord(`query-${this.queries.length + 1}`, input.query, input.enabled);
    Object.assign(query, input, { sourceProfileId: profileId, updatedAt: new Date() });
    this.queries.push(query);
    return query;
  }

  async updateSourceQuery(id: string, input: UpdateSourceQueryInput) {
    const query = this.queries.find((candidate) => candidate.id === id);

    if (!query) {
      return undefined;
    }

    Object.assign(query, input, { updatedAt: new Date() });
    return query;
  }

  async deleteSourceQuery(id: string) {
    const before = this.queries.length;
    this.queries = this.queries.filter((query) => query.id !== id);
    return this.queries.length !== before;
  }

  async createJob(input: CreateJobInput) {
    const job: JobRecord = {
      id: `job-${this.jobs.length + 1}`,
      showId: input.showId,
      episodeId: input.episodeId ?? null,
      type: input.type,
      status: input.status,
      progress: input.progress,
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 1,
      input: input.input,
      output: {},
      logs: input.logs ?? [],
      error: null,
      lockedBy: null,
      lockedAt: null,
      startedAt: input.startedAt ?? null,
      finishedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.jobs.push(job);
    return job;
  }

  async updateJob(id: string, input: UpdateJobInput) {
    const job = this.jobs.find((candidate) => candidate.id === id);

    if (!job) {
      return undefined;
    }

    Object.assign(job, input, { updatedAt: new Date() });
    return job;
  }

  async getJob(id: string) {
    return this.jobs.find((job) => job.id === id);
  }

  async listJobs(filter: { showId?: string; episodeId?: string; types?: string[]; limit?: number } = {}) {
    return this.jobs
      .filter((job) => (!filter.showId || job.showId === filter.showId)
        && (!filter.episodeId || job.episodeId === filter.episodeId)
        && (!filter.types || filter.types.includes(job.type)))
      .slice(0, filter.limit ?? 50);
  }

  async getEpisode(id: string) {
    return this.episodes.find((episode) => episode.id === id);
  }

  async listEpisodes(filter: { showId: string; limit?: number }) {
    return this.episodes
      .filter((episode) => episode.showId === filter.showId)
      .slice(0, filter.limit ?? 50);
  }

  async getEpisodeForScript(scriptId: string, researchPacketId: string) {
    return this.episodes.find((episode) => {
      return episode.researchPacketId === researchPacketId && episode.metadata.scriptId === scriptId;
    }) ?? this.episodes.find((episode) => episode.researchPacketId === researchPacketId);
  }

  async createEpisodeFromScript(input: CreateEpisodeFromScriptInput) {
    const episode: EpisodeRecord = {
      id: `episode-${this.episodes.length + 1}`,
      showId: input.showId,
      feedId: null,
      episodeCandidateId: null,
      researchPacketId: input.researchPacketId,
      slug: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${input.scriptId}`,
      title: input.title,
      description: null,
      episodeNumber: null,
      status: 'approved-for-audio',
      scriptText: input.scriptText,
      scriptFormat: input.scriptFormat,
      durationSeconds: null,
      publishedAt: null,
      feedGuid: null,
      warnings: [],
      metadata: {
        scriptId: input.scriptId,
        approvedRevisionId: input.revisionId,
      },
      createdAt: new Date('2026-01-07T00:00:00Z'),
      updatedAt: new Date('2026-01-07T00:00:00Z'),
    };
    this.episodes.push(episode);
    return episode;
  }

  async updateEpisodeProduction(id: string, input: UpdateEpisodeProductionInput) {
    const episode = await this.getEpisode(id);

    if (!episode) {
      return undefined;
    }

    Object.assign(episode, input, { updatedAt: new Date('2026-01-07T00:00:00Z') });
    return episode;
  }

  async createEpisodeAsset(input: CreateEpisodeAssetInput) {
    const asset: EpisodeAssetRecord = {
      id: `asset-${this.episodeAssets.length + 1}`,
      episodeId: input.episodeId,
      type: input.type,
      label: input.label ?? null,
      localPath: input.localPath ?? null,
      objectKey: input.objectKey ?? null,
      publicUrl: input.publicUrl ?? null,
      mimeType: input.mimeType ?? null,
      byteSize: input.byteSize ?? null,
      durationSeconds: input.durationSeconds ?? null,
      checksum: input.checksum ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date('2026-01-07T00:00:00Z'),
      updatedAt: new Date('2026-01-07T00:00:00Z'),
    };
    this.episodeAssets.push(asset);
    return asset;
  }

  async listEpisodeAssets(episodeId: string) {
    return this.episodeAssets.filter((asset) => asset.episodeId === episodeId);
  }

  async listFeeds(showId: string) {
    return this.feeds.filter((feed) => feed.showId === showId);
  }

  async getFeed(id: string) {
    return this.feeds.find((feed) => feed.id === id);
  }

  async approveEpisodeForPublish(id: string, input: ApproveEpisodeForPublishInput) {
    const episode = await this.getEpisode(id);

    if (!episode) {
      return undefined;
    }

    Object.assign(episode, {
      status: 'approved-for-publish',
      metadata: {
        ...episode.metadata,
        publishApproval: {
          actor: input.actor,
          reason: input.reason ?? null,
          approvedAt: '2026-01-08T00:00:00.000Z',
        },
      },
      updatedAt: new Date('2026-01-08T00:00:00Z'),
    });
    this.approvalEvents.push({
      artifactType: 'episode',
      artifactId: id,
      action: 'approve',
      gate: 'episode-publish',
      actor: input.actor,
      reason: input.reason ?? null,
      createdAt: new Date('2026-01-08T00:00:00Z'),
    });
    return episode;
  }

  async createPublishEvent(input: CreatePublishEventInput) {
    const event: PublishEventRecord = {
      id: `publish-event-${this.publishEvents.length + 1}`,
      episodeId: input.episodeId,
      feedId: input.feedId ?? null,
      status: input.status,
      feedGuid: input.feedGuid ?? null,
      audioUrl: input.audioUrl ?? null,
      coverUrl: input.coverUrl ?? null,
      rssUrl: input.rssUrl ?? null,
      changelog: input.changelog ?? null,
      error: input.error ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date('2026-01-08T00:00:00Z'),
      updatedAt: new Date('2026-01-08T00:00:00Z'),
    };
    this.publishEvents.push(event);
    return event;
  }

  async updatePublishEvent(id: string, input: UpdatePublishEventInput) {
    const event = this.publishEvents.find((candidate) => candidate.id === id);

    if (!event) {
      return undefined;
    }

    Object.assign(event, input, { updatedAt: new Date('2026-01-08T00:00:00Z') });
    return event;
  }

  async listStoryCandidateDedupeKeys(showId: string): Promise<CandidateDedupeKey[]> {
    return this.candidates
      .filter((candidate) => candidate.showId === showId)
      .map((candidate) => ({ title: candidate.title, canonicalUrl: candidate.canonicalUrl }));
  }

  async insertStoryCandidate(input: CreateStoryCandidateInput) {
    if (this.candidates.some((candidate) => {
      return candidate.showId === input.showId && candidate.canonicalUrl === input.canonicalUrl;
    })) {
      return undefined;
    }

    const candidate: StoryCandidateRecord = {
      id: `candidate-${this.candidates.length + 1}`,
      showId: input.showId,
      sourceProfileId: input.sourceProfileId,
      sourceQueryId: input.sourceQueryId,
      title: input.title,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      sourceName: input.sourceName,
      author: null,
      summary: input.summary,
      publishedAt: input.publishedAt,
      discoveredAt: new Date('2026-01-02T00:00:00Z'),
      score: null,
      scoreBreakdown: {},
      status: 'new',
      rawPayload: input.rawPayload,
      metadata: input.metadata,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.candidates.push(candidate);
    return candidate;
  }

  async updateStoryCandidateScoring(id: string, input: { score: number | null; scoreBreakdown: Record<string, unknown>; metadata: Record<string, unknown> }) {
    const candidate = this.candidates.find((item) => item.id === id);

    if (!candidate) {
      return undefined;
    }

    candidate.score = input.score;
    candidate.scoreBreakdown = input.scoreBreakdown;
    candidate.metadata = input.metadata;
    candidate.updatedAt = new Date();
    return candidate;
  }

  async listStoryCandidates(filter: StoryCandidateListFilter) {
    return this.candidates
      .filter((candidate) => candidate.showId === filter.showId)
      .slice(0, filter.limit ?? 50);
  }

  async getStoryCandidate(id: string) {
    return this.candidates.find((candidate) => candidate.id === id);
  }

  async createSourceDocument(input: CreateSourceDocumentInput) {
    const document: SourceDocumentRecord = {
      id: `source-document-${this.sourceDocuments.length + 1}`,
      storyCandidateId: input.storyCandidateId,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      fetchedAt: input.fetchedAt,
      fetchStatus: input.fetchStatus,
      httpStatus: input.httpStatus,
      contentType: input.contentType,
      textContent: input.textContent,
      metadata: input.metadata,
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    };
    this.sourceDocuments.push(document);
    return document;
  }

  async createResearchPacket(input: CreateResearchPacketInput) {
    const packet: ResearchPacketRecord = {
      id: `research-packet-${this.researchPackets.length + 1}`,
      showId: input.showId,
      episodeCandidateId: input.episodeCandidateId,
      title: input.title,
      status: input.status,
      sourceDocumentIds: input.sourceDocumentIds,
      claims: input.claims,
      citations: input.citations,
      warnings: input.warnings,
      content: input.content,
      approvedAt: null,
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    };
    this.researchPackets.push(packet);
    return packet;
  }

  async getResearchPacket(id: string) {
    return this.researchPackets.find((packet) => packet.id === id);
  }

  async listResearchPackets(filter: ResearchPacketListFilter = {}) {
    const showId = filter.showId
      ?? (filter.showSlug ? this.shows.find((show) => show.slug === filter.showSlug)?.id : undefined);

    return this.researchPackets
      .filter((packet) => !showId || packet.showId === showId)
      .slice(0, filter.limit ?? 50);
  }

  async overrideResearchWarning(id: string, input: OverrideResearchWarningInput) {
    const packet = await this.getResearchPacket(id);

    if (!packet) {
      return undefined;
    }

    let matched = false;
    packet.warnings = packet.warnings.map((warning) => {
      const isMatch = input.warningId ? warning.id === input.warningId : warning.code === input.warningCode;

      if (!isMatch) {
        return warning;
      }

      matched = true;
      return {
        ...warning,
        override: {
          actor: input.actor,
          reason: input.reason,
          overriddenAt: '2026-01-03T00:00:00.000Z',
        },
      };
    });

    if (!matched) {
      return undefined;
    }

    this.approvalEvents.push({
      artifactType: 'research-packet',
      artifactId: id,
      action: 'override',
      gate: 'research-warning',
      actor: input.actor,
      reason: input.reason,
      createdAt: new Date('2026-01-03T00:00:00Z'),
    });
    packet.updatedAt = new Date('2026-01-03T00:00:00Z');
    return packet;
  }

  async approveResearchPacket(id: string, input: ApproveResearchPacketInput) {
    const packet = await this.getResearchPacket(id);

    if (!packet) {
      return undefined;
    }

    packet.approvedAt = new Date('2026-01-03T12:00:00Z');
    packet.content = {
      ...packet.content,
      reviewApproval: {
        actor: input.actor,
        reason: input.reason ?? null,
        approvedAt: packet.approvedAt.toISOString(),
      },
    };
    packet.updatedAt = packet.approvedAt;
    this.approvalEvents.push({
      artifactType: 'research-packet',
      artifactId: id,
      action: 'approve',
      gate: 'research-brief',
      actor: input.actor,
      reason: input.reason ?? null,
      createdAt: packet.approvedAt,
    });
    return packet;
  }

  async createScriptWithRevision(input: CreateScriptWithRevisionInput) {
    const script: ScriptRecord = {
      id: `script-${this.scripts.length + 1}`,
      showId: input.showId,
      researchPacketId: input.researchPacketId,
      title: input.title,
      format: input.format,
      status: 'draft',
      approvedRevisionId: null,
      approvedAt: null,
      metadata: input.metadata,
      createdAt: new Date('2026-01-04T00:00:00Z'),
      updatedAt: new Date('2026-01-04T00:00:00Z'),
    };
    const revision: ScriptRevisionRecord = {
      id: `script-revision-${this.scriptRevisions.length + 1}`,
      scriptId: script.id,
      version: 1,
      ...input.revision,
      createdAt: new Date('2026-01-04T00:00:00Z'),
    };
    this.scripts.push(script);
    this.scriptRevisions.push(revision);
    return { script, revision };
  }

  async listScripts(filter: ListScriptsFilter = {}) {
    const show = filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug) : undefined;
    const showId = filter.showId ?? show?.id;

    return this.scripts
      .filter((script) => (!showId || script.showId === showId)
        && (!filter.researchPacketId || script.researchPacketId === filter.researchPacketId))
      .slice(0, filter.limit ?? 50);
  }

  async getScript(id: string) {
    return this.scripts.find((script) => script.id === id);
  }

  async listScriptRevisions(scriptId: string) {
    return this.scriptRevisions
      .filter((revision) => revision.scriptId === scriptId)
      .sort((left, right) => right.version - left.version);
  }

  async getScriptRevision(id: string) {
    return this.scriptRevisions.find((revision) => revision.id === id);
  }

  async createScriptRevision(scriptId: string, input: CreateScriptRevisionInput) {
    const script = await this.getScript(scriptId);

    if (!script) {
      return undefined;
    }

    const version = Math.max(0, ...this.scriptRevisions
      .filter((revision) => revision.scriptId === scriptId)
      .map((revision) => revision.version)) + 1;
    const revision: ScriptRevisionRecord = {
      id: `script-revision-${this.scriptRevisions.length + 1}`,
      scriptId,
      version,
      ...input,
      createdAt: new Date('2026-01-05T00:00:00Z'),
    };
    this.scriptRevisions.push(revision);
    Object.assign(script, {
      title: input.title,
      format: input.format,
      status: 'draft',
      approvedRevisionId: null,
      approvedAt: null,
      updatedAt: new Date('2026-01-05T00:00:00Z'),
    });
    return { script, revision };
  }

  async updateScriptRevisionMetadata(revisionId: string, metadata: Record<string, unknown>) {
    const revision = await this.getScriptRevision(revisionId);

    if (!revision) {
      return undefined;
    }

    revision.metadata = metadata;
    return revision;
  }

  async overrideIntegrityReview(scriptId: string, revisionId: string, input: OverrideIntegrityReviewInput) {
    const revision = await this.getScriptRevision(revisionId);

    if (!revision || revision.scriptId !== scriptId) {
      return undefined;
    }

    const previous = revision.metadata.integrityReview && typeof revision.metadata.integrityReview === 'object' && !Array.isArray(revision.metadata.integrityReview)
      ? revision.metadata.integrityReview as Record<string, unknown>
      : {};
    revision.metadata = {
      ...revision.metadata,
      integrityReview: {
        ...previous,
        status: 'overridden',
        blocking: false,
        override: {
          actor: input.actor,
          reason: input.reason,
          overriddenAt: '2026-01-06T00:30:00.000Z',
        },
      },
    };
    this.approvalEvents.push({
      artifactType: 'script-revision',
      artifactId: revisionId,
      action: 'override',
      gate: 'integrity-review',
      actor: input.actor,
      reason: input.reason,
      createdAt: new Date('2026-01-06T00:30:00Z'),
    });
    return revision;
  }

  async approveScriptRevision(scriptId: string, revisionId: string, input: ApproveScriptRevisionInput) {
    const script = await this.getScript(scriptId);
    const revision = await this.getScriptRevision(revisionId);

    if (!script || !revision || revision.scriptId !== scriptId) {
      return undefined;
    }

    Object.assign(script, {
      status: 'approved-for-audio',
      approvedRevisionId: revisionId,
      approvedAt: new Date('2026-01-06T00:00:00Z'),
      metadata: {
        ...script.metadata,
        approvalActor: input.actor,
        approvalReason: input.reason,
      },
      updatedAt: new Date('2026-01-06T00:00:00Z'),
    });
    this.approvalEvents.push({
      artifactType: 'script-revision',
      artifactId: revisionId,
      action: 'approve',
      gate: 'script-audio',
      actor: input.actor,
      reason: input.reason,
      createdAt: new Date('2026-01-06T00:00:00Z'),
    });
    return script;
  }

  private queryRecord(id: string, query: string, enabled: boolean): SourceQueryRecord {
    return {
      id,
      sourceProfileId: '22222222-2222-4222-8222-222222222222',
      query,
      enabled,
      weight: 1,
      region: null,
      language: null,
      freshness: null,
      includeDomains: [],
      excludeDomains: [],
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  private modelProfileRecord(role: ModelRole, provider: string, model: string): ModelProfileRecord {
    return {
      id: `model-profile-${role}`,
      showId: '11111111-1111-4111-8111-111111111111',
      role,
      provider,
      model,
      temperature: role === 'claim_extractor' ? 0 : 0.2,
      maxTokens: 1200,
      budgetUsd: 1,
      fallbacks: [],
      promptTemplateKey: null,
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }
}

let store = new FakeSourceStore();
let requestedUrls: string[] = [];
let requestedRssUrls: string[] = [];
let requestedResearchUrls: string[] = [];
let uploadedPublishAssets: Array<{ feedId: string; episodeId: string; assetId: string; type: string }> = [];
let rssEntries = new Map<string, RssEpisodeEntry>();
let validatedPublishUrls: string[] = [];
let scriptLlmMode: 'valid' | 'malformed' | 'unknown-speaker' = 'valid';
let scriptEditorMode: 'valid' | 'malformed' | 'unknown-speaker' = 'valid';
let integrityReviewMode: 'pass' | 'notes' | 'fail' = 'pass';

function quotedValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match?.[1];
}

function scriptWriterResult(request: LlmProviderRequest): LlmProviderResult {
  if (request.attempt.role === 'script_editor') {
    if (scriptEditorMode === 'malformed') {
      return { text: 'not json', rawOutput: 'not json', metadata: { adapter: 'test-fake-script-editor' } };
    }

    const body = scriptEditorMode === 'unknown-speaker'
      ? 'BOGUS: This coached draft uses a speaker outside the configured show cast.'
      : [
        'DAVID: According to the captured source, this update remains preliminary while editors review the evidence.',
        'INGRID: The revised intro keeps uncertainty visible and avoids declaring conclusions the packet has not settled.',
        'MARCUS: The next step is a fresh integrity review before production.',
      ].join('\n');
    const output = {
      title: 'Coached Story Script',
      body,
      changeSummary: 'Reduced certainty and made source limits clearer.',
      speakers: scriptEditorMode === 'unknown-speaker' ? ['BOGUS'] : ['DAVID', 'INGRID', 'MARCUS'],
      resolvedWarnings: ['unsupported_certainty'],
      remainingWarnings: [],
    };
    const text = JSON.stringify(output);

    return {
      text,
      rawOutput: text,
      metadata: { adapter: 'test-fake-script-editor' },
      usage: { inputTokens: 11, outputTokens: 17, totalTokens: 28 },
      cost: { usd: 0, currency: 'USD' },
    };
  }

  if (request.attempt.role === 'integrity_reviewer') {
    const outputs = {
      pass: {
        verdict: 'PASS',
        summary: 'The script is supported by the research packet and production can proceed.',
        claimIssues: [],
        missingCitations: [],
        unsupportedCertainty: [],
        attributionWarnings: [],
        balanceWarnings: [],
        biasSensationalismWarnings: [],
        suggestedFixes: [],
      },
      notes: {
        verdict: 'PASS_WITH_NOTES',
        summary: 'The script is accurate, with one non-blocking attribution note for the editor.',
        claimIssues: [],
        missingCitations: [],
        unsupportedCertainty: [],
        attributionWarnings: [{
          scriptExcerpt: 'The sourced packet points to a concrete development.',
          issue: 'Attribute this line more explicitly to the captured source.',
          severity: 'warning',
          suggestedFix: 'Add "according to the captured source" before production.',
        }],
        balanceWarnings: [],
        biasSensationalismWarnings: [],
        suggestedFixes: ['Add one explicit attribution phrase in the correspondent line.'],
      },
      fail: {
        verdict: 'FAIL',
        summary: 'The script overstates an unsupported factual claim.',
        claimIssues: [{
          claimId: 'claim-1',
          scriptExcerpt: 'This is confirmed as a market-changing breakthrough.',
          issue: 'The research packet does not support this level of certainty.',
          severity: 'critical',
          sourceDocumentIds: ['source-document-1'],
          citationUrls: ['https://example.com/production'],
          suggestedFix: 'Soften the line and attribute it to the captured source.',
        }],
        missingCitations: [],
        unsupportedCertainty: [{
          scriptExcerpt: 'confirmed as a market-changing breakthrough',
          issue: 'The certainty is stronger than the research packet allows.',
          severity: 'critical',
          suggestedFix: 'Replace with "the source says it could affect market positioning."',
        }],
        attributionWarnings: [],
        balanceWarnings: [],
        biasSensationalismWarnings: [{
          scriptExcerpt: 'market-changing breakthrough',
          issue: 'This framing is promotional without independent corroboration.',
          severity: 'warning',
          suggestedFix: 'Use restrained language.',
        }],
        suggestedFixes: ['Remove unsupported certainty before production.'],
      },
    } as const;
    const text = JSON.stringify(outputs[integrityReviewMode]);

    return {
      text,
      rawOutput: text,
      metadata: { adapter: 'test-fake-integrity-reviewer' },
      usage: { inputTokens: 12, outputTokens: 18, totalTokens: 30 },
      cost: { usd: 0, currency: 'USD' },
    };
  }

  if (request.attempt.role === 'cover_prompt_writer') {
    const output = {
      prompt: 'A restrained editorial podcast cover with abstract newsroom light, no logos, no real people.',
      negativePrompt: 'logos, real people, sensational disaster imagery',
      altText: 'Abstract editorial cover art for a sourced AI news episode.',
      safetyNotes: ['Avoids depicting real people or unsupported scenes.'],
    };
    const text = JSON.stringify(output);

    return {
      text,
      rawOutput: text,
      metadata: { adapter: 'test-fake-cover-prompt-writer' },
      usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13 },
      cost: { usd: 0, currency: 'USD' },
    };
  }

  if (request.attempt.role !== 'script_writer') {
    const text = JSON.stringify({ ok: true });
    return { text, rawOutput: text, metadata: { adapter: 'test-fake' } };
  }

  if (scriptLlmMode === 'malformed') {
    return { text: 'not json', rawOutput: 'not json', metadata: { adapter: 'test-fake' } };
  }

  const content = request.messages.map((message) => message.content).join('\n');
  const title = quotedValue(content, 'title') ?? 'Generated Story';
  const claimId = quotedValue(content, 'id') ?? 'claim-1';
  const sourceDocumentId = quotedValue(content, 'sourceDocumentId') ?? 'source-document-1';
  const body = scriptLlmMode === 'unknown-speaker'
    ? 'BOGUS: This draft uses a speaker outside the configured show cast.'
    : [
      `DAVID: This is The Synthetic Lens. Today we are tracking ${title}.`,
      'INGRID: The sourced packet points to a concrete development editors can trace back to captured source documents.',
      'MARCUS: The context matters, but the script keeps uncertainty visible where the packet warns about source limits.',
    ].join('\n');
  const output = {
    title: `${title} Script`,
    format: 'feature-analysis',
    body,
    speakers: scriptLlmMode === 'unknown-speaker' ? ['BOGUS'] : ['DAVID', 'INGRID', 'MARCUS'],
    citationMap: scriptLlmMode === 'unknown-speaker'
      ? []
      : [{
        line: 'The sourced packet points to a concrete development editors can trace back to captured source documents.',
        claimId,
        sourceDocumentIds: [sourceDocumentId],
      }],
    warnings: [],
  };
  const text = JSON.stringify(output);

  return {
    text,
    rawOutput: text,
    metadata: { adapter: 'test-fake-script-writer' },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: { usd: 0, currency: 'USD' },
  };
}

const llmRuntime = createLlmRuntime({
  adapters: [
    createFakeLlmProvider({ provider: 'openai-codex', handler: scriptWriterResult }),
    createFakeLlmProvider({ provider: 'openai', handler: scriptWriterResult }),
    createFakeLlmProvider({ provider: 'google-vertex', handler: scriptWriterResult }),
    createFakeLlmProvider({ provider: 'google-gemini-cli', handler: scriptWriterResult }),
  ],
});

const publishStorageAdapterFactory = (): PublishStorageAdapter => ({
  async uploadAsset({ feed, episode, asset }) {
    uploadedPublishAssets.push({ feedId: feed.id, episodeId: episode.id, assetId: asset.id, type: asset.type });
    return {
      assetId: asset.id,
      type: asset.type,
      objectKey: asset.objectKey,
      publicUrl: `https://cdn.example.com/${episode.slug}/${asset.type}`,
      byteSize: asset.byteSize,
      metadata: { adapter: 'fake-storage' },
    };
  },
});
const rssUpdateAdapter: RssUpdateAdapter = {
  async upsertEpisode({ feed, entry }) {
    const inserted = !rssEntries.has(entry.guid);
    rssEntries.set(entry.guid, entry);
    return {
      rssUrl: feed.publicFeedUrl ?? 'https://podcast.example.com/feed.xml',
      inserted,
      itemCount: rssEntries.size,
    };
  },
};
const publishUrlValidator: PublishUrlValidator = {
  async validate(urls) {
    validatedPublishUrls.push(...urls);
    return urls.map((url) => ({ url, ok: true }));
  },
};
const braveFetch: BraveFetch = async (url) => {
  requestedUrls.push(url);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        results: [
          {
            title: 'OpenAI ships model',
            url: 'https://example.com/article?utm_source=newsletter#top',
            description: 'First result',
            page_age: '2026-01-02T12:00:00Z',
            meta_url: { hostname: 'example.com' },
          },
          {
            title: 'OpenAI ships model!',
            url: 'https://other.example/article',
            description: 'Duplicate title result',
            meta_url: { hostname: 'other.example' },
          },
          {
            title: 'Different title',
            url: 'https://example.com/article',
            description: 'Duplicate URL result',
            meta_url: { hostname: 'example.com' },
          },
        ],
      };
    },
  };
};
const rssFetch: RssFetch = async (url) => {
  requestedRssUrls.push(url);
  return {
    ok: true,
    status: 200,
    async text() {
      return `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>Example Feed</title>
            <item>
              <title>RSS model story</title>
              <link>https://feeds.example.com/model-story?utm_source=rss#comments</link>
              <description>Feed summary</description>
              <pubDate>Fri, 02 Jan 2026 12:00:00 GMT</pubDate>
            </item>
            <item>
              <title>OpenAI ships model</title>
              <link>https://feeds.example.com/duplicate-title</link>
              <description>Duplicate title across providers</description>
            </item>
          </channel>
        </rss>`;
    },
  };
};
const researchFetch: ResearchFetch = async (url) => {
  requestedResearchUrls.push(url);

  if (url.includes('unavailable')) {
    return {
      ok: false,
      status: 503,
      headers: { get: () => 'text/html' },
      async text() {
        return '';
      },
    };
  }

  const host = new URL(url).hostname;

  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    async text() {
      return `<!doctype html>
        <html>
          <head><title>${host} research source</title></head>
          <body>
            <article>
              <h1>${host} confirms the story</h1>
              <p>${host} reports that the selected story is material for AI product strategy and developer workflows.</p>
              <p>The source adds enough context for deterministic research packet generation with citations and source snapshots.</p>
            </article>
          </body>
        </html>`;
    },
  };
};
const researchModelServices: ResearchModelServices = {
  async extractClaims(input) {
    if (input.documents.some((document) => document.url.includes('model-failure'))) {
      throw new Error('Fake claim extractor failed.');
    }

    const claims = input.documents
      .filter((document) => document.fetchStatus === 'fetched')
      .map((document, index) => ({
        id: `model-claim-${index + 1}`,
        text: `${document.title ?? document.url} supports the selected story cluster.`,
        sourceDocumentIds: [document.id],
        citationUrls: [document.canonicalUrl ?? document.url],
        claimType: 'fact' as const,
        confidence: 'high' as const,
        supportLevel: 'single_source' as const,
        highStakes: false,
      }));

    return {
      claims,
      warnings: [],
      invocations: [],
    };
  },

  async synthesize(input) {
    const warnings: ResearchWarning[] = input.documents.some((document) => document.url.includes('model-warning'))
      ? [{
        id: 'MODEL_SYNTHESIS_WARNING:test',
        code: 'MODEL_SYNTHESIS_WARNING',
        severity: 'warning',
        message: 'Fake synthesizer flagged a model warning for test coverage.',
      }]
      : [];

    return {
      synthesis: {
        title: input.angle ?? input.candidates[0].title,
        summary: `Synthesis for ${input.candidates.map((candidate) => candidate.title).join(' and ')}.`,
        knownFacts: input.claims.map((claim) => claim.text),
        openQuestions: warnings.map((warning) => warning.message),
        sourceDocumentIds: input.documents.map((document) => document.id),
        editorialAngle: input.angle ?? null,
      },
      claims: [],
      warnings,
      invocations: [],
    };
  },
};
const app = buildApp({
  sourceStore: store,
  braveApiKey: 'test-brave-key',
  fetchImpl: braveFetch,
  rssFetchImpl: rssFetch,
  researchFetchImpl: researchFetch,
  researchModelServices,
  llmRuntime,
  publishStorageAdapterFactory,
  rssUpdateAdapter,
  publishUrlValidator,
  sleep: async () => {},
});

describe('source profile routes', () => {
  beforeEach(() => {
    store.shows = new FakeSourceStore().shows;
    store.profiles = new FakeSourceStore().profiles;
    store.queries = new FakeSourceStore().queries;
    store.jobs = [];
    store.candidates = [];
    store.sourceDocuments = [];
    store.researchPackets = [];
    store.scripts = [];
    store.scriptRevisions = [];
    store.modelProfiles = new FakeSourceStore().modelProfiles;
    store.episodes = [];
    store.episodeAssets = [];
    store.feeds = new FakeSourceStore().feeds;
    store.publishEvents = [];
    store.approvalEvents = [];
    requestedUrls = [];
    requestedRssUrls = [];
    requestedResearchUrls = [];
    uploadedPublishAssets = [];
    rssEntries = new Map<string, RssEpisodeEntry>();
    validatedPublishUrls = [];
    scriptLlmMode = 'valid';
    scriptEditorMode = 'valid';
    integrityReviewMode = 'pass';
  });

  after(async () => {
    await app.close();
  });

  async function runIntegrityReview(scriptId: string, revisionId: string) {
    return app.inject({
      method: 'POST',
      url: `/scripts/${scriptId}/revisions/${revisionId}/integrity-review`,
      payload: { actor: 'integrity-reviewer@example.com' },
    });
  }

  async function createProducedEpisode(title: string) {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title,
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: `${title} claim exists.`, sourceDocumentIds: [], citationUrls: ['https://example.com/publish'] }],
      citations: [],
      warnings: [],
      content: { summary: `A packet summary for ${title}.` },
    });
    await store.approveResearchPacket(packet.id, {
      actor: 'research-editor@example.com',
      reason: 'Research reviewed for publish testing.',
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: {
        actor: 'producer@example.com',
        reason: 'Ready for production.',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });
    const artResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/cover-art`,
      payload: { actor: 'producer@example.com' },
    });

    return {
      packet,
      script: initial.script as ScriptRecord,
      episode: artResponse.json().episode as EpisodeRecord,
    };
  }

  it('lists shows and source profiles for the configured show', async () => {
    const showsResponse = await app.inject({ method: 'GET', url: '/shows' });
    assert.equal(showsResponse.statusCode, 200);
    assert.equal(showsResponse.json().shows[0].slug, 'the-synthetic-lens');

    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/source-profiles?showSlug=the-synthetic-lens',
    });
    const body = profilesResponse.json();

    assert.equal(profilesResponse.statusCode, 200);
    assert.equal(body.sourceProfiles.length, 1);
    assert.equal(body.sourceProfiles[0].slug, 'ai-news-brave');
  });

  it('updates profile freshness, domains, weight, and enabled state', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: {
        enabled: false,
        weight: 1.75,
        freshness: 'pw',
        includeDomains: ['https://OpenAI.com/news', 'openai.com'],
        excludeDomains: ['https://Example.com/path'],
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.sourceProfile.enabled, false);
    assert.equal(body.sourceProfile.weight, 1.75);
    assert.deepEqual(body.sourceProfile.includeDomains, ['openai.com']);
    assert.deepEqual(body.sourceProfile.excludeDomains, ['example.com']);
  });

  it('clears source controls when a profile is changed to or already has an unsupported type', async () => {
    const staleQueryResponse = await app.inject({
      method: 'PATCH',
      url: '/source-queries/33333333-3333-4333-8333-333333333333',
      payload: {
        freshness: 'pw',
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    assert.equal(staleQueryResponse.statusCode, 200);

    const response = await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: {
        type: 'manual',
        freshness: 'pw',
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.sourceProfile.type, 'manual');
    assert.equal(body.sourceProfile.freshness, null);
    assert.deepEqual(body.sourceProfile.includeDomains, []);
    assert.deepEqual(body.sourceProfile.excludeDomains, []);

    const clearedQueriesResponse = await app.inject({
      method: 'GET',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries',
    });
    const clearedQuery = clearedQueriesResponse.json().sourceQueries.find(
      (query: SourceQueryRecord) => query.id === '33333333-3333-4333-8333-333333333333',
    );
    assert.equal(clearedQueriesResponse.statusCode, 200);
    assert.equal(clearedQuery.freshness, null);
    assert.deepEqual(clearedQuery.includeDomains, []);
    assert.deepEqual(clearedQuery.excludeDomains, []);

    const followUpResponse = await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: {
        freshness: 'pd',
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    const followUpBody = followUpResponse.json();

    assert.equal(followUpResponse.statusCode, 200);
    assert.equal(followUpBody.sourceProfile.type, 'manual');
    assert.equal(followUpBody.sourceProfile.freshness, null);
    assert.deepEqual(followUpBody.sourceProfile.includeDomains, []);
    assert.deepEqual(followUpBody.sourceProfile.excludeDomains, []);

    const createQueryResponse = await app.inject({
      method: 'POST',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries',
      payload: {
        query: 'https://example.com/manual-story',
        enabled: true,
        weight: 1,
        freshness: 'pd',
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    const createdQuery = createQueryResponse.json().sourceQuery;

    assert.equal(createQueryResponse.statusCode, 201);
    assert.equal(createdQuery.freshness, null);
    assert.deepEqual(createdQuery.includeDomains, []);
    assert.deepEqual(createdQuery.excludeDomains, []);

    const patchQueryResponse = await app.inject({
      method: 'PATCH',
      url: `/source-queries/${createdQuery.id}`,
      payload: {
        freshness: 'pw',
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    const patchedQuery = patchQueryResponse.json().sourceQuery;

    assert.equal(patchQueryResponse.statusCode, 200);
    assert.equal(patchedQuery.freshness, null);
    assert.deepEqual(patchedQuery.includeDomains, []);
    assert.deepEqual(patchedQuery.excludeDomains, []);
  });


  it('does not rescan queries when patching an unsupported profile without source-control fields', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: { type: 'manual' },
    });

    let listCalls = 0;
    const originalListSourceQueries = store.listSourceQueries.bind(store);
    store.listSourceQueries = async (...args) => {
      listCalls += 1;
      return originalListSourceQueries(...args);
    };

    const response = await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: { name: 'Manual source profile' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().sourceProfile.name, 'Manual source profile');
    assert.equal(listCalls, 0);
  });

  it('filters disabled queries from enabledOnly reads', async () => {
    const allResponse = await app.inject({
      method: 'GET',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries',
    });
    const enabledResponse = await app.inject({
      method: 'GET',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries?enabledOnly=true',
    });

    assert.equal(allResponse.statusCode, 200);
    assert.equal(allResponse.json().sourceQueries.length, 2);
    assert.equal(enabledResponse.statusCode, 200);
    assert.deepEqual(
      enabledResponse.json().sourceQueries.map((query: SourceQueryRecord) => query.query),
      ['OpenAI announcement product news 2026'],
    );

    await app.inject({
      method: 'PATCH',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222',
      payload: { enabled: false },
    });

    const disabledProfileResponse = await app.inject({
      method: 'GET',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries?enabledOnly=true',
    });

    assert.equal(disabledProfileResponse.statusCode, 200);
    assert.equal(disabledProfileResponse.json().sourceQueries.length, 0);
  });

  it('creates, patches, and deletes a source query', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/queries',
      payload: {
        query: 'AI startup funding acquisition 2026',
        enabled: true,
        weight: 2,
        freshness: 'pd',
        includeDomains: ['https://TechCrunch.com/startups'],
        excludeDomains: [],
      },
    });
    const created = createResponse.json().sourceQuery;

    assert.equal(createResponse.statusCode, 201);
    assert.equal(created.freshness, 'pd');
    assert.deepEqual(created.includeDomains, ['techcrunch.com']);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/source-queries/${created.id}`,
      payload: { enabled: false, weight: 0.5 },
    });

    assert.equal(patchResponse.statusCode, 200);
    assert.equal(patchResponse.json().sourceQuery.enabled, false);
    assert.equal(patchResponse.json().sourceQuery.weight, 0.5);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/source-queries/${created.id}`,
    });

    assert.equal(deleteResponse.statusCode, 204);
  });

  it('runs a Brave source.search job and exposes job/candidate records', async () => {
    store.profiles[0].config = { count: 2 };
    store.queries[0].config = { freshness: 'pw' };
    store.queries[0].freshness = 'pw';
    store.queries[0].region = 'US';
    store.queries[0].language = 'en';

    const searchResponse = await app.inject({
      method: 'POST',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/search',
    });
    const searchBody = searchResponse.json();

    assert.equal(searchResponse.statusCode, 200);
    assert.equal(searchBody.ok, true);
    assert.equal(searchBody.job.type, 'source.search');
    assert.equal(searchBody.job.status, 'succeeded');
    assert.equal(searchBody.job.input.modelProfiles.candidate_scorer.provider, 'google-vertex');
    assert.equal(searchBody.job.input.modelProfiles.candidate_scorer.model, 'gemini-2.5-flash');
    assert.equal(searchBody.job.output.modelProfiles.candidate_scorer.version, '2026-01-01T00:00:00.000Z');
    assert.equal(searchBody.inserted, 1);
    assert.equal(searchBody.skipped, 2);
    assert.equal(searchBody.candidates.length, 1);
    assert.equal(searchBody.candidates[0].sourceQueryId, '33333333-3333-4333-8333-333333333333');
    assert.equal(searchBody.candidates[0].canonicalUrl, 'https://example.com/article');
    assert.equal(searchBody.candidates[0].rawPayload.title, 'OpenAI ships model');
    assert.match(requestedUrls[0], /count=2/);
    assert.match(requestedUrls[0], /freshness=pw/);
    assert.match(requestedUrls[0], /country=US/);
    assert.match(requestedUrls[0], /search_lang=en/);

    const jobResponse = await app.inject({ method: 'GET', url: `/jobs/${searchBody.job.id}` });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().job.output.inserted, 1);
    assert.ok(jobResponse.json().job.logs.length > 0);

    const candidatesResponse = await app.inject({
      method: 'GET',
      url: '/story-candidates?showSlug=the-synthetic-lens',
    });
    assert.equal(candidatesResponse.statusCode, 200);
    assert.equal(candidatesResponse.json().storyCandidates.length, 1);
  });

  it('lists episodes for the selected show', async () => {
    store.episodes.push({
      id: 'episode-imported',
      showId: '11111111-1111-4111-8111-111111111111',
      feedId: 'feed-1',
      episodeCandidateId: null,
      researchPacketId: null,
      slug: 'tsl-ep85-model-shockwave-deepseek-v4',
      title: 'Model Shockwave - DeepSeek returns with V4',
      description: null,
      episodeNumber: 85,
      status: 'published',
      scriptText: null,
      scriptFormat: 'main-tsl',
      durationSeconds: null,
      publishedAt: new Date('2026-04-25T04:54:48.345Z'),
      feedGuid: 'synthetic-lens-model-shockwave-deepseek-v4-2026-04-25',
      warnings: [],
      metadata: { importedFrom: 'legacy-tsl' },
      createdAt: new Date('2026-04-25T01:25:18.338Z'),
      updatedAt: new Date('2026-04-25T04:54:48.345Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/episodes?showSlug=the-synthetic-lens',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.episodes.length, 1);
    assert.equal(body.episodes[0].episodeNumber, 85);
    assert.equal(body.episodes[0].status, 'published');
    assert.equal(body.episodes[0].feedGuid, 'synthetic-lens-model-shockwave-deepseek-v4-2026-04-25');
  });

  it('ingests RSS source profiles and dedupes against existing candidates', async () => {
    await app.inject({
      method: 'POST',
      url: '/source-profiles/22222222-2222-4222-8222-222222222222/search',
    });

    store.profiles.push({
      id: '55555555-5555-4555-8555-555555555555',
      showId: '11111111-1111-4111-8111-111111111111',
      slug: 'ai-news-rss',
      name: 'AI News RSS',
      type: 'rss',
      enabled: true,
      weight: 1,
      freshness: null,
      includeDomains: [],
      excludeDomains: [],
      rateLimit: {},
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    store.queries.push({
      id: '66666666-6666-4666-8666-666666666666',
      sourceProfileId: '55555555-5555-4555-8555-555555555555',
      query: 'https://feeds.example.com/rss.xml',
      enabled: true,
      weight: 1,
      region: null,
      language: null,
      freshness: null,
      includeDomains: [],
      excludeDomains: [],
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const ingestResponse = await app.inject({
      method: 'POST',
      url: '/source-profiles/55555555-5555-4555-8555-555555555555/ingest',
    });
    const ingestBody = ingestResponse.json();

    assert.equal(ingestResponse.statusCode, 200);
    assert.equal(ingestBody.job.type, 'source.ingest');
    assert.equal(ingestBody.job.status, 'succeeded');
    assert.equal(ingestBody.inserted, 1);
    assert.equal(ingestBody.skipped, 1);
    assert.equal(ingestBody.candidates[0].sourceProfileId, '55555555-5555-4555-8555-555555555555');
    assert.equal(ingestBody.candidates[0].sourceQueryId, '66666666-6666-4666-8666-666666666666');
    assert.equal(ingestBody.candidates[0].canonicalUrl, 'https://feeds.example.com/model-story');
    assert.deepEqual(requestedRssUrls, ['https://feeds.example.com/rss.xml']);
  });

  it('submits manual URLs as candidates and dedupes canonical URLs', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/agent-roundup?utm_campaign=test#top',
        summary: 'Manual lead',
      },
    });
    const createBody = createResponse.json();

    assert.equal(createResponse.statusCode, 201);
    assert.equal(createBody.inserted, true);
    assert.equal(createBody.candidate.title, 'Agent Roundup');
    assert.equal(createBody.candidate.canonicalUrl, 'https://manual.example.com/news/agent-roundup');
    assert.equal(createBody.candidate.metadata.provider, 'manual');
    assert.equal(createBody.candidate.sourceProfileId, null);

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/agent-roundup#comments',
        title: 'Different title',
      },
    });
    const duplicateBody = duplicateResponse.json();

    assert.equal(duplicateResponse.statusCode, 200);
    assert.equal(duplicateBody.inserted, false);
    assert.equal(duplicateBody.reason, 'duplicate-url');
    assert.equal(store.candidates.length, 1);
  });

  it('builds research packets with source snapshots, cited claims, warnings, and overrides', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/research-story',
        title: 'Research Story',
        summary: 'A selected research story needs evidence.',
      },
    });
    const candidate = createResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: `/story-candidates/${candidate.id}/research-packet`,
      payload: {
        extraUrls: [
          'https://independent.example.net/story',
          'https://unavailable.example.org/story',
        ],
      },
    });
    const packetBody = packetResponse.json();

    assert.equal(packetResponse.statusCode, 201);
    assert.equal(packetBody.job.type, 'research.packet');
    assert.equal(packetBody.job.status, 'succeeded');
    assert.equal(packetBody.job.input.modelProfiles.source_summarizer.model, 'gemini-2.5-flash');
    assert.equal(packetBody.job.output.modelProfiles.research_synthesizer.provider, 'google-gemini-cli');
    assert.deepEqual(requestedResearchUrls, [
      'https://manual.example.com/news/research-story',
      'https://independent.example.net/story',
      'https://unavailable.example.org/story',
    ]);
    assert.equal(packetBody.sourceDocuments.length, 3);
    assert.equal(packetBody.sourceDocuments.filter((document: SourceDocumentRecord) => document.fetchStatus === 'fetched').length, 2);
    assert.equal(packetBody.researchPacket.content.storyCandidateId, candidate.id);
    assert.equal(packetBody.researchPacket.content.modelProfiles.claim_extractor.version, '2026-01-01T00:00:00.000Z');
    assert.equal(packetBody.researchPacket.citations.length, 3);
    assert.ok(packetBody.researchPacket.claims.length >= 2);
    assert.ok(packetBody.researchPacket.claims.every((claim: { citationUrls: string[] }) => claim.citationUrls.length > 0));
    assert.ok(packetBody.researchPacket.warnings.some((warning: { code: string }) => warning.code === 'SOURCE_FETCH_FAILED'));

    const packetId = packetBody.researchPacket.id;
    const getResponse = await app.inject({ method: 'GET', url: `/research-packets/${packetId}` });

    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.json().researchPacket.id, packetId);

    const warningId = packetBody.researchPacket.warnings[0].id;
    const overrideResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packetId}/override-warning`,
      payload: {
        warningId,
        actor: 'editor@example.com',
        reason: 'The inaccessible source is not necessary because two independent sources were fetched.',
      },
    });
    const overriddenWarning = overrideResponse.json().researchPacket.warnings.find((warning: { id: string }) => warning.id === warningId);

    assert.equal(overrideResponse.statusCode, 200);
    assert.equal(overriddenWarning.override.actor, 'editor@example.com');
    assert.match(overriddenWarning.override.reason, /two independent sources/);
  });

  it('records durable research approval only after readiness and warnings are clear', async () => {
    const blockedPacket = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Blocked Research Review',
      status: 'needs_more_sources',
      sourceDocumentIds: [],
      claims: [],
      citations: [],
      warnings: [{
        id: 'warning-1',
        code: 'INSUFFICIENT_INDEPENDENT_SOURCES',
        message: 'Needs another independent source.',
        severity: 'warning',
      }],
      content: { readiness: { status: 'needs_more_sources' } },
    });
    const blockedResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${blockedPacket.id}/approve`,
      payload: {
        actor: 'editor@example.com',
        reason: 'Attempted approval without enough sourcing.',
      },
    });

    assert.equal(blockedResponse.statusCode, 409);
    assert.equal(blockedResponse.json().code, 'RESEARCH_APPROVAL_BLOCKED');

    const readyPacket = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Ready Research Review',
      status: 'ready',
      sourceDocumentIds: ['source-document-1', 'source-document-2'],
      claims: [{
        id: 'claim-1',
        text: 'A verified claim is supported.',
        sourceDocumentIds: ['source-document-1'],
        citationUrls: ['https://example.com/source'],
      }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/source',
        title: 'Source',
        fetchedAt: '2026-01-03T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { readiness: { status: 'ready', independentSourceCount: 2 } },
    });
    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${readyPacket.id}/approve`,
      payload: {
        actor: 'editor@example.com',
        reason: 'Sources and citations reviewed.',
      },
    });
    const approved = approvalResponse.json().researchPacket as ResearchPacketRecord;

    assert.equal(approvalResponse.statusCode, 201);
    assert.ok(approved.approvedAt);
    assert.equal((approved.content.reviewApproval as { actor: string }).actor, 'editor@example.com');
    assert.deepEqual(
      store.approvalEvents.map((event) => `${event.gate}:${event.action}`),
      ['research-brief:approve'],
    );
  });

  it('builds a research packet from multiple candidates with model warnings and readiness metadata', async () => {
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/multi-one',
        title: 'Multi Candidate One',
        summary: 'The first selected candidate has evidence.',
      },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://independent.example.net/news/multi-two',
        title: 'Multi Candidate Two',
        summary: 'The second selected candidate is part of the same story cluster.',
      },
    });
    const first = firstResponse.json().candidate as StoryCandidateRecord;
    const second = secondResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: '/research-packets',
      payload: {
        candidateIds: [first.id, second.id, first.id],
        angle: 'Shared AI infrastructure story',
        notes: 'Verify whether the sources describe the same infrastructure dependency.',
        targetFormat: 'feature-analysis',
        targetRuntime: '8-10 minutes',
        extraUrls: ['https://model-warning.example.org/source'],
      },
    });
    const body = packetResponse.json();
    const packet = body.researchPacket as ResearchPacketRecord;

    assert.equal(packetResponse.statusCode, 201);
    assert.equal(packet.title, 'Shared AI infrastructure story');
    assert.equal(packet.status, 'ready');
    assert.deepEqual(packet.content.candidateIds, [first.id, second.id]);
    assert.equal(packet.content.notes, 'Verify whether the sources describe the same infrastructure dependency.');
    assert.equal(packet.content.targetFormat, 'feature-analysis');
    assert.equal(packet.content.targetRuntime, '8-10 minutes');
    assert.equal(packet.content.selectedCandidateCount, 2);
    assert.equal(body.job.input.notes, 'Verify whether the sources describe the same infrastructure dependency.');
    assert.equal(body.job.input.targetFormat, 'feature-analysis');
    assert.equal(body.job.input.targetRuntime, '8-10 minutes');
    assert.equal(packet.content.independentSourceCount, 3);
    assert.equal((packet.content.readiness as { status: string }).status, 'ready');
    assert.equal(body.sourceDocuments.length, 3);
    assert.ok(packet.claims.some((claim) => claim.id.startsWith('model-claim-')));
    assert.ok(packet.claims.every((claim) => claim.sourceDocumentIds.length > 0));
    assert.ok(packet.claims.every((claim) => claim.citationUrls.length > 0));
    assert.ok(packet.warnings.some((warning) => warning.code === 'DUPLICATE_CANDIDATE_ID'));
    assert.ok(packet.warnings.some((warning) => warning.code === 'MODEL_SYNTHESIS_WARNING'));
    assert.equal(body.job.output.warningCount, packet.warnings.length);
    assert.deepEqual(body.job.output.failedSourceDocumentIds, []);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/research-packets?showSlug=the-synthetic-lens',
    });

    assert.equal(listResponse.statusCode, 200);
    assert.ok(listResponse.json().researchPackets.some((item: ResearchPacketRecord) => item.id === packet.id));
  });

  it('records partial fetch failures in packet and job warnings without creating fake evidence', async () => {
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/partial-success',
        title: 'Partial Success',
      },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://unavailable.example.org/news/partial-failure',
        title: 'Partial Failure',
      },
    });
    const first = firstResponse.json().candidate as StoryCandidateRecord;
    const second = secondResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: '/research-packets',
      payload: {
        candidateIds: [first.id, second.id],
      },
    });
    const body = packetResponse.json();
    const packet = body.researchPacket as ResearchPacketRecord;
    const failedDocument = body.sourceDocuments.find((document: SourceDocumentRecord) => document.fetchStatus === 'failed') as SourceDocumentRecord;

    assert.equal(packetResponse.statusCode, 201);
    assert.equal(packet.status, 'needs_more_sources');
    assert.ok(failedDocument);
    assert.ok(packet.warnings.some((warning) => warning.code === 'SOURCE_FETCH_FAILED'));
    assert.ok(packet.warnings.some((warning) => warning.code === 'INSUFFICIENT_INDEPENDENT_SOURCES'));
    assert.ok(body.job.output.failedSourceDocumentIds.includes(failedDocument.id));
    assert.ok(body.job.output.warnings.some((warning: ResearchWarning) => warning.code === 'SOURCE_FETCH_FAILED'));
    assert.ok(packet.claims.every((claim) => !claim.sourceDocumentIds.includes(failedDocument.id)));
    assert.ok(packet.claims.every((claim) => !claim.citationUrls.includes(failedDocument.url)));
  });

  it('records model failures as warnings without inventing citations', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://model-failure.example.com/news/research-story',
        title: 'Model Failure Story',
      },
    });
    const candidate = createResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: '/research-packets',
      payload: {
        candidateIds: [candidate.id],
        extraUrls: ['https://independent.example.net/model-failure-backup'],
      },
    });
    const body = packetResponse.json();
    const packet = body.researchPacket as ResearchPacketRecord;
    const fetchedDocumentIds = new Set(
      (body.sourceDocuments as SourceDocumentRecord[])
        .filter((document) => document.fetchStatus === 'fetched')
        .map((document) => document.id),
    );

    assert.equal(packetResponse.statusCode, 201);
    assert.ok(packet.warnings.some((warning) => warning.code === 'MODEL_CLAIM_EXTRACTION_FAILED'));
    assert.ok(body.job.output.warnings.some((warning: ResearchWarning) => warning.code === 'MODEL_CLAIM_EXTRACTION_FAILED'));
    assert.ok(packet.claims.length > 0);
    assert.ok(packet.claims.every((claim) => claim.sourceDocumentIds.every((id) => fetchedDocumentIds.has(id))));
    assert.ok(packet.claims.every((claim) => claim.citationUrls.length > 0));
  });

  it('rejects multi-candidate packets spanning multiple shows', async () => {
    store.shows.push({
      ...store.shows[0],
      id: '99999999-9999-4999-8999-999999999999',
      slug: 'second-show',
      title: 'Second Show',
    });
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/show-one',
        title: 'Show One Candidate',
      },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'second-show',
        url: 'https://manual.example.com/news/show-two',
        title: 'Show Two Candidate',
      },
    });
    const first = firstResponse.json().candidate as StoryCandidateRecord;
    const second = secondResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: '/research-packets',
      payload: {
        candidateIds: [first.id, second.id],
      },
    });
    const body = packetResponse.json();

    assert.equal(packetResponse.statusCode, 400);
    assert.equal(body.code, 'CANDIDATE_SHOW_MISMATCH');
    assert.equal(store.researchPackets.length, 0);
  });

  it('warns when a packet has fewer than two independent fetched sources', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://single-source.example.com/news/research-story',
        title: 'Single Source Story',
      },
    });
    const candidate = createResponse.json().candidate as StoryCandidateRecord;

    const packetResponse = await app.inject({
      method: 'POST',
      url: `/story-candidates/${candidate.id}/research-packet`,
    });
    const warnings = packetResponse.json().researchPacket.warnings as Array<{ code: string }>;

    assert.equal(packetResponse.statusCode, 201);
    assert.ok(warnings.some((warning) => warning.code === 'INSUFFICIENT_INDEPENDENT_SOURCES'));
  });

  it('generates a TSL feature-analysis script from a research packet', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/story-candidates/manual',
      payload: {
        showSlug: 'the-synthetic-lens',
        url: 'https://manual.example.com/news/script-story',
        title: 'Script Story',
        summary: 'A selected script story needs a feature analysis.',
      },
    });
    const candidate = createResponse.json().candidate as StoryCandidateRecord;
    const packetResponse = await app.inject({
      method: 'POST',
      url: `/story-candidates/${candidate.id}/research-packet`,
      payload: {
        extraUrls: ['https://independent.example.net/script-story'],
      },
    });
    const packet = packetResponse.json().researchPacket as ResearchPacketRecord;

    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
      payload: {
        actor: 'editor@example.com',
      },
    });
    const body = scriptResponse.json();

    assert.equal(scriptResponse.statusCode, 201);
    assert.equal(body.job.type, 'script.generate');
    assert.equal(body.job.status, 'succeeded');
    assert.equal(body.job.input.modelProfile.role, 'script_writer');
    assert.equal(body.script.format, 'feature-analysis');
    assert.equal(body.script.researchPacketId, packet.id);
    assert.equal(body.revision.version, 1);
    assert.deepEqual(body.revision.speakers, ['DAVID', 'INGRID', 'MARCUS']);
    assert.match(body.revision.body, /DAVID: This is The Synthetic Lens/);
    assert.match(body.revision.body, /MARCUS: The context matters/);
    assert.equal(body.revision.metadata.source, 'llm');
    assert.equal(body.revision.metadata.validation.speakerLabels.valid, true);
    assert.ok(body.revision.metadata.citationMap.length > 0);
    assert.ok(body.revision.metadata.provenance.citationUrls.length > 0);
    assert.equal(body.job.output.validation.readyForAudio, true);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/scripts?showSlug=the-synthetic-lens&researchPacketId=${packet.id}`,
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().scripts.length, 1);
  });

  it('blocks script generation for blocked research packets', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Blocked Packet Story',
      status: 'blocked',
      sourceDocumentIds: [],
      claims: [],
      citations: [],
      warnings: [{
        id: 'NO_SOURCES',
        code: 'NO_SOURCES',
        severity: 'error',
        message: 'No usable sources are available.',
      }],
      content: {
        summary: 'Blocked packet.',
        readiness: { status: 'blocked', reasons: ['No usable sources are available.'] },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 409);
    assert.equal(body.code, 'RESEARCH_PACKET_BLOCKED');
    assert.equal(store.scripts.length, 0);
    assert.equal(store.jobs.at(-1)?.type, 'script.generate');
    assert.equal(store.jobs.at(-1)?.status, 'failed');
  });

  it('rejects generated scripts with speaker labels outside the show cast', async () => {
    scriptLlmMode = 'unknown-speaker';
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Generated Speaker Validation Story',
      status: 'ready',
      sourceDocumentIds: ['source-document-1'],
      claims: [{
        id: 'claim-1',
        text: 'A sourced claim exists.',
        sourceDocumentIds: ['source-document-1'],
        citationUrls: ['https://example.com/generated-speaker'],
      }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/generated-speaker',
        title: 'Generated speaker source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary.', readiness: { status: 'ready', reasons: [] } },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 400);
    assert.equal(body.code, 'INVALID_SCRIPT_SPEAKER');
    assert.match(body.error, /BOGUS/);
    assert.equal(store.scripts.length, 0);
    assert.equal(store.jobs.at(-1)?.status, 'failed');
  });

  it('fails safely when the model returns malformed script output', async () => {
    scriptLlmMode = 'malformed';
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Malformed Model Story',
      status: 'ready',
      sourceDocumentIds: ['source-document-1'],
      claims: [{
        id: 'claim-1',
        text: 'A sourced malformed-output claim exists.',
        sourceDocumentIds: ['source-document-1'],
        citationUrls: ['https://example.com/malformed'],
      }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/malformed',
        title: 'Malformed source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary.', readiness: { status: 'ready', reasons: [] } },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 502);
    assert.equal(body.code, 'MALFORMED_MODEL_OUTPUT');
    assert.equal(store.scripts.length, 0);
    assert.equal(store.jobs.at(-1)?.status, 'failed');
  });

  it('rejects human script edits with speaker labels outside the show cast', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Speaker Validation Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A sourced claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary.' },
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const script = scriptResponse.json().script as ScriptRecord;

    const editResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${script.id}/revisions`,
      payload: {
        body: 'BOGUS: This speaker is not in the show cast.',
        actor: 'editor@example.com',
      },
    });
    const body = editResponse.json();

    assert.equal(editResponse.statusCode, 400);
    assert.equal(body.code, 'INVALID_SCRIPT_SPEAKER');
    assert.match(body.error, /BOGUS/);
    assert.equal(store.scriptRevisions.length, 1);
  });

  it('creates a new revision for human edits and approves that revision for audio', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Revision Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A revision claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/revision'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for revision testing.' },
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const initial = scriptResponse.json();

    const editResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions`,
      payload: {
        title: 'Edited Revision Story Script',
        body: 'DAVID: A human editor rewrote this opening.\nMARCUS: The analysis remains tied to sourced claims.',
        actor: 'editor@example.com',
        changeSummary: 'Tightened the opening.',
      },
    });
    const edited = editResponse.json();

    assert.equal(editResponse.statusCode, 201);
    assert.equal(edited.revision.version, 2);
    assert.equal(edited.revision.author, 'editor@example.com');
    assert.equal(edited.script.title, 'Edited Revision Story Script');
    assert.notEqual(edited.revision.id, initial.revision.id);
    assert.match(store.scriptRevisions[0].body, /This is The Synthetic Lens/);
    assert.equal(edited.revision.metadata.source, 'human-edit');
    assert.equal(edited.revision.metadata.inheritedProvenance, true);
    assert.equal(edited.revision.metadata.citationMap, undefined);
    assert.equal(edited.revision.metadata.provenance, undefined);
    assert.deepEqual(edited.revision.metadata.staleCitationMap, initial.revision.metadata.citationMap);
    assert.deepEqual(edited.revision.metadata.previousProvenanceSnapshot, initial.revision.metadata.provenance);
    assert.equal(edited.revision.metadata.previousRevisionId, initial.revision.id);
    assert.equal(edited.revision.metadata.previousApprovedRevisionId, null);
    assert.equal((edited.revision.metadata.provenanceStatus as { status: string }).status, 'stale');
    assert.equal((edited.revision.metadata.provenanceStatus as { verified: boolean }).verified, false);
    assert.equal((edited.revision.metadata.provenanceStatus as { reason: string }).reason, 'human_edit');
    assert.equal(edited.revision.metadata.validation.speakerLabels.valid, true);

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${edited.script.id}/revisions/${edited.revision.id}/approve-for-audio`,
      payload: {
        actor: 'producer@example.com',
        reason: 'Ready for deterministic audio preview.',
      },
    });
    const approved = approveResponse.json().script as ScriptRecord;

    assert.equal(approveResponse.statusCode, 200);
    assert.equal(approved.status, 'approved-for-audio');
    assert.equal(approved.approvedRevisionId, edited.revision.id);
    assert.ok(approved.approvedAt);
  });

  it('does not carry prior approval or integrity review forward after a human script edit', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Approved Revision Edit Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'An approved revision claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/approved-edit'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/approved-edit',
        title: 'Approved Edit Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for approved revision edit testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const integrityResponse = await runIntegrityReview(initial.script.id, initial.revision.id);

    assert.equal(integrityResponse.statusCode, 201);
    assert.equal(integrityResponse.json().integrityReview.status, 'pass');

    const initialApproval = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com', reason: 'Initial revision reviewed.' },
    });
    assert.equal(initialApproval.statusCode, 200);
    assert.equal(initialApproval.json().script.approvedRevisionId, initial.revision.id);

    const editResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions`,
      payload: {
        body: 'DAVID: A human editor changed the sourced line.\nINGRID: This replacement needs a fresh integrity pass before assets.',
        actor: 'editor@example.com',
        changeSummary: 'Changed the sourced line.',
      },
    });
    const edited = editResponse.json();

    assert.equal(editResponse.statusCode, 201);
    assert.equal(edited.script.status, 'draft');
    assert.equal(edited.script.approvedRevisionId, null);
    assert.equal(edited.script.approvedAt, null);
    assert.equal(edited.revision.metadata.integrityReview, undefined);
    assert.equal((edited.revision.metadata.provenanceStatus as { status: string }).status, 'stale');
    assert.equal((edited.revision.metadata.provenanceStatus as { previousApprovedRevisionId: string }).previousApprovedRevisionId, initial.revision.id);
    assert.equal(edited.revision.metadata.previousApprovedRevisionId, initial.revision.id);
    assert.deepEqual(edited.revision.metadata.previousIntegrityReviewSnapshot, integrityResponse.json().integrityReview);
    assert.deepEqual(edited.revision.metadata.staleCitationMap, initial.revision.metadata.citationMap);

    const editedApprovalResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${edited.script.id}/revisions/${edited.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com', reason: 'Explicitly approving edited revision.' },
    });
    assert.equal(editedApprovalResponse.statusCode, 200);
    assert.equal(editedApprovalResponse.json().script.approvedRevisionId, edited.revision.id);
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${edited.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 409);
    assert.equal(audioResponse.json().code, 'INTEGRITY_REVIEW_REQUIRED');
  });

  it('creates a new draft revision from an AI coaching action', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Coaching Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A coaching claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/coaching'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/coaching',
        title: 'Coaching Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for script coaching.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const coachResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/coach`,
      payload: {
        action: 'reduce_certainty',
        actor: 'editor@example.com',
      },
    });
    const coached = coachResponse.json();

    assert.equal(coachResponse.statusCode, 201);
    assert.equal(coached.revision.version, 2);
    assert.notEqual(coached.revision.id, initial.revision.id);
    assert.match(coached.revision.changeSummary, /AI coaching: Reduce certainty/);
    assert.match(coached.revision.body, /preliminary/);
    assert.equal(coached.revision.author, 'editor@example.com');
    assert.equal(coached.script.status, 'draft');
    assert.equal(coached.script.approvedRevisionId, null);
    assert.equal(coached.revision.metadata.source, 'llm-coaching');
    assert.deepEqual(coached.revision.metadata.coachingAction, {
      action: 'reduce_certainty',
      label: 'Reduce certainty',
      description: 'Soften claims that are stronger than the evidence and add caveats where the packet is incomplete.',
    });
    assert.equal(coached.revision.metadata.integrityReview, undefined);
    assert.equal(coached.revision.metadata.citationMap, undefined);
    assert.equal(coached.revision.metadata.provenance, undefined);
    assert.deepEqual(coached.revision.metadata.staleCitationMap, initial.revision.metadata.citationMap);
    assert.equal((coached.revision.metadata.provenanceStatus as { status: string }).status, 'stale');
    assert.equal((coached.revision.metadata.provenanceStatus as { reason: string }).reason, 'ai_coaching');
    assert.equal(coached.revision.metadata.validation.speakerLabels.valid, true);
  });

  it('rejects unsupported AI coaching actions', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Unsupported Coaching Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/unsupported-coaching'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for unsupported action testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const coachResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/coach`,
      payload: {
        action: 'make_it_viral',
        actor: 'editor@example.com',
      },
    });

    assert.equal(coachResponse.statusCode, 400);
    assert.equal(coachResponse.json().code, 'VALIDATION_ERROR');
    assert.equal(store.scriptRevisions.length, 1);
  });

  it('does not carry prior approval or integrity review forward after AI coaching', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Approved Coaching Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'An approved coaching claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/approved-coaching'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/approved-coaching',
        title: 'Approved Coaching Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for approved coaching testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const integrityResponse = await runIntegrityReview(initial.script.id, initial.revision.id);

    assert.equal(integrityResponse.statusCode, 201);
    assert.equal(integrityResponse.json().integrityReview.status, 'pass');

    const initialApproval = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com', reason: 'Initial revision reviewed.' },
    });
    assert.equal(initialApproval.statusCode, 200);
    assert.equal(initialApproval.json().script.approvedRevisionId, initial.revision.id);

    const coachResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/coach`,
      payload: {
        action: 'add_attribution',
        actor: 'editor@example.com',
      },
    });
    const coached = coachResponse.json();

    assert.equal(coachResponse.statusCode, 201);
    assert.equal(coached.script.status, 'draft');
    assert.equal(coached.script.approvedRevisionId, null);
    assert.equal(coached.script.approvedAt, null);
    assert.equal(coached.revision.metadata.integrityReview, undefined);
    assert.equal(coached.revision.metadata.previousApprovedRevisionId, initial.revision.id);
    assert.deepEqual(coached.revision.metadata.previousIntegrityReviewSnapshot, integrityResponse.json().integrityReview);
    assert.deepEqual(coached.revision.metadata.staleCitationMap, initial.revision.metadata.citationMap);
    assert.equal((coached.revision.metadata.provenanceStatus as { previousApprovedRevisionId: string }).previousApprovedRevisionId, initial.revision.id);

    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${coached.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 409);
    assert.equal(audioResponse.json().code, 'SCRIPT_NOT_APPROVED_FOR_AUDIO');
  });

  it('fails safely when AI coaching returns malformed output', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Malformed Coaching Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A malformed coaching claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/malformed-coaching'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/malformed-coaching',
        title: 'Malformed Coaching Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for malformed coaching testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const initialApproval = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com', reason: 'Approved before failed coaching.' },
    });
    assert.equal(initialApproval.statusCode, 200);

    scriptEditorMode = 'malformed';
    const revisionCount = store.scriptRevisions.length;
    const coachResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/coach`,
      payload: {
        action: 'reduce_sensationalism',
        actor: 'editor@example.com',
      },
    });
    const scriptAfterFailure = await store.getScript(initial.script.id);

    assert.equal(coachResponse.statusCode, 502);
    assert.equal(coachResponse.json().code, 'MALFORMED_MODEL_OUTPUT');
    assert.equal(store.scriptRevisions.length, revisionCount);
    assert.equal(scriptAfterFailure?.status, 'approved-for-audio');
    assert.equal(scriptAfterFailure?.approvedRevisionId, initial.revision.id);
  });

  it('rejects AI coaching output with speaker labels outside the show cast', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Unknown Speaker Coaching Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'An unknown speaker coaching claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/unknown-speaker-coaching'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/unknown-speaker-coaching',
        title: 'Unknown Speaker Coaching Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for unknown speaker coaching testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const revisionCount = store.scriptRevisions.length;

    scriptEditorMode = 'unknown-speaker';
    const coachResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/coach`,
      payload: {
        action: 'add_attribution',
        actor: 'editor@example.com',
      },
    });

    assert.equal(coachResponse.statusCode, 400);
    assert.equal(coachResponse.json().code, 'INVALID_SCRIPT_SPEAKER');
    assert.equal(store.scriptRevisions.length, revisionCount);
  });

  it('runs and persists a passing integrity review for a script revision', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Integrity Pass Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'An integrity-reviewed claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/integrity-pass'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/integrity-pass',
        title: 'Integrity Pass Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for integrity review testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const reviewResponse = await runIntegrityReview(initial.script.id, initial.revision.id);
    const reviewBody = reviewResponse.json();

    assert.equal(reviewResponse.statusCode, 201);
    assert.equal(reviewBody.integrityReview.verdict, 'PASS');
    assert.equal(reviewBody.integrityReview.status, 'pass');
    assert.equal(reviewBody.integrityReview.researchPacketId, packet.id);
    assert.equal(reviewBody.integrityReview.result.claimIssues.length, 0);
    assert.equal(reviewBody.revision.metadata.integrityReview.verdict, 'PASS');

    const scriptDetail = await app.inject({ method: 'GET', url: `/scripts/${initial.script.id}` });
    assert.equal(scriptDetail.json().latestRevision.metadata.integrityReview.status, 'pass');
  });

  it('allows production after a pass-with-notes integrity review while preserving warnings', async () => {
    integrityReviewMode = 'notes';
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Integrity Notes Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A sourced notes claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/integrity-notes'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/integrity-notes',
        title: 'Integrity Notes Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for integrity notes testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const reviewResponse = await runIntegrityReview(initial.script.id, initial.revision.id);

    assert.equal(reviewResponse.statusCode, 201);
    assert.equal(reviewResponse.json().integrityReview.status, 'pass_with_notes');
    assert.equal(reviewResponse.json().integrityReview.issueCounts.attributionWarnings, 1);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 201);
    assert.equal(audioResponse.json().job.output.integrityReview.status, 'pass_with_notes');
  });

  it('blocks production when the latest required integrity review fails', async () => {
    integrityReviewMode = 'fail';
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Integrity Fail Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A sourced fail claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/production'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/production',
        title: 'Integrity Fail Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for failed integrity review testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();
    const reviewResponse = await runIntegrityReview(initial.script.id, initial.revision.id);

    assert.equal(reviewResponse.json().integrityReview.status, 'fail');

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });
    const body = audioResponse.json();

    assert.equal(audioResponse.statusCode, 409);
    assert.equal(body.code, 'INTEGRITY_REVIEW_BLOCKED');
    assert.equal(body.blockedReasons[0].code, 'INTEGRITY_REVIEW_BLOCKED');
    assert.equal(store.episodeAssets.length, 0);
  });

  it('allows production after an explicit integrity review override reason is recorded', async () => {
    integrityReviewMode = 'fail';
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Integrity Override Story',
      status: 'approved',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A sourced override claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/override'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/override',
        title: 'Integrity Override Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary for integrity override testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    const rejectedOverride = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/integrity-review/override`,
      payload: { actor: 'editor@example.com', reason: '' },
    });
    assert.equal(rejectedOverride.statusCode, 400);

    const overrideResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/integrity-review/override`,
      payload: {
        actor: 'editor@example.com',
        reason: 'Editor verified the flagged wording against an updated source outside the model review.',
      },
    });
    assert.equal(overrideResponse.statusCode, 201);
    assert.equal(overrideResponse.json().integrityReview.status, 'overridden');

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 201);
    assert.equal(audioResponse.json().job.output.integrityReview.status, 'overridden');
    assert.equal(store.approvalEvents.some((event) => event.gate === 'integrity-review' && event.action === 'override'), true);
  });

  it('blocks production when an approved script revision has no integrity review', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Missing Integrity Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A missing review claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/missing-review'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for missing review testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 409);
    assert.equal(audioResponse.json().code, 'INTEGRITY_REVIEW_REQUIRED');
  });

  it('treats malformed integrity review status and empty overrides as blocking', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Malformed Integrity Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A malformed review claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/malformed-review'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for malformed review testing.' },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();

    await store.updateScriptRevisionMetadata(initial.revision.id, {
      ...initial.revision.metadata,
      integrityReview: {
        status: 'overridden',
        verdict: 'PASS',
        override: { reason: '   ' },
      },
    });

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });

    assert.equal(audioResponse.statusCode, 409);
    assert.equal(audioResponse.json().code, 'INTEGRITY_REVIEW_REQUIRED');
    assert.equal(audioResponse.json().blockedReasons[0].metadata.status, 'missing');
  });

  it('produces preview audio and cover art as durable jobs linked to an episode', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Production Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A production claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/production'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for production testing.' },
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: {
        actor: 'producer@example.com',
        reason: 'Ready for production.',
      },
    });

    const audioResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });
    const audioBody = audioResponse.json();

    assert.equal(audioResponse.statusCode, 201);
    assert.equal(audioBody.job.type, 'audio.preview');
    assert.equal(audioBody.job.status, 'succeeded');
    assert.equal(audioBody.job.progress, 100);
    assert.equal(audioBody.asset.type, 'audio-preview');
    assert.equal(audioBody.asset.mimeType, 'audio/mpeg');
    assert.equal(audioBody.asset.metadata.provider, 'vertex-gemini-tts');
    assert.equal(audioBody.asset.metadata.adapterKind, 'fake-local-audio-preview');
    assert.match(audioBody.asset.localPath, /audio-preview\.mp3$/);
    assert.equal(audioBody.job.output.stage, 'completed');
    assert.equal(audioBody.job.output.byteSize, audioBody.asset.byteSize);
    assert.equal(audioBody.job.output.mimeType, 'audio/mpeg');
    assert.equal(audioBody.episode.status, 'audio-ready');
    assert.equal(audioBody.episode.metadata.audioPreviewAssetId, audioBody.asset.id);

    const artResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/cover-art`,
      payload: { actor: 'producer@example.com' },
    });
    const artBody = artResponse.json();

    assert.equal(artResponse.statusCode, 201);
    assert.equal(artBody.job.type, 'art.generate');
    assert.equal(artBody.job.status, 'succeeded');
    assert.equal(artBody.job.input.modelProfile.role, 'cover_prompt_writer');
    assert.equal(artBody.job.input.promptMetadata.source, 'cover_prompt_writer');
    assert.equal(artBody.job.output.promptResult.altText, 'Abstract editorial cover art for a sourced AI news episode.');
    assert.equal(artBody.asset.type, 'cover-art');
    assert.equal(artBody.asset.mimeType, 'image/png');
    assert.equal(artBody.asset.metadata.provider, 'openai-gpt-image');
    assert.equal(artBody.asset.metadata.promptMetadata.source, 'cover_prompt_writer');
    assert.match(artBody.asset.localPath, /cover\.png$/);
    assert.equal(artBody.episode.id, audioBody.episode.id);
    assert.equal(artBody.episode.metadata.coverArtAssetId, artBody.asset.id);

    const jobResponse = await app.inject({ method: 'GET', url: `/jobs/${audioBody.job.id}` });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().job.output.assetId, audioBody.asset.id);

    const productionResponse = await app.inject({ method: 'GET', url: `/scripts/${initial.script.id}/production` });
    const productionBody = productionResponse.json();

    assert.equal(productionResponse.statusCode, 200);
    assert.equal(productionBody.episode.id, audioBody.episode.id);
    assert.deepEqual(
      productionBody.assets.map((asset: EpisodeAssetRecord) => asset.type).sort(),
      ['audio-preview', 'cover-art'],
    );
    assert.deepEqual(
      productionBody.jobs.map((job: JobRecord) => job.type).sort(),
      ['art.generate', 'audio.preview'],
    );

    const audioAssetResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${audioBody.asset.id}/content`,
    });

    assert.equal(audioAssetResponse.statusCode, 200);
    assert.match(String(audioAssetResponse.headers['content-type'] ?? ''), /audio\/mpeg/);
    assert.match(String(audioAssetResponse.headers['cache-control'] ?? ''), /no-store/);
    assert.match(String(audioAssetResponse.headers['content-disposition'] ?? ''), /inline; filename="audio-preview\.mp3"/);
    assert.match(audioAssetResponse.body, /^ID3/);
    assert.doesNotMatch(JSON.stringify(audioAssetResponse.headers), /tmp\/podcast-forge-production-assets/);

    const downloadResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${audioBody.asset.id}/content?download=1`,
    });

    assert.equal(downloadResponse.statusCode, 200);
    assert.match(String(downloadResponse.headers['content-disposition'] ?? ''), /attachment; filename="audio-preview\.mp3"/);

    const coverAssetResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${artBody.asset.id}/content`,
    });

    assert.equal(coverAssetResponse.statusCode, 200);
    assert.match(String(coverAssetResponse.headers['content-type'] ?? ''), /image\/png/);

    const blockedAsset = await store.createEpisodeAsset({
      episodeId: audioBody.episode.id,
      type: 'audio-preview',
      label: 'Blocked audio',
      localPath: '/etc/passwd',
      objectKey: null,
      publicUrl: null,
      mimeType: 'audio/mpeg',
      byteSize: 10,
      durationSeconds: 1,
      checksum: null,
      metadata: {},
    });
    const blockedResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${blockedAsset.id}/content`,
    });

    assert.equal(blockedResponse.statusCode, 403);
    assert.equal(blockedResponse.json().code, 'ASSET_PATH_NOT_ALLOWED');

    const outsideDir = await mkdtemp(join(tmpdir(), 'podcast-forge-outside-'));
    const outsideFile = join(outsideDir, 'outside.mp3');
    await writeFile(outsideFile, 'outside asset');
    const symlinkPath = `${audioBody.asset.localPath}.link`;
    await symlink(outsideFile, symlinkPath);
    const symlinkAsset = await store.createEpisodeAsset({
      episodeId: audioBody.episode.id,
      type: 'audio-preview',
      label: 'Symlink audio',
      localPath: symlinkPath,
      objectKey: null,
      publicUrl: null,
      mimeType: 'audio/mpeg',
      byteSize: 13,
      durationSeconds: 1,
      checksum: null,
      metadata: {},
    });
    const symlinkResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${symlinkAsset.id}/content`,
    });

    assert.equal(symlinkResponse.statusCode, 403);
    assert.equal(symlinkResponse.json().code, 'ASSET_PATH_NOT_ALLOWED');

    const htmlMimeAsset = await store.createEpisodeAsset({
      episodeId: audioBody.episode.id,
      type: 'audio-preview',
      label: 'Suspicious MIME audio',
      localPath: audioBody.asset.localPath,
      objectKey: null,
      publicUrl: null,
      mimeType: 'text/html',
      byteSize: audioBody.asset.byteSize,
      durationSeconds: 1,
      checksum: null,
      metadata: {},
    });
    const htmlMimeResponse = await app.inject({
      method: 'GET',
      url: `/episodes/${audioBody.episode.id}/assets/${htmlMimeAsset.id}/content`,
    });

    assert.equal(htmlMimeResponse.statusCode, 200);
    assert.match(String(htmlMimeResponse.headers['content-type'] ?? ''), /application\/octet-stream/);
  });

  it('rejects RSS publishing until an episode is approved for publish', async () => {
    const { episode } = await createProducedEpisode('Unapproved Publish Story');
    const response = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });
    const body = response.json();

    assert.equal(response.statusCode, 409);
    assert.equal(body.code, 'PUBLISH_BLOCKED');
    assert.deepEqual(body.blockedReasons.map((reason: { code: string }) => reason.code), ['EPISODE_NOT_APPROVED_FOR_PUBLISH']);
    assert.equal(store.jobs.some((job) => job.type === 'publish.rss'), false);
    assert.equal(uploadedPublishAssets.length, 0);
  });

  it('blocks RSS publishing before mutations when feed public URLs are unusable', async () => {
    const { episode } = await createProducedEpisode('Missing Feed URL Story');

    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });

    assert.equal(approvalResponse.statusCode, 201);
    store.feeds[0].publicFeedUrl = null;
    store.feeds[0].publicBaseUrl = null;
    store.feeds[0].rssFeedPath = null;

    const response = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });
    const body = response.json();

    assert.equal(response.statusCode, 409);
    assert.equal(body.code, 'PUBLISH_BLOCKED');
    assert.equal(
      body.blockedReasons.some((reason: { code: string }) => reason.code === 'PUBLISH_FEED_PUBLIC_URL_REQUIRED'),
      true,
    );
    assert.equal(store.jobs.some((job) => job.type === 'publish.rss'), false);
    assert.equal(store.publishEvents.length, 0);
    assert.equal(uploadedPublishAssets.length, 0);
    assert.equal(rssEntries.size, 0);
    assert.equal(store.episodes.find((candidate) => candidate.id === episode.id)?.status, 'approved-for-publish');
  });

  it('blocks publish approval when the research brief has no recorded approval event', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Unreviewed Research Publish Story',
      status: 'ready',
      sourceDocumentIds: ['source-document-1'],
      claims: [{ id: 'claim-1', text: 'A sourced claim exists.', sourceDocumentIds: ['source-document-1'], citationUrls: ['https://example.com/research'] }],
      citations: [{
        sourceDocumentId: 'source-document-1',
        url: 'https://example.com/research',
        title: 'Research Source',
        fetchedAt: '2026-01-04T00:00:00.000Z',
        status: 'fetched',
      }],
      warnings: [],
      content: { summary: 'A packet summary.', readiness: { status: 'ready' } },
    });
    const scriptResponse = await app.inject({ method: 'POST', url: `/research-packets/${packet.id}/script` });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });
    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
      payload: { actor: 'producer@example.com' },
    });
    const artResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/cover-art`,
      payload: { actor: 'producer@example.com' },
    });
    const episode = artResponse.json().episode as EpisodeRecord;
    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });
    const body = approvalResponse.json();

    assert.equal(approvalResponse.statusCode, 409);
    assert.equal(body.code, 'PUBLISH_APPROVAL_BLOCKED');
    assert.equal(
      body.blockedReasons.some((reason: { code: string }) => reason.code === 'RESEARCH_BRIEF_NOT_APPROVED'),
      true,
    );
    assert.equal(store.approvalEvents.some((event) => event.gate === 'episode-publish'), false);
  });

  it('uses a provided cover prompt without invoking the prompt writer', async () => {
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Provided Prompt Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A provided prompt claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/prompt'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for provided prompt testing.' },
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: { actor: 'producer@example.com' },
    });

    const artResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/cover-art`,
      payload: {
        actor: 'producer@example.com',
        prompt: 'Use a quiet newsroom desk with abstract waveform lines.',
      },
    });
    const artBody = artResponse.json();

    assert.equal(artResponse.statusCode, 201);
    assert.equal(artBody.job.input.prompt, 'Use a quiet newsroom desk with abstract waveform lines.');
    assert.equal(artBody.job.input.promptMetadata.source, 'provided');
    assert.equal(artBody.asset.metadata.prompt, 'Use a quiet newsroom desk with abstract waveform lines.');
  });

  it('publishes approved episodes to RSS with uploaded assets, OP3 wrapping, and URL validation', async () => {
    const { episode } = await createProducedEpisode('Approved Publish Story');
    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: {
        actor: 'editor@example.com',
        reason: 'Final audio and art approved.',
      },
    });

    assert.equal(approvalResponse.statusCode, 201);
    assert.equal(approvalResponse.json().episode.status, 'approved-for-publish');

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });
    const publishBody = publishResponse.json();

    assert.equal(publishResponse.statusCode, 201);
    assert.equal(publishBody.job.type, 'publish.rss');
    assert.equal(publishBody.job.status, 'succeeded');
    assert.equal(publishBody.episode.status, 'published');
    assert.equal(publishBody.publishEvent.status, 'succeeded');
    assert.equal(uploadedPublishAssets.length, 2);
    assert.deepEqual(uploadedPublishAssets.map((asset) => asset.type).sort(), ['audio-preview', 'cover-art']);
    assert.match(publishBody.publishEvent.audioUrl, /^https:\/\/op3\.dev\/e\/https:\/\/cdn\.example\.com\//);
    assert.equal(publishBody.publishEvent.coverUrl.startsWith('https://cdn.example.com/'), true);
    assert.equal(publishBody.publishEvent.rssUrl, 'https://podcast.example.com/the-synthetic-lens/feed.xml');
    assert.equal(validatedPublishUrls.includes(publishBody.publishEvent.audioUrl), true);
    assert.equal(validatedPublishUrls.includes(publishBody.publishEvent.coverUrl), true);
    assert.equal(validatedPublishUrls.includes(publishBody.publishEvent.rssUrl), true);
    assert.equal(rssEntries.size, 1);
    assert.equal(Array.from(rssEntries.values())[0]?.guid, publishBody.episode.feedGuid);
  });

  it('records failed publish state without mutating RSS or marking the episode published when URL validation fails', async () => {
    const { episode } = await createProducedEpisode('Failed Publish Validation Story');

    await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });

    let rssMutationCount = 0;
    const validationApp = buildApp({
      sourceStore: store,
      braveApiKey: 'test-brave-key',
      fetchImpl: braveFetch,
      rssFetchImpl: rssFetch,
      researchFetchImpl: researchFetch,
      researchModelServices,
      llmRuntime,
      publishStorageAdapterFactory,
      rssUpdateAdapter: {
        async upsertEpisode({ feed, entry }) {
          rssMutationCount += 1;
          return {
            rssUrl: feed.publicFeedUrl ?? 'https://podcast.example.com/feed.xml',
            inserted: !rssEntries.has(entry.guid),
            itemCount: rssEntries.size,
          };
        },
      },
      publishUrlValidator: {
        async validate(urls) {
          validatedPublishUrls.push(...urls);
          return urls.map((url) => ({ url, ok: !url.includes('/cover-art') }));
        },
      },
      sleep: async () => {},
    });

    try {
      const response = await validationApp.inject({
        method: 'POST',
        url: `/episodes/${episode.id}/publish/rss`,
        payload: { actor: 'publisher@example.com' },
      });
      const body = response.json();

      assert.equal(response.statusCode, 502);
      assert.equal(body.code, 'PUBLISHED_URL_VALIDATION_FAILED');
      assert.equal(body.job.status, 'failed');
      assert.equal(body.job.output.stage, 'validating-public-urls');
      assert.equal(rssMutationCount, 0);
      assert.equal(rssEntries.size, 0);
      assert.equal(store.episodes.find((candidate) => candidate.id === episode.id)?.status, 'approved-for-publish');
      assert.equal(store.publishEvents.filter((event) => event.status === 'succeeded').length, 0);
      assert.equal(store.publishEvents.filter((event) => event.status === 'failed').length, 1);
    } finally {
      await validationApp.close();
    }
  });

  it('records failed publish state when the RSS adapter returns a different invalid final URL', async () => {
    const { episode } = await createProducedEpisode('Failed Final RSS URL Story');

    await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });

    let rssMutationCount = 0;
    const finalUrlApp = buildApp({
      sourceStore: store,
      braveApiKey: 'test-brave-key',
      fetchImpl: braveFetch,
      rssFetchImpl: rssFetch,
      researchFetchImpl: researchFetch,
      researchModelServices,
      llmRuntime,
      publishStorageAdapterFactory,
      rssUpdateAdapter: {
        async upsertEpisode() {
          rssMutationCount += 1;
          return {
            rssUrl: 'https://podcast.example.com/rebuilt-feed.xml',
            inserted: true,
            itemCount: 1,
          };
        },
      },
      publishUrlValidator: {
        async validate(urls) {
          validatedPublishUrls.push(...urls);
          return urls.map((url) => ({ url, ok: !url.includes('rebuilt-feed.xml') }));
        },
      },
      sleep: async () => {},
    });

    try {
      const response = await finalUrlApp.inject({
        method: 'POST',
        url: `/episodes/${episode.id}/publish/rss`,
        payload: { actor: 'publisher@example.com' },
      });
      const body = response.json();

      assert.equal(response.statusCode, 502);
      assert.equal(body.code, 'PUBLISHED_URL_VALIDATION_FAILED');
      assert.equal(body.job.status, 'failed');
      assert.equal(body.job.output.stage, 'updating-rss');
      assert.equal(rssMutationCount, 1);
      assert.equal(validatedPublishUrls.includes('https://podcast.example.com/rebuilt-feed.xml'), true);
      assert.equal(store.episodes.find((candidate) => candidate.id === episode.id)?.status, 'approved-for-publish');
      assert.equal(store.publishEvents.filter((event) => event.status === 'succeeded').length, 0);
      assert.equal(store.publishEvents.filter((event) => event.status === 'failed').length, 1);
    } finally {
      await finalUrlApp.close();
    }
  });

  it('keeps RSS publishing idempotent by episode feed GUID', async () => {
    const { episode } = await createProducedEpisode('Idempotent Publish Story');

    await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });
    store.feeds[0].publicFeedUrl = null;
    store.feeds[0].publicBaseUrl = null;
    store.feeds[0].rssFeedPath = null;
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });
    const firstBody = firstResponse.json();
    const secondBody = secondResponse.json();

    assert.equal(firstResponse.statusCode, 201);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(firstBody.episode.feedGuid, secondBody.episode.feedGuid);
    assert.equal(firstBody.job.output.rssInserted, true);
    assert.equal(secondBody.idempotent, true);
    assert.equal(secondBody.job.output.idempotent, true);
    assert.equal(secondBody.job.output.rssInserted, false);
    assert.equal(rssEntries.size, 1);
    assert.equal(uploadedPublishAssets.length, 2);
    assert.equal(store.publishEvents.filter((event) => event.status === 'succeeded').length, 1);
  });

  it('requires an explicit changelog to re-publish an already published episode', async () => {
    const { episode } = await createProducedEpisode('Republish Changelog Story');

    await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/approve-for-publish`,
      payload: { actor: 'editor@example.com' },
    });
    await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com' },
    });

    const blockedResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: { actor: 'publisher@example.com', republish: true },
    });
    const blockedBody = blockedResponse.json();

    assert.equal(blockedResponse.statusCode, 409);
    assert.equal(blockedBody.code, 'PUBLISH_BLOCKED');
    assert.deepEqual(blockedBody.blockedReasons.map((reason: { code: string }) => reason.code), ['REPUBLISH_CHANGELOG_REQUIRED']);

    const republishResponse = await app.inject({
      method: 'POST',
      url: `/episodes/${episode.id}/publish/rss`,
      payload: {
        actor: 'publisher@example.com',
        republish: true,
        changelog: 'Corrected the episode description and regenerated feed metadata.',
      },
    });
    const republishBody = republishResponse.json();

    assert.equal(republishResponse.statusCode, 201);
    assert.equal(republishBody.job.output.rssInserted, false);
    assert.equal(republishBody.publishEvent.changelog, 'Corrected the episode description and regenerated feed metadata.');
    assert.equal(store.publishEvents.filter((event) => event.status === 'succeeded').length, 2);
  });

  it('records production job failure state and allows a later retry', async () => {
    const failingAudioProvider: AudioPreviewProvider = {
      async generatePreviewAudio() {
        throw new Error('Synthetic TTS failure');
      },
    };
    const failingApp = buildApp({
      sourceStore: store,
      audioPreviewProvider: failingAudioProvider,
    });
    const packet = await store.createResearchPacket({
      showId: store.shows[0].id,
      episodeCandidateId: null,
      title: 'Retry Story',
      status: 'approved',
      sourceDocumentIds: [],
      claims: [{ id: 'claim-1', text: 'A retry claim exists.', sourceDocumentIds: [], citationUrls: ['https://example.com/retry'] }],
      citations: [],
      warnings: [],
      content: { summary: 'A packet summary for retry testing.' },
    });
    const scriptResponse = await app.inject({
      method: 'POST',
      url: `/research-packets/${packet.id}/script`,
    });
    const initial = scriptResponse.json();

    await runIntegrityReview(initial.script.id, initial.revision.id);

    await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/revisions/${initial.revision.id}/approve-for-audio`,
      payload: {
        actor: 'producer@example.com',
        reason: 'Ready for retry testing.',
      },
    });

    const failedResponse = await failingApp.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
    });
    const failedBody = failedResponse.json();

    assert.equal(failedResponse.statusCode, 500);
    assert.equal(failedBody.job.status, 'failed');
    assert.equal(failedBody.job.error, 'Synthetic TTS failure');
    assert.equal(failedBody.job.output.stage, 'rendering-audio');
    assert.equal(failedBody.job.output.retryable, true);

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/scripts/${initial.script.id}/production/audio-preview`,
    });
    const retryBody = retryResponse.json();

    assert.equal(retryResponse.statusCode, 201);
    assert.equal(retryBody.job.status, 'succeeded');
    assert.notEqual(retryBody.job.id, failedBody.job.id);

    const productionResponse = await app.inject({ method: 'GET', url: `/scripts/${initial.script.id}/production` });
    const jobs = productionResponse.json().jobs as JobRecord[];

    assert.ok(jobs.some((job) => job.status === 'failed'));
    assert.ok(jobs.some((job) => job.status === 'succeeded'));
    await failingApp.close();
  });

  it('returns validation errors for invalid payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/source-profiles',
      payload: {
        slug: '',
        name: '',
        type: 'brave',
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.ok(body.errors.length > 0);
  });
});
