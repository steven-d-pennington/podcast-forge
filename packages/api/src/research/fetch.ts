import { canonicalizeUrl, decodeBasicEntities } from '../search/candidate.js';
import type { CreateSourceDocumentInput } from './store.js';

export interface ResearchFetchResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export type ResearchFetch = (url: string) => Promise<ResearchFetchResponse>;

const MAX_SOURCE_CHARS = 200_000;

function defaultFetch(): ResearchFetch {
  if (!globalThis.fetch) {
    throw new Error('No fetch implementation is available.');
  }

  return globalThis.fetch.bind(globalThis) as ResearchFetch;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripUnsafeBlocks(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? normalizeWhitespace(decodeBasicEntities(stripTags(match[1] ?? ''))) : '';
  return title || null;
}

export function extractReadableContent(html: string): { title: string | null; text: string } {
  const withoutBlocks = stripUnsafeBlocks(html);
  const bodyMatch = withoutBlocks.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? withoutBlocks;
  const text = normalizeWhitespace(decodeBasicEntities(stripTags(body)));

  return {
    title: extractTitle(withoutBlocks),
    text,
  };
}

function contentTypeFrom(response: ResearchFetchResponse): string | null {
  return response.headers?.get('content-type') ?? response.headers?.get('Content-Type') ?? null;
}

export async function fetchSourceSnapshot(
  storyCandidateId: string | null,
  url: string,
  fetchImpl: ResearchFetch = defaultFetch(),
): Promise<CreateSourceDocumentInput> {
  const fetchedAt = new Date();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return {
      storyCandidateId,
      url,
      canonicalUrl: null,
      title: null,
      fetchedAt,
      fetchStatus: 'failed',
      httpStatus: null,
      contentType: null,
      textContent: null,
      metadata: {
        error: error instanceof Error ? error.message : 'Invalid URL.',
      },
    };
  }

  try {
    const response = await fetchImpl(parsedUrl.toString());
    const contentType = contentTypeFrom(response);

    if (!response.ok) {
      return {
        storyCandidateId,
        url: parsedUrl.toString(),
        canonicalUrl: canonicalizeUrl(parsedUrl.toString()),
        title: null,
        fetchedAt,
        fetchStatus: 'failed',
        httpStatus: response.status,
        contentType,
        textContent: null,
        metadata: { error: `HTTP ${response.status}` },
      };
    }

    const rawText = (await response.text()).slice(0, MAX_SOURCE_CHARS);
    const extracted = extractReadableContent(rawText);

    return {
      storyCandidateId,
      url: parsedUrl.toString(),
      canonicalUrl: canonicalizeUrl(parsedUrl.toString()),
      title: extracted.title,
      fetchedAt,
      fetchStatus: 'fetched',
      httpStatus: response.status,
      contentType,
      textContent: extracted.text,
      metadata: {
        originalLength: rawText.length,
      },
    };
  } catch (error) {
    return {
      storyCandidateId,
      url: parsedUrl.toString(),
      canonicalUrl: canonicalizeUrl(parsedUrl.toString()),
      title: null,
      fetchedAt,
      fetchStatus: 'failed',
      httpStatus: null,
      contentType: null,
      textContent: null,
      metadata: {
        error: error instanceof Error ? error.message : 'Source fetch failed.',
      },
    };
  }
}
