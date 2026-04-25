import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { canonicalizeUrl, cleanText, normalizeTitle, type SourceCandidate } from './candidate.js';

export interface BraveResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type BraveFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<BraveResponse>;

export type BraveCandidate = SourceCandidate;

interface BraveSearchOptions {
  apiKey: string;
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  fetchImpl?: BraveFetch;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

const BRAVE_NEWS_SEARCH_URL = 'https://api.search.brave.com/res/v1/news/search';

function defaultFetch(url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) {
  return fetch(url, init) as Promise<BraveResponse>;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export { canonicalizeUrl, normalizeTitle };

function parsePublishedAt(item: JsonObject): Date | null {
  const candidates = [item.page_age, item.age, item.published, item.published_time, item.date];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue;
    }

    const parsed = new Date(candidate);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function queryOption(query: SourceQueryRecord, profile: SourceProfileRecord, key: string): string | undefined {
  return asString(query.config[key]) ?? asString(profile.config[key]);
}

function resolveCount(query: SourceQueryRecord, profile: SourceProfileRecord): number {
  return asPositiveInteger(query.config.count) ?? asPositiveInteger(profile.config.count) ?? 5;
}

function resolveFreshness(query: SourceQueryRecord, profile: SourceProfileRecord): string {
  return query.freshness
    ?? profile.freshness
    ?? asString(query.config.freshness)
    ?? asString(profile.config.freshness)
    ?? 'pd';
}

function resolveRegion(query: SourceQueryRecord, profile: SourceProfileRecord): string | undefined {
  return query.region ?? queryOption(query, profile, 'region') ?? queryOption(query, profile, 'country');
}

function resolveLanguage(query: SourceQueryRecord, profile: SourceProfileRecord): string | undefined {
  return query.language ?? queryOption(query, profile, 'language') ?? queryOption(query, profile, 'search_lang');
}

function sourceNameFor(item: JsonObject): string | null {
  const metaUrl = asObject(item.meta_url);
  return asString(metaUrl.hostname)
    ?? asString(metaUrl.netloc)
    ?? asString(item.source)
    ?? null;
}

function mapResult(item: JsonObject, query: SourceQueryRecord, profile: SourceProfileRecord, search: JsonObject): BraveCandidate | undefined {
  const title = asString(item.title);
  const url = asString(item.url);

  if (!title || !url) {
    return undefined;
  }

  return {
    title: cleanText(title),
    url,
    canonicalUrl: canonicalizeUrl(url),
    sourceName: sourceNameFor(item),
    summary: asString(item.description) ? cleanText(String(item.description)) : null,
    publishedAt: parsePublishedAt(item),
    rawPayload: item,
    metadata: {
      provider: 'brave',
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

export async function searchBraveNews(options: BraveSearchOptions): Promise<BraveCandidate[]> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const candidates: BraveCandidate[] = [];

  for (const query of options.queries) {
    const count = resolveCount(query, options.profile);
    const freshness = resolveFreshness(query, options.profile);
    const region = resolveRegion(query, options.profile);
    const language = resolveLanguage(query, options.profile);
    const params = new URLSearchParams({
      q: query.query,
      count: String(count),
      freshness,
    });

    if (region) {
      params.set('country', region);
    }

    if (language) {
      params.set('search_lang', language);
    }

    const response = await fetchImpl(`${BRAVE_NEWS_SEARCH_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': options.apiKey,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }

    const payload = asObject(await response.json());
    const results = Array.isArray(payload.results) ? payload.results : [];
    const search = {
      count,
      freshness,
      region: region ?? null,
      language: language ?? null,
    };

    for (const result of results) {
      const mapped = mapResult(asObject(result), query, options.profile, search);

      if (mapped) {
        candidates.push(mapped);
      }
    }
  }

  return candidates;
}
