import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';
import { canonicalizeUrl, cleanText, decodeBasicEntities, type SourceCandidate } from './candidate.js';

export interface RssResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}

export type RssFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<RssResponse>;

export type RssCandidate = SourceCandidate;

interface FeedRef {
  url: string;
  query: SourceQueryRecord | null;
}

interface RssIngestOptions {
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  fetchImpl?: RssFetch;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

function defaultFetch(url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) {
  return fetch(url, init) as Promise<RssResponse>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function decodeXml(value: string): string {
  return decodeBasicEntities(value)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function cleanXmlText(value: string): string {
  return cleanText(decodeXml(stripCdata(value).trim()));
}

function extractBlocks(xml: string): string[] {
  const blocks: string[] = [];

  for (const tag of ['item', 'entry']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(xml))) {
      blocks.push(match[1]);
    }
  }

  return blocks;
}

function extractTag(xml: string, tag: string): string | undefined {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, 'i');
  const match = pattern.exec(xml);
  return match?.[1] ? cleanXmlText(match[1]) : undefined;
}

function extractAttribute(tagText: string, attribute: string): string | undefined {
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, 'i');
  return pattern.exec(tagText)?.[1];
}

function extractLink(block: string): string | undefined {
  const atomLink = /<(?:[\w.-]+:)?link\b([^>]*)\/?>/i.exec(block);
  const href = atomLink?.[1] ? extractAttribute(atomLink[1], 'href') : undefined;

  if (href) {
    return decodeXml(href.trim());
  }

  const link = extractTag(block, 'link');

  if (link) {
    return link;
  }

  const guid = extractTag(block, 'guid');
  return guid && /^https?:\/\//i.test(guid) ? guid : undefined;
}

function parseDate(block: string): Date | null {
  const candidates = [
    extractTag(block, 'pubDate'),
    extractTag(block, 'published'),
    extractTag(block, 'updated'),
    extractTag(block, 'date'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function sourceNameFor(xml: string, profile: SourceProfileRecord, feedUrl: string): string {
  return extractTag(xml, 'title') ?? profile.name ?? new URL(feedUrl).hostname;
}

function queryConfigFeedUrls(profile: SourceProfileRecord): string[] {
  return [
    asString(profile.config.feedUrl),
    ...asStringArray(profile.config.feedUrls),
  ].filter((url): url is string => Boolean(url));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveRssFeedRefs(profile: SourceProfileRecord, queries: SourceQueryRecord[]): FeedRef[] {
  const refs = [
    ...queries.map((query) => ({ url: query.query.trim(), query })),
    ...queryConfigFeedUrls(profile).map((url) => ({ url: url.trim(), query: null })),
  ];
  const seen = new Set<string>();

  return refs.filter((ref) => {
    if (!isHttpUrl(ref.url)) {
      return false;
    }

    const canonical = canonicalizeUrl(ref.url);

    if (seen.has(canonical)) {
      return false;
    }

    seen.add(canonical);
    return true;
  });
}

function mapItem(block: string, xml: string, profile: SourceProfileRecord, feed: FeedRef): RssCandidate | undefined {
  const title = extractTag(block, 'title');
  const url = extractLink(block);

  if (!title || !url) {
    return undefined;
  }

  return {
    title,
    url,
    canonicalUrl: canonicalizeUrl(url),
    sourceName: sourceNameFor(xml, profile, feed.url),
    summary: extractTag(block, 'description') ?? extractTag(block, 'summary') ?? extractTag(block, 'encoded') ?? null,
    publishedAt: parseDate(block),
    rawPayload: {
      title,
      url,
      summary: extractTag(block, 'description') ?? extractTag(block, 'summary') ?? null,
      publishedAt: parseDate(block)?.toISOString() ?? null,
      feedUrl: feed.url,
    },
    metadata: {
      provider: 'rss',
      feedUrl: feed.url,
      query: feed.query ? {
        id: feed.query.id,
        text: feed.query.query,
        origin: {
          sourceProfileId: profile.id,
          sourceProfileSlug: profile.slug,
          sourceQueryId: feed.query.id,
        },
      } : null,
    },
  };
}

export async function fetchRssCandidates(options: RssIngestOptions): Promise<RssCandidate[]> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const candidates: RssCandidate[] = [];

  for (const feed of resolveRssFeedRefs(options.profile, options.queries)) {
    const response = await fetchImpl(feed.url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed for ${feed.url} with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }

    const xml = await response.text();

    for (const block of extractBlocks(xml)) {
      const mapped = mapItem(block, xml, options.profile, feed);

      if (mapped) {
        candidates.push(mapped);
      }
    }
  }

  return candidates;
}
