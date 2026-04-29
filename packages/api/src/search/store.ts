import type { SourceCandidate } from './candidate.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  showId: string | null;
  episodeId: string | null;
  type: string;
  status: JobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  logs: Array<Record<string, unknown>>;
  error: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryCandidateRecord {
  id: string;
  showId: string;
  sourceProfileId: string | null;
  sourceQueryId: string | null;
  title: string;
  url: string | null;
  canonicalUrl: string | null;
  sourceName: string | null;
  author: string | null;
  summary: string | null;
  publishedAt: Date | null;
  discoveredAt: Date;
  score: number | null;
  scoreBreakdown: Record<string, unknown>;
  status: 'new' | 'shortlisted' | 'ignored' | 'merged';
  rawPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateDedupeKey {
  title: string;
  canonicalUrl: string | null;
}

export interface CreateJobInput {
  showId: string | null;
  episodeId?: string | null;
  type: string;
  status: JobStatus;
  progress: number;
  attempts?: number;
  maxAttempts?: number;
  input: Record<string, unknown>;
  logs?: Array<Record<string, unknown>>;
  startedAt?: Date | null;
}

export interface UpdateJobInput {
  status?: JobStatus;
  progress?: number;
  output?: Record<string, unknown>;
  logs?: Array<Record<string, unknown>>;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export interface JobListFilter {
  showId?: string;
  episodeId?: string;
  types?: string[];
  limit?: number;
}

export interface CreateStoryCandidateInput extends SourceCandidate {
  showId: string;
  sourceProfileId: string | null;
  sourceQueryId: string | null;
}

export interface StoryCandidateListFilter {
  showId: string;
  limit?: number;
  sort?: 'score' | 'discovered';
  includeIgnored?: boolean;
}

export interface UpdateStoryCandidateStatusInput {
  status: 'new' | 'shortlisted' | 'ignored' | 'merged';
  metadata?: Record<string, unknown>;
}

export interface ClearStoryCandidatesInput {
  showId: string;
  sourceProfileId?: string;
  status?: 'ignored';
  metadata?: Record<string, unknown>;
}

export interface UpdateStoryCandidateScoringInput {
  score: number | null;
  scoreBreakdown: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface SearchJobStore {
  createJob(input: CreateJobInput): Promise<JobRecord>;
  updateJob(id: string, input: UpdateJobInput): Promise<JobRecord | undefined>;
  getJob(id: string): Promise<JobRecord | undefined>;
  listJobs(filter?: JobListFilter): Promise<JobRecord[]>;
  listStoryCandidateDedupeKeys(showId: string): Promise<CandidateDedupeKey[]>;
  insertStoryCandidate(input: CreateStoryCandidateInput): Promise<StoryCandidateRecord | undefined>;
  updateStoryCandidateScoring(id: string, input: UpdateStoryCandidateScoringInput): Promise<StoryCandidateRecord | undefined>;
  updateStoryCandidateStatus(id: string, input: UpdateStoryCandidateStatusInput): Promise<StoryCandidateRecord | undefined>;
  clearStoryCandidates(input: ClearStoryCandidatesInput): Promise<{ updated: number }>;
  listStoryCandidates(filter: StoryCandidateListFilter): Promise<StoryCandidateRecord[]>;
}
