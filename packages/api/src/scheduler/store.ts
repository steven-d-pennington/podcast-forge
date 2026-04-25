import type { JobRecord } from '../search/store.js';

export type ScheduledPipelineStage = 'ingest' | 'research' | 'script' | 'audio' | 'publish';

export interface ScheduledPipelineRecord {
  id: string;
  showId: string;
  feedId: string | null;
  sourceProfileId: string | null;
  slug: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  workflow: ScheduledPipelineStage[];
  autopublish: boolean;
  legacyAdapter: Record<string, unknown>;
  config: Record<string, unknown>;
  lastRunJobId: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduledPipelineInput {
  showId: string;
  feedId?: string | null;
  sourceProfileId?: string | null;
  slug: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  workflow: ScheduledPipelineStage[];
  autopublish: boolean;
  legacyAdapter: Record<string, unknown>;
  config: Record<string, unknown>;
  nextRunAt?: Date | null;
}

export type UpdateScheduledPipelineInput = Partial<Omit<CreateScheduledPipelineInput, 'showId'>>;

export interface ScheduledPipelineListFilter {
  showId?: string;
  enabledOnly?: boolean;
  dueAt?: Date;
  limit?: number;
}

export interface ScheduledRunListFilter {
  showId?: string;
  scheduledPipelineId?: string;
  status?: JobRecord['status'];
  limit?: number;
}

export interface SchedulerStore {
  createScheduledPipeline(input: CreateScheduledPipelineInput): Promise<ScheduledPipelineRecord>;
  updateScheduledPipeline(id: string, input: UpdateScheduledPipelineInput): Promise<ScheduledPipelineRecord | undefined>;
  getScheduledPipeline(id: string): Promise<ScheduledPipelineRecord | undefined>;
  listScheduledPipelines(filter?: ScheduledPipelineListFilter): Promise<ScheduledPipelineRecord[]>;
  markScheduledPipelineRun(input: {
    id: string;
    jobId: string;
    lastRunAt: Date;
    nextRunAt: Date | null;
  }): Promise<ScheduledPipelineRecord | undefined>;
  listScheduledRuns(filter?: ScheduledRunListFilter): Promise<JobRecord[]>;
}
