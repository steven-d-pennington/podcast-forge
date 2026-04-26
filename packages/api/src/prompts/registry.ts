import type { ModelRole } from '../models/roles.js';
import { DEFAULT_PROMPT_TEMPLATES } from './defaults.js';
import type {
  PromptRegistry,
  PromptTemplate,
  PromptTemplateListFilter,
  PromptTemplateLookup,
  PromptTemplateStore,
} from './types.js';

export interface PromptRegistryOptions {
  defaults?: PromptTemplate[];
  store?: Partial<PromptTemplateStore>;
}

function hasPromptStore(store: Partial<PromptTemplateStore> | undefined): store is PromptTemplateStore {
  return Boolean(
    store
    && typeof store.listPromptTemplates === 'function'
    && typeof store.getPromptTemplateByKey === 'function',
  );
}

function templateId(template: PromptTemplate) {
  return `${template.showId ?? 'global'}:${template.key}:${template.version}`;
}

function bySpecificityAndVersion(a: PromptTemplate, b: PromptTemplate) {
  const showScore = Number(b.showId !== null) - Number(a.showId !== null);

  if (showScore !== 0) {
    return showScore;
  }

  if (b.version !== a.version) {
    return b.version - a.version;
  }

  return a.key.localeCompare(b.key);
}

function matchesDefault(template: PromptTemplate, filter: PromptTemplateListFilter = {}) {
  if (filter.showId && !filter.includeGlobal) {
    return false;
  }

  if (filter.showSlug && !filter.includeGlobal) {
    return false;
  }

  if (filter.role && template.role !== filter.role) {
    return false;
  }

  if (filter.key && template.key !== filter.key) {
    return false;
  }

  return true;
}

function matchingDefaults(defaults: PromptTemplate[], filter: PromptTemplateListFilter = {}) {
  return defaults.filter((template) => matchesDefault(template, filter));
}

export function createPromptRegistry(options: PromptRegistryOptions = {}): PromptRegistry {
  const defaults = options.defaults ?? DEFAULT_PROMPT_TEMPLATES;
  const store = hasPromptStore(options.store) ? options.store : undefined;

  return {
    async listTemplates(filter = {}) {
      const stored = store ? await store.listPromptTemplates(filter) : [];
      const seen = new Set(stored.map(templateId));
      const fallback = matchingDefaults(defaults, filter).filter((template) => !seen.has(templateId(template)));

      return [...stored, ...fallback].sort(bySpecificityAndVersion);
    },

    async getTemplateByKey(key: string, lookup: PromptTemplateLookup = {}) {
      const stored = store ? await store.getPromptTemplateByKey(key, lookup) : undefined;

      if (stored) {
        return stored;
      }

      return matchingDefaults(defaults, {
        key,
        showId: lookup.showId,
        showSlug: lookup.showSlug,
        includeGlobal: lookup.includeGlobal ?? true,
      })
        .filter((template) => lookup.version === undefined || template.version === lookup.version)
        .sort(bySpecificityAndVersion)[0];
    },

    async getTemplateByRole(role: ModelRole, lookup: PromptTemplateLookup = {}) {
      const templates = await this.listTemplates({
        role,
        showId: lookup.showId,
        showSlug: lookup.showSlug,
        includeGlobal: lookup.includeGlobal ?? true,
      });

      return templates
        .filter((template) => lookup.version === undefined || template.version === lookup.version)
        .sort(bySpecificityAndVersion)[0];
    },
  };
}

export function defaultPromptKey(role: ModelRole) {
  return `${role}.default`;
}
