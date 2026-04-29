export interface PodcastForgeConfig {
  show: ShowConfig;
  sources: SourceConfig[];
  models: Record<string, ModelConfig>;
  production: ProductionConfig;
}

export interface ShowConfig {
  slug: string;
  title: string;
  description?: string;
  format?: string;
  defaultRuntimeMinutes?: number;
  cast?: CastMemberConfig[];
}

export interface CastMemberConfig {
  name: string;
  role?: string;
  voice: string;
}

export interface SourceConfig {
  id: string;
  type: 'brave' | 'zai-web' | 'openrouter-perplexity' | 'rss' | 'manual' | 'local-json';
  enabled: boolean;
  weight?: number;
  freshness?: string;
  queries?: string[];
  feeds?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  params?: Record<string, unknown>;
  fallbacks?: string[];
  promptTemplate?: string;
  budgetUsd?: number;
}

export interface ProductionConfig {
  ttsProvider?: string;
  artProvider?: string;
  storage?: 'local' | 's3' | 'r2';
  rssFeedPath?: string;
  publicBaseUrl?: string;
  op3Wrap?: boolean;
}

export interface ConfigValidationError {
  path: string;
  message: string;
  keyword: string;
}

export type ConfigValidationResult =
  | { ok: true; config: PodcastForgeConfig }
  | { ok: false; errors: ConfigValidationError[] };
