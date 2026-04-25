import type { StoryCandidateRecord } from '../search/store.js';
import type {
  CreateResearchPacketInput,
  ResearchCitation,
  ResearchClaim,
  ResearchWarning,
  SourceDocumentRecord,
} from './store.js';

const MIN_TEXT_LENGTH = 120;

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

export function buildResearchPacketInput(
  candidate: StoryCandidateRecord,
  documents: SourceDocumentRecord[],
): CreateResearchPacketInput {
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
  const warnings: ResearchWarning[] = [];

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

  if (independentHosts.size < 2) {
    warnings.push({
      id: 'INSUFFICIENT_INDEPENDENT_SOURCES',
      code: 'INSUFFICIENT_INDEPENDENT_SOURCES',
      severity: 'warning',
      message: 'Research packet needs at least two fetched sources from distinct hostnames.',
      metadata: {
        independentHostCount: independentHosts.size,
        minimumIndependentHosts: 2,
      },
    });
  }

  const primaryCitationUrls = usableDocuments.slice(0, 2).map((document) => document.canonicalUrl ?? document.url);
  const primarySourceIds = usableDocuments.slice(0, 2).map((document) => document.id);
  const claims: ResearchClaim[] = [];

  if (primarySourceIds.length > 0) {
    claims.push({
      id: 'claim-1',
      text: candidate.summary || `${candidate.title} is the selected story candidate for research.`,
      sourceDocumentIds: primarySourceIds,
      citationUrls: primaryCitationUrls,
    });
  }

  for (const document of usableDocuments.slice(0, 3)) {
    claims.push({
      id: `claim-${claims.length + 1}`,
      text: `${sourceLabel(document)} reports: ${firstSentence(document.textContent ?? '')}`,
      sourceDocumentIds: [document.id],
      citationUrls: [document.canonicalUrl ?? document.url],
    });
  }

  const sourceSummary = usableDocuments.length > 0
    ? usableDocuments.map(sourceLabel).join('; ')
    : 'No fetched sources had enough readable text.';
  const summary = [
    `Research packet for "${candidate.title}".`,
    candidate.summary ? `Candidate summary: ${candidate.summary}` : undefined,
    `Usable sources: ${sourceSummary}`,
  ].filter(Boolean).join(' ');

  return {
    showId: candidate.showId,
    episodeCandidateId: null,
    title: candidate.title,
    status: warnings.length > 0 ? 'needs-review' : 'ready',
    sourceDocumentIds: documents.map((document) => document.id),
    claims,
    citations,
    warnings,
    content: {
      storyCandidateId: candidate.id,
      summary,
      independentHostCount: independentHosts.size,
      usableSourceCount: usableDocuments.length,
    },
  };
}
