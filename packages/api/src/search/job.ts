import { normalizeTitle, searchBraveNews, type BraveCandidate, type BraveFetch } from './brave.js';
import type { JobRecord, SearchJobStore, StoryCandidateRecord } from './store.js';
import type { SourceProfileRecord, SourceQueryRecord, SourceStore } from '../sources/store.js';

export interface SourceSearchResult {
  job: JobRecord;
  inserted: number;
  skipped: number;
  candidates: StoryCandidateRecord[];
}

interface RunSourceSearchOptions {
  apiKey: string;
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  store: SourceStore & SearchJobStore;
  fetchImpl?: BraveFetch;
  sleep?: (ms: number) => Promise<void>;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const parsed = Number(value);
    return parsed >= 0 ? parsed : undefined;
  }

  return undefined;
}

function queryIdFromCandidate(candidate: BraveCandidate): string | null {
  const query = asObject(candidate.metadata.query);
  return typeof query.id === 'string' ? query.id : null;
}

function rateLimitDelayMs(profile: SourceProfileRecord, query: SourceQueryRecord): number {
  const queryRateLimit = asObject(query.config.rateLimit);

  return asPositiveNumber(query.config.rateLimitMs)
    ?? asPositiveNumber(query.config.delayMs)
    ?? asPositiveNumber(queryRateLimit.delayMs)
    ?? asPositiveNumber(queryRateLimit.minIntervalMs)
    ?? asPositiveNumber(profile.rateLimit.delayMs)
    ?? asPositiveNumber(profile.rateLimit.minIntervalMs)
    ?? asPositiveNumber(profile.config.rateLimitMs)
    ?? 0;
}

function log(level: 'info' | 'warn' | 'error', message: string, metadata: JsonObject = {}) {
  return {
    at: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
}

export async function runSourceSearch(options: RunSourceSearchOptions): Promise<SourceSearchResult> {
  const logs: Array<Record<string, unknown>> = [
    log('info', 'Starting source.search job.', {
      sourceProfileId: options.profile.id,
      queryCount: options.queries.length,
    }),
  ];
  let job = await options.store.createJob({
    showId: options.profile.showId,
    type: 'source.search',
    status: 'running',
    progress: 0,
    attempts: 1,
    input: {
      sourceProfileId: options.profile.id,
      sourceProfileSlug: options.profile.slug,
      sourceType: options.profile.type,
      queryIds: options.queries.map((query) => query.id),
    },
    logs,
    startedAt: new Date(),
  });

  try {
    const existing = await options.store.listStoryCandidateDedupeKeys(options.profile.showId);
    const seenUrls = new Set(existing.map((item) => item.canonicalUrl).filter((url): url is string => Boolean(url)));
    const seenTitles = new Set(existing.map((item) => normalizeTitle(item.title)).filter(Boolean));
    const insertedCandidates: StoryCandidateRecord[] = [];
    let skipped = 0;

    for (const [index, query] of options.queries.entries()) {
      logs.push(log('info', 'Running Brave news query.', { sourceQueryId: query.id, query: query.query }));

      const candidates = await searchBraveNews({
        apiKey: options.apiKey,
        profile: options.profile,
        queries: [query],
        fetchImpl: options.fetchImpl,
      });

      logs.push(log('info', 'Brave news query returned candidates.', {
        sourceQueryId: query.id,
        candidateCount: candidates.length,
      }));

      for (const candidate of candidates) {
        const normalizedTitle = normalizeTitle(candidate.title);

        if (seenUrls.has(candidate.canonicalUrl) || seenTitles.has(normalizedTitle)) {
          skipped += 1;
          logs.push(log('info', 'Skipped duplicate candidate.', {
            sourceQueryId: query.id,
            canonicalUrl: candidate.canonicalUrl,
            normalizedTitle,
          }));
          continue;
        }

        seenUrls.add(candidate.canonicalUrl);
        seenTitles.add(normalizedTitle);

        const inserted = await options.store.insertStoryCandidate({
          ...candidate,
          showId: options.profile.showId,
          sourceProfileId: options.profile.id,
          sourceQueryId: queryIdFromCandidate(candidate),
        });

        if (inserted) {
          insertedCandidates.push(inserted);
        } else {
          skipped += 1;
        }
      }

      const progress = Math.round(((index + 1) / options.queries.length) * 90);
      job = await options.store.updateJob(job.id, {
        progress,
        logs,
        output: {
          inserted: insertedCandidates.length,
          skipped,
        },
      }) ?? job;

      const delayMs = index < options.queries.length - 1 ? rateLimitDelayMs(options.profile, query) : 0;

      if (delayMs > 0) {
        logs.push(log('info', 'Waiting for configured source rate limit.', { delayMs }));
        await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(delayMs);
      }
    }

    logs.push(log('info', 'Completed source.search job.', {
      inserted: insertedCandidates.length,
      skipped,
    }));
    job = await options.store.updateJob(job.id, {
      status: 'succeeded',
      progress: 100,
      logs,
      output: {
        inserted: insertedCandidates.length,
        skipped,
        candidateIds: insertedCandidates.map((candidate) => candidate.id),
      },
      finishedAt: new Date(),
    }) ?? job;

    return {
      job,
      inserted: insertedCandidates.length,
      skipped,
      candidates: insertedCandidates,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Source search failed.';
    logs.push(log('error', message));
    job = await options.store.updateJob(job.id, {
      status: 'failed',
      progress: job.progress,
      logs,
      error: message,
      finishedAt: new Date(),
    }) ?? job;
    throw Object.assign(new Error(message), { job });
  }
}
