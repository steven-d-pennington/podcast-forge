import type { LlmInvocationMetadata, LlmRuntime } from '../llm/types.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import { PROMPT_OUTPUT_SCHEMAS, type IntegrityReviewResult } from '../prompts/schemas.js';
import { renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry } from '../prompts/types.js';
import type { ResearchPacketRecord } from '../research/store.js';
import type { ShowRecord } from '../sources/store.js';
import type { ScriptRecord, ScriptRevisionRecord } from './store.js';

export type IntegrityReviewVerdict = 'PASS' | 'PASS_WITH_NOTES' | 'FAIL';
export type IntegrityGateStatus = 'pass' | 'pass_with_notes' | 'fail' | 'missing' | 'overridden';

const NON_OVERRIDE_INTEGRITY_STATUSES = new Set<IntegrityGateStatus>(['pass', 'pass_with_notes', 'fail', 'missing']);

function validNonOverrideIntegrityStatus(value: unknown): IntegrityGateStatus {
  if (typeof value === 'string' && NON_OVERRIDE_INTEGRITY_STATUSES.has(value as IntegrityGateStatus)) {
    return value as IntegrityGateStatus;
  }

  return 'missing';
}

export interface IntegrityReviewSummary {
  verdict: IntegrityReviewVerdict;
  status: IntegrityGateStatus;
  blocking: boolean;
  reviewedAt: string;
  actor: string;
  modelProfile: Record<string, unknown>;
  template: {
    key: string;
    version: number;
  };
  invocation: LlmInvocationMetadata;
  result: IntegrityReviewResult;
  issueCounts: {
    claimIssues: number;
    missingCitations: number;
    unsupportedCertainty: number;
    attributionWarnings: number;
    balanceWarnings: number;
    biasSensationalismWarnings: number;
    suggestedFixes: number;
    total: number;
    critical: number;
  };
  scriptId: string;
  revisionId: string;
  researchPacketId: string;
}

export interface IntegrityReviewRuntimeOptions {
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
  now?: () => Date;
}

function showContext(show: ShowRecord) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description,
    format: show.format,
    defaultRuntimeMinutes: show.defaultRuntimeMinutes,
    cast: show.cast.map((member) => ({
      name: member.name,
      role: member.role,
      ...(member.voice ? { voice: member.voice } : {}),
      ...(member.persona ? { persona: member.persona } : {}),
    })),
    settings: show.settings,
  };
}

function packetContext(packet: ResearchPacketRecord) {
  return {
    id: packet.id,
    title: packet.title,
    status: packet.status,
    sourceDocumentIds: packet.sourceDocumentIds,
    claims: packet.claims,
    citations: packet.citations,
    warnings: packet.warnings,
    content: packet.content,
    approvedAt: packet.approvedAt?.toISOString() ?? null,
  };
}

function scriptContext(script: ScriptRecord, revision: ScriptRevisionRecord) {
  return {
    scriptId: script.id,
    revisionId: revision.id,
    version: revision.version,
    title: revision.title,
    format: revision.format,
    speakers: revision.speakers,
    body: revision.body,
    citationMap: revision.metadata.citationMap ?? [],
    provenance: revision.metadata.provenance ?? null,
    validation: revision.metadata.validation ?? null,
    warnings: revision.metadata.warnings ?? [],
  };
}

function severity(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) && 'severity' in value
    ? (value as { severity?: unknown }).severity
    : undefined;
}

function countCritical(values: unknown[]) {
  return values.filter((value) => severity(value) === 'critical').length;
}

function issueCounts(result: IntegrityReviewResult): IntegrityReviewSummary['issueCounts'] {
  const issueArrays = [
    result.claimIssues,
    result.missingCitations,
    result.unsupportedCertainty,
    result.attributionWarnings,
    result.balanceWarnings,
    result.biasSensationalismWarnings,
  ];
  const total = issueArrays.reduce((count, values) => count + values.length, 0);
  const critical = issueArrays.reduce((count, values) => count + countCritical(values), 0);

  return {
    claimIssues: result.claimIssues.length,
    missingCitations: result.missingCitations.length,
    unsupportedCertainty: result.unsupportedCertainty.length,
    attributionWarnings: result.attributionWarnings.length,
    balanceWarnings: result.balanceWarnings.length,
    biasSensationalismWarnings: result.biasSensationalismWarnings.length,
    suggestedFixes: result.suggestedFixes.length,
    total,
    critical,
  };
}

function reviewStatus(result: IntegrityReviewResult, counts: IntegrityReviewSummary['issueCounts']): IntegrityGateStatus {
  if (result.verdict === 'FAIL' || counts.critical > 0) {
    return 'fail';
  }

  if (result.verdict === 'PASS_WITH_NOTES' || counts.total > 0 || counts.suggestedFixes > 0) {
    return 'pass_with_notes';
  }

  return 'pass';
}

export function integrityGateState(revision: ScriptRevisionRecord): {
  status: IntegrityGateStatus;
  blocking: boolean;
  review: Record<string, unknown> | null;
  override: Record<string, unknown> | null;
} {
  const review = revision.metadata.integrityReview;
  const reviewObject = review && typeof review === 'object' && !Array.isArray(review)
    ? review as Record<string, unknown>
    : null;
  const override = reviewObject?.override;
  const overrideObject = override && typeof override === 'object' && !Array.isArray(override)
    ? override as Record<string, unknown>
    : null;

  if (overrideObject && typeof overrideObject.reason === 'string' && overrideObject.reason.trim()) {
    return {
      status: 'overridden',
      blocking: false,
      review: reviewObject,
      override: overrideObject,
    };
  }

  if (!reviewObject) {
    return {
      status: 'missing',
      blocking: true,
      review: null,
      override: null,
    };
  }

  const status = validNonOverrideIntegrityStatus(reviewObject.status);
  return {
    status,
    blocking: status === 'fail' || status === 'missing',
    review: reviewObject,
    override: null,
  };
}

export async function buildIntegrityReview(
  show: ShowRecord,
  packet: ResearchPacketRecord,
  script: ScriptRecord,
  revision: ScriptRevisionRecord,
  modelProfile: ResolvedModelProfile,
  actor: string,
  options: IntegrityReviewRuntimeOptions,
): Promise<IntegrityReviewSummary> {
  const rendered = await renderPromptTemplate(options.promptRegistry, {
    key: modelProfile.promptTemplateKey ?? undefined,
    role: modelProfile.promptTemplateKey ? undefined : 'integrity_reviewer',
    showId: show.id,
    variables: {
      show_context: showContext(show),
      research_packet: packetContext(packet),
      script_draft: scriptContext(script, revision),
    },
  });
  const schema = PROMPT_OUTPUT_SCHEMAS.integrity_review_result;
  const result = await options.runtime.generateJson<IntegrityReviewResult>({
    profile: modelProfile,
    messages: rendered.messages,
    schemaName: rendered.responseFormat.schemaName ?? schema.name,
    schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
    validate: (value) => schema.validate(value) as IntegrityReviewResult,
    requestMetadata: {
      purpose: 'integrity_review',
      scriptId: script.id,
      revisionId: revision.id,
      researchPacketId: packet.id,
      promptTemplateKey: rendered.template.key,
      promptTemplateVersion: rendered.template.version,
    },
  });
  const counts = issueCounts(result.value);
  const status = reviewStatus(result.value, counts);

  return {
    verdict: result.value.verdict,
    status,
    blocking: status === 'fail',
    reviewedAt: (options.now?.() ?? new Date()).toISOString(),
    actor,
    modelProfile: { ...modelProfile },
    template: {
      key: rendered.template.key,
      version: rendered.template.version,
    },
    invocation: result.metadata,
    result: result.value,
    issueCounts: counts,
    scriptId: script.id,
    revisionId: revision.id,
    researchPacketId: packet.id,
  };
}
