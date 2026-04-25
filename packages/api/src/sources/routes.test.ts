import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { buildApp } from '../app.js';
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
  CreateEpisodeAssetInput,
  CreateEpisodeFromScriptInput,
  EpisodeAssetRecord,
  EpisodeRecord,
  ProductionStore,
  UpdateEpisodeProductionInput,
} from '../production/store.js';
import type { ResearchFetch } from '../research/fetch.js';
import type {
  CreateResearchPacketInput,
  CreateSourceDocumentInput,
  OverrideResearchWarningInput,
  ResearchPacketRecord,
  ResearchStore,
  SourceDocumentRecord,
} from '../research/store.js';
import type {
  ApproveScriptRevisionInput,
  CreateScriptRevisionInput,
  CreateScriptWithRevisionInput,
  ListScriptsFilter,
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
    format: 'feature-analysis',
    defaultRuntimeMinutes: 8,
    cast: [
      { name: 'DAVID', role: 'host', voice: 'Orus' },
      { name: 'MARCUS', role: 'analyst', voice: 'Charon' },
      { name: 'INGRID', role: 'correspondent', voice: 'Leda' },
    ],
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
    this.modelProfileRecord('candidate_scorer', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('source_summarizer', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('claim_extractor', 'google-vertex', 'gemini-2.5-flash'),
    this.modelProfileRecord('research_synthesizer', 'google-gemini-cli', 'gemini-3-pro-preview'),
    this.modelProfileRecord('script_writer', 'openai-codex', 'gpt-5.3-codex'),
    this.modelProfileRecord('cover_prompt_writer', 'openai', 'gpt-5.5'),
  ];
  episodes: EpisodeRecord[] = [];
  episodeAssets: EpisodeAssetRecord[] = [];

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

    packet.updatedAt = new Date('2026-01-03T00:00:00Z');
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
const app = buildApp({
  sourceStore: store,
  braveApiKey: 'test-brave-key',
  fetchImpl: braveFetch,
  rssFetchImpl: rssFetch,
  researchFetchImpl: researchFetch,
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
    requestedUrls = [];
    requestedRssUrls = [];
    requestedResearchUrls = [];
  });

  after(async () => {
    await app.close();
  });

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
        includeDomains: ['openai.com'],
        excludeDomains: ['example.com'],
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.sourceProfile.enabled, false);
    assert.equal(body.sourceProfile.weight, 1.75);
    assert.deepEqual(body.sourceProfile.includeDomains, ['openai.com']);
    assert.deepEqual(body.sourceProfile.excludeDomains, ['example.com']);
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
        includeDomains: ['techcrunch.com'],
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
    assert.match(body.revision.body, /MARCUS: What remains uncertain/);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/scripts?showSlug=the-synthetic-lens&researchPacketId=${packet.id}`,
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().scripts.length, 1);
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
    assert.equal(artBody.asset.type, 'cover-art');
    assert.equal(artBody.asset.mimeType, 'image/png');
    assert.equal(artBody.asset.metadata.provider, 'openai-gpt-image');
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
