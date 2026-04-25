const state = {
  shows: [],
  profiles: [],
  queries: [],
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
  queriesPanel: document.querySelector('#queriesPanel'),
  queryCount: document.querySelector('#queryCount'),
  newQueryForm: document.querySelector('#newQueryForm'),
  newQueryText: document.querySelector('#newQueryText'),
  queryList: document.querySelector('#queryList'),
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

function render() {
  renderShows();
  renderProfiles();
  renderProfileForm();
  renderQueries();
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

async function loadAll() {
  try {
    els.refresh.disabled = true;
    setStatus('Loading sources...');
    await loadShows();
    await loadProfiles();
    await loadQueries();
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

els.refresh.addEventListener('click', loadAll);
els.showSelect.addEventListener('change', async () => {
  state.selectedShowSlug = els.showSelect.value;
  state.selectedProfileId = '';
  await loadProfiles();
  await loadQueries();
  render();
});
els.profileForm.addEventListener('submit', saveProfile);
els.newQueryForm.addEventListener('submit', createQuery);

await loadAll();
