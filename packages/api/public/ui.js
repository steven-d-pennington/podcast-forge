import { api, ApiRequestError, debugText } from './ui-api.js';
import { SETTINGS_SECTIONS, SURFACES } from './ui-constants.js';
import { els, state } from './ui-state.js';
import { deriveProductionViewModel, integrityReviewState as viewModelIntegrityReviewState } from './ui-view-model.js';
import {
  applySourceControlState,
  applySourceControlStateToForms,
  asArray,
  asObject,
  castToLines,
  formatRole,
  linesToCast,
  linesToList,
  listToLines,
  maybeNull,
  optionalNumber,
  outputPathForFeed,
  publishTargetConfiguredForFeed,
  publicAssetBaseForFeed,
  readOnboardingSetting,
  readPublishingMode,
  roleInfo,
  safeVisiblePath,
  sanitizedDebug,
  slugify,
  sourceActionDescription,
  sourceActionLabel,
  sourceConstraintsSummary,
  sourceControlsSupported,
  sourceCredentialSummary,
  sourceDiscoveryBlocker,
  sourceInputSummary,
  sourceProviderLabel,
  validHttpUrl,
} from './ui-formatters.js';

function setStatus(message, debugDetails = '', status = debugDetails ? 'warning' : 'info') {
  state.latestActionResult = {
    status,
    message,
    source: 'ui',
  };
  els.status.textContent = message;
  const detail = debugText(debugDetails);
  els.errorDetails.hidden = !detail;
  els.errorDetailsBody.textContent = detail;
  refreshProductionCommandBar();
}

function reportError(error, fallback = 'Something went wrong. Open technical details for the API response.') {
  if (error instanceof ApiRequestError) {
    setStatus(error.message, error.debugDetails, 'error');
    return error.message;
  }

  const message = error instanceof Error && error.message ? error.message : fallback;
  setStatus(fallback, message, 'error');
  return fallback;
}

function openConfirmationDialog({
  title,
  description,
  consequence = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  reasonLabel = '',
  defaultReason = '',
  reasonPlaceholder = '',
  requireReason = false,
  emptyReasonMessage = 'Enter a reason before continuing.',
}) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogId = `confirmation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const overlay = document.createElement('div');
    overlay.className = 'confirmation-overlay';

    const dialog = document.createElement('section');
    dialog.className = 'confirmation-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${dialogId}-title`);
    dialog.setAttribute('aria-describedby', `${dialogId}-description`);
    dialog.tabIndex = -1;

    const form = document.createElement('form');
    form.className = 'confirmation-form';
    form.noValidate = true;

    const heading = document.createElement('h2');
    heading.id = `${dialogId}-title`;
    heading.textContent = title;

    const body = document.createElement('p');
    body.id = `${dialogId}-description`;
    body.textContent = description;

    form.append(heading, body);

    if (consequence) {
      const consequenceText = document.createElement('p');
      consequenceText.className = 'confirmation-consequence';
      consequenceText.textContent = consequence;
      form.append(consequenceText);
    }

    let reasonInput = null;
    if (reasonLabel) {
      const field = document.createElement('label');
      field.className = 'field';
      const label = document.createElement('span');
      label.textContent = reasonLabel;
      reasonInput = document.createElement('input');
      reasonInput.type = 'text';
      reasonInput.value = defaultReason;
      reasonInput.placeholder = reasonPlaceholder;
      reasonInput.setAttribute('autocomplete', 'off');
      if (requireReason) {
        reasonInput.required = true;
      }
      field.append(label, reasonInput);
      form.append(field);
      reasonInput.addEventListener('input', () => {
        status.hidden = true;
        status.textContent = '';
        reasonInput.removeAttribute('aria-invalid');
      });
    }

    const status = document.createElement('p');
    status.className = 'confirmation-status';
    status.setAttribute('role', 'alert');
    status.hidden = true;
    form.append(status);

    const actions = document.createElement('div');
    actions.className = 'actions inline confirmation-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = cancelLabel;

    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.className = danger ? 'danger' : '';
    confirm.textContent = confirmLabel;

    actions.append(cancel, confirm);
    form.append(actions);
    dialog.append(form);
    overlay.append(dialog);

    const close = (value) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
      resolve(value);
    };

    function dialogFocusableElements() {
      return Array.from(dialog.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.disabled && element.offsetParent !== null);
    }

    function trapFocus(event) {
      const focusable = dialogFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'Tab') {
        trapFocus(event);
      }
    }

    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = reasonInput?.value.trim() ?? '';
      if (requireReason && !reason) {
        status.hidden = false;
        status.textContent = emptyReasonMessage;
        reasonInput?.setAttribute('aria-invalid', 'true');
        reasonInput?.focus();
        return;
      }
      close(reasonInput ? reason : true);
    });

    document.addEventListener('keydown', onKeydown);
    document.body.append(overlay);
    window.setTimeout(() => {
      (reasonInput || confirm).focus();
    }, 0);
  });
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedProfileId);
}

function selectedShow() {
  return state.shows.find((show) => show.slug === state.selectedShowSlug);
}

function selectedCandidates() {
  const selected = new Set(state.selectedCandidateIds);
  return state.storyCandidates.filter((candidate) => selected.has(candidate.id));
}

function candidateUrl(candidate) {
  return candidate.canonicalUrl || candidate.url || '';
}

function hostnameFor(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceProfileForCandidate(candidate) {
  return state.profiles.find((profile) => profile.id === candidate.sourceProfileId) || null;
}

function sourceQueryText(candidate) {
  const metadataQuery = asObject(candidate.metadata?.query);
  const query = state.queries.find((item) => item.id === candidate.sourceQueryId);

  if (typeof metadataQuery.text === 'string' && metadataQuery.text.trim()) {
    return metadataQuery.text.trim();
  }

  if (query?.query) {
    return query.query;
  }

  return candidate.sourceQueryId ? `Search query ${candidate.sourceQueryId.slice(0, 8)}` : 'Manual or imported story';
}

function scoreBreakdown(candidate) {
  return asObject(candidate.scoreBreakdown);
}

function componentScore(candidate, key) {
  const breakdown = scoreBreakdown(candidate);
  const components = asObject(breakdown.components);
  const value = typeof breakdown[key] === 'number' ? breakdown[key] : components[key];

  return typeof value === 'number' ? value : null;
}

function candidateScoreText(candidate, index) {
  const rank = `rank #${index + 1}`;

  if (candidate.score === null || candidate.score === undefined) {
    return `${rank}, unscored`;
  }

  return `${rank}, score ${candidate.score}`;
}

function candidateStatusWarnings(candidate) {
  const warnings = [];
  const breakdown = scoreBreakdown(candidate);
  const scoring = asObject(candidate.metadata?.scoring);
  const sourceQuality = componentScore(candidate, 'sourceQuality');

  if (!candidateUrl(candidate)) {
    warnings.push({ level: 'error', text: 'missing source URL' });
  }

  if (['ignored', 'merged'].includes(candidate.status)) {
    warnings.push({ level: 'error', text: `${candidate.status} status` });
  }

  if (typeof candidate.score === 'number' && candidate.score < 50) {
    warnings.push({ level: 'warning', text: `low score ${candidate.score}` });
  }

  if (typeof sourceQuality === 'number' && sourceQuality < 50) {
    warnings.push({ level: 'warning', text: `weak source score ${sourceQuality}` });
  }

  for (const warning of asArray(breakdown.warnings).slice(0, 2)) {
    if (typeof warning === 'string') {
      warnings.push({ level: 'warning', text: warning });
    } else if (warning?.message || warning?.code) {
      warnings.push({ level: warning.severity === 'error' ? 'error' : 'warning', text: warning.message || warning.code });
    }
  }

  if (scoring.status === 'failed') {
    warnings.push({ level: 'warning', text: 'scoring used fallback after failure' });
  } else if (scoring.status === 'fallback') {
    warnings.push({ level: 'warning', text: 'fallback score' });
  }

  return warnings;
}

function normalizedTitleKeywords(title) {
  const stop = new Set(['about', 'after', 'again', 'amid', 'from', 'have', 'into', 'over', 'that', 'their', 'this', 'with', 'will', 'your']);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stop.has(word))
    .slice(0, 8);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicated = new Set();

  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) {
      duplicated.add(value);
    }

    seen.add(value);
  }

  return [...duplicated];
}

function selectedCandidateAnalysis() {
  const candidates = selectedCandidates();
  const selectedIds = new Set(candidates.map((candidate) => candidate.id));
  const missingIds = state.selectedCandidateIds.filter((id) => !selectedIds.has(id));
  const showIds = new Set(candidates.map((candidate) => candidate.showId).filter(Boolean));
  const urls = candidates.map(candidateUrl).filter(Boolean);
  const domains = urls.map(hostnameFor).filter(Boolean);
  const duplicateUrls = duplicateValues(urls);
  const duplicateDomains = duplicateValues(domains);
  const missingUrls = candidates.filter((candidate) => !candidateUrl(candidate));
  const invalidStatus = candidates.filter((candidate) => ['ignored', 'merged'].includes(candidate.status));
  const weakCandidates = candidates.filter((candidate) => {
    const sourceQuality = componentScore(candidate, 'sourceQuality');
    return (typeof candidate.score === 'number' && candidate.score < 50)
      || (typeof sourceQuality === 'number' && sourceQuality < 50);
  });
  const keywordCounts = new Map();

  for (const candidate of candidates) {
    for (const keyword of new Set(normalizedTitleKeywords(candidate.title))) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }

  const sharedKeywords = [...keywordCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([keyword]) => keyword)
    .slice(0, 8);
  const errors = [
    ...missingIds.map((id) => `Selected candidate ${id.slice(0, 8)} is no longer loaded.`),
    ...(showIds.size > 1 ? ['Selected candidate stories belong to different shows.'] : []),
    ...invalidStatus.map((candidate) => `"${candidate.title}" has ${candidate.status} status.`),
    ...(candidates.length > 0 && urls.length === 0 ? ['At least one selected candidate needs a source URL before a research brief can be built.'] : []),
  ];
  const warnings = [
    ...missingUrls.map((candidate) => `"${candidate.title}" is missing a source URL.`),
    ...duplicateUrls.map((url) => `Duplicate source URL selected: ${url}`),
    ...duplicateDomains.map((domain) => `Multiple selected URLs use ${domain}; check for syndicated or circular coverage.`),
    ...weakCandidates.map((candidate) => `"${candidate.title}" has a low score or weak source score.`),
    ...(sharedKeywords.length > 0 ? [`Shared title keywords: ${sharedKeywords.join(', ')}`] : []),
  ];

  return {
    candidates,
    urls,
    domains,
    duplicateUrls,
    duplicateDomains,
    missingUrls,
    weakCandidates,
    sharedKeywords,
    errors,
    warnings,
    canLaunch: candidates.length > 0 && errors.length === 0,
  };
}

function selectedResearchPacket() {
  const activeId = currentProductionViewModel().activeArtifacts?.brief?.id;
  if (activeId) {
    return state.researchPackets.find((packet) => packet.id === activeId);
  }
  return state.selectedCandidateIds.length > 0 ? undefined : state.researchPackets.find((packet) => packet.id === state.selectedResearchPacketId);
}

function activeSelectedScript() {
  const activeId = currentProductionViewModel().activeArtifacts?.script?.id;
  return activeId && state.selectedScript?.id === activeId ? state.selectedScript : null;
}

function activeSelectedRevision() {
  const activeId = currentProductionViewModel().activeArtifacts?.review?.id;
  return activeId && state.selectedRevision?.id === activeId ? state.selectedRevision : null;
}

function selectedEpisode() {
  const activeId = currentProductionViewModel().activeArtifacts?.publishing?.id;
  if (activeId) {
    return (state.production.episode?.id === activeId ? state.production.episode : null)
      || state.episodes.find((episode) => episode.id === activeId)
      || null;
  }
  return state.selectedCandidateIds.length > 0 ? null : state.production.episode
    || state.episodes.find((episode) => episode.id === state.selectedEpisodeId)
    || null;
}

function selectedAssets() {
  const activeAudioCover = currentProductionViewModel().activeArtifacts?.audioCover;
  const activeAssetIds = new Set([
    activeAudioCover?.audio?.id,
    activeAudioCover?.cover?.id,
  ].filter(Boolean));
  return state.production.assets.filter((asset) => activeAssetIds.has(asset.id));
}

function productionAssetContentUrl(asset, download = false) {
  if (!asset?.id || !asset?.episodeId) {
    return '';
  }

  const url = `/episodes/${encodeURIComponent(asset.episodeId)}/assets/${encodeURIComponent(asset.id)}/content`;
  return download ? `${url}?download=1` : url;
}

function isAudioAsset(asset) {
  return asset?.type === 'audio-preview' || asset?.type === 'audio-final' || asset?.mimeType?.startsWith('audio/');
}

function isLocalUiHost() {
  const hostname = window.location.hostname.toLowerCase();
  const privateLanPattern = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
  return hostname === 'localhost'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname.startsWith('127.')
    || privateLanPattern.test(hostname);
}

function assetAccessUrls(asset) {
  const localUrl = productionAssetContentUrl(asset);
  const publicUrl = asset?.publicUrl || '';
  const preferLocal = Boolean(localUrl && isLocalUiHost());
  const primary = preferLocal ? localUrl : (publicUrl || localUrl);
  const download = preferLocal || !publicUrl ? productionAssetContentUrl(asset, true) : publicUrl;
  const fallback = primary === localUrl ? publicUrl : localUrl;

  return { localUrl, publicUrl, primary, download, fallback, preferLocal };
}

function publicAssetWarning(asset, urls) {
  if (!asset) {
    return '';
  }

  if (!asset.publicUrl) {
    return urls.localUrl ? 'No public asset URL is recorded; using the local API asset route.' : 'No public or local asset URL is available.';
  }

  let parsed;
  try {
    parsed = new URL(asset.publicUrl, window.location.origin);
  } catch (_error) {
    return urls.localUrl
      ? 'The recorded public asset URL is not usable; using the local API asset route.'
      : 'The recorded public asset URL is not usable from the browser.';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return urls.localUrl
      ? 'The recorded public asset URL is not http(s); using the local API asset route.'
      : 'The recorded public asset URL is not http(s).';
  }

  if (urls.preferLocal && parsed.origin !== window.location.origin) {
    return 'Public asset host may be unavailable in local runs; Play, Open, and Download use the local API asset route.';
  }

  return '';
}

function assetAccessUrl(asset) {
  return assetAccessUrls(asset).primary;
}

function appendAssetAccessControls(container, asset, options = {}) {
  const urls = assetAccessUrls(asset);
  const accessUrl = urls.primary;
  const downloadUrl = urls.download;
  const warning = publicAssetWarning(asset, urls);

  if (warning) {
    const note = document.createElement('p');
    note.className = 'asset-access-warning';
    note.textContent = warning;
    container.append(note);
  }

  if (options.audio && accessUrl) {
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = accessUrl;
    player.addEventListener('error', () => {
      const note = document.createElement('p');
      note.className = 'asset-access-warning';
      note.textContent = 'Audio playback failed from the selected URL. Use Open or Download, or regenerate the local asset.';
      if (!container.querySelector('.asset-playback-error')) {
        note.classList.add('asset-playback-error');
        container.append(note);
      }
    }, { once: true });
    container.append(player);
  }

  if (options.image && accessUrl) {
    const image = document.createElement('img');
    image.src = accessUrl;
    image.alt = asset.label || 'Cover art preview';
    image.addEventListener('error', () => {
      const note = document.createElement('p');
      note.className = 'asset-access-warning asset-image-error';
      note.textContent = 'Cover art preview failed from the selected URL. Use Open or Download, or regenerate the local asset.';
      if (!container.querySelector('.asset-image-error')) {
        container.append(note);
      }
    }, { once: true });
    container.append(image);
  }

  const controls = document.createElement('div');
  controls.className = 'asset-actions';

  if (isAudioAsset(asset) && accessUrl && !options.audio) {
    const play = document.createElement('a');
    play.className = 'asset-link-button';
    play.href = accessUrl;
    play.target = '_blank';
    play.rel = 'noopener';
    play.textContent = 'Play';
    controls.append(play);
  }

  if (accessUrl) {
    const open = document.createElement('a');
    open.className = 'asset-link-button';
    open.href = accessUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Open';
    controls.append(open);
  }

  if (urls.fallback) {
    const fallback = document.createElement('a');
    fallback.className = 'asset-link-button secondary';
    fallback.href = urls.fallback;
    fallback.target = '_blank';
    fallback.rel = 'noopener';
    fallback.textContent = urls.fallback === urls.localUrl ? 'Local API' : 'Public URL';
    controls.append(fallback);
  }

  if (downloadUrl) {
    const download = document.createElement('a');
    download.className = 'asset-link-button';
    download.href = downloadUrl;
    download.download = '';
    download.textContent = 'Download';
    controls.append(download);
  }

  if (controls.childElementCount > 0) {
    container.append(controls);
  }
}

function currentProductionViewModel() {
  return state.productionViewModel || deriveProductionViewModel(state);
}

function artifactScope(kind, id) {
  const viewModel = currentProductionViewModel();
  const active = viewModel.activeArtifacts?.[kind];
  if (id && active?.id === id) {
    return {
      label: active.stateLabel || 'Active/current',
      className: 'active',
      warning: '',
    };
  }

  const historyKey = kind === 'brief'
    ? 'briefs'
    : kind === 'script'
      ? 'scripts'
      : kind === 'review'
        ? 'reviews'
        : kind === 'publishing'
          ? 'publishing'
          : kind;
  const archived = asArray(viewModel.historicalArtifacts?.[historyKey]).find((artifact) => artifact.id === id);
  return {
    label: archived?.stateLabel || 'History/archive',
    className: 'archive',
    warning: archived?.stateWarning || 'Not part of current production.',
  };
}

function appendScopePill(container, scope) {
  const pill = document.createElement('span');
  pill.className = `scope-pill ${scope.className}`;
  pill.textContent = scope.label;
  container.append(pill);
}

function researchReadinessStatus(packet) {
  const readiness = asObject(packet?.content?.readiness);
  return typeof readiness.status === 'string' ? readiness.status : packet?.status || 'missing';
}

function unresolvedResearchWarnings(packet) {
  return asArray(packet?.warnings).filter((warning) => !warning.override);
}

function researchApproved(packet) {
  return Boolean(packet?.approvedAt);
}

function selectedFeed() {
  const episode = selectedEpisode();
  return state.feeds.find((feed) => feed.id === episode?.feedId) || state.feeds[0] || null;
}

function assetWarningItems(asset) {
  return [
    ...asArray(asset?.metadata?.warnings),
    ...asArray(asset?.metadata?.validation?.warnings),
  ].filter(Boolean);
}

function productionWarningItems() {
  return [
    ...asArray(selectedEpisode()?.warnings),
    ...selectedAssets().flatMap(assetWarningItems),
    ...state.production.jobs.flatMap((job) => asArray(job.summary?.warnings)),
  ];
}

function integrityReviewState(revision = state.selectedRevision) {
  return viewModelIntegrityReviewState(revision);
}

function integrityReviewPassed(revision = state.selectedRevision) {
  const integrity = integrityReviewState(revision);
  return !integrity.blocking;
}

function integrityReviewLabel(status) {
  const labels = {
    pass: 'passed',
    pass_with_notes: 'passed with notes',
    fail: 'failed',
    missing: 'not run',
    overridden: 'overridden',
  };
  return labels[status] || status || 'not run';
}

function provenanceReviewState(revision = state.selectedRevision) {
  const status = asObject(revision?.metadata?.provenanceStatus);
  const stale = status.status === 'stale' || status.verified === false;
  const message = typeof status.message === 'string' && status.message.trim()
    ? status.message.trim()
    : 'This human-edited revision needs fresh citation mapping and provenance review before production.';

  return {
    stale,
    status: stale ? 'stale' : status.status || 'current',
    message,
    previousRevisionId: status.previousRevisionId || revision?.metadata?.previousRevisionId || null,
    previousApprovedRevisionId: status.previousApprovedRevisionId || revision?.metadata?.previousApprovedRevisionId || null,
  };
}

function integrityIssueItems(review) {
  const result = asObject(review?.result);
  return [
    ...asArray(result.claimIssues),
    ...asArray(result.missingCitations),
    ...asArray(result.unsupportedCertainty),
    ...asArray(result.attributionWarnings),
    ...asArray(result.balanceWarnings),
    ...asArray(result.biasSensationalismWarnings),
  ];
}

function integrityIssueText(item) {
  const excerpt = item.scriptExcerpt ? `${item.scriptExcerpt} | ` : '';
  const severity = item.severity ? `${item.severity}: ` : '';
  const fix = item.suggestedFix ? ` | Fix: ${item.suggestedFix}` : '';
  return `${excerpt}${severity}${item.issue || item.message || item.code || JSON.stringify(sanitizedDebug(item))}${fix}`;
}

function coverageStatusLabel(status) {
  const labels = {
    blocking: 'Blocking',
    needs_attention: 'Needs attention',
    covered: 'Covered',
    unknown: 'Coverage unknown',
  };
  return labels[status] || 'Coverage unknown';
}

function coverageFindingText(item) {
  const claim = item.claimId ? `Claim ${item.claimId}: ` : '';
  const context = item.context || item.line ? ` | Context: ${item.context || item.line}` : '';
  const next = item.nextAction ? ` | Next: ${item.nextAction}` : '';
  return `${claim}${item.message || item.code || 'Coverage finding requires review.'}${context}${next}`;
}

function coverageClaimText(item) {
  const sourceCount = item.independentSourceCount === null || item.independentSourceCount === undefined
    ? 'independent sources unknown'
    : `${item.independentSourceCount} independent source${item.independentSourceCount === 1 ? '' : 's'}`;
  const mapped = item.citedInScript ? 'mapped to script' : 'not mapped to script';
  return `${coverageStatusLabel(item.status)}: ${item.text || item.claimId} | ${sourceCount} | ${mapped}`;
}

function renderCoverageSummary(summary) {
  const section = document.createElement('section');
  section.className = `coverage-panel ${summary?.status || 'unknown'}`;

  const header = document.createElement('div');
  header.className = 'coverage-panel-heading';
  const title = document.createElement('h4');
  title.textContent = 'Claim/source coverage';
  const pill = document.createElement('span');
  pill.className = `status-pill ${summary?.status === 'blocking' ? 'blocked' : summary?.status === 'covered' ? 'done' : summary?.status === 'needs_attention' ? 'needs-review' : 'neutral'}`;
  pill.textContent = coverageStatusLabel(summary?.status);
  header.append(title, pill);

  const headline = document.createElement('p');
  headline.textContent = summary?.headline || 'Coverage unknown from current metadata; verify claims manually before approval.';
  section.append(header, headline);

  if (!summary) {
    return section;
  }

  const counts = asObject(summary.counts);
  section.append(reviewFacts([
    ['Claims covered', `${counts.covered ?? 0} of ${counts.totalClaims ?? 0}`],
    ['Need attention', counts.needsAttention ?? 0],
    ['Blocking findings', counts.blockingFindings ?? 0],
    ['Integrity findings', counts.integrityFindings ?? 0],
  ]));

  section.append(
    reviewList('Blocking coverage findings', asArray(summary.blockers), 'No blocking coverage findings recorded.', coverageFindingText),
    reviewList('Needs attention', asArray(summary.needsAttention), 'No weak, stale, single-source, missing-primary, or uncertain coverage warnings recorded.', coverageFindingText),
    reviewList('Covered claims', asArray(summary.claims).filter((claim) => claim.status === 'covered'), 'No claims are marked fully covered by current metadata.', coverageClaimText),
  );

  const unknowns = asArray(summary.unknowns);
  if (unknowns.length > 0) {
    section.append(reviewList('Coverage unknowns', unknowns, 'No unknown coverage gaps recorded.', coverageFindingText));
  }

  return section;
}

function publishChecklistState() {
  const packet = selectedResearchPacket();
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const feed = selectedFeed();
  const audioAsset = assets.find((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview');
  const coverAsset = assets.find((asset) => asset.type === 'cover-art');
  const unresolvedWarnings = unresolvedResearchWarnings(packet);
  const productionWarnings = productionWarningItems();
  const scriptApproved = Boolean(script && revision && script.status === 'approved-for-audio' && script.approvedRevisionId === revision.id);
  const integrity = integrityReviewState(revision);
  const feedPublicUrl = feed?.publicFeedUrl || '';
  const publicBaseUrl = publicAssetBaseForFeed(feed || {});
  const feedConfigured = Boolean(feed);
  const targetConfigured = publishTargetConfiguredForFeed(feed || {});
  const feedUrlsValid = (!feedPublicUrl || validHttpUrl(feedPublicUrl)) && (!publicBaseUrl || validHttpUrl(publicBaseUrl));
  const audioValid = Boolean(audioAsset && audioAsset.mimeType?.startsWith('audio/') && (audioAsset.byteSize === null || audioAsset.byteSize > 0));
  const coverValid = Boolean(coverAsset && coverAsset.mimeType?.startsWith('image/'));

  return [
    {
      key: 'research',
      label: 'Research brief approved',
      passed: Boolean(packet && researchApproved(packet) && unresolvedWarnings.length === 0 && ['ready', 'approved', 'research-ready'].includes(researchReadinessStatus(packet))),
      reason: !packet
        ? 'Select a research brief.'
        : !['ready', 'approved', 'research-ready'].includes(researchReadinessStatus(packet))
          ? `Research status is ${researchReadinessStatus(packet)}.`
          : unresolvedWarnings.length > 0
            ? `${unresolvedWarnings.length} research warning${unresolvedWarnings.length === 1 ? '' : 's'} need override reasons.`
            : !researchApproved(packet) ? 'Approve the research brief after review.' : 'Research review decision recorded.',
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
            : integrity.status === 'overridden' ? 'Integrity review override reason recorded.' : `Integrity review ${integrityReviewLabel(integrity.status)}.`,
    },
    {
      key: 'audio',
      label: 'Valid audio asset exists',
      passed: audioValid,
      reason: audioAsset ? (audioValid ? 'Audio asset has an audio MIME type and usable size.' : 'Audio asset metadata is incomplete or invalid.') : 'Create a preview MP3 or attach final audio.',
    },
    {
      key: 'cover',
      label: 'Cover art asset exists',
      passed: coverValid,
      reason: coverAsset ? (coverValid ? 'Cover art has an image MIME type.' : 'Cover art MIME type is not an image.') : 'Create cover art before publishing.',
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
      reason: targetConfigured ? 'RSS path or public feed URL is configured.' : 'Configure an RSS path, output path, or public feed URL.',
    },
    {
      key: 'warnings',
      label: 'No blocking warnings remain',
      passed: unresolvedWarnings.length === 0 && productionWarnings.length === 0,
      reason: unresolvedWarnings.length + productionWarnings.length === 0
        ? 'No unresolved research or production warnings are selected.'
        : `${unresolvedWarnings.length + productionWarnings.length} warning${unresolvedWarnings.length + productionWarnings.length === 1 ? '' : 's'} require review.`,
    },
    {
      key: 'publishApproval',
      label: 'Episode approved for publishing',
      passed: Boolean(episode && ['approved-for-publish', 'published'].includes(episode.status)),
      reason: episode ? (episode.status === 'published' ? 'Episode is already published.' : episode.status === 'approved-for-publish' ? 'Publish approval recorded.' : 'Approve audio and cover assets for publishing.') : 'Create production assets to create an episode record.',
    },
  ];
}

function pipelineStorageKey(showSlug = state.selectedShowSlug) {
  return showSlug ? `podcast-forge:pipeline:${showSlug}` : '';
}

function restorePipelineStateForShow() {
  const key = pipelineStorageKey();

  if (!key) {
    return;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || '{}');
    state.selectedProfileId = typeof saved.selectedProfileId === 'string' ? saved.selectedProfileId : state.selectedProfileId;
    state.selectedCandidateIds = Array.isArray(saved.selectedCandidateIds) ? saved.selectedCandidateIds.filter(Boolean) : [];
    state.clusterForm = {
      angle: typeof saved.clusterForm?.angle === 'string' ? saved.clusterForm.angle : '',
      notes: typeof saved.clusterForm?.notes === 'string' ? saved.clusterForm.notes : '',
      targetFormat: typeof saved.clusterForm?.targetFormat === 'string' ? saved.clusterForm.targetFormat : '',
      targetRuntime: typeof saved.clusterForm?.targetRuntime === 'string' ? saved.clusterForm.targetRuntime : '',
    };
    state.selectedResearchPacketId = typeof saved.selectedResearchPacketId === 'string' ? saved.selectedResearchPacketId : '';
    state.selectedScriptId = typeof saved.selectedScriptId === 'string' ? saved.selectedScriptId : '';
    state.selectedEpisodeId = typeof saved.selectedEpisodeId === 'string' ? saved.selectedEpisodeId : '';
    state.selectedAssetIds = Array.isArray(saved.selectedAssetIds) ? saved.selectedAssetIds.filter(Boolean) : [];
  } catch {
    state.selectedCandidateIds = [];
    state.clusterForm = { angle: '', notes: '', targetFormat: '', targetRuntime: '' };
    state.selectedResearchPacketId = '';
    state.selectedEpisodeId = '';
    state.selectedAssetIds = [];
  }
}

function savePipelineState() {
  const key = pipelineStorageKey();

  if (!key) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify({
    selectedProfileId: state.selectedProfileId,
    selectedCandidateIds: state.selectedCandidateIds,
    clusterForm: state.clusterForm,
    selectedResearchPacketId: state.selectedResearchPacketId,
    selectedScriptId: state.selectedScriptId,
    selectedEpisodeId: state.selectedEpisodeId,
    selectedAssetIds: state.selectedAssetIds,
  }));
}

function clearPipelineSelections() {
  state.selectedCandidateIds = [];
  state.episodePlan = null;
  state.clusterForm = { angle: '', notes: '', targetFormat: '', targetRuntime: '' };
  state.selectedResearchPacketId = '';
  state.selectedScriptId = '';
  state.selectedScript = null;
  state.selectedRevision = null;
  state.selectedRevisions = [];
  state.selectedCoverageSummary = null;
  state.selectedEpisodeId = '';
  state.selectedAssetIds = [];
  state.production = { episode: null, assets: [], jobs: [] };
  state.expandedPipelineStageIds = [];
}

function setActionRunning(action, running) {
  state.runningActions = {
    ...state.runningActions,
    [action]: running,
  };
  render();
}

function isActionRunning(action) {
  return Boolean(state.runningActions[action]);
}

function toggleCandidateSelection(candidateId) {
  if (state.selectedCandidateIds.includes(candidateId)) {
    state.selectedCandidateIds = state.selectedCandidateIds.filter((id) => id !== candidateId);
  } else {
    state.selectedCandidateIds = [...state.selectedCandidateIds, candidateId];
  }

  state.episodePlan = null;
  savePipelineState();
  render();
}

function selectResearchPacket(packet) {
  state.selectedResearchPacketId = packet.id;
  els.scriptResearchPacketId.value = packet.id;
  savePipelineState();
  setStatus('Research brief selected for script drafting.');
  render();
}

function renderShows() {
  els.showSelect.innerHTML = '';

  if (state.shows.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No shows yet';
    option.disabled = true;
    els.showSelect.append(option);
    return;
  }

  for (const show of state.shows) {
    const option = document.createElement('option');
    option.value = show.slug;
    option.textContent = show.title;
    els.showSelect.append(option);
  }

  els.showSelect.value = state.selectedShowSlug;
}

function renderProfiles() {
  els.profileList.innerHTML = '';

  if (state.profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.selectedShowSlug
      ? 'No story sources yet. Next action: open settings or show setup to create a search recipe, RSS feed, or manual intake source.'
      : 'No show selected. Next action: create or select a show, then add story sources.';
    els.profileList.append(empty);
    return;
  }

  for (const profile of state.profiles) {
    const profileQueries = profile.id === state.selectedProfileId ? state.queries : [];
    const credential = sourceCredentialSummary(profile);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-button${profile.id === state.selectedProfileId ? ' active' : ''}${profile.enabled ? '' : ' disabled'}`;
    button.innerHTML = `
      <strong></strong>
      <span class="profile-provider"></span>
      <span class="profile-summary"></span>
      <span class="profile-availability"></span>
    `;
    button.querySelector('strong').textContent = profile.name;
    button.querySelector('.profile-provider').textContent = `${sourceProviderLabel(profile.type)} | ${profile.enabled ? 'enabled' : 'disabled'}`;
    button.querySelector('.profile-summary').textContent = profile.id === state.selectedProfileId
      ? sourceInputSummary(profile, profileQueries)
      : 'Select to review search recipe inputs.';
    button.querySelector('.profile-availability').textContent = credential.label;
    button.querySelector('.profile-availability').classList.add(credential.status);
    button.addEventListener('click', async () => {
      state.selectedProfileId = profile.id;
      savePipelineState();
      await loadQueries();
      render();
    });
    els.profileList.append(button);
  }
}

function renderShowSetup() {
  els.showSetupForm.hidden = !state.showSetupOpen;
  els.showSetupMeta.textContent = state.showSetupOpen
    ? 'Set the show identity, feed destination, starter story source, and default AI role settings. Draft shows can be finished later.'
    : 'Set the show identity, feed destination, starter story source, and default AI role settings. Draft shows can be finished later.';
}

function renderProfileForm() {
  const profile = selectedProfile();
  els.profileForm.hidden = !profile;
  els.queriesPanel.hidden = !profile;

  if (!profile) {
    els.ingestProfile.hidden = true;
    return;
  }

  els.profileTitle.textContent = profile.name;
  els.profileMeta.textContent = `Updated ${new Date(profile.updatedAt).toLocaleString()}`;
  els.profileEnabled.checked = profile.enabled;
  els.profileName.value = profile.name;
  els.profileSlug.value = profile.slug;
  els.profileType.value = profile.type;
  els.profileWeight.value = profile.weight;
  els.profileFreshness.value = profile.freshness || '';
  els.profileIncludeDomains.value = listToLines(profile.includeDomains);
  els.profileExcludeDomains.value = listToLines(profile.excludeDomains);
  applySourceControlState(els.profileForm, profile.type);
  els.ingestProfile.hidden = profile.type !== 'rss';
}

function statusClass(status) {
  return status.replaceAll(' ', '-');
}

function selectedJob() {
  return state.recentJobs.find((job) => job.id === state.selectedJobId) || state.recentJobs[0] || null;
}

function latestRunForTypes(types) {
  return state.recentJobs.find((job) => types.includes(job.type));
}

function taskState(job) {
  if (!job) {
    return 'not started';
  }

  if (!isTerminalJob(job)) {
    return 'running';
  }

  if (job.status === 'failed') {
    return 'failed';
  }

  if ((job.summary?.warnings || []).length > 0) {
    return 'warning';
  }

  return job.status;
}

function taskLabel(type) {
  const labels = {
    'source.search': 'Source search',
    'source.ingest': 'RSS import',
    'episode.plan': 'AI episode plan',
    'research.packet': 'Research brief',
    'script.generate': 'Script draft',
    'script.integrity_review': 'Integrity review',
    'audio.preview': 'Preview audio',
    'art.generate': 'Cover art',
    'publish.rss': 'RSS publishing',
    'pipeline.scheduled': 'Scheduled pipeline',
    'source.import': 'Legacy import',
  };

  return labels[type] || type;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : 'not recorded';
}

function jobProgressText(job) {
  const started = job.startedAt ? `started ${formatTime(job.startedAt)}` : `created ${formatTime(job.createdAt)}`;
  const finished = job.finishedAt ? `finished ${formatTime(job.finishedAt)}` : `updated ${formatTime(job.updatedAt)}`;
  return `${job.progress}% | ${started} | ${finished}`;
}

function selectJob(jobId) {
  state.selectedJobId = jobId;
  render();
  setStatus('Task run details selected.');
}

function viewLatestJob(types) {
  const job = latestRunForTypes(types);

  if (!job) {
    setStatus('No task run has been recorded for that stage yet.');
    return;
  }

  setActiveSurface('debug');
  selectJob(job.id);
  scrollToPanel('jobsPanel');
}

function latestStageJob(types) {
  const job = latestRunForTypes(types);
  return job ? `${taskLabel(job.type)} ${job.status}, ${job.progress}%` : 'No recorded task run yet.';
}

function targetSurface(target) {
  return target?.closest('[data-surface]')?.dataset.surface || '';
}

function isHiddenForNavigation(target) {
  return Boolean(target?.closest('[hidden]'));
}

function renderSurfaceVisibility() {
  for (const button of els.surfaceTabs) {
    const active = button.dataset.surfaceTab === state.activeSurface;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  for (const node of document.querySelectorAll('[data-surface]')) {
    const active = node.dataset.surface === state.activeSurface;
    node.classList.toggle('surface-hidden', !active);
    node.setAttribute('aria-hidden', active && !node.closest('[hidden]') ? 'false' : 'true');
  }
}

function setActiveSurface(surface) {
  if (!SURFACES.has(surface)) {
    return;
  }

  state.activeSurface = surface;
  renderSurfaceVisibility();
}

function panelIsAvailable(id) {
  const target = document.getElementById(id);
  return Boolean(target && !isHiddenForNavigation(target));
}

function scrollToPanel(id) {
  const target = document.getElementById(id);

  if (!target) {
    return;
  }

  const surface = targetSurface(target);
  if (surface && surface !== state.activeSurface) {
    setActiveSurface(surface);
  }

  if (isHiddenForNavigation(target)) {
    return;
  }

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (target.dataset.panelFocusTimeout) {
    window.clearTimeout(Number(target.dataset.panelFocusTimeout));
  }
  if (!target.dataset.panelFocusTracking) {
    target.dataset.panelFocusTracking = 'true';
    target.dataset.panelFocusHadTabindex = target.hasAttribute('tabindex') ? 'true' : 'false';
    if (target.hasAttribute('tabindex')) {
      target.dataset.panelFocusPreviousTabindex = target.getAttribute('tabindex') || '';
    } else {
      delete target.dataset.panelFocusPreviousTabindex;
    }
  }

  target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.classList.add('panel-focus');
  target.dataset.panelFocusTimeout = String(window.setTimeout(() => {
    target.classList.remove('panel-focus');
    if (target.dataset.panelFocusHadTabindex === 'true') {
      target.setAttribute('tabindex', target.dataset.panelFocusPreviousTabindex || '');
    } else {
      target.removeAttribute('tabindex');
    }
    delete target.dataset.panelFocusTimeout;
    delete target.dataset.panelFocusTracking;
    delete target.dataset.panelFocusHadTabindex;
    delete target.dataset.panelFocusPreviousTabindex;
  }, 1200));
}

function stageIsComplete(stage) {
  return stage.status === 'done';
}

function stageStatusLabel(stage) {
  if (stage.status === 'done') {
    return 'complete';
  }

  if (stage.status === 'needs review' || stage.status === 'needs-review') {
    return 'warning';
  }

  if (stage.status === 'not started') {
    return 'not started';
  }

  if (stage.status === 'blocked') {
    return 'blocked';
  }

  if (stage.status === 'ready') {
    return 'ready';
  }

  return String(stage.status || 'not started');
}

function currentPipelineStageId(viewModel, stages) {
  const viewModelStageId = viewModel?.currentStage?.id === 'source'
    ? 'show'
    : viewModel?.currentStage?.id;

  if (viewModelStageId && stages.some((stage) => stage.id === viewModelStageId)) {
    return viewModelStageId;
  }

  return stages.find((stage) => !stageIsComplete(stage))?.id || stages[stages.length - 1]?.id || '';
}

function pipelineStageIsExpanded(stage, currentStageId) {
  return stage.id === currentStageId || state.expandedPipelineStageIds.includes(stage.id);
}

function pruneExpandedPipelineStages(stages) {
  const stageIds = new Set(stages.map((stage) => stage.id));
  state.expandedPipelineStageIds = state.expandedPipelineStageIds.filter((stageId) => stageIds.has(stageId));
}

function setPipelineStageExpanded(stageId, expanded) {
  const expandedIds = new Set(state.expandedPipelineStageIds);
  if (expanded) {
    expandedIds.add(stageId);
  } else {
    expandedIds.delete(stageId);
  }
  state.expandedPipelineStageIds = [...expandedIds];
  renderPipeline();
}

function checklistBlockers(checklist, includePublishApproval = true) {
  return checklist
    .filter((item) => !item.passed && (includePublishApproval || item.key !== 'publishApproval'))
    .map((item) => `${item.label}: ${item.reason}`);
}

function firstBlockerText(items, fallback) {
  return items.find(Boolean) || fallback;
}

const commandBarStageTargets = {
  show: 'showSetupForm',
  source: 'settingsPanel',
  discover: 'settingsPanel',
  story: 'candidatePanel',
  brief: 'researchPanel',
  script: 'scriptPanel',
  review: 'reviewPanel',
  production: 'productionPanel',
  publishing: 'reviewPanel',
};

function commandBarLegacyStage(stageId, stages) {
  const legacyStageId = stageId === 'source' ? 'discover' : stageId;
  return stages.find((stage) => stage.id === legacyStageId) || null;
}

function commandBarDetailsTarget(stageId, stages) {
  const legacyStage = commandBarLegacyStage(stageId, stages);
  return legacyStage?.targetId || commandBarStageTargets[stageId] || 'workflowPanel';
}

function commandBarStatusLabel(status) {
  return String(status || 'unknown').replaceAll('-', ' ');
}

function openCommandBarPanel(targetId) {
  if (panelIsAvailable(targetId)) {
    scrollToPanel(targetId);
    return;
  }

  if (targetId === 'showSetupForm') {
    state.showSetupOpen = true;
    render();
    scrollToPanel(targetId);
    return;
  }

  scrollToPanel(targetId);
}

function commandBarActionTarget(action, stages) {
  if (action.targetPanelId) {
    return { targetId: action.targetPanelId, action: null, disabled: false };
  }

  if (action.targetStage === 'source') {
    return { targetId: 'settingsPanel', action: null, disabled: false };
  }

  const legacyStage = commandBarLegacyStage(action.targetStage, stages);
  return {
    targetId: legacyStage?.targetId || commandBarDetailsTarget(action.targetStage, stages),
    action: legacyStage?.disabled ? null : legacyStage?.action || null,
    disabled: Boolean(legacyStage?.disabled),
    actionReason: legacyStage?.actionReason || '',
    blockers: legacyStage?.blockers || [],
  };
}

function appendCommandBarMetric(container, label, value, className = '') {
  const item = document.createElement('div');
  item.className = `command-bar-metric${className ? ` ${className}` : ''}`;
  const itemLabel = document.createElement('span');
  itemLabel.textContent = label;
  const itemValue = document.createElement('strong');
  itemValue.textContent = value;
  item.append(itemLabel, itemValue);
  container.append(item);
}

function refreshProductionCommandBar() {
  if (!els.productionCommandBar) {
    return;
  }

  state.productionViewModel = deriveProductionViewModel(state);
  renderProductionCommandBar(state.productionViewModel, buildPipelineStages());
}

function renderProductionCommandBar(viewModel, stages) {
  const activeCommandControl = els.productionCommandBar.contains(document.activeElement)
    ? document.activeElement?.dataset?.commandControl
    : null;
  els.productionCommandBar.innerHTML = '';

  if (!viewModel) {
    return;
  }

  const action = viewModel.primaryNextAction;
  const actionTarget = commandBarActionTarget(action, stages);
  const actionTargetBlocked = Boolean(actionTarget.disabled);
  const actionBlocked = !action.enabled || actionTargetBlocked;
  const blockerReason = action.blockerReason
    || (actionTargetBlocked ? actionTarget.actionReason || actionTarget.blockers?.[0] || 'Wait for the current stage action to finish.' : '')
    || viewModel.blockers[0]?.message
    || '';
  const detailsTarget = commandBarDetailsTarget(viewModel.currentStage.id, stages);
  const warningCount = viewModel.warnings.length;
  const blockerCount = viewModel.blockers.length;
  const result = viewModel.latestActionResult || viewModel.workflowActionFeedback || { status: 'idle', message: 'No action result recorded yet.' };
  const sourceSummary = viewModel.selectedStorySourceSummary;
  const showTitle = viewModel.selectedShowSummary?.title || 'No show selected';
  const episodeTitle = viewModel.activeDraftEpisodeSummary?.title
    || viewModel.activeArtifacts?.publishing?.title
    || 'No active episode yet';
  const blockerId = 'production-command-blocker';
  const resultId = 'production-command-result';

  const context = document.createElement('div');
  context.className = 'command-bar-context';
  const kicker = document.createElement('span');
  kicker.className = 'command-bar-kicker';
  kicker.textContent = 'Producing';
  const heading = document.createElement('h2');
  heading.textContent = showTitle;
  const episode = document.createElement('p');
  episode.textContent = episodeTitle;
  context.append(kicker, heading, episode);

  const metrics = document.createElement('div');
  metrics.className = 'command-bar-metrics';
  appendCommandBarMetric(metrics, 'Stage', `${viewModel.currentStage.label} | ${commandBarStatusLabel(viewModel.currentStage.status)}`);
  appendCommandBarMetric(metrics, 'Story source', sourceSummary ? `${sourceSummary.providerType} | ${sourceSummary.statusLabel}` : 'Choose source');
  appendCommandBarMetric(metrics, 'Warnings', String(warningCount), warningCount > 0 ? 'warning' : '');
  appendCommandBarMetric(metrics, 'Blockers', String(blockerCount), blockerCount > 0 ? 'blocked' : '');

  const feedback = document.createElement('div');
  feedback.className = `command-bar-result ${statusClass(result.status || 'idle')}`;
  feedback.id = resultId;
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.setAttribute('aria-atomic', 'true');
  const feedbackLabel = document.createElement('span');
  feedbackLabel.textContent = result.status === 'error' || result.status === 'failed' ? 'Latest failure' : 'Latest result';
  const feedbackMessage = document.createElement('strong');
  feedbackMessage.textContent = result.conciseMessage || result.message || 'No action result recorded yet.';
  feedback.append(feedbackLabel, feedbackMessage);

  const controls = document.createElement('div');
  controls.className = 'command-bar-controls';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'command-bar-primary';
  primary.dataset.commandControl = 'primary';
  primary.textContent = action.label;
  primary.setAttribute('aria-describedby', actionBlocked ? blockerId : resultId);
  primary.disabled = actionBlocked;
  primary.title = actionBlocked && blockerReason ? blockerReason : '';
  primary.addEventListener('click', () => {
    if (!actionTarget.disabled && typeof actionTarget.action === 'function') {
      actionTarget.action();
      return;
    }

    openCommandBarPanel(actionTarget.targetId || detailsTarget);
  });

  const details = document.createElement('button');
  details.type = 'button';
  details.className = 'secondary command-bar-details';
  details.dataset.commandControl = 'details';
  details.textContent = 'Review current stage';
  details.addEventListener('click', () => openCommandBarPanel(detailsTarget));
  controls.append(primary, details);

  const blocker = document.createElement('p');
  blocker.id = blockerId;
  blocker.className = `command-bar-blocker${actionBlocked ? ' visible' : ''}`;
  blocker.textContent = actionBlocked
    ? `Blocked: ${blockerReason || 'the current workflow state blocks this action.'}`
    : blockerCount > 0
      ? `Current blocker: ${viewModel.blockers[0].message}`
      : 'Primary action is available.';
  els.productionCommandBar.append(context, metrics, feedback, controls, blocker);
  if (activeCommandControl) {
    els.productionCommandBar.querySelector(`[data-command-control="${activeCommandControl}"]`)?.focus();
  }
}

function workflowFeedbackLegacyStageId(stageId) {
  return stageId === 'source' ? 'show' : stageId;
}

function attachWorkflowFeedback(stages, viewModel, currentStageId) {
  const feedback = viewModel?.workflowActionFeedback || viewModel?.latestActionResult;
  if (!feedback || feedback.status === 'idle') {
    return stages;
  }

  const feedbackStageId = workflowFeedbackLegacyStageId(feedback.stage || viewModel?.currentStage?.id || currentStageId);
  const target = stages.find((stage) => stage.id === feedbackStageId)
    || stages.find((stage) => stage.id === currentStageId);
  if (target) {
    target.feedback = feedback;
  }
  return stages;
}

function workflowFeedbackDetailText(feedback) {
  const details = {
    status: feedback.status,
    stage: feedback.stage,
    source: feedback.source,
    nextStep: feedback.nextStep || null,
    job: feedback.job || null,
    warnings: asArray(feedback.warnings),
    debugDetails: feedback.debugDetails || null,
  };
  return JSON.stringify(sanitizedDebug(details), null, 2);
}

function renderWorkflowFeedbackPanel(feedback, { compact = false } = {}) {
  const panel = document.createElement('section');
  panel.className = `workflow-feedback-panel ${statusClass(feedback?.status || 'idle')}${compact ? ' compact' : ''}`;
  panel.setAttribute('aria-label', compact ? 'Current stage action result' : 'Workflow action result');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-atomic', 'true');

  const heading = document.createElement('div');
  heading.className = 'workflow-feedback-heading';
  const label = document.createElement('span');
  label.textContent = compact ? 'Current stage result' : 'Action result';
  const title = document.createElement('strong');
  title.textContent = feedback?.title || (feedback?.status === 'blocked' ? 'Action blocked' : 'Latest result');
  heading.append(label, title);

  const message = document.createElement('p');
  message.textContent = feedback?.message || 'No action result recorded yet.';
  panel.append(heading, message);

  if (feedback?.nextStep) {
    const next = document.createElement('p');
    next.className = 'workflow-feedback-next';
    next.textContent = `Next: ${feedback.nextStep}`;
    panel.append(next);
  }

  if (!compact && (feedback?.detailLabel || feedback?.job || asArray(feedback?.warnings).length > 0 || feedback?.debugDetails)) {
    const details = document.createElement('details');
    details.className = 'workflow-feedback-details';
    const summary = document.createElement('summary');
    summary.textContent = feedback.detailLabel || 'Details';
    const body = document.createElement('pre');
    body.textContent = workflowFeedbackDetailText(feedback);
    details.append(summary, body);
    panel.append(details);
  }

  return panel;
}

function stageCard(stage, currentStageId = '') {
  const statusLabel = stageStatusLabel(stage);
  const expanded = pipelineStageIsExpanded(stage, currentStageId);
  const card = document.createElement('article');
  card.className = `pipeline-card ${statusClass(statusLabel)}${expanded ? ' expanded' : ' collapsed'}${stage.id === currentStageId ? ' current' : ''}`;
  card.dataset.stage = String(stage.number);
  card.dataset.stageId = stage.id;
  card.dataset.stageStatus = statusLabel;

  const top = document.createElement('div');
  top.className = 'pipeline-top';
  const heading = document.createElement('div');
  const step = document.createElement('div');
  step.className = 'pipeline-step';
  step.textContent = `Stage ${stage.number}`;
  const title = document.createElement('h3');
  title.textContent = stage.title;
  heading.append(step, title);
  const status = document.createElement('span');
  status.className = `status-pill ${statusClass(statusLabel)}`;
  status.textContent = statusLabel;
  top.append(heading, status);
  if (stage.id === currentStageId) {
    const currentBadge = document.createElement('span');
    currentBadge.className = 'status-pill current';
    currentBadge.textContent = 'current';
    top.append(currentBadge);
  }

  const summary = document.createElement('div');
  summary.className = 'pipeline-summary';
  const summaryText = document.createElement('p');
  summaryText.textContent = stage.artifact;
  const summaryNext = document.createElement('p');
  summaryNext.textContent = stage.blockers?.length
    ? `Blocked: ${stage.blockers[0]}`
    : stage.next;
  summary.append(summaryText, summaryNext);
  card.append(top, summary);

  if (!expanded) {
    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'secondary pipeline-expand';
    expandButton.textContent = 'Expand stage';
    expandButton.setAttribute('aria-expanded', 'false');
    expandButton.setAttribute('aria-label', `Expand ${stage.title}`);
    expandButton.addEventListener('click', () => setPipelineStageExpanded(stage.id, true));
    card.append(expandButton);
    return card;
  }

  const body = document.createElement('div');
  body.className = 'pipeline-card-body';

  const artifacts = document.createElement('div');
  artifacts.className = 'pipeline-artifacts';
  const artifactLabel = document.createElement('span');
  artifactLabel.className = 'pipeline-label';
  artifactLabel.textContent = 'Active/current artifact';
  const artifactText = document.createElement('p');
  artifactText.textContent = stage.artifact;
  artifacts.append(artifactLabel, artifactText);

  const next = document.createElement('div');
  next.className = 'pipeline-next';
  const nextLabel = document.createElement('span');
  nextLabel.className = 'pipeline-label';
  nextLabel.textContent = stage.status === 'blocked' ? 'Blocked reason' : 'Next step';
  const nextText = document.createElement('p');
  nextText.textContent = stage.next;
  next.append(nextLabel, nextText);

  if (stage.blockers?.length) {
    const blockers = document.createElement('ul');
    blockers.className = 'pipeline-blockers';
    for (const blocker of stage.blockers) {
      const item = document.createElement('li');
      item.textContent = blocker;
      blockers.append(item);
    }
    body.append(blockers);
  }

  if (stage.feedback) {
    body.append(renderWorkflowFeedbackPanel(stage.feedback, { compact: true }));
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = stage.primary ? '' : 'secondary';
  button.textContent = stage.actionLabel;
  button.disabled = stage.disabled;
  button.title = stage.disabled ? (stage.actionReason || stage.next) : '';
  const actionReasonId = `pipeline-action-reason-${stage.id}`;
  if (stage.disabled) {
    button.setAttribute('aria-describedby', actionReasonId);
  }
  if (stage.action) {
    button.addEventListener('click', stage.action);
  }

  const actionReason = document.createElement('p');
  actionReason.className = `pipeline-action-reason${stage.disabled ? ' blocked' : ''}`;
  actionReason.id = actionReasonId;
  actionReason.textContent = stage.actionReason || (stage.disabled ? stage.next : `Action available: ${stage.next}`);

  body.append(artifacts, next, button, actionReason);

  if (stage.targetId && panelIsAvailable(stage.targetId)) {
    const panelButton = document.createElement('button');
    panelButton.type = 'button';
    panelButton.className = 'secondary';
    panelButton.textContent = stage.panelActionLabel || `Review ${stage.title}`;
    panelButton.addEventListener('click', () => scrollToPanel(stage.targetId));
    body.append(panelButton);
  }

  if (stage.jobTypes?.length) {
    const jobButton = document.createElement('button');
    jobButton.type = 'button';
    jobButton.className = 'secondary';
    jobButton.textContent = 'View Latest Run';
    const hasLatestRun = Boolean(latestRunForTypes(stage.jobTypes));
    jobButton.disabled = !hasLatestRun;
    if (!hasLatestRun) {
      const jobReasonId = `pipeline-run-reason-${stage.id}`;
      const jobReason = document.createElement('p');
      jobReason.className = 'pipeline-action-reason blocked';
      jobReason.id = jobReasonId;
      jobReason.textContent = 'No task run has been recorded for this stage yet.';
      jobButton.title = jobReason.textContent;
      jobButton.setAttribute('aria-describedby', jobReasonId);
      body.append(jobReason);
    }
    jobButton.addEventListener('click', () => viewLatestJob(stage.jobTypes));
    body.append(jobButton);
  }

  if (stage.id !== currentStageId) {
    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'secondary pipeline-expand';
    collapseButton.textContent = 'Collapse stage';
    collapseButton.setAttribute('aria-expanded', 'true');
    collapseButton.setAttribute('aria-label', `Collapse ${stage.title}`);
    collapseButton.addEventListener('click', () => setPipelineStageExpanded(stage.id, false));
    body.append(collapseButton);
  }

  card.append(body);
  return card;
}

function latestCandidateText() {
  const candidates = selectedCandidates();

  if (candidates.length > 0) {
    return candidates.map((candidate) => candidate.title).join('; ');
  }

  return state.storyCandidates[0]?.title || 'No candidate stories selected yet.';
}

function latestResearchText(packet) {
  if (!packet) {
    return 'No active/current research brief selected yet.';
  }

  const warningCount = packet.warnings?.length || 0;
  return `Active/current: ${packet.title} (${packet.status}, ${warningCount} warning${warningCount === 1 ? '' : 's'})`;
}

function latestScriptText() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return 'No active/current script draft selected yet.';
  }

  return `Active/current: ${script.title} (revision ${revision.version}, ${script.status})`;
}

function latestProductionText() {
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const audio = assets.find((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
  const art = assets.find((asset) => asset.type === 'cover-art');

  if (!episode) {
    return 'No active/current episode or production assets selected yet.';
  }

  return `Active/current: ${episode.title} (${episode.status}) | audio ${audio ? 'ready' : 'missing'} | cover ${art ? 'ready' : 'missing'}`;
}

function workflowStoryContext() {
  const candidates = selectedCandidates();

  if (candidates.length > 0) {
    return candidates.length === 1 ? candidates[0].title : `${candidates.length} candidate stories selected`;
  }

  const packet = selectedResearchPacket();
  if (packet) {
    return packet.title;
  }

  if (state.storyCandidates.length > 0) {
    return `${state.storyCandidates.length} candidate stories loaded`;
  }

  return 'No story selected yet';
}

function workflowRevisionContext() {
  const episode = selectedEpisode();

  if (episode) {
    return `Active/current: ${episode.title} (${episode.status})`;
  }

  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (script && revision) {
    return `Active/current: ${script.title} | revision ${revision.version}`;
  }

  const packet = selectedResearchPacket();
  if (packet) {
    return `${packet.title} | research brief`;
  }

  return 'No active run or revision';
}

function appendSourceSummaryMetric(container, label, value, className = '') {
  const item = document.createElement('div');
  item.className = `story-source-metric${className ? ` ${className}` : ''}`;
  const itemLabel = document.createElement('span');
  itemLabel.textContent = label;
  const itemValue = document.createElement('strong');
  itemValue.textContent = value;
  item.append(itemLabel, itemValue);
  container.append(item);
}

function renderStorySourceSummary(summary) {
  const panel = document.createElement('section');
  panel.className = `story-source-summary${summary?.discoveryReady === false ? ' blocked' : ''}`;
  panel.setAttribute('aria-label', 'Selected story source summary');

  const header = document.createElement('div');
  header.className = 'story-source-summary-header';
  const heading = document.createElement('div');
  const kicker = document.createElement('span');
  kicker.textContent = 'Selected Story Source / Search Recipe';
  const title = document.createElement('h3');
  title.textContent = summary?.name || 'Choose a story source';
  heading.append(kicker, title);
  const badge = document.createElement('span');
  badge.className = `status-pill ${summary?.enabled ? 'done' : 'blocked'}`;
  badge.textContent = summary ? summary.statusLabel : 'not selected';
  header.append(heading, badge);

  const metrics = document.createElement('div');
  metrics.className = 'story-source-metrics';
  appendSourceSummaryMetric(metrics, 'Provider', summary?.providerType || 'Choose a source');
  appendSourceSummaryMetric(metrics, 'Inputs', summary?.inputSummary || 'No input summary yet.');
  appendSourceSummaryMetric(metrics, 'Constraints', summary?.constraintsSummary || 'No constraints selected.');
  appendSourceSummaryMetric(
    metrics,
    'Credential/config',
    summary?.credentialLabel || 'No credential/config status yet.',
    summary?.credentialStatus || '',
  );
  appendSourceSummaryMetric(metrics, 'Last result', summary?.lastSearchResult || 'No source run recorded yet.');

  const action = document.createElement('p');
  action.className = 'story-source-action';
  action.textContent = summary
    ? `${summary.nextActionLabel}: ${summary.nextActionDescription}`
    : 'Choose a Story Source/Search Recipe to see what discovery will do next.';

  if (summary?.discoveryBlocker) {
    const blocker = document.createElement('p');
    blocker.className = 'story-source-blocker';
    blocker.textContent = `Blocked: ${summary.discoveryBlocker}`;
    panel.append(header, metrics, action, blocker);
    return panel;
  }

  panel.append(header, metrics, action);
  return panel;
}

function buildPipelineStages() {
  const show = selectedShow();
  const profile = selectedProfile();
  const candidates = selectedCandidates();
  const candidateAnalysis = selectedCandidateAnalysis();
  const packet = selectedResearchPacket();
  const latestPacket = packet;
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const audioAsset = assets.find((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
  const coverAsset = assets.find((asset) => asset.type === 'cover-art');
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  const scriptApproved = script?.status === 'approved-for-audio'
    && script?.approvedRevisionId === revision?.id;
  const integrity = integrityReviewState(revision);
  const scriptReadyForProduction = Boolean(scriptApproved && !integrity.blocking);
  const productionRunning = state.production.jobs.some((job) => !isTerminalJob(job));
  const discoverRunning = isActionRunning('discover');
  const researchRunning = isActionRunning('research');
  const scriptRunning = isActionRunning('script');
  const integrityRunning = isActionRunning('integrity');
  const approvalsRunning = isActionRunning('approval');
  const publishRunning = isActionRunning('publish');
  const productionActionRunning = productionRunning || isActionRunning('production');
  const packetWarningCount = packet?.warnings?.length || 0;
  const packetBlocked = packet?.status === 'blocked';
  const profileSupportsDiscovery = profile && ['brave', 'zai-web', 'rss'].includes(profile.type);
  const profileDiscoveryBlocker = profile ? sourceDiscoveryBlocker(profile, state.queries) : '';
  const profileActionLabel = profile ? sourceActionLabel(profile.type) : 'Choose Story Source';
  const profileActionDescription = profile ? sourceActionDescription(profile, state.queries) : 'Choose a Story Source/Search Recipe before finding candidate stories.';
  const checklist = publishChecklistState();
  const publishChecklistReady = checklist.every((item) => item.passed);
  const publishPreApprovalReady = checklist.filter((item) => item.key !== 'publishApproval').every((item) => item.passed);
  const firstChecklistBlocker = checklist.find((item) => !item.passed)?.reason;
  const publishBlockers = checklistBlockers(checklist);
  const publishPreApprovalBlockers = checklistBlockers(checklist, false);
  const candidateBlockers = candidateAnalysis.errors.length > 0
    ? candidateAnalysis.errors
    : candidates.length === 0
      ? ['Select at least one candidate story before building a research brief.']
      : [];
  const productionBlockers = [
    !script || !revision ? 'Generate or select a script draft.' : '',
    revision && integrity.status === 'missing' ? 'Run the integrity reviewer before production.' : '',
    revision && integrity.status === 'fail' ? 'Resolve the failed integrity review or record an explicit override reason.' : '',
    script && revision && !scriptApproved ? 'Approve the selected script revision for audio.' : '',
  ].filter(Boolean);

  return [
    {
      id: 'show',
      number: 1,
      title: 'Choose show',
      status: show && profile ? 'done' : show ? 'blocked' : 'not started',
      artifact: show ? `${show.title}${profile ? ` | ${profile.name}` : ''}` : 'No show selected.',
      next: show
        ? (profile ? 'Use this show and source recipe for the next discovery run.' : 'Add or seed a story source/search recipe for this show.')
        : 'Create or select a show before building an episode.',
      actionReason: show
        ? (profile ? 'Show and story source are selected; discovery can use this configuration.' : 'Blocked: choose or create a story source/search recipe for this show before finding candidates.')
        : 'Start here: choose an existing show or create a new show with feed and source settings.',
      blockers: show && !profile ? ['Choose or create a story source/search recipe for this show.'] : [],
      actionLabel: show ? 'Edit Show Settings' : 'Create New Show',
      panelActionLabel: show ? 'Edit show settings' : 'Create show setup',
      action: () => {
        if (show) {
          scrollToPanel('settingsPanel');
          return;
        }
        state.showSetupOpen = true;
        render();
        scrollToPanel('showSetupForm');
      },
      disabled: false,
      active: Boolean(show && profile),
      targetId: show ? 'settingsPanel' : 'showSetupForm',
    },
    {
      id: 'discover',
      number: 2,
      title: 'Find story candidates',
      status: discoverRunning ? 'running' : !profile ? 'blocked' : state.storyCandidates.length > 0 ? 'done' : (profileSupportsDiscovery || profile.type === 'manual') ? 'ready' : 'blocked',
      artifact: state.storyCandidates.length > 0
        ? `${state.storyCandidates.length} candidate stor${state.storyCandidates.length === 1 ? 'y' : 'ies'} loaded. Latest: ${state.storyCandidates[0].title}`
        : 'No candidate stories loaded yet.',
      next: !profile
        ? 'Choose a story source/search recipe first.'
        : profile.type === 'manual'
          ? 'Paste a manual source URL below to add a possible story.'
          : profileSupportsDiscovery
            ? profileActionDescription
            : 'This source type is not wired for browser-triggered discovery yet.',
      actionReason: discoverRunning
        ? 'Discovery is already running; wait for the task run to finish or inspect progress.'
        : !profile
          ? 'Blocked: choose a story source/search recipe before running discovery.'
          : profile.type === 'manual'
            ? 'Add a manual URL to create a candidate story with explicit source provenance.'
            : profileSupportsDiscovery
              ? (profileDiscoveryBlocker ? `Blocked: ${profileDiscoveryBlocker}` : `Ready: ${profileActionDescription}`)
              : 'Blocked: this story source type cannot run discovery from the browser; use Brave, Z.AI, RSS, or manual intake.',
      blockers: !profile
        ? ['Choose a story source/search recipe.']
        : profileDiscoveryBlocker
          ? [profileDiscoveryBlocker]
        : !profileSupportsDiscovery && profile.type !== 'manual'
          ? ['Choose a Brave, Z.AI, RSS, or manual story source for browser-triggered discovery.']
          : [],
      actionLabel: profileActionLabel,
      panelActionLabel: profile?.type === 'manual' ? 'Add manual story URL' : 'Edit story source settings',
      action: !profile ? () => scrollToPanel('settingsPanel') : profileSupportsDiscovery ? runSelectedProfileDiscovery : profile.type === 'manual' ? focusManualStoryForm : () => scrollToPanel('settingsPanel'),
      disabled: discoverRunning || Boolean(profileDiscoveryBlocker),
      active: state.storyCandidates.length > 0,
      targetId: profile?.type === 'manual' ? 'manualStoryPanel' : 'settingsPanel',
      jobTypes: ['source.search', 'source.ingest'],
    },
    {
      id: 'story',
      number: 3,
      title: 'Pick / cluster story',
      status: state.storyCandidates.length === 0 ? 'blocked' : candidates.length > 0 ? 'done' : 'ready',
      artifact: latestCandidateText(),
      next: candidates.length > 0
        ? candidateAnalysis.canLaunch
          ? `${candidates.length} candidate stor${candidates.length === 1 ? 'y is' : 'ies are'} selected for the brief.`
          : 'Review the selected story warnings before building a research brief.'
        : 'Select one or more possible stories before building a research brief.',
      actionReason: state.storyCandidates.length === 0
        ? 'Blocked: run/import candidates or submit a manual URL before choosing the story.'
        : candidates.length > 0
          ? (candidateAnalysis.canLaunch ? 'Selection is ready for a research brief.' : firstBlockerText(candidateBlockers, 'Review selected story blockers before building a research brief.'))
          : 'Ready: select a candidate story to define the episode focus.',
      blockers: state.storyCandidates.length === 0 ? ['Run/import candidates or submit a manual story URL.'] : candidates.length > 0 && !candidateAnalysis.canLaunch ? candidateBlockers : [],
      actionLabel: candidates.length > 0 ? 'Clear Selection' : 'Select Top Candidate',
      panelActionLabel: 'Review story candidates',
      action: candidates.length > 0 ? clearCandidateSelection : selectTopCandidate,
      disabled: state.storyCandidates.length === 0,
      active: candidates.length > 0,
      targetId: 'candidatePanel',
    },
    {
      id: 'brief',
      number: 4,
      title: 'Build research brief',
      status: researchRunning
        ? 'running'
        : packetBlocked || (!packet && state.researchPackets.length === 0 && !candidateAnalysis.canLaunch)
          ? 'blocked'
          : packet && packetWarningCount > 0
            ? 'needs review'
            : packet
              ? 'done'
              : 'ready',
      artifact: latestResearchText(latestPacket),
      next: packet
        ? (packetWarningCount > 0 ? 'Review warnings before drafting or approving production.' : 'Use this research brief to draft the episode.')
        : state.researchPackets.length > 0 ? 'Select the latest research brief or build a new one from selected candidate stories.' : candidates.length > 0 ? 'Build a research brief from the selected candidate stories.' : 'Select candidate stories first.',
      actionReason: researchRunning
        ? 'A research brief is already being built; wait for the task run to finish or inspect progress.'
        : packet
          ? (packetWarningCount > 0 ? `${packetWarningCount} research warning${packetWarningCount === 1 ? '' : 's'} need review before approval or production.` : 'Selected research brief can be used for script drafting.')
          : state.researchPackets.length > 0
            ? 'Ready: select the latest research brief or build a new brief from the selected candidates.'
            : candidateAnalysis.canLaunch
              ? 'Ready: build a research brief from the selected candidate stories.'
              : firstBlockerText(candidateBlockers, 'Blocked: select candidate stories before building a research brief.'),
      blockers: !packet && state.researchPackets.length === 0 && !candidateAnalysis.canLaunch ? candidateBlockers : [],
      actionLabel: packet ? 'Use Selected Brief' : state.researchPackets.length > 0 ? 'Select Latest Brief' : 'Build Research Brief',
      panelActionLabel: 'Build research brief',
      action: packet ? () => selectResearchPacket(packet) : state.researchPackets.length > 0 ? () => selectResearchPacket(state.researchPackets[0]) : buildResearchBriefFromSelected,
      disabled: researchRunning || (!packet && state.researchPackets.length === 0 && !candidateAnalysis.canLaunch),
      active: Boolean(packet),
      targetId: 'researchPanel',
      jobTypes: ['research.packet'],
    },
    {
      id: 'script',
      number: 5,
      title: 'Generate script',
      status: scriptRunning ? 'running' : script ? 'done' : packet && !packetBlocked ? 'ready' : 'blocked',
      artifact: latestScriptText(),
      next: script
        ? 'Review the draft and continue to integrity review before production.'
        : packet && !packetBlocked ? 'Generate an episode draft from the selected research brief.' : 'Select a ready research brief first.',
      actionReason: scriptRunning
        ? 'A script draft is already being generated; wait for the task run to finish or inspect progress.'
        : script
          ? 'Script selected; review it, run integrity review, and approve a revision before audio.'
          : packet && !packetBlocked
            ? 'Ready: generate a script from the selected research brief.'
            : packetBlocked
              ? 'Blocked: resolve or override research warnings before drafting.'
              : 'Blocked: build or select a research brief before generating a script.',
      blockers: !script && (!packet || packetBlocked)
        ? [packetBlocked ? 'Resolve or override research warnings before drafting.' : 'Build or select a research brief.']
        : [],
      actionLabel: script ? 'Review Script Draft' : 'Generate Script Draft',
      panelActionLabel: 'Generate script',
      action: script ? focusScriptEditor : generateScriptFromSelectedResearch,
      disabled: scriptRunning || (!script && (!packet || packetBlocked)),
      active: Boolean(script),
      targetId: 'scriptPanel',
      jobTypes: ['script.generate'],
    },
    {
      id: 'review',
      number: 6,
      title: 'Integrity review',
      status: integrityRunning || approvalsRunning ? 'running' : scriptReadyForProduction ? 'done' : script && revision ? 'ready' : 'blocked',
      artifact: revision
        ? `Integrity review ${integrityReviewLabel(integrity.status)}${scriptApproved ? ' | script approved for audio' : ''}`
        : 'No script revision selected yet.',
      next: !script || !revision
        ? 'Generate or select a script draft first.'
        : integrity.blocking
          ? 'Run the integrity reviewer or record an explicit override before production.'
          : scriptApproved ? 'Integrity and script approval gates are complete.' : 'Approve the reviewed script revision for audio.',
      actionReason: integrityRunning || approvalsRunning
        ? 'Review or approval is already running; wait for it to finish.'
        : !script || !revision
          ? 'Blocked: generate or select a script draft before the integrity gate.'
          : integrity.blocking
            ? (integrity.status === 'fail' ? 'Blocked: resolve the failed integrity review or record an explicit override reason.' : 'Blocked: run the integrity reviewer before production.')
            : scriptApproved ? 'Integrity review and script approval are complete.' : 'Ready: approve the reviewed script revision for audio.',
      blockers: !script || !revision
        ? ['Generate or select a script draft.']
        : integrity.blocking
          ? [integrity.status === 'fail' ? 'Resolve the failed integrity review or record an explicit override reason.' : 'Run the integrity reviewer before production.']
          : !scriptApproved ? ['Approve the reviewed script revision for audio.'] : [],
      actionLabel: !script || !revision
        ? 'Select Script Draft'
        : integrity.blocking ? 'Run Integrity Review' : scriptApproved ? 'Review Approval Gates' : 'Approve Script for Audio',
      panelActionLabel: !script || !revision ? 'Select script draft' : 'Review integrity gate',
      action: !script || !revision
        ? () => scrollToPanel('scriptPanel')
        : integrity.blocking ? runSelectedIntegrityReview : scriptApproved ? () => scrollToPanel('reviewPanel') : approveSelectedScript,
      disabled: integrityRunning || approvalsRunning,
      active: Boolean(revision && !integrity.blocking),
      targetId: !script || !revision ? 'scriptPanel' : 'reviewPanel',
    },
    {
      id: 'production',
      number: 7,
      title: 'Produce audio / cover',
      status: productionActionRunning ? 'running' : audioAsset && coverAsset ? 'done' : scriptReadyForProduction ? 'ready' : 'blocked',
      artifact: latestProductionText(),
      next: audioAsset && coverAsset
        ? 'Preview audio and cover art are ready for approval and publishing review.'
        : scriptReadyForProduction ? 'Create the missing preview audio and cover art assets.' : integrity.blocking ? 'Complete the integrity review gate before production.' : 'Approve the reviewed script revision for audio first.',
      actionReason: productionActionRunning
        ? 'Production is already running; wait for audio or cover art task runs to finish.'
        : audioAsset && coverAsset
          ? 'Audio and cover assets exist; review them for publish approval.'
          : scriptReadyForProduction
            ? `Ready: create missing ${audioAsset ? 'cover art' : coverAsset ? 'audio' : 'audio and cover art'} assets.`
            : firstBlockerText(productionBlockers, 'Blocked: complete script approval and integrity review before production.'),
      blockers: !scriptReadyForProduction && !(audioAsset && coverAsset) ? productionBlockers : [],
      actionLabel: audioAsset && coverAsset ? 'Refresh Audio and Cover Assets' : 'Create Missing Audio and Cover',
      panelActionLabel: 'Create audio and cover assets',
      action: audioAsset && coverAsset ? refreshProductionUntilSettled : createMissingProductionAssets,
      disabled: productionActionRunning || (!scriptReadyForProduction && !(audioAsset && coverAsset)),
      active: Boolean(audioAsset || coverAsset),
      targetId: 'productionPanel',
      jobTypes: ['audio.preview', 'art.generate'],
    },
    {
      id: 'publishing',
      number: 8,
      title: 'Approve and publish',
      status: publishRunning || approvalsRunning ? 'running' : episode?.status === 'published' ? 'done' : episode?.status === 'approved-for-publish' && publishChecklistReady ? 'ready' : episode?.status === 'audio-ready' && publishPreApprovalReady ? 'ready' : 'blocked',
      artifact: episode?.feedGuid || episode?.metadata?.publish?.rssUrl || 'No publishing record yet.',
      next: episode?.status === 'published'
        ? 'RSS publishing has a recorded feed GUID or publish result.'
        : episode?.status === 'approved-for-publish' ? (publishChecklistReady ? 'Publish to the configured RSS feed.' : firstChecklistBlocker || 'Complete the publish checklist first.')
          : episode?.status === 'audio-ready' ? (publishPreApprovalReady ? 'Approve the episode for publishing after reviewing assets.' : firstChecklistBlocker || 'Complete the publish checklist before approval.')
            : 'Production assets and explicit publish approval are required before RSS output.',
      actionReason: publishRunning || approvalsRunning
        ? 'Publish approval or publishing is already running; wait for it to finish.'
        : episode?.status === 'published'
          ? 'Episode is already published; feed and publish records are available for audit.'
          : episode?.status === 'approved-for-publish'
            ? (publishChecklistReady ? 'Ready: publish the approved episode to RSS.' : `Blocked: ${firstBlockerText(publishBlockers, 'complete the publish checklist first.')}`)
            : episode?.status === 'audio-ready'
              ? (publishPreApprovalReady ? 'Ready: approve the episode for publishing after reviewing assets.' : `Blocked: ${firstBlockerText(publishPreApprovalBlockers, 'complete the publish checklist before approval.')}`)
              : 'Blocked: produce audio and cover assets, then approve the episode for publishing.',
      blockers: episode?.status === 'published'
        ? []
        : episode?.status === 'approved-for-publish'
          ? publishBlockers
          : episode?.status === 'audio-ready'
            ? publishPreApprovalBlockers
            : ['Produce missing audio/cover assets and approve the episode for publishing.'],
      actionLabel: episode?.status === 'published' ? 'Review Published Episode' : episode?.status === 'approved-for-publish' ? 'Publish to RSS' : 'Approve Episode for Publishing',
      panelActionLabel: 'Review publish checklist',
      action: episode?.status === 'approved-for-publish' ? publishSelectedEpisode : approveEpisodeForPublishing,
      disabled: publishRunning || approvalsRunning || !(episode?.status === 'approved-for-publish' ? publishChecklistReady : (episode?.status === 'audio-ready' && publishPreApprovalReady)),
      active: episode?.status === 'published',
      primary: true,
      targetId: 'reviewPanel',
      jobTypes: ['publish.rss'],
    },
  ];
}

function renderPipeline() {
  const viewModel = state.productionViewModel || deriveProductionViewModel(state);
  const show = selectedShow();
  const profile = selectedProfile();
  els.pipelineMeta.textContent = show
    ? `${show.title}${profile ? ` | Story source: ${profile.name}` : ' | Choose a story source/search recipe'}`
    : 'Choose a show to start an evidence-first episode workflow.';
  els.workflowContext.innerHTML = '';

  const contextItems = [
    ['Selected show', show ? show.title : 'No show selected'],
    ['Story source', profile ? profile.name : 'Choose a source/search recipe'],
    ['Episode/story', workflowStoryContext()],
    ['Active run/revision', workflowRevisionContext()],
  ];

  for (const [label, value] of contextItems) {
    const item = document.createElement('div');
    item.className = 'workflow-context-item';
    const itemLabel = document.createElement('span');
    itemLabel.textContent = label;
    const itemValue = document.createElement('strong');
    itemValue.textContent = value;
    item.append(itemLabel, itemValue);
    els.workflowContext.append(item);
  }

  els.workflowContext.append(renderStorySourceSummary(viewModel.selectedStorySourceSummary));

  if (viewModel.workflowActionFeedback && viewModel.workflowActionFeedback.status !== 'idle') {
    els.workflowContext.append(renderWorkflowFeedbackPanel(viewModel.workflowActionFeedback));
  }

  const scopeWarnings = asArray(viewModel.artifactScopeWarnings);
  const archiveCounts = viewModel.historicalArtifacts || {};
  const archiveCount = Object.values(archiveCounts).reduce((total, items) => total + asArray(items).length, 0);
  const scopePanel = document.createElement('div');
  scopePanel.className = `artifact-scope-panel${scopeWarnings.length > 0 ? ' warning' : ''}`;
  const scopeLabel = document.createElement('span');
  scopeLabel.textContent = scopeWarnings.length > 0 ? 'Current production warning' : 'Artifact scope';
  const scopeText = document.createElement('strong');
  scopeText.textContent = scopeWarnings.length > 0
    ? `${scopeWarnings.length} artifact${scopeWarnings.length === 1 ? '' : 's'} not part of current production.`
    : archiveCount > 0 ? `${archiveCount} history/archive artifact${archiveCount === 1 ? '' : 's'} kept out of active state.` : 'Only active/current artifacts are shown as production state.';
  const scopeDetail = document.createElement('p');
  scopeDetail.textContent = 'History/archive records remain available for audit, but production and publishing actions use active/current artifacts only.';
  scopePanel.append(scopeLabel, scopeText);
  if (scopeWarnings.length > 0) {
    const warningList = document.createElement('div');
    warningList.className = 'artifact-scope-warning-list';
    scopeWarnings.forEach((warning) => {
      const warningItem = document.createElement('p');
      warningItem.textContent = warning.message;
      warningList.append(warningItem);
    });
    scopePanel.append(warningList);
  }
  scopePanel.append(scopeDetail);
  els.workflowContext.append(scopePanel);

  const stages = buildPipelineStages();
  pruneExpandedPipelineStages(stages);
  const currentStageId = currentPipelineStageId(viewModel, stages);
  attachWorkflowFeedback(stages, viewModel, currentStageId);
  renderProductionCommandBar(viewModel, stages);
  els.pipelineStages.innerHTML = '';

  for (const stage of stages) {
    els.pipelineStages.append(stageCard(stage, currentStageId));
  }

  els.pipelineDebug.textContent = JSON.stringify(sanitizedDebug({
    productionViewModel: viewModel,
    showSlug: state.selectedShowSlug,
    sourceProfileId: state.selectedProfileId,
    selectedCandidateIds: state.selectedCandidateIds,
    clusterForm: state.clusterForm,
    selectedResearchPacketId: state.selectedResearchPacketId,
    selectedScriptId: state.selectedScriptId,
    selectedRevisionId: state.selectedRevision?.id ?? null,
    selectedEpisodeId: state.selectedEpisodeId || state.production.episode?.id || null,
    selectedAssetIds: state.selectedAssetIds,
  }), null, 2);
}

function renderQueries() {
  els.queryList.innerHTML = '';
  els.queryCount.textContent = `${state.queries.filter((query) => query.enabled).length} enabled of ${state.queries.length}`;

  if (state.queries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No search queries yet. Add a focused query or RSS feed URL, then run search or import RSS items to find candidate stories.';
    els.queryList.append(empty);
    return;
  }

  for (const query of state.queries) {
    const form = document.createElement('form');
    form.className = `query-card${query.enabled ? '' : ' disabled'}`;
    form.innerHTML = `
      <div class="query-top">
        <label class="toggle">
          <input name="enabled" type="checkbox">
          <span>Enabled</span>
        </label>
        <button class="danger" name="delete" type="button">Delete</button>
      </div>
      <label class="field">
        <span>Search query</span>
        <textarea name="query" rows="2" required></textarea>
      </label>
      <div class="query-grid">
        <label class="field">
          <span>Weight</span>
          <input name="weight" type="number" min="0" step="0.001" required>
        </label>
        <label class="field">
          <span>Freshness window</span>
          <input name="freshness" type="text">
        </label>
        <label class="field">
          <span>Include domains</span>
          <textarea name="includeDomains" rows="2"></textarea>
        </label>
        <label class="field">
          <span>Exclude domains</span>
          <textarea name="excludeDomains" rows="2"></textarea>
        </label>
      </div>
      <p class="help" data-source-control-help></p>
      <div class="actions">
        <button type="submit">Save Search Query</button>
      </div>
    `;

    form.elements.enabled.checked = query.enabled;
    form.elements.query.value = query.query;
    form.elements.weight.value = query.weight;
    form.elements.freshness.value = query.freshness || '';
    form.elements.includeDomains.value = listToLines(query.includeDomains);
    form.elements.excludeDomains.value = listToLines(query.excludeDomains);
    applySourceControlState(form, selectedProfile()?.type);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveQuery(query.id, form, selectedProfile());
    });
    form.elements.delete.addEventListener('click', async () => {
      await confirmDeleteQuery(query);
    });
    els.queryList.append(form);
  }
}

function appendPlanText(section, title, text) {
  const block = document.createElement('section');
  block.className = 'episode-plan-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = text || 'Not provided.';
  block.append(heading, body);
  section.append(block);
}

function appendPlanList(section, title, items, mapper = (item) => String(item)) {
  const block = document.createElement('section');
  block.className = 'episode-plan-section wide';
  const heading = document.createElement('h4');
  heading.textContent = title;
  block.append(heading);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Not provided.';
    block.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'episode-plan-list';
    for (const item of items) {
      const row = document.createElement('li');
      row.textContent = mapper(item);
      list.append(row);
    }
    block.append(list);
  }

  section.append(block);
}

function renderEpisodePlan() {
  els.episodePlanResult.innerHTML = '';
  const plan = state.episodePlan;

  if (!plan) {
    return;
  }

  const selected = new Set(state.selectedCandidateIds);
  const planMatchesSelection = asArray(plan.candidateIds).every((id) => selected.has(id)) && selected.size === asArray(plan.candidateIds).length;

  const title = document.createElement('h3');
  title.textContent = plan.proposedAngle || 'AI episode plan';
  const banner = document.createElement('p');
  banner.className = 'episode-plan-banner';
  banner.textContent = planMatchesSelection
    ? 'AI-generated editorial assistance only. This is not verified evidence and does not approve research, scripts, or publishing.'
    : 'This AI plan was generated for a previous selection. Select the same candidate stories or request a fresh plan.';

  const grid = document.createElement('div');
  grid.className = 'episode-plan-grid';
  appendPlanText(grid, 'Why now', plan.whyNow);
  appendPlanText(grid, 'Audience relevance', plan.audienceRelevance);
  appendPlanList(grid, 'Known from candidate records', asArray(plan.knownFacts));
  appendPlanList(grid, 'Unknowns and source gaps', asArray(plan.unknownsSourceGaps));
  appendPlanList(grid, 'Questions to answer', asArray(plan.questionsToAnswer));
  appendPlanList(grid, 'Recommended sources to fetch next', asArray(plan.recommendedSources), (source) => {
    const priority = source.priority ? `${source.priority} priority` : 'medium priority';
    const query = source.suggestedQuery ? ` | query: ${source.suggestedQuery}` : '';
    const url = source.url ? ` | ${source.url}` : '';
    return `${source.sourceType || 'source'} (${priority}): ${source.rationale || 'No rationale recorded.'}${query}${url}`;
  });

  if (asArray(plan.warnings).length > 0) {
    appendPlanList(grid, 'Planner warnings', asArray(plan.warnings), (warning) => `${warning.code || 'warning'}: ${warning.message || JSON.stringify(sanitizedDebug(warning))}`);
  }

  const details = document.createElement('details');
  details.className = 'debug-details row-debug';
  details.innerHTML = '<summary>Planning audit metadata</summary><pre></pre>';
  details.querySelector('pre').textContent = JSON.stringify(sanitizedDebug({
    id: plan.id,
    candidateIds: plan.candidateIds,
    generatedAt: plan.generatedAt,
    aiGenerated: plan.aiGenerated,
    advisoryOnly: plan.advisoryOnly,
    evidenceStatus: plan.evidenceStatus,
    gateStatus: plan.gateStatus,
    modelProfile: plan.modelProfile,
    promptTemplate: plan.promptTemplate,
  }), null, 2);

  els.episodePlanResult.append(title, banner, grid, details);
}

function renderCandidateSelectionPanel() {
  const analysis = selectedCandidateAnalysis();
  const { candidates } = analysis;
  const selectedCount = candidates.length;
  const researchRunning = isActionRunning('research');
  const planningRunning = isActionRunning('planning');

  els.selectionCount.textContent = selectedCount === 0
    ? 'No candidate stories selected'
    : `${selectedCount} candidate stor${selectedCount === 1 ? 'y' : 'ies'} selected`;
  els.selectedCandidateSummary.textContent = selectedCount === 0
    ? 'Select one or more possible stories to group them into an episode angle.'
    : candidates.map((candidate) => {
      const domain = hostnameFor(candidateUrl(candidate)) || candidate.sourceName || 'unknown source';
      return `${candidate.title} (${domain})`;
    }).join(' | ');
  els.clearCandidateSelection.disabled = selectedCount === 0 || researchRunning;
  els.clusterAngle.value = state.clusterForm.angle;
  els.clusterNotes.value = state.clusterForm.notes;
  els.clusterFormat.value = state.clusterForm.targetFormat;
  els.clusterRuntime.value = state.clusterForm.targetRuntime;
  els.selectionWarnings.innerHTML = '';

  const reviewItems = [
    ...analysis.errors.map((text) => ({ level: 'error', text })),
    ...analysis.warnings.map((text) => ({ level: 'warning', text })),
  ];

  if (selectedCount > 0 && analysis.urls.length > 0) {
    reviewItems.unshift({
      level: 'info',
      text: `Selected evidence: ${analysis.urls.map((url) => hostnameFor(url) || url).join(', ')}`,
    });
  }

  if (selectedCount > 1 && analysis.duplicateDomains.length === 0 && analysis.sharedKeywords.length === 0) {
    reviewItems.push({
      level: 'warning',
      text: 'No obvious same-domain or shared-title cue found; confirm these stories belong in one brief.',
    });
  }

  if (selectedCount === 0) {
    reviewItems.push({
      level: 'info',
      text: state.storyCandidates.length === 0
        ? 'Build Research Brief is blocked until candidate stories are discovered, imported, or added manually.'
        : 'Build Research Brief is blocked until at least one candidate story is selected.',
    });
  } else if (!analysis.canLaunch) {
    reviewItems.push({
      level: 'error',
      text: firstBlockerText(analysis.errors, 'Build Research Brief is blocked until selected story issues are resolved.'),
    });
  }

  for (const item of reviewItems) {
    const row = document.createElement('div');
    row.className = `warning-item ${item.level === 'error' ? 'error' : item.level === 'info' ? 'info' : ''}`;
    row.textContent = item.text;
    els.selectionWarnings.append(row);
  }

  els.launchClusterBrief.disabled = researchRunning || !analysis.canLaunch;
  els.launchClusterBrief.textContent = researchRunning ? 'Building Research Brief...' : 'Build Research Brief';
  els.requestEpisodePlan.disabled = planningRunning || selectedCount === 0;
  els.requestEpisodePlan.textContent = planningRunning ? 'Planning...' : 'AI Episode Plan';
  renderEpisodePlan();
}

function renderStoryCandidates() {
  els.candidateList.innerHTML = '';
  els.candidateMeta.textContent = `${state.storyCandidates.length} recent candidate stor${state.storyCandidates.length === 1 ? 'y' : 'ies'}`;
  renderCandidateSelectionPanel();

  if (state.storyCandidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No candidate stories yet. Add search queries, import RSS items, run a scheduled pipeline, or submit a manual story URL.';
    els.candidateList.append(empty);
    return;
  }

  for (const [index, candidate] of state.storyCandidates.entries()) {
    const row = document.createElement('article');
    const selected = state.selectedCandidateIds.includes(candidate.id);
    row.className = `record-row candidate-row${selected ? ' selected' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.className = 'candidate-select';
    checkbox.type = 'checkbox';
    checkbox.checked = selected;
    checkbox.setAttribute('aria-label', `Select ${candidate.title}`);
    checkbox.addEventListener('change', () => {
      toggleCandidateSelection(candidate.id);
    });

    const body = document.createElement('div');
    body.className = 'candidate-body';
    const title = document.createElement('strong');
    title.textContent = candidate.title;

    const meta = document.createElement('span');
    const url = candidateUrl(candidate);
    const domain = hostnameFor(url);
    const sourceProfile = sourceProfileForCandidate(candidate);
    const published = candidate.publishedAt
      ? `published ${new Date(candidate.publishedAt).toLocaleString()}`
      : `discovered ${new Date(candidate.discoveredAt).toLocaleString()}`;
    meta.textContent = [
      candidate.sourceName || domain || 'unknown source',
      domain || 'no source URL',
      candidateScoreText(candidate, index),
      published,
      candidate.status,
    ].join(' | ');

    const facts = document.createElement('div');
    facts.className = 'candidate-facts';
    const origin = document.createElement('span');
    origin.className = 'candidate-chip';
    origin.textContent = `origin: ${sourceProfile?.name || 'manual/imported'} | ${sourceQueryText(candidate)}`;
    facts.append(origin);

    const rationale = scoreBreakdown(candidate).rationale;
    if (typeof rationale === 'string' && rationale.trim()) {
      const chip = document.createElement('span');
      chip.className = 'candidate-chip';
      chip.textContent = rationale;
      facts.append(chip);
    }

    if (scoreBreakdown(candidate).angle) {
      const chip = document.createElement('span');
      chip.className = 'candidate-chip';
      chip.textContent = `suggested angle: ${scoreBreakdown(candidate).angle}`;
      facts.append(chip);
    }

    const flags = document.createElement('div');
    flags.className = 'candidate-flags';
    for (const warning of candidateStatusWarnings(candidate)) {
      const chip = document.createElement('span');
      chip.className = `candidate-chip ${warning.level}`;
      chip.textContent = warning.text;
      flags.append(chip);
    }

    const summary = document.createElement('p');
    summary.textContent = candidate.summary || candidate.url || 'No summary recorded.';

    const actions = document.createElement('div');
    actions.className = 'actions inline row-actions';

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = selected ? 'Selected for Brief' : 'Select for Brief';
    select.addEventListener('click', () => {
      toggleCandidateSelection(candidate.id);
    });

    const createBrief = document.createElement('button');
    createBrief.type = 'button';
    createBrief.className = 'secondary';
    createBrief.textContent = 'Create Research Brief';
    createBrief.disabled = !candidateUrl(candidate) || candidate.status === 'ignored';
    createBrief.addEventListener('click', async () => {
      await createResearchBrief(candidate.id, createBrief);
    });

    actions.append(select, createBrief);
    body.append(title, meta, facts);
    if (flags.children.length > 0) {
      body.append(flags);
    }
    body.append(summary, actions);
    row.append(checkbox, body);
    els.candidateList.append(row);
  }
}

function renderResearchBriefs() {
  els.researchBriefList.innerHTML = '';
  els.researchBriefMeta.textContent = `${state.researchPackets.length} research brief${state.researchPackets.length === 1 ? '' : 's'} for this show`;

  if (state.researchPackets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No research briefs yet. Create one from a candidate story after sources have been discovered or added manually.';
    els.researchBriefList.append(empty);
    return;
  }

  for (const packet of state.researchPackets) {
    const scope = artifactScope('brief', packet.id);
    const row = document.createElement('article');
    const isActiveBrief = currentProductionViewModel().activeArtifacts?.brief?.id === packet.id;
    row.className = `record-row ${scope.className}-artifact${isActiveBrief ? ' selected' : ''}`;

    const title = document.createElement('strong');
    title.textContent = packet.title;
    appendScopePill(title, scope);

    const warningCount = packet.warnings?.length || 0;
    const meta = document.createElement('span');
    meta.textContent = `${packet.status} | ${packet.citations?.length || 0} citation${packet.citations?.length === 1 ? '' : 's'} | ${warningCount} warning${warningCount === 1 ? '' : 's'}`;

    const summary = document.createElement('p');
    summary.textContent = scope.className === 'archive'
      ? 'History/archive research brief. Not part of current production for the selected candidate story.'
      : warningCount > 0
        ? 'Active/current research brief. Review warnings before drafting or approving production.'
        : 'Active/current research brief. Ready for script drafting when the editor is comfortable with the source mix.';

    const actions = document.createElement('div');
    actions.className = 'actions inline row-actions';
    const useForScript = document.createElement('button');
    useForScript.type = 'button';
    useForScript.className = 'secondary';
    useForScript.textContent = isActiveBrief
      ? 'Active for Script'
      : scope.className === 'archive'
        ? 'Select for Audit Only'
        : 'Use for Script';
    useForScript.addEventListener('click', () => {
      selectResearchPacket(packet);
    });
    actions.append(useForScript);

    if (warningCount > 0) {
      const details = document.createElement('details');
      details.className = 'debug-details row-debug';
      details.innerHTML = '<summary>Warning details</summary><pre></pre>';
      details.querySelector('pre').textContent = JSON.stringify(packet.warnings, null, 2);
      row.append(title, meta, summary, actions, details);
    } else {
      row.append(title, meta, summary, actions);
    }

    els.researchBriefList.append(row);
  }
}

function renderEpisodes() {
  els.episodeList.innerHTML = '';
  els.episodeMeta.textContent = `${state.episodes.length} episode${state.episodes.length === 1 ? '' : 's'}`;

  if (state.episodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No episodes yet. Approve a script for audio, create assets, complete the publishing checklist, then publish to RSS.';
    els.episodeList.append(empty);
    return;
  }

  for (const episode of state.episodes) {
    const scope = artifactScope('publishing', episode.id);
    const row = document.createElement('article');
    const isActiveEpisode = currentProductionViewModel().activeArtifacts?.publishing?.id === episode.id;
    row.className = `record-row ${scope.className}-artifact${isActiveEpisode ? ' selected' : ''}`;

    const title = document.createElement('strong');
    title.textContent = episode.episodeNumber ? `EP${episode.episodeNumber}: ${episode.title}` : episode.title;
    appendScopePill(title, scope);

    const meta = document.createElement('span');
    const published = episode.publishedAt ? ` | published ${new Date(episode.publishedAt).toLocaleString()}` : '';
    meta.textContent = `${episode.status} | ${episode.slug}${published}`;

    const summary = document.createElement('p');
    summary.textContent = scope.className === 'archive'
      ? 'History/archive episode. Not part of current production for the selected candidate story.'
      : episode.feedGuid || episode.metadata?.publicAudioUrl || episode.description || 'Active/current episode has no publish metadata recorded yet.';

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = isActiveEpisode
      ? 'Active Episode'
      : scope.className === 'archive'
        ? 'Select for Audit Only'
        : 'Select Episode';
    select.addEventListener('click', () => {
      state.selectedEpisodeId = episode.id;
      savePipelineState();
      render();
      setStatus('Episode selected for pipeline review.');
    });

    row.append(title, meta, summary, select);
    els.episodeList.append(row);
  }
}

function renderModelProfiles() {
  els.modelProfileList.innerHTML = '';
  els.modelMeta.textContent = `${state.modelProfiles.length} AI role setting${state.modelProfiles.length === 1 ? '' : 's'}`;

  if (state.modelProfiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No AI role settings configured. Use New Show to seed defaults or create role settings through the API before using model-backed scoring, research, or writing.';
    els.modelProfileList.append(empty);
    return;
  }

  for (const profile of state.modelProfiles) {
    const row = document.createElement('article');
    row.className = 'record-row';

    const title = document.createElement('strong');
    title.textContent = profile.role.replaceAll('_', ' ');

    const meta = document.createElement('span');
    meta.textContent = `${profile.provider} | ${profile.model}`;

    const detail = document.createElement('p');
    const params = asObject(profile.config?.params);
    const reasoning = typeof params.reasoningEffort === 'string' ? ` | reasoning ${params.reasoningEffort}` : '';
    detail.textContent = `${profile.promptTemplateKey || 'default agent instructions'}${reasoning}`;

    row.append(title, meta, detail);
    els.modelProfileList.append(row);
  }
}

function settingsEmpty(message) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = message;
  return empty;
}

function setActiveSettingsTab(tab) {
  state.activeSettingsTab = tab;
  renderSettings();
}

function renderSettingsTabs() {
  for (const button of els.settingsTabs) {
    const active = button.dataset.settingsTab === state.activeSettingsTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  const sections = {
    shows: els.settingsShows,
    sources: els.settingsSources,
    models: els.settingsModels,
    prompts: els.settingsPrompts,
    publishing: els.settingsPublishing,
    schedules: els.settingsSchedules,
  };

  for (const [key, section] of Object.entries(sections)) {
    section.hidden = key !== state.activeSettingsTab;
  }
}

function renderSettingsShows() {
  els.settingsShows.innerHTML = '';
  const show = selectedShow();

  if (!show) {
    els.settingsShows.append(settingsEmpty('Create or select a show before editing settings.'));
    return;
  }

  const form = document.createElement('form');
  form.className = 'settings-card settings-form';
  form.innerHTML = `
    <div class="settings-card-heading">
      <div>
        <h3></h3>
        <p class="help">Slug changes can affect feed URLs, scheduled runs, and external references. Confirm downstream links after saving.</p>
      </div>
      <button type="submit">Save Show</button>
    </div>
    <div class="grid">
      <label class="field"><span>Show title</span><input name="title" type="text" required></label>
      <label class="field"><span>Slug</span><input name="slug" type="text" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></label>
      <label class="field"><span>Setup status</span><select name="setupStatus"><option value="draft">draft</option><option value="active">active</option></select></label>
      <label class="field"><span>Format</span><input name="format" type="text" placeholder="daily-briefing"></label>
      <label class="field"><span>Runtime minutes</span><input name="defaultRuntimeMinutes" type="number" min="1" step="1"></label>
      <label class="field"><span>Publishing mode</span><select name="publishingMode"><option value="approval-gated">Approval required</option><option value="autopublish-later">Autopublish later</option></select></label>
    </div>
    <label class="field"><span>Description</span><textarea name="description" rows="2"></textarea></label>
    <div class="grid two">
      <label class="field"><span>Cast basics</span><textarea name="cast" rows="3"></textarea><small>One per line: Name | role | voice.</small></label>
      <label class="field"><span>Tone and style</span><textarea name="toneStyleNotes" rows="3"></textarea></label>
      <label class="field"><span>Script format notes</span><textarea name="scriptFormatNotes" rows="3"></textarea></label>
    </div>
  `;
  form.querySelector('h3').textContent = 'Show identity and format';
  form.elements.title.value = show.title;
  form.elements.slug.value = show.slug;
  form.elements.setupStatus.value = show.setupStatus;
  form.elements.format.value = show.format || '';
  form.elements.defaultRuntimeMinutes.value = show.defaultRuntimeMinutes || '';
  form.elements.publishingMode.value = readPublishingMode(show);
  form.elements.description.value = show.description || '';
  form.elements.cast.value = castToLines(show.cast);
  form.elements.toneStyleNotes.value = readOnboardingSetting(show, 'toneStyleNotes');
  form.elements.scriptFormatNotes.value = readOnboardingSetting(show, 'scriptFormatNotes');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveShowSettings(show.id, form);
  });
  els.settingsShows.append(form);

  const feedHeading = document.createElement('div');
  feedHeading.className = 'settings-subhead';
  feedHeading.innerHTML = '<h3>Feeds</h3><p class="help">Public URLs and storage targets are shown without secrets or local credential paths.</p>';
  els.settingsShows.append(feedHeading);

  if (state.feeds.length === 0) {
    els.settingsShows.append(settingsEmpty('No feeds configured for this show. New Show creates a starter feed, or feeds can be added through the API.'));
    return;
  }

  for (const feed of state.feeds) {
    els.settingsShows.append(feedSettingsForm(feed));
  }
}

function feedSettingsForm(feed) {
  const form = document.createElement('form');
  form.className = 'settings-card settings-form';
  form.innerHTML = `
    <div class="settings-card-heading">
      <div>
        <h3></h3>
        <p class="help">Storage credentials, keys, and local credential paths are intentionally hidden.</p>
      </div>
      <button type="submit">Save Feed</button>
    </div>
    <div class="grid">
      <label class="field"><span>Feed title</span><input name="title" type="text" required></label>
      <label class="field"><span>Feed slug</span><input name="slug" type="text" required></label>
      <label class="field"><span>Storage target</span><input name="storageType" type="text" required></label>
      <label class="field"><span>Public feed URL</span><input name="publicFeedUrl" type="url"></label>
      <label class="field"><span>Public asset base URL</span><input name="publicBaseUrl" type="url"></label>
      <label class="field"><span>RSS path</span><input name="rssFeedPath" type="text"></label>
      <label class="field"><span>RSS output path</span><input name="outputPath" type="text"></label>
      <label class="field"><span>Episode numbering</span><input name="episodeNumberPolicy" type="text"></label>
      <label class="toggle admin-toggle"><input name="op3Wrap" type="checkbox"><span>OP3 wrapping enabled</span></label>
    </div>
    <label class="field"><span>Description</span><textarea name="description" rows="2"></textarea></label>
    <details class="debug-details">
      <summary>Sanitized feed metadata</summary>
      <pre></pre>
    </details>
  `;
  form.querySelector('h3').textContent = feed.title;
  form.elements.title.value = feed.title;
  form.elements.slug.value = feed.slug;
  form.elements.storageType.value = feed.storageType;
  form.elements.publicFeedUrl.value = feed.publicFeedUrl || '';
  form.elements.publicBaseUrl.value = publicAssetBaseForFeed(feed);
  form.elements.rssFeedPath.value = feed.rssFeedPath || '';
  form.elements.outputPath.value = outputPathForFeed(feed);
  form.elements.episodeNumberPolicy.value = feed.episodeNumberPolicy || 'increment';
  form.elements.op3Wrap.checked = Boolean(feed.op3Wrap);
  form.elements.description.value = feed.description || '';
  form.querySelector('pre').textContent = JSON.stringify(sanitizedDebug({
    metadata: feed.metadata,
    storageConfig: feed.storageConfig,
  }), null, 2);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveFeedSettings(feed.id, form);
  });
  return form;
}

function renderSettingsSources() {
  els.settingsSources.innerHTML = '';

  if (!state.selectedShowSlug) {
    els.settingsSources.append(settingsEmpty('Select a show before editing story sources.'));
    return;
  }

  if (state.profiles.length === 0) {
    els.settingsSources.append(settingsEmpty('No story sources/search recipes yet. Use Create New Show to seed one, or create a story source through the API.'));
    return;
  }

  for (const profile of state.profiles) {
    const form = document.createElement('form');
    form.className = 'settings-card settings-form';
    form.innerHTML = `
      <div class="settings-card-heading">
        <div>
          <h3></h3>
          <p class="help" data-source-control-help></p>
        </div>
        <button type="submit">Save Story Source</button>
      </div>
      <div class="grid">
        <label class="field"><span>Name</span><input name="name" type="text" required></label>
        <label class="field"><span>Slug</span><input name="slug" type="text" required></label>
        <label class="field"><span>Type</span><select name="type"><option value="brave">Brave</option><option value="zai-web">Z.AI Web Search</option><option value="rss">RSS</option><option value="manual">Manual URL</option><option value="local-json">Local JSON</option></select></label>
        <label class="field"><span>Weight</span><input name="weight" type="number" min="0" step="0.001" required></label>
        <label class="field"><span>Freshness window</span><input name="freshness" type="text" placeholder="pd, pw, pm"></label>
        <label class="toggle admin-toggle"><input name="enabled" type="checkbox"><span>Enabled</span></label>
      </div>
      <div class="grid two">
        <label class="field"><span>Include domains</span><textarea name="includeDomains" rows="2"></textarea></label>
        <label class="field"><span>Exclude domains</span><textarea name="excludeDomains" rows="2"></textarea></label>
      </div>
    `;
    form.querySelector('h3').textContent = profile.name;
    form.elements.name.value = profile.name;
    form.elements.slug.value = profile.slug;
    form.elements.type.value = profile.type;
    form.elements.weight.value = profile.weight;
    form.elements.freshness.value = profile.freshness || '';
    form.elements.enabled.checked = profile.enabled;
    form.elements.includeDomains.value = listToLines(profile.includeDomains);
    form.elements.excludeDomains.value = listToLines(profile.excludeDomains);
    applySourceControlState(form, profile.type);
    form.elements.type.addEventListener('change', () => {
      const type = form.elements.type.value;
      applySourceControlState(form, type);
      const queryPanel = form.nextElementSibling;
      if (queryPanel) {
        applySourceControlStateToForms(queryPanel, type);
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveProfileForm(profile.id, form);
    });
    els.settingsSources.append(form);

    const queries = state.selectedProfileId === profile.id ? state.queries : [];
    const queryPanel = document.createElement('div');
    queryPanel.className = 'settings-nested';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'secondary';
    choose.textContent = state.selectedProfileId === profile.id ? 'Selected Source' : 'Edit Search Queries';
    choose.addEventListener('click', async () => {
      state.selectedProfileId = profile.id;
      await loadQueries();
      render();
    });
    queryPanel.append(choose);

    if (state.selectedProfileId === profile.id) {
      queryPanel.append(adminNewQueryForm(profile.id));
      for (const query of queries) {
        queryPanel.append(adminQueryForm(query, profile));
      }
    }
    els.settingsSources.append(queryPanel);
  }
}

function adminNewQueryForm(profileId) {
  const form = document.createElement('form');
  form.className = 'query-card';
  form.innerHTML = `
    <label class="field"><span>New search query</span><textarea name="query" rows="2" required></textarea></label>
    <div class="actions"><button type="submit">Create Search Query</button></div>
  `;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await createQueryForProfile(profileId, form);
  });
  return form;
}

function adminQueryForm(query, profile = selectedProfile()) {
  const form = document.createElement('form');
  form.className = `query-card${query.enabled ? '' : ' disabled'}`;
  form.innerHTML = `
    <div class="query-top">
      <label class="toggle"><input name="enabled" type="checkbox"><span>Enabled</span></label>
      <button class="danger" name="delete" type="button">Delete</button>
    </div>
    <label class="field"><span>Search query</span><textarea name="query" rows="2" required></textarea></label>
    <div class="query-grid">
      <label class="field"><span>Weight</span><input name="weight" type="number" min="0" step="0.001" required></label>
      <label class="field"><span>Freshness</span><input name="freshness" type="text"></label>
      <label class="field"><span>Include domains</span><textarea name="includeDomains" rows="2"></textarea></label>
      <label class="field"><span>Exclude domains</span><textarea name="excludeDomains" rows="2"></textarea></label>
    </div>
    <p class="help" data-source-control-help></p>
    <div class="actions"><button type="submit">Save Search Query</button></div>
  `;
  form.elements.enabled.checked = query.enabled;
  form.elements.query.value = query.query;
  form.elements.weight.value = query.weight;
  form.elements.freshness.value = query.freshness || '';
  form.elements.includeDomains.value = listToLines(query.includeDomains);
  form.elements.excludeDomains.value = listToLines(query.excludeDomains);
  applySourceControlState(form, profile?.type);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveQuery(query.id, form, profile);
  });
  form.elements.delete.addEventListener('click', async () => {
    await confirmDeleteQuery(query);
  });
  return form;
}

function renderSettingsModels() {
  els.settingsModels.innerHTML = '';

  if (!state.selectedShowSlug) {
    els.settingsModels.append(settingsEmpty('Select a show before editing AI role settings.'));
    return;
  }

  if (state.modelProfiles.length === 0) {
    els.settingsModels.append(settingsEmpty('No AI role settings configured. Use New Show to seed defaults or create model profiles through the API.'));
    return;
  }

  for (const profile of state.modelProfiles) {
    const info = roleInfo(profile.role);
    const params = asObject(profile.config?.params);
    const form = document.createElement('form');
    form.className = 'settings-card settings-form';
    form.innerHTML = `
      <div class="settings-card-heading">
        <div>
          <h3></h3>
          <p class="help"></p>
        </div>
        <button type="submit">Save Model Role</button>
      </div>
      <div class="grid">
        <label class="field"><span>Provider</span><input name="provider" type="text" required></label>
        <label class="field"><span>Model</span><input name="model" type="text" required></label>
        <label class="field"><span>Prompt template key</span><input name="promptTemplateKey" type="text"></label>
        <label class="field"><span>Temperature</span><input name="temperature" type="number" step="0.01"></label>
        <label class="field"><span>Max tokens</span><input name="maxTokens" type="number" min="1" step="1"></label>
        <label class="field"><span>Budget USD</span><input name="budgetUsd" type="number" min="0" step="0.01"></label>
        <label class="field"><span>Reasoning setting</span><input name="reasoningEffort" type="text"></label>
        <label class="field wide"><span>Fallback models</span><textarea name="fallbacks" rows="2"></textarea><small>One fallback per line. Use provider/model only when provider changes.</small></label>
      </div>
    `;
    form.querySelector('h3').textContent = info.title;
    form.querySelector('.help').textContent = info.description;
    form.elements.provider.value = profile.provider;
    form.elements.model.value = profile.model;
    form.elements.promptTemplateKey.value = profile.promptTemplateKey || '';
    form.elements.temperature.value = profile.temperature ?? '';
    form.elements.maxTokens.value = profile.maxTokens ?? '';
    form.elements.budgetUsd.value = profile.budgetUsd ?? '';
    form.elements.reasoningEffort.value = typeof params.reasoningEffort === 'string' ? params.reasoningEffort : '';
    form.elements.fallbacks.value = listToLines(profile.fallbacks);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveModelProfile(profile.id, form);
    });
    els.settingsModels.append(form);
  }
}

function renderSettingsPrompts() {
  els.settingsPrompts.innerHTML = '';

  if (!state.selectedShowSlug) {
    els.settingsPrompts.append(settingsEmpty('Select a show before reviewing prompt templates.'));
    return;
  }

  if (state.promptTemplates.length === 0) {
    els.settingsPrompts.append(settingsEmpty('Prompt template endpoints are available, but no templates were returned. Prompt editing remains pending backend write endpoints.'));
    return;
  }

  const note = document.createElement('div');
  note.className = 'settings-note';
  note.textContent = 'Prompt templates are read-only in this UI because the backend currently exposes list/detail/render endpoints, not create/update endpoints.';
  els.settingsPrompts.append(note);

  for (const template of state.promptTemplates) {
    const card = document.createElement('article');
    card.className = 'settings-card prompt-card';
    card.innerHTML = `
      <div class="settings-card-heading">
        <div>
          <h3></h3>
          <p class="help"></p>
        </div>
        <span class="status-pill ready"></span>
      </div>
      <div class="settings-kv"></div>
      <label class="field"><span>Agent instructions</span><textarea rows="8" readonly></textarea></label>
      <details class="debug-details"><summary>Output schema summary</summary><pre></pre></details>
    `;
    card.querySelector('h3').textContent = template.title || template.key;
    card.querySelector('.help').textContent = template.description || 'No description recorded.';
    card.querySelector('.status-pill').textContent = template.showId ? 'show override' : 'global default';
    const kv = card.querySelector('.settings-kv');
    for (const [label, value] of [
      ['Role', formatRole(template.role)],
      ['Key', template.key],
      ['Version', template.version],
      ['Output format', template.outputFormat],
      ['Schema', template.outputSchemaName || 'none'],
    ]) {
      const item = document.createElement('span');
      item.textContent = `${label}: ${value}`;
      kv.append(item);
    }
    card.querySelector('textarea').value = template.body || '';
    card.querySelector('pre').textContent = JSON.stringify(sanitizedDebug({
      inputVariables: template.inputVariables,
      outputSchemaHint: template.outputSchemaHint,
    }), null, 2);
    els.settingsPrompts.append(card);
  }
}

function renderSettingsPublishing() {
  els.settingsPublishing.innerHTML = '';
  const show = selectedShow();

  if (!show) {
    els.settingsPublishing.append(settingsEmpty('Select a show before reviewing publishing settings.'));
    return;
  }

  const safety = document.createElement('article');
  safety.className = 'settings-card';
  safety.innerHTML = `
    <div class="settings-card-heading">
      <div>
        <h3>Publishing safety</h3>
        <p class="help"></p>
      </div>
      <button class="secondary" type="button">Edit Show & Feeds</button>
    </div>
    <div class="settings-kv"></div>
  `;
  const publishingMode = readPublishingMode(show);
  safety.querySelector('.help').textContent = publishingMode === 'approval-gated'
    ? 'Public RSS publishing requires an explicit review decision before the publish action.'
    : 'Autopublish intent is recorded, but publishing still depends on configured schedule and backend gates.';
  safety.querySelector('button').addEventListener('click', () => setActiveSettingsTab('shows'));
  const safetyKv = safety.querySelector('.settings-kv');
  for (const [label, value] of [
    ['Show', show.title],
    ['Mode', publishingMode === 'approval-gated' ? 'Approval required' : 'Autopublish configured'],
    ['Setup status', show.setupStatus],
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${value}`;
    safetyKv.append(item);
  }
  els.settingsPublishing.append(safety);

  if (state.feeds.length === 0) {
    els.settingsPublishing.append(settingsEmpty('No publishing feed is configured for this show.'));
    return;
  }

  for (const feed of state.feeds) {
    const card = document.createElement('article');
    card.className = 'settings-card';
    card.innerHTML = `
      <div class="settings-card-heading">
        <div>
          <h3></h3>
          <p class="help">Only public URLs and non-secret storage labels are shown here.</p>
        </div>
      </div>
      <div class="settings-kv"></div>
    `;
    card.querySelector('h3').textContent = feed.title;
    const kv = card.querySelector('.settings-kv');
    const outputPath = outputPathForFeed(feed);
    for (const [label, value] of [
      ['Public feed URL', feed.publicFeedUrl || 'not configured'],
      ['Public asset base URL', publicAssetBaseForFeed(feed) || 'not configured'],
      ['RSS path', feed.rssFeedPath || outputPath || 'not configured'],
      ['Storage target', feed.storageType],
      ['OP3 wrapping', feed.op3Wrap ? 'enabled' : 'disabled'],
      ['Episode numbering', feed.episodeNumberPolicy || 'increment'],
    ]) {
      const item = document.createElement('span');
      item.textContent = `${label}: ${value}`;
      kv.append(item);
    }
    els.settingsPublishing.append(card);
  }
}

function renderSettingsSchedules() {
  els.settingsSchedules.innerHTML = '';

  if (!state.selectedShowSlug) {
    els.settingsSchedules.append(settingsEmpty('Select a show before editing scheduled pipelines.'));
    return;
  }

  if (state.scheduledPipelines.length === 0) {
    els.settingsSchedules.append(settingsEmpty('No scheduled pipelines yet. Create one through the API, then edit cadence and safety settings here.'));
  }

  for (const pipeline of state.scheduledPipelines) {
    const form = document.createElement('form');
    form.className = 'settings-card settings-form';
    form.innerHTML = `
      <div class="settings-card-heading">
        <div>
          <h3></h3>
          <p class="help">Autopublish should stay off unless the show is explicitly approved for unattended publishing.</p>
        </div>
        <div class="actions inline">
          <button class="secondary" name="run" type="button">Run Now</button>
          <button type="submit">Save Schedule</button>
        </div>
      </div>
      <div class="grid">
        <label class="field"><span>Name</span><input name="name" type="text" required></label>
        <label class="field"><span>Slug</span><input name="slug" type="text" required></label>
        <label class="field"><span>Cron</span><input name="cron" type="text" required></label>
        <label class="field"><span>Timezone</span><input name="timezone" type="text" required></label>
        <label class="field"><span>Workflow</span><input name="workflow" type="text" required></label>
        <label class="toggle admin-toggle"><input name="enabled" type="checkbox"><span>Enabled</span></label>
        <label class="toggle admin-toggle"><input name="autopublish" type="checkbox"><span>Autopublish</span></label>
      </div>
    `;
    const nextRun = pipeline.nextRunAt ? new Date(pipeline.nextRunAt).toLocaleString() : 'not scheduled';
    form.querySelector('h3').textContent = `${pipeline.name} | next ${nextRun}`;
    form.elements.name.value = pipeline.name;
    form.elements.slug.value = pipeline.slug;
    form.elements.cron.value = pipeline.cron;
    form.elements.timezone.value = pipeline.timezone;
    form.elements.workflow.value = pipeline.workflow.join(', ');
    form.elements.enabled.checked = pipeline.enabled;
    form.elements.autopublish.checked = pipeline.autopublish;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveScheduledPipeline(pipeline.id, form);
    });
    form.elements.run.addEventListener('click', async () => {
      await runScheduledPipeline(pipeline.id, form.elements.run);
    });
    els.settingsSchedules.append(form);
  }

  if (state.failedScheduledRuns.length === 0) {
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'settings-subhead';
  heading.innerHTML = '<h3>Failed scheduled runs</h3><p class="help">Retry actions use the existing scheduler retry endpoint.</p>';
  els.settingsSchedules.append(heading);

  for (const job of state.failedScheduledRuns) {
    const row = document.createElement('div');
    row.className = 'production-row failed';
    const title = document.createElement('strong');
    title.textContent = `${job.input.scheduledPipelineSlug || job.input.scheduledPipelineId} | failed`;
    const meta = document.createElement('span');
    meta.textContent = `Updated ${new Date(job.updatedAt).toLocaleString()}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'secondary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', async () => {
      await retryScheduledRun(job.id, retry);
    });
    row.append(title, meta, retry);
    els.settingsSchedules.append(row);
  }
}

function renderSettings() {
  const show = selectedShow();
  els.settingsMeta.textContent = show
    ? `${show.title} | ${SETTINGS_SECTIONS[state.activeSettingsTab]}`
    : 'Choose a show to edit show-scoped settings.';
  renderSettingsTabs();
  renderSettingsShows();
  renderSettingsSources();
  renderSettingsModels();
  renderSettingsPrompts();
  renderSettingsPublishing();
  renderSettingsSchedules();
}

function renderScheduler() {
  els.schedulerList.innerHTML = '';
  els.failedScheduleRuns.innerHTML = '';
  els.schedulerMeta.textContent = `${state.scheduledPipelines.length} scheduled pipeline${state.scheduledPipelines.length === 1 ? '' : 's'}`;

  if (state.scheduledPipelines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No scheduled pipelines yet. Create one through the API to run recurring source discovery, research, script, audio, or publishing preparation.';
    els.schedulerList.append(empty);
  }

  for (const pipeline of state.scheduledPipelines) {
    const row = document.createElement('article');
    row.className = 'record-row scheduler-row';

    const title = document.createElement('strong');
    title.textContent = pipeline.name;

    const meta = document.createElement('span');
    const nextRun = pipeline.nextRunAt ? new Date(pipeline.nextRunAt).toLocaleString() : 'not scheduled';
    meta.textContent = `${pipeline.enabled ? 'enabled' : 'disabled'} | ${pipeline.cron} | next ${nextRun}`;

    const detail = document.createElement('p');
    detail.textContent = `${pipeline.workflow.join(' -> ')}${pipeline.autopublish ? ' | autopublish enabled' : ' | approval required before publishing'}`;

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'secondary';
    run.textContent = 'Run Now';
    run.addEventListener('click', async () => {
      await runScheduledPipeline(pipeline.id, run);
    });

    row.append(title, meta, detail, run);
    els.schedulerList.append(row);
  }

  if (state.failedScheduledRuns.length === 0) {
    return;
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Failed Scheduled Runs';
  els.failedScheduleRuns.append(heading);

  for (const job of state.failedScheduledRuns) {
    const row = document.createElement('div');
    row.className = 'production-row failed';

    const title = document.createElement('strong');
    title.textContent = `${job.input.scheduledPipelineSlug || job.input.scheduledPipelineId} | ${job.status}`;

    const meta = document.createElement('span');
    meta.textContent = job.error ? 'Run failed. Open details for the API error.' : `Updated ${new Date(job.updatedAt).toLocaleString()}`;
    let details;
    if (job.error) {
      details = document.createElement('details');
      details.className = 'debug-details row-debug';
      details.innerHTML = '<summary>Technical details</summary><pre></pre>';
      details.querySelector('pre').textContent = job.error;
    }

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'secondary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', async () => {
      await retryScheduledRun(job.id, retry);
    });

    row.append(title, meta, retry);
    if (details) {
      row.append(details);
    }
    els.failedScheduleRuns.append(row);
  }
}

function isTerminalJob(job) {
  return ['succeeded', 'failed', 'cancelled'].includes(job.status);
}

function latestJob(type) {
  return state.production.jobs.find((job) => job.type === type);
}

function renderProductionArchiveAssets(archivedAssets) {
  if (archivedAssets.length === 0) {
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'production-row archive-artifact';
  const headingTitle = document.createElement('strong');
  headingTitle.textContent = 'History/archive production assets';
  const headingMeta = document.createElement('span');
  headingMeta.textContent = 'Kept for audit only; not used by production or publishing actions.';
  heading.append(headingTitle, headingMeta);
  els.productionAssets.append(heading);

  for (const asset of archivedAssets) {
    const row = document.createElement('div');
    row.className = 'production-row archive-artifact';
    const title = document.createElement('strong');
    title.textContent = `History/archive ${asset.type || asset.productionKind || 'asset'}`;
    const meta = document.createElement('span');
    meta.textContent = asset.url || asset.mimeType || asset.status || 'Asset recorded; local path hidden';
    row.append(title, meta);
    els.productionAssets.append(row);
  }
}

function renderProduction() {
  const viewModel = currentProductionViewModel();
  const archivedAssets = asArray(viewModel.historicalArtifacts?.audioCover);
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  const hasScript = Boolean(script && revision);
  els.productionPanel.hidden = !hasScript && archivedAssets.length === 0;

  els.productionJobs.innerHTML = '';
  els.productionAssets.innerHTML = '';

  if (!hasScript) {
    els.generateAudioPreview.disabled = true;
    els.generateCoverArt.disabled = true;
    els.productionMeta.textContent = archivedAssets.length > 0
      ? 'No active/current script is selected. History/archive production assets below are retained for audit only.'
      : 'No active/current script is selected for production.';
    if (archivedAssets.length > 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No active/current production task runs. Generate or select an active script before creating new audio or cover assets.';
      els.productionJobs.append(empty);
      renderProductionArchiveAssets(archivedAssets);
    }
    return;
  }

  const approved = script.status === 'approved-for-audio'
    && script.approvedRevisionId === revision.id;
  const integrity = integrityReviewState(revision);
  const readyForProduction = approved && !integrity.blocking;
  const audioJob = latestJob('audio.preview');
  const artJob = latestJob('art.generate');
  const audioRunning = audioJob && !isTerminalJob(audioJob);
  const artRunning = artJob && !isTerminalJob(artJob);

  els.generateAudioPreview.disabled = !readyForProduction || audioRunning;
  els.generateCoverArt.disabled = !readyForProduction || artRunning;
  const activeEpisode = selectedEpisode();
  els.productionMeta.textContent = readyForProduction
    ? (activeEpisode ? `Episode ${activeEpisode.slug}` : 'No active/current episode yet. Create audio or cover tasks for the active script.')
    : approved
      ? `Integrity gate: ${integrityReviewLabel(integrity.status)}. Run review or override before creating assets.`
      : 'Approval gate: approve the selected revision before creating audio or cover assets.';

  els.productionJobs.innerHTML = '';
  if (state.production.jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No audio or cover asset tasks yet. Approve the script revision, then create a preview MP3 or cover art.';
    els.productionJobs.append(empty);
  }

  for (const job of state.production.jobs) {
    const row = document.createElement('div');
    row.className = `production-row${job.status === 'failed' ? ' failed' : ''}`;
    const title = document.createElement('strong');
    title.textContent = `${taskLabel(job.type)} | ${job.status}`;
    const meta = document.createElement('span');
    meta.textContent = job.error ? 'Task failed. Open details for logs and provider metadata.' : `Progress ${job.progress}%`;
    const progress = document.createElement('div');
    progress.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.max(0, Math.min(100, job.progress))}%`;
    progress.append(fill);
    row.append(title, meta, progress);
    if (job.error || job.logs?.length) {
      const details = document.createElement('details');
      details.className = 'debug-details row-debug';
      details.innerHTML = '<summary>Technical details</summary><pre></pre>';
      details.querySelector('pre').textContent = JSON.stringify(sanitizedDebug({ error: job.error, logs: job.logs, output: job.output }), null, 2);
      row.append(details);
    }
    els.productionJobs.append(row);
  }

  els.productionAssets.innerHTML = '';
  const assets = selectedAssets();
  if (assets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = readyForProduction
      ? 'No active/current audio or cover assets recorded yet. Next action: create missing preview audio and cover art.'
      : 'No active/current audio or cover assets recorded yet. Next action: complete script approval and integrity review before production.';
    els.productionAssets.append(empty);
  } else {
    for (const asset of assets) {
      const row = document.createElement('div');
      row.className = 'production-row active-artifact';
      const title = document.createElement('strong');
      title.textContent = `Active/current ${asset.label || asset.type}`;
      const meta = document.createElement('span');
      meta.textContent = asset.objectKey || asset.publicUrl || asset.mimeType || 'Asset recorded; local path hidden';
      row.append(title, meta);
      appendAssetAccessControls(row, asset, { audio: isAudioAsset(asset) });
      els.productionAssets.append(row);
    }
  }

  renderProductionArchiveAssets(archivedAssets);
}

function renderJobRuns() {
  const activeCount = state.recentJobs.filter((job) => !isTerminalJob(job)).length;
  const failedCount = state.recentJobs.filter((job) => job.status === 'failed').length;
  els.jobRunsMeta.textContent = `${state.recentJobs.length} recent run${state.recentJobs.length === 1 ? '' : 's'}${activeCount ? ` | ${activeCount} active` : ''}${failedCount ? ` | ${failedCount} failed` : ''}`;
  els.jobRunList.innerHTML = '';

  if (state.recentJobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.selectedShowSlug
      ? 'No task runs recorded for this show yet.'
      : 'Choose a show to inspect recent task runs.';
    els.jobRunList.append(empty);
  }

  for (const job of state.recentJobs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `job-row ${statusClass(taskState(job))}${job.id === state.selectedJobId ? ' selected' : ''}`;
    button.innerHTML = `
      <strong></strong>
      <span class="job-row-meta"></span>
      <span class="job-row-note"></span>
    `;
    button.querySelector('strong').textContent = `${taskLabel(job.type)} | ${job.status}`;
    button.querySelector('.job-row-meta').textContent = jobProgressText(job);
    button.querySelector('.job-row-note').textContent = (job.summary?.warnings || []).length > 0
      ? `${job.summary.warnings.length} warning${job.summary.warnings.length === 1 ? '' : 's'}`
      : job.error || latestStageJob([job.type]);
    button.addEventListener('click', () => selectJob(job.id));
    els.jobRunList.append(button);
  }

  renderJobDetail();
}

function renderJobDetail() {
  const job = selectedJob();
  els.jobRunDetail.innerHTML = '';

  if (!job) {
    els.jobRunDetail.className = 'job-detail empty';
    els.jobRunDetail.textContent = 'Select a task run to inspect logs, warnings, retryability, and debug details.';
    return;
  }

  els.jobRunDetail.className = `job-detail ${statusClass(taskState(job))}`;
  state.selectedJobId = job.id;

  const heading = document.createElement('div');
  heading.className = 'job-detail-heading';
  const title = document.createElement('div');
  title.innerHTML = '<h3></h3><p></p>';
  title.querySelector('h3').textContent = taskLabel(job.type);
  title.querySelector('p').textContent = `${job.type} | created ${formatTime(job.createdAt)}`;
  const status = document.createElement('span');
  status.className = `status-pill ${statusClass(taskState(job))}`;
  status.textContent = taskState(job);
  heading.append(title, status);

  const progress = document.createElement('div');
  progress.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${Math.max(0, Math.min(100, job.progress))}%`;
  progress.append(fill);

  const facts = document.createElement('div');
  facts.className = 'job-facts';
  for (const [label, value] of [
    ['Status', job.status],
    ['Progress', `${job.progress}%`],
    ['Attempts', `${job.attempts}/${job.maxAttempts}`],
    ['Started', formatTime(job.startedAt)],
    ['Finished', formatTime(job.finishedAt)],
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${value}`;
    facts.append(item);
  }

  const artifacts = document.createElement('div');
  artifacts.className = 'job-artifacts';
  const artifactItems = job.summary?.artifacts || [];
  artifacts.innerHTML = '<h4>Linked records</h4>';
  if (artifactItems.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No artifact IDs recorded yet.';
    artifacts.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'settings-kv';
    for (const artifact of artifactItems) {
      const item = document.createElement('span');
      item.textContent = `${artifact.label}: ${artifact.value}`;
      list.append(item);
    }
    artifacts.append(list);
  }

  const warnings = renderJobMessages('Warnings', job.summary?.warnings || [], 'No warnings recorded for this task run.');
  const failure = renderJobFailure(job);
  const logs = renderJobLogs(job.logs || []);
  const retry = renderJobRetry(job);
  const debug = document.createElement('details');
  debug.className = 'debug-details';
  debug.innerHTML = '<summary>Metadata and debug details</summary><pre></pre>';
  debug.querySelector('pre').textContent = JSON.stringify(sanitizedDebug({
    id: job.id,
    showId: job.showId,
    episodeId: job.episodeId,
    provider: job.summary?.provider || {},
    input: job.input,
    output: job.output,
  }), null, 2);

  els.jobRunDetail.append(heading, progress, facts, artifacts, warnings, failure, logs, retry, debug);
}

function renderJobMessages(title, items, emptyText) {
  const section = document.createElement('section');
  section.className = 'job-messages';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'job-message';
    row.textContent = item.message || item.code || JSON.stringify(sanitizedDebug(item));
    section.append(row);
  }

  return section;
}

function renderJobFailure(job) {
  const failure = job.summary?.failure;
  const section = document.createElement('section');
  section.className = 'job-messages';
  section.innerHTML = '<h4>Failure</h4>';
  const message = document.createElement('p');
  message.textContent = failure?.message || job.error || 'No failure recorded.';
  section.append(message);
  return section;
}

function renderJobLogs(logs) {
  const section = document.createElement('section');
  section.className = 'job-messages';
  section.innerHTML = '<h4>Logs and events</h4>';

  if (logs.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No logs recorded yet.';
    section.append(empty);
    return section;
  }

  for (const log of logs.slice(-8)) {
    const row = document.createElement('div');
    row.className = `job-message ${log.level || 'info'}`;
    row.textContent = `${log.at || ''} ${log.level || 'info'}: ${log.message || JSON.stringify(sanitizedDebug(log))}`.trim();
    section.append(row);
  }

  return section;
}

function renderJobRetry(job) {
  const section = document.createElement('section');
  section.className = 'job-retry';
  const retry = job.summary?.retry || { supported: false, reason: 'Retry information is unavailable.' };
  const note = document.createElement('p');
  note.textContent = retry.reason;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = retry.requiresConfirmation ? 'danger' : 'secondary';
  button.textContent = retry.requiresConfirmation ? 'Retry Requires Publish Review' : 'Retry Run';
  button.disabled = !retry.supported;
  if (retry.supported) {
    button.addEventListener('click', async () => retryJob(job, button));
  }
  section.append(note, button);
  return section;
}

function renderScripts() {
  els.scriptList.innerHTML = '';
  els.scriptMeta.textContent = `${state.scripts.length} script${state.scripts.length === 1 ? '' : 's'} for this show`;

  if (state.scripts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No scripts yet. Select a research brief, paste its ID into the draft form, and generate a script draft.';
    els.scriptList.append(empty);
  }

  for (const script of state.scripts) {
    const scope = artifactScope('script', script.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-button ${scope.className}-artifact${script.id === state.selectedScriptId ? ' active' : ''}`;
    const title = document.createElement('strong');
    title.textContent = script.title;
    appendScopePill(title, scope);
    const meta = document.createElement('span');
    meta.textContent = `${scope.label} | ${script.format} | ${script.status} | updated ${new Date(script.updatedAt).toLocaleString()}`;
    button.append(title, meta);
    button.addEventListener('click', async () => {
      await loadScript(script.id);
      savePipelineState();
      render();
    });
    els.scriptList.append(button);
  }

  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  els.scriptEditForm.hidden = !script || !revision;

  if (script && revision) {
    els.scriptTitle.value = revision.title;
    els.scriptBody.value = revision.body;
    els.approveScript.disabled = script.approvedRevisionId === revision.id;
  }

  renderScriptCoachingActions();
  renderProduction();
}

function renderScriptCoachingActions() {
  els.scriptCoachingActions.innerHTML = '';

  if (!activeSelectedScript() || !activeSelectedRevision()) {
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'script-coaching-heading';
  const title = document.createElement('h3');
  title.textContent = 'AI coaching';
  const help = document.createElement('p');
  help.className = 'help';
  help.textContent = 'Creates a new draft revision. It does not approve the script or carry review decisions forward.';
  heading.append(title, help);

  const actions = document.createElement('div');
  actions.className = 'script-coaching-grid';
  const running = isActionRunning('script');

  for (const action of state.scriptCoachingActions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary coaching-action';
    button.disabled = running;
    button.innerHTML = '<strong></strong><span></span>';
    button.querySelector('strong').textContent = action.label;
    button.querySelector('span').textContent = action.description;
    button.addEventListener('click', () => runScriptCoachingAction(action.action));
    actions.append(button);
  }

  if (state.scriptCoachingActions.length === 0) {
    els.scriptCoachingActions.append(heading, settingsEmpty('No coaching actions are available from the API.'));
    return;
  }

  els.scriptCoachingActions.append(heading, actions);
}

function reviewSectionHeading(title, status, detail) {
  const heading = document.createElement('div');
  heading.className = 'review-heading';
  const copy = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const p = document.createElement('p');
  p.textContent = detail;
  copy.append(h3, p);
  const pill = document.createElement('span');
  pill.className = `status-pill ${statusClass(status)}`;
  pill.textContent = status;
  heading.append(copy, pill);
  return heading;
}

function reviewFacts(items) {
  const facts = document.createElement('div');
  facts.className = 'settings-kv';
  for (const [label, value] of items) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${value}`;
    facts.append(item);
  }
  return facts;
}

function reviewList(title, items, emptyText, mapper = (item) => item) {
  const section = document.createElement('section');
  section.className = 'review-subsection';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-inline';
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'review-list';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'review-list-item';
    row.textContent = mapper(item);
    list.append(row);
  }
  section.append(list);
  return section;
}

function actionBlockerNote(message, blocked = true) {
  const note = document.createElement('p');
  note.className = `action-blocker-note${blocked ? ' blocked' : ''}`;
  note.textContent = message;
  return note;
}

function renderResearchReview() {
  const packet = selectedResearchPacket();
  els.reviewResearch.innerHTML = '';

  if (!packet) {
    els.reviewResearch.append(
      reviewSectionHeading('Research Brief', 'blocked', 'No research brief is selected.'),
      settingsEmpty('Select or create a research brief before review.'),
    );
    return;
  }

  const readiness = researchReadinessStatus(packet);
  const unresolved = unresolvedResearchWarnings(packet);
  const approved = researchApproved(packet);
  const status = approved && unresolved.length === 0 ? 'done' : unresolved.length > 0 || readiness !== 'ready' ? 'needs review' : 'ready';
  const candidateIds = asArray(packet.content?.candidateIds).filter((id) => typeof id === 'string');
  const sourceUrls = asArray(packet.citations).map((citation) => citation.url).filter(Boolean);

  els.reviewResearch.append(
    reviewSectionHeading('Research Brief', status, packet.title),
    reviewFacts([
      ['Readiness', readiness],
      ['Review decision', approved ? `approved ${formatTime(packet.approvedAt)}` : 'not approved'],
      ['Independent sources', packet.content?.independentSourceCount ?? 'unknown'],
      ['Usable sources', packet.content?.usableSourceCount ?? 'unknown'],
      ['Selected candidates', packet.content?.selectedCandidateCount ?? (candidateIds.length || 'unknown')],
    ]),
    reviewList('Selected candidates', candidateIds, 'No selected candidate IDs were recorded.', (id) => id),
    reviewList('Source URLs', sourceUrls, 'No citation URLs were recorded.', (url) => url),
    reviewList('Claims and citations', asArray(packet.claims), 'No claims were recorded for this brief.', (claim) => {
      const citations = asArray(claim.citationUrls).join(', ') || 'missing citation URL';
      return `${claim.text || claim.id || 'Claim'} | ${citations}`;
    }),
  );

  const warnings = document.createElement('section');
  warnings.className = 'review-subsection';
  warnings.innerHTML = '<h4>Warnings</h4>';
  if (asArray(packet.warnings).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-inline';
    empty.textContent = 'No research warnings recorded.';
    warnings.append(empty);
  } else {
    for (const warning of asArray(packet.warnings)) {
      const row = document.createElement('div');
      row.className = `warning-item ${warning.severity === 'error' ? 'error' : ''}`;
      const message = document.createElement('span');
      message.textContent = `${warning.code || 'warning'}: ${warning.message || 'No message recorded.'}${warning.override ? ` | overridden by ${warning.override.actor}` : ''}`;
      row.append(message);
      if (!warning.override) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary compact-action';
        button.textContent = 'Override';
        button.addEventListener('click', () => overrideResearchWarning(packet.id, warning));
        row.append(button);
      }
      warnings.append(row);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'actions inline';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'secondary';
  approve.textContent = approved ? 'Research Approved' : 'Approve Research Brief';
  approve.disabled = approved || readiness !== 'ready' || unresolved.length > 0 || isActionRunning('approval');
  approve.title = approve.disabled && !approved ? 'Research must be ready and warnings must be overridden before approval.' : '';
  approve.addEventListener('click', approveSelectedResearch);
  actions.append(approve);
  const reason = approved
    ? 'Research approval is recorded.'
    : readiness !== 'ready'
      ? `Blocked: research status is ${readiness}; use a ready brief before approval.`
      : unresolved.length > 0
        ? `Blocked: ${unresolved.length} research warning${unresolved.length === 1 ? '' : 's'} need override reasons before approval.`
        : isActionRunning('approval') ? 'Approval is already running.' : 'Ready: approve the research brief after editorial review.';
  els.reviewResearch.append(warnings, actions, actionBlockerNote(reason, approve.disabled && !approved));
}

function renderScriptReview() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  els.reviewScript.innerHTML = '';

  if (!script || !revision) {
    els.reviewScript.append(
      reviewSectionHeading('Script Draft', 'blocked', 'No script revision is selected.'),
      settingsEmpty('Generate or select a script draft before review.'),
    );
    return;
  }

  const validation = asObject(revision.metadata?.validation);
  const speakerValidation = asObject(validation.speakerLabels);
  const provenanceValidation = asObject(validation.provenance);
  const provenanceState = provenanceReviewState(revision);
  const warningItems = [
    ...(provenanceState.stale ? [{
      code: 'STALE_SCRIPT_PROVENANCE',
      message: provenanceState.message,
    }] : []),
    ...asArray(revision.metadata?.warnings),
    ...asArray(revision.metadata?.provenance?.warnings),
    ...asArray(provenanceValidation.warnings),
  ];
  const integrity = integrityReviewState(revision);
  const integrityReview = integrity.review;
  const integrityIssues = integrityIssueItems(integrityReview);
  const integrityCounts = asObject(integrityReview?.issueCounts);
  const approved = script.status === 'approved-for-audio' && script.approvedRevisionId === revision.id;

  els.reviewScript.append(
    reviewSectionHeading('Script Draft', approved && !integrity.blocking ? 'done' : warningItems.length > 0 || integrity.blocking ? 'needs review' : 'ready', `${script.title} | revision ${revision.version}`),
    reviewFacts([
      ['Review decision', approved ? `approved ${formatTime(script.approvedAt)}` : 'not approved'],
      ['Integrity review', integrity.status === 'missing' ? 'not run' : `${integrityReviewLabel(integrity.status)}${integrityReview?.reviewedAt ? ` ${formatTime(integrityReview.reviewedAt)}` : ''}`],
      ['Integrity issues', `${integrityCounts.total ?? integrityIssues.length} issue(s), ${integrityCounts.critical ?? 0} critical`],
      ['Speaker validation', speakerValidation.valid === false ? 'failed' : 'passed or not recorded'],
      ['Citation/provenance status', provenanceState.stale ? 'stale after human edit' : 'current or not flagged'],
      ['Citation/provenance warning items', provenanceValidation.valid === false ? 'failed' : `${warningItems.length} warning(s)`],
      ['Revision history', `${state.selectedRevisions.length || 1} revision${(state.selectedRevisions.length || 1) === 1 ? '' : 's'}`],
    ]),
    renderCoverageSummary(state.selectedCoverageSummary),
    ...(provenanceState.stale ? [actionBlockerNote(provenanceState.message, false)] : []),
    reviewList('Integrity review issues', integrityIssues, integrity.status === 'missing' ? 'Run the integrity reviewer before production.' : 'No unresolved integrity issues recorded.', integrityIssueText),
    integrity.override ? reviewList('Integrity override', [integrity.override], 'No override recorded.', (item) => `${item.actor || 'editor'} | ${item.reason} | ${formatTime(item.overriddenAt)}`) : settingsEmpty('No integrity override recorded.'),
    reviewList('Revision history', state.selectedRevisions, 'Only the selected revision is loaded.', (item) => `v${item.version} by ${item.author} | ${formatTime(item.createdAt)}${item.changeSummary ? ` | ${item.changeSummary}` : ''}`),
    reviewList('Citation map and provenance warnings', warningItems, 'No missing-provenance warnings recorded.', (item) => item.message || item.code || JSON.stringify(sanitizedDebug(item))),
  );

  const body = document.createElement('pre');
  body.className = 'script-review-body';
  body.textContent = revision.body || 'No script body recorded.';
  const actions = document.createElement('div');
  actions.className = 'actions inline';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'secondary';
  approve.textContent = approved ? 'Script Approved' : 'Approve Script for Audio';
  approve.disabled = approved || isActionRunning('approval');
  approve.addEventListener('click', approveSelectedScript);
  const runIntegrity = document.createElement('button');
  runIntegrity.type = 'button';
  runIntegrity.className = 'secondary';
  runIntegrity.textContent = integrity.status === 'missing' ? 'Run Integrity Review' : 'Rerun Integrity Review';
  runIntegrity.disabled = isActionRunning('integrity');
  runIntegrity.addEventListener('click', runSelectedIntegrityReview);
  const overrideIntegrity = document.createElement('button');
  overrideIntegrity.type = 'button';
  overrideIntegrity.className = 'secondary danger';
  overrideIntegrity.textContent = 'Override Integrity Gate';
  overrideIntegrity.disabled = !integrity.blocking || isActionRunning('integrity');
  overrideIntegrity.addEventListener('click', overrideSelectedIntegrityReview);
  actions.append(runIntegrity, overrideIntegrity, approve);
  const scriptGateReason = isActionRunning('integrity')
    ? 'Integrity review is already running.'
    : isActionRunning('approval')
      ? 'Approval is already running.'
      : integrity.blocking
        ? (integrity.status === 'missing'
          ? (provenanceState.stale ? 'Blocked: human edit invalidated citation/provenance coverage; run the integrity reviewer before production.' : 'Blocked: run the integrity reviewer before production.')
          : 'Blocked: resolve the failed integrity review or record an explicit override reason.')
        : approved ? 'Script and integrity gates are complete for production.' : 'Ready: approve the reviewed script revision for audio.';
  els.reviewScript.append(body, actions, actionBlockerNote(scriptGateReason, integrity.blocking || (!approved && approve.disabled)));
}

function renderProductionReview() {
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const audioAsset = assets.find((asset) => asset.type === 'audio-final' || asset.type === 'audio-preview');
  const coverAsset = assets.find((asset) => asset.type === 'cover-art');
  const warnings = productionWarningItems();
  els.reviewProduction.innerHTML = '';

  els.reviewProduction.append(
    reviewSectionHeading('Audio and Cover Assets', episode?.status === 'approved-for-publish' || episode?.status === 'published' ? 'done' : audioAsset && coverAsset ? 'ready' : 'blocked', episode ? episode.title : 'No episode record yet.'),
    reviewFacts([
      ['Episode status', episode?.status || 'missing'],
      ['Audio', audioAsset ? audioAsset.mimeType || 'recorded' : 'missing'],
      ['Cover art', coverAsset ? coverAsset.mimeType || 'recorded' : 'missing'],
      ['Production warnings', warnings.length],
    ]),
  );

  const media = document.createElement('div');
  media.className = 'asset-preview-grid';
  const audioBox = document.createElement('div');
  audioBox.className = 'asset-preview';
  const audioTitle = document.createElement('strong');
  audioTitle.textContent = 'Audio preview';
  audioBox.append(audioTitle);
  if (audioAsset && assetAccessUrl(audioAsset)) {
    appendAssetAccessControls(audioBox, audioAsset, { audio: true });
  } else {
    const empty = document.createElement('p');
    empty.textContent = audioAsset ? 'Audio asset recorded without a usable local or public preview URL.' : 'No audio asset recorded.';
    audioBox.append(empty);
  }
  const coverBox = document.createElement('div');
  coverBox.className = 'asset-preview';
  const coverTitle = document.createElement('strong');
  coverTitle.textContent = 'Cover art';
  coverBox.append(coverTitle);
  if (coverAsset && assetAccessUrl(coverAsset)) {
    appendAssetAccessControls(coverBox, coverAsset, { image: true });
  } else {
    const empty = document.createElement('p');
    empty.textContent = coverAsset ? 'Cover art asset recorded without a usable local or public preview URL.' : 'No cover art asset recorded.';
    coverBox.append(empty);
  }
  media.append(audioBox, coverBox);
  els.reviewProduction.append(media);

  els.reviewProduction.append(
    reviewList('Asset metadata', assets, 'No production assets recorded.', (asset) => {
      const provider = asset.metadata?.provider || asset.metadata?.adapter || asset.metadata?.adapterKind || 'unknown provider';
      const size = asset.byteSize === null || asset.byteSize === undefined ? 'size unknown' : `${asset.byteSize} bytes`;
      const duration = asset.durationSeconds ? ` | ${asset.durationSeconds}s` : '';
      return `${asset.type} | ${asset.mimeType || 'unknown MIME'} | ${size}${duration} | ${provider}`;
    }),
    reviewList('Production warnings and failures', warnings, 'No production warnings recorded.', (item) => item.message || item.code || JSON.stringify(sanitizedDebug(item))),
  );

  const actions = document.createElement('div');
  actions.className = 'actions inline';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'secondary';
  approve.textContent = episode?.status === 'approved-for-publish' || episode?.status === 'published' ? 'Assets Approved' : 'Approve Assets for Publishing';
  const preApprovalReady = publishChecklistState().filter((item) => item.key !== 'publishApproval').every((item) => item.passed);
  approve.disabled = !episode || episode.status !== 'audio-ready' || !preApprovalReady || isActionRunning('approval');
  approve.title = approve.disabled ? 'Complete the checklist before publish approval.' : '';
  approve.addEventListener('click', approveEpisodeForPublishing);
  actions.append(approve);
  const productionApprovalBlockers = checklistBlockers(publishChecklistState(), false);
  const reason = !episode
    ? 'Blocked: produce missing audio and cover assets to create an episode record.'
    : episode.status !== 'audio-ready'
      ? `Blocked: episode status is ${episode.status}; publish approval requires audio-ready.`
      : productionApprovalBlockers.length > 0
        ? `Blocked: ${productionApprovalBlockers[0]}`
        : isActionRunning('approval') ? 'Approval is already running.' : 'Ready: approve assets for publishing.';
  els.reviewProduction.append(actions, actionBlockerNote(reason, approve.disabled));
}

function renderPublishChecklist() {
  const episode = selectedEpisode();
  const checklist = publishChecklistState();
  const ready = checklist.every((item) => item.passed);
  const canApprove = checklist.filter((item) => item.key !== 'publishApproval').every((item) => item.passed);
  els.publishChecklist.innerHTML = '';
  els.publishChecklist.append(reviewSectionHeading('Publishing Checklist', ready ? 'ready' : 'blocked', episode ? `${episode.title} | ${episode.status}` : 'No episode selected.'));

  const list = document.createElement('div');
  list.className = 'checklist';
  for (const item of checklist) {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.passed ? 'passed' : 'blocked'}`;
    const mark = document.createElement('span');
    mark.className = 'checklist-mark';
    mark.textContent = item.passed ? 'OK' : 'Block';
    const text = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = item.label;
    const reason = document.createElement('p');
    reason.textContent = item.reason;
    text.append(label, reason);
    row.append(mark, text);
    list.append(row);
  }
  els.publishChecklist.append(list);

  const actions = document.createElement('div');
  actions.className = 'actions inline';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'secondary';
  approve.textContent = episode?.status === 'approved-for-publish' || episode?.status === 'published' ? 'Publish Approval Saved' : 'Approve for Publishing';
  approve.disabled = !episode || episode.status !== 'audio-ready' || !canApprove || isActionRunning('approval');
  approve.addEventListener('click', approveEpisodeForPublishing);
  const publish = document.createElement('button');
  publish.type = 'button';
  publish.textContent = episode?.status === 'published' ? 'Published' : 'Publish to RSS';
  publish.disabled = !episode || episode.status !== 'approved-for-publish' || !ready || isActionRunning('publish');
  publish.title = publish.disabled && episode?.status !== 'published' ? 'Publishing is disabled until every checklist item passes.' : '';
  publish.addEventListener('click', publishSelectedEpisode);
  actions.append(approve, publish);
  const publishBlockers = checklistBlockers(checklist);
  const approvalBlockers = checklistBlockers(checklist, false);
  const approvalReason = approve.disabled
    ? `Publish approval blocked: ${firstBlockerText(approvalBlockers, episode ? `episode status is ${episode.status}` : 'create production assets first.')}`
    : 'Ready: approve the episode for publishing.';
  const publishReason = publish.disabled && episode?.status !== 'published'
    ? `Publishing blocked: ${firstBlockerText(publishBlockers, episode ? `episode status is ${episode.status}` : 'create production assets first.')}`
    : episode?.status === 'published' ? 'Publishing already recorded.' : 'Ready: publish to RSS.';
  els.publishChecklist.append(actions, actionBlockerNote(approvalReason, approve.disabled), actionBlockerNote(publishReason, publish.disabled && episode?.status !== 'published'));
}

function renderReviewGates() {
  const show = selectedShow();
  els.reviewMeta.textContent = show
    ? `${show.title} | Review research, script, production assets, and publish readiness.`
    : 'Select a show before reviewing approval gates.';
  renderResearchReview();
  renderScriptReview();
  renderProductionReview();
  renderPublishChecklist();
}

function render() {
  state.productionViewModel = deriveProductionViewModel(state);
  renderShows();
  renderSettings();
  renderPipeline();
  renderShowSetup();
  renderProfiles();
  renderProfileForm();
  renderStoryCandidates();
  renderResearchBriefs();
  renderScheduler();
  renderJobRuns();
  renderEpisodes();
  renderReviewGates();
  renderModelProfiles();
  renderQueries();
  renderScripts();
  renderSurfaceVisibility();
}

async function loadShows() {
  const body = await api('/shows');
  state.shows = body.shows;
  state.selectedShowSlug ||= state.shows[0]?.slug || '';
  restorePipelineStateForShow();
}

async function loadProfiles() {
  if (!state.selectedShowSlug) {
    state.profiles = [];
    state.selectedProfileId = '';
    return;
  }

  const body = await api(`/source-profiles?showSlug=${encodeURIComponent(state.selectedShowSlug)}`);
  state.profiles = body.sourceProfiles;

  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.profiles[0]?.id || '';
  }
}

async function loadFeeds() {
  if (!state.selectedShowSlug) {
    state.feeds = [];
    return;
  }

  const body = await api(`/shows/${encodeURIComponent(state.selectedShowSlug)}/feeds`);
  state.feeds = body.feeds;
}

async function loadQueries() {
  if (!state.selectedProfileId) {
    state.queries = [];
    return;
  }

  const body = await api(`/source-profiles/${state.selectedProfileId}/queries`);
  state.queries = body.sourceQueries;
}

async function loadScripts() {
  if (!state.selectedShowSlug) {
    state.scripts = [];
    state.selectedScriptId = '';
    state.selectedScript = null;
    state.selectedRevision = null;
    state.selectedRevisions = [];
    state.selectedCoverageSummary = null;
    return;
  }

  const body = await api(`/scripts?showSlug=${encodeURIComponent(state.selectedShowSlug)}`);
  state.scripts = body.scripts;

  if (!state.scripts.some((script) => script.id === state.selectedScriptId)) {
    state.selectedScriptId = state.scripts[0]?.id || '';
  }

  if (state.selectedScriptId) {
    await loadScript(state.selectedScriptId);
  } else {
    state.selectedScript = null;
    state.selectedRevision = null;
    state.selectedRevisions = [];
    state.selectedCoverageSummary = null;
    state.production = { episode: null, assets: [], jobs: [] };
  }
}

async function loadScriptCoachingActions() {
  const body = await api('/scripts/coaching-actions');
  state.scriptCoachingActions = body.actions || [];
}

async function loadModelProfiles() {
  if (!state.selectedShowSlug) {
    state.modelProfiles = [];
    return;
  }

  const body = await api(`/model-profiles?showSlug=${encodeURIComponent(state.selectedShowSlug)}`);
  state.modelProfiles = body.modelProfiles;
}

async function loadPromptTemplates() {
  if (!state.selectedShowSlug) {
    state.promptTemplates = [];
    return;
  }

  const body = await api(`/prompt-templates?showSlug=${encodeURIComponent(state.selectedShowSlug)}&includeGlobal=true`);
  state.promptTemplates = body.templates;
}

async function loadStoryCandidates() {
  if (!state.selectedShowSlug) {
    state.storyCandidates = [];
    return;
  }

  const body = await api(`/story-candidates?showSlug=${encodeURIComponent(state.selectedShowSlug)}&limit=25`);
  state.storyCandidates = body.storyCandidates;
}

async function loadResearchPackets() {
  if (!state.selectedShowSlug) {
    state.researchPackets = [];
    return;
  }

  const body = await api(`/research-packets?showSlug=${encodeURIComponent(state.selectedShowSlug)}&limit=25`);
  state.researchPackets = body.researchPackets;
}

async function loadScheduledPipelines() {
  if (!state.selectedShowSlug) {
    state.scheduledPipelines = [];
    state.failedScheduledRuns = [];
    return;
  }

  const [pipelinesBody, failedRunsBody] = await Promise.all([
    api(`/scheduled-pipelines?showSlug=${encodeURIComponent(state.selectedShowSlug)}`),
    api(`/scheduled-pipeline-runs?showSlug=${encodeURIComponent(state.selectedShowSlug)}&status=failed&limit=10`),
  ]);
  state.scheduledPipelines = pipelinesBody.scheduledPipelines;
  state.failedScheduledRuns = failedRunsBody.jobs;
}

async function loadJobs() {
  if (!state.selectedShowSlug) {
    state.recentJobs = [];
    state.selectedJobId = '';
    stopJobPolling();
    return;
  }

  const body = await api(`/jobs?showSlug=${encodeURIComponent(state.selectedShowSlug)}&limit=30`);
  state.recentJobs = body.jobs || [];

  if (!state.recentJobs.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = state.recentJobs[0]?.id || '';
  }

  updateJobPolling();
}

function stopJobPolling() {
  if (state.jobPoll) {
    window.clearInterval(state.jobPoll);
    state.jobPoll = null;
  }
}

function updateJobPolling() {
  const hasActiveJobs = state.recentJobs.some((job) => !isTerminalJob(job));

  if (!hasActiveJobs) {
    stopJobPolling();
    return;
  }

  if (state.jobPoll) {
    return;
  }

  state.jobPoll = window.setInterval(async () => {
    try {
      await loadJobs();
      render();
    } catch (error) {
      stopJobPolling();
      reportError(error);
    }
  }, 5000);
}

async function runScheduledPipeline(id, button) {
  button.disabled = true;
  setStatus('Starting scheduled pipeline...');

  try {
    const body = await api(`/scheduled-pipelines/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-ui' }),
    });
    await loadScheduledPipelines();
    await loadJobs();
    await loadStoryCandidates();
    render();
    setStatus(`Scheduled pipeline run ${body.job.status}.`);
  } catch (error) {
    await loadScheduledPipelines();
    render();
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function retryScheduledRun(id, button) {
  button.disabled = true;
  setStatus('Retrying scheduled pipeline...');

  try {
    const body = await api(`/scheduled-pipeline-runs/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-ui' }),
    });
    await loadScheduledPipelines();
    await loadJobs();
    await loadStoryCandidates();
    render();
    setStatus(`Scheduled run retry ${body.job.status}.`);
  } catch (error) {
    await loadScheduledPipelines();
    render();
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function retryJob(job, button) {
  const retry = job.summary?.retry;

  if (!retry?.supported || !retry.endpoint) {
    return;
  }

  if (job.type === 'publish.rss') {
    setStatus('RSS publishing retries require the explicit publish action after review.');
    return;
  }

  button.disabled = true;
  setStatus('Retrying task run...');

  try {
    const body = await api(retry.endpoint, {
      method: retry.method || 'POST',
      body: JSON.stringify({ actor: 'local-ui', retryOfJobId: job.id }),
    });
    await loadScheduledPipelines();
    await loadJobs();
    if (state.selectedScriptId) {
      await loadProduction();
    }
    await loadStoryCandidates();
    render();
    setStatus(`Retry created: ${(body.job || {}).status || 'started'}.`);
  } catch (error) {
    await loadJobs();
    render();
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function loadEpisodes() {
  if (!state.selectedShowSlug) {
    state.episodes = [];
    return;
  }

  const body = await api(`/episodes?showSlug=${encodeURIComponent(state.selectedShowSlug)}&limit=25`);
  state.episodes = body.episodes;
  if (!state.selectedEpisodeId && state.episodes[0]) {
    state.selectedEpisodeId = state.episodes[0].id;
  }
}

async function loadScript(id) {
  const body = await api(`/scripts/${id}`);
  state.selectedScriptId = id;
  state.selectedScript = body.script;
  state.selectedRevision = body.latestRevision || null;
  state.selectedRevisions = body.revisions || [];
  state.selectedCoverageSummary = body.coverageSummary ?? null;
  if (body.script?.researchPacketId && state.researchPackets.some((packet) => packet.id === body.script.researchPacketId)) {
    state.selectedResearchPacketId = body.script.researchPacketId;
  }
  await loadProduction();
}

async function loadProduction() {
  if (!state.selectedScriptId) {
    state.production = { episode: null, assets: [], jobs: [] };
    return;
  }

  const body = await api(`/scripts/${state.selectedScriptId}/production`);
  state.production = {
    episode: body.episode || null,
    assets: body.assets || [],
    jobs: body.jobs || [],
  };
  state.selectedEpisodeId = body.episode?.id || state.selectedEpisodeId || '';
  state.selectedAssetIds = (body.assets || []).map((asset) => asset.id);
  savePipelineState();
}

function focusManualStoryForm() {
  setActiveSurface('workflow');
  scrollToPanel('manualStoryPanel');
  els.manualUrl.focus();
  setStatus('Paste a source URL in Add Manual Story to create a candidate story.');
}

function focusScriptEditor() {
  if (activeSelectedScript() && activeSelectedRevision()) {
    setActiveSurface('workflow');
    scrollToPanel('scriptPanel');
    els.scriptTitle.focus();
    setStatus('Review the selected script draft and save a revision or approve it for audio.');
  }
}

function selectTopCandidate() {
  const candidate = state.storyCandidates[0];

  if (!candidate) {
    return;
  }

  state.selectedCandidateIds = [candidate.id];
  state.episodePlan = null;
  savePipelineState();
  render();
  setStatus('Top candidate story selected for the research brief.');
}

function clearCandidateSelection() {
  state.selectedCandidateIds = [];
  state.episodePlan = null;
  savePipelineState();
  render();
  setStatus('Candidate story selection cleared.');
}

function syncClusterFormFromInputs() {
  state.clusterForm = {
    angle: els.clusterAngle.value.trim(),
    notes: els.clusterNotes.value.trim(),
    targetFormat: els.clusterFormat.value.trim(),
    targetRuntime: els.clusterRuntime.value.trim(),
  };
  savePipelineState();
}

async function runSelectedProfileDiscovery() {
  const profile = selectedProfile();

  if (!profile || !['brave', 'zai-web', 'rss'].includes(profile.type)) {
    focusManualStoryForm();
    return;
  }

  const blocker = sourceDiscoveryBlocker(profile, state.queries);
  if (blocker) {
    setStatus(`${sourceActionLabel(profile.type)} blocked: ${blocker}`, '', 'warning');
    return;
  }

  setActionRunning('discover', true);
  setStatus(`${sourceActionLabel(profile.type)} running...`);

  try {
    const path = profile.type === 'rss'
      ? `/source-profiles/${profile.id}/ingest`
      : `/source-profiles/${profile.id}/search`;
    const body = await api(path, { method: 'POST' });
    await loadStoryCandidates();
    await loadJobs();
    render();
    const warnings = asArray(body.job?.output?.warnings);
    const warningText = warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '';
    setStatus(`${sourceActionLabel(profile.type)} complete: ${body.inserted} inserted, ${body.skipped} skipped${warningText}.`);
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('discover', false);
  }
}

async function requestEpisodePlanForSelected() {
  syncClusterFormFromInputs();
  const candidateIds = state.selectedCandidateIds.filter(Boolean);

  if (candidateIds.length === 0) {
    render();
    return;
  }

  setActionRunning('planning', true);
  setStatus('Requesting AI episode plan...');

  try {
    const body = await api('/story-candidates/episode-plan', {
      method: 'POST',
      body: JSON.stringify({
        candidateIds,
        notes: state.clusterForm.notes || null,
        targetFormat: state.clusterForm.targetFormat || null,
        targetRuntime: state.clusterForm.targetRuntime || null,
      }),
    });
    state.episodePlan = body.episodePlan;
    await loadJobs();
    render();
    setStatus('AI episode plan generated. It is advisory only and does not approve research or production.');
  } catch (error) {
    await loadJobs();
    render();
    reportError(error);
  } finally {
    setActionRunning('planning', false);
  }
}

async function buildResearchBriefFromSelected() {
  syncClusterFormFromInputs();
  const candidateIds = state.selectedCandidateIds.filter(Boolean);
  const analysis = selectedCandidateAnalysis();

  if (candidateIds.length === 0 || !analysis.canLaunch) {
    render();
    return;
  }

  setActionRunning('research', true);
  setStatus('Creating research brief...');

  try {
    const body = await api('/research-packets', {
      method: 'POST',
      body: JSON.stringify({
        candidateIds,
        extraUrls: [],
        angle: state.clusterForm.angle || null,
        notes: state.clusterForm.notes || null,
        targetFormat: state.clusterForm.targetFormat || null,
        targetRuntime: state.clusterForm.targetRuntime || null,
      }),
    });
    state.selectedResearchPacketId = body.researchPacket.id;
    els.scriptResearchPacketId.value = body.researchPacket.id;
    await loadResearchPackets();
    await loadJobs();
    savePipelineState();
    render();
    setStatus(`Research brief created: ${body.researchPacket.status}.`);
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('research', false);
  }
}

async function generateScriptFromSelectedResearch() {
  const researchPacketId = selectedResearchPacket()?.id || (state.selectedCandidateIds.length > 0 ? '' : els.scriptResearchPacketId.value.trim());

  if (!researchPacketId) {
    setStatus(state.selectedCandidateIds.length > 0
      ? 'Script generation blocked: build or select the active/current research brief for this story first.'
      : 'Choose a research brief before generating a script draft.');
    render();
    return;
  }

  setActionRunning('script', true);
  setStatus('Generating script draft...');

  try {
    await generateScriptDraft(researchPacketId, els.scriptFormat.value.trim() || undefined);
  } finally {
    setActionRunning('script', false);
  }
}

async function createMissingProductionAssets() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  const integrity = integrityReviewState(revision);
  if (integrity.blocking) {
    setStatus(`Production blocked: integrity review ${integrityReviewLabel(integrity.status)}.`);
    render();
    return;
  }

  setActionRunning('production', true);
  setStatus('Creating missing audio and cover assets...');

  try {
    let assets = selectedAssets();
    const hasAudio = assets.some((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
    const hasCover = assets.some((asset) => asset.type === 'cover-art');

    if (!hasAudio) {
      await api(`/scripts/${script.id}/production/audio-preview`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'local-user' }),
      });
      await loadProduction();
      await loadJobs();
      assets = selectedAssets();
    }

    if (!hasCover && !assets.some((asset) => asset.type === 'cover-art')) {
      await api(`/scripts/${script.id}/production/cover-art`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'local-user' }),
      });
      await loadProduction();
      await loadJobs();
    }

    await loadEpisodes();
    await loadJobs();
    render();
    setStatus('Audio and cover asset tasks updated.');
  } catch (error) {
    await loadProduction();
    render();
    reportError(error);
  } finally {
    setActionRunning('production', false);
  }
}

async function approveEpisodeForPublishing() {
  const episode = selectedEpisode();

  if (!episode) {
    return;
  }

  const checklist = publishChecklistState().filter((item) => item.key !== 'publishApproval');

  if (!checklist.every((item) => item.passed)) {
    setStatus(`Publish approval is blocked: ${checklist.find((item) => !item.passed)?.reason || 'checklist incomplete'}`);
    render();
    return;
  }

  setActionRunning('approval', true);
  setStatus('Saving publish approval...');

  try {
    const body = await api(`/episodes/${episode.id}/approve-for-publish`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'local-user',
        reason: 'Approved in local UI.',
      }),
    });
    state.selectedEpisodeId = body.episode.id;
    await loadEpisodes();
    await loadProduction();
    await loadJobs();
    savePipelineState();
    render();
    setStatus('Review decision saved: episode approved for publishing.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('approval', false);
  }
}

async function publishSelectedEpisode() {
  const episode = selectedEpisode();

  if (!episode || episode.status !== 'approved-for-publish') {
    return;
  }

  const checklist = publishChecklistState();

  if (!checklist.every((item) => item.passed)) {
    setStatus(`Publishing is blocked: ${checklist.find((item) => !item.passed)?.reason || 'checklist incomplete'}`);
    render();
    return;
  }

  setActionRunning('publish', true);
  setStatus('Publishing to RSS...');

  try {
    const body = await api(`/episodes/${episode.id}/publish/rss`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    state.selectedEpisodeId = body.episode.id;
    await loadEpisodes();
    await loadProduction();
    savePipelineState();
    render();
    setStatus(body.idempotent ? 'Episode was already published.' : 'Episode published to RSS.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('publish', false);
  }
}

async function loadAll() {
  try {
    els.refresh.disabled = true;
    setStatus('Loading workspace...');
    await loadShows();
    const loadErrors = [];
    const safeLoad = async (label, loader, fallback) => {
      try {
        await loader();
      } catch (error) {
        fallback();
        loadErrors.push({
          label,
          message: error instanceof Error ? error.message : 'Section failed to load.',
          details: error instanceof ApiRequestError ? error.debugDetails : debugText(error),
        });
      }
    };

    await safeLoad('story sources', loadProfiles, () => {
      state.profiles = [];
      state.selectedProfileId = '';
    });
    await safeLoad('search queries', loadQueries, () => {
      state.queries = [];
    });
    await safeLoad('feeds', loadFeeds, () => {
      state.feeds = [];
    });
    await safeLoad('AI role settings', loadModelProfiles, () => {
      state.modelProfiles = [];
    });
    await safeLoad('script coaching actions', loadScriptCoachingActions, () => {
      state.scriptCoachingActions = [];
    });
    await safeLoad('prompt templates', loadPromptTemplates, () => {
      state.promptTemplates = [];
    });
    await safeLoad('candidate stories', loadStoryCandidates, () => {
      state.storyCandidates = [];
    });
    await safeLoad('research briefs', loadResearchPackets, () => {
      state.researchPackets = [];
    });
    await safeLoad('scheduled pipelines', loadScheduledPipelines, () => {
      state.scheduledPipelines = [];
      state.failedScheduledRuns = [];
    });
    await safeLoad('task runs', loadJobs, () => {
      state.recentJobs = [];
      state.selectedJobId = '';
    });
    await safeLoad('episodes', loadEpisodes, () => {
      state.episodes = [];
    });
    await safeLoad('script drafts', loadScripts, () => {
      state.scripts = [];
      state.selectedScriptId = '';
      state.selectedScript = null;
      state.selectedRevision = null;
      state.selectedRevisions = [];
      state.selectedCoverageSummary = null;
      state.production = { episode: null, assets: [], jobs: [] };
    });
    render();
    if (loadErrors.length > 0) {
      setStatus('Workspace loaded with some unavailable sections. Open technical details for API responses.', loadErrors);
    } else {
      setStatus('Workspace loaded.');
    }
  } catch (error) {
    reportError(error, 'Could not load the workspace. Open technical details for the API response.');
  } finally {
    els.refresh.disabled = false;
  }
}

async function saveShowSettings(id, form) {
  const runtime = optionalNumber(form.elements.defaultRuntimeMinutes.value);

  if (runtime !== null && (!Number.isInteger(runtime) || runtime <= 0)) {
    setStatus('Runtime minutes must be a positive whole number.');
    return;
  }

  const payload = {
    title: form.elements.title.value.trim(),
    slug: slugify(form.elements.slug.value.trim()),
    description: maybeNull(form.elements.description.value),
    setupStatus: form.elements.setupStatus.value,
    format: maybeNull(form.elements.format.value),
    defaultRuntimeMinutes: runtime,
    cast: linesToCast(form.elements.cast.value),
    toneStyleNotes: form.elements.toneStyleNotes.value.trim() || undefined,
    scriptFormatNotes: form.elements.scriptFormatNotes.value.trim() || undefined,
    publishingMode: form.elements.publishingMode.value,
  };

  if (!payload.title || !payload.slug) {
    setStatus('Show title and slug are required.');
    return;
  }

  setStatus('Saving show settings...');

  try {
    const body = await api(`/shows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const oldSlug = state.selectedShowSlug;
    state.shows = state.shows.map((show) => show.id === id ? body.show : show);
    state.selectedShowSlug = body.show.slug;
    if (body.show.slug !== oldSlug) {
      clearPipelineSelections();
    }
    await loadAll();
    setStatus('Show settings saved.');
  } catch (error) {
    reportError(error);
  }
}

async function saveFeedSettings(id, form) {
  const payload = {
    title: form.elements.title.value.trim(),
    slug: slugify(form.elements.slug.value.trim()),
    description: maybeNull(form.elements.description.value),
    rssFeedPath: maybeNull(form.elements.rssFeedPath.value),
    publicFeedUrl: maybeNull(form.elements.publicFeedUrl.value),
    publicBaseUrl: maybeNull(form.elements.publicBaseUrl.value),
    publicAssetBaseUrl: maybeNull(form.elements.publicBaseUrl.value),
    storageType: form.elements.storageType.value.trim(),
    op3Wrap: form.elements.op3Wrap.checked,
    episodeNumberPolicy: form.elements.episodeNumberPolicy.value.trim() || 'increment',
  };
  const outputPath = safeVisiblePath(form.elements.outputPath.value);

  if (outputPath) {
    payload.outputPath = outputPath;
  }

  if (!payload.title || !payload.slug || !payload.storageType) {
    setStatus('Feed title, slug, and storage target are required.');
    return;
  }

  setStatus('Saving feed settings...');

  try {
    const body = await api(`/feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.feeds = state.feeds.map((feed) => feed.id === id ? body.feed : feed);
    render();
    setStatus('Feed settings saved.');
  } catch (error) {
    reportError(error);
  }
}

function profilePayloadFromForm(form) {
  const type = form.elements.type.value;
  const controlsSupported = sourceControlsSupported(type);

  return {
    enabled: form.elements.enabled.checked,
    name: form.elements.name.value.trim(),
    slug: slugify(form.elements.slug.value.trim()),
    type,
    weight: Number(form.elements.weight.value),
    freshness: controlsSupported ? maybeNull(form.elements.freshness.value) : null,
    includeDomains: controlsSupported ? linesToList(form.elements.includeDomains.value) : [],
    excludeDomains: controlsSupported ? linesToList(form.elements.excludeDomains.value) : [],
  };
}

async function saveProfileForm(id, form) {
  const payload = profilePayloadFromForm(form);

  if (!payload.name || !payload.slug || Number.isNaN(payload.weight) || payload.weight < 0) {
    setStatus('Story source name, slug, type, and non-negative weight are required.');
    return;
  }

  setStatus('Saving story source...');

  try {
    const body = await api(`/source-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((profile) => profile.id === id ? body.sourceProfile : profile);
    render();
    setStatus('Story source saved.');
  } catch (error) {
    reportError(error);
  }
}

async function createQueryForProfile(profileId, form) {
  const query = form.elements.query.value.trim();

  if (!query) {
    setStatus('Search query text is required.');
    return;
  }

  setStatus('Creating search query...');

  try {
    const profile = state.profiles.find((candidate) => candidate.id === profileId);
    const controlsSupported = sourceControlsSupported(profile?.type);
    const body = await api(`/source-profiles/${profileId}/queries`, {
      method: 'POST',
      body: JSON.stringify({
        query,
        enabled: true,
        weight: 1,
        freshness: controlsSupported ? profile?.freshness || null : null,
        includeDomains: [],
        excludeDomains: [],
      }),
    });
    if (profileId === state.selectedProfileId) {
      state.queries.push(body.sourceQuery);
    }
    render();
    setStatus('Search query created.');
  } catch (error) {
    reportError(error);
  }
}

async function saveModelProfile(id, form) {
  const temperature = optionalNumber(form.elements.temperature.value);
  const maxTokens = optionalNumber(form.elements.maxTokens.value);
  const budgetUsd = optionalNumber(form.elements.budgetUsd.value);
  const provider = form.elements.provider.value.trim();
  const model = form.elements.model.value.trim();

  if (!provider || !model) {
    setStatus('Provider and model are required for AI role settings.');
    return;
  }

  if ((temperature !== null && Number.isNaN(temperature))
    || (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens <= 0))
    || (budgetUsd !== null && (Number.isNaN(budgetUsd) || budgetUsd < 0))) {
    setStatus('Check numeric AI role fields: max tokens must be positive and budget cannot be negative.');
    return;
  }

  const payload = {
    provider,
    model,
    temperature,
    maxTokens,
    budgetUsd,
    fallbacks: linesToList(form.elements.fallbacks.value),
    promptTemplateKey: maybeNull(form.elements.promptTemplateKey.value),
    params: {
      reasoningEffort: maybeNull(form.elements.reasoningEffort.value) || undefined,
    },
  };

  setStatus('Saving AI role settings...');

  try {
    const body = await api(`/model-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.modelProfiles = state.modelProfiles.map((profile) => profile.id === id ? body.modelProfile : profile);
    render();
    setStatus('AI role settings saved.');
  } catch (error) {
    reportError(error);
  }
}

async function saveScheduledPipeline(id, form) {
  const workflow = form.elements.workflow.value
    .split(/,|->/)
    .map((stage) => stage.trim())
    .filter(Boolean);
  const validStages = new Set(['ingest', 'research', 'script', 'audio', 'publish']);

  if (workflow.length === 0 || workflow.some((stage) => !validStages.has(stage))) {
    setStatus('Workflow must use stages: ingest, research, script, audio, publish.');
    return;
  }

  const payload = {
    name: form.elements.name.value.trim(),
    slug: slugify(form.elements.slug.value.trim()),
    enabled: form.elements.enabled.checked,
    cron: form.elements.cron.value.trim(),
    timezone: form.elements.timezone.value.trim(),
    workflow,
    autopublish: form.elements.autopublish.checked,
  };

  if (!payload.name || !payload.slug || !payload.cron || !payload.timezone) {
    setStatus('Schedule name, slug, cron, timezone, and workflow are required.');
    return;
  }

  setStatus('Saving scheduled pipeline...');

  try {
    const body = await api(`/scheduled-pipelines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.scheduledPipelines = state.scheduledPipelines.map((pipeline) => pipeline.id === id ? body.scheduledPipeline : pipeline);
    render();
    setStatus('Scheduled pipeline saved.');
  } catch (error) {
    reportError(error);
  }
}

async function createShow(event) {
  event.preventDefault();
  const slug = slugify(els.showSlug.value.trim());
  const provider = els.showModelProvider.value.trim();
  const model = els.showModelName.value.trim();
  const reasoningEffort = els.showReasoningEffort.value.trim();

  const payload = {
    name: els.showName.value.trim(),
    slug,
    description: els.showDescription.value.trim(),
    setupStatus: els.showSetupStatus.value,
    hostVoiceDefaults: [{
      name: 'HOST',
      role: 'host',
      voice: els.showHostVoice.value.trim(),
    }],
    toneStyleNotes: els.showToneNotes.value.trim() || undefined,
    scriptFormatNotes: els.showScriptNotes.value.trim() || undefined,
    publishingMode: els.showPublishingMode.value,
    feed: {
      title: els.showFeedTitle.value.trim(),
      publicFeedUrl: els.showFeedUrl.value.trim() || undefined,
      publicBaseUrl: els.showPublicBase.value.trim() || undefined,
      publicAssetBaseUrl: els.showPublicBase.value.trim() || undefined,
      outputPath: els.showOutputPath.value.trim() || undefined,
    },
    sourceProfileDefaults: {
      queries: [els.showSourceQuery.value.trim() || `${els.showName.value.trim()} news`],
    },
    modelRoleDefaults: {
      episode_planner: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      candidate_scorer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      source_summarizer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      claim_extractor: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      research_synthesizer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      script_writer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      script_editor: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      integrity_reviewer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      metadata_writer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      cover_prompt_writer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
    },
  };

  setStatus('Creating show...');

  try {
    const body = await api('/shows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.selectedShowSlug = body.show.slug;
    state.selectedProfileId = '';
    clearPipelineSelections();
    state.showSetupOpen = false;
    els.showSetupForm.reset();
    els.showModelProvider.value = 'openai';
    els.showModelName.value = 'gpt-5.5';
    els.showReasoningEffort.value = 'high';
    await loadAll();
    setStatus(`Show created: ${body.show.title}`);
  } catch (error) {
    reportError(error);
  }
}

async function importLegacyData() {
  els.importLegacy.disabled = true;
  setStatus('Importing legacy data...');

  try {
    const body = await api('/imports/legacy', {
      method: 'POST',
      body: JSON.stringify({ showSlug: state.selectedShowSlug || undefined }),
    });
    await loadStoryCandidates();
    await loadEpisodes();
    await loadJobs();
    render();
    setStatus(`Legacy import complete: ${body.summary.candidates.inserted} candidates inserted, ${body.summary.candidates.updated} updated.`);
  } catch (error) {
    reportError(error);
  } finally {
    els.importLegacy.disabled = false;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const profile = selectedProfile();

  if (!profile) {
    return;
  }

  const controlsSupported = sourceControlsSupported(els.profileType.value);
  const payload = {
    enabled: els.profileEnabled.checked,
    name: els.profileName.value.trim(),
    slug: els.profileSlug.value.trim(),
    type: els.profileType.value,
    weight: Number(els.profileWeight.value),
    freshness: controlsSupported ? els.profileFreshness.value.trim() || null : null,
    includeDomains: controlsSupported ? linesToList(els.profileIncludeDomains.value) : [],
    excludeDomains: controlsSupported ? linesToList(els.profileExcludeDomains.value) : [],
  };

  try {
    const body = await api(`/source-profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const index = state.profiles.findIndex((candidate) => candidate.id === profile.id);
    state.profiles[index] = body.sourceProfile;
    render();
    setStatus('Story source saved.');
  } catch (error) {
    reportError(error);
  }
}

async function ingestSelectedProfile() {
  const profile = selectedProfile();

  if (!profile || profile.type !== 'rss') {
    return;
  }

  els.ingestProfile.disabled = true;
  setStatus('Ingesting RSS feeds...');

  try {
    const body = await api(`/source-profiles/${profile.id}/ingest`, { method: 'POST' });
    await loadStoryCandidates();
    await loadJobs();
    render();
    setStatus(`RSS import complete: ${body.inserted} inserted, ${body.skipped} skipped.`);
  } catch (error) {
    reportError(error);
  } finally {
    els.ingestProfile.disabled = false;
  }
}

async function submitManualUrl(event) {
  event.preventDefault();

  if (!state.selectedShowSlug) {
    return;
  }

  const payload = {
    showSlug: state.selectedShowSlug,
    url: els.manualUrl.value.trim(),
    title: els.manualTitle.value.trim() || undefined,
    summary: els.manualSummary.value.trim() || undefined,
    sourceName: els.manualSourceName.value.trim() || undefined,
  };

  try {
    const body = await api('/story-candidates/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (body.inserted) {
      els.manualForm.reset();
      els.manualResult.textContent = `Created candidate story: ${body.candidate.title}`;
      await loadStoryCandidates();
      render();
      setStatus('Manual URL submitted.');
    } else {
      els.manualResult.textContent = `Skipped: ${body.reason}`;
      setStatus('Manual URL matched an existing candidate story.');
    }
  } catch (error) {
    els.manualResult.textContent = reportError(error);
  }
}

async function saveQuery(id, form, profile = selectedProfile()) {
  const controlsSupported = sourceControlsSupported(profile?.type);
  const payload = {
    enabled: form.elements.enabled.checked,
    query: form.elements.query.value.trim(),
    weight: Number(form.elements.weight.value),
    freshness: controlsSupported ? form.elements.freshness.value.trim() || null : null,
    includeDomains: controlsSupported ? linesToList(form.elements.includeDomains.value) : [],
    excludeDomains: controlsSupported ? linesToList(form.elements.excludeDomains.value) : [],
  };
  try {
    const body = await api(`/source-queries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const index = state.queries.findIndex((query) => query.id === id);
    state.queries[index] = body.sourceQuery;
    render();
    setStatus('Search query saved.');
  } catch (error) {
    reportError(error);
  }
}

async function createQuery(event) {
  event.preventDefault();

  if (!state.selectedProfileId) {
    return;
  }

  try {
    const profile = selectedProfile();
    const controlsSupported = sourceControlsSupported(profile?.type);
    const body = await api(`/source-profiles/${state.selectedProfileId}/queries`, {
      method: 'POST',
      body: JSON.stringify({
        query: els.newQueryText.value.trim(),
        enabled: true,
        weight: 1,
        freshness: controlsSupported ? profile?.freshness || null : null,
        includeDomains: [],
        excludeDomains: [],
      }),
    });
    state.queries.push(body.sourceQuery);
    els.newQueryText.value = '';
    render();
    setStatus('Search query created.');
  } catch (error) {
    reportError(error);
  }
}

function truncateConfirmationText(text, maxLength = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

async function confirmDeleteQuery(query) {
  const queryText = truncateConfirmationText(query.query);
  const confirmed = await openConfirmationDialog({
    title: 'Delete Search Query',
    description: 'This removes the saved source query/search recipe from this story source.',
    consequence: `"${queryText}" will no longer run for future story discovery. Existing candidate stories and audit records are not deleted, but this destructive change removes the query from the profile.`,
    confirmLabel: 'Delete Source Query',
    danger: true,
  });

  if (!confirmed) {
    setStatus('Search query deletion cancelled.');
    return;
  }

  await deleteQuery(query.id);
}

async function deleteQuery(id) {
  try {
    await api(`/source-queries/${id}`, { method: 'DELETE' });
    state.queries = state.queries.filter((query) => query.id !== id);
    render();
    setStatus('Search query deleted.');
  } catch (error) {
    reportError(error);
  }
}

async function createResearchBrief(candidateId, button) {
  button.disabled = true;
  setStatus('Creating research brief...');

  try {
    const body = await api(`/story-candidates/${candidateId}/research-packet`, {
      method: 'POST',
      body: JSON.stringify({ extraUrls: [] }),
    });
    state.selectedCandidateIds = [candidateId];
    state.selectedResearchPacketId = body.researchPacket.id;
    await loadResearchPackets();
    await loadJobs();
    render();
    els.scriptResearchPacketId.value = body.researchPacket.id;
    savePipelineState();
    setStatus(`Research brief created: ${body.researchPacket.status}.`);
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
  }
}

async function generateScript(event) {
  event.preventDefault();
  const researchPacketId = els.scriptResearchPacketId.value.trim();

  if (!researchPacketId) {
    return;
  }

  await generateScriptDraft(researchPacketId, els.scriptFormat.value.trim() || undefined);
}

async function generateScriptDraft(researchPacketId, format) {
  try {
    const body = await api(`/research-packets/${researchPacketId}/script`, {
      method: 'POST',
      body: JSON.stringify({
        format,
        actor: 'local-user',
      }),
    });
    state.scripts = [body.script, ...state.scripts.filter((script) => script.id !== body.script.id)];
    state.selectedScriptId = body.script.id;
    state.selectedScript = body.script;
    state.selectedRevision = body.revision;
    state.selectedRevisions = [body.revision];
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    state.selectedResearchPacketId = researchPacketId;
    state.production = { episode: null, assets: [], jobs: [] };
    els.scriptResearchPacketId.value = '';
    savePipelineState();
    await loadJobs();
    render();
    setStatus(`Generated script revision ${body.revision.version}.`);
  } catch (error) {
    reportError(error);
  }
}

async function saveScriptRevision(event) {
  event.preventDefault();

  if (!state.selectedScript) {
    return;
  }

  try {
    const body = await api(`/scripts/${state.selectedScript.id}/revisions`, {
      method: 'POST',
      body: JSON.stringify({
        title: els.scriptTitle.value.trim(),
        body: els.scriptBody.value.trim(),
        actor: 'local-user',
        changeSummary: 'Edited in local UI.',
      }),
    });
    state.scripts = [body.script, ...state.scripts.filter((script) => script.id !== body.script.id)];
    state.selectedScript = body.script;
    state.selectedRevision = body.revision;
    state.selectedRevisions = [body.revision, ...state.selectedRevisions.filter((revision) => revision.id !== body.revision.id)];
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    await loadProduction();
    await loadJobs();
    render();
    setStatus(`Saved script revision ${body.revision.version}.`);
  } catch (error) {
    reportError(error);
  }
}

async function runScriptCoachingAction(action) {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  setActionRunning('script', true);
  setStatus('Creating coached script revision...');

  try {
    const body = await api(`/scripts/${script.id}/revisions/${revision.id}/coach`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        actor: 'local-user',
      }),
    });
    state.scripts = [body.script, ...state.scripts.filter((script) => script.id !== body.script.id)];
    state.selectedScript = body.script;
    state.selectedRevision = body.revision;
    state.selectedRevisions = [body.revision, ...state.selectedRevisions.filter((revision) => revision.id !== body.revision.id)];
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    await loadProduction();
    await loadJobs();
    savePipelineState();
    render();
    setStatus(`AI coaching created script revision ${body.revision.version}. Run integrity review before production.`);
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('script', false);
  }
}

async function approveSelectedScript() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  setActionRunning('approval', true);
  setStatus('Saving script approval...');

  try {
    const body = await api(`/scripts/${script.id}/revisions/${revision.id}/approve-for-audio`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'local-user',
        reason: 'Approved in local UI.',
      }),
    });
    state.scripts = state.scripts.map((script) => script.id === body.script.id ? body.script : script);
    state.selectedScript = body.script;
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    await loadProduction();
    await loadJobs();
    savePipelineState();
    render();
    setStatus('Review decision saved: script approved for audio.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('approval', false);
  }
}

async function runSelectedIntegrityReview() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  setActionRunning('integrity', true);
  setStatus('Running integrity review...');

  try {
    const body = await api(`/scripts/${script.id}/revisions/${revision.id}/integrity-review`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    state.selectedRevision = body.revision;
    state.selectedRevisions = state.selectedRevisions.map((revision) => revision.id === body.revision.id ? body.revision : revision);
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    await loadProduction();
    await loadJobs();
    savePipelineState();
    render();
    setStatus(`Integrity review ${integrityReviewLabel(body.integrityReview.status)}.`);
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('integrity', false);
  }
}

async function overrideSelectedIntegrityReview() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  const reason = await openConfirmationDialog({
    title: 'Override Integrity Gate',
    description: 'This records an explicit override of a blocking integrity review gate and allows production to proceed despite blocking findings.',
    consequence: 'The failed or missing integrity review record stays in the audit trail; this does not erase it.',
    confirmLabel: 'Override Integrity Gate',
    danger: true,
    reasonLabel: 'Override reason',
    reasonPlaceholder: 'Explain why production may continue despite the blocking gate.',
    requireReason: true,
    emptyReasonMessage: 'Enter an integrity override reason before continuing.',
  });
  if (reason === null) {
    setStatus('Integrity override cancelled.');
    return;
  }

  setActionRunning('integrity', true);
  setStatus('Saving integrity review override...');

  try {
    const body = await api(`/scripts/${script.id}/revisions/${revision.id}/integrity-review/override`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'local-user',
        reason,
      }),
    });
    state.selectedRevision = body.revision;
    state.selectedRevisions = state.selectedRevisions.map((revision) => revision.id === body.revision.id ? body.revision : revision);
    state.selectedCoverageSummary = body.coverageSummary ?? null;
    await loadProduction();
    savePipelineState();
    render();
    setStatus('Integrity review override recorded.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('integrity', false);
  }
}

async function overrideResearchWarning(packetId, warning) {
  const reason = await openConfirmationDialog({
    title: 'Override Research Warning',
    description: 'This records an editorial override for a warning and allows the brief to proceed despite that warning. It does not remove the original warning or audit trail.',
    consequence: `${warning.code || 'warning'}: ${warning.message || 'No warning message recorded.'}`,
    confirmLabel: 'Override Warning',
    danger: true,
    reasonLabel: 'Override reason',
    reasonPlaceholder: 'Explain the editorial basis for overriding this warning.',
    requireReason: true,
    emptyReasonMessage: 'Enter a research warning override reason before continuing.',
  });

  if (reason === null) {
    setStatus('Warning override cancelled.');
    return;
  }

  setActionRunning('approval', true);
  setStatus('Saving research warning override...');

  try {
    const body = await api(`/research-packets/${packetId}/override-warning`, {
      method: 'POST',
      body: JSON.stringify({
        warningId: warning.id,
        warningCode: warning.code,
        actor: 'local-user',
        reason,
      }),
    });
    state.researchPackets = state.researchPackets.map((packet) => packet.id === body.researchPacket.id ? body.researchPacket : packet);
    state.selectedResearchPacketId = body.researchPacket.id;
    await loadJobs();
    savePipelineState();
    render();
    setStatus('Review decision saved: research warning override recorded.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('approval', false);
  }
}

async function approveSelectedResearch() {
  const packet = selectedResearchPacket();

  if (!packet) {
    return;
  }

  const defaultResearchApprovalNote = 'Sources, claims, citations, and warnings reviewed.';
  const reason = await openConfirmationDialog({
    title: 'Approve Research Brief',
    description: 'Record research approval only after source, claim, citation, and warning review.',
    consequence: 'This saves a review decision for the selected research brief; source snapshots, claims, and warning records remain available for audit.',
    confirmLabel: 'Approve Research Brief',
    reasonLabel: 'Approval note',
    defaultReason: defaultResearchApprovalNote,
  });

  if (reason === null) {
    setStatus('Research approval cancelled.');
    return;
  }

  setActionRunning('approval', true);
  setStatus('Saving research approval...');

  try {
    const body = await api(`/research-packets/${packet.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'local-user',
        reason: reason.trim() || defaultResearchApprovalNote,
      }),
    });
    state.researchPackets = state.researchPackets.map((candidate) => candidate.id === body.researchPacket.id ? body.researchPacket : candidate);
    state.selectedResearchPacketId = body.researchPacket.id;
    savePipelineState();
    render();
    setStatus('Review decision saved: research brief approved.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('approval', false);
  }
}

async function refreshProductionUntilSettled() {
  const script = activeSelectedScript();
  if (!script) {
    return;
  }

  await loadProduction();
  await loadJobs();
  render();

  if (state.production.jobs.some((job) => !isTerminalJob(job))) {
    if (!state.productionPoll) {
      state.productionPoll = window.setInterval(async () => {
        try {
          await loadProduction();
          render();

          if (!state.production.jobs.some((job) => !isTerminalJob(job))) {
            window.clearInterval(state.productionPoll);
            state.productionPoll = null;
          }
        } catch (error) {
          reportError(error);
        }
      }, 5000);
    }
  }
}

async function startAudioPreview() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  const integrity = integrityReviewState(revision);
  if (integrity.blocking) {
    setStatus(`Preview audio blocked: integrity review ${integrityReviewLabel(integrity.status)}.`);
    render();
    return;
  }

  els.generateAudioPreview.disabled = true;
  setStatus('Starting preview audio task...');

  try {
    await api(`/scripts/${script.id}/production/audio-preview`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    await refreshProductionUntilSettled();
    await loadJobs();
    setStatus('Preview audio task updated.');
  } catch (error) {
    await loadProduction();
    render();
    reportError(error);
  }
}

async function startCoverArt() {
  const script = activeSelectedScript();
  const revision = activeSelectedRevision();
  if (!script || !revision) {
    return;
  }

  const integrity = integrityReviewState(revision);
  if (integrity.blocking) {
    setStatus(`Cover art blocked: integrity review ${integrityReviewLabel(integrity.status)}.`);
    render();
    return;
  }

  els.generateCoverArt.disabled = true;
  setStatus('Starting cover art task...');

  try {
    await api(`/scripts/${script.id}/production/cover-art`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    await refreshProductionUntilSettled();
    await loadJobs();
    setStatus('Cover art task updated.');
  } catch (error) {
    await loadProduction();
    render();
    reportError(error);
  }
}

els.refresh.addEventListener('click', loadAll);
els.refreshJobs.addEventListener('click', async () => {
  els.refreshJobs.disabled = true;
  try {
    await loadJobs();
    render();
    setStatus('Task runs refreshed.');
  } catch (error) {
    reportError(error);
  } finally {
    els.refreshJobs.disabled = false;
  }
});
els.importLegacy.addEventListener('click', importLegacyData);
for (const button of els.surfaceTabs) {
  button.addEventListener('click', () => {
    setActiveSurface(button.dataset.surfaceTab);
  });
}
els.newShowToggle.addEventListener('click', () => {
  state.showSetupOpen = true;
  setActiveSurface('settings');
  renderShowSetup();
  scrollToPanel('showSetupForm');
});
els.cancelShowSetup.addEventListener('click', () => {
  state.showSetupOpen = false;
  render();
});
for (const button of els.settingsTabs) {
  button.addEventListener('click', () => {
    setActiveSettingsTab(button.dataset.settingsTab);
  });
}
els.showName.addEventListener('input', () => {
  if (!els.showSlug.dataset.touched) {
    els.showSlug.value = slugify(els.showName.value);
  }
  if (!els.showFeedTitle.value.trim()) {
    els.showFeedTitle.value = els.showName.value;
  }
  if (!els.showSourceQuery.value.trim()) {
    els.showSourceQuery.placeholder = `${els.showName.value || 'show'} news`;
  }
});
els.showSlug.addEventListener('input', () => {
  els.showSlug.dataset.touched = 'true';
  els.showSlug.value = slugify(els.showSlug.value);
});
els.showSetupForm.addEventListener('submit', createShow);
els.showSelect.addEventListener('change', async () => {
  state.selectedShowSlug = els.showSelect.value;
  state.selectedProfileId = '';
  clearPipelineSelections();
  restorePipelineStateForShow();
  await loadProfiles();
  await loadQueries();
  await loadFeeds();
  await loadModelProfiles();
  await loadPromptTemplates();
  await loadStoryCandidates();
  await loadResearchPackets();
  await loadScheduledPipelines();
  await loadJobs();
  await loadEpisodes();
  await loadScripts();
  render();
});
els.profileForm.addEventListener('submit', saveProfile);
els.profileType.addEventListener('change', () => {
  applySourceControlState(els.profileForm, els.profileType.value);
  applySourceControlStateToForms(els.queryList, els.profileType.value);
});
els.ingestProfile.addEventListener('click', ingestSelectedProfile);
els.manualForm.addEventListener('submit', submitManualUrl);
els.candidateClusterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await buildResearchBriefFromSelected();
});
els.clearCandidateSelection.addEventListener('click', clearCandidateSelection);
els.requestEpisodePlan.addEventListener('click', requestEpisodePlanForSelected);
for (const input of [els.clusterAngle, els.clusterNotes, els.clusterFormat, els.clusterRuntime]) {
  input.addEventListener('input', syncClusterFormFromInputs);
}
els.newQueryForm.addEventListener('submit', createQuery);
els.scriptGenerateForm.addEventListener('submit', generateScript);
els.scriptEditForm.addEventListener('submit', saveScriptRevision);
els.approveScript.addEventListener('click', approveSelectedScript);
els.generateAudioPreview.addEventListener('click', startAudioPreview);
els.generateCoverArt.addEventListener('click', startCoverArt);

await loadAll();
