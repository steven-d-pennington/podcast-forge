import { createHash } from 'node:crypto';

import { previewText } from './json.js';
import type {
  LlmProviderAdapter,
  LlmProviderRequest,
  LlmProviderResult,
  LlmUsage,
} from './types.js';
import { LlmProviderError } from './types.js';

type FakeHandler = (request: LlmProviderRequest) => Promise<LlmProviderResult> | LlmProviderResult;

export interface FakeLlmProviderOptions {
  provider?: string;
  handler?: FakeHandler;
  failures?: Record<string, { message?: string; retryable?: boolean; code?: string }>;
}

function countTokens(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function usageFor(request: LlmProviderRequest, text: string): LlmUsage {
  return {
    inputTokens: request.messages.reduce((sum, message) => sum + countTokens(message.content), 0),
    outputTokens: countTokens(text),
    totalTokens: request.messages.reduce((sum, message) => sum + countTokens(message.content), 0) + countTokens(text),
  };
}

export function createFakeLlmProvider(options: FakeLlmProviderOptions = {}): LlmProviderAdapter {
  const provider = options.provider ?? 'fake';

  return {
    provider,
    async generateText(request) {
      const failure = options.failures?.[request.attempt.model] ?? options.failures?.[`${request.attempt.provider}/${request.attempt.model}`];

      if (failure) {
        throw new LlmProviderError(
          failure.code ?? 'fake_failure',
          failure.message ?? `Fake provider failed for ${request.attempt.model}.`,
          failure.retryable ?? true,
        );
      }

      if (options.handler) {
        return options.handler(request);
      }

      const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
      const seed = `${request.attempt.role}:${request.attempt.provider}:${request.attempt.model}:${lastUserMessage}`;
      const text = request.responseFormat.type === 'json'
        ? JSON.stringify({
          provider: request.attempt.provider,
          model: request.attempt.model,
          role: request.attempt.role,
          digest: hash(seed),
        })
        : `Fake LLM response for ${request.attempt.role} using ${request.attempt.provider}/${request.attempt.model}: ${previewText(lastUserMessage, 120)}`;

      return {
        text,
        usage: usageFor(request, text),
        cost: { usd: 0, currency: 'USD' },
        rawOutput: text,
        metadata: {
          adapter: 'fake',
          deterministic: true,
          digest: hash(seed),
        },
      };
    },
  };
}

export interface OpenAiCompatibleProviderOptions {
  provider?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiCompatibleUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAiCompatibleResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: OpenAiCompatibleUsage;
}

function envValue(name: string | undefined): string | undefined {
  return name ? process.env[name] : undefined;
}

function messageContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => item.text).filter((text): text is string => Boolean(text)).join('\n');
  }

  return '';
}

function additionalOpenAiCompatibleParams(params: Record<string, unknown>): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {};
  const allowed = [
    'thinking',
    'top_p',
    'do_sample',
    'presence_penalty',
    'frequency_penalty',
    'stop',
    'user',
    'request_id',
    'tool_stream',
  ];

  for (const key of allowed) {
    if (params[key] !== undefined) {
      forwarded[key] = params[key];
    }
  }

  return forwarded;
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleProviderOptions = {}): LlmProviderAdapter {
  const provider = options.provider ?? 'openai';

  return {
    provider,
    async generateText(request) {
      const apiKey = options.apiKey ?? envValue(options.apiKeyEnv ?? 'OPENAI_API_KEY');

      if (!apiKey) {
        throw new LlmProviderError('not_configured', `${provider} provider is missing an API key.`, true);
      }

      const baseUrl = (options.baseUrl ?? envValue(options.baseUrlEnv ?? 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...additionalOpenAiCompatibleParams(request.attempt.params),
          model: request.attempt.model,
          messages: request.messages,
          temperature: request.attempt.params.temperature,
          max_tokens: request.attempt.params.maxTokens,
          response_format: request.responseFormat.type === 'json' ? { type: 'json_object' } : undefined,
        }),
      });

      if (!response.ok) {
        throw new LlmProviderError(
          'provider_http_error',
          `${provider} provider returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500,
          { status: response.status },
        );
      }

      const data = await response.json() as OpenAiCompatibleResponse;
      const text = messageContent(data.choices?.[0]?.message?.content);

      if (!text) {
        throw new LlmProviderError('empty_response', `${provider} provider returned no text.`, true);
      }

      return {
        text,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
          totalTokens: data.usage?.total_tokens ?? null,
        },
        cost: { usd: null, currency: 'USD' },
        rawOutput: data,
        metadata: {
          adapter: 'openai-compatible',
          responseId: data.id,
        },
      };
    },
  };
}

export function createDefaultLlmProviders(): LlmProviderAdapter[] {
  const openAiProvider = createOpenAiCompatibleProvider({ provider: 'openai' });

  return [
    createFakeLlmProvider(),
    openAiProvider,
    createOpenAiCompatibleProvider({ provider: 'openai-compatible' }),
  ];
}
