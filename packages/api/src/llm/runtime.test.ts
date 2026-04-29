import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ResolvedModelProfile } from '../models/resolver.js';
import { parseJsonOutput } from './json.js';
import { appendLlmInvocationToJobOutput, llmInvocationJobLog } from './job-metadata.js';
import { createFakeLlmProvider, createOpenAiCompatibleProvider } from './providers.js';
import { createLlmRuntime } from './runtime.js';
import { LlmJsonOutputError, LlmRuntimeError } from './types.js';

function profile(input: Partial<ResolvedModelProfile> = {}): ResolvedModelProfile {
  return {
    id: input.id ?? 'model-profile-1',
    showId: input.showId ?? 'show-1',
    role: input.role ?? 'script_writer',
    provider: input.provider ?? 'fake',
    model: input.model ?? 'fake-model',
    params: input.params ?? { temperature: 0.2, maxTokens: 1000 },
    fallbacks: input.fallbacks ?? [],
    budgetUsd: input.budgetUsd ?? 1,
    promptTemplateKey: input.promptTemplateKey ?? 'script.default',
    version: input.version ?? '2026-04-26T00:00:00.000Z',
  };
}

describe('LLM runtime', () => {
  it('generates deterministic fake text with reusable invocation metadata', async () => {
    const runtime = createLlmRuntime({
      adapters: [createFakeLlmProvider()],
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    const result = await runtime.generateText({
      profile: profile(),
      messages: [{ role: 'user', content: 'Write one sourced paragraph.' }],
      requestMetadata: { jobId: 'job-1', storyCandidateId: 'candidate-1' },
    });

    assert.match(result.text, /Fake LLM response/);
    assert.equal(result.metadata.profile.id, 'model-profile-1');
    assert.deepEqual(result.metadata.selected, {
      provider: 'fake',
      model: 'fake-model',
      fallbackIndex: null,
    });
    assert.equal(result.metadata.attempts.length, 1);
    assert.equal(result.metadata.attempts[0].status, 'succeeded');
    assert.equal(result.metadata.cost.usd, 0);
    assert.equal(result.metadata.requestMetadata.jobId, 'job-1');

    const log = llmInvocationJobLog(result.metadata);
    assert.equal(log.level, 'info');
    const output = appendLlmInvocationToJobOutput({ scriptId: 'script-1' }, result.metadata);
    assert.equal((output.llmInvocations as unknown[]).length, 1);
  });

  it('tries configured fallbacks and records failed provider attempts', async () => {
    const runtime = createLlmRuntime({
      adapters: [
        createFakeLlmProvider({
          provider: 'primary',
          failures: {
            'primary-model': { message: 'Primary unavailable.', retryable: true },
          },
        }),
        createFakeLlmProvider({ provider: 'fake' }),
      ],
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    const result = await runtime.generateText({
      profile: profile({
        provider: 'primary',
        model: 'primary-model',
        fallbacks: ['fake/fallback-model'],
      }),
      messages: [{ role: 'user', content: 'Fallback please.' }],
    });

    assert.equal(result.metadata.attempts.length, 2);
    assert.equal(result.metadata.attempts[0].status, 'failed');
    assert.equal(result.metadata.attempts[0].error?.message, 'Primary unavailable.');
    assert.equal(result.metadata.attempts[1].status, 'succeeded');
    assert.deepEqual(result.metadata.selected, {
      provider: 'fake',
      model: 'fallback-model',
      fallbackIndex: 0,
    });
  });

  it('surfaces final errors with attempted provider metadata', async () => {
    const runtime = createLlmRuntime({
      adapters: [
        createFakeLlmProvider({
          failures: {
            'fake-model': { message: 'No capacity.', retryable: true },
            'fallback-model': { message: 'Fallback unavailable.', retryable: true },
          },
        }),
      ],
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    await assert.rejects(
      runtime.generateText({
        profile: profile({ fallbacks: ['fallback-model'] }),
        messages: [{ role: 'user', content: 'Fail clearly.' }],
      }),
      (error) => {
        assert.ok(error instanceof LlmRuntimeError);
        assert.equal(error.metadata.selected, null);
        assert.equal(error.metadata.attempts.length, 2);
        assert.equal(error.metadata.attempts[0].error?.message, 'No capacity.');
        assert.equal(error.metadata.attempts[1].error?.message, 'Fallback unavailable.');
        return true;
      },
    );
  });

  it('generates and validates JSON output', async () => {
    const runtime = createLlmRuntime({
      adapters: [
        createFakeLlmProvider({
          handler: () => ({
            text: '```json\n{"score":0.82,"reason":"clear fit"}\n```',
            rawOutput: { text: 'fenced' },
          }),
        }),
      ],
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    const result = await runtime.generateJson<{ score: number; reason: string }>({
      profile: profile({ role: 'candidate_scorer' }),
      messages: [{ role: 'user', content: 'Score this candidate.' }],
      schemaName: 'candidate_score',
      validate(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Expected object.');
        }

        const candidate = value as { score?: unknown; reason?: unknown };
        if (typeof candidate.score !== 'number' || typeof candidate.reason !== 'string') {
          throw new Error('Expected score and reason.');
        }

        return { score: candidate.score, reason: candidate.reason };
      },
    });

    assert.equal(result.value.score, 0.82);
    assert.equal(result.metadata.responseFormat.type, 'json');
    assert.match(result.metadata.validatedOutputPreview ?? '', /clear fit/);
  });

  it('forwards safe OpenAI-compatible profile params such as GLM thinking mode', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = createOpenAiCompatibleProvider({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await provider.generateText({
      attempt: {
        profileId: 'profile-1',
        role: 'candidate_scorer',
        provider: 'openai-compatible',
        model: 'glm-5.1',
        params: {
          temperature: 0.2,
          maxTokens: 1200,
          thinking: { type: 'disabled' },
        },
        promptTemplateKey: 'candidate_scorer.default',
        budgetUsd: 0.25,
      },
      messages: [{ role: 'user', content: 'Score candidate.' }],
      responseFormat: { type: 'json' },
      requestMetadata: {},
    });

    assert.equal(requestBody?.model, 'glm-5.1');
    assert.equal(requestBody?.temperature, 0.2);
    assert.equal(requestBody?.max_tokens, 1200);
    assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
    assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
  });

  it('sends GLM single rendered system prompts as user messages for Z.AI compatibility', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = createOpenAiCompatibleProvider({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { content: '{"ok":true}' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await provider.generateText({
      attempt: {
        profileId: 'profile-1',
        role: 'candidate_scorer',
        provider: 'openai-compatible',
        model: 'glm-5.1',
        params: { temperature: 0.2, maxTokens: 1200, thinking: { type: 'disabled' } },
        promptTemplateKey: 'candidate_scorer.default',
        budgetUsd: 0.25,
      },
      messages: [{ role: 'system', content: 'Rendered candidate scorer prompt.' }],
      responseFormat: { type: 'json' },
      requestMetadata: {},
    });

    assert.deepEqual(requestBody?.messages, [{ role: 'user', content: 'Rendered candidate scorer prompt.' }]);
  });

  it('returns structured helper errors for malformed JSON and validation failures', () => {
    const malformed = parseJsonOutput('{not-json');
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.error.code, 'malformed_json');
      assert.match(malformed.error.outputPreview, /\{not-json/);
    }

    const invalid = parseJsonOutput('{"score":"high"}', () => {
      throw new Error('score must be numeric');
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.error.code, 'validation_failed');
      assert.equal(invalid.error.message, 'score must be numeric');
    }
  });

  it('throws JSON output errors with invocation metadata', async () => {
    const runtime = createLlmRuntime({
      adapters: [
        createFakeLlmProvider({
          handler: () => ({ text: 'not json' }),
        }),
      ],
      now: () => new Date('2026-04-26T12:00:00.000Z'),
    });

    await assert.rejects(
      runtime.generateJson({
        profile: profile({ role: 'claim_extractor' }),
        messages: [{ role: 'user', content: 'Extract claims.' }],
      }),
      (error) => {
        assert.ok(error instanceof LlmJsonOutputError);
        assert.equal(error.code, 'malformed_json');
        assert.equal(error.metadata.selected?.provider, 'fake');
        assert.equal(error.metadata.warnings[0].code, 'malformed_json');
        return true;
      },
    );
  });
});
