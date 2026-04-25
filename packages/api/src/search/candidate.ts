export interface SourceCandidate {
  title: string;
  url: string;
  canonicalUrl: string;
  sourceName: string | null;
  summary: string | null;
  publishedAt: Date | null;
  rawPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function decodeBasicEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

export function cleanText(value: string): string {
  return decodeBasicEntities(stripHtml(value));
}

export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();

    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

export function normalizeTitle(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleCase(value: string): string {
  return value.replace(/\b[\p{L}\p{N}]/gu, (match) => match.toUpperCase());
}

export function readableTitleFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    const lastSegment = segments.at(-1)?.replace(/\.[a-z0-9]{2,5}$/i, '') ?? '';
    const text = decodeURIComponent(lastSegment)
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text ? titleCase(text) : url.hostname;
  } catch {
    return value.trim();
  }
}
