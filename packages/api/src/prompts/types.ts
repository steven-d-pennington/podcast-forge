import type { LlmMessage, LlmResponseFormat } from '../llm/types.js';
import type { ModelRole } from '../models/roles.js';

export interface PromptVariable {
  name: string;
  description?: string;
  required: boolean;
}

export interface PromptTemplate {
  id?: string;
  showId: string | null;
  key: string;
  role: ModelRole;
  version: number;
  title: string;
  description: string;
  inputVariables: PromptVariable[];
  outputFormat: string;
  outputSchemaName: PromptOutputSchemaName | null;
  outputSchemaHint: Record<string, unknown> | null;
  body: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PromptTemplateListFilter {
  showId?: string;
  showSlug?: string;
  role?: ModelRole;
  key?: string;
  includeGlobal?: boolean;
}

export interface PromptTemplateLookup {
  showId?: string;
  showSlug?: string;
  version?: number;
  includeGlobal?: boolean;
}

export interface PromptTemplateStore {
  listPromptTemplates(filter?: PromptTemplateListFilter): Promise<PromptTemplate[]>;
  getPromptTemplateByKey(key: string, lookup?: PromptTemplateLookup): Promise<PromptTemplate | undefined>;
}

export interface PromptRegistry {
  listTemplates(filter?: PromptTemplateListFilter): Promise<PromptTemplate[]>;
  getTemplateByKey(key: string, lookup?: PromptTemplateLookup): Promise<PromptTemplate | undefined>;
  getTemplateByRole(role: ModelRole, lookup?: PromptTemplateLookup): Promise<PromptTemplate | undefined>;
}

export type PromptOutputSchemaName =
  | 'episode_plan_result'
  | 'candidate_score_result'
  | 'source_summary'
  | 'extracted_claims'
  | 'research_synthesis'
  | 'script_generation_result'
  | 'script_revision_result'
  | 'integrity_review_result'
  | 'metadata_result'
  | 'cover_prompt_result';

export interface PromptOutputSchemaDefinition<T = unknown> {
  name: PromptOutputSchemaName;
  description: string;
  schemaHint: Record<string, unknown>;
  validate(value: unknown): T;
}

export interface RenderPromptInput {
  key?: string;
  role?: ModelRole;
  version?: number;
  showId?: string;
  showSlug?: string;
  variables: Record<string, unknown>;
  includeGlobal?: boolean;
}

export interface RenderedPrompt {
  template: PromptTemplate;
  text: string;
  messages: LlmMessage[];
  responseFormat: LlmResponseFormat;
  missingVariables: string[];
}
