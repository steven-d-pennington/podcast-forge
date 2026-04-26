import type { LlmInvocationMetadata, LlmRuntime } from '../llm/types.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import { PROMPT_OUTPUT_SCHEMAS, type ExtractedClaimsResult, type ResearchSynthesisResult } from '../prompts/schemas.js';
import { renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry } from '../prompts/types.js';
import type { StoryCandidateRecord } from '../search/store.js';
import type { ResearchClaim, ResearchWarning, SourceDocumentRecord } from './store.js';

export interface ResearchModelServices {
  extractClaims(input: {
    showId: string;
    candidates: StoryCandidateRecord[];
    documents: SourceDocumentRecord[];
    modelProfile?: ResolvedModelProfile;
  }): Promise<ResearchModelClaimResult>;
  synthesize(input: {
    showId: string;
    candidates: StoryCandidateRecord[];
    documents: SourceDocumentRecord[];
    claims: ResearchClaim[];
    warnings: ResearchWarning[];
    angle?: string | null;
    modelProfile?: ResolvedModelProfile;
  }): Promise<ResearchModelSynthesisResult>;
}

export interface ResearchModelClaimResult {
  claims: ResearchClaim[];
  warnings: ResearchWarning[];
  invocations: LlmInvocationMetadata[];
}

export interface ResearchModelSynthesisResult {
  synthesis: Record<string, unknown> | null;
  claims: ResearchClaim[];
  warnings: ResearchWarning[];
  invocations: LlmInvocationMetadata[];
}

interface CreateLlmResearchModelServicesOptions {
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
}

function documentUrl(document: SourceDocumentRecord): string {
  return document.canonicalUrl ?? document.url;
}

function sourceSummary(document: SourceDocumentRecord): Record<string, unknown> {
  return {
    sourceDocumentId: document.id,
    title: document.title ?? documentUrl(document),
    url: documentUrl(document),
    fetchStatus: document.fetchStatus,
    httpStatus: document.httpStatus,
    excerpt: (document.textContent ?? '').slice(0, 4_000),
    metadata: document.metadata,
  };
}

function candidateContext(candidates: StoryCandidateRecord[]): Array<Record<string, unknown>> {
  return candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    url: candidate.canonicalUrl ?? candidate.url,
    sourceName: candidate.sourceName,
    summary: candidate.summary,
    publishedAt: candidate.publishedAt?.toISOString() ?? null,
    status: candidate.status,
    score: candidate.score,
  }));
}

function warningFromModel(input: {
  id: string;
  code: string;
  message: string;
  sourceDocumentId?: string;
  metadata?: Record<string, unknown>;
}): ResearchWarning {
  return {
    id: input.id,
    code: input.code,
    severity: 'warning',
    message: input.message,
    sourceDocumentId: input.sourceDocumentId,
    metadata: input.metadata,
  };
}

function warningFromPromptWarning(input: {
  index: number;
  stage: 'claim_extractor' | 'research_synthesizer';
  warning: { code: string; message: string; severity: 'info' | 'warning' | 'critical'; sourceDocumentId?: string; metadata?: Record<string, unknown> };
}): ResearchWarning {
  return {
    id: `MODEL_WARNING:${input.stage}:${input.index}:${input.warning.code}`,
    code: input.warning.code,
    severity: input.warning.severity === 'critical' ? 'error' : input.warning.severity,
    message: input.warning.message,
    sourceDocumentId: input.warning.sourceDocumentId,
    metadata: {
      ...input.warning.metadata,
      modelStage: input.stage,
    },
  };
}

function normalizeClaimsFromExtraction(
  output: ExtractedClaimsResult,
  document: SourceDocumentRecord,
): ResearchClaim[] {
  return output.claims.map((claim, index) => ({
    id: claim.id || `model-claim-${document.id}-${index + 1}`,
    text: claim.text,
    sourceDocumentIds: [document.id],
    citationUrls: [documentUrl(document)],
    claimType: claim.claimType,
    confidence: claim.confidence,
    supportLevel: 'single_source',
    highStakes: false,
    caveat: claim.caveat,
  }));
}

function normalizeClaimsFromSynthesis(
  output: ResearchSynthesisResult,
  validDocumentIds: Set<string>,
  documentsById: Map<string, SourceDocumentRecord>,
): ResearchClaim[] {
  return output.claims
    .map((claim, index) => {
      const sourceDocumentIds = claim.sourceDocumentIds.filter((id) => validDocumentIds.has(id));
      const citationUrls = sourceDocumentIds.map((id) => documentUrl(documentsById.get(id)!));

      return {
        id: claim.id || `synthesis-claim-${index + 1}`,
        text: claim.text,
        sourceDocumentIds,
        citationUrls,
        claimType: claim.claimType,
        confidence: claim.confidence,
        supportLevel: sourceDocumentIds.length > 1 ? 'corroborated' : 'single_source',
        highStakes: false,
        caveat: claim.caveat,
      } satisfies ResearchClaim;
    })
    .filter((claim) => claim.sourceDocumentIds.length > 0 && claim.citationUrls.length > 0);
}

export function createLlmResearchModelServices(options: CreateLlmResearchModelServicesOptions): ResearchModelServices {
  return {
    async extractClaims(input) {
      if (!input.modelProfile) {
        return { claims: [], warnings: [], invocations: [] };
      }

      const claims: ResearchClaim[] = [];
      const warnings: ResearchWarning[] = [];
      const invocations: LlmInvocationMetadata[] = [];
      const usableDocuments = input.documents.filter((document) => document.fetchStatus === 'fetched' && (document.textContent?.trim().length ?? 0) > 0);

      for (const document of usableDocuments) {
        try {
          const rendered = await renderPromptTemplate(options.promptRegistry, {
            key: input.modelProfile.promptTemplateKey ?? undefined,
            role: input.modelProfile.promptTemplateKey ? undefined : 'claim_extractor',
            showId: input.showId,
            variables: {
              source_summary: sourceSummary(document),
              source_document: sourceSummary(document),
            },
          });
          const schema = PROMPT_OUTPUT_SCHEMAS.extracted_claims;
          const result = await options.runtime.generateJson<ExtractedClaimsResult>({
            profile: input.modelProfile,
            messages: rendered.messages,
            schemaName: rendered.responseFormat.schemaName ?? schema.name,
            schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
            validate: (value) => schema.validate(value) as ExtractedClaimsResult,
            requestMetadata: {
              purpose: 'research_claim_extraction',
              sourceDocumentId: document.id,
              promptTemplateKey: rendered.template.key,
              promptTemplateVersion: rendered.template.version,
            },
          });

          invocations.push(result.metadata);
          claims.push(...normalizeClaimsFromExtraction(result.value, document));
          warnings.push(...result.value.warnings.map((warning, index) => {
            return warningFromPromptWarning({ stage: 'claim_extractor', warning, index });
          }));
        } catch (error) {
          warnings.push(warningFromModel({
            id: `MODEL_CLAIM_EXTRACTION_FAILED:${document.id}`,
            code: 'MODEL_CLAIM_EXTRACTION_FAILED',
            message: error instanceof Error ? error.message : 'Claim extraction model failed.',
            sourceDocumentId: document.id,
          }));
        }
      }

      return { claims, warnings, invocations };
    },

    async synthesize(input) {
      if (!input.modelProfile) {
        return { synthesis: null, claims: [], warnings: [], invocations: [] };
      }

      try {
        const rendered = await renderPromptTemplate(options.promptRegistry, {
          key: input.modelProfile.promptTemplateKey ?? undefined,
          role: input.modelProfile.promptTemplateKey ? undefined : 'research_synthesizer',
          showId: input.showId,
          variables: {
            candidate_json: {
              candidates: candidateContext(input.candidates),
              angle: input.angle ?? null,
            },
            source_summaries: input.documents.map(sourceSummary),
            claims: input.claims,
          },
        });
        const schema = PROMPT_OUTPUT_SCHEMAS.research_synthesis;
        const result = await options.runtime.generateJson<ResearchSynthesisResult>({
          profile: input.modelProfile,
          messages: rendered.messages,
          schemaName: rendered.responseFormat.schemaName ?? schema.name,
          schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
          validate: (value) => schema.validate(value) as ResearchSynthesisResult,
          requestMetadata: {
            purpose: 'research_synthesis',
            candidateIds: input.candidates.map((candidate) => candidate.id),
            promptTemplateKey: rendered.template.key,
            promptTemplateVersion: rendered.template.version,
          },
        });
        const documentsById = new Map(input.documents.map((document) => [document.id, document]));
        const validDocumentIds = new Set(
          input.documents
            .filter((document) => document.fetchStatus === 'fetched')
            .map((document) => document.id),
        );

        return {
          synthesis: result.value as unknown as Record<string, unknown>,
          claims: normalizeClaimsFromSynthesis(result.value, validDocumentIds, documentsById),
          warnings: result.value.warnings.map((warning, index) => {
            return warningFromPromptWarning({ stage: 'research_synthesizer', warning, index });
          }),
          invocations: [result.metadata],
        };
      } catch (error) {
        return {
          synthesis: null,
          claims: [],
          warnings: [warningFromModel({
            id: 'MODEL_RESEARCH_SYNTHESIS_FAILED',
            code: 'MODEL_RESEARCH_SYNTHESIS_FAILED',
            message: error instanceof Error ? error.message : 'Research synthesis model failed.',
          })],
          invocations: [],
        };
      }
    },
  };
}
