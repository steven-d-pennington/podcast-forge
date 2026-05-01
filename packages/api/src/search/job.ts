import { searchBraveNews, type BraveFetch } from './brave.js';
import { normalizeTitle, type SourceCandidate } from './candidate.js';
import { filterCandidatesForSourceControls, type SourceControlSummary } from './controls.js';
import { fetchRssCandidates, type RssFetch } from './rss.js';
import { scoreCandidateBatch, scoringLimitFromProfile, type CandidateScorer, type CandidateScoringBatchResult } from './scoring.js';
import { searchZaiWeb, type ZaiWebFetch } from './zai-web.js';
import { searchOpenRouterPerplexity, type OpenRouterPerplexityFetch } from './openrouter-perplexity.js';
import type { JobRecord, SearchJobStore, StoryCandidateRecord } from './store.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
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
  zaiFetchImpl?: ZaiWebFetch;
  openRouterPerplexityFetchImpl?: OpenRouterPerplexityFetch;
  sleep?: (ms: number) => Promise<void>;
  modelProfile?: ResolvedModelProfile;
  candidateScorer?: CandidateScorer;
}

interface RunSourceIngestOptions {
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  store: SourceStore & SearchJobStore;
  fetchImpl?: RssFetch;
  modelProfile?: ResolvedModelProfile;
  candidateScorer?: CandidateScorer;
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

function queryIdFromCandidate(candidate: SourceCandidate): string | null {
  const query = asObject(candidate.metadata.query);
  return typeof query.id === 'string' ? query.id : null;
}

function providerLabel(profile: SourceProfileRecord): string {
  if (profile.type === 'zai-web') return 'Z.AI web';
  if (profile.type === 'openrouter-perplexity') return 'OpenRouter Perplexity';
  return 'Brave news';
}

async function searchProviderCandidates(options: RunSourceSearchOptions, query: SourceQueryRecord) {
  if (options.profile.type === 'zai-web') {
    return searchZaiWeb({
      apiKey: options.apiKey,
      profile: options.profile,
      queries: [query],
      fetchImpl: options.zaiFetchImpl,
    });
  }

  if (options.profile.type === 'openrouter-perplexity') {
    return searchOpenRouterPerplexity({
      apiKey: options.apiKey,
      profile: options.profile,
      queries: [query],
      fetchImpl: options.openRouterPerplexityFetchImpl,
    });
  }

  return searchBraveNews({
    apiKey: options.apiKey,
    profile: options.profile,
    queries: [query],
    fetchImpl: options.fetchImpl,
  });
}

function sourceQueryIdFromCandidate(candidate: SourceCandidate): string | null {
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

function scoringSummary(scoring?: CandidateScoringBatchResult) {
  return scoring ? {
    scored: scoring.scored,
    fallback: scoring.fallback,
    failed: scoring.failed,
    skipped: scoring.skipped,
  } : undefined;
}

function pushScoringEvents(logs: Array<Record<string, unknown>>, events: Array<Record<string, unknown>>) {
  for (const event of events) {
    const level = event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'info';
    logs.push(log(level, typeof event.message === 'string' ? event.message : 'Candidate scoring event.', {
      ...event,
      level: undefined,
      message: undefined,
    }));
  }
}

function emptyFilterTotals() {
  return {
    includeDomain: 0,
    excludeDomain: 0,
    freshness: 0,
  };
}

function addFilterTotals(
  totals: ReturnType<typeof emptyFilterTotals>,
  next: ReturnType<typeof emptyFilterTotals>,
) {
  totals.includeDomain += next.includeDomain;
  totals.excludeDomain += next.excludeDomain;
  totals.freshness += next.freshness;
}

function summarizeWarnings(warnings: Array<Record<string, unknown>>, limit = 20) {
  const items = warnings.slice(0, limit);

  return {
    total: warnings.length,
    items,
    omitted: Math.max(0, warnings.length - items.length),
  };
}

function filterSummary(total: number, kept: number, dropped: ReturnType<typeof emptyFilterTotals>, warnings: Array<Record<string, unknown>>) {
  return {
    total,
    kept,
    dropped,
    warnings: summarizeWarnings(warnings, 10),
  };
}

function sourceControlOutput(controls: SourceControlSummary[], dropped: ReturnType<typeof emptyFilterTotals>, warnings: Array<Record<string, unknown>>) {
  return {
    applied: controls,
    dropped,
    warnings: summarizeWarnings(warnings),
  };
}

async function maybeScoreCandidates(options: {
  candidates: StoryCandidateRecord[];
  profile: SourceProfileRecord;
  queries: SourceQueryRecord[];
  store: SourceStore & SearchJobStore;
  modelProfile?: ResolvedModelProfile;
  candidateScorer?: CandidateScorer;
  logs: Array<Record<string, unknown>>;
}): Promise<CandidateScoringBatchResult | undefined> {
  if (options.candidates.length === 0) {
    return undefined;
  }

  const show = (await options.store.listShows()).find((candidate) => candidate.id === options.profile.showId);

  if (!show) {
    options.logs.push(log('warn', 'Skipped candidate scoring because show context was not found.', {
      showId: options.profile.showId,
    }));
    return undefined;
  }

  try {
    options.logs.push(log('info', 'Starting candidate scoring.', {
      candidateCount: options.candidates.length,
      scoringLimit: scoringLimitFromProfile(options.profile),
      modelProfileId: options.modelProfile?.id,
      modelProfileVersion: options.modelProfile?.version,
    }));
    const result = await scoreCandidateBatch({
      candidates: options.candidates,
      show,
      sourceProfile: options.profile,
      queries: options.queries,
      store: options.store,
      scorer: options.candidateScorer,
      modelProfile: options.modelProfile,
    });
    pushScoringEvents(options.logs, result.events);
    options.logs.push(log('info', 'Completed candidate scoring.', scoringSummary(result)));
    return result;
  } catch (error) {
    options.logs.push(log('error', 'Candidate scoring stage failed; candidates remain inserted.', {
      reason: error instanceof Error ? error.message : 'Candidate scoring stage failed.',
    }));
    return undefined;
  }
}

export async function runSourceSearch(options: RunSourceSearchOptions): Promise<SourceSearchResult> {
  const adHocQuery = options.queries.length === 1 && options.queries[0]?.config.adHoc === true ? options.queries[0] : null;
  const logs: Array<Record<string, unknown>> = [
    log('info', 'Starting source.search job.', {
      sourceProfileId: options.profile.id,
      queryCount: options.queries.length,
      modelProfileId: options.modelProfile?.id,
      modelProfileVersion: options.modelProfile?.version,
    }),
  ];
  const modelProfiles = options.modelProfile ? { candidate_scorer: options.modelProfile } : {};
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
      ...(adHocQuery ? {
        adHocQuery: adHocQuery.query,
        excludeDomains: adHocQuery.excludeDomains,
        purpose: typeof adHocQuery.config.purpose === 'string' ? adHocQuery.config.purpose : 'source-search',
      } : {}),
      modelProfiles,
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
    const sourceControlSummaries: SourceControlSummary[] = [];
    const sourceControlDropped = emptyFilterTotals();
    const sourceControlWarnings: Array<Record<string, unknown>> = [];

    for (const [index, query] of options.queries.entries()) {
      const provider = providerLabel(options.profile);
      logs.push(log('info', `Running ${provider} query.`, { sourceQueryId: query.id, query: query.query }));

      const rawCandidates = await searchProviderCandidates(options, query);
      const filtered = filterCandidatesForSourceControls(rawCandidates, options.profile, query, { verifyFreshness: false });
      const candidates = filtered.candidates;
      sourceControlSummaries.push(filtered.controls);
      addFilterTotals(sourceControlDropped, filtered.dropped);
      sourceControlWarnings.push(...filtered.warnings);

      logs.push(log('info', `${provider} query returned candidates.`, {
        sourceQueryId: query.id,
        candidateCount: rawCandidates.length,
        sourceControls: filterSummary(rawCandidates.length, candidates.length, filtered.dropped, filtered.warnings),
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
          warnings: sourceControlWarnings.slice(0, 20),
          warningSummary: summarizeWarnings(sourceControlWarnings, 20),
          sourceControls: sourceControlOutput(sourceControlSummaries, sourceControlDropped, sourceControlWarnings),
          modelProfiles,
        },
      }) ?? job;

      const delayMs = index < options.queries.length - 1 ? rateLimitDelayMs(options.profile, query) : 0;

      if (delayMs > 0) {
        logs.push(log('info', 'Waiting for configured source rate limit.', { delayMs }));
        await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(delayMs);
      }
    }

    const scoring = await maybeScoreCandidates({
      candidates: insertedCandidates,
      profile: options.profile,
      queries: options.queries,
      store: options.store,
      modelProfile: options.modelProfile,
      candidateScorer: options.candidateScorer,
      logs,
    });

    const finalCandidates = scoring?.candidates ?? insertedCandidates;

    logs.push(log('info', 'Completed source.search job.', {
      inserted: insertedCandidates.length,
      skipped,
      scoring: scoringSummary(scoring),
    }));
    job = await options.store.updateJob(job.id, {
      status: 'succeeded',
      progress: 100,
      logs,
      output: {
        inserted: insertedCandidates.length,
        skipped,
        candidateIds: finalCandidates.map((candidate) => candidate.id),
        warnings: sourceControlWarnings,
        sourceControls: sourceControlOutput(sourceControlSummaries, sourceControlDropped, sourceControlWarnings),
        scoring: scoringSummary(scoring),
        modelProfiles,
      },
      finishedAt: new Date(),
    }) ?? job;

    return {
      job,
      inserted: insertedCandidates.length,
      skipped,
      candidates: finalCandidates,
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

export async function runSourceIngest(options: RunSourceIngestOptions): Promise<SourceSearchResult> {
  const logs: Array<Record<string, unknown>> = [
    log('info', 'Starting source.ingest job.', {
      sourceProfileId: options.profile.id,
      queryCount: options.queries.length,
      modelProfileId: options.modelProfile?.id,
      modelProfileVersion: options.modelProfile?.version,
    }),
  ];
  const modelProfiles = options.modelProfile ? { candidate_scorer: options.modelProfile } : {};
  let job = await options.store.createJob({
    showId: options.profile.showId,
    type: 'source.ingest',
    status: 'running',
    progress: 0,
    attempts: 1,
    input: {
      sourceProfileId: options.profile.id,
      sourceProfileSlug: options.profile.slug,
      sourceType: options.profile.type,
      queryIds: options.queries.map((query) => query.id),
      modelProfiles,
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
    const sourceControlSummaries = new Map<string, SourceControlSummary>();
    const sourceControlDropped = emptyFilterTotals();
    const sourceControlWarnings: Array<Record<string, unknown>> = [];

    logs.push(log('info', 'Fetching RSS feeds.', { sourceProfileId: options.profile.id }));
    const rawCandidates = await fetchRssCandidates({
      profile: options.profile,
      queries: options.queries,
      fetchImpl: options.fetchImpl,
    });
    const queryById = new Map(options.queries.map((query) => [query.id, query]));
    const candidatesByQuery = new Map<string, SourceCandidate[]>();
    const candidates: SourceCandidate[] = [];

    for (const candidate of rawCandidates) {
      const queryId = sourceQueryIdFromCandidate(candidate) ?? 'profile';
      const group = candidatesByQuery.get(queryId) ?? [];
      group.push(candidate);
      candidatesByQuery.set(queryId, group);
    }

    for (const [queryId, candidatesForQuery] of candidatesByQuery) {
      const query = queryId === 'profile' ? null : queryById.get(queryId) ?? null;
      const filtered = filterCandidatesForSourceControls(candidatesForQuery, options.profile, query);
      candidates.push(...filtered.candidates);
      sourceControlSummaries.set(queryId, filtered.controls);
      addFilterTotals(sourceControlDropped, filtered.dropped);
      sourceControlWarnings.push(...filtered.warnings);
    }

    logs.push(log('info', 'RSS feeds returned candidates.', {
      candidateCount: rawCandidates.length,
      sourceControls: filterSummary(rawCandidates.length, candidates.length, sourceControlDropped, sourceControlWarnings),
    }));

    for (const candidate of candidates) {
      const normalizedTitle = normalizeTitle(candidate.title);

      if (seenUrls.has(candidate.canonicalUrl) || seenTitles.has(normalizedTitle)) {
        skipped += 1;
        logs.push(log('info', 'Skipped duplicate candidate.', {
          sourceQueryId: sourceQueryIdFromCandidate(candidate),
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
        sourceQueryId: sourceQueryIdFromCandidate(candidate),
      });

      if (inserted) {
        insertedCandidates.push(inserted);
      } else {
        skipped += 1;
      }
    }

    const scoring = await maybeScoreCandidates({
      candidates: insertedCandidates,
      profile: options.profile,
      queries: options.queries,
      store: options.store,
      modelProfile: options.modelProfile,
      candidateScorer: options.candidateScorer,
      logs,
    });

    const finalCandidates = scoring?.candidates ?? insertedCandidates;

    logs.push(log('info', 'Completed source.ingest job.', {
      inserted: insertedCandidates.length,
      skipped,
      scoring: scoringSummary(scoring),
    }));
    job = await options.store.updateJob(job.id, {
      status: 'succeeded',
      progress: 100,
      logs,
      output: {
        inserted: insertedCandidates.length,
        skipped,
        candidateIds: finalCandidates.map((candidate) => candidate.id),
        warnings: sourceControlWarnings,
        sourceControls: sourceControlOutput([...sourceControlSummaries.values()], sourceControlDropped, sourceControlWarnings),
        scoring: scoringSummary(scoring),
        modelProfiles,
      },
      finishedAt: new Date(),
    }) ?? job;

    return {
      job,
      inserted: insertedCandidates.length,
      skipped,
      candidates: finalCandidates,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Source ingest failed.';
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
