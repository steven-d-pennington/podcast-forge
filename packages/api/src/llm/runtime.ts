import { parseJsonOutput, previewText } from './json.js';
import { createDefaultLlmProviders } from './providers.js';
import type {
  LlmAttemptMetadata,
  LlmCost,
  LlmInvocationMetadata,
  LlmJsonRequest,
  LlmJsonResult,
  LlmModelAttempt,
  LlmProviderAdapter,
  LlmProviderResult,
  LlmResponseFormat,
  LlmRuntime,
  LlmTextRequest,
  LlmTextResult,
  LlmUsage,
  LlmWarning,
} from './types.js';
import { LlmJsonOutputError, LlmProviderError, LlmRuntimeError } from './types.js';

export interface LlmRuntimeOptions {
  adapters?: LlmProviderAdapter[];
  now?: () => Date;
}

const emptyUsage: LlmUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
};

const emptyCost: LlmCost = {
  usd: null,
  currency: 'USD',
};

function mergeUsage(current: LlmUsage, next: LlmUsage): LlmUsage {
  return {
    inputTokens: sumNullable(current.inputTokens, next.inputTokens),
    outputTokens: sumNullable(current.outputTokens, next.outputTokens),
    totalTokens: sumNullable(current.totalTokens, next.totalTokens),
  };
}

function mergeCost(current: LlmCost, next: LlmCost): LlmCost {
  return {
    usd: sumNullable(current.usd, next.usd),
    currency: 'USD',
  };
}

function sumNullable(current: number | null, next: number | null): number | null {
  if (current === null) {
    return next;
  }

  if (next === null) {
    return current;
  }

  return current + next;
}

function normalizeUsage(value: LlmProviderResult['usage']): LlmUsage {
  return {
    inputTokens: value?.inputTokens ?? null,
    outputTokens: value?.outputTokens ?? null,
    totalTokens: value?.totalTokens ?? null,
  };
}

function normalizeCost(value: LlmProviderResult['cost']): LlmCost {
  return {
    usd: value?.usd ?? null,
    currency: 'USD',
  };
}

function errorDetails(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof LlmProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: 'provider_error',
    message: error instanceof Error ? error.message : 'LLM provider failed.',
    retryable: true,
  };
}

function fallbackAttempt(primary: LlmModelAttempt, fallback: string, fallbackIndex: number): LlmModelAttempt {
  const providerModel = fallback.match(/^([^/:]+)[/:](.+)$/);
  const provider = providerModel?.[1] ?? primary.provider;
  const model = providerModel?.[2] ?? fallback;

  return {
    ...primary,
    provider,
    model,
    fallbackOf: `${primary.provider}/${primary.model}`,
    fallbackIndex,
  };
}

function attemptsFor(request: LlmTextRequest): LlmModelAttempt[] {
  const primary: LlmModelAttempt = {
    profileId: request.profile.id,
    role: request.profile.role,
    provider: request.profile.provider,
    model: request.profile.model,
    params: request.profile.params,
    promptTemplateKey: request.profile.promptTemplateKey,
    budgetUsd: request.profile.budgetUsd,
  };

  return [
    primary,
    ...request.profile.fallbacks.map((fallback, index) => fallbackAttempt(primary, fallback, index)),
  ];
}

function providerMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function millisSince(start: number, now: () => Date): number {
  return Math.max(0, now().getTime() - start);
}

function baseMetadata(
  request: LlmTextRequest,
  responseFormat: LlmResponseFormat,
  startedAt: string,
  finishedAt: string,
  latencyMs: number,
  attempts: LlmAttemptMetadata[],
  requestMetadata: Record<string, unknown>,
  selected: LlmInvocationMetadata['selected'],
  rawOutputPreview?: string,
): LlmInvocationMetadata {
  const usage = attempts.reduce((current, attempt) => mergeUsage(current, attempt.usage), emptyUsage);
  const cost = attempts.reduce((current, attempt) => mergeCost(current, attempt.cost), emptyCost);
  const warnings = attempts.flatMap((attempt) => attempt.warnings);

  return {
    profile: {
      id: request.profile.id,
      role: request.profile.role,
      provider: request.profile.provider,
      model: request.profile.model,
      version: request.profile.version,
      promptTemplateKey: request.profile.promptTemplateKey,
      budgetUsd: request.profile.budgetUsd,
      fallbackCount: request.profile.fallbacks.length,
    },
    selected,
    responseFormat,
    startedAt,
    finishedAt,
    latencyMs,
    attempts,
    warnings,
    usage,
    cost,
    requestMetadata,
    rawOutputPreview,
  };
}

function shouldTryFallback(error: unknown, hasFallback: boolean): boolean {
  if (!hasFallback) {
    return false;
  }

  if (error instanceof LlmProviderError) {
    return error.retryable || error.code === 'not_configured' || error.code === 'provider_not_registered';
  }

  return true;
}

export function createLlmRuntime(options: LlmRuntimeOptions = {}): LlmRuntime {
  const adapters = new Map((options.adapters ?? createDefaultLlmProviders()).map((adapter) => [adapter.provider, adapter]));
  const now = options.now ?? (() => new Date());

  return {
    async generateText(request) {
      const responseFormat = request.responseFormat ?? { type: 'text' };
      const requestMetadata = request.requestMetadata ?? {};
      const invocationStartedAt = nowIso(now);
      const invocationStartMs = now().getTime();
      const attemptMetadata: LlmAttemptMetadata[] = [];
      const attempts = attemptsFor(request);

      for (const [index, attempt] of attempts.entries()) {
        const adapter = adapters.get(attempt.provider);
        const attemptStartedAt = nowIso(now);
        const attemptStartMs = now().getTime();

        if (!adapter) {
          const error = new LlmProviderError('provider_not_registered', `No LLM provider adapter is registered for ${attempt.provider}.`, true);
          const attemptFinishedAt = nowIso(now);
          attemptMetadata.push({
            profileId: attempt.profileId,
            role: attempt.role,
            provider: attempt.provider,
            model: attempt.model,
            status: 'skipped',
            startedAt: attemptStartedAt,
            finishedAt: attemptFinishedAt,
            latencyMs: millisSince(attemptStartMs, now),
            fallbackOf: attempt.fallbackOf,
            fallbackIndex: attempt.fallbackIndex,
            usage: emptyUsage,
            cost: emptyCost,
            error: errorDetails(error),
            warnings: [],
            providerMetadata: {},
          });

          if (shouldTryFallback(error, index < attempts.length - 1)) {
            continue;
          }

          break;
        }

        try {
          const result = await adapter.generateText({
            attempt,
            messages: request.messages,
            responseFormat,
            requestMetadata,
          });
          const attemptFinishedAt = nowIso(now);
          const rawOutputPreview = previewText(result.rawOutput ?? result.text);
          const usage = normalizeUsage(result.usage);
          const cost = normalizeCost(result.cost);
          const warnings: LlmWarning[] = result.warnings ?? [];

          attemptMetadata.push({
            profileId: attempt.profileId,
            role: attempt.role,
            provider: attempt.provider,
            model: attempt.model,
            status: 'succeeded',
            startedAt: attemptStartedAt,
            finishedAt: attemptFinishedAt,
            latencyMs: millisSince(attemptStartMs, now),
            fallbackOf: attempt.fallbackOf,
            fallbackIndex: attempt.fallbackIndex,
            usage,
            cost,
            warnings,
            rawOutputPreview,
            providerMetadata: providerMetadata(result.metadata),
          });

          return {
            text: result.text,
            metadata: baseMetadata(
              request,
              responseFormat,
              invocationStartedAt,
              nowIso(now),
              millisSince(invocationStartMs, now),
              attemptMetadata,
              requestMetadata,
              {
                provider: attempt.provider,
                model: attempt.model,
                fallbackIndex: attempt.fallbackIndex ?? null,
              },
              rawOutputPreview,
            ),
          };
        } catch (error) {
          const details = errorDetails(error);
          const attemptFinishedAt = nowIso(now);
          attemptMetadata.push({
            profileId: attempt.profileId,
            role: attempt.role,
            provider: attempt.provider,
            model: attempt.model,
            status: 'failed',
            startedAt: attemptStartedAt,
            finishedAt: attemptFinishedAt,
            latencyMs: millisSince(attemptStartMs, now),
            fallbackOf: attempt.fallbackOf,
            fallbackIndex: attempt.fallbackIndex,
            usage: emptyUsage,
            cost: emptyCost,
            error: details,
            warnings: [],
            providerMetadata: error instanceof LlmProviderError ? error.metadata : {},
          });

          if (shouldTryFallback(error, index < attempts.length - 1)) {
            continue;
          }

          break;
        }
      }

      const metadata = baseMetadata(
        request,
        responseFormat,
        invocationStartedAt,
        nowIso(now),
        millisSince(invocationStartMs, now),
        attemptMetadata,
        requestMetadata,
        null,
      );
      const tried = attemptMetadata.map((attempt) => `${attempt.provider}/${attempt.model}:${attempt.status}`).join(', ');
      throw new LlmRuntimeError(`LLM invocation failed. Attempts: ${tried}`, metadata);
    },

    async generateJson<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
      const textResult = await this.generateText({
        ...request,
        responseFormat: {
          type: 'json',
          schemaName: request.schemaName,
          schemaHint: request.schemaHint,
        },
      });
      const parsed = parseJsonOutput<T>(textResult.text, request.validate);

      if (!parsed.ok) {
        const metadata: LlmInvocationMetadata = {
          ...textResult.metadata,
          warnings: [
            ...textResult.metadata.warnings,
            {
              code: parsed.error.code,
              message: parsed.error.message,
              metadata: {
                outputPreview: parsed.error.outputPreview,
              },
            },
          ],
          rawOutputPreview: parsed.error.outputPreview,
        };

        throw new LlmJsonOutputError(parsed.error.code, parsed.error.message, metadata, parsed.error.details);
      }

      return {
        ...textResult,
        value: parsed.value,
        metadata: {
          ...textResult.metadata,
          validatedOutputPreview: previewText(parsed.value),
        },
      };
    },
  };
}
