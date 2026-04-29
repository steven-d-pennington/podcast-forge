import { PROMPT_OUTPUT_SCHEMAS, type CandidateScoreResult } from '../prompts/schemas.js';
import { renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry } from '../prompts/types.js';
import type { LlmInvocationMetadata, LlmRuntime } from '../llm/types.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import type { ShowRecord, SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import type { SearchJobStore, StoryCandidateRecord } from './store.js';

export type CandidateScoringStatus = 'scored' | 'fallback' | 'failed' | 'skipped';

export interface CandidateScoringWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CandidateComponentScores {
  significance: number;
  showFit: number;
  novelty: number;
  sourceQuality: number;
  urgency: number;
}

export interface CandidateScoringInput {
  candidate: Record<string, unknown>;
  show: Record<string, unknown>;
  sourceProfile: Record<string, unknown> | null;
  sourceQuery: Record<string, unknown> | null;
}

export interface CandidateScoringRequest {
  input: CandidateScoringInput;
  candidate: StoryCandidateRecord;
  show: ShowRecord;
  sourceProfile: SourceProfileRecord | null;
  sourceQuery: SourceQueryRecord | null;
  modelProfile?: ResolvedModelProfile;
}

export interface CandidateScoringResult {
  overallScore: number;
  componentScores: CandidateComponentScores;
  rationale: string;
  warnings: CandidateScoringWarning[];
  flags: string[];
  angle?: string;
  verdict?: CandidateScoreResult['verdict'];
  scoringStatus: CandidateScoringStatus;
  scorer: Record<string, unknown>;
}

export interface CandidateScorer {
  score(request: CandidateScoringRequest): Promise<CandidateScoringResult>;
}

export interface CandidateScoringBatchResult {
  candidates: StoryCandidateRecord[];
  scored: number;
  fallback: number;
  failed: number;
  skipped: number;
  events: Array<Record<string, unknown>>;
}

interface LlmCandidateScorerOptions {
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
}

interface ScoreCandidateBatchOptions {
  candidates: StoryCandidateRecord[];
  show: ShowRecord;
  sourceProfile: SourceProfileRecord | null;
  queries: SourceQueryRecord[];
  store: Pick<SearchJobStore, 'updateStoryCandidateScoring'>;
  scorer?: CandidateScorer;
  modelProfile?: ResolvedModelProfile;
  limit?: number;
  now?: () => Date;
}

const secretKeyPattern = /(api[_-]?key|authorization|cookie|credential|password|secret|token)/i;
const localDataKeyPattern = /(^|_)(local|absolute)?(file|dir|directory|path)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[max-depth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value instanceof Date ? value.toISOString() : value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeyPattern.test(key) && !localDataKeyPattern.test(key))
      .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
  );
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function domainFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sourceQueryForCandidate(candidate: StoryCandidateRecord, queries: SourceQueryRecord[]) {
  return queries.find((query) => query.id === candidate.sourceQueryId) ?? null;
}

export function buildCandidateScoringInput(options: {
  candidate: StoryCandidateRecord;
  show: ShowRecord;
  sourceProfile: SourceProfileRecord | null;
  sourceQuery: SourceQueryRecord | null;
}): CandidateScoringInput {
  const { candidate, show, sourceProfile, sourceQuery } = options;
  const candidateDomain = domainFromUrl(candidate.canonicalUrl ?? candidate.url);

  return sanitizeValue({
    candidate: {
      id: candidate.id,
      title: candidate.title,
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      domain: candidateDomain,
      sourceName: candidate.sourceName,
      author: candidate.author,
      summary: candidate.summary,
      status: candidate.status,
      publishedAt: isoDate(candidate.publishedAt),
      discoveredAt: isoDate(candidate.discoveredAt),
      existingScore: candidate.score,
      existingScoreBreakdown: candidate.scoreBreakdown,
      metadata: candidate.metadata,
      rawPayload: candidate.rawPayload,
    },
    show: {
      id: show.id,
      slug: show.slug,
      title: show.title,
      description: show.description,
      format: show.format,
      defaultRuntimeMinutes: show.defaultRuntimeMinutes,
      cast: show.cast.map((member) => ({ name: member.name, role: member.role })),
      settings: show.settings,
    },
    sourceProfile: sourceProfile ? {
      id: sourceProfile.id,
      slug: sourceProfile.slug,
      name: sourceProfile.name,
      type: sourceProfile.type,
      weight: sourceProfile.weight,
      freshness: sourceProfile.freshness,
      includeDomains: sourceProfile.includeDomains,
      excludeDomains: sourceProfile.excludeDomains,
      config: sourceProfile.config,
    } : null,
    sourceQuery: sourceQuery ? {
      id: sourceQuery.id,
      query: sourceQuery.query,
      weight: sourceQuery.weight,
      region: sourceQuery.region,
      language: sourceQuery.language,
      freshness: sourceQuery.freshness,
      includeDomains: sourceQuery.includeDomains,
      excludeDomains: sourceQuery.excludeDomains,
      config: sourceQuery.config,
    } : null,
  }) as CandidateScoringInput;
}

function freshnessScore(candidate: StoryCandidateRecord, now: Date) {
  if (!candidate.publishedAt) {
    return 45;
  }

  const ageHours = Math.max(0, (now.getTime() - candidate.publishedAt.getTime()) / 3_600_000);

  if (ageHours <= 12) return 90;
  if (ageHours <= 24) return 82;
  if (ageHours <= 72) return 68;
  if (ageHours <= 168) return 52;
  return 35;
}

function sourceQualityScore(candidate: StoryCandidateRecord, sourceProfile: SourceProfileRecord | null, sourceQuery: SourceQueryRecord | null) {
  const domain = domainFromUrl(candidate.canonicalUrl ?? candidate.url);
  const domainBoost = domain ? 8 : 0;
  const sourceBoost = candidate.sourceName ? 7 : 0;
  const profileWeight = Math.max(0, Math.min(2, sourceProfile?.weight ?? 1));
  const queryWeight = Math.max(0, Math.min(2, sourceQuery?.weight ?? 1));

  return clampScore(50 + domainBoost + sourceBoost + (profileWeight - 1) * 8 + (queryWeight - 1) * 5);
}

function textSignalScore(candidate: StoryCandidateRecord) {
  const text = `${candidate.title} ${candidate.summary ?? ''}`;
  const hasSpecifics = /\b\d{4}\b|\b\d+(?:\.\d+)?%?\b|\b(launch|release|lawsuit|filing|report|study|research|funding|acquisition|security|regulation|policy)\b/i.test(text);
  const hasSummary = Boolean(candidate.summary && candidate.summary.length >= 80);

  return clampScore(52 + (hasSpecifics ? 14 : 0) + (hasSummary ? 10 : 0));
}

export function baselineCandidateScore(
  request: CandidateScoringRequest,
  options: { status: CandidateScoringStatus; reason: string; now?: Date },
): CandidateScoringResult {
  const now = options.now ?? new Date();
  const novelty = freshnessScore(request.candidate, now);
  const sourceQuality = sourceQualityScore(request.candidate, request.sourceProfile, request.sourceQuery);
  const significance = textSignalScore(request.candidate);
  const showFit = clampScore(58 + Math.min(20, ((request.sourceProfile?.weight ?? 1) - 1) * 10 + ((request.sourceQuery?.weight ?? 1) - 1) * 6));
  const urgency = clampScore((novelty * 0.8) + (significance * 0.2));
  const overallScore = clampScore(
    significance * 0.28
    + showFit * 0.22
    + novelty * 0.2
    + sourceQuality * 0.18
    + urgency * 0.12,
  );

  return {
    overallScore,
    componentScores: {
      significance,
      showFit,
      novelty,
      sourceQuality,
      urgency,
    },
    rationale: options.status === 'failed'
      ? 'Baseline deterministic score used because AI scoring could not return a valid structured score.'
      : `Baseline deterministic score used because ${options.reason}.`,
    warnings: [{
      code: 'BASELINE_SCORING_USED',
      severity: options.status === 'failed' ? 'warning' : 'info',
      message: options.status === 'failed'
        ? 'Candidate was scored with the deterministic fallback because AI scoring failed. Check job logs for technical details.'
        : `Candidate was scored with the deterministic fallback: ${options.reason}.`,
    }],
    flags: ['fallback'],
    scoringStatus: options.status,
    scorer: {
      type: 'deterministic-baseline',
      fallback: true,
      fallbackReason: options.reason,
      scoredAt: now.toISOString(),
    },
  };
}

function normalizeWarnings(warnings: CandidateScoreResult['warnings']): CandidateScoringWarning[] {
  return warnings.map((warning) => ({
    code: warning.code,
    severity: warning.severity,
    message: warning.message,
    metadata: warning.metadata,
  }));
}

function resultFromLlmOutput(options: {
  output: CandidateScoreResult;
  metadata: LlmInvocationMetadata;
  promptTemplate: { key: string; version: number };
}): CandidateScoringResult {
  const warnings = normalizeWarnings(options.output.warnings);
  const flags = warnings.map((warning) => warning.code);

  if (options.output.verdict === 'ignore') {
    flags.push('verdict_ignore');
  }

  return {
    overallScore: clampScore(options.output.score),
    componentScores: {
      significance: clampScore(options.output.dimensions.significance),
      showFit: clampScore(options.output.dimensions.showFit),
      novelty: clampScore(options.output.dimensions.novelty),
      sourceQuality: clampScore(options.output.dimensions.sourceQuality),
      urgency: clampScore(options.output.dimensions.urgency),
    },
    rationale: options.output.rationale,
    warnings,
    flags,
    verdict: options.output.verdict,
    scoringStatus: 'scored',
    scorer: {
      type: 'llm',
      fallback: false,
      promptTemplateKey: options.promptTemplate.key,
      promptTemplateVersion: options.promptTemplate.version,
      modelProfile: options.metadata.profile,
      selected: options.metadata.selected,
      runtime: options.metadata,
    },
  };
}

export function createLlmCandidateScorer(options: LlmCandidateScorerOptions): CandidateScorer {
  return {
    async score(request) {
      if (!request.modelProfile) {
        throw new Error('No candidate_scorer model profile is configured for this show.');
      }

      const rendered = await renderPromptTemplate(options.promptRegistry, {
        key: request.modelProfile.promptTemplateKey ?? undefined,
        role: request.modelProfile.promptTemplateKey ? undefined : 'candidate_scorer',
        showId: request.show.id,
        variables: {
          show_context: request.input.show,
          source_profile: {
            profile: request.input.sourceProfile,
            query: request.input.sourceQuery,
          },
          candidate_json: request.input.candidate,
        },
      });
      const schema = PROMPT_OUTPUT_SCHEMAS.candidate_score_result;
      const result = await options.runtime.generateJson<CandidateScoreResult>({
        profile: request.modelProfile,
        messages: rendered.messages,
        schemaName: rendered.responseFormat.schemaName ?? schema.name,
        schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
        validate: (value) => schema.validate(value) as CandidateScoreResult,
        requestMetadata: {
          purpose: 'candidate_scoring',
          candidateId: request.candidate.id,
          sourceProfileId: request.sourceProfile?.id,
          sourceQueryId: request.sourceQuery?.id,
          promptTemplateKey: rendered.template.key,
          promptTemplateVersion: rendered.template.version,
        },
      });

      return resultFromLlmOutput({
        output: result.value,
        metadata: result.metadata,
        promptTemplate: {
          key: rendered.template.key,
          version: rendered.template.version,
        },
      });
    },
  };
}

export function scoringLimitFromProfile(profile: SourceProfileRecord | null): number {
  const config = profile?.config ?? {};
  const scoringConfig = isRecord(config.scoring) ? config.scoring : {};
  const raw = config.candidateScoringLimit ?? config.scoringLimit ?? scoringConfig.limit;
  let parsed: number | undefined;

  if (typeof raw === 'number') {
    parsed = raw;
  } else if (typeof raw === 'string') {
    parsed = Number(raw);
  }

  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    return 10;
  }

  return parsed;
}

function scoringBreakdown(result: CandidateScoringResult): Record<string, unknown> {
  return {
    overall: result.overallScore,
    significance: result.componentScores.significance,
    showFit: result.componentScores.showFit,
    novelty: result.componentScores.novelty,
    sourceQuality: result.componentScores.sourceQuality,
    urgency: result.componentScores.urgency,
    components: result.componentScores,
    rationale: result.rationale,
    warnings: result.warnings,
    flags: result.flags,
    angle: result.angle,
    verdict: result.verdict,
    scoringStatus: result.scoringStatus,
    scorer: result.scorer,
  };
}

function scoringMetadata(candidate: StoryCandidateRecord, result: CandidateScoringResult): Record<string, unknown> {
  return {
    ...candidate.metadata,
    scoringStatus: result.scoringStatus,
    scoring: {
      status: result.scoringStatus,
      overallScore: result.overallScore,
      rationale: result.rationale,
      warnings: result.warnings,
      flags: result.flags,
      angle: result.angle,
      verdict: result.verdict,
      scorer: result.scorer,
    },
  };
}

function skippedMetadata(candidate: StoryCandidateRecord, reason: string, now: Date): Record<string, unknown> {
  return {
    ...candidate.metadata,
    scoringStatus: 'skipped',
    scoring: {
      status: 'skipped',
      reason,
      scoredAt: now.toISOString(),
    },
  };
}

export async function scoreCandidateBatch(options: ScoreCandidateBatchOptions): Promise<CandidateScoringBatchResult> {
  const limit = options.limit ?? scoringLimitFromProfile(options.sourceProfile);
  const now = options.now?.() ?? new Date();
  const events: Array<Record<string, unknown>> = [];
  const candidates: StoryCandidateRecord[] = [];
  let scored = 0;
  let fallback = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, candidate] of options.candidates.entries()) {
    if (index >= limit) {
      const reason = `Scoring limit reached (${limit}).`;
      const updated = await options.store.updateStoryCandidateScoring(candidate.id, {
        score: null,
        scoreBreakdown: {
          scoringStatus: 'skipped',
          reason,
        },
        metadata: skippedMetadata(candidate, reason, now),
      });
      skipped += 1;
      candidates.push(updated ?? candidate);
      events.push({
        level: 'info',
        message: 'Skipped candidate scoring due to configured cap.',
        candidateId: candidate.id,
        reason,
      });
      continue;
    }

    const sourceQuery = sourceQueryForCandidate(candidate, options.queries);
    const input = buildCandidateScoringInput({
      candidate,
      show: options.show,
      sourceProfile: options.sourceProfile,
      sourceQuery,
    });
    const request: CandidateScoringRequest = {
      input,
      candidate,
      show: options.show,
      sourceProfile: options.sourceProfile,
      sourceQuery,
      modelProfile: options.modelProfile,
    };

    let result: CandidateScoringResult;

    if (!options.scorer) {
      result = baselineCandidateScore(request, {
        status: 'fallback',
        reason: options.modelProfile ? 'candidate scorer runtime is unavailable' : 'no candidate_scorer model profile is configured',
        now,
      });
      fallback += 1;
      events.push({
        level: 'warn',
        message: 'Used deterministic fallback candidate score.',
        candidateId: candidate.id,
        reason: result.scorer.fallbackReason,
      });
    } else {
      try {
        result = await options.scorer.score(request);
        scored += result.scoringStatus === 'scored' ? 1 : 0;
        fallback += result.scoringStatus === 'fallback' ? 1 : 0;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Candidate scorer failed.';
        result = baselineCandidateScore(request, {
          status: 'failed',
          reason,
          now,
        });
        failed += 1;
        fallback += 1;
        events.push({
          level: 'error',
          message: 'Candidate scoring failed; used deterministic fallback.',
          candidateId: candidate.id,
          reason,
        });
      }
    }

    const updated = await options.store.updateStoryCandidateScoring(candidate.id, {
      score: result.overallScore,
      scoreBreakdown: scoringBreakdown(result),
      metadata: scoringMetadata(candidate, result),
    });
    candidates.push(updated ?? {
      ...candidate,
      score: result.overallScore,
      scoreBreakdown: scoringBreakdown(result),
      metadata: scoringMetadata(candidate, result),
    });
  }

  return {
    candidates,
    scored,
    fallback,
    failed,
    skipped,
    events,
  };
}
