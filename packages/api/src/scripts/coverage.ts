import type { ResearchClaim, ResearchPacketRecord, ResearchWarning } from '../research/store.js';
import { integrityGateState } from './integrity.js';
import type { ScriptRevisionRecord } from './store.js';

export type ClaimCoverageStatus = 'blocking' | 'needs_attention' | 'covered' | 'unknown';
export type ClaimCoverageSeverity = 'blocking' | 'warning' | 'info';
export type ClaimCoverageCategory = 'claim' | 'integrity' | 'provenance' | 'research' | 'metadata';

export interface ClaimCoverageFinding {
  category: ClaimCoverageCategory;
  status: Exclude<ClaimCoverageStatus, 'covered'>;
  severity: ClaimCoverageSeverity;
  code: string;
  message: string;
  nextAction: string;
  claimId?: string;
  claimText?: string;
  line?: string;
  context?: string;
  sourceDocumentIds?: string[];
  citationUrls?: string[];
}

export interface ClaimCoverageItem {
  claimId: string;
  text: string;
  status: ClaimCoverageStatus;
  sourceDocumentIds: string[];
  citationUrls: string[];
  independentSourceCount: number | null;
  supportLevel: ResearchClaim['supportLevel'] | 'unknown';
  confidence: ResearchClaim['confidence'] | 'unknown';
  claimType: ResearchClaim['claimType'] | 'unknown';
  findings: ClaimCoverageFinding[];
  citedInScript: boolean;
  scriptLines: string[];
}

export interface ClaimCoverageSummary {
  status: ClaimCoverageStatus;
  headline: string;
  counts: {
    totalClaims: number;
    covered: number;
    needsAttention: number;
    blocking: number;
    unknown: number;
    blockingFindings: number;
    needsAttentionFindings: number;
    integrityFindings: number;
  };
  blockers: ClaimCoverageFinding[];
  needsAttention: ClaimCoverageFinding[];
  unknowns: ClaimCoverageFinding[];
  coveredClaims: ClaimCoverageItem[];
  claims: ClaimCoverageItem[];
}

const STALE_CITATION_DAYS = 14;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const WEAK_SUPPORT_LEVELS = new Set<ResearchClaim['supportLevel']>([
  'single_source',
  'uncorroborated',
  'contradicted',
  'unknown',
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function hostnameFor(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function independentSourceCount(citationUrls: string[]): number | null {
  if (citationUrls.length === 0) {
    return null;
  }

  const hosts = new Set(citationUrls.map(hostnameFor).filter((host): host is string => Boolean(host)));
  return hosts.size > 0 ? hosts.size : null;
}

function finding(input: ClaimCoverageFinding): ClaimCoverageFinding {
  return {
    ...input,
    sourceDocumentIds: input.sourceDocumentIds ? [...new Set(input.sourceDocumentIds)] : undefined,
    citationUrls: input.citationUrls ? [...new Set(input.citationUrls)] : undefined,
  };
}

function warningMatchesClaim(warning: ResearchWarning, claim: ResearchClaim): boolean {
  const metadata = asObject(warning.metadata);
  const claimId = asString(metadata.claimId);

  return claimId === claim.id
    || (warning.sourceDocumentId ? claim.sourceDocumentIds.includes(warning.sourceDocumentId) : false)
    || (warning.url ? claim.citationUrls.includes(warning.url) : false);
}

type CitationMapEntry = { claimId?: string; line?: string; sourceDocumentIds: string[] };

function citationMapEntries(revision: ScriptRevisionRecord): CitationMapEntry[] {
  return asRecordArray(revision.metadata.citationMap).map((entry) => ({
    claimId: asString(entry.claimId),
    line: asString(entry.line),
    sourceDocumentIds: asStringArray(entry.sourceDocumentIds),
  }));
}

function sourceMetadataHasPrimary(claim: ResearchClaim): boolean | null {
  const metadata = asObject((claim as ResearchClaim & { metadata?: unknown }).metadata);
  const sourceTypes = [
    metadata.sourceType,
    metadata.primarySource,
    metadata.hasPrimarySource,
    (claim as ResearchClaim & { sourceType?: unknown }).sourceType,
  ];

  if (sourceTypes.some((value) => value === 'primary' || value === true)) {
    return true;
  }

  return sourceTypes.some((value) => value !== undefined) ? false : null;
}

function staleCitationUrls(packet: ResearchPacketRecord, claim: ResearchClaim, now: Date): string[] {
  const urls: string[] = [];
  const claimSourceIds = new Set(claim.sourceDocumentIds);

  for (const citation of packet.citations) {
    if (!claimSourceIds.has(citation.sourceDocumentId)) {
      continue;
    }

    const fetchedAt = Date.parse(citation.fetchedAt);
    if (!Number.isFinite(fetchedAt)) {
      continue;
    }

    const ageDays = (now.getTime() - fetchedAt) / MILLISECONDS_PER_DAY;
    if (ageDays > STALE_CITATION_DAYS) {
      urls.push(citation.url);
    }
  }

  return [...new Set(urls)];
}

function claimWarningFinding(warning: ResearchWarning, claim: ResearchClaim): ClaimCoverageFinding {
  const overridden = Boolean(warning.override);

  return finding({
    category: 'research',
    status: !overridden && warning.severity === 'error' ? 'blocking' : 'needs_attention',
    severity: !overridden && warning.severity === 'error' ? 'blocking' : warning.severity === 'info' ? 'info' : 'warning',
    code: warning.code || 'RESEARCH_WARNING',
    message: `${warning.message || 'Research warning is associated with this claim.'}${overridden ? ' An editorial override is recorded.' : ''}`,
    nextAction: overridden
      ? 'Review the recorded override reason before relying on this claim; it no longer blocks coverage status by itself.'
      : 'Resolve or record an editorial override for this research warning.',
    claimId: claim.id,
    claimText: claim.text,
    sourceDocumentIds: claim.sourceDocumentIds,
    citationUrls: claim.citationUrls,
  });
}

function claimFindings(
  packet: ResearchPacketRecord,
  claim: ResearchClaim,
  citationMap: CitationMapEntry[],
  now: Date,
): ClaimCoverageFinding[] {
  const findings: ClaimCoverageFinding[] = [];
  const citedEntries = citationMap.filter((entry) => entry.claimId === claim.id);
  const sourceCount = independentSourceCount(claim.citationUrls);

  if (claim.sourceDocumentIds.length === 0 || claim.citationUrls.length === 0) {
    findings.push(finding({
      category: 'claim',
      status: 'needs_attention',
      severity: 'warning',
      code: 'CLAIM_MISSING_CITATIONS',
      message: 'This claim has no citation URL or fetched source snapshot in current metadata.',
      nextAction: 'Fetch or attach source evidence before approving the script language.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  if (sourceCount === null || sourceCount < 2) {
    findings.push(finding({
      category: 'claim',
      status: 'needs_attention',
      severity: 'warning',
      code: 'CLAIM_SINGLE_SOURCE',
      message: 'This claim is backed by fewer than two independent fetched source hosts.',
      nextAction: 'Fetch an independent corroborating source or soften attribution in the script.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  if (claim.supportLevel && claim.supportLevel !== 'single_source' && WEAK_SUPPORT_LEVELS.has(claim.supportLevel)) {
    findings.push(finding({
      category: 'claim',
      status: claim.supportLevel === 'contradicted' ? 'blocking' : 'needs_attention',
      severity: claim.supportLevel === 'contradicted' ? 'blocking' : 'warning',
      code: `CLAIM_SUPPORT_${claim.supportLevel.toUpperCase()}`,
      message: `Research metadata marks this claim support level as ${claim.supportLevel.replace(/_/g, ' ')}.`,
      nextAction: claim.supportLevel === 'contradicted'
        ? 'Do not approve the claim until the contradiction is resolved or removed.'
        : 'Add corroboration or make the claim attribution explicit.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  if (claim.claimType === 'uncertain' || claim.confidence === 'low' || claim.caveat) {
    findings.push(finding({
      category: 'claim',
      status: 'needs_attention',
      severity: 'info',
      code: 'CLAIM_UNCERTAIN',
      message: claim.caveat || 'Research metadata marks this claim as uncertain or low confidence.',
      nextAction: 'Keep uncertainty visible in the script and avoid definitive language.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  const hasPrimarySource = sourceMetadataHasPrimary(claim);
  if (claim.highStakes && hasPrimarySource !== true) {
    findings.push(finding({
      category: 'claim',
      status: hasPrimarySource === false ? 'needs_attention' : 'unknown',
      severity: hasPrimarySource === false ? 'warning' : 'info',
      code: 'CLAIM_MISSING_PRIMARY_SOURCE',
      message: hasPrimarySource === false
        ? 'This high-stakes claim has no primary-source backing visible in current metadata.'
        : 'Primary-source coverage is unknown for this high-stakes claim from current metadata.',
      nextAction: hasPrimarySource === false
        ? 'Fetch a primary source or add an explicit editorial caveat before relying on the claim.'
        : 'Verify primary-source backing manually or rebuild research metadata before relying on the claim.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  const staleUrls = staleCitationUrls(packet, claim, now);
  if (staleUrls.length > 0) {
    findings.push(finding({
      category: 'claim',
      status: 'needs_attention',
      severity: 'warning',
      code: 'CLAIM_STALE_EVIDENCE',
      message: `This claim cites source snapshots older than ${STALE_CITATION_DAYS} days.`,
      nextAction: 'Refresh the source snapshot or verify the claim still holds.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: staleUrls,
    }));
  }

  if (citationMap.length > 0 && citedEntries.length === 0) {
    findings.push(finding({
      category: 'provenance',
      status: 'needs_attention',
      severity: 'warning',
      code: 'CLAIM_NOT_MAPPED_TO_SCRIPT',
      message: 'The script citation map does not point to this research claim.',
      nextAction: 'Confirm whether the claim appears in the script or update the citation map.',
      claimId: claim.id,
      claimText: claim.text,
      sourceDocumentIds: claim.sourceDocumentIds,
      citationUrls: claim.citationUrls,
    }));
  }

  for (const warning of packet.warnings.filter((item) => warningMatchesClaim(item, claim))) {
    findings.push(claimWarningFinding(warning, claim));
  }

  return findings;
}

function itemStatus(findings: ClaimCoverageFinding[]): ClaimCoverageStatus {
  if (findings.some((item) => item.status === 'blocking')) {
    return 'blocking';
  }

  if (findings.some((item) => item.status === 'unknown')) {
    return 'unknown';
  }

  if (findings.length > 0) {
    return 'needs_attention';
  }

  return 'covered';
}

function claimItem(
  packet: ResearchPacketRecord,
  claim: ResearchClaim,
  citationMap: CitationMapEntry[],
  now: Date,
): ClaimCoverageItem {
  const entries = citationMap.filter((entry) => entry.claimId === claim.id);
  const findings = claimFindings(packet, claim, citationMap, now);

  return {
    claimId: claim.id,
    text: claim.text,
    status: itemStatus(findings),
    sourceDocumentIds: [...new Set(claim.sourceDocumentIds)],
    citationUrls: [...new Set(claim.citationUrls)],
    independentSourceCount: independentSourceCount(claim.citationUrls),
    supportLevel: claim.supportLevel ?? 'unknown',
    confidence: claim.confidence ?? 'unknown',
    claimType: claim.claimType ?? 'unknown',
    findings,
    citedInScript: entries.length > 0,
    scriptLines: entries.map((entry) => entry.line).filter((line): line is string => Boolean(line)),
  };
}

function provenanceFindings(revision: ScriptRevisionRecord): ClaimCoverageFinding[] {
  const validation = asObject(revision.metadata.validation);
  const provenance = asObject(validation.provenance);
  const status = asObject(revision.metadata.provenanceStatus);
  const stale = status.status === 'stale' || status.verified === false;
  const warnings = [
    ...asRecordArray(revision.metadata.warnings),
    ...asRecordArray(asObject(revision.metadata.provenance).warnings),
    ...asRecordArray(provenance.warnings),
  ];
  const findings: ClaimCoverageFinding[] = [];

  if (stale) {
    findings.push(finding({
      category: 'provenance',
      status: 'needs_attention',
      severity: 'warning',
      code: 'STALE_SCRIPT_PROVENANCE',
      message: asString(status.message) ?? 'Script text changed; citation mapping and provenance are stale for this revision.',
      nextAction: 'Rerun integrity review and rebuild or verify citation coverage before production; enforced production gates remain the source of truth for hard blocks.',
    }));
  }

  if (provenance.valid === false) {
    findings.push(finding({
      category: 'provenance',
      status: 'blocking',
      severity: 'blocking',
      code: 'INVALID_SCRIPT_PROVENANCE',
      message: 'Script provenance validation failed.',
      nextAction: 'Resolve provenance validation errors before production.',
    }));
  }

  for (const warning of warnings) {
    const severity = asString(warning.severity);
    findings.push(finding({
      category: 'provenance',
      status: severity === 'error' ? 'blocking' : 'needs_attention',
      severity: severity === 'error' ? 'blocking' : severity === 'info' ? 'info' : 'warning',
      code: asString(warning.code) ?? 'SCRIPT_PROVENANCE_WARNING',
      message: asString(warning.message) ?? 'Script provenance warning requires review.',
      nextAction: severity === 'error'
        ? 'Resolve this provenance error before production.'
        : 'Review this provenance warning before approving production.',
      claimId: asString(asObject(warning.metadata).claimId),
      sourceDocumentIds: asString(warning.sourceDocumentId) ? [asString(warning.sourceDocumentId)!] : undefined,
    }));
  }

  return findings;
}

function researchPacketFindings(packet: ResearchPacketRecord): ClaimCoverageFinding[] {
  const findings: ClaimCoverageFinding[] = [];
  const readiness = asObject(packet.content.readiness);
  const readinessStatus = asString(readiness.status) ?? packet.status;

  if (packet.status === 'blocked' || readinessStatus === 'blocked') {
    findings.push(finding({
      category: 'research',
      status: 'blocking',
      severity: 'blocking',
      code: 'RESEARCH_PACKET_BLOCKED',
      message: 'The research brief is blocked by existing readiness metadata.',
      nextAction: 'Resolve research blockers before relying on the script.',
    }));
  }

  for (const warning of packet.warnings.filter((item) => !item.override)) {
    const metadata = asObject(warning.metadata);
    if (asString(metadata.claimId) || warning.sourceDocumentId || warning.url) {
      continue;
    }

    findings.push(finding({
      category: 'research',
      status: warning.severity === 'error' ? 'blocking' : 'needs_attention',
      severity: warning.severity === 'error' ? 'blocking' : warning.severity === 'warning' ? 'warning' : 'info',
      code: warning.code || 'RESEARCH_WARNING',
      message: warning.message || 'Research warning requires editorial review.',
      nextAction: warning.severity === 'error'
        ? 'Resolve or override this blocking research warning.'
        : 'Review this research warning before approval.',
      sourceDocumentIds: warning.sourceDocumentId ? [warning.sourceDocumentId] : undefined,
      citationUrls: warning.url ? [warning.url] : undefined,
    }));
  }

  return findings;
}

function integrityFindings(revision: ScriptRevisionRecord): ClaimCoverageFinding[] {
  const integrity = integrityGateState(revision);
  const findings: ClaimCoverageFinding[] = [];

  if (integrity.status === 'missing') {
    findings.push(finding({
      category: 'integrity',
      status: 'blocking',
      severity: 'blocking',
      code: 'INTEGRITY_REVIEW_REQUIRED',
      message: 'Integrity review has not been run for this script revision.',
      nextAction: 'Run the integrity reviewer before production.',
    }));
    return findings;
  }

  if (integrity.status === 'overridden') {
    findings.push(finding({
      category: 'integrity',
      status: 'needs_attention',
      severity: 'warning',
      code: 'INTEGRITY_REVIEW_OVERRIDDEN',
      message: 'A blocking integrity review was overridden with an editorial reason.',
      nextAction: 'Review the override reason before publishing.',
    }));
  }

  const review = asObject(integrity.review);
  const result = asObject(review.result);
  const issueGroups: Array<[string, Array<Record<string, unknown>>]> = [
    ['INTEGRITY_CLAIM_ISSUE', asRecordArray(result.claimIssues)],
    ['INTEGRITY_MISSING_CITATION', asRecordArray(result.missingCitations)],
    ['INTEGRITY_UNSUPPORTED_CERTAINTY', asRecordArray(result.unsupportedCertainty)],
    ['INTEGRITY_ATTRIBUTION_WARNING', asRecordArray(result.attributionWarnings)],
    ['INTEGRITY_BALANCE_WARNING', asRecordArray(result.balanceWarnings)],
    ['INTEGRITY_BIAS_SENSATIONALISM_WARNING', asRecordArray(result.biasSensationalismWarnings)],
  ];

  for (const [code, issues] of issueGroups) {
    for (const issue of issues) {
      const critical = asString(issue.severity) === 'critical';
      findings.push(finding({
        category: 'integrity',
        status: critical || integrity.status === 'fail' ? 'blocking' : 'needs_attention',
        severity: critical || integrity.status === 'fail' ? 'blocking' : asString(issue.severity) === 'info' ? 'info' : 'warning',
        code,
        message: asString(issue.issue) ?? asString(issue.message) ?? 'Integrity reviewer flagged this script language.',
        nextAction: asString(issue.suggestedFix) ?? 'Resolve this finding or record an explicit editorial override.',
        claimId: asString(issue.claimId),
        line: asString(issue.scriptExcerpt),
        context: asString(issue.scriptExcerpt),
        sourceDocumentIds: asStringArray(issue.sourceDocumentIds),
        citationUrls: asStringArray(issue.citationUrls),
      }));
    }
  }

  if (integrity.status === 'fail' && !findings.some((item) => item.status === 'blocking')) {
    findings.push(finding({
      category: 'integrity',
      status: 'blocking',
      severity: 'blocking',
      code: 'INTEGRITY_REVIEW_FAILED',
      message: 'Integrity review failed without claim-level details in current metadata.',
      nextAction: 'Inspect the integrity review result, then fix the script or record an explicit override.',
    }));
  }

  return findings;
}

function unknownFindings(packet: ResearchPacketRecord, citationMap: CitationMapEntry[]): ClaimCoverageFinding[] {
  const findings: ClaimCoverageFinding[] = [];

  if (packet.claims.length === 0) {
    findings.push(finding({
      category: 'metadata',
      status: 'unknown',
      severity: 'info',
      code: 'COVERAGE_UNKNOWN_NO_CLAIMS',
      message: 'Coverage unknown from current metadata: the research brief has no extracted claims.',
      nextAction: 'Review source snapshots manually or rebuild the research brief with claim extraction.',
    }));
  }

  if (citationMap.length === 0) {
    findings.push(finding({
      category: 'metadata',
      status: 'unknown',
      severity: 'info',
      code: 'COVERAGE_UNKNOWN_NO_CITATION_MAP',
      message: 'Coverage unknown from current metadata: the script revision has no citation map.',
      nextAction: 'Run or rerun script generation/integrity review to produce citation mapping.',
    }));
  }

  return findings;
}

function headlineFor(status: ClaimCoverageStatus, counts: ClaimCoverageSummary['counts']): string {
  if (status === 'blocking') {
    return `${counts.blockingFindings} blocking coverage finding${counts.blockingFindings === 1 ? '' : 's'} must be resolved or explicitly overridden before production.`;
  }

  if (status === 'needs_attention') {
    return `${counts.needsAttentionFindings} coverage finding${counts.needsAttentionFindings === 1 ? ' needs' : 's need'} editorial attention before relying on this draft.`;
  }

  if (status === 'covered') {
    return `${counts.covered} claim${counts.covered === 1 ? ' has' : 's have'} adequate citation coverage from current metadata.`;
  }

  return 'Coverage unknown from current metadata; verify claims manually before approval.';
}

export function buildClaimCoverageSummary(
  packet: ResearchPacketRecord,
  revision: ScriptRevisionRecord,
  options: { now?: Date } = {},
): ClaimCoverageSummary {
  const now = options.now ?? new Date();
  const citationMap = citationMapEntries(revision);
  const claims = packet.claims.map((claim) => claimItem(packet, claim, citationMap, now));
  const blockerFindings = [
    ...researchPacketFindings(packet),
    ...provenanceFindings(revision),
    ...integrityFindings(revision),
  ];
  const metadataUnknowns = unknownFindings(packet, citationMap);
  const allFindings = [
    ...claims.flatMap((claim) => claim.findings),
    ...blockerFindings,
    ...metadataUnknowns,
  ];
  const blockers = allFindings.filter((item) => item.status === 'blocking');
  const needsAttention = allFindings.filter((item) => item.status === 'needs_attention');
  const unknowns = allFindings.filter((item) => item.status === 'unknown');
  const coveredClaims = claims.filter((claim) => claim.status === 'covered');
  const counts = {
    totalClaims: claims.length,
    covered: coveredClaims.length,
    needsAttention: claims.filter((claim) => claim.status === 'needs_attention').length,
    blocking: claims.filter((claim) => claim.status === 'blocking').length,
    unknown: claims.filter((claim) => claim.status === 'unknown').length,
    blockingFindings: blockers.length,
    needsAttentionFindings: needsAttention.length,
    integrityFindings: allFindings.filter((item) => item.category === 'integrity').length,
  };
  const status: ClaimCoverageStatus = blockers.length > 0
    ? 'blocking'
    : unknowns.length > 0 || claims.length === 0
      ? 'unknown'
      : needsAttention.length > 0
        ? 'needs_attention'
        : 'covered';

  return {
    status,
    headline: headlineFor(status, counts),
    counts,
    blockers,
    needsAttention,
    unknowns,
    coveredClaims,
    claims,
  };
}
