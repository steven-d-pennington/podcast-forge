import { MODEL_ROLE_LABELS } from './ui-constants.js';

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
  return type === 'brave' || type === 'rss';
}

export function sourceControlHelp(type) {
  if (type === 'brave') {
    return 'Freshness is sent to Brave. Domain filters are enforced after results return.';
  }

  if (type === 'rss') {
    return 'Domain filters are enforced on item URLs. Freshness is checked when feed items include published dates.';
  }

  return 'Freshness and domain filters are not applied for manual or local JSON sources.';
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
  const metadata = asObject(feed.metadata);
  const storageConfig = asObject(feed.storageConfig);
  const value = metadata.outputPath || storageConfig.outputPath || feed.rssFeedPath || '';
  return typeof value === 'string' ? safeVisiblePath(value) : '';
}

export function publicAssetBaseForFeed(feed) {
  const metadata = asObject(feed.metadata);
  return typeof metadata.publicAssetBaseUrl === 'string' ? metadata.publicAssetBaseUrl : feed.publicBaseUrl || '';
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
    .map((member) => [member.name, member.role || '', member.voice].filter((part) => part !== '').join(' | '))
    .join('\n');
}

export function linesToCast(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, roleOrVoice, voice] = line.split('|').map((part) => part.trim());
      return {
        name,
        ...(voice ? { role: roleOrVoice } : {}),
        voice: voice || roleOrVoice || name,
      };
    });
}
