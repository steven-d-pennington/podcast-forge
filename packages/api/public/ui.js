const state = {
  shows: [],
  profiles: [],
  queries: [],
  scripts: [],
  selectedScriptId: '',
  selectedScript: null,
  selectedRevision: null,
  selectedShowSlug: '',
  selectedProfileId: '',
};

const els = {
  status: document.querySelector('#status'),
  refresh: document.querySelector('#refresh'),
  showSelect: document.querySelector('#showSelect'),
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
}

function render() {
  renderShows();
  renderProfiles();
  renderProfileForm();
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
  }
}

async function loadScript(id) {
  const body = await api(`/scripts/${id}`);
  state.selectedScriptId = id;
  state.selectedScript = body.script;
  state.selectedRevision = body.latestRevision || null;
}

async function loadAll() {
  try {
    els.refresh.disabled = true;
    setStatus('Loading sources...');
    await loadShows();
    await loadProfiles();
    await loadQueries();
    await loadScripts();
    render();
    setStatus('Source profiles loaded.');
  } catch (error) {
    setStatus(error.message);
  } finally {
    els.refresh.disabled = false;
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
  render();
  setStatus('Script approved for audio.');
}

els.refresh.addEventListener('click', loadAll);
els.showSelect.addEventListener('change', async () => {
  state.selectedShowSlug = els.showSelect.value;
  state.selectedProfileId = '';
  state.selectedScriptId = '';
  await loadProfiles();
  await loadQueries();
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

await loadAll();
