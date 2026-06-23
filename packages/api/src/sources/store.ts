export type SourceType = 'brave' | 'zai-web' | 'openrouter-perplexity' | 'rss' | 'manual' | 'local-json';
export type ShowSetupStatus = 'draft' | 'active';

export interface ShowCastMember {
  name: string;
  role?: string;
  voice: string;
  persona?: string;
}

export interface ShowRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  setupStatus: ShowSetupStatus;
  format: string | null;
  defaultRuntimeMinutes: number | null;
  cast: ShowCastMember[];
  defaultModelProfile: Record<string, string>;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceProfileRecord {
  id: string;
  showId: string;
  slug: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  weight: number;
  freshness: string | null;
  includeDomains: string[];
  excludeDomains: string[];
  rateLimit: Record<string, unknown>;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceQueryRecord {
  id: string;
  sourceProfileId: string;
  query: string;
  enabled: boolean;
  weight: number;
  region: string | null;
  language: string | null;
  freshness: string | null;
  includeDomains: string[];
  excludeDomains: string[];
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSourceProfileInput {
  showId: string;
  slug: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  weight: number;
  freshness: string | null;
  includeDomains: string[];
  excludeDomains: string[];
  rateLimit: Record<string, unknown>;
  config: Record<string, unknown>;
}

export type UpdateSourceProfileInput = Partial<Omit<CreateSourceProfileInput, 'showId'>>;

export interface CreateSourceQueryInput {
  query: string;
  enabled: boolean;
  weight: number;
  region: string | null;
  language: string | null;
  freshness: string | null;
  includeDomains: string[];
  excludeDomains: string[];
  config: Record<string, unknown>;
}

export type UpdateSourceQueryInput = Partial<CreateSourceQueryInput>;

export interface CreateShowInput {
  slug: string;
  title: string;
  description: string | null;
  setupStatus: ShowSetupStatus;
  format: string | null;
  defaultRuntimeMinutes: number | null;
  cast: ShowCastMember[];
  defaultModelProfile: Record<string, string>;
  settings: Record<string, unknown>;
}

export type UpdateShowInput = Partial<CreateShowInput>;

export interface SourceStore {
  listShows(): Promise<ShowRecord[]>;
  createShow?(input: CreateShowInput): Promise<ShowRecord>;
  updateShow?(id: string, input: UpdateShowInput): Promise<ShowRecord | undefined>;
  listSourceProfiles(filter?: { showSlug?: string; showId?: string }): Promise<SourceProfileRecord[]>;
  getSourceProfile(id: string): Promise<SourceProfileRecord | undefined>;
  createSourceProfile(input: CreateSourceProfileInput): Promise<SourceProfileRecord>;
  updateSourceProfile(id: string, input: UpdateSourceProfileInput): Promise<SourceProfileRecord | undefined>;
  listSourceQueries(profileId: string, options?: { enabledOnly?: boolean }): Promise<SourceQueryRecord[]>;
  getSourceQuery(id: string): Promise<SourceQueryRecord | undefined>;
  createSourceQuery(profileId: string, input: CreateSourceQueryInput): Promise<SourceQueryRecord | undefined>;
  updateSourceQuery(id: string, input: UpdateSourceQueryInput): Promise<SourceQueryRecord | undefined>;
  deleteSourceQuery(id: string): Promise<boolean>;
  close?(): Promise<void>;
}
