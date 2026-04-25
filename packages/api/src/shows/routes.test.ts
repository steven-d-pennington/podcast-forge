import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { buildApp } from '../app.js';
import type { ModelRole } from '../models/roles.js';
import type {
  CreateModelProfileInput,
  ModelProfileListFilter,
  ModelProfileRecord,
  UpdateModelProfileInput,
} from '../models/store.js';
import type {
  CreateFeedInput,
  FeedRecord,
  UpdateFeedInput,
} from '../production/store.js';
import type {
  CreateShowInput,
  CreateSourceProfileInput,
  CreateSourceQueryInput,
  ShowRecord,
  SourceProfileRecord,
  SourceQueryRecord,
  SourceStore,
  UpdateShowInput,
  UpdateSourceProfileInput,
  UpdateSourceQueryInput,
} from '../sources/store.js';

class FakeShowOnboardingStore implements SourceStore {
  shows: ShowRecord[] = [{
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'the-synthetic-lens',
    title: 'The Synthetic Lens',
    description: 'AI news',
    setupStatus: 'active',
    format: 'feature-analysis',
    defaultRuntimeMinutes: 8,
    cast: [{ name: 'DAVID', role: 'host', voice: 'Orus' }],
    defaultModelProfile: {},
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }];
  profiles: SourceProfileRecord[] = [];
  queries: SourceQueryRecord[] = [];
  feeds: FeedRecord[] = [];
  modelProfiles: ModelProfileRecord[] = [];

  async listShows() {
    return this.shows;
  }

  async createShow(input: CreateShowInput) {
    const show: ShowRecord = {
      ...input,
      id: `show-${this.shows.length + 1}`,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.shows.push(show);
    return show;
  }

  async updateShow(id: string, input: UpdateShowInput) {
    const show = this.shows.find((candidate) => candidate.id === id);

    if (!show) {
      return undefined;
    }

    Object.assign(show, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return show;
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
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.profiles.push(profile);
    return profile;
  }

  async updateSourceProfile(id: string, input: UpdateSourceProfileInput) {
    const profile = await this.getSourceProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return profile;
  }

  async listSourceQueries(profileId: string) {
    return this.queries.filter((query) => query.sourceProfileId === profileId);
  }

  async createSourceQuery(profileId: string, input: CreateSourceQueryInput) {
    const profile = await this.getSourceProfile(profileId);

    if (!profile) {
      return undefined;
    }

    const query: SourceQueryRecord = {
      ...input,
      id: `query-${this.queries.length + 1}`,
      sourceProfileId: profileId,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.queries.push(query);
    return query;
  }

  async updateSourceQuery(id: string, input: UpdateSourceQueryInput) {
    const query = this.queries.find((candidate) => candidate.id === id);

    if (!query) {
      return undefined;
    }

    Object.assign(query, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return query;
  }

  async deleteSourceQuery(id: string) {
    const before = this.queries.length;
    this.queries = this.queries.filter((query) => query.id !== id);
    return this.queries.length !== before;
  }

  async createFeed(input: CreateFeedInput) {
    const feed: FeedRecord = {
      ...input,
      id: `feed-${this.feeds.length + 1}`,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.feeds.push(feed);
    return feed;
  }

  async listFeeds(showId: string) {
    return this.feeds.filter((feed) => feed.showId === showId);
  }

  async getFeed(id: string) {
    return this.feeds.find((feed) => feed.id === id);
  }

  async updateFeed(id: string, input: UpdateFeedInput) {
    const feed = await this.getFeed(id);

    if (!feed) {
      return undefined;
    }

    Object.assign(feed, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return feed;
  }

  async listModelProfiles(filter: ModelProfileListFilter = {}) {
    const show = filter.showSlug ? this.shows.find((candidate) => candidate.slug === filter.showSlug) : undefined;
    const showId = filter.showId ?? show?.id;

    return this.modelProfiles.filter((profile) => {
      return (!showId || profile.showId === showId)
        && (!filter.role || profile.role === filter.role);
    });
  }

  async getModelProfile(id: string) {
    return this.modelProfiles.find((profile) => profile.id === id);
  }

  async createModelProfile(input: CreateModelProfileInput) {
    const profile: ModelProfileRecord = {
      ...input,
      id: `model-${this.modelProfiles.length + 1}`,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    this.modelProfiles.push(profile);
    return profile;
  }

  async updateModelProfile(id: string, input: UpdateModelProfileInput) {
    const profile = await this.getModelProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date('2026-01-03T00:00:00Z') });
    return profile;
  }
}

describe('show onboarding routes', () => {
  let store: FakeShowOnboardingStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    store = new FakeShowOnboardingStore();
    app = buildApp({ sourceStore: store });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects duplicate show slugs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/shows',
      payload: {
        title: 'Duplicate Lens',
        slug: 'the-synthetic-lens',
        description: 'Duplicate show',
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 409);
    assert.equal(body.code, 'DUPLICATE_SHOW_SLUG');
  });

  it('creates a draft show with a feed, starter source profile, query, and model profiles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/shows',
      payload: {
        name: 'Future Signals',
        slug: 'future-signals',
        description: 'A technology news briefing.',
        hostVoiceDefaults: [{ name: 'HOST', role: 'host', voice: 'Nova' }],
        toneStyleNotes: 'Clear, neutral, concise.',
        scriptFormatNotes: 'Daily brief with cited segments.',
        feed: {
          title: 'Future Signals',
          publicFeedUrl: 'https://podcast.example.com/future-signals/feed.xml',
          publicBaseUrl: 'https://podcast.example.com/future-signals',
          outputPath: 'feeds/future-signals.xml',
        },
        sourceProfileDefaults: {
          queries: ['technology policy news'],
        },
        modelRoleDefaults: {
          script_writer: {
            provider: 'openai',
            model: 'gpt-5.5',
            params: { reasoningEffort: 'high' },
          },
        },
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 201);
    assert.equal(body.show.slug, 'future-signals');
    assert.equal(body.show.setupStatus, 'draft');
    assert.equal(body.feed.publicFeedUrl, 'https://podcast.example.com/future-signals/feed.xml');
    assert.equal(body.sourceProfile.type, 'brave');
    assert.equal(body.sourceQueries[0].query, 'technology policy news');
    assert.equal(body.modelProfiles.length, 8);
    assert.ok(body.show.defaultModelProfile.script_writer);

    const showsResponse = await app.inject({ method: 'GET', url: '/shows' });
    assert.ok(showsResponse.json().shows.some((show: ShowRecord) => show.slug === 'future-signals'));

    const sourcesResponse = await app.inject({ method: 'GET', url: '/source-profiles?showSlug=future-signals' });
    assert.equal(sourcesResponse.json().sourceProfiles.length, 1);

    const modelsResponse = await app.inject({ method: 'GET', url: '/model-profiles?showSlug=future-signals' });
    const roles = modelsResponse.json().modelProfiles.map((profile: { role: ModelRole }) => profile.role);
    assert.ok(roles.includes('script_writer'));
    assert.ok(roles.includes('candidate_scorer'));
  });
});
