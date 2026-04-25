import { canonicalizeUrl, normalizeTitle, readableTitleFromUrl, type SourceCandidate } from './candidate.js';
import type { SearchJobStore, StoryCandidateRecord } from './store.js';
import type { SourceStore } from '../sources/store.js';

export interface ManualSubmissionInput {
  showId: string;
  url: string;
  title?: string;
  summary?: string;
  sourceName?: string;
}

export interface ManualSubmissionResult {
  inserted: boolean;
  skipped: boolean;
  reason: 'inserted' | 'duplicate-url' | 'duplicate-title';
  candidate: StoryCandidateRecord | null;
}

function hostnameFor(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function assertHttpUrl(value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Manual candidate URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Manual candidate URL must use http or https.');
  }
}

function createManualCandidate(input: ManualSubmissionInput): SourceCandidate {
  assertHttpUrl(input.url);
  const canonicalUrl = canonicalizeUrl(input.url);
  const sourceName = input.sourceName?.trim() || hostnameFor(canonicalUrl);

  return {
    title: input.title?.trim() || readableTitleFromUrl(canonicalUrl),
    url: input.url,
    canonicalUrl,
    sourceName,
    summary: input.summary?.trim() || null,
    publishedAt: null,
    rawPayload: {
      url: input.url,
      title: input.title?.trim() || null,
      summary: input.summary?.trim() || null,
      sourceName: input.sourceName?.trim() || null,
    },
    metadata: {
      provider: 'manual',
    },
  };
}

export async function submitManualCandidate(
  store: SourceStore & SearchJobStore,
  input: ManualSubmissionInput,
): Promise<ManualSubmissionResult> {
  const candidate = createManualCandidate(input);
  const existing = await store.listStoryCandidateDedupeKeys(input.showId);
  const normalizedTitle = normalizeTitle(candidate.title);

  if (existing.some((item) => item.canonicalUrl === candidate.canonicalUrl)) {
    return { inserted: false, skipped: true, reason: 'duplicate-url', candidate: null };
  }

  if (existing.some((item) => normalizeTitle(item.title) === normalizedTitle)) {
    return { inserted: false, skipped: true, reason: 'duplicate-title', candidate: null };
  }

  const inserted = await store.insertStoryCandidate({
    ...candidate,
    showId: input.showId,
    sourceProfileId: null,
    sourceQueryId: null,
  });

  if (!inserted) {
    return { inserted: false, skipped: true, reason: 'duplicate-url', candidate: null };
  }

  return { inserted: true, skipped: false, reason: 'inserted', candidate: inserted };
}
