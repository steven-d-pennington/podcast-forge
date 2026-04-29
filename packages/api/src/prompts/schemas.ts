import { z } from 'zod';

import type { PromptOutputSchemaDefinition, PromptOutputSchemaName } from './types.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());

const citationReferenceSchema = z.object({
  sourceDocumentId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  title: z.string().min(1).optional(),
  quote: z.string().min(1).optional(),
}).strict().refine((value) => Boolean(value.sourceDocumentId || value.url), {
  message: 'Citation references must include sourceDocumentId or url.',
});

const warningObjectSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string().min(1),
  sourceDocumentId: z.string().min(1).optional(),
  metadata: jsonObjectSchema.optional(),
}).strict();

const warningSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return {
      code: 'MODEL_WARNING',
      severity: 'warning',
      message: value,
    };
  }

  return value;
}, warningObjectSchema);

const scoreDimensionsSchema = z.object({
  significance: z.number().min(0).max(100),
  showFit: z.number().min(0).max(100),
  novelty: z.number().min(0).max(100),
  sourceQuality: z.number().min(0).max(100),
  urgency: z.number().min(0).max(100),
}).strict();

const optionalStringSchema = z.preprocess(
  (value) => value === null || value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const recommendedSourceSchema = z.object({
  sourceType: z.string().min(1),
  rationale: z.string().min(1),
  suggestedQuery: optionalStringSchema,
  url: optionalStringSchema,
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
}).strict();

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const scriptSpeakerSchema = z.preprocess((value) => {
  const object = objectValue(value);

  if (object && typeof object.name === 'string') {
    return object.name;
  }

  return value;
}, z.string().min(1));

const scriptCitationMapEntrySchema = z.preprocess((value) => {
  const object = objectValue(value);

  if (!object || typeof object.line === 'string') {
    return value;
  }

  const claims = Array.isArray(object.claims)
    ? object.claims.filter((claim): claim is string => typeof claim === 'string' && claim.trim().length > 0)
    : [];
  const fallbackLine = claims.join(' ')
    || (typeof object.title === 'string' ? object.title : '')
    || (typeof object.url === 'string' ? object.url : '');

  return {
    line: fallbackLine,
    ...(typeof object.claimId === 'string' ? { claimId: object.claimId } : {}),
    sourceDocumentIds: Array.isArray(object.sourceDocumentIds) ? object.sourceDocumentIds : [],
  };
}, z.object({
  line: z.string().min(1),
  claimId: z.string().min(1).optional(),
  sourceDocumentIds: z.array(z.string().min(1)).default([]),
}).strict());

export const episodePlanResultSchema = z.object({
  proposedAngle: z.string().min(1),
  whyNow: z.string().min(1),
  audienceRelevance: z.string().min(1),
  knownFacts: z.array(z.string().min(1)).default([]),
  unknownsSourceGaps: z.array(z.string().min(1)).default([]),
  questionsToAnswer: z.array(z.string().min(1)).default([]),
  recommendedSources: z.array(recommendedSourceSchema).default([]),
  warnings: z.array(warningSchema).default([]),
}).strict();

export const candidateScoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(['ignore', 'watch', 'shortlist']),
  rationale: z.string().min(1),
  dimensions: scoreDimensionsSchema,
  warnings: z.array(warningSchema).default([]),
  citations: z.array(citationReferenceSchema).default([]),
}).strict();

export const sourceSummarySchema = z.object({
  sourceDocumentId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  summary: z.string().min(1),
  keyFacts: z.array(z.string().min(1)).min(1),
  notableQuotes: z.array(z.object({
    quote: z.string().min(1),
    context: z.string().min(1).optional(),
  }).strict()).default([]),
  sourceType: z.enum(['primary', 'secondary', 'analysis', 'unknown']),
  warnings: z.array(warningSchema).default([]),
}).strict();

export const extractedClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  claimType: z.enum(['fact', 'quote', 'interpretation', 'uncertain']),
  confidence: z.enum(['low', 'medium', 'high']),
  sourceDocumentIds: z.array(z.string().min(1)).min(1),
  citations: z.array(citationReferenceSchema).min(1),
  caveat: z.string().min(1).optional(),
}).strict();

export const extractedClaimsSchema = z.object({
  claims: z.array(extractedClaimSchema),
  warnings: z.array(warningSchema).default([]),
}).strict();

export const researchSynthesisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  knownFacts: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  sourceDocumentIds: z.array(z.string().min(1)),
  claims: z.array(extractedClaimSchema),
  warnings: z.array(warningSchema).default([]),
  editorialAngle: z.string().min(1).optional(),
}).strict();

export const scriptGenerationResultSchema = z.object({
  title: z.string().min(1),
  format: z.string().min(1),
  body: z.string().min(1),
  speakers: z.array(scriptSpeakerSchema).min(1),
  citationMap: z.array(scriptCitationMapEntrySchema).default([]),
  warnings: z.array(warningSchema).default([]),
}).strict();

export const scriptRevisionResultSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  changeSummary: z.string().min(1),
  speakers: z.array(z.string().min(1)).min(1),
  resolvedWarnings: z.array(z.string().min(1)).default([]),
  remainingWarnings: z.array(warningSchema).default([]),
}).strict();

const integrityIssueSeveritySchema = z.enum(['info', 'warning', 'critical']);

const integrityIssueSchema = z.object({
  claimId: z.string().min(1).optional(),
  scriptExcerpt: z.string().min(1).optional(),
  issue: z.string().min(1),
  severity: integrityIssueSeveritySchema.default('warning'),
  sourceDocumentIds: z.array(z.string().min(1)).default([]),
  citationUrls: z.array(z.string().url()).default([]),
  suggestedFix: z.string().min(1).optional(),
}).strict();

const missingCitationSchema = z.preprocess((value) => {
  const object = objectValue(value);

  if (!object || typeof object.issue === 'string') {
    return value;
  }

  return {
    scriptExcerpt: typeof object.scriptExcerpt === 'string'
      ? object.scriptExcerpt
      : typeof object.claim === 'string'
        ? object.claim
        : typeof object.location === 'string'
          ? object.location
          : 'Unspecified script excerpt',
    issue: typeof object.detail === 'string'
      ? object.detail
      : typeof object.claim === 'string'
        ? object.claim
        : 'Missing citation.',
    ...(typeof object.suggestedFix === 'string' ? { suggestedFix: object.suggestedFix } : {}),
    ...(typeof object.severity === 'string' ? { severity: object.severity } : {}),
  };
}, z.object({
  scriptExcerpt: z.string().min(1),
  issue: z.string().min(1),
  suggestedCitation: citationReferenceSchema.optional(),
  suggestedFix: z.string().min(1).optional(),
  severity: integrityIssueSeveritySchema.default('warning'),
}).strict());

const unsupportedCertaintySchema = z.object({
  scriptExcerpt: z.string().min(1),
  issue: z.string().min(1),
  suggestedFix: z.string().min(1).optional(),
  severity: integrityIssueSeveritySchema.default('warning'),
}).strict();

const integrityWarningSchema = z.preprocess((value) => {
  const object = objectValue(value);

  if (!object || typeof object.issue === 'string') {
    return value;
  }

  return {
    ...(typeof object.location === 'string' ? { scriptExcerpt: object.location } : {}),
    issue: typeof object.detail === 'string'
      ? object.detail
      : typeof object.claim === 'string'
        ? object.claim
        : 'Integrity warning.',
    ...(typeof object.suggestedFix === 'string' ? { suggestedFix: object.suggestedFix } : {}),
    ...(typeof object.severity === 'string' ? { severity: object.severity } : {}),
  };
}, z.object({
  scriptExcerpt: z.string().min(1).optional(),
  issue: z.string().min(1),
  severity: integrityIssueSeveritySchema.default('warning'),
  suggestedFix: z.string().min(1).optional(),
}).strict());

const suggestedFixSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value;
  }

  const object = objectValue(value);
  if (!object) {
    return value;
  }

  return [object.fix, object.suggestion, object.detail, object.issue, object.action]
    .find((part): part is string => typeof part === 'string' && part.trim().length > 0);
}, z.string().min(1));

export const integrityReviewResultSchema = z.object({
  verdict: z.enum(['PASS', 'PASS_WITH_NOTES', 'FAIL']),
  summary: z.string().min(1),
  claimIssues: z.array(integrityIssueSchema).default([]),
  missingCitations: z.array(missingCitationSchema).default([]),
  unsupportedCertainty: z.array(unsupportedCertaintySchema).default([]),
  attributionWarnings: z.array(integrityWarningSchema).default([]),
  balanceWarnings: z.array(integrityWarningSchema).default([]),
  biasSensationalismWarnings: z.array(integrityWarningSchema).default([]),
  suggestedFixes: z.array(suggestedFixSchema).default([]),
}).strict();

export const metadataResultSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  description: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).strict();

export const coverPromptResultSchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().min(1).optional(),
  altText: z.string().min(1),
  safetyNotes: z.array(z.string().min(1)).default([]),
}).strict();

export type CandidateScoreResult = z.infer<typeof candidateScoreResultSchema>;
export type EpisodePlanResult = z.infer<typeof episodePlanResultSchema>;
export type SourceSummaryResult = z.infer<typeof sourceSummarySchema>;
export type ExtractedClaimsResult = z.infer<typeof extractedClaimsSchema>;
export type ResearchSynthesisResult = z.infer<typeof researchSynthesisSchema>;
export type ScriptGenerationResult = z.infer<typeof scriptGenerationResultSchema>;
export type ScriptRevisionResult = z.infer<typeof scriptRevisionResultSchema>;
export type IntegrityReviewResult = z.infer<typeof integrityReviewResultSchema>;
export type MetadataResult = z.infer<typeof metadataResultSchema>;
export type CoverPromptResult = z.infer<typeof coverPromptResultSchema>;

function jsonSchemaHint(name: PromptOutputSchemaName, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'object',
    title: name,
    additionalProperties: false,
    required,
    properties,
  };
}

export const PROMPT_OUTPUT_SCHEMAS: Record<PromptOutputSchemaName, PromptOutputSchemaDefinition> = {
  episode_plan_result: {
    name: 'episode_plan_result',
    description: 'Advisory AI episode/story plan for selected candidate stories before research.',
    schemaHint: jsonSchemaHint('episode_plan_result', {
      proposedAngle: { type: 'string' },
      whyNow: { type: 'string' },
      audienceRelevance: { type: 'string' },
      knownFacts: { type: 'array', items: { type: 'string' } },
      unknownsSourceGaps: { type: 'array', items: { type: 'string' } },
      questionsToAnswer: { type: 'array', items: { type: 'string' } },
      recommendedSources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceType', 'rationale'],
          properties: {
            sourceType: { type: 'string' },
            rationale: { type: 'string' },
            suggestedQuery: { type: 'string' },
            url: { type: 'string' },
            priority: { enum: ['low', 'medium', 'high'] },
          },
        },
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'message'],
          properties: {
            code: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            message: { type: 'string' },
            sourceDocumentId: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    }, ['proposedAngle', 'whyNow', 'audienceRelevance', 'knownFacts', 'unknownsSourceGaps', 'questionsToAnswer', 'recommendedSources']),
    validate: episodePlanResultSchema.parse,
  },
  candidate_score_result: {
    name: 'candidate_score_result',
    description: 'Scores one story candidate for editorial fit and source quality.',
    schemaHint: jsonSchemaHint('candidate_score_result', {
      score: { type: 'number', minimum: 0, maximum: 100 },
      verdict: { enum: ['ignore', 'watch', 'shortlist'] },
      rationale: { type: 'string' },
      dimensions: {
        type: 'object',
        additionalProperties: false,
        required: ['significance', 'showFit', 'novelty', 'sourceQuality', 'urgency'],
        properties: {
          significance: { type: 'number', minimum: 0, maximum: 100 },
          showFit: { type: 'number', minimum: 0, maximum: 100 },
          novelty: { type: 'number', minimum: 0, maximum: 100 },
          sourceQuality: { type: 'number', minimum: 0, maximum: 100 },
          urgency: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'message'],
          properties: {
            code: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            message: { type: 'string' },
            sourceDocumentId: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceDocumentId: { type: 'string' },
            url: { type: 'string' },
            title: { type: 'string' },
            quote: { type: 'string' },
          },
        },
      },
    }, ['score', 'verdict', 'rationale', 'dimensions']),
    validate: candidateScoreResultSchema.parse,
  },
  source_summary: {
    name: 'source_summary',
    description: 'Summarizes one fetched source document with provenance.',
    schemaHint: jsonSchemaHint('source_summary', {
      sourceDocumentId: { type: 'string' },
      title: { type: 'string' },
      url: { type: 'string' },
      summary: { type: 'string' },
      keyFacts: { type: 'array', items: { type: 'string' } },
      sourceType: { enum: ['primary', 'secondary', 'analysis', 'unknown'] },
      warnings: { type: 'array' },
    }, ['sourceDocumentId', 'title', 'url', 'summary', 'keyFacts', 'sourceType']),
    validate: sourceSummarySchema.parse,
  },
  extracted_claims: {
    name: 'extracted_claims',
    description: 'Extracts factual claims and citation references from sources.',
    schemaHint: jsonSchemaHint('extracted_claims', {
      claims: { type: 'array' },
      warnings: { type: 'array' },
    }, ['claims']),
    validate: extractedClaimsSchema.parse,
  },
  research_synthesis: {
    name: 'research_synthesis',
    description: 'Synthesizes claims, source coverage, warnings, and open questions.',
    schemaHint: jsonSchemaHint('research_synthesis', {
      title: { type: 'string' },
      summary: { type: 'string' },
      knownFacts: { type: 'array' },
      openQuestions: { type: 'array' },
      sourceDocumentIds: { type: 'array' },
      claims: { type: 'array' },
      warnings: { type: 'array' },
      editorialAngle: { type: 'string' },
    }, ['title', 'summary', 'knownFacts', 'openQuestions', 'sourceDocumentIds', 'claims']),
    validate: researchSynthesisSchema.parse,
  },
  script_generation_result: {
    name: 'script_generation_result',
    description: 'Drafts an attributed episode script from a research packet.',
    schemaHint: jsonSchemaHint('script_generation_result', {
      title: { type: 'string' },
      format: { type: 'string' },
      body: { type: 'string' },
      speakers: { type: 'array', items: { type: 'string' } },
      citationMap: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line'],
          properties: {
            line: { type: 'string' },
            claimId: { type: 'string' },
            sourceDocumentIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'message'],
          properties: {
            code: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            message: { type: 'string' },
            sourceDocumentId: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    }, ['title', 'format', 'body', 'speakers']),
    validate: scriptGenerationResultSchema.parse,
  },
  script_revision_result: {
    name: 'script_revision_result',
    description: 'Revises a script and records resolved or remaining issues.',
    schemaHint: jsonSchemaHint('script_revision_result', {
      title: { type: 'string' },
      body: { type: 'string' },
      changeSummary: { type: 'string' },
      speakers: { type: 'array', items: { type: 'string' } },
      resolvedWarnings: { type: 'array', items: { type: 'string' } },
      remainingWarnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'message'],
          properties: {
            code: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            message: { type: 'string' },
            sourceDocumentId: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    }, ['title', 'body', 'changeSummary', 'speakers']),
    validate: scriptRevisionResultSchema.parse,
  },
  integrity_review_result: {
    name: 'integrity_review_result',
    description: 'Reviews a script against its research packet for accuracy, attribution, balance, uncertainty, and sourcing gaps.',
    schemaHint: jsonSchemaHint('integrity_review_result', {
      verdict: { enum: ['PASS', 'PASS_WITH_NOTES', 'FAIL'] },
      summary: { type: 'string' },
      claimIssues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issue'],
          properties: {
            claimId: { type: 'string' },
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            sourceDocumentIds: { type: 'array', items: { type: 'string' } },
            citationUrls: { type: 'array', items: { type: 'string' } },
            suggestedFix: { type: 'string' },
          },
        },
      },
      missingCitations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['scriptExcerpt', 'issue'],
          properties: {
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            suggestedCitation: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sourceDocumentId: { type: 'string' },
                url: { type: 'string' },
                title: { type: 'string' },
                quote: { type: 'string' },
              },
            },
            suggestedFix: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
          },
        },
      },
      unsupportedCertainty: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['scriptExcerpt', 'issue'],
          properties: {
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            suggestedFix: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
          },
        },
      },
      attributionWarnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issue'],
          properties: {
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            suggestedFix: { type: 'string' },
          },
        },
      },
      balanceWarnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issue'],
          properties: {
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            suggestedFix: { type: 'string' },
          },
        },
      },
      biasSensationalismWarnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issue'],
          properties: {
            scriptExcerpt: { type: 'string' },
            issue: { type: 'string' },
            severity: { enum: ['info', 'warning', 'critical'] },
            suggestedFix: { type: 'string' },
          },
        },
      },
      suggestedFixes: { type: 'array', items: { type: 'string' } },
    }, ['verdict', 'summary']),
    validate: integrityReviewResultSchema.parse,
  },
  metadata_result: {
    name: 'metadata_result',
    description: 'Creates publishable title, description, summary, tags, and slug.',
    schemaHint: jsonSchemaHint('metadata_result', {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      description: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'array' },
      slug: { type: 'string' },
    }, ['title', 'description', 'summary', 'slug']),
    validate: metadataResultSchema.parse,
  },
  cover_prompt_result: {
    name: 'cover_prompt_result',
    description: 'Creates a safe visual prompt and alt text for cover art generation.',
    schemaHint: jsonSchemaHint('cover_prompt_result', {
      prompt: { type: 'string' },
      negativePrompt: { type: 'string' },
      altText: { type: 'string' },
      safetyNotes: { type: 'array' },
    }, ['prompt', 'altText']),
    validate: coverPromptResultSchema.parse,
  },
};
