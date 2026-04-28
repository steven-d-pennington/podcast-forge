import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { canonicalizeUrl, cleanText, type SourceCandidate } from './candidate.js';

export interface ZaiWebResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type ZaiWebFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<ZaiWebResponse>;

export type ZaiWebCandidate = SourceCandidate;

interface ZaiWebSearchOptions {
  apiKey: string;
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  fetchImpl?: ZaiWebFetch;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

const ZAI_WEB_SEARCH_URL = 'https://api.z.ai/api/paas/v4/web_search';

function defaultFetch(url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) {
  return fetch(url, init) as Promise<ZaiWebResponse>;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function option(query: SourceQueryRecord, profile: SourceProfileRecord, key: string): unknown {
  return query.config[key] ?? profile.config[key];
}

function resolveCount(query: SourceQueryRecord, profile: SourceProfileRecord): number {
  return Math.min(asPositiveInteger(option(query, profile, 'count')) ?? 10, 50);
}

function resolveSearchEngine(query: SourceQueryRecord, profile: SourceProfileRecord): string {
  return asString(option(query, profile, 'searchEngine'))
    ?? asString(option(query, profile, 'search_engine'))
    ?? 'search-prime';
}

function resolveFreshness(query: SourceQueryRecord, profile: SourceProfileRecord): string | undefined {
  const value = query.freshness ?? profile.freshness ?? asString(option(query, profile, 'search_recency_filter'));

  switch (value) {
    case 'pd':
    case 'oneDay':
      return 'oneDay';
    case 'pw':
    case 'oneWeek':
      return 'oneWeek';
    case 'pm':
    case 'oneMonth':
      return 'oneMonth';
    case 'py':
    case 'oneYear':
      return 'oneYear';
    case 'noLimit':
      return 'noLimit';
    default:
      return value ?? undefined;
  }
}

function domainFilter(query: SourceQueryRecord, profile: SourceProfileRecord): string | undefined {
  const configured = asString(option(query, profile, 'search_domain_filter'));

  if (configured) {
    return configured;
  }

  const domains = [...profile.includeDomains, ...query.includeDomains]
    .map((domain) => domain.trim())
    .filter(Boolean);

  return domains[0];
}

function parsePublishedAt(value: unknown): Date | null {
  const candidate = asString(value);

  if (!candidate) {
    return null;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resultItems(payload: JsonObject): JsonObject[] {
  const direct = payload.search_result;
  const nested = asObject(payload.result).search_result;
  const fallback = payload.results;
  const items = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : Array.isArray(fallback) ? fallback : [];

  return items.map(asObject);
}

function mapResult(item: JsonObject, query: SourceQueryRecord, profile: SourceProfileRecord, search: JsonObject): ZaiWebCandidate | undefined {
  const title = asString(item.title);
  const url = asString(item.link) ?? asString(item.url);

  if (!title || !url) {
    return undefined;
  }

  return {
    title: cleanText(title),
    url,
    canonicalUrl: canonicalizeUrl(url),
    sourceName: asString(item.media) ?? asString(item.source) ?? null,
    summary: asString(item.content) ? cleanText(String(item.content)) : null,
    publishedAt: parsePublishedAt(item.publish_date ?? item.published_at ?? item.date),
    rawPayload: item,
    metadata: {
      provider: 'zai-web',
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
      refer: item.refer ?? null,
    },
  };
}

export async function searchZaiWeb(options: ZaiWebSearchOptions): Promise<ZaiWebCandidate[]> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const candidates: ZaiWebCandidate[] = [];

  for (const query of options.queries) {
    const searchEngine = resolveSearchEngine(query, options.profile);
    const count = resolveCount(query, options.profile);
    const recency = resolveFreshness(query, options.profile);
    const domain = domainFilter(query, options.profile);
    const body: Record<string, unknown> = {
      search_engine: searchEngine,
      search_query: query.query,
      count,
    };

    if (recency) {
      body.search_recency_filter = recency;
    }

    if (domain) {
      body.search_domain_filter = domain;
    }

    const response = await fetchImpl(ZAI_WEB_SEARCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (!response.ok) {
      throw new Error(`Z.AI web search failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }

    const payload = asObject(await response.json());
    const search = {
      searchEngine,
      count,
      recency: recency ?? null,
      domain: domain ?? null,
    };

    for (const item of resultItems(payload)) {
      const mapped = mapResult(item, query, options.profile, search);

      if (mapped) {
        candidates.push(mapped);
      }
    }
  }

  return candidates;
}
