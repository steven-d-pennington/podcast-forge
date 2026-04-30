import { MODEL_ROLE_LABELS } from './ui-constants.js';

const TRUST_STATUS_VOCABULARY = Object.freeze({
  aiOutput: {
    label: 'AI output',
    className: 'ai-output',
    description: 'AI-generated analysis, draft text, or generated media that still needs editorial review.',
  },
  sourceEvidence: {
    label: 'Source evidence',
    className: 'source-evidence',
    description: 'Fetched, cited, or source-backed material used to support the episode.',
  },
  reviewDecision: {
    label: 'Review decision',
    className: 'review-decision',
    description: 'A human approval, rejection, or override recorded in the audit trail.',
  },
  unresolvedWarning: {
    label: 'Unresolved warning',
    className: 'unresolved-warning',
    description: 'A warning that needs review or an explicit override before relying on the output.',
  },
  blocker: {
    label: 'Blocker',
    className: 'blocker',
    description: 'A required gate or missing dependency that prevents the next safe action.',
  },
  auditDetail: {
    label: 'Audit detail',
    className: 'audit-detail',
    description: 'Technical IDs, logs, JSON, provider metadata, and other audit/debug context.',
  },
});

export function trustStatusVocabulary(kind) {
  return TRUST_STATUS_VOCABULARY[kind] || {
    label: 'Status',
    className: 'status',
    description: 'Workflow status detail.',
  };
}

export function linesToList(value) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function listToLines(value) {
  return (value || []).join('\n');
}

export function sourceControlsSupported(type) {
  return type === 'brave' || type === 'zai-web' || type === 'openrouter-perplexity' || type === 'rss';
}

export function sourceControlHelp(type) {
  if (type === 'brave') {
    return 'Freshness is sent to Brave. Domain filters are enforced after results return.';
  }

  if (type === 'zai-web') {
    return 'Freshness and the first include-domain filter are sent to Z.AI Web Search. Domain filters are also enforced after results return.';
  }

  if (type === 'openrouter-perplexity') {
    return 'Freshness and excluded domains are requested from OpenRouter Perplexity/Sonar. Include/exclude domain filters are also enforced after curated results return.';
  }

  if (type === 'rss') {
    return 'Domain filters are enforced on item URLs. Freshness is checked when feed items include published dates.';
  }

  return 'Freshness and domain filters are not applied for manual or local JSON sources.';
}

export function sourceProviderLabel(type) {
  return {
    brave: 'Brave',
    'zai-web': 'Z.AI Web Search',
    'openrouter-perplexity': 'OpenRouter Perplexity/Sonar',
    rss: 'RSS',
    manual: 'Manual URL',
    'local-json': 'Local JSON',
  }[type] || 'Story Source';
}

export function sourceActionLabel(type) {
  return {
    brave: 'Search Brave',
    'zai-web': 'Search Z.AI Web',
    'openrouter-perplexity': 'Curate with Perplexity/Sonar',
    rss: 'Import RSS Items',
    manual: 'Add Manual URL',
    'local-json': 'Review Local JSON Settings',
  }[type] || 'Edit Story Source Settings';
}

function enabledQueries(queries) {
  return asArray(queries).filter((query) => query.enabled !== false);
}

function plural(value, singular, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function configuredText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function freshnessLabel(value) {
  return {
    pd: 'Past day',
    pw: 'Past week',
    pm: 'Past month',
    py: 'Past year',
    day: 'Past day',
    week: 'Past week',
    month: 'Past month',
    year: 'Past year',
    oneDay: 'Past day',
    oneWeek: 'Past week',
    oneMonth: 'Past month',
    oneYear: 'Past year',
  }[configuredText(value)] || configuredText(value);
}

function configuredList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim());
  }

  return [];
}

function rssConfigFeedCount(profile) {
  const config = asObject(profile?.config);
  return (configuredText(config.feedUrl) ? 1 : 0) + configuredList(config.feedUrls).length;
}

function localJsonConfigured(profile) {
  const config = asObject(profile?.config);
  return Boolean(
    configuredText(config.path)
    || configuredText(config.filePath)
    || configuredText(config.localPath)
    || configuredText(config.importPath)
    || configuredText(config.sourcePath)
  );
}

export function sourceInputSummary(profile, queries = []) {
  if (!profile) {
    return 'No story source selected.';
  }

  const activeQueries = enabledQueries(queries);
  const savedCount = asArray(queries).length;

  if (profile.type === 'rss') {
    const feedCount = activeQueries.length + rssConfigFeedCount(profile);
    return feedCount > 0
      ? `${plural(feedCount, 'feed URL')} ready (${plural(activeQueries.length, 'enabled search query', 'enabled search queries')})`
      : 'No RSS feed URLs configured yet.';
  }

  if (profile.type === 'manual') {
    return 'Manual URL intake; no saved query is required.';
  }

  if (profile.type === 'local-json') {
    return localJsonConfigured(profile) ? 'Local JSON import settings are present.' : 'Local JSON import settings are missing.';
  }

  return activeQueries.length > 0
    ? `${plural(activeQueries.length, 'enabled search query', 'enabled search queries')} (${plural(savedCount, 'saved query', 'saved queries')})`
    : `No enabled search queries (${plural(savedCount, 'saved query', 'saved queries')}).`;
}

export function sourceConstraintsSummary(profile, queries = []) {
  if (!profile) {
    return 'No freshness or domain constraints selected.';
  }

  const items = [];
  const activeQueries = enabledQueries(queries);
  const freshnessValues = new Set([
    configuredText(profile.freshness),
    ...activeQueries.map((query) => configuredText(query.freshness)),
  ].filter(Boolean));
  const includeDomains = new Set([
    ...configuredList(profile.includeDomains),
    ...activeQueries.flatMap((query) => configuredList(query.includeDomains)),
  ]);
  const excludeDomains = new Set([
    ...configuredList(profile.excludeDomains),
    ...activeQueries.flatMap((query) => configuredList(query.excludeDomains)),
  ]);

  if (freshnessValues.size > 0) {
    items.push(`freshness ${[...freshnessValues].map(freshnessLabel).join(', ')}`);
  }

  if (includeDomains.size > 0) {
    items.push(`${plural(includeDomains.size, 'included domain')}`);
  }

  if (excludeDomains.size > 0) {
    items.push(`${plural(excludeDomains.size, 'excluded domain')}`);
  }

  return items.length > 0 ? items.join(' | ') : 'No freshness or domain constraints.';
}

export function sourceCredentialSummary(profile) {
  if (!profile) {
    return { status: 'missing', label: 'No story source selected.' };
  }

  const explicit = asObject(profile.credentialStatus);
  if (Object.keys(explicit).length > 0) {
    return {
      status: explicit.available === false ? 'missing' : 'available',
      label: configuredText(explicit.label) || (explicit.available === false ? 'Credential missing.' : 'Credential/config available.'),
      required: Boolean(explicit.required),
    };
  }

  if (profile.type === 'brave') {
    return { status: 'unknown', label: 'Brave credential state not reported by this API response.', required: true };
  }

  if (profile.type === 'zai-web') {
    return { status: 'unknown', label: 'Z.AI Web Search credential state not reported by this API response.', required: true };
  }

  if (profile.type === 'openrouter-perplexity') {
    return { status: 'unknown', label: 'OpenRouter credential state not reported by this API response.', required: true };
  }

  if (profile.type === 'rss') {
    return { status: 'available', label: 'No credential required; feed URL configuration controls availability.', required: false };
  }

  if (profile.type === 'manual') {
    return { status: 'available', label: 'No credential required; paste a source URL when needed.', required: false };
  }

  return {
    status: localJsonConfigured(profile) ? 'available' : 'missing',
    label: localJsonConfigured(profile) ? 'Local JSON import settings present.' : 'Local JSON import settings missing.',
    required: false,
  };
}

export function sourceDiscoveryBlocker(profile, queries = []) {
  if (!profile) {
    return 'Choose a story source/search recipe before discovery.';
  }

  if (profile.enabled === false) {
    return 'Enable this story source before discovery.';
  }

  const credential = sourceCredentialSummary(profile);
  if (credential.required && credential.status === 'missing') {
    return credential.label;
  }

  if (profile.type === 'brave' || profile.type === 'zai-web' || profile.type === 'openrouter-perplexity') {
    return enabledQueries(queries).length > 0 ? '' : 'Add at least one enabled search query before discovery.';
  }

  if (profile.type === 'rss') {
    return enabledQueries(queries).length + rssConfigFeedCount(profile) > 0 ? '' : 'Add at least one RSS feed URL before importing items.';
  }

  if (profile.type === 'manual') {
    return '';
  }

  return 'Local JSON import is not available from the browser workflow yet.';
}

export function sourceActionDescription(profile, queries = []) {
  if (!profile) {
    return 'Choose a Story Source/Search Recipe before finding candidate stories.';
  }

  if (profile.type === 'brave') {
    return `Search Brave with ${sourceInputSummary(profile, queries)} and apply ${sourceConstraintsSummary(profile, queries)}.`;
  }

  if (profile.type === 'zai-web') {
    return `Search Z.AI Web Search with ${sourceInputSummary(profile, queries)} and apply ${sourceConstraintsSummary(profile, queries)}.`;
  }

  if (profile.type === 'openrouter-perplexity') {
    return `Curate Perplexity/Sonar candidates through OpenRouter with ${sourceInputSummary(profile, queries)} and apply ${sourceConstraintsSummary(profile, queries)}.`;
  }

  if (profile.type === 'rss') {
    return `Import RSS items from ${sourceInputSummary(profile, queries)} and apply ${sourceConstraintsSummary(profile, queries)}.`;
  }

  if (profile.type === 'manual') {
    return 'Add a manual URL to create a candidate story with explicit source provenance.';
  }

  return 'Review local JSON settings in the admin source editor before importing candidate stories.';
}

export function sourceLastResultSummary(profile, jobs = []) {
  if (!profile) {
    return 'No source run yet.';
  }

  const selected = asArray(jobs)
    .filter((job) => ['source.search', 'source.ingest'].includes(job?.type))
    .filter((job) => {
      const input = asObject(job.input);
      return input.sourceProfileId === profile.id || input.sourceProfileSlug === profile.slug;
    })
    .sort((left, right) => Date.parse(right.updatedAt || right.finishedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.finishedAt || left.createdAt || 0))[0];

  if (!selected) {
    return 'No source run recorded yet.';
  }

  const output = asObject(selected.output);
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
  const warnings = asArray(output.warnings);
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  }

  return parts.length > 0
    ? `${sourceActionLabel(profile.type)} ${selected.status || 'updated'}: ${parts.join(', ')}.`
    : `${sourceActionLabel(profile.type)} ${selected.status || 'updated'}.`;
}

export function applySourceControlState(root, type) {
  const supported = sourceControlsSupported(type);
  const fields = [
    root.querySelector('[name="freshness"], #profileFreshness'),
    root.querySelector('[name="includeDomains"], #profileIncludeDomains'),
    root.querySelector('[name="excludeDomains"], #profileExcludeDomains'),
  ].filter(Boolean);

  for (const field of fields) {
    field.disabled = !supported;
    if (!supported) {
      field.value = '';
    }
  }

  const help = root.querySelector('[data-source-control-help]');
  if (help) {
    help.textContent = sourceControlHelp(type);
  }
}

export function applySourceControlStateToForms(root, type) {
  for (const form of root.querySelectorAll('form')) {
    applySourceControlState(form, type);
  }
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function maybeNull(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

export function optionalNumber(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? Number(trimmed) : null;
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-{2,}/g, '-');
}

export function roleInfo(role) {
  return MODEL_ROLE_LABELS[role] || {
    title: role.replaceAll('_', ' '),
    description: 'Configured AI role for this show.',
  };
}

export function formatRole(role) {
  return roleInfo(role).title;
}

export function readOnboardingSetting(show, key, fallback = '') {
  const onboarding = asObject(show?.settings?.onboarding);
  return typeof onboarding[key] === 'string' ? onboarding[key] : fallback;
}

export function readPublishingMode(show) {
  return readOnboardingSetting(show, 'publishingMode', 'approval-gated');
}

export function outputPathForFeed(feed) {
  const metadata = asObject(feed?.metadata);
  const storageConfig = asObject(feed?.storageConfig);
  const value = metadata.outputPath || storageConfig.outputPath || feed?.rssFeedPath || '';
  return typeof value === 'string' ? safeVisiblePath(value) : '';
}

export function publicAssetBaseForFeed(feed) {
  const metadata = asObject(feed?.metadata);
  return typeof metadata.publicAssetBaseUrl === 'string' ? metadata.publicAssetBaseUrl : feed?.publicBaseUrl || '';
}

export function validHttpUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function publishTargetConfiguredForFeed(feed) {
  const publicFeedUrl = typeof feed?.publicFeedUrl === 'string' ? feed.publicFeedUrl.trim() : '';
  const publicBaseUrl = publicAssetBaseForFeed(feed);
  const rssFeedPath = typeof feed?.rssFeedPath === 'string' ? feed.rssFeedPath.trim() : '';
  return Boolean(publicFeedUrl || (publicBaseUrl && rssFeedPath));
}

export function safeVisiblePath(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  if (text.startsWith('/') || text.startsWith('~') || /^[A-Za-z]:[\\/]/.test(text)) {
    return '';
  }

  return text;
}

export function sanitizedDebug(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizedDebug);
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|token|password|credential|api.?key|local.?path|private.?key/i.test(key)) {
      result[key] = '[hidden]';
    } else if (typeof item === 'string' && (item.startsWith('/') || item.startsWith('~'))) {
      result[key] = '[hidden local path]';
    } else {
      result[key] = sanitizedDebug(item);
    }
  }

  return result;
}

export function castToLines(cast) {
  return asArray(cast)
    .map((member) => [member.name, member.role || '', member.voice, member.persona || '']
      .filter((part) => part !== '')
      .join(' | '))
    .join('\n');
}

export function linesToCast(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, roleOrVoice, voice, ...personaParts] = line.split('|').map((part) => part.trim());
      const persona = personaParts.join(' | ').trim();
      return {
        name,
        ...(voice ? { role: roleOrVoice } : {}),
        voice: voice || roleOrVoice || name,
        ...(persona ? { persona } : {}),
      };
    });
}
