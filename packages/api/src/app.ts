import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyServerOptions } from 'fastify';

import {
  ConfigLoadError,
  loadConfigFromFile,
  loadExampleConfig,
  validateConfig,
} from './config/loader.js';
import { createDbSourceStore } from './sources/db-store.js';
import { registerShowRoutes } from './shows/routes.js';
import { registerSourceRoutes } from './sources/routes.js';
import type { SourceProfileRecord, SourceQueryRecord, SourceStore } from './sources/store.js';
import { registerModelRoutes } from './models/routes.js';
import type { ModelProfileStore } from './models/store.js';
import { registerPromptRoutes } from './prompts/routes.js';
import type { PromptTemplateStore } from './prompts/types.js';
import { registerEpisodePlanningRoutes } from './planning/routes.js';
import { registerResearchRoutes, type ResearchCorroborationSearchRunner } from './research/routes.js';
import type { ResearchFetch } from './research/fetch.js';
import type { ResearchModelServices } from './research/models.js';
import type { ResearchStore } from './research/store.js';
import { registerScriptRoutes } from './scripts/routes.js';
import type { ScriptStore } from './scripts/store.js';
import type { AudioFinalProvider, AudioPreviewProvider, CoverArtProvider } from './production/providers.js';
import type { PublishStorageAdapter, PublishUrlValidator, RssUpdateAdapter } from './production/publishing.js';
import { registerProductionRoutes } from './production/routes.js';
import type { FeedRecord, ProductionStore } from './production/store.js';
import { registerSearchRoutes } from './search/routes.js';
import { runSourceSearch } from './search/job.js';
import type { BraveFetch } from './search/brave.js';
import type { RssFetch } from './search/rss.js';
import type { CandidateScorer } from './search/scoring.js';
import type { SearchJobStore } from './search/store.js';
import type { ZaiWebFetch } from './search/zai-web.js';
import type { OpenRouterPerplexityFetch } from './search/openrouter-perplexity.js';
import type { LlmRuntime } from './llm/types.js';
import { registerSchedulerRoutes } from './scheduler/routes.js';
import type { SchedulerStore } from './scheduler/store.js';
import { registerLegacyImportRoutes } from './import/routes.js';

interface ConfigQuery {
  path?: string;
}

interface BuildAppOptions extends FastifyServerOptions {
  sourceStore?: SourceStore
    & Partial<SearchJobStore>
    & Partial<ResearchStore>
    & Partial<ModelProfileStore>
    & Partial<PromptTemplateStore>
    & Partial<ScriptStore>
    & Partial<ProductionStore>
    & Partial<SchedulerStore>;
  braveApiKey?: string;
  zaiApiKey?: string;
  openRouterApiKey?: string;
  fetchImpl?: BraveFetch;
  zaiFetchImpl?: ZaiWebFetch;
  openRouterPerplexityFetchImpl?: OpenRouterPerplexityFetch;
  rssFetchImpl?: RssFetch;
  candidateScorer?: CandidateScorer;
  llmRuntime?: LlmRuntime;
  researchModelServices?: ResearchModelServices;
  researchFetchImpl?: ResearchFetch;
  corroborationSearchRunner?: ResearchCorroborationSearchRunner;
  audioPreviewProvider?: AudioPreviewProvider;
  audioFinalProvider?: AudioFinalProvider;
  coverArtProvider?: CoverArtProvider;
  publishStorageAdapterFactory?: (feed: FeedRecord) => PublishStorageAdapter;
  rssUpdateAdapter?: RssUpdateAdapter;
  publishUrlValidator?: PublishUrlValidator;
  sleep?: (ms: number) => Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readPublicFile(fileName: string) {
  const candidates = [
    resolve(process.cwd(), 'packages/api/public', fileName),
    resolve(process.cwd(), 'public', fileName),
    resolve(__dirname, '../public', fileName),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`Public asset not found: ${fileName}`);
}

function canRunSourceSearch(store: unknown): store is SourceStore & SearchJobStore {
  const candidate = store as Record<string, unknown>;
  return typeof candidate.listSourceProfiles === 'function'
    && typeof candidate.listSourceQueries === 'function'
    && typeof candidate.createJob === 'function'
    && typeof candidate.updateJob === 'function'
    && typeof candidate.insertStoryCandidate === 'function'
    && typeof candidate.listStoryCandidateDedupeKeys === 'function';
}

function sourceSearchPriority(profile: SourceProfileRecord): number {
  return profile.type === 'brave' ? 0 : profile.type === 'zai-web' ? 1 : profile.type === 'openrouter-perplexity' ? 2 : 99;
}

function sourceSearchApiKey(profile: SourceProfileRecord, options: BuildAppOptions): string | undefined {
  if (profile.type === 'brave') return options.braveApiKey ?? process.env.BRAVE_API_KEY;
  if (profile.type === 'zai-web') {
    return options.zaiApiKey ?? process.env.ZAI_API_KEY ?? process.env.GLM_API_KEY ?? process.env.GLM_API ?? process.env.ZHIPU_API_KEY ?? process.env.ZHIPUAI_API_KEY;
  }
  if (profile.type === 'openrouter-perplexity') return options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY;
  return undefined;
}

function adHocCorroborationQuery(
  profile: SourceProfileRecord,
  template: SourceQueryRecord,
  request: Parameters<ResearchCorroborationSearchRunner>[0],
): SourceQueryRecord {
  const now = new Date();
  const excludeDomains = [...new Set([
    ...(template.excludeDomains ?? []),
    ...request.excludeDomains,
  ].map((domain) => domain.trim()).filter(Boolean))];

  return {
    id: 'ad-hoc-research-corroboration',
    sourceProfileId: profile.id,
    query: request.query,
    enabled: true,
    weight: template.weight ?? 1,
    region: template.region ?? null,
    language: template.language ?? null,
    freshness: template.freshness ?? null,
    includeDomains: [],
    excludeDomains,
    config: {
      ...(template.config ?? {}),
      adHoc: true,
      purpose: request.purpose,
    },
    createdAt: template.createdAt ?? now,
    updatedAt: now,
  };
}

export function buildApp(options: BuildAppOptions = {}) {
  const {
    sourceStore,
    braveApiKey,
    zaiApiKey,
    openRouterApiKey,
    fetchImpl,
    zaiFetchImpl,
    openRouterPerplexityFetchImpl,
    rssFetchImpl,
    candidateScorer,
    llmRuntime,
    researchModelServices,
    researchFetchImpl,
    corroborationSearchRunner,
    audioPreviewProvider,
    audioFinalProvider,
    coverArtProvider,
    publishStorageAdapterFactory,
    rssUpdateAdapter,
    publishUrlValidator,
    sleep,
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);
  let resolvedSourceStore: SourceStore
    & Partial<SearchJobStore>
    & Partial<ResearchStore>
    & Partial<ModelProfileStore>
    & Partial<PromptTemplateStore>
    & Partial<ScriptStore>
    & Partial<ProductionStore>
    & Partial<SchedulerStore>
    | undefined = sourceStore;

  const effectiveCorroborationSearchRunner: ResearchCorroborationSearchRunner | undefined = corroborationSearchRunner ?? (async (request) => {
    resolvedSourceStore ??= createDbSourceStore();
    const store = resolvedSourceStore;
    if (!canRunSourceSearch(store)) {
      return { status: 'skipped', query: request.query, excludeDomains: request.excludeDomains, error: 'Source search store is unavailable.' };
    }

    const profiles = (await store.listSourceProfiles({ showId: request.showId }))
      .filter((profile) => profile.enabled && ['brave', 'zai-web', 'openrouter-perplexity'].includes(profile.type))
      .sort((a, b) => sourceSearchPriority(a) - sourceSearchPriority(b));

    for (const profile of profiles) {
      const apiKey = sourceSearchApiKey(profile, options);
      if (!apiKey) continue;

      const template = (await store.listSourceQueries(profile.id)).find((query) => query.enabled);
      if (!template) continue;

      const query = adHocCorroborationQuery(profile, template, request);
      const result = await runSourceSearch({
        apiKey,
        profile,
        queries: [query],
        store,
        fetchImpl,
        zaiFetchImpl,
        openRouterPerplexityFetchImpl,
        candidateScorer,
        sleep,
      });

      return {
        status: 'succeeded',
        query: request.query,
        excludeDomains: query.excludeDomains,
        inserted: result.inserted,
        skipped: result.skipped,
        jobId: result.job.id,
        sourceProfileId: profile.id,
        sourceProfileType: profile.type,
      };
    }

    return { status: 'skipped', query: request.query, excludeDomains: request.excludeDomains, error: 'No enabled search-capable source profile with credentials and enabled query.' };
  });

  app.get('/health', async () => ({ ok: true, service: 'podcast-forge-api' }));

  app.get('/', async (_request, reply) => {
    return reply.type('text/html').send(await readPublicFile('index.html'));
  });

  app.get('/ui', async (_request, reply) => {
    return reply.header('cache-control', 'no-store').type('text/html').send(await readPublicFile('index.html'));
  });

  const uiScriptFiles = ['ui.js', 'ui-api.js', 'ui-constants.js', 'ui-formatters.js', 'ui-state.js', 'ui-view-model.js'];

  for (const file of uiScriptFiles) {
    app.get(`/${file}`, async (_request, reply) => {
      return reply.header('cache-control', 'no-store').type('application/javascript').send(await readPublicFile(file));
    });
  }

  app.get('/styles.css', async (_request, reply) => {
    return reply.type('text/css').send(await readPublicFile('styles.css'));
  });

  app.get('/config/example', async () => loadExampleConfig());

  app.post('/config/validate', async (request) => {
    const result = await validateConfig(request.body);

    if (result.ok) {
      return { ok: true };
    }

    return { ok: false, errors: result.errors };
  });

  app.get<{ Querystring: ConfigQuery }>('/config', async (request, reply) => {
    const configPath = request.query.path;

    if (!configPath) {
      return reply.code(400).send({
        ok: false,
        code: 'CONFIG_PATH_REQUIRED',
        error: 'Missing required query parameter: path',
      });
    }

    try {
      const result = await loadConfigFromFile(configPath);

      return { ok: true, path: result.path, config: result.config };
    } catch (error) {
      if (error instanceof ConfigLoadError) {
        const statusCode = error.code === 'CONFIG_FILE_NOT_FOUND' ? 404 : 400;

        return reply.code(statusCode).send({
          ok: false,
          code: error.code,
          error: error.message,
          errors: error.errors,
        });
      }

      throw error;
    }
  });

  registerSourceRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    sourceCredentialStatus: {
      brave: Boolean(braveApiKey ?? process.env.BRAVE_API_KEY),
      'zai-web': Boolean(
        zaiApiKey
        ?? process.env.ZAI_API_KEY
        ?? process.env.GLM_API_KEY
        ?? process.env.GLM_API
        ?? process.env.ZHIPU_API_KEY
        ?? process.env.ZHIPUAI_API_KEY,
      ),
      'openrouter-perplexity': Boolean(openRouterApiKey ?? process.env.OPENROUTER_API_KEY),
    },
  });

  registerShowRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
  });

  registerModelRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
  });

  registerPromptRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
  });

  registerSearchRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    braveApiKey,
    zaiApiKey,
    openRouterApiKey,
    fetchImpl,
    zaiFetchImpl,
    openRouterPerplexityFetchImpl,
    rssFetchImpl,
    candidateScorer,
    llmRuntime,
    sleep,
  });

  registerEpisodePlanningRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    llmRuntime,
  });

  registerResearchRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    fetchImpl: researchFetchImpl,
    llmRuntime,
    researchModelServices,
    corroborationSearchRunner: effectiveCorroborationSearchRunner,
  });

  registerScriptRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    llmRuntime,
  });

  registerProductionRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    llmRuntime,
    audioPreviewProvider,
    audioFinalProvider,
    coverArtProvider,
    publishStorageAdapterFactory,
    rssUpdateAdapter,
    publishUrlValidator,
  });

  registerSchedulerRoutes(app, {
    getStore() {
      resolvedSourceStore ??= createDbSourceStore();
      return resolvedSourceStore;
    },
    braveApiKey,
    fetchImpl,
    rssFetchImpl,
    sleep,
  });

  registerLegacyImportRoutes(app);

  app.addHook('onClose', async () => {
    if (resolvedSourceStore && resolvedSourceStore !== sourceStore && resolvedSourceStore.close) {
      await resolvedSourceStore.close();
    }
  });

  return app;
}
