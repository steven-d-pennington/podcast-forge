import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveModelProfile } from './resolver.js';
import type { ModelRole } from './roles.js';
import type {
  CreateModelProfileInput,
  ModelProfileListFilter,
  ModelProfileRecord,
  ModelProfileStore,
  UpdateModelProfileInput,
} from './store.js';

class InMemoryModelProfileStore implements ModelProfileStore {
  profiles: ModelProfileRecord[] = [
    this.profile('candidate_scorer', 'google-vertex', 'gemini-2.5-flash', 0.2),
    this.profile('script_writer', 'openai-codex', 'gpt-5.3-codex', 0.7),
  ];

  async listModelProfiles(filter: ModelProfileListFilter = {}) {
    return this.profiles.filter((profile) => {
      const roleMatches = !filter.role || profile.role === filter.role;
      const showMatches = filter.showId
        ? profile.showId === filter.showId || (filter.includeGlobal && profile.showId === null)
        : true;

      return roleMatches && showMatches;
    });
  }

  async getModelProfile(id: string) {
    return this.profiles.find((profile) => profile.id === id);
  }

  async createModelProfile(input: CreateModelProfileInput) {
    const profile: ModelProfileRecord = {
      ...input,
      id: `model-profile-${this.profiles.length + 1}`,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.profiles.push(profile);
    return profile;
  }

  async updateModelProfile(id: string, input: UpdateModelProfileInput) {
    const profile = await this.getModelProfile(id);

    if (!profile) {
      return undefined;
    }

    Object.assign(profile, input, { updatedAt: new Date('2026-01-02T00:00:00Z') });
    return profile;
  }

  private profile(role: ModelRole, provider: string, model: string, temperature: number): ModelProfileRecord {
    return {
      id: `model-profile-${role}`,
      showId: '11111111-1111-4111-8111-111111111111',
      role,
      provider,
      model,
      temperature,
      maxTokens: 1000,
      budgetUsd: 1,
      fallbacks: [],
      promptTemplateKey: null,
      config: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }
}

describe('model profile resolver', () => {
  it('resolves different TSL roles to different model profiles', async () => {
    const store = new InMemoryModelProfileStore();
    const scorer = await resolveModelProfile(store, {
      showId: '11111111-1111-4111-8111-111111111111',
      role: 'candidate_scorer',
    });
    const writer = await resolveModelProfile(store, {
      showId: '11111111-1111-4111-8111-111111111111',
      role: 'script_writer',
    });

    assert.equal(scorer?.provider, 'google-vertex');
    assert.equal(scorer?.model, 'gemini-2.5-flash');
    assert.equal(writer?.provider, 'openai-codex');
    assert.equal(writer?.model, 'gpt-5.3-codex');
  });

  it('reflects model profile changes without code changes', async () => {
    const store = new InMemoryModelProfileStore();
    const before = await resolveModelProfile(store, {
      showId: '11111111-1111-4111-8111-111111111111',
      role: 'script_writer',
    });

    await store.updateModelProfile('model-profile-script_writer', {
      provider: 'openai',
      model: 'gpt-5.5',
      temperature: 0.5,
    });
    const after = await resolveModelProfile(store, {
      showId: '11111111-1111-4111-8111-111111111111',
      role: 'script_writer',
    });

    assert.equal(before?.model, 'gpt-5.3-codex');
    assert.equal(after?.provider, 'openai');
    assert.equal(after?.model, 'gpt-5.5');
    assert.equal(after?.params.temperature, 0.5);
    assert.equal(after?.version, '2026-01-02T00:00:00.000Z');
  });
});
