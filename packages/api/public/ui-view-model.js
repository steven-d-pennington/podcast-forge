import {
  publicAssetBaseForFeed,
  publishTargetConfiguredForFeed,
  sourceActionDescription,
  sourceActionLabel,
  sourceConstraintsSummary,
  sourceCredentialSummary,
  sourceDiscoveryBlocker,
  sourceInputSummary,
  sourceLastResultSummary,
  sourceProviderLabel,
  validHttpUrl,
} from './ui-formatters.js';

const STAGE_DEFINITIONS = [
  { id: 'show', label: 'Choose show' },
  { id: 'source', label: 'Choose story source' },
  { id: 'discover', label: 'Find story candidates' },
  { id: 'story', label: 'Pick / cluster story' },
  { id: 'brief', label: 'Build research brief' },
  { id: 'script', label: 'Generate script' },
  { id: 'review', label: 'Integrity review' },
  { id: 'production', label: 'Produce audio / cover' },
  { id: 'publishing', label: 'Approve and publish' },
];

const AUDIO_COVER_ASSET_TYPES = new Set(['audio-preview', 'audio-final', 'cover-art']);

function isAudioCoverAsset(asset) {
  return AUDIO_COVER_ASSET_TYPES.has(asset?.type);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function timestamp(value) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function latest(items) {
  return asArray(items).reduce((selected, item) => {
    if (!selected) {
      return item;
    }
    const itemTime = timestamp(item.updatedAt || item.createdAt || item.generatedAt || item.discoveredAt || item.publishedAt);
    const selectedTime = timestamp(selected.updatedAt || selected.createdAt || selected.generatedAt || selected.discoveredAt || selected.publishedAt);
    return itemTime > selectedTime ? item : selected;
  }, null);
}

function newest(items) {
  return [...asArray(items)].sort((left, right) => (
    timestamp(right.updatedAt || right.createdAt || right.generatedAt || right.discoveredAt || right.publishedAt)
    - timestamp(left.updatedAt || left.createdAt || left.generatedAt || left.discoveredAt || left.publishedAt)
  ));
}

function uniqueById(items) {
  const selected = new Map();
  for (const item of asArray(items)) {
    const key = item?.id || `${item?.type || 'item'}:${item?.createdAt || selected.size}`;
    const existing = selected.get(key);
    if (!existing || timestamp(item?.updatedAt || item?.createdAt || item?.generatedAt || item?.discoveredAt || item?.publishedAt) >= timestamp(existing.updatedAt || existing.createdAt || existing.generatedAt || existing.discoveredAt || existing.publishedAt)) {
      selected.set(key, item);
    }
  }
  return [...selected.values()];
}

function firstPresent(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function summarizeShow(show) {
  if (!show) {
    return null;
  }

  return compactObject({
    id: show.id,
    slug: show.slug,
    title: show.title || show.slug || 'Untitled show',
    setupStatus: show.setupStatus,
    format: show.format,
    defaultRuntimeMinutes: show.defaultRuntimeMinutes,
  });
}

function summarizeSource(profile, queries = [], jobs = []) {
  if (!profile) {
    return null;
  }

  const enabledQueries = asArray(queries).filter((query) => query.enabled !== false);
  const credential = sourceCredentialSummary(profile);
  const blocker = sourceDiscoveryBlocker(profile, queries);
  return compactObject({
    id: profile.id,
    slug: profile.slug,
    name: profile.name || profile.slug || 'Untitled story source',
    type: profile.type,
    providerType: sourceProviderLabel(profile.type),
    enabled: profile.enabled !== false,
    statusLabel: profile.enabled !== false ? 'Enabled' : 'Disabled',
    weight: profile.weight,
    freshness: profile.freshness || null,
    queryCount: asArray(queries).length,
    enabledQueryCount: enabledQueries.length,
    inputSummary: sourceInputSummary(profile, queries),
    constraintsSummary: sourceConstraintsSummary(profile, queries),
    credentialStatus: credential.status,
    credentialLabel: credential.label,
    credentialRequired: credential.required,
    nextActionLabel: sourceActionLabel(profile.type),
    nextActionDescription: sourceActionDescription(profile, queries),
    discoveryReady: !blocker,
    discoveryBlocker: blocker || null,
    lastSearchResult: sourceLastResultSummary(profile, jobs),
  });
}

function summarizeCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  return compactObject({
    id: candidate.id,
    title: candidate.title || 'Untitled candidate story',
    status: candidate.status || 'unknown',
    sourceName: candidate.sourceName || null,
    url: candidate.canonicalUrl || candidate.url || null,
    score: candidate.score ?? null,
    discoveredAt: candidate.discoveredAt,
    publishedAt: candidate.publishedAt,
  });
}

function summarizeCandidates(candidates) {
  const items = asArray(candidates).map(summarizeCandidate).filter(Boolean);
  return {
    count: items.length,
    primary: items[0] || null,
    items,
  };
}

function researchStatus(packet) {
  if (!packet) {
    return 'unknown';
  }

  return asObject(packet.content?.readiness).status || packet.status || 'unknown';
}

function researchReady(packet) {
  return ['ready', 'approved', 'research-ready'].includes(researchStatus(packet));
}

function summarizeBrief(packet) {
  if (!packet) {
    return null;
  }

  const warnings = asArray(packet.warnings);
  return compactObject({
    id: packet.id,
    stage: 'brief',
    type: 'research-brief',
    trustKind: 'sourceEvidence',
    title: packet.title || 'Untitled research brief',
    status: researchStatus(packet),
    approved: Boolean(packet.approvedAt),
    reviewDecisionLabel: packet.approvedAt ? `Review decision recorded ${packet.approvedAt}` : 'Review decision not recorded',
    warningCount: warnings.length,
    unresolvedWarningCount: warnings.filter((warning) => !warning.override).length,
    warningTrustKind: warnings.some((warning) => !warning.override) ? 'unresolvedWarning' : null,
    citationCount: asArray(packet.citations).length,
    createdAt: packet.createdAt,
    updatedAt: packet.updatedAt,
  });
}

function markArtifact(summary, state, reason = '') {
  if (!summary) {
    return null;
  }

  return compactObject({
    ...summary,
    artifactState: state,
    stateLabel: state === 'active' ? 'Active/current' : 'History/archive',
    stateWarning: reason || undefined,
  });
}

function summarizeScript(script, revision = null) {
  if (!script) {
    return null;
  }

  return compactObject({
    id: script.id,
    stage: 'script',
    type: 'script-draft',
    trustKind: 'aiOutput',
    title: script.title || revision?.title || 'Untitled script',
    status: script.status || 'unknown',
    approvedRevisionId: script.approvedRevisionId || null,
    reviewDecisionLabel: script.approvedRevisionId ? 'Script review decision recorded' : 'Script review decision not recorded',
    revisionId: revision?.id || null,
    revisionVersion: revision?.version ?? null,
    revisionCreatedAt: revision?.createdAt,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  });
}

export function integrityReviewState(revision) {
  const review = asObject(revision?.metadata?.integrityReview);
  const override = asObject(review.override);
  const overrideReason = typeof override.reason === 'string' ? override.reason.trim() : '';

  if (overrideReason) {
    return {
      status: 'overridden',
      blocking: false,
      review,
      override,
    };
  }

  const allowed = new Set(['pass', 'pass_with_notes', 'fail', 'missing']);
  const status = allowed.has(review.status) ? review.status : 'missing';
  return {
    status,
    blocking: status === 'fail' || status === 'missing',
    review: status === 'missing' && !review.status ? null : review,
    override: null,
  };
}

function summarizeReview(revision) {
  if (!revision) {
    return null;
  }

  const integrity = integrityReviewState(revision);
  return compactObject({
    id: revision.id,
    stage: 'review',
    type: 'integrity-review',
    trustKind: integrity.override ? 'reviewDecision' : 'aiOutput',
    status: integrity.status,
    blocking: integrity.blocking,
    blockerTrustKind: integrity.blocking ? 'blocker' : null,
    overrideReason: integrity.override?.reason || null,
    reviewedAt: integrity.review?.reviewedAt || integrity.review?.generatedAt || revision.updatedAt || revision.createdAt,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
  });
}

function revisionProvenanceState(revision) {
  const status = asObject(revision?.metadata?.provenanceStatus);
  const stale = status.status === 'stale' || status.verified === false;
  return {
    stale,
    status: stale ? 'stale' : status.status || 'current',
    message: typeof status.message === 'string' && status.message.trim()
      ? status.message.trim()
      : 'This revision needs current citation mapping and provenance review before production.',
  };
}

function summarizeScriptReviewWorkspace(script, revision, coverageSummary, coachingActions) {
  if (!script || !revision) {
    return {
      status: 'empty',
      emptyState: 'Generate or select a script draft before reviewing revision approval, integrity, citations, or AI coaching actions.',
      recoveryAction: 'Select a ready research brief, generate a script draft, then run integrity review before production.',
    };
  }

  const integrity = integrityReviewState(revision);
  const provenance = revisionProvenanceState(revision);
  const validation = asObject(revision.metadata?.validation);
  const provenanceValidation = asObject(validation.provenance);
  const warningCount = [
    ...asArray(revision.metadata?.warnings),
    ...asArray(revision.metadata?.provenance?.warnings),
    ...asArray(provenanceValidation.warnings),
  ].length + (provenance.stale ? 1 : 0);
  const approvedCurrentRevision = script.status === 'approved-for-audio' && script.approvedRevisionId === revision.id;
  const approvalStale = Boolean(script.approvedRevisionId && script.approvedRevisionId !== revision.id);
  const coverageStatus = coverageSummary?.status || (provenance.stale || warningCount > 0 ? 'needs_attention' : 'unknown');

  return {
    status: approvedCurrentRevision && !integrity.blocking ? 'ready' : 'needs-review',
    currentRevision: summarizeScript(script, revision),
    approval: {
      approved: approvedCurrentRevision,
      stale: approvalStale,
      label: approvedCurrentRevision
        ? 'Current revision approved for audio'
        : approvalStale
          ? `Prior approval belongs to revision ${script.approvedRevisionId}; this revision needs a fresh review decision.`
          : 'Current revision is not approved for audio',
    },
    integrity: {
      status: integrity.status,
      blocking: integrity.blocking,
      label: integrity.status === 'missing'
        ? 'Integrity review not run for this revision'
        : integrity.blocking
          ? 'Integrity review is blocking production'
          : integrity.status === 'overridden' ? 'Integrity override recorded' : `Integrity review ${integrity.status}`,
    },
    sourceCitation: {
      status: provenance.stale ? 'stale' : coverageStatus,
      stale: provenance.stale,
      warningCount,
      coverageStatus,
      label: provenance.stale
        ? provenance.message
        : warningCount > 0
          ? `${warningCount} source/citation warning${warningCount === 1 ? '' : 's'} need review.`
          : coverageSummary?.headline || 'Source and citation coverage is current or not flagged by metadata.',
    },
    coaching: {
      availableActionCount: asArray(coachingActions).length,
      actions: asArray(coachingActions).map((item) => ({
        action: item.action,
        label: item.label,
        description: item.description,
      })),
      label: asArray(coachingActions).length > 0
        ? `${asArray(coachingActions).length} AI coaching action${asArray(coachingActions).length === 1 ? '' : 's'} available; each creates a new unapproved revision.`
        : 'No AI coaching actions are available from the API.',
    },
  };
}

function summarizeAsset(asset) {
  if (!asset) {
    return null;
  }

  return compactObject({
    id: asset.id,
    stage: 'production',
    trustKind: 'aiOutput',
    productionKind: asset.type === 'cover-art' ? 'cover' : 'audio',
    type: asset.type,
    status: asset.status || 'ready',
    url: asset.publicUrl || asset.url || asset.metadata?.publicUrl || null,
    mimeType: asset.mimeType || null,
    byteSize: asset.byteSize ?? null,
    durationSeconds: asset.durationSeconds ?? asset.metadata?.durationSeconds ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  });
}

function summarizeAudioCover(assets) {
  const latestAudio = latest(asArray(assets).filter((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview'));
  const latestCover = latest(asArray(assets).filter((asset) => asset.type === 'cover-art'));

  if (!latestAudio && !latestCover) {
    return null;
  }

  return {
    stage: 'production',
    type: 'audio-cover',
    status: latestAudio && latestCover ? 'ready' : 'partial',
    audio: summarizeAsset(latestAudio),
    cover: summarizeAsset(latestCover),
  };
}

function summarizeEpisode(episode) {
  if (!episode) {
    return null;
  }

  return compactObject({
    id: episode.id,
    stage: 'publishing',
    type: 'episode',
    trustKind: ['approved-for-publish', 'published'].includes(episode.status) ? 'reviewDecision' : 'auditDetail',
    title: episode.title || episode.slug || 'Untitled episode',
    slug: episode.slug,
    status: episode.status || 'unknown',
    feedId: episode.feedId || null,
    feedGuid: episode.feedGuid || null,
    publishedAt: episode.publishedAt,
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt,
  });
}

function summarizeAudioCoverReviewWorkspace(activeAssets, historicalAudioCover) {
  const audio = latest(asArray(activeAssets).filter((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview'));
  const cover = latest(asArray(activeAssets).filter((asset) => asset.type === 'cover-art'));
  const archived = asArray(historicalAudioCover);
  return {
    status: audio && cover ? 'ready' : audio || cover ? 'partial' : 'empty',
    active: {
      audio: summarizeAsset(audio),
      cover: summarizeAsset(cover),
    },
    archived,
    emptyState: audio || cover
      ? 'One active/current production asset is missing. Create the missing preview MP3 or cover art before publish approval.'
      : 'No active/current audio or cover assets are selected for this production path.',
    recoveryAction: 'Approve the current script revision with a non-blocking integrity review, then create missing audio and cover assets.',
    archiveNote: archived.length > 0
      ? 'History/archive assets remain available for audit only and are not used by publish approval.'
      : 'No history/archive audio or cover assets are attached to this path.',
  };
}

function summarizeJob(job) {
  if (!job) {
    return null;
  }

  return compactObject({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.error || job.summary?.message || job.summary?.status || null,
    warningCount: [
      ...asArray(job.summary?.warnings),
      ...asArray(job.output?.warnings),
    ].length,
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
  });
}

function jobWarnings(job) {
  return [
    ...asArray(job?.summary?.warnings),
    ...asArray(job?.output?.warnings),
  ].filter(Boolean);
}

function jobResultStage(job) {
  return {
    'source.search': 'discover',
    'source.ingest': 'discover',
    'research.packet': 'brief',
    'script.generate': 'script',
    'script.integrity_review': 'review',
    'audio.preview': 'production',
    'art.generate': 'production',
    'publish.rss': 'publishing',
  }[job?.type] || 'workflow';
}

function jobResultLabel(job) {
  return {
    'source.search': 'Source search',
    'source.ingest': 'RSS import',
    'research.packet': 'Research brief build',
    'script.generate': 'Script generation',
    'script.integrity_review': 'Integrity review',
    'audio.preview': 'Preview audio',
    'art.generate': 'Cover art',
    'publish.rss': 'RSS publishing',
  }[job?.type] || job?.type || 'Task run';
}

function jobResultStatus(job) {
  if (!job) {
    return 'idle';
  }

  if (job.status === 'failed') {
    return 'failed';
  }

  if (job.status === 'cancelled') {
    return 'warning';
  }

  if (jobWarnings(job).length > 0 && ['succeeded', 'completed', 'done'].includes(job.status)) {
    return 'warning';
  }

  return job.status || 'updated';
}

function jobCountParts(job) {
  const output = asObject(job?.output);
  const parts = [];
  if (typeof output.inserted === 'number') {
    parts.push(`${output.inserted} inserted`);
  }
  if (typeof output.updated === 'number') {
    parts.push(`${output.updated} updated`);
  }
  if (typeof output.skipped === 'number') {
    parts.push(`${output.skipped} skipped`);
  }
  const warnings = jobWarnings(job);
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  }
  return parts;
}

function jobResultMessage(job) {
  const label = jobResultLabel(job);
  const status = job?.status || 'updated';
  const parts = jobCountParts(job);

  if (parts.length > 0) {
    return `${label} ${status}: ${parts.join(', ')}.`;
  }

  const message = firstPresent(
    job?.summary?.message,
    job?.summary?.status,
    job?.summary?.failure?.message,
    job?.error,
  );
  return message ? `${label} ${status}: ${message}` : `${label} ${status}.`;
}

function jobResultNextStep(job) {
  if (!job) {
    return '';
  }

  const warnings = jobWarnings(job);
  if (job.status === 'failed') {
    return {
      'source.search': 'Check the story source credential/config and enabled search queries before retrying discovery.',
      'source.ingest': 'Check RSS feed URLs and source settings before retrying import.',
      'research.packet': 'Review selected candidate stories and source availability before rebuilding the research brief.',
      'script.generate': 'Select a ready research brief and review task details before retrying script generation.',
      'script.integrity_review': 'Inspect review details, revise unsupported claims, then rerun the integrity reviewer.',
      'audio.preview': 'Review the selected approved script and provider details before retrying preview audio.',
      'art.generate': 'Review cover prompt/provider details before retrying cover art.',
      'publish.rss': 'Complete publish approval, asset, and public URL checks before retrying RSS publishing.',
    }[job.type] || 'Open task details for logs and retry guidance.';
  }

  if (warnings.length > 0) {
    return 'Open task details to inspect the full warning records before relying on this output.';
  }

  if (job.type === 'source.search' || job.type === 'source.ingest') {
    return 'Review candidate stories and select the strongest sourced item for the episode.';
  }

  if (job.type === 'research.packet') {
    return 'Review citations and warnings, then approve the research brief before drafting.';
  }

  if (job.type === 'script.generate') {
    return 'Review the draft, run integrity review, and approve a revision before production.';
  }

  if (job.type === 'audio.preview' || job.type === 'art.generate') {
    return 'Review active audio and cover assets before publish approval.';
  }

  if (job.type === 'publish.rss') {
    return 'Verify the publishing record and public feed URL.';
  }

  return '';
}

function actionResultFromJob(job) {
  const warnings = jobWarnings(job);
  return compactObject({
    id: job?.id ? `job:${job.id}` : undefined,
    status: jobResultStatus(job),
    stage: jobResultStage(job),
    title: jobResultStatus(job) === 'failed' ? 'Latest failure' : 'Latest result',
    message: jobResultMessage(job),
    conciseMessage: jobResultMessage(job),
    nextStep: jobResultNextStep(job),
    source: 'job',
    job: summarizeJob(job),
    warnings: warnings.length > 0 ? warnings : undefined,
    detailLabel: warnings.length > 0 || job?.error ? 'Task warnings and logs remain available in Jobs / Debug.' : 'Task details are available in Jobs / Debug.',
  });
}

function actionResultFromExplicit(input, primaryNextAction, currentStage) {
  const explicit = asObject(input.latestActionResult);
  if (typeof explicit.message !== 'string' || !explicit.message.trim()) {
    return null;
  }

  return compactObject({
    id: explicit.id || 'ui:latest',
    status: explicit.status || 'info',
    stage: explicit.stage || primaryNextAction?.targetStage || currentStage?.id || 'workflow',
    title: explicit.status === 'error' || explicit.status === 'failed' ? 'Latest failure' : 'Latest result',
    message: explicit.message.trim(),
    conciseMessage: explicit.message.trim(),
    nextStep: explicit.nextStep || null,
    source: explicit.source || 'ui',
    debugDetails: explicit.debugDetails || null,
  });
}

function actionResultFromBlockedAction(primaryNextAction) {
  if (!primaryNextAction || primaryNextAction.enabled) {
    return null;
  }

  const reason = primaryNextAction.blockerReason || 'The current workflow state blocks this action.';
  return {
    id: `blocked:${primaryNextAction.targetStage}`,
    status: 'blocked',
    stage: primaryNextAction.targetStage,
    title: 'Action blocked',
    message: `${primaryNextAction.label} blocked: ${reason}`,
    conciseMessage: `${primaryNextAction.label} blocked.`,
    nextStep: reason,
    source: 'workflow',
  };
}

function deriveWorkflowActionFeedback(input, jobs, currentStage, primaryNextAction) {
  const explicit = actionResultFromExplicit(input, primaryNextAction, currentStage);
  if (explicit) {
    return explicit;
  }

  const latestJob = latest(jobs.filter((job) => jobResultStage(job) !== 'workflow')) || latest(jobs);
  const blocked = actionResultFromBlockedAction(primaryNextAction);
  if (blocked && (!latestJob || blocked.stage === jobResultStage(latestJob))) {
    return blocked;
  }

  if (latestJob && ['failed', 'warning'].includes(jobResultStatus(latestJob))) {
    return actionResultFromJob(latestJob);
  }

  if (blocked) {
    return blocked;
  }

  if (latestJob) {
    return actionResultFromJob(latestJob);
  }

  return {
    id: 'idle',
    status: 'idle',
    stage: currentStage?.id || 'workflow',
    title: 'Latest result',
    message: 'No action result recorded yet.',
    conciseMessage: 'No action result recorded yet.',
    nextStep: primaryNextAction?.enabled ? primaryNextAction.label : primaryNextAction?.blockerReason || '',
    source: 'view-model',
  };
}

function unresolvedResearchWarnings(packet) {
  return asArray(packet?.warnings).filter((warning) => !warning.override);
}

function packetCandidateIds(packet) {
  const content = asObject(packet?.content);
  return [
    ...asArray(content.candidateIds),
    ...asArray(content.selectedCandidateIds),
    content.candidateId,
    packet?.storyCandidateId,
  ].filter((id) => typeof id === 'string' && id.trim());
}

function packetMatchesCandidateSelection(packet, selectedCandidateIds) {
  if (!packet) {
    return false;
  }

  if (selectedCandidateIds.size === 0) {
    return true;
  }

  const packetIds = new Set(packetCandidateIds(packet));
  return packetIds.size === selectedCandidateIds.size && [...selectedCandidateIds].every((id) => packetIds.has(id));
}

function episodeMatchesPath(episode, activeBrief, activeScript) {
  if (!episode) {
    return false;
  }

  if (activeScript) {
    const scriptId = episode.metadata?.scriptId;
    if (scriptId && scriptId !== activeScript.id) {
      return false;
    }
  }

  if (activeBrief) {
    return episode.researchPacketId === activeBrief.id || episode.metadata?.researchPacketId === activeBrief.id;
  }

  return true;
}

function activePathWarning(label, title, hasCandidateSelection) {
  const pathDescription = hasCandidateSelection ? 'the selected candidate story' : 'the current production path';
  return `${label}${title ? ` "${title}"` : ''} is not part of current production for ${pathDescription}.`;
}

function jobMatchesProductionPath(job, episode, assets) {
  const episodeId = episode?.id || null;
  const assetIds = new Set(asArray(assets).map((asset) => asset?.id).filter(Boolean));
  if (!episodeId && assetIds.size === 0) {
    return false;
  }

  const jobEpisodeId = firstPresent(
    job?.episodeId,
    job?.summary?.episodeId,
    job?.input?.episodeId,
    job?.output?.episodeId,
    job?.metadata?.episodeId,
  );
  if (episodeId && jobEpisodeId === episodeId) {
    return true;
  }

  const jobAssetId = firstPresent(
    job?.assetId,
    job?.summary?.assetId,
    job?.input?.assetId,
    job?.output?.assetId,
    job?.metadata?.assetId,
  );
  return Boolean(jobAssetId && assetIds.has(jobAssetId));
}

function productionWarnings(episode, assets, jobs) {
  const audioCoverAssets = asArray(assets).filter(isAudioCoverAsset);
  const scopedJobs = asArray(jobs).filter((job) => jobMatchesProductionPath(job, episode, audioCoverAssets));
  return [
    ...asArray(episode?.warnings),
    ...audioCoverAssets.flatMap((asset) => [
      ...asArray(asset?.metadata?.warnings),
      ...asArray(asset?.metadata?.validation?.warnings),
    ]),
    ...scopedJobs.flatMap((job) => asArray(job?.summary?.warnings)),
  ].filter(Boolean);
}

function selectedFeed(feeds, episode, show) {
  const matchingEpisodeFeed = asArray(feeds).find((feed) => feed.id === episode?.feedId);
  if (matchingEpisodeFeed) {
    return matchingEpisodeFeed;
  }

  const showFeeds = show?.id ? asArray(feeds).filter((feed) => feed.showId === show.id) : asArray(feeds);
  return showFeeds.length === 1 ? showFeeds[0] : null;
}

function publishChecklist({ packet, script, revision, episode, assets, feed, jobs }) {
  const audio = latest(asArray(assets).filter((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview'));
  const cover = latest(asArray(assets).filter((asset) => asset.type === 'cover-art'));
  const researchWarnings = unresolvedResearchWarnings(packet);
  const prodWarnings = productionWarnings(episode, assets, jobs);
  const integrity = integrityReviewState(revision);
  const scriptApproved = Boolean(script && revision && script.status === 'approved-for-audio' && script.approvedRevisionId === revision.id);
  const feedPublicUrl = feed?.publicFeedUrl || '';
  const publicBaseUrl = publicAssetBaseForFeed(feed);
  const feedConfigured = Boolean(feed);
  const targetConfigured = publishTargetConfiguredForFeed(feed);
  const feedUrlsValid = (!feedPublicUrl || validHttpUrl(feedPublicUrl)) && (!publicBaseUrl || validHttpUrl(publicBaseUrl));
  const audioValid = Boolean(audio && audio.mimeType && audio.mimeType.startsWith('audio/') && (audio.byteSize === null || audio.byteSize === undefined || audio.byteSize > 0));
  const coverValid = Boolean(cover && cover.mimeType && cover.mimeType.startsWith('image/'));
  const packetReady = researchReady(packet);

  return [
    {
      key: 'research',
      label: 'Research brief approved',
      passed: Boolean(packetReady && packet?.approvedAt && researchWarnings.length === 0),
      reason: !packet
        ? 'Select a research brief.'
        : !packetReady
          ? `Research status is ${researchStatus(packet)}.`
          : researchWarnings.length > 0
            ? `${researchWarnings.length} research warning${researchWarnings.length === 1 ? '' : 's'} need override reasons.`
            : !packet.approvedAt ? 'Approve the research brief after review.' : 'Research review decision recorded.',
    },
    {
      key: 'script',
      label: 'Script approved for audio',
      passed: scriptApproved,
      reason: scriptApproved ? 'Script review decision recorded.' : 'Approve the selected script revision.',
    },
    {
      key: 'integrity',
      label: 'Integrity review passed or overridden',
      passed: Boolean(revision && !integrity.blocking),
      reason: !revision
        ? 'Select a script revision.'
        : integrity.status === 'missing'
          ? 'Run the integrity reviewer before production.'
          : integrity.status === 'fail'
            ? 'Resolve the failed integrity review or record an explicit override reason.'
            : integrity.status === 'overridden' ? 'Integrity review override reason recorded.' : `Integrity review ${integrity.status}.`,
    },
    {
      key: 'audio',
      label: 'Valid audio asset exists',
      passed: audioValid,
      reason: audio ? (audioValid ? 'Audio asset metadata is usable.' : 'Audio asset metadata is incomplete or invalid.') : 'Create a preview MP3 or attach final audio.',
    },
    {
      key: 'cover',
      label: 'Cover art asset exists',
      passed: coverValid,
      reason: cover ? (coverValid ? 'Cover art metadata is usable.' : 'Cover art MIME type is not an image.') : 'Create cover art before publishing.',
    },
    {
      key: 'feed',
      label: 'Feed metadata configured',
      passed: feedConfigured && feedUrlsValid,
      reason: !feedConfigured ? 'Configure a feed for this show.' : feedUrlsValid ? 'Feed metadata is available.' : 'Feed public URLs must be valid http(s) URLs.',
    },
    {
      key: 'target',
      label: 'RSS/public target configured',
      passed: feedConfigured && targetConfigured,
      reason: targetConfigured ? 'Public feed URL or RSS path with public base URL is configured.' : 'Configure a public feed URL, or both an RSS path and public base URL.',
    },
    {
      key: 'warnings',
      label: 'No review-blocking warnings remain',
      passed: researchWarnings.length === 0,
      reason: researchWarnings.length > 0
        ? `${researchWarnings.length} research warning${researchWarnings.length === 1 ? '' : 's'} need override reasons before publishing.`
        : prodWarnings.length > 0
          ? `${prodWarnings.length} production warning${prodWarnings.length === 1 ? '' : 's'} visible for review; publish approval records the review decision.`
          : 'No unresolved research warnings are selected.',
    },
    {
      key: 'publishApproval',
      label: 'Episode approved for publishing',
      passed: Boolean(episode && ['approved-for-publish', 'published'].includes(episode.status)),
      reason: episode ? (episode.status === 'published' ? 'Episode is already published.' : episode.status === 'approved-for-publish' ? 'Publish approval recorded.' : 'Approve audio and cover assets for publishing.') : 'Create production assets to create an episode record.',
    },
  ];
}

function makeStage(id, status, artifact = null) {
  const definition = STAGE_DEFINITIONS.find((stage) => stage.id === id);
  return {
    id,
    label: definition?.label || id,
    status,
    artifact,
  };
}

function action(label, targetStage, enabled, blockerReason = '', targetPanelId = null) {
  return {
    label,
    targetStage,
    ...(targetPanelId ? { targetPanelId } : {}),
    enabled: Boolean(enabled),
    blockerReason: enabled ? null : blockerReason || 'The current workflow state blocks this action.',
  };
}

function deriveStages(context) {
  const {
    show,
    source,
    candidates,
    selectedCandidates,
    activeBrief,
    activeScript,
    activeRevision,
    activeEpisode,
    assets,
    jobs,
    feed,
    sourceQueries,
  } = context;
  const integrity = integrityReviewState(activeRevision);
  const scriptApproved = Boolean(activeScript && activeRevision && activeScript.status === 'approved-for-audio' && activeScript.approvedRevisionId === activeRevision.id);
  const readyForProduction = Boolean(scriptApproved && !integrity.blocking);
  const selectedCandidateCount = selectedCandidates.length;
  const hasDownstreamArtifact = Boolean(activeBrief || activeScript || activeRevision || activeEpisode || assets.length > 0);
  const hasCandidatePool = candidates.length > 0 || hasDownstreamArtifact;
  const hasStorySelection = selectedCandidateCount > 0 || hasDownstreamArtifact;
  const unresolvedBriefWarnings = unresolvedResearchWarnings(activeBrief);
  const briefNeedsReview = Boolean(activeBrief && unresolvedBriefWarnings.length > 0);
  const briefReady = researchReady(activeBrief);
  const audio = latest(assets.filter((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview'));
  const cover = latest(assets.filter((asset) => asset.type === 'cover-art'));
  const checklist = publishChecklist({
    packet: activeBrief,
    script: activeScript,
    revision: activeRevision,
    episode: activeEpisode,
    assets,
    feed,
    jobs,
  });
  const publishBlocker = checklist.find((item) => !item.passed);
  const publishPrerequisiteBlocker = checklist.find((item) => !item.passed && item.key !== 'publishApproval');
  const publishApprovalReady = activeEpisode?.status === 'audio-ready';
  const profileSupportsDiscovery = source && ['brave', 'zai-web', 'openrouter-perplexity', 'rss', 'manual'].includes(source.type);
  const sourceBlocker = source ? sourceDiscoveryBlocker(source, sourceQueries) : '';
  const briefBlocked = Boolean(activeBrief && (!briefReady || briefNeedsReview));

  const stages = [
    makeStage('show', show ? 'done' : 'blocked', summarizeShow(show)),
    makeStage('source', source ? 'done' : show ? 'ready' : 'blocked', summarizeSource(source, sourceQueries, jobs)),
    makeStage('discover', hasCandidatePool ? 'done' : source && profileSupportsDiscovery ? 'ready' : 'blocked', null),
    makeStage('story', hasStorySelection ? 'done' : hasCandidatePool ? 'ready' : 'blocked', summarizeCandidates(selectedCandidates)),
    makeStage('brief', activeBrief ? (briefNeedsReview ? 'needs-review' : briefReady ? 'done' : 'blocked') : hasStorySelection ? 'ready' : 'blocked', summarizeBrief(activeBrief)),
    makeStage('script', activeScript ? 'done' : activeBrief && !briefBlocked ? 'ready' : 'blocked', summarizeScript(activeScript, activeRevision)),
    makeStage('review', readyForProduction ? 'done' : activeScript ? (activeRevision ? 'needs-review' : 'ready') : 'blocked', summarizeReview(activeRevision)),
    makeStage('production', audio && cover ? 'done' : readyForProduction ? 'ready' : 'blocked', summarizeAudioCover(assets)),
    makeStage('publishing', activeEpisode?.status === 'published' ? 'done' : audio && cover ? (publishPrerequisiteBlocker ? 'blocked' : 'ready') : 'blocked', summarizeEpisode(activeEpisode)),
  ];

  let primaryNextAction;
  if (!show) {
    primaryNextAction = action('Select or create show', 'show', true);
  } else if (!source) {
    primaryNextAction = action('Choose story source', 'source', true);
  } else if (!hasCandidatePool) {
    primaryNextAction = action(
      sourceActionLabel(source.type),
      'discover',
      profileSupportsDiscovery && !sourceBlocker,
      sourceBlocker || 'Choose a browser-supported story source before discovery.',
    );
  } else if (!hasStorySelection) {
    primaryNextAction = action('Pick or cluster story', 'story', true);
  } else if (!activeBrief) {
    primaryNextAction = action('Build research brief', 'brief', true);
  } else if (briefBlocked) {
    primaryNextAction = action(
      briefNeedsReview ? 'Resolve research warnings' : 'Review blocked research brief',
      'brief',
      true,
      '',
      briefNeedsReview ? 'reviewPanel' : 'researchPanel',
    );
  } else if (!activeScript) {
    primaryNextAction = action('Generate script draft', 'script', true);
  } else if (!activeRevision) {
    primaryNextAction = action('Select script revision', 'script', true);
  } else if (integrity.blocking) {
    primaryNextAction = action(integrity.status === 'fail' ? 'Rerun integrity review' : 'Run integrity review', 'review', true);
  } else if (!scriptApproved) {
    primaryNextAction = action('Approve script for audio', 'review', true);
  } else if (!audio || !cover) {
    primaryNextAction = action(`Create missing ${audio ? 'cover art' : cover ? 'audio' : 'audio and cover art'}`, 'production', readyForProduction);
  } else if (activeEpisode?.status === 'approved-for-publish') {
    primaryNextAction = action(
      'Publish to RSS',
      'publishing',
      !publishBlocker,
      publishBlocker ? `${publishBlocker.label}: ${publishBlocker.reason}` : '',
    );
  } else if (activeEpisode?.status === 'published') {
    primaryNextAction = action('Review publishing record', 'publishing', false, 'Episode is already published.');
  } else {
    primaryNextAction = action(
      'Approve for publishing',
      'publishing',
      (!publishBlocker || publishBlocker.key === 'publishApproval') && publishApprovalReady,
      !publishApprovalReady ? `Episode status must be audio-ready before publish approval; current status is ${activeEpisode?.status || 'missing'}.` : publishBlocker ? `${publishBlocker.label}: ${publishBlocker.reason}` : '',
    );
  }

  const currentStage = stages.find((stage) => stage.status !== 'done') || stages[stages.length - 1];
  return { stages, currentStage, primaryNextAction, checklist };
}

function warningItem(stage, message, source = null, severity = 'warning') {
  return compactObject({ stage, severity, message, source });
}

function checklistStage(key) {
  return {
    research: 'brief',
    script: 'script',
    integrity: 'review',
    audio: 'production',
    cover: 'production',
    feed: 'publishing',
    target: 'publishing',
    warnings: 'publishing',
    publishApproval: 'publishing',
  }[key] || 'publishing';
}

function deriveWarningsAndBlockers({
  activeBrief,
  activeRevision,
  activeEpisode,
  assets,
  jobs,
  checklist,
  selectedCandidates,
}) {
  const warnings = [];
  const blockers = [];
  const integrity = integrityReviewState(activeRevision);

  for (const warning of unresolvedResearchWarnings(activeBrief)) {
    warnings.push(warningItem('brief', warning.message || warning.code || 'Research warning requires review.', warning, 'warning'));
  }

  if (activeBrief && !researchReady(activeBrief)) {
    blockers.push(warningItem('brief', `Research brief status is ${researchStatus(activeBrief)}.`, summarizeBrief(activeBrief), 'error'));
  }

  for (const warning of productionWarnings(activeEpisode, assets, jobs)) {
    warnings.push(warningItem('production', warning.message || warning.code || String(warning), warning, 'warning'));
  }

  for (const candidate of selectedCandidates) {
    if (!firstPresent(candidate.canonicalUrl, candidate.url)) {
      warnings.push(warningItem('story', `${candidate.title || 'Selected candidate'} is missing a source URL.`, summarizeCandidate(candidate), 'warning'));
    }
    if (['ignored', 'merged'].includes(candidate.status)) {
      blockers.push(warningItem('story', `${candidate.title || 'Selected candidate'} has ${candidate.status} status.`, summarizeCandidate(candidate), 'error'));
    }
  }

  if (activeRevision && integrity.blocking) {
    blockers.push(warningItem('review', integrity.status === 'fail' ? 'Integrity review failed or needs an explicit override.' : 'Integrity review has not been run.', summarizeReview(activeRevision), 'error'));
  }

  if (activeEpisode || assets.length > 0) {
    for (const item of checklist.filter((entry) => !entry.passed && entry.key !== 'publishApproval')) {
      const target = checklistStage(item.key);
      blockers.push(warningItem(target, `${item.label}: ${item.reason}`, item, 'error'));
    }
  }

  return { warnings, blockers };
}

function stageStatusLabel(status) {
  return {
    blocked: 'blocked',
    done: 'complete',
    'needs-review': 'needs review',
    ready: 'ready',
    running: 'running',
  }[status] || status || 'not started';
}

function artifactStatusLabel(status) {
  return {
    'approved-for-audio': 'approved for audio',
    'approved-for-publish': 'approved for publishing',
    'audio-ready': 'audio and cover ready',
    blocked: 'blocked',
    draft: 'draft',
    failed: 'failed',
    'needs_more_sources': 'needs more sources',
    published: 'published',
    ready: 'ready',
    succeeded: 'complete',
  }[status] || status || 'not started';
}

function cockpitEpisodeStory({ activeEpisode, selectedCandidates, activeBrief, activeScript }) {
  const episode = summarizeEpisode(activeEpisode);
  if (episode) {
    return {
      label: 'Current episode',
      title: episode.title,
      detail: episode.status ? `Episode state: ${artifactStatusLabel(episode.status)}` : 'Episode record selected for this production path.',
      kind: 'episode',
    };
  }

  const candidate = summarizeCandidate(selectedCandidates[0]);
  if (candidate) {
    return {
      label: 'Current story',
      title: candidate.title,
      detail: firstPresent(candidate.sourceName, candidate.url, 'Candidate story selected for this episode.'),
      kind: 'story',
    };
  }

  const brief = summarizeBrief(activeBrief);
  if (brief) {
    return {
      label: 'Current research brief',
      title: brief.title,
      detail: `Research brief state: ${artifactStatusLabel(brief.status)}`,
      kind: 'brief',
    };
  }

  const script = summarizeScript(activeScript);
  if (script) {
    return {
      label: 'Current script',
      title: script.title,
      detail: `Script state: ${artifactStatusLabel(script.status)}`,
      kind: 'script',
    };
  }

  return {
    label: 'Current episode/story',
    title: 'No active episode or story yet',
    detail: 'Select a candidate story to define the episode focus.',
    kind: 'empty',
  };
}

function deriveCockpitHeader({
  selectedShow,
  selectedCandidates,
  activeBrief,
  activeScript,
  activeEpisode,
  currentStage,
  warnings,
  blockers,
  primaryNextAction,
  latestActionResult,
}) {
  const result = latestActionResult || {
    status: 'idle',
    title: 'Latest result',
    message: 'No action result recorded yet.',
    conciseMessage: 'No action result recorded yet.',
  };

  return {
    selectedShow: summarizeShow(selectedShow) || {
      title: 'No show selected',
    },
    currentEpisodeStory: cockpitEpisodeStory({
      activeEpisode,
      selectedCandidates,
      activeBrief,
      activeScript,
    }),
    activeStage: {
      id: currentStage?.id || 'show',
      label: currentStage?.label || 'Choose show',
      status: currentStage?.status || 'blocked',
      statusLabel: stageStatusLabel(currentStage?.status),
    },
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockerSummary: blockers[0]?.message || '',
    latestResult: {
      id: result.id || 'latest-result',
      title: result.title || (['error', 'failed'].includes(result.status) ? 'Latest failure' : 'Latest result'),
      status: result.status || 'idle',
      message: result.conciseMessage || result.message || 'No action result recorded yet.',
      nextStep: result.nextStep || '',
    },
    primaryNextAction: {
      ...primaryNextAction,
      disabledReason: primaryNextAction?.enabled ? '' : primaryNextAction?.blockerReason || blockers[0]?.message || 'The current workflow state blocks this action.',
    },
  };
}

function deriveHistoricalArtifacts({ activeIds, packets, scripts, revisions, assets, episodes }) {
  return {
    briefs: newest(packets).filter((packet) => packet.id !== activeIds.briefId).map((packet) => markArtifact(summarizeBrief(packet), 'archive')),
    scripts: newest(scripts).filter((script) => script.id !== activeIds.scriptId).map((script) => markArtifact(summarizeScript(script), 'archive')),
    reviews: newest(revisions).filter((revision) => revision.id !== activeIds.revisionId).map((revision) => markArtifact(summarizeReview(revision), 'archive')),
    audioCover: newest(assets).filter((asset) => !activeIds.assetIds.has(asset.id) && isAudioCoverAsset(asset)).map((asset) => markArtifact(summarizeAsset(asset), 'archive')),
    publishing: newest(episodes).filter((episode) => episode.id !== activeIds.episodeId).map((episode) => markArtifact(summarizeEpisode(episode), 'archive')),
  };
}

export function deriveProductionViewModel(input = {}) {
  const shows = asArray(input.shows);
  const feeds = asArray(input.feeds);
  const profiles = asArray(input.profiles);
  const queries = asArray(input.queries);
  const candidates = asArray(input.storyCandidates);
  const packets = asArray(input.researchPackets);
  const scripts = asArray(input.scripts);
  const revisions = asArray(input.selectedRevisions);
  const production = asObject(input.production);
  const productionAssets = asArray(production.assets);
  const productionJobs = asArray(production.jobs);
  const jobs = uniqueById([...asArray(input.recentJobs), ...productionJobs]);
  const episodes = production.episode ? [production.episode, ...asArray(input.episodes).filter((episode) => episode.id !== production.episode.id)] : asArray(input.episodes);
  const selectedShow = shows.find((show) => show.slug === input.selectedShowSlug) || null;
  const selectedSource = profiles.find((profile) => profile.id === input.selectedProfileId) || null;
  const selectedCandidateIds = new Set(asArray(input.selectedCandidateIds));
  const hasCandidateSelection = selectedCandidateIds.size > 0;
  const selectedCandidates = candidates.filter((candidate) => selectedCandidateIds.has(candidate.id));
  const selectedScript = input.selectedScript || scripts.find((script) => script.id === input.selectedScriptId) || null;
  const selectedScriptBrief = selectedScript?.researchPacketId ? packets.find((packet) => packet.id === selectedScript.researchPacketId) : null;
  const selectedBrief = packets.find((packet) => packet.id === input.selectedResearchPacketId) || null;
  const latestMatchingBrief = latest(packets.filter((packet) => packetMatchesCandidateSelection(packet, selectedCandidateIds)));
  const pathBrief = [selectedScriptBrief, selectedBrief, latestMatchingBrief]
    .find((packet) => packetMatchesCandidateSelection(packet, selectedCandidateIds));
  const activeBrief = pathBrief || null;
  const selectedScriptMatchesBrief = Boolean(selectedScript && activeBrief && selectedScript.researchPacketId === activeBrief.id);
  const latestMatchingScript = activeBrief ? latest(scripts.filter((script) => script.researchPacketId === activeBrief.id)) : null;
  const activeScript = selectedScriptMatchesBrief ? selectedScript : latestMatchingScript;
  const selectedRevision = input.selectedRevision || revisions[0] || null;
  const activeRevision = activeScript && selectedRevision?.scriptId === activeScript.id ? selectedRevision : null;
  const selectedEpisode = production.episode || episodes.find((episode) => episode.id === input.selectedEpisodeId) || null;
  const latestMatchingEpisode = activeBrief ? latest(episodes.filter((episode) => episodeMatchesPath(episode, activeBrief, activeScript))) : null;
  const activeEpisode = !activeBrief && hasCandidateSelection
    ? null
    : (episodeMatchesPath(selectedEpisode, activeBrief, activeScript) ? selectedEpisode : latestMatchingEpisode);
  const selectedAssetIds = new Set(asArray(input.selectedAssetIds));
  const selectedAssets = productionAssets.filter((asset) => selectedAssetIds.has(asset.id));
  const pathAssets = selectedAssetIds.size > 0 && selectedAssets.length > 0
    ? selectedAssets
    : productionAssets;
  const activeAssets = activeEpisode ? pathAssets.filter((asset) => asset.episodeId === activeEpisode.id) : [];
  const feed = selectedFeed(feeds, activeEpisode, selectedShow);
  const sourceQueries = selectedSource ? queries.filter((query) => !query.sourceProfileId || query.sourceProfileId === selectedSource.id) : [];
  const context = {
    show: selectedShow,
    source: selectedSource,
    candidates,
    selectedCandidates,
    activeBrief,
    activeScript,
    activeRevision,
    activeEpisode,
    assets: activeAssets,
    jobs,
    feed,
    sourceQueries,
  };
  const { stages, currentStage, primaryNextAction, checklist } = deriveStages(context);
  const workflowActionFeedback = deriveWorkflowActionFeedback(input, jobs, currentStage, primaryNextAction);
  const navigationActions = stages.map((stage) => action(`Open ${stage.label}`, stage.id, true));
  const secondaryActions = stages
    .filter((stage) => stage.id === currentStage.id && stage.id !== primaryNextAction.targetStage)
    .map((stage) => action(`Open ${stage.label}`, stage.id, true));
  const activeArtifactAudioCover = summarizeAudioCover(activeAssets);
  const activeArtifactAssetIds = new Set([
    activeArtifactAudioCover?.audio?.id,
    activeArtifactAudioCover?.cover?.id,
  ].filter(Boolean));
  const activeIds = {
    briefId: activeBrief?.id || null,
    scriptId: activeScript?.id || null,
    revisionId: activeRevision?.id || null,
    episodeId: activeEpisode?.id || null,
    assetIds: activeArtifactAssetIds,
  };
  const inactiveArtifactReason = hasCandidateSelection
    ? 'Not part of current production for the selected candidate story.'
    : 'Not part of current production path.';
  const inactiveSelectedArtifacts = [
    selectedBrief && selectedBrief.id !== activeIds.briefId ? {
      stage: 'brief',
      message: activePathWarning('Research brief', selectedBrief.title, hasCandidateSelection),
      source: markArtifact(summarizeBrief(selectedBrief), 'archive', inactiveArtifactReason),
    } : null,
    selectedScript && selectedScript.id !== activeIds.scriptId ? {
      stage: 'script',
      message: activePathWarning('Script draft', selectedScript.title, hasCandidateSelection),
      source: markArtifact(summarizeScript(selectedScript, selectedRevision), 'archive', inactiveArtifactReason),
    } : null,
    selectedEpisode && selectedEpisode.id !== activeIds.episodeId ? {
      stage: 'publishing',
      message: activePathWarning('Episode', selectedEpisode.title || selectedEpisode.slug, hasCandidateSelection),
      source: markArtifact(summarizeEpisode(selectedEpisode), 'archive', inactiveArtifactReason),
    } : null,
    ...pathAssets
      .filter((asset) => !activeIds.assetIds.has(asset.id) && isAudioCoverAsset(asset))
      .map((asset) => ({
        stage: 'production',
        message: activePathWarning('Production asset', asset.label || asset.type, hasCandidateSelection),
        source: markArtifact(summarizeAsset(asset), 'archive', inactiveArtifactReason),
      })),
  ].filter(Boolean);
  const activeArtifacts = {
    brief: markArtifact(summarizeBrief(activeBrief), 'active'),
    script: markArtifact(summarizeScript(activeScript, activeRevision), 'active'),
    review: markArtifact(summarizeReview(activeRevision), 'active'),
    audioCover: markArtifact(activeArtifactAudioCover, 'active'),
    publishing: markArtifact(summarizeEpisode(activeEpisode), 'active'),
  };
  const latestArtifacts = {
    brief: markArtifact(summarizeBrief(latest(packets)), 'archive'),
    script: markArtifact(summarizeScript(latest(scripts)), 'archive'),
    review: markArtifact(summarizeReview(latest(revisions)), 'archive'),
    audioCover: markArtifact(summarizeAudioCover(productionAssets), 'archive'),
    publishing: markArtifact(summarizeEpisode(latest(episodes)), 'archive'),
  };
  const historicalArtifacts = deriveHistoricalArtifacts({
    activeIds,
    packets,
    scripts,
    revisions,
    assets: productionAssets,
    episodes,
  });
  const { warnings, blockers } = deriveWarningsAndBlockers({
    activeBrief,
    activeRevision,
    activeEpisode,
    assets: activeAssets,
    jobs,
    checklist,
    selectedCandidates,
  });
  const cockpitHeader = deriveCockpitHeader({
    selectedShow,
    selectedCandidates,
    activeBrief,
    activeScript,
    activeEpisode,
    currentStage,
    warnings,
    blockers,
    primaryNextAction,
    latestActionResult: workflowActionFeedback,
  });
  const scriptReviewWorkspace = summarizeScriptReviewWorkspace(
    activeScript,
    activeRevision,
    input.selectedCoverageSummary,
    input.scriptCoachingActions,
  );
  const audioCoverReviewWorkspace = summarizeAudioCoverReviewWorkspace(activeAssets, historicalArtifacts.audioCover);

  return {
    selectedShowSummary: summarizeShow(selectedShow),
    selectedStorySourceSummary: summarizeSource(selectedSource, sourceQueries, jobs),
    selectedCandidateStorySummary: summarizeCandidates(selectedCandidates),
    activeDraftEpisodeSummary: activeEpisode && activeEpisode.status !== 'published' ? summarizeEpisode(activeEpisode) : null,
    currentStage: {
      id: currentStage.id,
      label: currentStage.label,
      status: currentStage.status,
    },
    stages,
    activeArtifacts,
    latestArtifacts,
    historicalArtifacts,
    scriptReviewWorkspace,
    audioCoverReviewWorkspace,
    artifactScopeWarnings: inactiveSelectedArtifacts,
    primaryNextAction,
    secondaryActions,
    navigationActions,
    cockpitHeader,
    latestActionResult: workflowActionFeedback,
    workflowActionFeedback,
    warnings,
    blockers,
    visibility: {
      workflow: true,
      settings: input.activeSurface === 'settings',
      debug: input.activeSurface === 'debug',
      advanced: Boolean(input.activeSurface === 'settings' || input.activeSurface === 'debug'),
      groups: {
        activeWorkflow: true,
        history: Object.values(historicalArtifacts).some((items) => items.length > 0),
        admin: input.activeSurface === 'settings',
        debug: input.activeSurface === 'debug',
      },
    },
  };
}
