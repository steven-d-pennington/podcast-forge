import { existsSync } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  createDb,
  episodeAssets,
  episodes,
  feeds,
  jobs,
  publishEvents,
  shows,
  sourceProfiles,
  storyCandidates,
  type Database,
} from '@podcast-forge/db';

import { canonicalizeUrl, cleanText, normalizeTitle } from '../search/candidate.js';

const TSL_IMPORT_SOURCE = 'legacy-tsl';
const BYTE_IMPORT_SOURCE = 'legacy-byte-sized';

type JsonObject = Record<string, unknown>;

export interface LegacyImportOptions {
  showSlug?: string;
  tslStoriesPath?: string;
  tslEpisodesPath?: string;
  byteRawDir?: string;
  byteRankedDir?: string;
  connectionString?: string;
}

export interface LegacyImportSummary {
  showSlug: string;
  candidates: {
    inserted: number;
    updated: number;
    skipped: number;
  };
  episodes: {
    inserted: number;
    updated: number;
    assets: number;
    publishEvents: number;
  };
  sourceRuns: {
    inserted: number;
    updated: number;
  };
}

interface NormalizedCandidate {
  importKey: string;
  title: string;
  url: string;
  canonicalUrl: string;
  sourceName: string | null;
  summary: string | null;
  discoveredAt: Date;
  publishedAt: Date | null;
  score: number | null;
  scoreBreakdown: JsonObject;
  rawPayload: JsonObject;
  metadata: JsonObject;
}

interface LegacyEpisode {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  status?: unknown;
  storyIds?: unknown;
  approvedSourceIds?: unknown;
  scriptPath?: unknown;
  audioPath?: unknown;
  feedUrl?: unknown;
  notes?: unknown;
  approvedForProduction?: unknown;
  titleSuggestions?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  duplicateGroups?: unknown;
  researchQuality?: unknown;
  previewAudio?: unknown;
  previewArt?: unknown;
  coverPath?: unknown;
  publishedAt?: unknown;
  episodeNum?: unknown;
  publicAudioUrl?: unknown;
  publicCoverUrl?: unknown;
  feedGuid?: unknown;
  [key: string]: unknown;
}

interface EpisodeAssetInput {
  type: 'script' | 'audio-preview' | 'audio-final' | 'cover-art' | 'research-packet';
  label: string;
  localPath: string | null;
  publicUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  durationSeconds: number | null;
  metadata: JsonObject;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);

  return slug || 'legacy-episode';
}

function defaultLegacyPath(relativePath: string) {
  const candidates = [
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), '..', relativePath),
    resolve(process.cwd(), '..', '..', relativePath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function defaultPaths(options: LegacyImportOptions) {
  return {
    showSlug: options.showSlug ?? 'the-synthetic-lens',
    tslStoriesPath: options.tslStoriesPath ? resolve(options.tslStoriesPath) : defaultLegacyPath('../tsl-command-center/data/stories.json'),
    tslEpisodesPath: options.tslEpisodesPath ? resolve(options.tslEpisodesPath) : defaultLegacyPath('../tsl-command-center/data/episodes.json'),
    byteRawDir: options.byteRawDir ? resolve(options.byteRawDir) : defaultLegacyPath('../byte-sized/raw'),
    byteRankedDir: options.byteRankedDir ? resolve(options.byteRankedDir) : defaultLegacyPath('../byte-sized/output'),
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function optionalFileSize(path: string | null) {
  if (!path) {
    return null;
  }

  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function optionalText(path: string | null) {
  if (!path) {
    return null;
  }

  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function mimeType(path: string | null) {
  const extension = path ? extname(path).toLowerCase() : '';

  if (extension === '.txt') {
    return 'text/plain';
  }

  if (extension === '.json') {
    return 'application/json';
  }

  if (extension === '.mp3') {
    return 'audio/mpeg';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  return null;
}

function candidateUrl(input: JsonObject, importKey: string) {
  const url = asString(input.url);
  return url ?? `legacy:${importKey}`;
}

function candidateTitle(input: JsonObject, fallback: string) {
  return cleanText(asString(input.title) ?? fallback);
}

export function normalizeLegacyStory(input: unknown, index: number, importedAt = new Date()): NormalizedCandidate | null {
  const story = asObject(input);
  const legacyId = asString(story.id) ?? `story-${index + 1}`;
  const importKey = `${TSL_IMPORT_SOURCE}:story:${legacyId}`;
  const url = candidateUrl(story, importKey);
  const score = asNumber(story.score ?? asObject(story.raw).score);
  const raw = asObject(story.raw);

  return {
    importKey,
    title: candidateTitle(story, legacyId),
    url,
    canonicalUrl: canonicalizeUrl(url),
    sourceName: asString(story.source) ?? asString(raw.source),
    summary: asString(story.description) ?? asString(raw.description) ?? asString(raw.one_liner),
    discoveredAt: parseDate(story.discoveredAt) ?? importedAt,
    publishedAt: parseDate(story.publishedAt),
    score,
    scoreBreakdown: {
      legacyScore: score,
      origin: asString(story.origin) ?? asString(raw.origin),
      category: asString(raw.category),
    },
    rawPayload: story,
    metadata: {
      importedFrom: TSL_IMPORT_SOURCE,
      importKey,
      legacyId,
      origin: asString(story.origin) ?? asString(raw.origin),
      tags: asArray(story.tags),
      notes: asString(story.notes),
      query: asString(raw.query),
      ranked: asArray(story.tags).includes('ranked') || asString(raw.origin) === 'byte-sized-ranked',
      normalizedTitle: normalizeTitle(candidateTitle(story, legacyId)),
    },
  };
}

export function normalizeByteArticle(
  input: unknown,
  date: string,
  source: 'raw' | 'ranked',
  rankedByUrl = new Map<string, JsonObject>(),
  index = 0,
): NormalizedCandidate | null {
  const article = asObject(input);
  const importKey = `${BYTE_IMPORT_SOURCE}:${date}:${source}:${asString(article.url) ?? index}`;
  const url = candidateUrl(article, importKey);
  const canonicalUrl = canonicalizeUrl(url);
  const ranked = rankedByUrl.get(canonicalUrl);
  const score = asNumber(ranked?.score ?? article.score);
  const title = candidateTitle(ranked ?? article, `Byte Sized ${date} article ${index + 1}`);
  const summary = asString(ranked?.one_liner)
    ?? asString(ranked?.description)
    ?? asString(article.description);

  return {
    importKey,
    title,
    url,
    canonicalUrl,
    sourceName: asString(ranked?.source) ?? asString(article.source),
    summary,
    discoveredAt: parseDate(`${date}T12:00:00Z`) ?? new Date(),
    publishedAt: null,
    score,
    scoreBreakdown: {
      legacyScore: score,
      category: asString(ranked?.category ?? article.category),
      ranked: Boolean(ranked || source === 'ranked'),
      rawDate: date,
    },
    rawPayload: {
      article,
      ranked,
    },
    metadata: {
      importedFrom: BYTE_IMPORT_SOURCE,
      importKey,
      date,
      query: asString(ranked?.query) ?? asString(article.query),
      age: asString(ranked?.age) ?? asString(article.age),
      category: asString(ranked?.category ?? article.category),
      ranked: Boolean(ranked || source === 'ranked'),
      normalizedTitle: normalizeTitle(title),
    },
  };
}

export function legacyEpisodeSlug(input: LegacyEpisode) {
  const publicAudioUrl = asString(input.publicAudioUrl);

  if (publicAudioUrl) {
    const fileName = basename(new URL(publicAudioUrl).pathname).replace(/\.[a-z0-9]+$/i, '');
    if (fileName) {
      return slugify(fileName);
    }
  }

  return slugify(asString(input.id) ?? asString(input.title) ?? 'legacy-episode');
}

export function mapLegacyEpisodeStatus(input: LegacyEpisode) {
  const status = asString(input.status);
  const previewAudio = asObject(input.previewAudio);

  if (status === 'published') {
    return 'published' as const;
  }

  if (asString(previewAudio.status) === 'ready' || asString(input.audioPath)) {
    return 'audio-ready' as const;
  }

  if (asBoolean(input.approvedForProduction)) {
    return 'approved-for-audio' as const;
  }

  if (status === 'scripted' || asString(input.scriptPath)) {
    return 'script-ready' as const;
  }

  return 'draft' as const;
}

function warningRecords(input: LegacyEpisode) {
  const quality = asObject(input.researchQuality);
  const findings = asArray(quality.findings).filter((item): item is string => typeof item === 'string');
  const overridden = quality.overridden === true;

  return findings.map((message, index) => ({
    id: `legacy-research-${index + 1}`,
    code: 'LEGACY_RESEARCH_WARNING',
    message,
    override: overridden ? {
      reason: asString(quality.overrideReason),
      overriddenAt: asString(quality.overrideAt),
    } : undefined,
  }));
}

async function episodeAssetsFromLegacy(input: LegacyEpisode, tslEpisodesPath: string): Promise<EpisodeAssetInput[]> {
  const assets: EpisodeAssetInput[] = [];
  const legacyId = asString(input.id) ?? 'legacy-episode';
  const scriptPath = asString(input.scriptPath);
  const audioPath = asString(input.audioPath) ?? asString(asObject(input.previewAudio).mp3Path);
  const coverPath = asString(input.coverPath) ?? asString(asObject(input.previewArt).pngPath) ?? asString(asObject(input.previewArt).imagePath);
  const researchPath = join(resolve(tslEpisodesPath, '..'), 'research-packets', `${legacyId}.json`);

  if (scriptPath) {
    assets.push({
      type: 'script',
      label: 'Legacy script',
      localPath: scriptPath,
      publicUrl: null,
      mimeType: mimeType(scriptPath),
      byteSize: await optionalFileSize(scriptPath),
      durationSeconds: null,
      metadata: { importedFrom: TSL_IMPORT_SOURCE, importKey: `${TSL_IMPORT_SOURCE}:${legacyId}:script` },
    });
  }

  if (audioPath || asString(input.publicAudioUrl)) {
    assets.push({
      type: asString(input.publicAudioUrl) || asString(input.status) === 'published' ? 'audio-final' : 'audio-preview',
      label: asString(input.status) === 'published' ? 'Legacy published audio' : 'Legacy preview audio',
      localPath: audioPath,
      publicUrl: asString(input.publicAudioUrl),
      mimeType: mimeType(audioPath) ?? 'audio/mpeg',
      byteSize: await optionalFileSize(audioPath),
      durationSeconds: null,
      metadata: {
        importedFrom: TSL_IMPORT_SOURCE,
        importKey: `${TSL_IMPORT_SOURCE}:${legacyId}:audio`,
        previewAudio: asObject(input.previewAudio),
      },
    });
  }

  if (coverPath || asString(input.publicCoverUrl)) {
    assets.push({
      type: 'cover-art',
      label: 'Legacy cover art',
      localPath: coverPath,
      publicUrl: asString(input.publicCoverUrl),
      mimeType: mimeType(coverPath) ?? 'image/png',
      byteSize: await optionalFileSize(coverPath),
      durationSeconds: null,
      metadata: {
        importedFrom: TSL_IMPORT_SOURCE,
        importKey: `${TSL_IMPORT_SOURCE}:${legacyId}:cover`,
        previewArt: asObject(input.previewArt),
      },
    });
  }

  if (await exists(researchPath)) {
    assets.push({
      type: 'research-packet',
      label: 'Legacy research packet',
      localPath: researchPath,
      publicUrl: null,
      mimeType: 'application/json',
      byteSize: await optionalFileSize(researchPath),
      durationSeconds: null,
      metadata: { importedFrom: TSL_IMPORT_SOURCE, importKey: `${TSL_IMPORT_SOURCE}:${legacyId}:research-packet` },
    });
  }

  return assets;
}

async function ensureSourceProfile(db: Database, showId: string, slug: string, name: string) {
  const [profile] = await db.insert(sourceProfiles).values({
    showId,
    slug,
    name,
    type: 'local-json',
    enabled: true,
    weight: '1',
    freshness: null,
    includeDomains: [],
    excludeDomains: [],
    rateLimit: {},
    config: {
      importedFrom: slug,
    },
  }).onConflictDoUpdate({
    target: [sourceProfiles.showId, sourceProfiles.slug],
    set: {
      name,
      type: 'local-json',
      enabled: true,
      config: {
        importedFrom: slug,
      },
      updatedAt: new Date(),
    },
  }).returning();

  return profile;
}

async function upsertCandidate(db: Database, showId: string, sourceProfileId: string, candidate: NormalizedCandidate) {
  const [existing] = await db.select({ id: storyCandidates.id })
    .from(storyCandidates)
    .where(and(eq(storyCandidates.showId, showId), eq(storyCandidates.canonicalUrl, candidate.canonicalUrl)))
    .limit(1);

  await db.insert(storyCandidates).values({
    showId,
    sourceProfileId,
    sourceQueryId: null,
    title: candidate.title,
    url: candidate.url,
    canonicalUrl: candidate.canonicalUrl,
    sourceName: candidate.sourceName,
    summary: candidate.summary,
    discoveredAt: candidate.discoveredAt,
    publishedAt: candidate.publishedAt,
    score: candidate.score?.toString(),
    scoreBreakdown: candidate.scoreBreakdown,
    status: 'new',
    rawPayload: candidate.rawPayload,
    metadata: candidate.metadata,
  }).onConflictDoUpdate({
    target: [storyCandidates.showId, storyCandidates.canonicalUrl],
    set: {
      title: candidate.title,
      url: candidate.url,
      sourceProfileId,
      sourceName: candidate.sourceName,
      summary: candidate.summary,
      discoveredAt: candidate.discoveredAt,
      publishedAt: candidate.publishedAt,
      score: candidate.score?.toString(),
      scoreBreakdown: candidate.scoreBreakdown,
      rawPayload: candidate.rawPayload,
      metadata: candidate.metadata,
      updatedAt: new Date(),
    },
  });

  return existing ? 'updated' : 'inserted';
}

async function upsertImportJob(
  db: Database,
  showId: string,
  importKey: string,
  input: JsonObject,
  output: JsonObject,
) {
  const existingJobs = await db.select()
    .from(jobs)
    .where(and(eq(jobs.showId, showId), eq(jobs.type, 'source.import')))
    .orderBy(desc(jobs.createdAt))
    .limit(500);
  const existing = existingJobs.find((job) => asObject(job.input).importKey === importKey);
  const finishedAt = new Date();

  if (existing) {
    await db.update(jobs).set({
      status: 'succeeded',
      progress: 100,
      attempts: existing.attempts + 1,
      input,
      output,
      logs: [{
        at: finishedAt.toISOString(),
        level: 'info',
        message: 'Refreshed legacy source import run.',
      }],
      error: null,
      finishedAt,
      updatedAt: finishedAt,
    }).where(eq(jobs.id, existing.id));

    return 'updated';
  }

  await db.insert(jobs).values({
    showId,
    type: 'source.import',
    status: 'succeeded',
    progress: 100,
    attempts: 1,
    input,
    output,
    logs: [{
      at: finishedAt.toISOString(),
      level: 'info',
      message: 'Imported legacy source run.',
    }],
    startedAt: finishedAt,
    finishedAt,
  });

  return 'inserted';
}

async function importTslStories(db: Database, showId: string, path: string, importedAt: Date) {
  const profile = await ensureSourceProfile(db, showId, 'legacy-tsl-stories', 'Legacy TSL stories');
  const data = await readJsonFile(path);
  const stories = asArray(data);
  const summary = { inserted: 0, updated: 0, skipped: 0 };

  for (const [index, story] of stories.entries()) {
    const candidate = normalizeLegacyStory(story, index, importedAt);

    if (!candidate) {
      summary.skipped += 1;
      continue;
    }

    const result = await upsertCandidate(db, showId, profile.id, candidate);
    summary[result] += 1;
  }

  return summary;
}

async function importByteSized(db: Database, showId: string, rawDir: string, rankedDir: string) {
  const profile = await ensureSourceProfile(db, showId, 'legacy-byte-sized', 'Legacy Byte Sized');
  const files = (await readdir(rawDir))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();
  const candidates = { inserted: 0, updated: 0, skipped: 0 };
  const sourceRuns = { inserted: 0, updated: 0 };

  for (const file of files) {
    const date = file.replace(/\.json$/, '');
    const rawPath = join(rawDir, file);
    const rankedPath = join(rankedDir, `${date}-ranked.json`);
    const raw = asObject(await readJsonFile(rawPath));
    const ranked = await exists(rankedPath) ? asObject(await readJsonFile(rankedPath)) : {};
    const rawArticles = asArray(raw.articles);
    const rankedStories = asArray(ranked.stories);
    const rankedByUrl = new Map<string, JsonObject>();
    const seenUrls = new Set<string>();

    for (const story of rankedStories) {
      const object = asObject(story);
      const url = asString(object.url);

      if (url) {
        rankedByUrl.set(canonicalizeUrl(url), object);
      }
    }

    for (const [index, article] of rawArticles.entries()) {
      const candidate = normalizeByteArticle(article, date, 'raw', rankedByUrl, index);

      if (!candidate) {
        candidates.skipped += 1;
        continue;
      }

      seenUrls.add(candidate.canonicalUrl);
      const result = await upsertCandidate(db, showId, profile.id, candidate);
      candidates[result] += 1;
    }

    for (const [index, story] of rankedStories.entries()) {
      const object = asObject(story);
      const url = asString(object.url);
      const canonicalUrl = url ? canonicalizeUrl(url) : null;

      if (canonicalUrl && seenUrls.has(canonicalUrl)) {
        continue;
      }

      const candidate = normalizeByteArticle(story, date, 'ranked', rankedByUrl, index);

      if (!candidate) {
        candidates.skipped += 1;
        continue;
      }

      const result = await upsertCandidate(db, showId, profile.id, candidate);
      candidates[result] += 1;
    }

    const jobResult = await upsertImportJob(db, showId, `${BYTE_IMPORT_SOURCE}:${date}`, {
      importKey: `${BYTE_IMPORT_SOURCE}:${date}`,
      sourceProfileId: profile.id,
      rawPath,
      rankedPath: await exists(rankedPath) ? rankedPath : null,
    }, {
      date,
      rawCount: rawArticles.length,
      rankedCount: rankedStories.length,
      importedFrom: BYTE_IMPORT_SOURCE,
    });
    sourceRuns[jobResult] += 1;
  }

  return { candidates, sourceRuns };
}

async function upsertLegacyEpisode(
  db: Database,
  showId: string,
  feedId: string | null,
  input: LegacyEpisode,
  tslEpisodesPath: string,
) {
  const legacyId = asString(input.id) ?? legacyEpisodeSlug(input);
  const slug = legacyEpisodeSlug(input);
  const scriptPath = asString(input.scriptPath);
  const scriptText = await optionalText(scriptPath);
  const createdAt = parseDate(input.createdAt) ?? new Date();
  const updatedAt = parseDate(input.updatedAt) ?? createdAt;
  const publishedAt = parseDate(input.publishedAt);
  const episodeNumber = asNumber(input.episodeNum);
  const metadata = {
    importedFrom: TSL_IMPORT_SOURCE,
    importKey: `${TSL_IMPORT_SOURCE}:episode:${legacyId}`,
    legacyId,
    legacyType: asString(input.type),
    legacyStatus: asString(input.status),
    storyIds: asArray(input.storyIds),
    approvedSourceIds: asArray(input.approvedSourceIds),
    approvedForProduction: asBoolean(input.approvedForProduction),
    titleSuggestions: asArray(input.titleSuggestions),
    duplicateGroups: asArray(input.duplicateGroups),
    researchQuality: asObject(input.researchQuality),
    feedUrl: asString(input.feedUrl),
    publicAudioUrl: asString(input.publicAudioUrl),
    publicCoverUrl: asString(input.publicCoverUrl),
    previewAudio: asObject(input.previewAudio),
    previewArt: asObject(input.previewArt),
  };
  const [existing] = await db.select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.slug, slug)))
    .limit(1);
  const [episode] = await db.insert(episodes).values({
    showId,
    feedId,
    slug,
    title: asString(input.title) ?? legacyId,
    description: asString(input.notes),
    episodeNumber,
    status: mapLegacyEpisodeStatus(input),
    scriptText,
    scriptFormat: asString(input.type),
    durationSeconds: null,
    publishedAt,
    feedGuid: asString(input.feedGuid),
    warnings: warningRecords(input),
    metadata,
    createdAt,
    updatedAt,
  }).onConflictDoUpdate({
    target: [episodes.showId, episodes.slug],
    set: {
      feedId,
      title: asString(input.title) ?? legacyId,
      description: asString(input.notes),
      episodeNumber,
      status: mapLegacyEpisodeStatus(input),
      scriptText,
      scriptFormat: asString(input.type),
      publishedAt,
      feedGuid: asString(input.feedGuid),
      warnings: warningRecords(input),
      metadata,
      updatedAt,
    },
  }).returning();

  await db.delete(episodeAssets)
    .where(and(
      eq(episodeAssets.episodeId, episode.id),
      sql`${episodeAssets.metadata}->>'importedFrom' = ${TSL_IMPORT_SOURCE}`,
    ));

  const assets = await episodeAssetsFromLegacy(input, tslEpisodesPath);

  for (const asset of assets) {
    await db.insert(episodeAssets).values({
      episodeId: episode.id,
      type: asset.type,
      label: asset.label,
      localPath: asset.localPath,
      objectKey: null,
      publicUrl: asset.publicUrl,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      durationSeconds: asset.durationSeconds,
      checksum: null,
      metadata: asset.metadata,
      createdAt,
      updatedAt,
    });
  }

  let publishEvent = false;
  if (mapLegacyEpisodeStatus(input) === 'published') {
    const importKey = `${TSL_IMPORT_SOURCE}:${legacyId}:publish`;
    const currentEvents = await db.select()
      .from(publishEvents)
      .where(eq(publishEvents.episodeId, episode.id))
      .orderBy(desc(publishEvents.createdAt))
      .limit(50);
    const existingEvent = currentEvents.find((event) => asObject(event.metadata).importKey === importKey);
    const values = {
      episodeId: episode.id,
      feedId,
      status: 'succeeded' as const,
      feedGuid: asString(input.feedGuid),
      audioUrl: asString(input.publicAudioUrl),
      coverUrl: asString(input.publicCoverUrl),
      rssUrl: asString(input.feedUrl),
      changelog: 'Imported published legacy episode metadata.',
      error: null,
      metadata: {
        importedFrom: TSL_IMPORT_SOURCE,
        importKey,
        legacyId,
        episodeNumber,
      },
      updatedAt,
    };

    if (existingEvent) {
      await db.update(publishEvents).set(values).where(eq(publishEvents.id, existingEvent.id));
    } else {
      await db.insert(publishEvents).values({
        ...values,
        createdAt: publishedAt ?? createdAt,
      });
    }
    publishEvent = true;
  }

  return {
    result: existing ? 'updated' as const : 'inserted' as const,
    assetCount: assets.length,
    publishEvent,
  };
}

async function importTslEpisodes(db: Database, showId: string, path: string) {
  const data = await readJsonFile(path);
  const legacyEpisodes = asArray(data).map((item) => asObject(item) as LegacyEpisode);
  const [feed] = await db.select().from(feeds)
    .where(eq(feeds.showId, showId))
    .orderBy(desc(feeds.updatedAt))
    .limit(1);
  const summary = { inserted: 0, updated: 0, assets: 0, publishEvents: 0 };

  for (const episode of legacyEpisodes) {
    const result = await upsertLegacyEpisode(db, showId, feed?.id ?? null, episode, path);
    summary[result.result] += 1;
    summary.assets += result.assetCount;
    summary.publishEvents += result.publishEvent ? 1 : 0;
  }

  return summary;
}

export async function importLegacyData(options: LegacyImportOptions = {}): Promise<LegacyImportSummary> {
  const paths = defaultPaths(options);
  const { db, pool } = createDb(options.connectionString);

  try {
    const [show] = await db.select().from(shows).where(eq(shows.slug, paths.showSlug)).limit(1);

    if (!show) {
      throw new Error(`Show not found: ${paths.showSlug}. Run db:seed before importing legacy data.`);
    }

    const importedAt = new Date();
    const tslCandidates = await importTslStories(db, show.id, paths.tslStoriesPath, importedAt);
    const byteSized = await importByteSized(db, show.id, paths.byteRawDir, paths.byteRankedDir);
    const legacyEpisodes = await importTslEpisodes(db, show.id, paths.tslEpisodesPath);

    return {
      showSlug: paths.showSlug,
      candidates: {
        inserted: tslCandidates.inserted + byteSized.candidates.inserted,
        updated: tslCandidates.updated + byteSized.candidates.updated,
        skipped: tslCandidates.skipped + byteSized.candidates.skipped,
      },
      episodes: legacyEpisodes,
      sourceRuns: byteSized.sourceRuns,
    };
  } finally {
    await pool.end();
  }
}
