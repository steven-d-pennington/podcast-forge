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
const MAX_EXTRACT_INPUT_CHARS = 500_000;
const READABLE_CONTAINERS = ['article', 'main'];

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
    .replace(/<script\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

function stripChromeBlocks(value: string): string {
  return value
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, ' ')
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
}

function candidateContainerHtml(html: string): string[] {
  const candidates: string[] = [];

  for (const tag of READABLE_CONTAINERS) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const match of html.matchAll(pattern)) {
      if (match[1]) {
        candidates.push(match[1]);
      }
    }
  }

  return candidates;
}

function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

function cleanVisibleText(value: string): string {
  const decoded = decodeBasicEntities(stripTags(value));
  const lines = decoded
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => {
      if (line.length < 2) {
        return false;
      }
      if (/\b(window\.__|__ROUTES__|webpackJsonp|dataLayer|function\s*\(|var\s+|const\s+|let\s+)\b/i.test(line)) {
        return false;
      }
      const cssTokenCount = (line.match(/[{};:]|--[a-z0-9-]+|#[0-9a-f]{3,8}\b/gi) ?? []).length;
      return !(cssTokenCount >= 6 && cssTokenCount > line.split(/\s+/).length / 3);
    });

  return normalizeWhitespace(lines.join('\n'));
}

function scoreReadableText(value: string): number {
  const words = value.split(/\s+/).filter(Boolean).length;
  const sentences = (value.match(/[.!?](\s|$)/g) ?? []).length;
  const chromeHits = (value.match(/\b(subscribe|sign in|privacy policy|advertisement|latest|newsletter)\b/gi) ?? []).length;
  return words + sentences * 15 - chromeHits * 25;
}

function selectReadableHtml(body: string): string {
  const strippedBody = stripChromeBlocks(body);
  const candidates = candidateContainerHtml(strippedBody)
    .map((candidate) => stripChromeBlocks(candidate));

  if (candidates.length === 0) {
    return strippedBody;
  }

  let bestHtml = strippedBody;
  let bestScore = scoreReadableText(cleanVisibleText(strippedBody));

  for (const candidate of candidates) {
    const text = cleanVisibleText(candidate);
    const score = scoreReadableText(text);
    if (text.length >= 120 && score >= bestScore * 0.45) {
      bestHtml = candidate;
      bestScore = score;
    }
  }

  return bestHtml;
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
  const readableHtml = selectReadableHtml(body);
  const text = cleanVisibleText(readableHtml).slice(0, MAX_SOURCE_CHARS);

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

    const rawText = await response.text();
    const extractionInput = rawText.length > MAX_EXTRACT_INPUT_CHARS
      ? rawText.slice(0, MAX_EXTRACT_INPUT_CHARS)
      : rawText;
    const extracted = extractReadableContent(extractionInput);

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
        extractionInputLength: extractionInput.length,
        truncatedBeforeExtraction: rawText.length > extractionInput.length,
        extractedLength: extracted.text.length,
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
