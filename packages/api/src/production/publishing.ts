import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { EpisodeAssetRecord, EpisodeRecord, FeedRecord } from './store.js';

export interface UploadedPublishAsset {
  assetId: string;
  type: EpisodeAssetRecord['type'];
  objectKey: string | null;
  publicUrl: string;
  byteSize: number | null;
  metadata: Record<string, unknown>;
}

export interface PublishStorageAdapter {
  uploadAsset(input: {
    feed: FeedRecord;
    episode: EpisodeRecord;
    asset: EpisodeAssetRecord;
  }): Promise<UploadedPublishAsset>;
}

export interface RssEpisodeEntry {
  guid: string;
  title: string;
  description: string;
  audioUrl: string;
  audioMimeType: string;
  audioByteSize: number;
  coverUrl: string;
  durationSeconds: number | null;
  publishedAt: Date;
}

export interface RssUpdateResult {
  rssUrl: string;
  inserted: boolean;
  itemCount: number;
}

export interface RssUpdateAdapter {
  upsertEpisode(input: {
    feed: FeedRecord;
    episode: EpisodeRecord;
    entry: RssEpisodeEntry;
  }): Promise<RssUpdateResult>;
}

export interface PublishUrlValidation {
  url: string;
  ok: boolean;
  status?: number | null;
}

export interface PublishUrlValidator {
  validate(urls: string[]): Promise<PublishUrlValidation[]>;
}

function configString(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

export function extensionForMimeType(mimeType: string | null) {
  switch (mimeType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    default:
      return 'bin';
  }
}

export function defaultPublishObjectKey(episode: EpisodeRecord, asset: EpisodeAssetRecord) {
  return asset.objectKey ?? `episodes/${episode.slug}/${asset.type}.${extensionForMimeType(asset.mimeType)}`;
}

function publicUrl(feed: FeedRecord, objectKey: string | null, existingUrl: string | null) {
  if (existingUrl) {
    return existingUrl;
  }

  if (!feed.publicBaseUrl || !objectKey) {
    return null;
  }

  return `${feed.publicBaseUrl.replace(/\/$/, '')}/${objectKey.replace(/^\//, '')}`;
}

function assertPublicUrl(url: string | null, label: string): string {
  if (!url) {
    throw new Error(`${label} is missing a public URL.`);
  }

  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must be an http(s) URL.`);
  }

  return parsed.toString();
}

async function maybeCopyLocalAsset(rootDir: string | null, objectKey: string, localPath: string | null) {
  if (!rootDir || !localPath) {
    return null;
  }

  const destination = join(rootDir, objectKey);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(localPath, destination);
  return destination;
}

export function createPublishStorageAdapter(feed: FeedRecord): PublishStorageAdapter {
  if (feed.storageType === 'r2') {
    return {
      async uploadAsset({ asset, episode }) {
        const objectKey = defaultPublishObjectKey(episode, asset);
        const url = assertPublicUrl(publicUrl(feed, objectKey, asset.publicUrl), `${asset.type} asset`);

        return {
          assetId: asset.id,
          type: asset.type,
          objectKey,
          publicUrl: url,
          byteSize: asset.byteSize,
          metadata: {
            adapter: 'r2-compatible',
            bucket: configString(feed.storageConfig, ['bucket', 'r2Bucket']),
          },
        };
      },
    };
  }

  return {
    async uploadAsset({ asset, episode }) {
      const objectKey = defaultPublishObjectKey(episode, asset);
      const rootDir = configString(feed.storageConfig, ['localRoot', 'outputDir', 'publicDir']);
      const copiedTo = await maybeCopyLocalAsset(rootDir, objectKey, asset.localPath);
      const size = copiedTo ? (await stat(copiedTo)).size : asset.byteSize;
      const url = assertPublicUrl(publicUrl(feed, objectKey, asset.publicUrl), `${asset.type} asset`);

      return {
        assetId: asset.id,
        type: asset.type,
        objectKey,
        publicUrl: url,
        byteSize: size,
        metadata: {
          adapter: 'local',
          copiedTo,
        },
      };
    },
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function baseRss(feed: FeedRecord) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <description>${escapeXml(feed.description ?? feed.title)}</description>
  </channel>
</rss>
`;
}

function rssItem(entry: RssEpisodeEntry) {
  const duration = entry.durationSeconds ? `    <itunes:duration>${entry.durationSeconds}</itunes:duration>\n` : '';

  return `  <item>
    <title>${escapeXml(entry.title)}</title>
    <description>${escapeXml(entry.description)}</description>
    <guid isPermaLink="false">${escapeXml(entry.guid)}</guid>
    <pubDate>${entry.publishedAt.toUTCString()}</pubDate>
    <enclosure url="${escapeXml(entry.audioUrl)}" length="${entry.audioByteSize}" type="${escapeXml(entry.audioMimeType)}" />
    <itunes:image href="${escapeXml(entry.coverUrl)}" />
${duration}  </item>`;
}

function itemGuid(item: string) {
  const match = item.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
  return match?.[1]?.trim().replaceAll('&amp;', '&') ?? null;
}

function upsertItem(xml: string, entry: RssEpisodeEntry) {
  const item = rssItem(entry);
  let inserted = true;
  const next = xml.replace(/<item\b[\s\S]*?<\/item>/gi, (candidate) => {
    if (itemGuid(candidate) !== entry.guid) {
      return candidate;
    }

    inserted = false;
    return item;
  });

  if (!inserted) {
    return { xml: next, inserted };
  }

  return {
    xml: next.replace(/\s*<\/channel>/, `\n${item}\n  </channel>`),
    inserted,
  };
}

function countItems(xml: string) {
  return xml.match(/<item\b/gi)?.length ?? 0;
}

function feedUrl(feed: FeedRecord) {
  return assertPublicUrl(feed.publicFeedUrl ?? publicUrl(feed, feed.rssFeedPath ? 'feed.xml' : null, null), 'RSS feed');
}

export const localRssUpdateAdapter: RssUpdateAdapter = {
  async upsertEpisode({ feed, entry }) {
    const current = feed.rssFeedPath
      ? await readFile(feed.rssFeedPath, 'utf8').catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return baseRss(feed);
        }

        throw error;
      })
      : baseRss(feed);
    const updated = upsertItem(current, entry);

    if (feed.rssFeedPath) {
      await mkdir(dirname(feed.rssFeedPath), { recursive: true });
      await writeFile(feed.rssFeedPath, updated.xml, 'utf8');
    }

    return {
      rssUrl: feedUrl(feed),
      inserted: updated.inserted,
      itemCount: countItems(updated.xml),
    };
  },
};

export const strictPublicUrlValidator: PublishUrlValidator = {
  async validate(urls) {
    return urls.map((url) => {
      const parsed = new URL(url);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Published URL is not public http(s): ${url}`);
      }

      return { url: parsed.toString(), ok: true };
    });
  },
};

export function op3Wrap(url: string) {
  return `https://op3.dev/e/${url}`;
}
