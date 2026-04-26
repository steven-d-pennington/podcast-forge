import type { PromptOutputSchemaName, PromptTemplate, PromptVariable } from './types.js';
import { PROMPT_OUTPUT_SCHEMAS } from './schemas.js';
import { isModelRole } from '../models/roles.js';

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asVariables(value: unknown): PromptVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is PromptVariable => {
    return Boolean(
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && 'name' in item
      && typeof item.name === 'string'
      && 'required' in item
      && typeof item.required === 'boolean',
    );
  });
}

function asSchemaName(value: unknown): PromptOutputSchemaName | null {
  return typeof value === 'string' && value in PROMPT_OUTPUT_SCHEMAS
    ? value as PromptOutputSchemaName
    : null;
}

export function promptTemplateFromDbRow(row: {
  id: string;
  showId: string | null;
  key: string;
  version: number;
  role: string | null;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): PromptTemplate {
  if (!row.role || !isModelRole(row.role)) {
    throw new Error(`Unknown prompt template role in database: ${row.role ?? '(none)'}`);
  }

  const metadata = asJsonObject(row.metadata);
  const outputSchemaName = asSchemaName(metadata.outputSchemaName);
  const outputSchemaHint = asJsonObject(metadata.outputSchemaHint);

  return {
    id: row.id,
    showId: row.showId,
    key: row.key,
    role: row.role,
    version: row.version,
    title: row.title ?? row.key,
    description: typeof metadata.description === 'string' ? metadata.description : '',
    inputVariables: asVariables(metadata.inputVariables),
    outputFormat: typeof metadata.outputFormat === 'string'
      ? metadata.outputFormat
      : outputSchemaName
        ? PROMPT_OUTPUT_SCHEMAS[outputSchemaName].description
        : 'Plain text output.',
    outputSchemaName,
    outputSchemaHint: Object.keys(outputSchemaHint).length > 0
      ? outputSchemaHint
      : outputSchemaName
        ? PROMPT_OUTPUT_SCHEMAS[outputSchemaName].schemaHint
        : null,
    body: row.body,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function promptTemplateMetadata(template: PromptTemplate): Record<string, unknown> {
  return {
    ...template.metadata,
    description: template.description,
    inputVariables: template.inputVariables,
    outputFormat: template.outputFormat,
    outputSchemaName: template.outputSchemaName,
    outputSchemaHint: template.outputSchemaHint,
  };
}
