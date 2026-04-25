export type EpisodeStatus =
  | 'draft'
  | 'research-ready'
  | 'script-ready'
  | 'approved-for-audio'
  | 'audio-ready'
  | 'approved-for-publish'
  | 'published'
  | 'archived';

export type EpisodeAssetType = 'script' | 'audio-preview' | 'audio-final' | 'cover-art' | 'research-packet' | 'source-snapshot';

export interface EpisodeRecord {
  id: string;
  showId: string;
  feedId: string | null;
  episodeCandidateId: string | null;
  researchPacketId: string | null;
  slug: string;
  title: string;
  description: string | null;
  episodeNumber: number | null;
  status: EpisodeStatus;
  scriptText: string | null;
  scriptFormat: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  feedGuid: string | null;
  warnings: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EpisodeAssetRecord {
  id: string;
  episodeId: string;
  type: EpisodeAssetType;
  label: string | null;
  localPath: string | null;
  objectKey: string | null;
  publicUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  durationSeconds: number | null;
  checksum: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedRecord {
  id: string;
  showId: string;
  slug: string;
  title: string;
  description: string | null;
  rssFeedPath: string | null;
  publicFeedUrl: string | null;
  publicBaseUrl: string | null;
  storageType: string;
  storageConfig: Record<string, unknown>;
  op3Wrap: boolean;
  episodeNumberPolicy: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type PublishStatus = 'started' | 'succeeded' | 'failed' | 'rolled-back';

export interface PublishEventRecord {
  id: string;
  episodeId: string;
  feedId: string | null;
  status: PublishStatus;
  feedGuid: string | null;
  audioUrl: string | null;
  coverUrl: string | null;
  rssUrl: string | null;
  changelog: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEpisodeFromScriptInput {
  showId: string;
  researchPacketId: string;
  scriptId: string;
  revisionId: string;
  title: string;
  scriptText: string;
  scriptFormat: string;
}

export interface UpdateEpisodeProductionInput {
  feedId?: string | null;
  status?: EpisodeStatus;
  scriptText?: string | null;
  scriptFormat?: string | null;
  durationSeconds?: number | null;
  publishedAt?: Date | null;
  feedGuid?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateEpisodeAssetInput {
  episodeId: string;
  type: EpisodeAssetType;
  label?: string | null;
  localPath?: string | null;
  objectKey?: string | null;
  publicUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  durationSeconds?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ApproveEpisodeForPublishInput {
  actor: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreatePublishEventInput {
  episodeId: string;
  feedId?: string | null;
  status: PublishStatus;
  feedGuid?: string | null;
  audioUrl?: string | null;
  coverUrl?: string | null;
  rssUrl?: string | null;
  changelog?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdatePublishEventInput = Partial<Omit<CreatePublishEventInput, 'episodeId'>>;

export interface ProductionStore {
  getEpisode(id: string): Promise<EpisodeRecord | undefined>;
  listEpisodes(filter: { showId: string; limit?: number }): Promise<EpisodeRecord[]>;
  getEpisodeForScript(scriptId: string, researchPacketId: string): Promise<EpisodeRecord | undefined>;
  createEpisodeFromScript(input: CreateEpisodeFromScriptInput): Promise<EpisodeRecord>;
  updateEpisodeProduction(id: string, input: UpdateEpisodeProductionInput): Promise<EpisodeRecord | undefined>;
  createEpisodeAsset(input: CreateEpisodeAssetInput): Promise<EpisodeAssetRecord>;
  listEpisodeAssets(episodeId: string): Promise<EpisodeAssetRecord[]>;
  listFeeds(showId: string): Promise<FeedRecord[]>;
  getFeed(id: string): Promise<FeedRecord | undefined>;
  approveEpisodeForPublish(id: string, input: ApproveEpisodeForPublishInput): Promise<EpisodeRecord | undefined>;
  createPublishEvent(input: CreatePublishEventInput): Promise<PublishEventRecord>;
  updatePublishEvent(id: string, input: UpdatePublishEventInput): Promise<PublishEventRecord | undefined>;
}
