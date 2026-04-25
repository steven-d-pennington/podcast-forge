import type { ModelRole } from './roles.js';

export interface ModelProfileRecord {
  id: string;
  showId: string | null;
  role: ModelRole;
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  budgetUsd: number | null;
  fallbacks: string[];
  promptTemplateKey: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelProfileListFilter {
  showId?: string;
  showSlug?: string;
  role?: ModelRole;
  includeGlobal?: boolean;
}

export interface CreateModelProfileInput {
  showId: string | null;
  role: ModelRole;
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  budgetUsd: number | null;
  fallbacks: string[];
  promptTemplateKey: string | null;
  config: Record<string, unknown>;
}

export type UpdateModelProfileInput = Partial<Omit<CreateModelProfileInput, 'showId' | 'role'>>;

export interface ModelProfileStore {
  listModelProfiles(filter?: ModelProfileListFilter): Promise<ModelProfileRecord[]>;
  getModelProfile(id: string): Promise<ModelProfileRecord | undefined>;
  createModelProfile(input: CreateModelProfileInput): Promise<ModelProfileRecord>;
  updateModelProfile(id: string, input: UpdateModelProfileInput): Promise<ModelProfileRecord | undefined>;
}
