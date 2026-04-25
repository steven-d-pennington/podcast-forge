import type { ModelRole } from './roles.js';
import type { ModelProfileRecord, ModelProfileStore } from './store.js';

export interface ModelResolutionContext {
  role: ModelRole;
  showId?: string;
  showSlug?: string;
  feedId?: string;
  feedSlug?: string;
}

export interface ResolvedModelProfile {
  id: string;
  showId: string | null;
  role: ModelRole;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  fallbacks: string[];
  budgetUsd: number | null;
  promptTemplateKey: string | null;
  version: string;
}

export function hasModelProfileStore(store: object): store is ModelProfileStore {
  return (
    'listModelProfiles' in store
    && typeof store.listModelProfiles === 'function'
    && 'getModelProfile' in store
    && typeof store.getModelProfile === 'function'
    && 'createModelProfile' in store
    && typeof store.createModelProfile === 'function'
    && 'updateModelProfile' in store
    && typeof store.updateModelProfile === 'function'
  );
}

export async function resolveModelProfile(
  store: Pick<ModelProfileStore, 'listModelProfiles'>,
  context: ModelResolutionContext,
): Promise<ResolvedModelProfile | undefined> {
  const profiles = await store.listModelProfiles({
    showId: context.showId,
    showSlug: context.showSlug,
    role: context.role,
    includeGlobal: true,
  });
  const showProfile = profiles.find((profile) => profile.showId !== null);
  const globalProfile = profiles.find((profile) => profile.showId === null);
  const profile = showProfile ?? globalProfile;

  return profile ? toResolvedModelProfile(profile) : undefined;
}

export function toResolvedModelProfile(profile: ModelProfileRecord): ResolvedModelProfile {
  const configParams = profile.config.params;
  const params = configParams && typeof configParams === 'object' && !Array.isArray(configParams)
    ? { ...configParams as Record<string, unknown> }
    : {};

  if (profile.temperature !== null) {
    params.temperature = profile.temperature;
  }

  if (profile.maxTokens !== null) {
    params.maxTokens = profile.maxTokens;
  }

  return {
    id: profile.id,
    showId: profile.showId,
    role: profile.role,
    provider: profile.provider,
    model: profile.model,
    params,
    fallbacks: [...profile.fallbacks],
    budgetUsd: profile.budgetUsd,
    promptTemplateKey: profile.promptTemplateKey,
    version: profile.updatedAt.toISOString(),
  };
}

export function modelProfileMap(profiles: Array<ResolvedModelProfile | undefined>): Record<string, ResolvedModelProfile> {
  return Object.fromEntries(
    profiles
      .filter((profile): profile is ResolvedModelProfile => Boolean(profile))
      .map((profile) => [profile.role, profile]),
  );
}
