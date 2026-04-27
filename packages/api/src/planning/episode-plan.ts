import { LlmJsonOutputError, LlmRuntimeError, type LlmInvocationMetadata, type LlmJsonResult, type LlmRuntime } from '../llm/types.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import { PROMPT_OUTPUT_SCHEMAS, type EpisodePlanResult } from '../prompts/schemas.js';
import { PromptRenderError, renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry, RenderedPrompt } from '../prompts/types.js';
import type { StoryCandidateRecord } from '../search/store.js';
import type { ShowRecord, SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';

export class EpisodePlanError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface EpisodePlan {
  id: string;
  showId: string;
  candidateIds: string[];
  duplicateCandidateIds: string[];
  aiGenerated: true;
  advisoryOnly: true;
  evidenceStatus: 'not_verified_evidence';
  gateStatus: 'research_required';
  generatedAt: string;
  proposedAngle: string;
  whyNow: string;
  audienceRelevance: string;
  knownFacts: string[];
  unknownsSourceGaps: string[];
  questionsToAnswer: string[];
  recommendedSources: EpisodePlanResult['recommendedSources'];
  warnings: EpisodePlanResult['warnings'];
  modelProfile: Record<string, unknown>;
  promptTemplate: {
    key: string;
    version: number;
  };
  invocation: LlmInvocationMetadata;
  planningNotes: Record<string, unknown>;
}

export interface BuildEpisodePlanOptions {
  show: ShowRecord;
  candidates: StoryCandidateRecord[];
  duplicateCandidateIds?: string[];
  sourceProfiles?: Map<string, SourceProfileRecord>;
  sourceQueries?: Map<string, SourceQueryRecord>;
  modelProfile: ResolvedModelProfile;
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
  notes?: string | null;
  targetFormat?: string | null;
  targetRuntime?: string | null;
  now?: () => Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const secretKeyPattern = /(api[_-]?key|authorization|cookie|credential|password|secret|token)/i;
const localPathPattern = /(^|_)(local|absolute)?(file|dir|directory|path)$/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[max-depth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value instanceof Date ? value.toISOString() : value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !secretKeyPattern.test(key) && !localPathPattern.test(key))
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
  );
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function hostnameFor(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function showContext(show: ShowRecord): Record<string, unknown> {
  return sanitizeValue({
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description,
    format: show.format,
    defaultRuntimeMinutes: show.defaultRuntimeMinutes,
    cast: show.cast.map((member) => ({ name: member.name, role: member.role })),
    settings: show.settings,
  }) as Record<string, unknown>;
}

function candidateContext(
  candidate: StoryCandidateRecord,
  sourceProfiles: Map<string, SourceProfileRecord>,
  sourceQueries: Map<string, SourceQueryRecord>,
): Record<string, unknown> {
  const sourceProfile = candidate.sourceProfileId ? sourceProfiles.get(candidate.sourceProfileId) : undefined;
  const sourceQuery = candidate.sourceQueryId ? sourceQueries.get(candidate.sourceQueryId) : undefined;
  const url = candidate.canonicalUrl ?? candidate.url;

  return sanitizeValue({
    id: candidate.id,
    title: candidate.title,
    url,
    canonicalUrl: candidate.canonicalUrl,
    domain: hostnameFor(url),
    sourceName: candidate.sourceName,
    author: candidate.author,
    summary: candidate.summary,
    status: candidate.status,
    publishedAt: isoDate(candidate.publishedAt),
    discoveredAt: candidate.discoveredAt.toISOString(),
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown,
    metadata: candidate.metadata,
    sourceProfile: sourceProfile ? {
      id: sourceProfile.id,
      slug: sourceProfile.slug,
      name: sourceProfile.name,
      type: sourceProfile.type,
      freshness: sourceProfile.freshness,
      includeDomains: sourceProfile.includeDomains,
      excludeDomains: sourceProfile.excludeDomains,
    } : null,
    sourceQuery: sourceQuery ? {
      id: sourceQuery.id,
      query: sourceQuery.query,
      freshness: sourceQuery.freshness,
      includeDomains: sourceQuery.includeDomains,
      excludeDomains: sourceQuery.excludeDomains,
    } : null,
  }) as Record<string, unknown>;
}

function promptErrorMessage(error: unknown) {
  if (error instanceof PromptRenderError) {
    return error.message;
  }

  if (error instanceof LlmJsonOutputError) {
    return 'Episode planner returned malformed JSON or did not match the required output schema.';
  }

  if (error instanceof LlmRuntimeError) {
    return error.message;
  }

  return error instanceof Error ? error.message : 'Episode planning failed.';
}

function planningErrorFor(error: unknown): EpisodePlanError {
  if (error instanceof EpisodePlanError) {
    return error;
  }

  if (error instanceof PromptRenderError) {
    return new EpisodePlanError(409, error.code, error.message, error.details);
  }

  if (error instanceof LlmJsonOutputError) {
    return new EpisodePlanError(502, 'EPISODE_PLAN_MODEL_OUTPUT_INVALID', promptErrorMessage(error), error.details);
  }

  if (error instanceof LlmRuntimeError) {
    return new EpisodePlanError(502, 'EPISODE_PLAN_MODEL_FAILED', error.message);
  }

  return new EpisodePlanError(500, 'EPISODE_PLAN_FAILED', promptErrorMessage(error));
}

export async function buildEpisodePlan(options: BuildEpisodePlanOptions): Promise<EpisodePlan> {
  const sourceProfiles = options.sourceProfiles ?? new Map();
  const sourceQueries = options.sourceQueries ?? new Map();
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const schema = PROMPT_OUTPUT_SCHEMAS.episode_plan_result;
  let result: LlmJsonResult<EpisodePlanResult>;
  let rendered: RenderedPrompt;

  try {
    rendered = await renderPromptTemplate(options.promptRegistry, {
      key: options.modelProfile.promptTemplateKey ?? undefined,
      role: options.modelProfile.promptTemplateKey ? undefined : 'episode_planner',
      showId: options.show.id,
      variables: {
        show_context: showContext(options.show),
        candidate_selection: {
          advisoryOnly: true,
          evidenceStatus: 'not_verified_evidence',
          gateStatus: 'research_required',
          planningNotes: {
            notes: options.notes ?? null,
            targetFormat: options.targetFormat ?? null,
            targetRuntime: options.targetRuntime ?? null,
          },
          candidates: options.candidates.map((candidate) => candidateContext(candidate, sourceProfiles, sourceQueries)),
        },
      },
    });
    result = await options.runtime.generateJson<EpisodePlanResult>({
      profile: options.modelProfile,
      messages: rendered.messages,
      schemaName: rendered.responseFormat.schemaName ?? schema.name,
      schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
      validate: (value) => schema.validate(value) as EpisodePlanResult,
      requestMetadata: {
        purpose: 'episode_planning',
        candidateIds: options.candidates.map((candidate) => candidate.id),
        promptTemplateKey: rendered.template.key,
        promptTemplateVersion: rendered.template.version,
        advisoryOnly: true,
      },
    });
  } catch (error) {
    throw planningErrorFor(error);
  }

  return {
    id: `episode-plan:${result.metadata.startedAt}:${options.candidates.map((candidate) => candidate.id).join(',')}`,
    showId: options.show.id,
    candidateIds: options.candidates.map((candidate) => candidate.id),
    duplicateCandidateIds: options.duplicateCandidateIds ?? [],
    aiGenerated: true,
    advisoryOnly: true,
    evidenceStatus: 'not_verified_evidence',
    gateStatus: 'research_required',
    generatedAt,
    proposedAngle: result.value.proposedAngle,
    whyNow: result.value.whyNow,
    audienceRelevance: result.value.audienceRelevance,
    knownFacts: [...result.value.knownFacts],
    unknownsSourceGaps: [...result.value.unknownsSourceGaps],
    questionsToAnswer: [...result.value.questionsToAnswer],
    recommendedSources: result.value.recommendedSources,
    warnings: result.value.warnings,
    modelProfile: sanitizeValue(options.modelProfile) as Record<string, unknown>,
    promptTemplate: {
      key: rendered.template.key,
      version: rendered.template.version,
    },
    invocation: result.metadata,
    planningNotes: asRecord(sanitizeValue({
      notes: options.notes ?? null,
      targetFormat: options.targetFormat ?? null,
      targetRuntime: options.targetRuntime ?? null,
    })),
  };
}
