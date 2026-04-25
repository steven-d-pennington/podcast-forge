import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { importLegacyData } from './legacy.js';

const legacyImportSchema = z.object({
  showSlug: z.string().trim().min(1).optional(),
  tslStoriesPath: z.string().trim().min(1).optional(),
  tslEpisodesPath: z.string().trim().min(1).optional(),
  byteRawDir: z.string().trim().min(1).optional(),
  byteRankedDir: z.string().trim().min(1).optional(),
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

  const message = error instanceof Error ? error.message : 'Legacy import failed.';

  return reply.code(500).send({
    ok: false,
    code: 'LEGACY_IMPORT_FAILED',
    error: message,
  });
}

export function registerLegacyImportRoutes(app: FastifyInstance) {
  app.post('/imports/legacy', async (request, reply) => {
    try {
      const body = legacyImportSchema.parse(request.body ?? {});
      const summary = await importLegacyData(body);

      return reply.code(201).send({
        ok: true,
        summary,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
