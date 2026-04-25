import Fastify, { type FastifyServerOptions } from 'fastify';

import {
  ConfigLoadError,
  loadConfigFromFile,
  loadExampleConfig,
  validateConfig,
} from './config/loader.js';

interface ConfigQuery {
  path?: string;
}

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.get('/health', async () => ({ ok: true, service: 'podcast-forge-api' }));

  app.get('/config/example', async () => loadExampleConfig());

  app.post('/config/validate', async (request) => {
    const result = await validateConfig(request.body);

    if (result.ok) {
      return { ok: true };
    }

    return { ok: false, errors: result.errors };
  });

  app.get<{ Querystring: ConfigQuery }>('/config', async (request, reply) => {
    const configPath = request.query.path;

    if (!configPath) {
      return reply.code(400).send({
        ok: false,
        code: 'CONFIG_PATH_REQUIRED',
        error: 'Missing required query parameter: path',
      });
    }

    try {
      const result = await loadConfigFromFile(configPath);

      return { ok: true, path: result.path, config: result.config };
    } catch (error) {
      if (error instanceof ConfigLoadError) {
        const statusCode = error.code === 'CONFIG_FILE_NOT_FOUND' ? 404 : 400;

        return reply.code(statusCode).send({
          ok: false,
          code: error.code,
          error: error.message,
          errors: error.errors,
        });
      }

      throw error;
    }
  });

  return app;
}
