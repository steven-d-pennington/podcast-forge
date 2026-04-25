export type ScriptStatus = 'draft' | 'approved-for-audio';

export interface ScriptRecord {
  id: string;
  showId: string;
  researchPacketId: string;
  title: string;
  format: string;
  status: string;
  approvedRevisionId: string | null;
  approvedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScriptRevisionRecord {
  id: string;
  scriptId: string;
  version: number;
  title: string;
  body: string;
  format: string;
  speakers: string[];
  author: string;
  changeSummary: string | null;
  modelProfile: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateScriptRevisionInput {
  title: string;
  body: string;
  format: string;
  speakers: string[];
  author: string;
  changeSummary: string | null;
  modelProfile: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface CreateScriptWithRevisionInput {
  showId: string;
  researchPacketId: string;
  title: string;
  format: string;
  metadata: Record<string, unknown>;
  revision: CreateScriptRevisionInput;
}

export interface ListScriptsFilter {
  showId?: string;
  showSlug?: string;
  researchPacketId?: string;
  limit?: number;
}

export interface ApproveScriptRevisionInput {
  actor: string;
  reason: string | null;
}

export interface ScriptStore {
  createScriptWithRevision(input: CreateScriptWithRevisionInput): Promise<{
    script: ScriptRecord;
    revision: ScriptRevisionRecord;
  }>;
  listScripts(filter?: ListScriptsFilter): Promise<ScriptRecord[]>;
  getScript(id: string): Promise<ScriptRecord | undefined>;
  listScriptRevisions(scriptId: string): Promise<ScriptRevisionRecord[]>;
  getScriptRevision(id: string): Promise<ScriptRevisionRecord | undefined>;
  createScriptRevision(scriptId: string, input: CreateScriptRevisionInput): Promise<{
    script: ScriptRecord;
    revision: ScriptRevisionRecord;
  } | undefined>;
  approveScriptRevision(scriptId: string, revisionId: string, input: ApproveScriptRevisionInput): Promise<ScriptRecord | undefined>;
}
