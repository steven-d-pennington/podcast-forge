import type { JobRecord } from '../search/store.js';

export interface JobRetryInfo {
  supported: boolean;
  reason: string;
  endpoint?: string;
  method?: 'POST';
  requiresConfirmation?: boolean;
}

export interface JobArtifactRef {
  label: string;
  value: string;
}

export interface JobSummary {
  warnings: Array<Record<string, unknown>>;
  failure: Record<string, unknown> | null;
  retry: JobRetryInfo;
  artifacts: JobArtifactRef[];
  provider: Record<string, unknown>;
}

export type JobResponseRecord = JobRecord & {
  summary: JobSummary;
};

const SENSITIVE_KEY_PATTERN = /api.?key|authorization|cookie|credential|password|private.?key|provider.?response|raw.?response|secret|token/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hideLocalPath(value: string) {
  return value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value);
}

export function sanitizeJobValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && hideLocalPath(value) ? '[hidden local path]' : value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeJobValue);
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[hidden]';
    } else {
      result[key] = sanitizeJobValue(item);
    }
  }

  return result;
}

function collectWarningItems(value: unknown): Array<Record<string, unknown>> {
  return asArray(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => sanitizeJobValue(item) as Record<string, unknown>);
}

function warningLogItems(logs: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return logs
    .filter((item) => item.level === 'warn' || item.level === 'warning')
    .map((item) => sanitizeJobValue(item) as Record<string, unknown>);
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }

  return asArray(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function addArtifact(artifacts: JobArtifactRef[], label: string, value: unknown) {
  for (const item of stringList(value)) {
    if (!artifacts.some((artifact) => artifact.label === label && artifact.value === item)) {
      artifacts.push({ label, value: item });
    }
  }
}

function artifactRefs(job: JobRecord): JobArtifactRef[] {
  const input = asRecord(job.input);
  const output = asRecord(job.output);
  const artifacts: JobArtifactRef[] = [];

  for (const source of [input, output]) {
    addArtifact(artifacts, 'source profile', source.sourceProfileId);
    addArtifact(artifacts, 'source profile', source.sourceProfileSlug);
    addArtifact(artifacts, 'search query', source.queryIds);
    addArtifact(artifacts, 'scheduled pipeline', source.scheduledPipelineId);
    addArtifact(artifacts, 'scheduled pipeline', source.scheduledPipelineSlug);
    addArtifact(artifacts, 'candidate story', source.storyCandidateId);
    addArtifact(artifacts, 'candidate story', source.candidateIds);
    addArtifact(artifacts, 'research brief', source.researchPacketId);
    addArtifact(artifacts, 'source document', source.sourceDocumentIds);
    addArtifact(artifacts, 'failed source document', source.failedSourceDocumentIds);
    addArtifact(artifacts, 'script', source.scriptId);
    addArtifact(artifacts, 'script revision', source.revisionId);
    addArtifact(artifacts, 'episode', source.episodeId);
    addArtifact(artifacts, 'audio asset', source.audioPreviewAssetId);
    addArtifact(artifacts, 'cover asset', source.coverArtAssetId);
    addArtifact(artifacts, 'asset', source.assetId);
    addArtifact(artifacts, 'feed', source.feedId);
    addArtifact(artifacts, 'publishing record', source.publishEventId);
  }

  if (job.episodeId) {
    addArtifact(artifacts, 'episode', job.episodeId);
  }

  return artifacts;
}

function providerMetadata(job: JobRecord): Record<string, unknown> {
  const input = asRecord(job.input);
  const output = asRecord(job.output);
  const provider: Record<string, unknown> = {};

  const entries: Array<[string, unknown]> = [
    ['provider', input.provider ?? output.provider],
    ['adapter', input.adapter ?? output.adapter],
    ['modelProfile', input.modelProfile ?? output.modelProfile],
    ['modelProfiles', input.modelProfiles ?? output.modelProfiles],
    ['promptMetadata', input.promptMetadata ?? output.promptMetadata],
  ];

  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) {
      provider[key] = sanitizeJobValue(value);
    }
  }

  return provider;
}

function retryableFlag(job: JobRecord): boolean {
  const output = asRecord(job.output);
  const failure = asRecord(output.failure);

  if (typeof failure.retryable === 'boolean') {
    return failure.retryable;
  }

  if (typeof output.retryable === 'boolean') {
    return output.retryable;
  }

  return true;
}

function retryInfo(job: JobRecord): JobRetryInfo {
  if (job.status !== 'failed') {
    return {
      supported: false,
      reason: 'Only failed task runs can be retried.',
    };
  }

  if (!retryableFlag(job)) {
    return {
      supported: false,
      reason: 'This failure is marked non-retryable. Fix the blocking input or approval state first.',
    };
  }

  if (job.type === 'pipeline.scheduled') {
    return {
      supported: true,
      method: 'POST',
      endpoint: `/scheduled-pipeline-runs/${job.id}/retry`,
      reason: 'Creates a new scheduled run linked to this failed run.',
    };
  }

  const scriptId = asRecord(job.input).scriptId;
  if ((job.type === 'audio.preview' || job.type === 'art.generate') && typeof scriptId === 'string') {
    return {
      supported: true,
      method: 'POST',
      endpoint: `/scripts/${scriptId}/production/${job.type === 'audio.preview' ? 'audio-preview' : 'cover-art'}`,
      reason: 'Creates a new production task from the approved script revision.',
    };
  }

  if (job.type === 'publish.rss') {
    return {
      supported: false,
      requiresConfirmation: true,
      reason: 'RSS publishing is never auto-retried. Use the explicit publish action after reviewing the failure.',
    };
  }

  if (job.type === 'source.search' || job.type === 'source.ingest') {
    return {
      supported: false,
      reason: 'Run the selected story source/search recipe again; this task type does not have a direct retry endpoint yet.',
    };
  }

  return {
    supported: false,
    reason: 'No safe retry endpoint is registered for this task type yet.',
  };
}

function failureInfo(job: JobRecord): Record<string, unknown> | null {
  const output = asRecord(job.output);
  const failure = asRecord(output.failure);
  const message = typeof failure.message === 'string' ? failure.message : job.error;

  if (!message) {
    return null;
  }

  return sanitizeJobValue({
    message,
    code: typeof failure.code === 'string' ? failure.code : undefined,
    retryable: typeof failure.retryable === 'boolean' ? failure.retryable : undefined,
  }) as Record<string, unknown>;
}

export function normalizeJobRecord(job: JobRecord): JobResponseRecord {
  const input = sanitizeJobValue(job.input) as Record<string, unknown>;
  const output = sanitizeJobValue(job.output) as Record<string, unknown>;
  const logs = sanitizeJobValue(job.logs) as Array<Record<string, unknown>>;

  const warnings = [
    ...collectWarningItems(input.warnings),
    ...collectWarningItems(output.warnings),
    ...warningLogItems(logs),
  ];

  return {
    ...job,
    input,
    output,
    logs,
    summary: {
      warnings,
      failure: failureInfo({ ...job, input, output, logs }),
      retry: retryInfo({ ...job, input, output, logs }),
      artifacts: artifactRefs({ ...job, input, output, logs }),
      provider: providerMetadata({ ...job, input, output, logs }),
    },
  };
}
