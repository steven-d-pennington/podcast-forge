import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { feeds, modelProfiles, promptTemplates, shows, sourceProfiles, sourceQueries } from './schema.js';

type ExampleConfig = {
  show: {
    slug: string;
    title: string;
    description?: string;
    format?: string;
    defaultRuntimeMinutes?: number;
    cast?: Array<{ name: string; role?: string; voice: string }>;
  };
  sources: Array<{
    id: string;
    type: 'brave' | 'zai-web' | 'rss' | 'manual' | 'local-json';
    enabled: boolean;
    weight?: number;
    freshness?: string;
    queries?: string[];
    feeds?: string[];
    includeDomains?: string[];
    excludeDomains?: string[];
  }>;
  models: Record<string, {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    params?: Record<string, unknown>;
    fallbacks?: string[];
    promptTemplate?: string;
    budgetUsd?: number;
  }>;
  production: {
    storage?: string;
    rssFeedPath?: string;
    publicBaseUrl?: string;
    op3Wrap?: boolean;
    [key: string]: unknown;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = resolve(__dirname, '../../../config/examples/the-synthetic-lens.json');
const configPath = process.argv[2] ? resolve(process.argv[2]) : defaultConfigPath;

const config = JSON.parse(await readFile(configPath, 'utf8')) as ExampleConfig;
const { db, pool } = createDb();

const defaultPromptTemplates = [
  {
    key: 'candidate_scorer.default',
    role: 'candidate_scorer',
    title: 'Default candidate scorer',
    description: 'Scores one story candidate for editorial fit and source quality.',
    inputVariables: ['show_context', 'source_profile', 'candidate_json'],
    outputSchemaName: 'candidate_score_result',
    body: [
      'Score this possible episode story for an evidence-first podcast.',
      'Prefer primary sources, independent corroboration, public impact, and clear uncertainty.',
      'Show context: {{show_context}}',
      'Source profile: {{source_profile}}',
      'Candidate: {{candidate_json}}',
    ].join('\n\n'),
  },
  {
    key: 'source_summarizer.default',
    role: 'source_summarizer',
    title: 'Default source summarizer',
    description: 'Summarizes one fetched source document with provenance and caveats.',
    inputVariables: ['story_context', 'source_document'],
    outputSchemaName: 'source_summary',
    body: [
      'Summarize this fetched source document without adding facts not present in the source.',
      'Preserve source identity, source type, caveats, and fetch/readability warnings.',
      'Story context: {{story_context}}',
      'Source document: {{source_document}}',
    ].join('\n\n'),
  },
  {
    key: 'claim_extractor.default',
    role: 'claim_extractor',
    title: 'Default claim extractor',
    description: 'Extracts sourced claims with citation references.',
    inputVariables: ['source_summary', 'source_document'],
    outputSchemaName: 'extracted_claims',
    body: [
      'Extract concrete claims that could matter in a podcast script.',
      'Each claim must point to source document ids or URLs and preserve uncertainty labels.',
      'Source summary: {{source_summary}}',
      'Source document: {{source_document}}',
    ].join('\n\n'),
  },
  {
    key: 'research_synthesizer.default',
    role: 'research_synthesizer',
    title: 'Default research synthesizer',
    description: 'Synthesizes source summaries and claims into a research packet draft.',
    inputVariables: ['candidate_json', 'source_summaries', 'claims'],
    outputSchemaName: 'research_synthesis',
    body: [
      'Build an evidence-first research synthesis for an editor.',
      'Represent disagreement, known facts, open questions, source gaps, and review warnings.',
      'Candidate: {{candidate_json}}',
      'Source summaries: {{source_summaries}}',
      'Claims: {{claims}}',
    ].join('\n\n'),
  },
  {
    key: 'script_writer.default',
    role: 'script_writer',
    title: 'Default script writer',
    description: 'Drafts an attributed podcast script from a research packet.',
    inputVariables: ['show_context', 'research_packet', 'format_notes'],
    outputSchemaName: 'script_generation_result',
    body: [
      'Write a podcast script using only the supplied research packet and show context.',
      'Keep factual claims traceable, distinguish facts from analysis, and avoid unsupported certainty.',
      'Show context: {{show_context}}',
      'Research packet: {{research_packet}}',
      'Format notes: {{format_notes}}',
    ].join('\n\n'),
  },
  {
    key: 'script_editor.default',
    role: 'script_editor',
    title: 'Default script editor',
    description: 'Revises a script while preserving citation discipline.',
    inputVariables: ['script_draft', 'research_packet', 'revision_instructions'],
    outputSchemaName: 'script_revision_result',
    body: [
      'Revise the script according to the instructions without adding unsourced claims.',
      'Report what changed, resolved warnings, and remaining warnings.',
      'Script draft: {{script_draft}}',
      'Research packet: {{research_packet}}',
      'Revision instructions: {{revision_instructions}}',
    ].join('\n\n'),
  },
  {
    key: 'metadata_writer.default',
    role: 'metadata_writer',
    title: 'Default metadata writer',
    description: 'Creates accurate publishable episode metadata.',
    inputVariables: ['show_context', 'research_packet', 'script_result'],
    outputSchemaName: 'metadata_result',
    body: [
      'Create episode metadata that is accurate, concise, and not clickbait.',
      'Do not overstate certainty or include claims absent from the research packet.',
      'Show context: {{show_context}}',
      'Research packet: {{research_packet}}',
      'Script result: {{script_result}}',
    ].join('\n\n'),
  },
  {
    key: 'cover_prompt_writer.default',
    role: 'cover_prompt_writer',
    title: 'Default cover prompt writer',
    description: 'Creates a safe cover-art prompt and alt text.',
    inputVariables: ['episode_metadata', 'script_excerpt', 'art_direction'],
    outputSchemaName: 'cover_prompt_result',
    body: [
      'Write a cover-art generation prompt that reflects the topic without misleading viewers.',
      'Avoid depicting real people, logos, copyrighted characters, or unsupported dramatic scenes unless explicitly authorized.',
      'Episode metadata: {{episode_metadata}}',
      'Script excerpt: {{script_excerpt}}',
      'Art direction: {{art_direction}}',
    ].join('\n\n'),
  },
];

function promptInputVariables(names: string[]) {
  return names.map((name) => ({
    name,
    required: true,
  }));
}

try {
  const showConfig = config.show;
  const defaultModelProfile = Object.fromEntries(Object.keys(config.models).map((role) => [role, role]));

  const [show] = await db.insert(shows).values({
    slug: showConfig.slug,
    title: showConfig.title,
    description: showConfig.description,
    setupStatus: 'active',
    format: showConfig.format,
    defaultRuntimeMinutes: showConfig.defaultRuntimeMinutes,
    cast: showConfig.cast ?? [],
    defaultModelProfile,
    settings: { production: config.production }
  }).onConflictDoUpdate({
    target: shows.slug,
    set: {
      title: showConfig.title,
      description: showConfig.description,
      setupStatus: 'active',
      format: showConfig.format,
      defaultRuntimeMinutes: showConfig.defaultRuntimeMinutes,
      cast: showConfig.cast ?? [],
      defaultModelProfile,
      settings: { production: config.production },
      updatedAt: new Date()
    }
  }).returning();

  await db.insert(feeds).values({
    showId: show.id,
    slug: 'main',
    title: show.title,
    description: show.description,
    rssFeedPath: config.production.rssFeedPath,
    publicBaseUrl: config.production.publicBaseUrl,
    storageType: config.production.storage ?? 'local',
    op3Wrap: config.production.op3Wrap ?? false,
    storageConfig: config.production
  }).onConflictDoUpdate({
    target: [feeds.showId, feeds.slug],
    set: {
      title: show.title,
      description: show.description,
      rssFeedPath: config.production.rssFeedPath,
      publicBaseUrl: config.production.publicBaseUrl,
      storageType: config.production.storage ?? 'local',
      op3Wrap: config.production.op3Wrap ?? false,
      storageConfig: config.production,
      updatedAt: new Date()
    }
  });

  for (const [role, model] of Object.entries(config.models)) {
    await db.insert(modelProfiles).values({
      showId: show.id,
      role,
      provider: model.provider,
      model: model.model,
      temperature: model.temperature?.toString(),
      maxTokens: model.maxTokens,
      budgetUsd: model.budgetUsd?.toString(),
      fallbacks: model.fallbacks ?? [],
      promptTemplateKey: model.promptTemplate,
      config: { params: model.params ?? {} }
    }).onConflictDoUpdate({
      target: [modelProfiles.showId, modelProfiles.role],
      set: {
        provider: model.provider,
        model: model.model,
        temperature: model.temperature?.toString(),
        maxTokens: model.maxTokens,
        budgetUsd: model.budgetUsd?.toString(),
        fallbacks: model.fallbacks ?? [],
        promptTemplateKey: model.promptTemplate,
        config: { params: model.params ?? {} },
        updatedAt: new Date()
      }
    });
  }

  for (const prompt of defaultPromptTemplates) {
    await db.insert(promptTemplates).values({
      showId: show.id,
      key: prompt.key,
      version: 1,
      role: prompt.role,
      title: prompt.title,
      body: prompt.body,
      metadata: {
        description: prompt.description,
        inputVariables: promptInputVariables(prompt.inputVariables),
        outputFormat: prompt.description,
        outputSchemaName: prompt.outputSchemaName,
        source: 'seed-default',
      }
    }).onConflictDoUpdate({
      target: [promptTemplates.showId, promptTemplates.key, promptTemplates.version],
      set: {
        role: prompt.role,
        title: prompt.title,
        body: prompt.body,
        metadata: {
          description: prompt.description,
          inputVariables: promptInputVariables(prompt.inputVariables),
          outputFormat: prompt.description,
          outputSchemaName: prompt.outputSchemaName,
          source: 'seed-default',
        },
        updatedAt: new Date()
      }
    });
  }

  for (const source of config.sources) {
    const [profile] = await db.insert(sourceProfiles).values({
      showId: show.id,
      slug: source.id,
      name: source.id,
      type: source.type,
      enabled: source.enabled,
      weight: source.weight?.toString() ?? '1',
      freshness: source.freshness,
      includeDomains: source.includeDomains ?? [],
      excludeDomains: source.excludeDomains ?? [],
      config: {
        feeds: source.feeds ?? []
      }
    }).onConflictDoUpdate({
      target: [sourceProfiles.showId, sourceProfiles.slug],
      set: {
        type: source.type,
        enabled: source.enabled,
        weight: source.weight?.toString() ?? '1',
        freshness: source.freshness,
        includeDomains: source.includeDomains ?? [],
        excludeDomains: source.excludeDomains ?? [],
        config: { feeds: source.feeds ?? [] },
        updatedAt: new Date()
      }
    }).returning();

    for (const query of source.queries ?? []) {
      await db.insert(sourceQueries).values({
        sourceProfileId: profile.id,
        query
      }).onConflictDoNothing({
        target: [sourceQueries.sourceProfileId, sourceQueries.query]
      });
    }
  }

  const sourceCount = await db.select().from(sourceProfiles).where(eq(sourceProfiles.showId, show.id));
  console.log(`Seeded ${show.title} (${show.slug}) with ${sourceCount.length} source profile(s).`);
} finally {
  await pool.end();
}
