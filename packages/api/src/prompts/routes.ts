import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { isModelRole, MODEL_ROLES } from '../models/roles.js';
import { createPromptRegistry } from './registry.js';
import { PromptRenderError, renderPromptTemplate } from './renderer.js';
import type { PromptTemplateStore } from './types.js';

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface PromptRoutesOptions {
  getStore(): Partial<PromptTemplateStore> | undefined;
}

const modelRoleSchema = z.string().refine(isModelRole, {
  message: `Role must be one of: ${MODEL_ROLES.join(', ')}`,
});

const renderPromptSchema = z.object({
  key: z.string().trim().min(1).optional(),
  role: modelRoleSchema.optional(),
  version: z.number().int().positive().optional(),
  showId: z.string().uuid().optional(),
  showSlug: z.string().trim().min(1).optional(),
  variables: z.record(z.string(), z.unknown()).default({}),
  includeGlobal: z.boolean().default(true),
}).refine((value) => Boolean(value.key || value.role), {
  message: 'Provide key or role.',
  path: ['key'],
}).refine((value) => !value.showId || !value.showSlug, {
  message: 'Provide showId or showSlug, not both.',
  path: ['showSlug'],
});

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      ok: false,
      code: 'VALIDATION_ERROR',
      error: 'Request validation failed.',
      errors: error.issues,
    });
  }

  if (error instanceof PromptRenderError) {
    const statusCode = error.code === 'PROMPT_TEMPLATE_NOT_FOUND' ? 404 : 400;

    return reply.code(statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
    });
  }

  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details,
    });
  }

  throw error;
}

export function registerPromptRoutes(app: FastifyInstance, options: PromptRoutesOptions) {
  app.get<{ Querystring: { showId?: string; showSlug?: string; role?: string; key?: string; includeGlobal?: string } }>('/prompt-templates', async (request, reply) => {
    try {
      const registry = createPromptRegistry({ store: options.getStore() });
      const role = request.query.role ? modelRoleSchema.parse(request.query.role) : undefined;
      const includeGlobal = request.query.includeGlobal !== 'false';
      const templates = await registry.listTemplates({
        showId: request.query.showId,
        showSlug: request.query.showSlug,
        role,
        key: request.query.key,
        includeGlobal,
      });

      return { ok: true, templates };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { key: string }; Querystring: { showId?: string; showSlug?: string; version?: string; includeGlobal?: string } }>('/prompt-templates/:key', async (request, reply) => {
    try {
      const registry = createPromptRegistry({ store: options.getStore() });
      const version = request.query.version ? Number(request.query.version) : undefined;

      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        throw new ApiError(400, 'INVALID_PROMPT_VERSION', 'Prompt template version must be a positive integer.');
      }

      const template = await registry.getTemplateByKey(request.params.key, {
        showId: request.query.showId,
        showSlug: request.query.showSlug,
        version,
        includeGlobal: request.query.includeGlobal !== 'false',
      });

      if (!template) {
        throw new ApiError(404, 'PROMPT_TEMPLATE_NOT_FOUND', `Prompt template not found: ${request.params.key}`);
      }

      return { ok: true, template };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/prompt-templates/render', async (request, reply) => {
    try {
      const registry = createPromptRegistry({ store: options.getStore() });
      const body = renderPromptSchema.parse(request.body);
      const rendered = await renderPromptTemplate(registry, body);

      return { ok: true, rendered };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
