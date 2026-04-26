const state = {
  shows: [],
  profiles: [],
  queries: [],
  scripts: [],
  researchPackets: [],
  modelProfiles: [],
  scheduledPipelines: [],
  failedScheduledRuns: [],
  storyCandidates: [],
  episodes: [],
  selectedScriptId: '',
  selectedScript: null,
  selectedRevision: null,
  production: {
    episode: null,
    assets: [],
    jobs: [],
  },
  productionPoll: null,
  selectedCandidateIds: [],
  clusterForm: {
    angle: '',
    notes: '',
    targetFormat: '',
    targetRuntime: '',
  },
  selectedResearchPacketId: '',
  selectedEpisodeId: '',
  selectedAssetIds: [],
  selectedShowSlug: '',
  selectedProfileId: '',
  showSetupOpen: false,
  runningActions: {},
};

const els = {
  status: document.querySelector('#status'),
  errorDetails: document.querySelector('#errorDetails'),
  errorDetailsBody: document.querySelector('#errorDetailsBody'),
  refresh: document.querySelector('#refresh'),
  importLegacy: document.querySelector('#importLegacy'),
  showSelect: document.querySelector('#showSelect'),
  newShowToggle: document.querySelector('#newShowToggle'),
  showSetupForm: document.querySelector('#showSetupForm'),
  showSetupMeta: document.querySelector('#showSetupMeta'),
  showSetupStatus: document.querySelector('#showSetupStatus'),
  showName: document.querySelector('#showName'),
  showSlug: document.querySelector('#showSlug'),
  showHostVoice: document.querySelector('#showHostVoice'),
  showDescription: document.querySelector('#showDescription'),
  showToneNotes: document.querySelector('#showToneNotes'),
  showScriptNotes: document.querySelector('#showScriptNotes'),
  showFeedTitle: document.querySelector('#showFeedTitle'),
  showFeedUrl: document.querySelector('#showFeedUrl'),
  showPublicBase: document.querySelector('#showPublicBase'),
  showOutputPath: document.querySelector('#showOutputPath'),
  showSourceQuery: document.querySelector('#showSourceQuery'),
  showPublishingMode: document.querySelector('#showPublishingMode'),
  showModelProvider: document.querySelector('#showModelProvider'),
  showModelName: document.querySelector('#showModelName'),
  showReasoningEffort: document.querySelector('#showReasoningEffort'),
  cancelShowSetup: document.querySelector('#cancelShowSetup'),
  pipelineMeta: document.querySelector('#pipelineMeta'),
  pipelineStages: document.querySelector('#pipelineStages'),
  pipelineDebug: document.querySelector('#pipelineDebug'),
  profileList: document.querySelector('#profileList'),
  profileForm: document.querySelector('#profileForm'),
  profileTitle: document.querySelector('#profileTitle'),
  profileMeta: document.querySelector('#profileMeta'),
  profileEnabled: document.querySelector('#profileEnabled'),
  profileName: document.querySelector('#profileName'),
  profileSlug: document.querySelector('#profileSlug'),
  profileType: document.querySelector('#profileType'),
  profileWeight: document.querySelector('#profileWeight'),
  profileFreshness: document.querySelector('#profileFreshness'),
  profileIncludeDomains: document.querySelector('#profileIncludeDomains'),
  profileExcludeDomains: document.querySelector('#profileExcludeDomains'),
  ingestProfile: document.querySelector('#ingestProfile'),
  manualForm: document.querySelector('#manualForm'),
  manualUrl: document.querySelector('#manualUrl'),
  manualTitle: document.querySelector('#manualTitle'),
  manualSourceName: document.querySelector('#manualSourceName'),
  manualSummary: document.querySelector('#manualSummary'),
  manualResult: document.querySelector('#manualResult'),
  candidateMeta: document.querySelector('#candidateMeta'),
  candidateClusterForm: document.querySelector('#candidateClusterForm'),
  selectionCount: document.querySelector('#selectionCount'),
  selectedCandidateSummary: document.querySelector('#selectedCandidateSummary'),
  clearCandidateSelection: document.querySelector('#clearCandidateSelection'),
  selectionWarnings: document.querySelector('#selectionWarnings'),
  clusterAngle: document.querySelector('#clusterAngle'),
  clusterNotes: document.querySelector('#clusterNotes'),
  clusterFormat: document.querySelector('#clusterFormat'),
  clusterRuntime: document.querySelector('#clusterRuntime'),
  launchClusterBrief: document.querySelector('#launchClusterBrief'),
  candidateList: document.querySelector('#candidateList'),
  researchBriefMeta: document.querySelector('#researchBriefMeta'),
  researchBriefList: document.querySelector('#researchBriefList'),
  schedulerMeta: document.querySelector('#schedulerMeta'),
  schedulerList: document.querySelector('#schedulerList'),
  failedScheduleRuns: document.querySelector('#failedScheduleRuns'),
  episodeMeta: document.querySelector('#episodeMeta'),
  episodeList: document.querySelector('#episodeList'),
  modelMeta: document.querySelector('#modelMeta'),
  modelProfileList: document.querySelector('#modelProfileList'),
  queriesPanel: document.querySelector('#queriesPanel'),
  queryCount: document.querySelector('#queryCount'),
  newQueryForm: document.querySelector('#newQueryForm'),
  newQueryText: document.querySelector('#newQueryText'),
  queryList: document.querySelector('#queryList'),
  scriptMeta: document.querySelector('#scriptMeta'),
  scriptGenerateForm: document.querySelector('#scriptGenerateForm'),
  scriptResearchPacketId: document.querySelector('#scriptResearchPacketId'),
  scriptFormat: document.querySelector('#scriptFormat'),
  scriptList: document.querySelector('#scriptList'),
  scriptEditForm: document.querySelector('#scriptEditForm'),
  scriptTitle: document.querySelector('#scriptTitle'),
  scriptBody: document.querySelector('#scriptBody'),
  approveScript: document.querySelector('#approveScript'),
  productionPanel: document.querySelector('#productionPanel'),
  productionMeta: document.querySelector('#productionMeta'),
  generateAudioPreview: document.querySelector('#generateAudioPreview'),
  generateCoverArt: document.querySelector('#generateCoverArt'),
  productionJobs: document.querySelector('#productionJobs'),
  productionAssets: document.querySelector('#productionAssets'),
};

class ApiRequestError extends Error {
  constructor(message, debugDetails) {
    super(message);
    this.name = 'ApiRequestError';
    this.debugDetails = debugDetails;
  }
}

function debugText(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function setStatus(message, debugDetails = '') {
  els.status.textContent = message;
  const detail = debugText(debugDetails);
  els.errorDetails.hidden = !detail;
  els.errorDetailsBody.textContent = detail;
}

function reportError(error, fallback = 'Something went wrong. Open technical details for the API response.') {
  if (error instanceof ApiRequestError) {
    setStatus(error.message, error.debugDetails);
    return error.message;
  }

  const message = error instanceof Error && error.message ? error.message : fallback;
  setStatus(fallback, message);
  return fallback;
}

function friendlyApiMessage(body, status) {
  const code = typeof body?.code === 'string' ? body.code : '';
  const raw = typeof body?.error === 'string' ? body.error : '';

  const messages = {
    VALIDATION_ERROR: 'Please check the form values and try again.',
    CONFIG_FILE_NOT_FOUND: 'The requested config file could not be found.',
    SOURCE_PROFILE_NOT_FOUND: 'That story source could not be found. Refresh and try again.',
    SOURCE_PROFILE_SHOW_MISMATCH: 'That story source belongs to a different show.',
    SOURCE_URL_REQUIRED: 'Choose a candidate story with a URL, or add an extra source URL before creating a research brief.',
    STORY_CANDIDATE_NOT_FOUND: 'That candidate story could not be found. Refresh and try again.',
    STORY_CANDIDATE_IGNORED: 'Ignored candidate stories cannot be used for research briefs.',
    CANDIDATE_SHOW_MISMATCH: 'All selected candidate stories must belong to the same show.',
    RESEARCH_PACKET_NOT_FOUND: 'That research brief could not be found. Check the ID and try again.',
    RESEARCH_PACKET_OR_WARNING_NOT_FOUND: 'That research brief or warning could not be found.',
    SCHEDULED_PIPELINE_NOT_FOUND: 'That scheduled pipeline could not be found. Refresh and try again.',
    SCHEDULED_RUN_NOT_FOUND: 'That scheduled run could not be found. Refresh and try again.',
    PUBLISH_BLOCKED: 'Publishing is blocked until the checklist items are complete.',
  };

  if (messages[code]) {
    return messages[code];
  }

  if (status === 404) {
    return 'That record could not be found. Refresh and try again.';
  }

  if (status === 409) {
    return raw || 'This action is blocked by the current review or publishing state.';
  }

  if (status >= 500) {
    return 'The local API hit a server error. Open technical details for the response.';
  }

  return raw || `Request failed with status ${status}.`;
}

function linesToList(value) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToLines(value) {
  return (value || []).join('\n');
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-{2,}/g, '-');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : undefined;
  } catch (error) {
    throw new ApiRequestError(
      response.ok ? 'The API returned an unreadable response.' : `Request failed with status ${response.status}.`,
      text,
    );
  }

  if (!response.ok || body.ok === false) {
    throw new ApiRequestError(friendlyApiMessage(body, response.status), {
      path,
      status: response.status,
      response: body,
    });
  }

  return body;
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
  return state.researchPackets.find((packet) => packet.id === state.selectedResearchPacketId);
}

function selectedEpisode() {
  return state.production.episode
    || state.episodes.find((episode) => episode.id === state.selectedEpisodeId)
    || null;
}

function selectedAssets() {
  const selected = new Set(state.selectedAssetIds);
  const assets = state.production.assets.filter((asset) => selected.has(asset.id));
  return assets.length > 0 ? assets : state.production.assets;
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
  state.clusterForm = { angle: '', notes: '', targetFormat: '', targetRuntime: '' };
  state.selectedResearchPacketId = '';
  state.selectedScriptId = '';
  state.selectedScript = null;
  state.selectedRevision = null;
  state.selectedEpisodeId = '';
  state.selectedAssetIds = [];
  state.production = { episode: null, assets: [], jobs: [] };
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
      ? 'No story sources yet. Create one during show setup or add a story source through the API, then add search queries or RSS feeds.'
      : 'No show selected. Create a show first, then add story sources.';
    els.profileList.append(empty);
    return;
  }

  for (const profile of state.profiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-button${profile.id === state.selectedProfileId ? ' active' : ''}`;
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector('strong').textContent = profile.name;
    button.querySelector('span').textContent = `${profile.type} | ${profile.enabled ? 'enabled' : 'disabled'} | weight ${profile.weight}`;
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
  els.ingestProfile.hidden = profile.type !== 'rss';
}

function statusClass(status) {
  return status.replaceAll(' ', '-');
}

function stageCard(stage) {
  const card = document.createElement('article');
  card.className = `pipeline-card ${statusClass(stage.status)}${stage.active ? ' active' : ''}`;

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
  status.className = `status-pill ${statusClass(stage.status)}`;
  status.textContent = stage.status;
  top.append(heading, status);

  const artifacts = document.createElement('div');
  artifacts.className = 'pipeline-artifacts';
  const artifactLabel = document.createElement('span');
  artifactLabel.className = 'pipeline-label';
  artifactLabel.textContent = 'Latest artifact';
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

  const button = document.createElement('button');
  button.type = 'button';
  button.className = stage.primary ? '' : 'secondary';
  button.textContent = stage.actionLabel;
  button.disabled = stage.disabled;
  if (stage.action) {
    button.addEventListener('click', stage.action);
  }

  card.append(top, artifacts, next, button);
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
    return state.researchPackets[0]?.title || 'No research brief selected yet.';
  }

  const warningCount = packet.warnings?.length || 0;
  return `${packet.title} (${packet.status}, ${warningCount} warning${warningCount === 1 ? '' : 's'})`;
}

function latestScriptText() {
  if (!state.selectedScript || !state.selectedRevision) {
    return state.scripts[0]?.title || 'No script draft selected yet.';
  }

  return `${state.selectedScript.title} (revision ${state.selectedRevision.version}, ${state.selectedScript.status})`;
}

function latestProductionText() {
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const audio = assets.find((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
  const art = assets.find((asset) => asset.type === 'cover-art');

  if (!episode) {
    return 'No episode or production assets selected yet.';
  }

  return `${episode.title} (${episode.status}) | audio ${audio ? 'ready' : 'missing'} | cover ${art ? 'ready' : 'missing'}`;
}

function buildPipelineStages() {
  const show = selectedShow();
  const profile = selectedProfile();
  const candidates = selectedCandidates();
  const candidateAnalysis = selectedCandidateAnalysis();
  const packet = selectedResearchPacket();
  const latestPacket = packet || state.researchPackets[0];
  const episode = selectedEpisode();
  const assets = selectedAssets();
  const audioAsset = assets.find((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
  const coverAsset = assets.find((asset) => asset.type === 'cover-art');
  const scriptApproved = state.selectedScript?.status === 'approved-for-audio'
    && state.selectedScript?.approvedRevisionId === state.selectedRevision?.id;
  const productionRunning = state.production.jobs.some((job) => !isTerminalJob(job));
  const discoverRunning = isActionRunning('discover');
  const researchRunning = isActionRunning('research');
  const scriptRunning = isActionRunning('script');
  const approvalsRunning = isActionRunning('approval');
  const publishRunning = isActionRunning('publish');
  const productionActionRunning = productionRunning || isActionRunning('production');
  const packetWarningCount = packet?.warnings?.length || 0;
  const packetBlocked = packet?.status === 'blocked';
  const profileSupportsDiscovery = profile && ['brave', 'rss'].includes(profile.type);

  return [
    {
      number: 1,
      title: 'Choose show and story source',
      status: show && profile ? 'done' : show ? 'blocked' : 'not started',
      artifact: show ? `${show.title}${profile ? ` | ${profile.name}` : ''}` : 'No show selected.',
      next: show
        ? (profile ? 'Use this show and source recipe for the next discovery run.' : 'Add or seed a story source/search recipe for this show.')
        : 'Create or select a show before building an episode.',
      actionLabel: show ? 'Open Show Setup' : 'New Show',
      action: () => {
        state.showSetupOpen = true;
        render();
      },
      disabled: false,
      active: Boolean(show && profile),
    },
    {
      number: 2,
      title: 'Find or ingest candidate stories',
      status: discoverRunning ? 'running' : !profile ? 'blocked' : state.storyCandidates.length > 0 ? 'done' : profileSupportsDiscovery ? 'ready' : 'ready',
      artifact: state.storyCandidates.length > 0
        ? `${state.storyCandidates.length} candidate stor${state.storyCandidates.length === 1 ? 'y' : 'ies'} loaded. Latest: ${state.storyCandidates[0].title}`
        : 'No candidate stories loaded yet.',
      next: !profile
        ? 'Choose a story source/search recipe first.'
        : profile.type === 'manual'
          ? 'Paste a manual source URL below to add a possible story.'
          : profileSupportsDiscovery
            ? `Run ${profile.type === 'rss' ? 'RSS import' : 'source search'} for the selected story source.`
            : 'This source type is not wired for browser-triggered discovery yet.',
      actionLabel: !profile ? 'Choose Story Source' : profile.type === 'rss' ? 'Import RSS Items' : profile.type === 'brave' ? 'Run Source Search' : 'Add Manual Story',
      action: !profile ? undefined : profileSupportsDiscovery ? runSelectedProfileDiscovery : focusManualStoryForm,
      disabled: discoverRunning || !profile || (!profileSupportsDiscovery && profile.type !== 'manual'),
      active: state.storyCandidates.length > 0,
    },
    {
      number: 3,
      title: 'Select or cluster candidate stories',
      status: state.storyCandidates.length === 0 ? 'blocked' : candidates.length > 0 ? 'done' : 'ready',
      artifact: latestCandidateText(),
      next: candidates.length > 0
        ? candidateAnalysis.canLaunch
          ? `${candidates.length} candidate stor${candidates.length === 1 ? 'y is' : 'ies are'} selected for the brief.`
          : 'Review the selected story warnings before building a research brief.'
        : 'Select one or more possible stories before building a research brief.',
      actionLabel: candidates.length > 0 ? 'Clear Selection' : 'Select Top Candidate',
      action: candidates.length > 0 ? clearCandidateSelection : selectTopCandidate,
      disabled: state.storyCandidates.length === 0,
      active: candidates.length > 0,
    },
    {
      number: 4,
      title: 'Build research brief',
      status: researchRunning ? 'running' : packetBlocked ? 'blocked' : packet && packetWarningCount > 0 ? 'needs review' : packet ? 'done' : state.researchPackets.length > 0 || candidates.length > 0 ? 'ready' : 'blocked',
      artifact: latestResearchText(latestPacket),
      next: packet
        ? (packetWarningCount > 0 ? 'Review warnings before drafting or approving production.' : 'Use this research brief to draft the episode.')
        : state.researchPackets.length > 0 ? 'Select the latest research brief or build a new one from selected candidate stories.' : candidates.length > 0 ? 'Build a research brief from the selected candidate stories.' : 'Select candidate stories first.',
      actionLabel: packet ? 'Use Selected Brief' : state.researchPackets.length > 0 ? 'Select Latest Brief' : 'Build Research Brief',
      action: packet ? () => selectResearchPacket(packet) : state.researchPackets.length > 0 ? () => selectResearchPacket(state.researchPackets[0]) : buildResearchBriefFromSelected,
      disabled: researchRunning || (!packet && state.researchPackets.length === 0 && !candidateAnalysis.canLaunch),
      active: Boolean(packet),
    },
    {
      number: 5,
      title: 'Generate or revise script draft',
      status: scriptRunning ? 'running' : state.selectedScript && scriptApproved ? 'done' : state.selectedScript ? 'needs review' : packet && !packetBlocked ? 'ready' : 'blocked',
      artifact: latestScriptText(),
      next: state.selectedScript
        ? (scriptApproved ? 'Approved script draft can move into audio and cover production.' : 'Review and approve the selected script revision before audio.')
        : packet && !packetBlocked ? 'Generate an episode draft from the selected research brief.' : 'Select a ready research brief first.',
      actionLabel: state.selectedScript ? 'Review Draft' : 'Generate Script Draft',
      action: state.selectedScript ? focusScriptEditor : generateScriptFromSelectedResearch,
      disabled: scriptRunning || (!state.selectedScript && (!packet || packetBlocked)),
      active: Boolean(state.selectedScript),
    },
    {
      number: 6,
      title: 'Generate audio and cover preview',
      status: productionActionRunning ? 'running' : audioAsset && coverAsset ? 'done' : scriptApproved ? 'ready' : 'blocked',
      artifact: latestProductionText(),
      next: audioAsset && coverAsset
        ? 'Preview audio and cover art are ready for publish review.'
        : scriptApproved ? 'Create the missing preview audio and cover art assets.' : 'Approve a script revision for audio first.',
      actionLabel: audioAsset && coverAsset ? 'Refresh Assets' : 'Create Missing Assets',
      action: audioAsset && coverAsset ? refreshProductionUntilSettled : createMissingProductionAssets,
      disabled: productionActionRunning || (!scriptApproved && !(audioAsset && coverAsset)),
      active: Boolean(audioAsset || coverAsset),
    },
    {
      number: 7,
      title: 'Review approvals',
      status: approvalsRunning ? 'running' : episode?.status === 'approved-for-publish' || episode?.status === 'published' ? 'done' : episode?.status === 'audio-ready' ? 'ready' : state.selectedScript && !scriptApproved ? 'needs review' : 'blocked',
      artifact: episode ? `${episode.title} (${episode.status})` : latestScriptText(),
      next: episode?.status === 'audio-ready'
        ? 'Approve the episode for publishing after reviewing assets.'
        : state.selectedScript && !scriptApproved ? 'Approve the script revision before production can run.' : 'Finish script approval and production assets first.',
      actionLabel: episode?.status === 'audio-ready' ? 'Approve for Publishing' : 'Approve Script for Audio',
      action: episode?.status === 'audio-ready' ? approveEpisodeForPublishing : approveSelectedScript,
      disabled: approvalsRunning || !(episode?.status === 'audio-ready' || (state.selectedScript && state.selectedRevision && !scriptApproved)),
      active: Boolean(episode?.status === 'approved-for-publish' || episode?.status === 'published'),
    },
    {
      number: 8,
      title: 'Publish',
      status: publishRunning ? 'running' : episode?.status === 'published' ? 'done' : episode?.status === 'approved-for-publish' ? 'ready' : 'blocked',
      artifact: episode?.feedGuid || episode?.metadata?.publish?.rssUrl || 'No publishing record yet.',
      next: episode?.status === 'published'
        ? 'RSS publishing has a recorded feed GUID or publish result.'
        : episode?.status === 'approved-for-publish' ? 'Publish to the configured RSS feed.' : 'Approval for publishing is required before RSS output.',
      actionLabel: episode?.status === 'published' ? 'Already Published' : 'Publish to RSS',
      action: publishSelectedEpisode,
      disabled: publishRunning || episode?.status !== 'approved-for-publish',
      active: episode?.status === 'published',
      primary: true,
    },
  ];
}

function renderPipeline() {
  const show = selectedShow();
  const profile = selectedProfile();
  els.pipelineMeta.textContent = show
    ? `${show.title}${profile ? ` | Story source: ${profile.name}` : ' | Choose a story source/search recipe'}`
    : 'Choose a show to start an evidence-first episode workflow.';
  els.pipelineStages.innerHTML = '';

  for (const stage of buildPipelineStages()) {
    els.pipelineStages.append(stageCard(stage));
  }

  els.pipelineDebug.textContent = JSON.stringify({
    showSlug: state.selectedShowSlug,
    sourceProfileId: state.selectedProfileId,
    selectedCandidateIds: state.selectedCandidateIds,
    clusterForm: state.clusterForm,
    selectedResearchPacketId: state.selectedResearchPacketId,
    selectedScriptId: state.selectedScriptId,
    selectedRevisionId: state.selectedRevision?.id ?? null,
    selectedEpisodeId: state.selectedEpisodeId || state.production.episode?.id || null,
    selectedAssetIds: state.selectedAssetIds,
  }, null, 2);
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

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveQuery(query.id, form);
    });
    form.elements.delete.addEventListener('click', async () => {
      await deleteQuery(query.id);
    });
    els.queryList.append(form);
  }
}

function renderCandidateSelectionPanel() {
  const analysis = selectedCandidateAnalysis();
  const { candidates } = analysis;
  const selectedCount = candidates.length;
  const researchRunning = isActionRunning('research');

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

  for (const item of reviewItems) {
    const row = document.createElement('div');
    row.className = `warning-item ${item.level === 'error' ? 'error' : ''}`;
    row.textContent = item.text;
    els.selectionWarnings.append(row);
  }

  els.launchClusterBrief.disabled = researchRunning || !analysis.canLaunch;
  els.launchClusterBrief.textContent = researchRunning ? 'Building Research Brief...' : 'Build Research Brief';
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
    const row = document.createElement('article');
    row.className = `record-row${packet.id === state.selectedResearchPacketId ? ' selected' : ''}`;

    const title = document.createElement('strong');
    title.textContent = packet.title;

    const warningCount = packet.warnings?.length || 0;
    const meta = document.createElement('span');
    meta.textContent = `${packet.status} | ${packet.citations?.length || 0} citation${packet.citations?.length === 1 ? '' : 's'} | ${warningCount} warning${warningCount === 1 ? '' : 's'}`;

    const summary = document.createElement('p');
    summary.textContent = warningCount > 0
      ? 'Review warnings before drafting or approving production.'
      : 'Ready for script drafting when the editor is comfortable with the source mix.';

    const actions = document.createElement('div');
    actions.className = 'actions inline row-actions';
    const useForScript = document.createElement('button');
    useForScript.type = 'button';
    useForScript.className = 'secondary';
    useForScript.textContent = packet.id === state.selectedResearchPacketId ? 'Selected for Script' : 'Use for Script';
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
    const row = document.createElement('article');
    row.className = `record-row${episode.id === state.selectedEpisodeId ? ' selected' : ''}`;

    const title = document.createElement('strong');
    title.textContent = episode.episodeNumber ? `EP${episode.episodeNumber}: ${episode.title}` : episode.title;

    const meta = document.createElement('span');
    const published = episode.publishedAt ? ` | published ${new Date(episode.publishedAt).toLocaleString()}` : '';
    meta.textContent = `${episode.status} | ${episode.slug}${published}`;

    const summary = document.createElement('p');
    summary.textContent = episode.feedGuid || episode.metadata?.publicAudioUrl || episode.description || 'No publish metadata recorded.';

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = episode.id === state.selectedEpisodeId ? 'Selected Episode' : 'Select Episode';
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
    const params = profile.config?.params ? JSON.stringify(profile.config.params) : 'No custom settings';
    detail.textContent = `${profile.promptTemplateKey || 'default agent instructions'} | ${params}`;

    row.append(title, meta, detail);
    els.modelProfileList.append(row);
  }
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

function latestAsset(type) {
  return state.production.assets.find((asset) => asset.type === type);
}

function renderProduction() {
  const hasScript = Boolean(state.selectedScript && state.selectedRevision);
  els.productionPanel.hidden = !hasScript;

  if (!hasScript) {
    return;
  }

  const approved = state.selectedScript.status === 'approved-for-audio'
    && state.selectedScript.approvedRevisionId === state.selectedRevision.id;
  const audioJob = latestJob('audio.preview');
  const artJob = latestJob('art.generate');
  const audioRunning = audioJob && !isTerminalJob(audioJob);
  const artRunning = artJob && !isTerminalJob(artJob);

  els.generateAudioPreview.disabled = !approved || audioRunning;
  els.generateCoverArt.disabled = !approved || artRunning;
  els.productionMeta.textContent = approved
    ? (state.production.episode ? `Episode ${state.production.episode.slug}` : 'No audio or cover asset tasks yet.')
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
    title.textContent = `${job.type} | ${job.status}`;
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
      details.querySelector('pre').textContent = JSON.stringify({ error: job.error, logs: job.logs, output: job.output }, null, 2);
      row.append(details);
    }
    els.productionJobs.append(row);
  }

  els.productionAssets.innerHTML = '';
  const assets = [latestAsset('audio-preview'), latestAsset('cover-art')].filter(Boolean);
  if (assets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No audio or cover assets recorded yet.';
    els.productionAssets.append(empty);
    return;
  }

  for (const asset of assets) {
    const row = document.createElement('div');
    row.className = 'production-row';
    const title = document.createElement('strong');
    title.textContent = asset.label || asset.type;
    const meta = document.createElement('span');
    meta.textContent = asset.publicUrl || asset.objectKey || asset.localPath || asset.mimeType || 'Asset recorded';
    row.append(title, meta);
    els.productionAssets.append(row);
  }
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-button${script.id === state.selectedScriptId ? ' active' : ''}`;
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector('strong').textContent = script.title;
    button.querySelector('span').textContent = `${script.format} | ${script.status} | updated ${new Date(script.updatedAt).toLocaleString()}`;
    button.addEventListener('click', async () => {
      await loadScript(script.id);
      savePipelineState();
      render();
    });
    els.scriptList.append(button);
  }

  els.scriptEditForm.hidden = !state.selectedScript || !state.selectedRevision;

  if (state.selectedScript && state.selectedRevision) {
    els.scriptTitle.value = state.selectedRevision.title;
    els.scriptBody.value = state.selectedRevision.body;
    els.approveScript.disabled = state.selectedScript.approvedRevisionId === state.selectedRevision.id;
  }

  renderProduction();
}

function render() {
  renderShows();
  renderPipeline();
  renderShowSetup();
  renderProfiles();
  renderProfileForm();
  renderStoryCandidates();
  renderResearchBriefs();
  renderScheduler();
  renderEpisodes();
  renderModelProfiles();
  renderQueries();
  renderScripts();
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
    state.production = { episode: null, assets: [], jobs: [] };
  }
}

async function loadModelProfiles() {
  if (!state.selectedShowSlug) {
    state.modelProfiles = [];
    return;
  }

  const body = await api(`/model-profiles?showSlug=${encodeURIComponent(state.selectedShowSlug)}`);
  state.modelProfiles = body.modelProfiles;
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

async function runScheduledPipeline(id, button) {
  button.disabled = true;
  setStatus('Starting scheduled pipeline...');

  try {
    const body = await api(`/scheduled-pipelines/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-ui' }),
    });
    await loadScheduledPipelines();
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
  els.manualUrl.focus();
  setStatus('Paste a source URL in Add Manual Story to create a candidate story.');
}

function focusScriptEditor() {
  if (state.selectedScript && state.selectedRevision) {
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
  savePipelineState();
  render();
  setStatus('Top candidate story selected for the research brief.');
}

function clearCandidateSelection() {
  state.selectedCandidateIds = [];
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

  if (!profile || !['brave', 'rss'].includes(profile.type)) {
    focusManualStoryForm();
    return;
  }

  setActionRunning('discover', true);
  setStatus(profile.type === 'rss' ? 'Importing RSS items...' : 'Running source search...');

  try {
    const path = profile.type === 'rss'
      ? `/source-profiles/${profile.id}/ingest`
      : `/source-profiles/${profile.id}/search`;
    const body = await api(path, { method: 'POST' });
    await loadStoryCandidates();
    render();
    setStatus(`${profile.type === 'rss' ? 'RSS import' : 'Source search'} complete: ${body.inserted} inserted, ${body.skipped} skipped.`);
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('discover', false);
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
  const researchPacketId = state.selectedResearchPacketId || els.scriptResearchPacketId.value.trim();

  if (!researchPacketId) {
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
  if (!state.selectedScript || !state.selectedRevision) {
    return;
  }

  setActionRunning('production', true);
  setStatus('Creating missing audio and cover assets...');

  try {
    let assets = selectedAssets();
    const hasAudio = assets.some((asset) => asset.type === 'audio-preview' || asset.type === 'audio-final');
    const hasCover = assets.some((asset) => asset.type === 'cover-art');

    if (!hasAudio) {
      await api(`/scripts/${state.selectedScript.id}/production/audio-preview`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'local-user' }),
      });
      await loadProduction();
      assets = selectedAssets();
    }

    if (!hasCover && !assets.some((asset) => asset.type === 'cover-art')) {
      await api(`/scripts/${state.selectedScript.id}/production/cover-art`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'local-user' }),
      });
      await loadProduction();
    }

    await loadEpisodes();
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
    await safeLoad('AI role settings', loadModelProfiles, () => {
      state.modelProfiles = [];
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
    await safeLoad('episodes', loadEpisodes, () => {
      state.episodes = [];
    });
    await safeLoad('script drafts', loadScripts, () => {
      state.scripts = [];
      state.selectedScriptId = '';
      state.selectedScript = null;
      state.selectedRevision = null;
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
      candidate_scorer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      source_summarizer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      claim_extractor: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      research_synthesizer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      script_writer: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
      script_editor: { provider, model, params: reasoningEffort ? { reasoningEffort } : {} },
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

  const payload = {
    enabled: els.profileEnabled.checked,
    name: els.profileName.value.trim(),
    slug: els.profileSlug.value.trim(),
    type: els.profileType.value,
    weight: Number(els.profileWeight.value),
    freshness: els.profileFreshness.value.trim() || null,
    includeDomains: linesToList(els.profileIncludeDomains.value),
    excludeDomains: linesToList(els.profileExcludeDomains.value),
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

async function saveQuery(id, form) {
  const payload = {
    enabled: form.elements.enabled.checked,
    query: form.elements.query.value.trim(),
    weight: Number(form.elements.weight.value),
    freshness: form.elements.freshness.value.trim() || null,
    includeDomains: linesToList(form.elements.includeDomains.value),
    excludeDomains: linesToList(form.elements.excludeDomains.value),
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
    const body = await api(`/source-profiles/${state.selectedProfileId}/queries`, {
      method: 'POST',
      body: JSON.stringify({
        query: els.newQueryText.value.trim(),
        enabled: true,
        weight: 1,
        freshness: selectedProfile()?.freshness || null,
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
    state.selectedResearchPacketId = researchPacketId;
    state.production = { episode: null, assets: [], jobs: [] };
    els.scriptResearchPacketId.value = '';
    savePipelineState();
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
    await loadProduction();
    render();
    setStatus(`Saved script revision ${body.revision.version}.`);
  } catch (error) {
    reportError(error);
  }
}

async function approveSelectedScript() {
  if (!state.selectedScript || !state.selectedRevision) {
    return;
  }

  setActionRunning('approval', true);
  setStatus('Saving script approval...');

  try {
    const body = await api(`/scripts/${state.selectedScript.id}/revisions/${state.selectedRevision.id}/approve-for-audio`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'local-user',
        reason: 'Approved in local UI.',
      }),
    });
    state.scripts = state.scripts.map((script) => script.id === body.script.id ? body.script : script);
    state.selectedScript = body.script;
    await loadProduction();
    savePipelineState();
    render();
    setStatus('Review decision saved: script approved for audio.');
  } catch (error) {
    reportError(error);
  } finally {
    setActionRunning('approval', false);
  }
}

async function refreshProductionUntilSettled() {
  if (!state.selectedScriptId) {
    return;
  }

  await loadProduction();
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
      }, 1500);
    }
  }
}

async function startAudioPreview() {
  if (!state.selectedScript) {
    return;
  }

  els.generateAudioPreview.disabled = true;
  setStatus('Starting preview audio job...');

  try {
    await api(`/scripts/${state.selectedScript.id}/production/audio-preview`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    await refreshProductionUntilSettled();
    setStatus('Preview audio job updated.');
  } catch (error) {
    await loadProduction();
    render();
    reportError(error);
  }
}

async function startCoverArt() {
  if (!state.selectedScript) {
    return;
  }

  els.generateCoverArt.disabled = true;
  setStatus('Starting cover art job...');

  try {
    await api(`/scripts/${state.selectedScript.id}/production/cover-art`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'local-user' }),
    });
    await refreshProductionUntilSettled();
    setStatus('Cover art job updated.');
  } catch (error) {
    await loadProduction();
    render();
    reportError(error);
  }
}

els.refresh.addEventListener('click', loadAll);
els.importLegacy.addEventListener('click', importLegacyData);
els.newShowToggle.addEventListener('click', () => {
  state.showSetupOpen = true;
  render();
});
els.cancelShowSetup.addEventListener('click', () => {
  state.showSetupOpen = false;
  render();
});
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
  await loadModelProfiles();
  await loadStoryCandidates();
  await loadResearchPackets();
  await loadScheduledPipelines();
  await loadEpisodes();
  await loadScripts();
  render();
});
els.profileForm.addEventListener('submit', saveProfile);
els.ingestProfile.addEventListener('click', ingestSelectedProfile);
els.manualForm.addEventListener('submit', submitManualUrl);
els.candidateClusterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await buildResearchBriefFromSelected();
});
els.clearCandidateSelection.addEventListener('click', clearCandidateSelection);
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
