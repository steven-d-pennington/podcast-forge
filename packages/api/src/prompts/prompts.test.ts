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
