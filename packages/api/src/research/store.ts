import type { StoryCandidateRecord } from '../search/store.js';

export type SourceDocumentStatus = 'fetched' | 'failed';

export interface SourceDocumentRecord {
  id: string;
  storyCandidateId: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  fetchedAt: Date;
  fetchStatus: string;
  httpStatus: number | null;
  contentType: string | null;
  textContent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResearchWarning {
  id: string;
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  sourceDocumentId?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  override?: {
    actor: string;
    reason: string;
    overriddenAt: string;
  };
}

export interface ResearchClaim {
  id: string;
  text: string;
  sourceDocumentIds: string[];
  citationUrls: string[];
  claimType?: 'fact' | 'quote' | 'interpretation' | 'uncertain';
  confidence?: 'low' | 'medium' | 'high';
  supportLevel?: 'single_source' | 'corroborated' | 'uncorroborated' | 'contradicted' | 'unknown';
  highStakes?: boolean;
  caveat?: string;
}

export interface ResearchCitation {
  sourceDocumentId: string;
  url: string;
  title: string | null;
  fetchedAt: string;
  status: string;
}

export interface ResearchPacketRecord {
  id: string;
  showId: string;
  episodeCandidateId: string | null;
  title: string;
  status: string;
  sourceDocumentIds: string[];
  claims: ResearchClaim[];
  citations: ResearchCitation[];
  warnings: ResearchWarning[];
  content: Record<string, unknown>;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSourceDocumentInput {
  storyCandidateId: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  fetchedAt: Date;
  fetchStatus: SourceDocumentStatus;
  httpStatus: number | null;
  contentType: string | null;
  textContent: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateResearchPacketInput {
  showId: string;
  episodeCandidateId: string | null;
  title: string;
  status: string;
  sourceDocumentIds: string[];
  claims: ResearchClaim[];
  citations: ResearchCitation[];
  warnings: ResearchWarning[];
  content: Record<string, unknown>;
}

export interface OverrideResearchWarningInput {
  warningId?: string;
  warningCode?: string;
  actor: string;
  reason: string;
}

export interface ResearchPacketListFilter {
  showId?: string;
  showSlug?: string;
  limit?: number;
}

export interface ResearchStore {
  getStoryCandidate(id: string): Promise<StoryCandidateRecord | undefined>;
  createSourceDocument(input: CreateSourceDocumentInput): Promise<SourceDocumentRecord>;
  createResearchPacket(input: CreateResearchPacketInput): Promise<ResearchPacketRecord>;
  getResearchPacket(id: string): Promise<ResearchPacketRecord | undefined>;
  listResearchPackets(filter?: ResearchPacketListFilter): Promise<ResearchPacketRecord[]>;
  overrideResearchWarning(id: string, input: OverrideResearchWarningInput): Promise<ResearchPacketRecord | undefined>;
}
