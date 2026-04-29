import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { MODEL_ROLES } from '../models/roles.js';
import { DEFAULT_PROMPT_TEMPLATES } from './defaults.js';
import { createPromptRegistry } from './registry.js';
import { PromptRenderError, renderPromptTemplate } from './renderer.js';
import { registerPromptRoutes } from './routes.js';
import {
  candidateScoreResultSchema,
  episodePlanResultSchema,
  extractedClaimsSchema,
  integrityReviewResultSchema,
  PROMPT_OUTPUT_SCHEMAS,
  scriptGenerationResultSchema,
  scriptRevisionResultSchema,
} from './schemas.js';

describe('prompt registry defaults', () => {
  it('provides a default template for every core model role', async () => {
    const registry = createPromptRegistry();
    const templates = await registry.listTemplates();
    const roles = new Set(templates.map((template) => template.role));

    assert.equal(DEFAULT_PROMPT_TEMPLATES.length, MODEL_ROLES.length);
    for (const role of MODEL_ROLES) {
      assert.equal(roles.has(role), true, `missing prompt for ${role}`);
    }
  });

  it('looks up a template by key', async () => {
    const registry = createPromptRegistry();
    const template = await registry.getTemplateByKey('script_writer.default');

    assert.equal(template?.role, 'script_writer');
    assert.equal(template?.outputSchemaName, 'script_generation_result');
  });

  it('provides the default episode planner template', async () => {
    const registry = createPromptRegistry();
    const template = await registry.getTemplateByRole('episode_planner');

    assert.equal(template?.key, 'episode_planner.default');
    assert.equal(template?.outputSchemaName, 'episode_plan_result');
  });
});

describe('prompt rendering', () => {
  it('renders variables into LLM-compatible messages and JSON response hints', async () => {
    const registry = createPromptRegistry();
    const rendered = await renderPromptTemplate(registry, {
      key: 'candidate_scorer.default',
      variables: {
        show_context: { title: 'Example Show' },
        source_profile: { slug: 'daily-ai' },
        candidate_json: { title: 'A sourced story', url: 'https://example.com/story' },
      },
    });

    assert.equal(rendered.template.key, 'candidate_scorer.default');
    assert.equal(rendered.messages.length, 1);
    assert.equal(rendered.messages[0].role, 'system');
    assert.match(rendered.text, /Example Show/);
    assert.equal(rendered.responseFormat.type, 'json');
    assert.equal(rendered.responseFormat.schemaName, 'candidate_score_result');
    assert.match(rendered.text, /\"significance\"/);
    assert.match(rendered.text, /\"showFit\"/);
    assert.match(rendered.text, /\"sourceQuality\"/);
    assert.match(rendered.text, /warnings.*code.*severity.*message/s);
    assert.doesNotMatch(rendered.text, /editorial_fit/);
    assert.doesNotMatch(rendered.text, /source_quality/);
  });

  it('fails clearly when a required variable is missing', async () => {
    const registry = createPromptRegistry();

    await assert.rejects(
      () => renderPromptTemplate(registry, {
        key: 'candidate_scorer.default',
        variables: {
          show_context: 'show',
          source_profile: 'source',
        },
      }),
      (error) => {
        assert.equal(error instanceof PromptRenderError, true);
        assert.equal((error as PromptRenderError).code, 'PROMPT_VARIABLES_MISSING');
        assert.deepEqual((error as PromptRenderError).details.missingVariables, ['candidate_json']);
        return true;
      },
    );
  });
});

describe('prompt output schemas', () => {
  it('validates episode plan output', () => {
    const result = episodePlanResultSchema.parse({
      proposedAngle: 'Why open model policy is becoming a product decision.',
      whyNow: 'The candidate records indicate new policy and product activity this week.',
      audienceRelevance: 'Listeners need to understand what to verify before treating the claim as settled.',
      knownFacts: ['A candidate story was discovered from an AI policy source.'],
      unknownsSourceGaps: ['No primary source has been fetched yet.'],
      questionsToAnswer: ['Which organization made the announcement?'],
      recommendedSources: [{
        sourceType: 'primary company post',
        rationale: 'The research brief should start with the source of the claim.',
        suggestedQuery: 'company announcement model policy',
        priority: 'high',
      }],
      warnings: [],
    });

    assert.equal(result.recommendedSources[0].priority, 'high');
    assert.equal(episodePlanResultSchema.parse({
      proposedAngle: 'Find primary sourcing for a fast-moving AI chip story.',
      whyNow: 'The selected candidate lacks verified primary-source evidence.',
      audienceRelevance: 'Listeners need to know what should be verified next.',
      recommendedSources: [{
        sourceType: 'primary company post',
        rationale: 'The advisory planner may know the source family before it has a verified URL.',
        url: '',
        suggestedQuery: null,
        priority: 'high',
      }],
    }).recommendedSources[0].url, undefined);
    const sparseResult = episodePlanResultSchema.parse({
      proposedAngle: 'Sparse but valid advisory plan',
      whyNow: 'Candidate metadata may still be incomplete.',
      audienceRelevance: 'The planner should surface uncertainty without fabricating lists.',
    });

    assert.deepEqual(sparseResult.knownFacts, []);
    assert.deepEqual(sparseResult.recommendedSources, []);
    assert.throws(() => episodePlanResultSchema.parse({
      proposedAngle: 'Bad source',
      whyNow: 'Now',
      audienceRelevance: 'Audience',
      recommendedSources: [{ sourceType: '', rationale: 'Missing source type' }],
    }), ZodError);
  });

  it('describes nested episode plan arrays so JSON-mode models return objects instead of strings', () => {
    const properties = PROMPT_OUTPUT_SCHEMAS.episode_plan_result.schemaHint.properties as Record<string, unknown>;
    const recommendedSources = properties.recommendedSources as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };
    const warnings = properties.warnings as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };

    assert.deepEqual(recommendedSources.items?.required, ['sourceType', 'rationale']);
    assert.deepEqual(Object.keys(recommendedSources.items?.properties ?? {}), [
      'sourceType',
      'rationale',
      'suggestedQuery',
      'url',
      'priority',
    ]);
    assert.deepEqual(warnings.items?.required, ['code', 'severity', 'message']);
    assert.deepEqual(Object.keys(warnings.items?.properties ?? {}), [
      'code',
      'severity',
      'message',
      'sourceDocumentId',
      'metadata',
    ]);
  });

  it('normalizes model-emitted script generation speaker objects and source citation maps', () => {
    const result = scriptGenerationResultSchema.parse({
      title: 'The Synthetic Lens - April 29, 2026',
      format: 'feature-analysis',
      body: 'DAVID: Today we are tracing a fast-moving AI rivalry story.',
      speakers: [
        { name: 'DAVID', role: 'host' },
        { name: 'MARCUS', role: 'analyst' },
      ],
      citationMap: [{
        id: '1',
        url: 'https://www.cfr.org/articles/deepseek-v4-signals-a-new-phase-in-the-u-s-china-ai-rivalry',
        title: 'DeepSeek V4 Signals a New Phase in the U.S.-China AI Rivalry',
        claims: [
          'DeepSeek released V4 large language model.',
          'The release highlights U.S.-China AI competition.',
        ],
      }],
      warnings: [],
    });

    assert.deepEqual(result.speakers, ['DAVID', 'MARCUS']);
    assert.deepEqual(result.citationMap, [{
      line: 'DeepSeek released V4 large language model. The release highlights U.S.-China AI competition.',
      sourceDocumentIds: [],
    }]);
  });

  it('describes nested script generation arrays so JSON-mode models avoid object speakers and source bibliography maps', () => {
    const properties = PROMPT_OUTPUT_SCHEMAS.script_generation_result.schemaHint.properties as Record<string, unknown>;
    const speakers = properties.speakers as { items?: Record<string, unknown> };
    const citationMap = properties.citationMap as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };
    const warnings = properties.warnings as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };

    assert.deepEqual(speakers.items, { type: 'string' });
    assert.deepEqual(citationMap.items?.required, ['line']);
    assert.deepEqual(Object.keys(citationMap.items?.properties ?? {}), [
      'line',
      'claimId',
      'sourceDocumentIds',
    ]);
    assert.deepEqual(warnings.items?.required, ['code', 'severity', 'message']);
  });

  it('normalizes model-emitted script revision warning strings', () => {
    const result = scriptRevisionResultSchema.parse({
      title: 'Edited script',
      body: 'DAVID: A revised line with softer certainty.',
      changeSummary: 'Reduced certainty and preserved attribution.',
      speakers: ['DAVID'],
      resolvedWarnings: ['Softened one overconfident phrase.'],
      remainingWarnings: ['Primary source still needed for the high-stakes claim.'],
    });

    assert.deepEqual(result.resolvedWarnings, ['Softened one overconfident phrase.']);
    assert.deepEqual(result.remainingWarnings, [{
      code: 'MODEL_WARNING',
      severity: 'warning',
      message: 'Primary source still needed for the high-stakes claim.',
    }]);
  });

  it('describes nested script revision warning arrays so JSON-mode models avoid string warnings', () => {
    const properties = PROMPT_OUTPUT_SCHEMAS.script_revision_result.schemaHint.properties as Record<string, unknown>;
    const speakers = properties.speakers as { items?: Record<string, unknown> };
    const resolvedWarnings = properties.resolvedWarnings as { items?: Record<string, unknown> };
    const remainingWarnings = properties.remainingWarnings as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };

    assert.deepEqual(speakers.items, { type: 'string' });
    assert.deepEqual(resolvedWarnings.items, { type: 'string' });
    assert.deepEqual(remainingWarnings.items?.required, ['code', 'severity', 'message']);
    assert.deepEqual(Object.keys(remainingWarnings.items?.properties ?? {}), [
      'code',
      'severity',
      'message',
      'sourceDocumentId',
      'metadata',
    ]);
  });

  it('validates candidate score output', () => {
    const result = candidateScoreResultSchema.parse({
      score: 82,
      verdict: 'shortlist',
      rationale: 'Well sourced and relevant.',
      dimensions: {
        significance: 85,
        showFit: 90,
        novelty: 70,
        sourceQuality: 80,
        urgency: 75,
      },
      warnings: [],
      citations: [{ url: 'https://example.com/source' }],
    });

    assert.equal(result.verdict, 'shortlist');
    assert.throws(() => candidateScoreResultSchema.parse({
      score: 120,
      verdict: 'shortlist',
      rationale: 'Too high.',
      dimensions: {
        significance: 85,
        showFit: 90,
        novelty: 70,
        sourceQuality: 80,
        urgency: 75,
      },
    }), ZodError);
  });

  it('validates extracted claims with citations', () => {
    const result = extractedClaimsSchema.parse({
      claims: [{
        id: 'claim-1',
        text: 'The company announced a new model.',
        claimType: 'fact',
        confidence: 'high',
        sourceDocumentIds: ['doc-1'],
        citations: [{ sourceDocumentId: 'doc-1', url: 'https://example.com/post' }],
      }],
      warnings: [],
    });

    assert.equal(result.claims.length, 1);
    assert.throws(() => extractedClaimsSchema.parse({
      claims: [{
        id: 'claim-1',
        text: 'Unsupported claim.',
        claimType: 'fact',
        confidence: 'high',
        sourceDocumentIds: [],
        citations: [],
      }],
    }), ZodError);
  });

  it('validates structured integrity review output', () => {
    const result = integrityReviewResultSchema.parse({
      verdict: 'FAIL',
      summary: 'Unsupported certainty needs an edit before production.',
      claimIssues: [{
        claimId: 'claim-1',
        scriptExcerpt: 'This is definitely confirmed.',
        issue: 'The source packet does not support definite certainty.',
        severity: 'critical',
        sourceDocumentIds: ['source-document-1'],
        citationUrls: ['https://example.com/source'],
        suggestedFix: 'Attribute the claim and soften certainty.',
      }],
      missingCitations: [],
      unsupportedCertainty: [],
      attributionWarnings: [],
      balanceWarnings: [],
      biasSensationalismWarnings: [],
      suggestedFixes: ['Rewrite the sentence with attribution.'],
    });

    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.claimIssues[0].severity, 'critical');
    assert.throws(() => integrityReviewResultSchema.parse({
      verdict: 'MAYBE',
      summary: 'Invalid verdict.',
    }), ZodError);
  });

  it('normalizes model-emitted integrity review issue aliases and suggested fix objects', () => {
    const result = integrityReviewResultSchema.parse({
      verdict: 'PASS_WITH_NOTES',
      summary: 'Accurate but needs editorial review for high-stakes claims.',
      claimIssues: [],
      missingCitations: [{
        claim: 'Several high-stakes claims lack primary source documentation.',
        detail: 'Add primary source links before production.',
      }],
      unsupportedCertainty: [],
      attributionWarnings: [{
        location: 'MARCUS: The release changes the global AI race.',
        detail: 'Attribute this as analysis rather than settled fact.',
      }],
      balanceWarnings: [{
        location: 'INGRID: Regulators are moving quickly.',
        detail: 'Mention that policy reactions vary by jurisdiction.',
      }],
      biasSensationalismWarnings: [],
      suggestedFixes: [{ detail: 'Add an inline citation map and primary source caveat.' }],
    });

    assert.deepEqual(result.missingCitations, [{
      scriptExcerpt: 'Several high-stakes claims lack primary source documentation.',
      issue: 'Add primary source links before production.',
      severity: 'warning',
    }]);
    assert.deepEqual(result.attributionWarnings, [{
      scriptExcerpt: 'MARCUS: The release changes the global AI race.',
      issue: 'Attribute this as analysis rather than settled fact.',
      severity: 'warning',
    }]);
    assert.deepEqual(result.balanceWarnings, [{
      scriptExcerpt: 'INGRID: Regulators are moving quickly.',
      issue: 'Mention that policy reactions vary by jurisdiction.',
      severity: 'warning',
    }]);
    assert.deepEqual(result.suggestedFixes, ['Add an inline citation map and primary source caveat.']);
  });

  it('describes nested integrity review arrays so JSON-mode models avoid alias fields', () => {
    const properties = PROMPT_OUTPUT_SCHEMAS.integrity_review_result.schemaHint.properties as Record<string, unknown>;
    const missingCitations = properties.missingCitations as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };
    const attributionWarnings = properties.attributionWarnings as {
      items?: { properties?: Record<string, unknown>; required?: string[] };
    };
    const suggestedFixes = properties.suggestedFixes as { items?: Record<string, unknown> };

    assert.deepEqual(missingCitations.items?.required, ['scriptExcerpt', 'issue']);
    assert.deepEqual(Object.keys(missingCitations.items?.properties ?? {}), [
      'scriptExcerpt',
      'issue',
      'suggestedCitation',
      'suggestedFix',
      'severity',
    ]);
    assert.deepEqual(attributionWarnings.items?.required, ['issue']);
    assert.deepEqual(Object.keys(attributionWarnings.items?.properties ?? {}), [
      'scriptExcerpt',
      'issue',
      'severity',
      'suggestedFix',
    ]);
    assert.deepEqual(suggestedFixes.items, { type: 'string' });
  });
});

describe('prompt API routes', () => {
  const app = Fastify();
  registerPromptRoutes(app, {
    getStore() {
      return undefined;
    },
  });

  after(async () => {
    await app.close();
  });

  it('lists defaults for admin/settings UI callers', async () => {
    const response = await app.inject({ method: 'GET', url: '/prompt-templates?role=script_writer' });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.templates.length, 1);
    assert.equal(body.templates[0].key, 'script_writer.default');
  });

  it('renders a sample prompt through the API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/prompt-templates/render',
      payload: {
        key: 'metadata_writer.default',
        variables: {
          show_context: 'Example show',
          research_packet: { title: 'Packet' },
          script_result: { title: 'Script' },
        },
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.rendered.template.key, 'metadata_writer.default');
    assert.equal(body.rendered.responseFormat.schemaName, 'metadata_result');
  });
});
