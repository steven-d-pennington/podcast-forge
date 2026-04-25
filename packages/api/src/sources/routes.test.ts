import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { buildApp } from '../app.js';
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

class FakeSourceStore implements SourceStore {
  shows: ShowRecord[] = [{
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'the-synthetic-lens',
    title: 'The Synthetic Lens',
    description: 'AI news',
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

  async listShows() {
    return this.shows;
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
}

let store = new FakeSourceStore();
const app = buildApp({ sourceStore: store });

describe('source profile routes', () => {
  beforeEach(() => {
    store.shows = new FakeSourceStore().shows;
    store.profiles = new FakeSourceStore().profiles;
    store.queries = new FakeSourceStore().queries;
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
