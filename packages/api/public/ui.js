const state = {
  shows: [],
  profiles: [],
  queries: [],
  scripts: [],
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
  selectedShowSlug: '',
  selectedProfileId: '',
  showSetupOpen: false,
};

const els = {
  status: document.querySelector('#status'),
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
  candidateList: document.querySelector('#candidateList'),
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

function setStatus(message) {
  els.status.textContent = message;
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

  const body = await response.json();

  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedProfileId);
}

function renderShows() {
  els.showSelect.innerHTML = '';

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
    empty.textContent = 'No source profiles found.';
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
      await loadQueries();
      render();
    });
    els.profileList.append(button);
  }
}

function renderShowSetup() {
  els.showSetupForm.hidden = !state.showSetupOpen;
  els.showSetupMeta.textContent = state.showSetupOpen ? 'Draft setups stay visible in the show list.' : '';
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

function renderQueries() {
  els.queryList.innerHTML = '';
  els.queryCount.textContent = `${state.queries.filter((query) => query.enabled).length} enabled of ${state.queries.length}`;

  if (state.queries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No queries configured for this source profile.';
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
        <span>Query</span>
        <textarea name="query" rows="2" required></textarea>
      </label>
      <div class="query-grid">
        <label class="field">
          <span>Weight</span>
          <input name="weight" type="number" min="0" step="0.001" required>
        </label>
        <label class="field">
          <span>Freshness</span>
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
        <button type="submit">Save Query</button>
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

function renderStoryCandidates() {
  els.candidateList.innerHTML = '';
  els.candidateMeta.textContent = `${state.storyCandidates.length} recent candidate${state.storyCandidates.length === 1 ? '' : 's'}`;

  if (state.storyCandidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No story candidates found.';
    els.candidateList.append(empty);
    return;
  }

  for (const candidate of state.storyCandidates) {
    const row = document.createElement('article');
    row.className = 'record-row';

    const title = document.createElement('strong');
    title.textContent = candidate.title;

    const meta = document.createElement('span');
    const score = candidate.score === null || candidate.score === undefined ? 'unscored' : `score ${candidate.score}`;
    meta.textContent = `${candidate.sourceName || 'unknown source'} | ${score} | ${candidate.status}`;

    const summary = document.createElement('p');
    summary.textContent = candidate.summary || candidate.url || 'No summary recorded.';

    row.append(title, meta, summary);
    els.candidateList.append(row);
  }
}

function renderEpisodes() {
  els.episodeList.innerHTML = '';
  els.episodeMeta.textContent = `${state.episodes.length} episode${state.episodes.length === 1 ? '' : 's'}`;

  if (state.episodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No episodes found.';
    els.episodeList.append(empty);
    return;
  }

  for (const episode of state.episodes) {
    const row = document.createElement('article');
    row.className = 'record-row';

    const title = document.createElement('strong');
    title.textContent = episode.episodeNumber ? `EP${episode.episodeNumber}: ${episode.title}` : episode.title;

    const meta = document.createElement('span');
    const published = episode.publishedAt ? ` | published ${new Date(episode.publishedAt).toLocaleString()}` : '';
    meta.textContent = `${episode.status} | ${episode.slug}${published}`;

    const summary = document.createElement('p');
    summary.textContent = episode.feedGuid || episode.metadata?.publicAudioUrl || episode.description || 'No publish metadata recorded.';

    row.append(title, meta, summary);
    els.episodeList.append(row);
  }
}

function renderModelProfiles() {
  els.modelProfileList.innerHTML = '';
  els.modelMeta.textContent = `${state.modelProfiles.length} role profile${state.modelProfiles.length === 1 ? '' : 's'}`;

  if (state.modelProfiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No model profiles configured.';
    els.modelProfileList.append(empty);
    return;
  }

  for (const profile of state.modelProfiles) {
    const row = document.createElement('article');
    row.className = 'record-row';

    const title = document.createElement('strong');
    title.textContent = profile.role;

    const meta = document.createElement('span');
    meta.textContent = `${profile.provider} | ${profile.model}`;

    const detail = document.createElement('p');
    const params = profile.config?.params ? JSON.stringify(profile.config.params) : 'No params';
    detail.textContent = `${profile.promptTemplateKey || 'default prompt'} | ${params}`;

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
    empty.textContent = 'No scheduled pipelines configured.';
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
    detail.textContent = `${pipeline.workflow.join(' -> ')}${pipeline.autopublish ? ' | autopublish' : ' | approval required'}`;

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
  heading.textContent = 'Failed Runs';
  els.failedScheduleRuns.append(heading);

  for (const job of state.failedScheduledRuns) {
    const row = document.createElement('div');
    row.className = 'production-row failed';

    const title = document.createElement('strong');
    title.textContent = `${job.input.scheduledPipelineSlug || job.input.scheduledPipelineId} | ${job.status}`;

    const meta = document.createElement('span');
    meta.textContent = job.error || `Updated ${new Date(job.updatedAt).toLocaleString()}`;

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'secondary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', async () => {
      await retryScheduledRun(job.id, retry);
    });

    row.append(title, meta, retry);
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
    ? (state.production.episode ? `Episode ${state.production.episode.slug}` : 'No production jobs yet.')
    : 'Approve the selected revision before producing assets.';

  els.productionJobs.innerHTML = '';
  if (state.production.jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No production jobs yet.';
    els.productionJobs.append(empty);
  }

  for (const job of state.production.jobs) {
    const row = document.createElement('div');
    row.className = `production-row${job.status === 'failed' ? ' failed' : ''}`;
    const title = document.createElement('strong');
    title.textContent = `${job.type} | ${job.status}`;
    const meta = document.createElement('span');
    meta.textContent = job.error || `Progress ${job.progress}%`;
    const progress = document.createElement('div');
    progress.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.max(0, Math.min(100, job.progress))}%`;
    progress.append(fill);
    row.append(title, meta, progress);
    els.productionJobs.append(row);
  }

  els.productionAssets.innerHTML = '';
  const assets = [latestAsset('audio-preview'), latestAsset('cover-art')].filter(Boolean);
  if (assets.length === 0) {
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
    empty.textContent = 'No scripts generated yet.';
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
  renderShowSetup();
  renderProfiles();
  renderProfileForm();
  renderStoryCandidates();
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
    setStatus(error.message);
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
    setStatus(`Scheduled retry ${body.job.status}.`);
  } catch (error) {
    await loadScheduledPipelines();
    render();
    setStatus(error.message);
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
}

async function loadAll() {
  try {
    els.refresh.disabled = true;
    setStatus('Loading sources...');
    await loadShows();
    await loadProfiles();
    await loadQueries();
    await loadModelProfiles();
    await loadStoryCandidates();
    await loadScheduledPipelines();
    await loadEpisodes();
    await loadScripts();
    render();
    setStatus('Source profiles loaded.');
  } catch (error) {
    setStatus(error.message);
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
    state.selectedScriptId = '';
    state.showSetupOpen = false;
    els.showSetupForm.reset();
    els.showModelProvider.value = 'openai';
    els.showModelName.value = 'gpt-5.5';
    els.showReasoningEffort.value = 'high';
    await loadAll();
    setStatus(`Show created: ${body.show.title}`);
  } catch (error) {
    setStatus(error.message);
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
    setStatus(error.message);
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

  const body = await api(`/source-profiles/${profile.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const index = state.profiles.findIndex((candidate) => candidate.id === profile.id);
  state.profiles[index] = body.sourceProfile;
  render();
  setStatus('Profile saved.');
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
    setStatus(`RSS ingest complete: ${body.inserted} inserted, ${body.skipped} skipped.`);
  } catch (error) {
    setStatus(error.message);
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
      els.manualResult.textContent = `Created candidate: ${body.candidate.title}`;
      await loadStoryCandidates();
      render();
      setStatus('Manual URL submitted.');
    } else {
      els.manualResult.textContent = `Skipped: ${body.reason}`;
      setStatus('Manual URL matched an existing candidate.');
    }
  } catch (error) {
    els.manualResult.textContent = error.message;
    setStatus(error.message);
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
  const body = await api(`/source-queries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const index = state.queries.findIndex((query) => query.id === id);
  state.queries[index] = body.sourceQuery;
  render();
  setStatus('Query saved.');
}

async function createQuery(event) {
  event.preventDefault();

  if (!state.selectedProfileId) {
    return;
  }

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
  setStatus('Query created.');
}

async function deleteQuery(id) {
  await api(`/source-queries/${id}`, { method: 'DELETE' });
  state.queries = state.queries.filter((query) => query.id !== id);
  render();
  setStatus('Query deleted.');
}

async function generateScript(event) {
  event.preventDefault();
  const researchPacketId = els.scriptResearchPacketId.value.trim();

  if (!researchPacketId) {
    return;
  }

  const body = await api(`/research-packets/${researchPacketId}/script`, {
    method: 'POST',
    body: JSON.stringify({
      format: els.scriptFormat.value.trim() || undefined,
      actor: 'local-user',
    }),
  });
  state.scripts = [body.script, ...state.scripts.filter((script) => script.id !== body.script.id)];
  state.selectedScriptId = body.script.id;
  state.selectedScript = body.script;
  state.selectedRevision = body.revision;
  state.production = { episode: null, assets: [], jobs: [] };
  els.scriptResearchPacketId.value = '';
  render();
  setStatus(`Generated script revision ${body.revision.version}.`);
}

async function saveScriptRevision(event) {
  event.preventDefault();

  if (!state.selectedScript) {
    return;
  }

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
}

async function approveSelectedScript() {
  if (!state.selectedScript || !state.selectedRevision) {
    return;
  }

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
  render();
  setStatus('Script approved for audio.');
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
          setStatus(error.message);
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
    setStatus(error.message);
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
    setStatus(error.message);
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
  state.selectedScriptId = '';
  await loadProfiles();
  await loadQueries();
  await loadModelProfiles();
  await loadStoryCandidates();
  await loadScheduledPipelines();
  await loadEpisodes();
  await loadScripts();
  render();
});
els.profileForm.addEventListener('submit', saveProfile);
els.ingestProfile.addEventListener('click', ingestSelectedProfile);
els.manualForm.addEventListener('submit', submitManualUrl);
els.newQueryForm.addEventListener('submit', createQuery);
els.scriptGenerateForm.addEventListener('submit', generateScript);
els.scriptEditForm.addEventListener('submit', saveScriptRevision);
els.approveScript.addEventListener('click', approveSelectedScript);
els.generateAudioPreview.addEventListener('click', startAudioPreview);
els.generateCoverArt.addEventListener('click', startCoverArt);

await loadAll();
