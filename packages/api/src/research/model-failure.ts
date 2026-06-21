import { LlmJsonOutputError, LlmRuntimeError } from '../llm/types.js';

type ModelFailureStage = 'claim_extractor' | 'research_synthesizer';

function looksLikeRawValidationMessage(message: string): boolean {
  return message.includes('invalid_type')
    || message.includes('unrecognized_keys')
    || message.includes('Invalid input: expected')
    || message.includes('Unrecognized keys')
    || message.includes('source_urls')
    || message.includes('source_document_ids')
    || message.includes('uncertainty_label');
}

export function sanitizedModelFailureMessage(code: string, message: string): string {
  if (!looksLikeRawValidationMessage(message)) {
    return message;
  }
  if (code === 'MODEL_CLAIM_EXTRACTION_FAILED') {
    return 'Claim extraction failed for one or more sources because model output did not match the expected claim format. Claims and citations may be incomplete.';
  }
  if (code === 'MODEL_RESEARCH_SYNTHESIS_FAILED') {
    return 'Research synthesis failed because model output did not match the expected synthesis format. Review the generated claims and citations before drafting.';
  }
  return 'Model output did not match the expected research format. Review the generated evidence before drafting.';
}

export function sanitizeErrorMessage(message: string): string {
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

export function safeModelFailureDetails(
  error: unknown,
  stage: ModelFailureStage,
  sourceDocumentId?: string,
): Record<string, unknown> {
  const metadata = error instanceof LlmRuntimeError || error instanceof LlmJsonOutputError ? error.metadata : undefined;
  const attempts = Array.isArray(metadata?.attempts) ? metadata.attempts.map((attempt) => ({
    provider: attempt.provider,
    model: attempt.model,
    status: attempt.status,
    errorCode: attempt.error?.code,
    errorMessage: attempt.error?.message ? sanitizeErrorMessage(attempt.error.message) : undefined,
    retryable: attempt.error?.retryable,
  })) : [];

  return {
    modelStage: stage,
    sourceDocumentId,
    failureType: error instanceof LlmJsonOutputError ? error.code : error instanceof LlmRuntimeError ? 'runtime_error' : 'model_error',
    originalMessage: sanitizeErrorMessage(error instanceof Error ? error.message : 'Model invocation failed.'),
    attempts,
    selected: metadata?.selected ?? null,
    responseFormat: metadata?.responseFormat,
    rawOutputPreview: metadata?.rawOutputPreview,
    validationDetails: error instanceof LlmJsonOutputError ? error.details : undefined,
  };
}
