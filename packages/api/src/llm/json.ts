import type { LlmJsonValidator } from './types.js';

export type LlmJsonParseErrorCode = 'malformed_json' | 'validation_failed';

export interface LlmJsonParseFailure {
  code: LlmJsonParseErrorCode;
  message: string;
  outputPreview: string;
  details?: unknown;
}

export type LlmJsonParseResult<T> =
  | {
    ok: true;
    value: T;
    normalizedText: string;
  }
  | {
    ok: false;
    error: LlmJsonParseFailure;
  };

export function previewText(value: unknown, maxLength = 600): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

export function stripJsonMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return (fence?.[1] ?? trimmed).trim();
}

export function parseJsonOutput<T = unknown>(
  text: string,
  validate?: LlmJsonValidator<T>,
): LlmJsonParseResult<T> {
  const normalizedText = stripJsonMarkdownFence(text);
  let parsed: unknown;

  try {
    parsed = JSON.parse(normalizedText);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'malformed_json',
        message: error instanceof Error ? error.message : 'Model output was not valid JSON.',
        outputPreview: previewText(text),
      },
    };
  }

  if (!validate) {
    return {
      ok: true,
      value: parsed as T,
      normalizedText,
    };
  }

  try {
    return {
      ok: true,
      value: validate(parsed),
      normalizedText,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'validation_failed',
        message: error instanceof Error ? error.message : 'Model JSON output failed validation.',
        outputPreview: previewText(text),
        details: error,
      },
    };
  }
}
