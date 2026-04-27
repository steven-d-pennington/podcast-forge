import type { SourceCandidate } from './candidate.js';
import type { SourceProfileRecord, SourceQueryRecord } from '../sources/store.js';

export interface SourceControlSummary {
  freshness: string | null;
  freshnessCutoff: string | null;
  includeDomains: string[];
  includeDomainGroups: string[][];
  excludeDomains: string[];
}

export interface SourceControlFilterResult<T extends SourceCandidate> {
  candidates: T[];
  controls: SourceControlSummary;
  dropped: {
    includeDomain: number;
    excludeDomain: number;
    freshness: number;
  };
  warnings: Array<Record<string, unknown>>;
}

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/\.$/, '');
  } catch {
    return null;
  }
}

function hostnameForUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function normalizeDomainList(values: string[] | null | undefined): string[] {
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const domain = normalizeHostname(value);

    if (!domain || seen.has(domain)) {
      continue;
    }

    seen.add(domain);
    domains.push(domain);
  }

  return domains;
}

export function hostnameMatchesDomain(hostname: string | null, domain: string): boolean {
  if (!hostname) {
    return false;
  }

  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedDomain = normalizeHostname(domain);

  if (!normalizedDomain) {
    return false;
  }

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function resolveFreshness(query: SourceQueryRecord | null, profile: SourceProfileRecord): string | null {
  return query?.freshness
    ?? profile.freshness
    ?? null;
}

function uniqueDomains(values: string[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    domains.push(value);
  }

  return domains;
}

function resolveIncludeDomainGroups(query: SourceQueryRecord | null, profile: SourceProfileRecord): string[][] {
  const groups: string[][] = [];
  const profileDomains = normalizeDomainList(profile.includeDomains);
  const queryDomains = normalizeDomainList(query?.includeDomains);

  if (profileDomains.length > 0) {
    groups.push(profileDomains);
  }

  if (queryDomains.length > 0) {
    groups.push(queryDomains);
  }

  return groups;
}

function resolveExcludeDomains(query: SourceQueryRecord | null, profile: SourceProfileRecord): string[] {
  return normalizeDomainList([
    ...profile.excludeDomains,
    ...(query?.excludeDomains ?? []),
  ]);
}

function freshnessCutoff(freshness: string | null, now: Date): Date | null {
  const normalized = freshness?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const days = {
    pd: 1,
    pw: 7,
    pm: 31,
    py: 365,
  }[normalized];

  if (!days) {
    return null;
  }

  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function candidateWithControls<T extends SourceCandidate>(
  candidate: T,
  controls: SourceControlSummary,
  warnings: Array<Record<string, unknown>>,
): T {
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      sourceControls: {
        applied: controls,
        warnings,
      },
    },
  };
}

export function filterCandidatesForSourceControls<T extends SourceCandidate>(
  candidates: T[],
  profile: SourceProfileRecord,
  query: SourceQueryRecord | null,
  options: { now?: Date; verifyFreshness?: boolean } = {},
): SourceControlFilterResult<T> {
  const includeDomainGroups = resolveIncludeDomainGroups(query, profile);
  const includeDomains = uniqueDomains(includeDomainGroups.flat());
  const excludeDomains = resolveExcludeDomains(query, profile);
  const freshness = resolveFreshness(query, profile);
  const cutoff = options.verifyFreshness === false ? null : freshnessCutoff(freshness, options.now ?? new Date());
  const controls = {
    freshness,
    freshnessCutoff: cutoff?.toISOString() ?? null,
    includeDomains,
    includeDomainGroups,
    excludeDomains,
  };
  const dropped = {
    includeDomain: 0,
    excludeDomain: 0,
    freshness: 0,
  };
  const warnings: Array<Record<string, unknown>> = [];
  const kept: T[] = [];

  if (freshness && options.verifyFreshness !== false && !cutoff) {
    warnings.push({
      code: 'UNSUPPORTED_FRESHNESS_WINDOW',
      message: `Freshness window "${freshness}" was passed through but could not be verified after fetch.`,
      freshness,
    });
  }

  for (const candidate of candidates) {
    const hostname = hostnameForUrl(candidate.canonicalUrl || candidate.url);

    if (
      includeDomainGroups.length > 0
      && !includeDomainGroups.every((domains) => domains.some((domain) => hostnameMatchesDomain(hostname, domain)))
    ) {
      dropped.includeDomain += 1;
      continue;
    }

    if (excludeDomains.some((domain) => hostnameMatchesDomain(hostname, domain))) {
      dropped.excludeDomain += 1;
      continue;
    }

    const candidateWarnings: Array<Record<string, unknown>> = [];

    if (cutoff) {
      if (candidate.publishedAt) {
        if (candidate.publishedAt < cutoff) {
          dropped.freshness += 1;
          continue;
        }
      } else {
        candidateWarnings.push({
          code: 'FRESHNESS_UNVERIFIED',
          message: 'Freshness could not be verified because the candidate had no published date.',
          freshness,
        });
      }
    }

    if (candidateWarnings.length > 0) {
      warnings.push(...candidateWarnings.map((warning) => ({
        ...warning,
        canonicalUrl: candidate.canonicalUrl,
      })));
    }

    kept.push(candidateWithControls(candidate, controls, candidateWarnings));
  }

  return {
    candidates: kept,
    controls,
    dropped,
    warnings,
  };
}
