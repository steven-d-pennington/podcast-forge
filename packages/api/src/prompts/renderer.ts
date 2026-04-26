import { PROMPT_OUTPUT_SCHEMAS } from './schemas.js';
import type { PromptRegistry, PromptTemplate, RenderedPrompt, RenderPromptInput } from './types.js';

export type PromptRenderErrorCode =
  | 'PROMPT_LOOKUP_REQUIRED'
  | 'PROMPT_TEMPLATE_NOT_FOUND'
  | 'PROMPT_VARIABLES_MISSING';

export class PromptRenderError extends Error {
  constructor(
    public readonly code: PromptRenderErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PromptRenderError';
  }
}

function variableValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function requiredVariableNames(template: PromptTemplate) {
  return template.inputVariables
    .filter((variable) => variable.required)
    .map((variable) => variable.name);
}

function missingVariables(template: PromptTemplate, variables: Record<string, unknown>) {
  return requiredVariableNames(template).filter((name) => !(name in variables) || variables[name] === undefined || variables[name] === null);
}

function renderBody(template: PromptTemplate, variables: Record<string, unknown>) {
  return template.body.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
    if (!(name in variables) || variables[name] === undefined || variables[name] === null) {
      return match;
    }

    return variableValue(variables[name]);
  });
}

function outputInstructions(template: PromptTemplate) {
  const lines = [
    'Output requirements:',
    `- ${template.outputFormat}`,
  ];

  if (template.outputSchemaName) {
    const schema = PROMPT_OUTPUT_SCHEMAS[template.outputSchemaName];
    lines.push(`- Return only valid JSON for schema "${schema.name}".`);
    lines.push(`- Schema hint: ${JSON.stringify(schema.schemaHint)}`);
  }

  return lines.join('\n');
}

async function resolveTemplate(registry: PromptRegistry, input: RenderPromptInput) {
  const lookup = {
    showId: input.showId,
    showSlug: input.showSlug,
    version: input.version,
    includeGlobal: input.includeGlobal ?? true,
  };

  if (input.key) {
    return registry.getTemplateByKey(input.key, lookup);
  }

  if (input.role) {
    return registry.getTemplateByRole(input.role, lookup);
  }

  throw new PromptRenderError('PROMPT_LOOKUP_REQUIRED', 'Provide a prompt template key or role.');
}

export async function renderPromptTemplate(
  registry: PromptRegistry,
  input: RenderPromptInput,
): Promise<RenderedPrompt> {
  const template = await resolveTemplate(registry, input);

  if (!template) {
    throw new PromptRenderError('PROMPT_TEMPLATE_NOT_FOUND', 'Prompt template was not found.', {
      key: input.key,
      role: input.role,
      version: input.version,
      showId: input.showId,
      showSlug: input.showSlug,
    });
  }

  const missing = missingVariables(template, input.variables);
  if (missing.length > 0) {
    throw new PromptRenderError('PROMPT_VARIABLES_MISSING', `Missing required prompt variable(s): ${missing.join(', ')}`, {
      key: template.key,
      version: template.version,
      missingVariables: missing,
    });
  }

  const text = [renderBody(template, input.variables), outputInstructions(template)].join('\n\n');
  const responseFormat = template.outputSchemaName
    ? {
      type: 'json' as const,
      schemaName: template.outputSchemaName,
      schemaHint: template.outputSchemaHint ?? PROMPT_OUTPUT_SCHEMAS[template.outputSchemaName].schemaHint,
    }
    : { type: 'text' as const };

  return {
    template,
    text,
    messages: [{ role: 'system', content: text }],
    responseFormat,
    missingVariables: [],
  };
}
