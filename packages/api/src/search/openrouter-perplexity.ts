import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { canonicalizeUrl, cleanText, type SourceCandidate } from './candidate.js';

export interface OpenRouterPerplexityResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type OpenRouterPerplexityFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<OpenRouterPerplexityResponse>;

export type OpenRouterPerplexityCandidate = SourceCandidate;

type JsonObject = Record<string, unknown>;

interface OpenRouterPerplexitySearchOptions {
  apiKey: string;
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  fetchImpl?: OpenRouterPerplexityFetch;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'perplexity/sonar';
const DEFAULT_TOP_N = 5;
const DEFAULT_DENY_DOMAINS = ['youtube.com', 'reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com'];

function defaultFetch(url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) {
  return fetch(url, init) as Promise<OpenRouterPerplexityResponse>;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function option(query: SourceQueryRecord, profile: SourceProfileRecord, key: string): unknown {
  return query.config[key] ?? profile.config[key];
}

function resolveModel(profile: SourceProfileRecord): string {
  return asString(profile.config.model) ?? asString(profile.config.openrouterModel) ?? DEFAULT_MODEL;
}

function resolveEndpoint(_profile: SourceProfileRecord): string {
  const configured = asString(process.env.OPENROUTER_BASE_URL) ?? DEFAULT_ENDPOINT;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.hostname !== 'openrouter.ai') {
    throw new Error('OpenRouter Perplexity endpoint must use https://openrouter.ai');
  }
  return url.toString();
}

function resolveTopN(query: SourceQueryRecord, profile: SourceProfileRecord): number {
  return Math.min(asPositiveInteger(option(query, profile, 'topN')) ?? asPositiveInteger(option(query, profile, 'count')) ?? DEFAULT_TOP_N, 10);
}

function recencyFor(query: SourceQueryRecord, profile: SourceProfileRecord): string | undefined {
  const value = asString(option(query, profile, 'search_recency_filter')) ?? query.freshness ?? profile.freshness ?? undefined;
  switch (value) {
    case 'pd': return 'day';
    case 'pw': return 'week';
    case 'pm': return 'month';
    case 'py': return 'year';
    default: return value;
  }
}

function normalizeDeniedDomain(domain: string): string | undefined {
  const trimmed = domain.trim();
  if (!trimmed) return undefined;
  const denied = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
  const normalized = denied.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase();
  return normalized ? `-${normalized}` : undefined;
}

function searchDomainFilterFor(query: SourceQueryRecord, profile: SourceProfileRecord): string[] {
  const configured = option(query, profile, 'search_domain_filter');
  const configuredArray = asStringArray(configured);
  if (configuredArray.length > 0) return configuredArray;
  const configuredString = asString(configured);
  return configuredString ? [configuredString] : [];
}

function denyDomainsFor(query: SourceQueryRecord, profile: SourceProfileRecord): string[] {
  const configured = searchDomainFilterFor(query, profile);
  const domains = configured.length > 0 ? configured : [...DEFAULT_DENY_DOMAINS, ...profile.excludeDomains, ...query.excludeDomains];
  return [...new Set(domains.map(normalizeDeniedDomain).filter((domain): domain is string => Boolean(domain)))];
}

function parsePublishedAt(value: unknown): Date | null {
  const candidate = asString(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hostname(value: string): string | null {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

function isHomepage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname === '/' || url.pathname === '';
  } catch {
    return false;
  }
}

function isDeniedUrl(value: string, denied: string[]): boolean {
  const host = hostname(value);
  if (!host) return false;
  return denied
    .map((domain) => domain.replace(/^-/, '').replace(/^www\./, '').toLowerCase())
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function citationUrls(message: JsonObject): Array<{ url: string; title?: string }> {
  const annotations = Array.isArray(message.annotations) ? message.annotations.map(asObject) : [];
  return annotations.flatMap((annotation) => {
    if (annotation.type !== 'url_citation') return [];
    const citation = asObject(annotation.url_citation);
    const url = asString(citation.url);
    return url && isHttpUrl(url) ? [{ url, title: asString(citation.title) }] : [];
  });
}

function buildPrompt(query: SourceQueryRecord, profile: SourceProfileRecord, topN: number): string {
  return [
    `Curate at most ${topN} high-signal story candidates for a podcast episode.`,
    `Search query: ${query.query}`,
    `Source profile: ${profile.name}`,
    'Prefer canonical article or official announcement URLs over homepages, social posts, videos, and aggregator list pages.',
    'Return JSON only matching the schema. Use null when a publication date is not available. Treat freshness as claimed unless independently verified.'
  ].join('\n');
}

function responseSchema() {
  return {
    name: 'podcast_forge_story_candidates',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              sourceName: { type: ['string', 'null'] },
              summary: { type: ['string', 'null'] },
              publishedAt: { type: ['string', 'null'] },
              freshnessConfidence: { type: ['string', 'null'] },
              citations: { type: 'array', items: { type: 'string' } },
              rationale: { type: ['string', 'null'] }
            },
            required: ['title', 'url']
          }
        }
      },
      required: ['candidates']
    }
  };
}

function parseCandidates(payload: JsonObject): JsonObject[] {
  const choices = Array.isArray(payload.choices) ? payload.choices.map(asObject) : [];
  const message = asObject(choices[0]?.message);
  const content = asString(message.content) ?? '{}';
  let parsed: JsonObject = {};
  try {
    parsed = asObject(JSON.parse(content));
  } catch (error) {
    const preview = content.slice(0, 240);
    throw new Error(`OpenRouter Perplexity returned invalid candidate JSON: ${error instanceof Error ? error.message : 'parse failed'}; preview=${preview}`);
  }
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.map(asObject) : [];
  const annotations = citationUrls(message);
  return candidates.map((candidate) => ({ ...candidate, __annotations: annotations }));
}

function mapCandidate(item: JsonObject, query: SourceQueryRecord, profile: SourceProfileRecord, search: JsonObject): OpenRouterPerplexityCandidate | undefined {
  const title = asString(item.title);
  const url = asString(item.url) ?? asString(item.canonicalUrl);
  if (!title || !url) return undefined;
  const citations = [
    ...asStringArray(item.citations),
    ...asStringArray(item.evidenceUrls),
    ...(Array.isArray(item.__annotations) ? item.__annotations.map(asObject).map((citation) => asString(citation.url)).filter((value): value is string => Boolean(value)) : []),
  ].filter(isHttpUrl);
  const publishedAt = parsePublishedAt(item.publishedAt ?? item.date ?? item.publicationDate);
  return {
    title: cleanText(title),
    url,
    canonicalUrl: canonicalizeUrl(url),
    sourceName: asString(item.sourceName) ?? asString(item.source) ?? hostname(url),
    summary: asString(item.summary) ?? asString(item.rationale) ?? null,
    publishedAt,
    rawPayload: item,
    metadata: {
      provider: 'openrouter-perplexity',
      freshness: {
        requested: search.recency ?? null,
        confidence: asString(item.freshnessConfidence) ?? (publishedAt ? 'claimed' : 'unknown'),
        verified: false,
      },
      citations: [...new Set(citations)],
      query: {
        id: query.id,
        text: query.query,
        origin: {
          sourceProfileId: profile.id,
          sourceProfileSlug: profile.slug,
          sourceQueryId: query.id,
        },
      },
      search,
    },
  };
}

export async function searchOpenRouterPerplexity(options: OpenRouterPerplexitySearchOptions): Promise<OpenRouterPerplexityCandidate[]> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const candidates: OpenRouterPerplexityCandidate[] = [];
  const model = resolveModel(options.profile);
  const endpoint = resolveEndpoint(options.profile);

  for (const query of options.queries) {
    const topN = resolveTopN(query, options.profile);
    const recency = recencyFor(query, options.profile);
    const domainFilter = denyDomainsFor(query, options.profile);
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: buildPrompt(query, options.profile, topN) }],
      temperature: 0.1,
      max_tokens: asPositiveInteger(option(query, options.profile, 'maxTokens')) ?? 1600,
      response_format: { type: 'json_schema', json_schema: responseSchema() },
      search_domain_filter: domainFilter,
    };
    if (recency) body.search_recency_filter = recency;
    const language = query.language ?? asString(option(query, options.profile, 'language'));
    if (language) body.search_language_filter = [language];
    const country = query.region ?? asString(option(query, options.profile, 'country'));
    if (country) body.web_search_options = { user_location: { country } };

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': asString(options.profile.config.httpReferer) ?? 'http://localhost:3450',
        'X-Title': asString(options.profile.config.title) ?? 'Podcast Forge',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter Perplexity search failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    const payload = asObject(await response.json());
    const search = { model, topN, recency: recency ?? null, domainFilter, cost: asObject(payload.usage).cost ?? null };
    const mapped = parseCandidates(payload)
      .map((item) => mapCandidate(item, query, options.profile, search))
      .filter((candidate): candidate is OpenRouterPerplexityCandidate => Boolean(candidate))
      .filter((candidate) => !isHomepage(candidate.canonicalUrl))
      .filter((candidate) => !isDeniedUrl(candidate.canonicalUrl, domainFilter))
      .slice(0, topN);
    candidates.push(...mapped);
  }
  return candidates;
}
