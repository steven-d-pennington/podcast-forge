import type { StoryCandidateRecord } from '../search/store.js';
import type {
  CreateResearchPacketInput,
  ResearchCitation,
  ResearchClaim,
  ResearchWarning,
  SourceDocumentRecord,
} from './store.js';

const MIN_TEXT_LENGTH = 120;
const MIN_INDEPENDENT_HOSTS = 2;
const BREAKING_NEWS_MAX_AGE_HOURS = 48;
const MAX_CORROBORATION_QUERIES = 8;
const MAX_CORROBORATION_QUERY_LENGTH = 180;
const HIGH_STAKES_PATTERN = /\b(lawsuit|court|criminal|security|breach|vulnerability|regulation|regulator|recall|death|injury|sanction|filing|investigation)\b/i;

function hostnameFor(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function firstSentence(value: string): string {
  const [sentence] = value.split(/(?<=[.!?])\s+/);
  return (sentence || value).slice(0, 240).trim();
}

function sourceLabel(document: SourceDocumentRecord): string {
  return document.title || hostnameFor(document.canonicalUrl ?? document.url) || document.url;
}

function candidateSummary(candidates: StoryCandidateRecord[]): string {
  return candidates
    .map((candidate) => `${candidate.title}${candidate.summary ? `: ${candidate.summary}` : ''}`)
    .join(' | ');
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampQuery(value: string): string {
  const normalized = compactText(value).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (normalized.length <= MAX_CORROBORATION_QUERY_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_CORROBORATION_QUERY_LENGTH).replace(/\s+\S*$/, '').trim();
}

function uniqueLimited(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = clampQuery(value);
    const key = normalized.toLowerCase();

    if (normalized.length < 8 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);

    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function sourceHosts(documents: SourceDocumentRecord[], candidates: StoryCandidateRecord[] = []): string[] {
  const hosts = [
    ...documents.map((document) => hostnameFor(document.canonicalUrl ?? document.url)),
    ...candidates.map((candidate) => hostnameFor(candidate.canonicalUrl ?? candidate.url ?? '')),
  ];
  return [...new Set(hosts.filter((host): host is string => typeof host === 'string' && host.length > 0))].sort();
}

function newestEvidenceDate(candidates: StoryCandidateRecord[], documents: SourceDocumentRecord[]): Date | null {
  const dates = [
    ...candidates.flatMap((candidate) => [candidate.publishedAt, candidate.discoveredAt]),
    ...documents.map((document) => document.fetchedAt),
  ].filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));

  if (dates.length === 0) {
    return null;
  }

  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function looksLikeBreakingSingleSource(candidates: StoryCandidateRecord[], documents: SourceDocumentRecord[], independentHostCount: number): boolean {
  if (independentHostCount !== 1) {
    return false;
  }

  const newest = newestEvidenceDate(candidates, documents);
  if (!newest) {
    return false;
  }

  const ageHours = (Date.now() - newest.getTime()) / 3_600_000;
  return ageHours >= 0 && ageHours <= BREAKING_NEWS_MAX_AGE_HOURS;
}

function corroborationQueriesFor(options: {
  candidates: StoryCandidateRecord[];
  documents: SourceDocumentRecord[];
  claims: ResearchClaim[];
}): string[] {
  const candidateQueries = options.candidates.flatMap((candidate) => [
    candidate.title,
    candidate.summary ? `${candidate.title} ${candidate.summary}` : '',
  ]);
  const claimQueries = options.claims.map((claim) => claim.text);
  const sourceTitleQueries = options.documents.map((document) => document.title ?? '').filter(Boolean);

  return uniqueLimited([
    ...claimQueries,
    ...candidateQueries,
    ...sourceTitleQueries,
  ], MAX_CORROBORATION_QUERIES);
}

export interface ResearchCorroborationSearchAttempt {
  status: 'not_run' | 'succeeded' | 'failed' | 'skipped';
  query?: string;
  excludeDomains?: string[];
  inserted?: number;
  skipped?: number;
  jobId?: string;
  sourceProfileId?: string;
  sourceProfileType?: string;
  error?: string;
}

function corroborationState(options: {
  candidates: StoryCandidateRecord[];
  usableDocuments: SourceDocumentRecord[];
  claims: ResearchClaim[];
  independentHostCount: number;
  failedDocumentCount: number;
  searchAttempt?: ResearchCorroborationSearchAttempt;
}) {
  const excludedHosts = sourceHosts(options.usableDocuments, options.candidates);
  const breakingSingleSource = options.failedDocumentCount === 0 && looksLikeBreakingSingleSource(
    options.candidates,
    options.usableDocuments,
    options.independentHostCount,
  );
  const classification = options.independentHostCount >= MIN_INDEPENDENT_HOSTS
    ? 'corroborated'
    : breakingSingleSource
      ? 'single_source_breaking'
      : options.independentHostCount === 1
        ? 'uncorroborated_single_source'
        : 'uncorroborated';

  return {
    classification,
    requiresAttribution: classification === 'single_source_breaking' || classification === 'uncorroborated_single_source',
    attempted: options.searchAttempt?.status === 'succeeded' || options.searchAttempt?.status === 'failed',
    automatedSearch: options.searchAttempt ?? { status: 'not_run' },
    queries: corroborationQueriesFor({
      candidates: options.candidates,
      documents: options.usableDocuments,
      claims: options.claims,
    }),
    excludedHosts,
    minimumIndependentHosts: MIN_INDEPENDENT_HOSTS,
    independentHostCount: options.independentHostCount,
    breakingNewsMaxAgeHours: BREAKING_NEWS_MAX_AGE_HOURS,
  };
}

function synthesizedTitle(candidates: StoryCandidateRecord[], angle?: string | null): string {
  if (angle?.trim()) {
    return angle.trim();
  }

  if (candidates.length === 1) {
    return candidates[0].title;
  }

  return `${candidates[0].title} + ${candidates.length - 1} related source${candidates.length === 2 ? '' : 's'}`;
}

function uniqueWarnings(warnings: ResearchWarning[]): ResearchWarning[] {
  const seen = new Set<string>();

  return warnings.filter((warning) => {
    const key = warning.id || `${warning.code}:${warning.sourceDocumentId ?? ''}:${warning.url ?? ''}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function hostCounts(documents: SourceDocumentRecord[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const document of documents) {
    const host = hostnameFor(document.canonicalUrl ?? document.url);

    if (!host) {
      continue;
    }

    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  return counts;
}

function normalizeClaimSupport(claim: ResearchClaim, documentsById: Map<string, SourceDocumentRecord>): ResearchClaim {
  const sourceDocumentIds = claim.sourceDocumentIds.filter((id) => documentsById.has(id));
  const citationUrls = sourceDocumentIds.map((id) => {
    const document = documentsById.get(id);
    return document?.canonicalUrl ?? document?.url ?? null;
  }).filter((value): value is string => Boolean(value));
  const independentHosts = new Set(citationUrls.map(hostnameFor).filter((value): value is string => Boolean(value)));

  return {
    ...claim,
    sourceDocumentIds,
    citationUrls: [...new Set([...claim.citationUrls.filter((url) => {
      return citationUrls.includes(url);
    }), ...citationUrls])],
    highStakes: claim.highStakes ?? HIGH_STAKES_PATTERN.test(claim.text),
    supportLevel: claim.supportLevel ?? (independentHosts.size >= MIN_INDEPENDENT_HOSTS ? 'corroborated' : 'single_source'),
  };
}

function deterministicClaims(
  candidates: StoryCandidateRecord[],
  usableDocuments: SourceDocumentRecord[],
  providedClaims: ResearchClaim[],
): ResearchClaim[] {
  const documentsById = new Map(usableDocuments.map((document) => [document.id, document]));
  const claims = providedClaims
    .map((claim) => normalizeClaimSupport(claim, documentsById))
    .filter((claim) => claim.sourceDocumentIds.length > 0 && claim.citationUrls.length > 0);

  if (claims.length === 0 && usableDocuments.length > 0) {
    const primaryDocuments = usableDocuments.slice(0, 2);
    claims.push({
      id: 'claim-1',
      text: candidates.length === 1
        ? candidates[0].summary || `${candidates[0].title} is the selected story candidate for research.`
        : `Selected candidates cover a related story cluster: ${candidateSummary(candidates)}`,
      sourceDocumentIds: primaryDocuments.map((document) => document.id),
      citationUrls: primaryDocuments.map((document) => document.canonicalUrl ?? document.url),
      claimType: 'fact',
      confidence: primaryDocuments.length >= MIN_INDEPENDENT_HOSTS ? 'medium' : 'low',
      supportLevel: primaryDocuments.length >= MIN_INDEPENDENT_HOSTS ? 'corroborated' : 'single_source',
      highStakes: candidates.some((candidate) => HIGH_STAKES_PATTERN.test(`${candidate.title} ${candidate.summary ?? ''}`)),
    });
  }

  for (const document of usableDocuments.slice(0, 3)) {
    claims.push({
      id: `claim-${claims.length + 1}`,
      text: `${sourceLabel(document)} reports: ${firstSentence(document.textContent ?? '')}`,
      sourceDocumentIds: [document.id],
      citationUrls: [document.canonicalUrl ?? document.url],
      claimType: 'fact',
      confidence: 'medium',
      supportLevel: 'single_source',
      highStakes: HIGH_STAKES_PATTERN.test(document.textContent ?? ''),
    });
  }

  return claims;
}

function readinessFor(options: {
  usableSourceCount: number;
  independentHostCount: number;
  warnings: ResearchWarning[];
  corroborationClassification?: string;
}) {
  const reasons: string[] = [];

  if (options.usableSourceCount === 0) {
    reasons.push('No fetched source had enough readable text.');
    return { status: 'blocked', reasons };
  }

  if (options.independentHostCount < MIN_INDEPENDENT_HOSTS) {
    reasons.push(`Only ${options.independentHostCount} independent source host(s) are available.`);
    if (options.corroborationClassification === 'single_source_breaking') {
      reasons.push('Story appears fresh enough to treat as a developing single-source report with explicit attribution.');
      return { status: 'single_source_breaking', reasons };
    }
    return { status: 'needs_more_sources', reasons };
  }

  if (options.warnings.some((warning) => warning.severity === 'error')) {
    reasons.push('At least one error-level warning requires editorial review.');
    return { status: 'blocked', reasons };
  }

  return { status: 'ready', reasons };
}

export interface BuildResearchPacketInputOptions {
  candidates: StoryCandidateRecord[];
  documents: SourceDocumentRecord[];
  angle?: string | null;
  notes?: string | null;
  targetFormat?: string | null;
  targetRuntime?: string | null;
  warnings?: ResearchWarning[];
  claims?: ResearchClaim[];
  synthesis?: Record<string, unknown> | null;
  modelProfiles?: Record<string, unknown>;
  modelInvocations?: Record<string, unknown>[];
  corroborationSearchAttempt?: ResearchCorroborationSearchAttempt;
}

export function buildResearchPacketInputFromCandidates(options: BuildResearchPacketInputOptions): CreateResearchPacketInput {
  const { candidates, documents, angle, notes, targetFormat, targetRuntime, synthesis } = options;
  const fetchedDocuments = documents.filter((document) => document.fetchStatus === 'fetched');
  const usableDocuments = fetchedDocuments.filter((document) => (document.textContent?.length ?? 0) >= MIN_TEXT_LENGTH);
  const independentHosts = new Set(
    usableDocuments
      .map((document) => hostnameFor(document.canonicalUrl ?? document.url))
      .filter((host): host is string => Boolean(host)),
  );
  const citations: ResearchCitation[] = documents.map((document) => ({
    sourceDocumentId: document.id,
    url: document.canonicalUrl ?? document.url,
    title: document.title,
    fetchedAt: document.fetchedAt.toISOString(),
    status: document.fetchStatus,
  }));
  const warnings: ResearchWarning[] = [...(options.warnings ?? [])];

  for (const document of documents) {
    if (document.fetchStatus !== 'fetched') {
      warnings.push({
        id: `SOURCE_FETCH_FAILED:${document.id}`,
        code: 'SOURCE_FETCH_FAILED',
        severity: 'warning',
        message: `Source could not be fetched: ${document.url}`,
        sourceDocumentId: document.id,
        url: document.url,
        metadata: document.metadata,
      });
    } else if ((document.textContent?.length ?? 0) < MIN_TEXT_LENGTH) {
      warnings.push({
        id: `LOW_TEXT_CONTENT:${document.id}`,
        code: 'LOW_TEXT_CONTENT',
        severity: 'warning',
        message: `Source has too little readable text: ${document.url}`,
        sourceDocumentId: document.id,
        url: document.url,
        metadata: {
          textLength: document.textContent?.length ?? 0,
          minimumTextLength: MIN_TEXT_LENGTH,
        },
      });
    }
  }

  for (const [host, count] of hostCounts(usableDocuments)) {
    if (count > 1) {
      warnings.push({
        id: `DUPLICATE_SOURCE_HOST:${host}`,
        code: 'DUPLICATE_SOURCE_HOST',
        severity: 'info',
        message: `Multiple fetched sources use the same host (${host}); check for syndicated or circular coverage.`,
        metadata: { host, count },
      });
    }
  }

  if (independentHosts.size < MIN_INDEPENDENT_HOSTS) {
    warnings.push({
      id: 'INSUFFICIENT_INDEPENDENT_SOURCES',
      code: 'INSUFFICIENT_INDEPENDENT_SOURCES',
      severity: 'warning',
      message: 'Research packet needs at least two fetched sources from distinct hostnames.',
      metadata: {
        independentHostCount: independentHosts.size,
        minimumIndependentHosts: MIN_INDEPENDENT_HOSTS,
      },
    });
  }

  const claims = deterministicClaims(candidates, usableDocuments, options.claims ?? []);
  const corroboration = corroborationState({
    candidates,
    usableDocuments,
    claims,
    independentHostCount: independentHosts.size,
    failedDocumentCount: documents.filter((document) => document.fetchStatus !== 'fetched').length,
    searchAttempt: options.corroborationSearchAttempt,
  });

  if (corroboration.classification === 'single_source_breaking') {
    warnings.push({
      id: 'SINGLE_SOURCE_BREAKING_NEWS',
      code: 'SINGLE_SOURCE_BREAKING_NEWS',
      severity: 'warning',
      message: 'Only one independent source is currently available, but the evidence is fresh enough to treat as a developing single-source report with explicit attribution.',
      metadata: {
        independentHostCount: independentHosts.size,
        minimumIndependentHosts: MIN_INDEPENDENT_HOSTS,
        excludedHosts: corroboration.excludedHosts,
        suggestedQueries: corroboration.queries,
        requiresAttribution: true,
      },
    });
  }

  const documentsById = new Map(usableDocuments.map((document) => [document.id, document]));

  for (const claim of claims) {
    if (!claim.highStakes) {
      continue;
    }

    const hasPrimary = claim.sourceDocumentIds.some((id) => {
      const metadata = documentsById.get(id)?.metadata ?? {};
      return metadata.sourceType === 'primary';
    });

    if (!hasPrimary) {
      warnings.push({
        id: `HIGH_STAKES_CLAIM_NEEDS_PRIMARY_SOURCE:${claim.id}`,
        code: 'HIGH_STAKES_CLAIM_NEEDS_PRIMARY_SOURCE',
        severity: 'warning',
        message: 'A high-stakes claim does not cite a source marked as primary.',
        metadata: {
          claimId: claim.id,
          sourceDocumentIds: claim.sourceDocumentIds,
        },
      });
    }
  }

  const finalWarnings = uniqueWarnings(warnings);
  const readiness = readinessFor({
    usableSourceCount: usableDocuments.length,
    independentHostCount: independentHosts.size,
    warnings: finalWarnings,
    corroborationClassification: corroboration.classification,
  });
  const sourceSummary = usableDocuments.length > 0
    ? usableDocuments.map(sourceLabel).join('; ')
    : 'No fetched sources had enough readable text.';
  const summary = typeof synthesis?.summary === 'string'
    ? synthesis.summary
    : [
      `Research packet for "${synthesizedTitle(candidates, angle)}".`,
      `Candidate summary: ${candidateSummary(candidates)}`,
      `Usable sources: ${sourceSummary}`,
    ].filter(Boolean).join(' ');

  return {
    showId: candidates[0].showId,
    episodeCandidateId: null,
    title: typeof synthesis?.title === 'string' ? synthesis.title : synthesizedTitle(candidates, angle),
    status: readiness.status,
    sourceDocumentIds: documents.map((document) => document.id),
    claims,
    citations,
    warnings: finalWarnings,
    content: {
      candidateIds: candidates.map((candidate) => candidate.id),
      storyCandidateId: candidates.length === 1 ? candidates[0].id : undefined,
      angle: angle ?? null,
      notes: notes ?? null,
      targetFormat: targetFormat ?? null,
      targetRuntime: targetRuntime ?? null,
      summary,
      synthesis: synthesis ?? null,
      knownFacts: Array.isArray(synthesis?.knownFacts) ? synthesis.knownFacts : claims.map((claim) => claim.text),
      openQuestions: Array.isArray(synthesis?.openQuestions) ? synthesis.openQuestions : finalWarnings.map((warning) => warning.message),
      independentHostCount: independentHosts.size,
      independentSourceCount: independentHosts.size,
      usableSourceCount: usableDocuments.length,
      fetchedSourceCount: fetchedDocuments.length,
      selectedCandidateCount: candidates.length,
      readiness,
      corroboration,
      modelProfiles: options.modelProfiles ?? {},
      modelInvocations: options.modelInvocations ?? [],
    },
  };
}

export function buildResearchPacketInput(
  candidate: StoryCandidateRecord,
  documents: SourceDocumentRecord[],
): CreateResearchPacketInput {
  return buildResearchPacketInputFromCandidates({ candidates: [candidate], documents });
}
