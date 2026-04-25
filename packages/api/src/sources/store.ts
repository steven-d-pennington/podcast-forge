export type SourceType = 'brave' | 'rss' | 'manual' | 'local-json';

export interface ShowRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
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

export interface SourceStore {
  listShows(): Promise<ShowRecord[]>;
  listSourceProfiles(filter?: { showSlug?: string; showId?: string }): Promise<SourceProfileRecord[]>;
  getSourceProfile(id: string): Promise<SourceProfileRecord | undefined>;
  createSourceProfile(input: CreateSourceProfileInput): Promise<SourceProfileRecord>;
  updateSourceProfile(id: string, input: UpdateSourceProfileInput): Promise<SourceProfileRecord | undefined>;
  listSourceQueries(profileId: string, options?: { enabledOnly?: boolean }): Promise<SourceQueryRecord[]>;
  createSourceQuery(profileId: string, input: CreateSourceQueryInput): Promise<SourceQueryRecord | undefined>;
  updateSourceQuery(id: string, input: UpdateSourceQueryInput): Promise<SourceQueryRecord | undefined>;
  deleteSourceQuery(id: string): Promise<boolean>;
  close?(): Promise<void>;
}
