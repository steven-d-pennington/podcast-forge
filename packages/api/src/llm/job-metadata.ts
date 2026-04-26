import type { LlmInvocationMetadata } from './types.js';

export function llmInvocationJobLog(metadata: LlmInvocationMetadata): Record<string, unknown> {
  return {
    at: metadata.finishedAt,
    level: metadata.selected ? 'info' : 'error',
    message: metadata.selected ? 'LLM invocation completed.' : 'LLM invocation failed.',
    llm: {
      profileId: metadata.profile.id,
      role: metadata.profile.role,
      selected: metadata.selected,
      latencyMs: metadata.latencyMs,
      usage: metadata.usage,
      cost: metadata.cost,
      attemptCount: metadata.attempts.length,
      warnings: metadata.warnings,
    },
  };
}

export function appendLlmInvocationToJobOutput(
  output: Record<string, unknown>,
  metadata: LlmInvocationMetadata,
): Record<string, unknown> {
  const current = Array.isArray(output.llmInvocations) ? output.llmInvocations : [];

  return {
    ...output,
    llmInvocations: [
      ...current,
      metadata,
    ],
  };
}
