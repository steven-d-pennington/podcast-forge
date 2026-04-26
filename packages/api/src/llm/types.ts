import type { ModelRole } from '../models/roles.js';
import type { ResolvedModelProfile } from '../models/resolver.js';

export type LlmMessageRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface LlmCost {
  usd: number | null;
  currency: 'USD';
}

export interface LlmResponseFormat {
  type: 'text' | 'json';
  schemaName?: string;
  schemaHint?: Record<string, unknown>;
}

export interface LlmModelAttempt {
  profileId: string;
  role: ModelRole;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  promptTemplateKey: string | null;
  budgetUsd: number | null;
  fallbackOf?: string;
  fallbackIndex?: number;
}

export interface LlmProviderRequest {
  attempt: LlmModelAttempt;
  messages: LlmMessage[];
  responseFormat: LlmResponseFormat;
  requestMetadata: Record<string, unknown>;
}

export interface LlmProviderResult {
  text: string;
  usage?: Partial<LlmUsage>;
  cost?: Partial<LlmCost>;
  rawOutput?: unknown;
  metadata?: Record<string, unknown>;
  warnings?: LlmWarning[];
}

export interface LlmProviderAdapter {
  readonly provider: string;
  generateText(request: LlmProviderRequest): Promise<LlmProviderResult>;
}

export interface LlmWarning {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LlmAttemptMetadata {
  profileId: string;
  role: ModelRole;
  provider: string;
  model: string;
  status: 'succeeded' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  fallbackOf?: string;
  fallbackIndex?: number;
  usage: LlmUsage;
  cost: LlmCost;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  warnings: LlmWarning[];
  rawOutputPreview?: string;
  providerMetadata: Record<string, unknown>;
}

export interface LlmInvocationMetadata {
  profile: {
    id: string;
    role: ModelRole;
    provider: string;
    model: string;
    version: string;
    promptTemplateKey: string | null;
    budgetUsd: number | null;
    fallbackCount: number;
  };
  selected: {
    provider: string;
    model: string;
    fallbackIndex: number | null;
  } | null;
  responseFormat: LlmResponseFormat;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  attempts: LlmAttemptMetadata[];
  warnings: LlmWarning[];
  usage: LlmUsage;
  cost: LlmCost;
  requestMetadata: Record<string, unknown>;
  rawOutputPreview?: string;
  validatedOutputPreview?: string;
}

export interface LlmTextRequest {
  profile: ResolvedModelProfile;
  messages: LlmMessage[];
  responseFormat?: LlmResponseFormat;
  requestMetadata?: Record<string, unknown>;
}

export interface LlmTextResult {
  text: string;
  metadata: LlmInvocationMetadata;
}

export type LlmJsonValidator<T> = (value: unknown) => T;

export interface LlmJsonRequest<T> extends Omit<LlmTextRequest, 'responseFormat'> {
  schemaName?: string;
  schemaHint?: Record<string, unknown>;
  validate?: LlmJsonValidator<T>;
}

export interface LlmJsonResult<T> extends LlmTextResult {
  value: T;
}

export interface LlmRuntime {
  generateText(request: LlmTextRequest): Promise<LlmTextResult>;
  generateJson<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
}

export class LlmProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = true,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export class LlmRuntimeError extends Error {
  constructor(
    message: string,
    public readonly metadata: LlmInvocationMetadata,
  ) {
    super(message);
    this.name = 'LlmRuntimeError';
  }
}

export class LlmJsonOutputError extends Error {
  constructor(
    public readonly code: 'malformed_json' | 'validation_failed',
    message: string,
    public readonly metadata: LlmInvocationMetadata,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'LlmJsonOutputError';
  }
}
