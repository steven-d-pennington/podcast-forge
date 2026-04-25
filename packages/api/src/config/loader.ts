import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';

import type {
  ConfigValidationError,
  ConfigValidationResult,
  PodcastForgeConfig,
} from './types.js';

export type ConfigLoadErrorCode =
  | 'CONFIG_PATH_REQUIRED'
  | 'CONFIG_FILE_NOT_FOUND'
  | 'CONFIG_FILE_READ_ERROR'
  | 'CONFIG_INVALID_JSON'
  | 'CONFIG_SCHEMA_INVALID';

export class ConfigLoadError extends Error {
  readonly code: ConfigLoadErrorCode;
  readonly path?: string;
  readonly errors?: ConfigValidationError[];

  constructor(
    code: ConfigLoadErrorCode,
    message: string,
    options: { path?: string; errors?: ConfigValidationError[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ConfigLoadError';
    this.code = code;
    this.path = options.path;
    this.errors = options.errors;
  }
}

const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

export const CONFIG_SCHEMA_PATH = path.join(
  repoRoot,
  'schemas',
  'podcast-forge.config.schema.json',
);

export const EXAMPLE_CONFIG_PATH = path.join(
  repoRoot,
  'config',
  'examples',
  'the-synthetic-lens.json',
);

let compiledValidator: ValidateFunction<PodcastForgeConfig> | undefined;

export function resolveConfigPath(inputPath: string, baseDir = process.cwd()): string {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    throw new ConfigLoadError('CONFIG_PATH_REQUIRED', 'Config path is required.');
  }

  const expandedPath =
    trimmedPath === '~' || trimmedPath.startsWith('~/')
      ? path.join(homedir(), trimmedPath.slice(2))
      : trimmedPath;

  return path.resolve(baseDir, expandedPath);
}

export async function loadConfigFromFile(inputPath: string): Promise<{
  config: PodcastForgeConfig;
  path: string;
}> {
  const resolvedPath = resolveConfigPath(inputPath);
  const rawConfig = await readJsonFile(resolvedPath);
  const result = await validateConfig(rawConfig);

  if (!result.ok) {
    throw new ConfigLoadError('CONFIG_SCHEMA_INVALID', 'Config failed schema validation.', {
      path: resolvedPath,
      errors: result.errors,
    });
  }

  return { config: result.config, path: resolvedPath };
}

export async function loadExampleConfig(): Promise<PodcastForgeConfig> {
  return (await loadConfigFromFile(EXAMPLE_CONFIG_PATH)).config;
}

export async function validateConfig(config: unknown): Promise<ConfigValidationResult> {
  const validate = await getValidator();
  const valid = validate(config);

  if (!valid) {
    return { ok: false, errors: formatValidationErrors(validate.errors ?? []) };
  }

  return { ok: true, config: config as PodcastForgeConfig };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  let rawFile: string;

  try {
    rawFile = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new ConfigLoadError(
        'CONFIG_FILE_NOT_FOUND',
        `Config file not found: ${filePath}`,
        { path: filePath, cause: error },
      );
    }

    throw new ConfigLoadError('CONFIG_FILE_READ_ERROR', `Unable to read config file: ${filePath}`, {
      path: filePath,
      cause: error,
    });
  }

  try {
    return JSON.parse(rawFile);
  } catch (error) {
    const suffix = error instanceof Error ? ` ${error.message}` : '';

    throw new ConfigLoadError('CONFIG_INVALID_JSON', `Invalid JSON in config file: ${filePath}.${suffix}`, {
      path: filePath,
      cause: error,
    });
  }
}

async function getValidator(): Promise<ValidateFunction<PodcastForgeConfig>> {
  if (compiledValidator) {
    return compiledValidator;
  }

  const schema = await readJsonFile(CONFIG_SCHEMA_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile<PodcastForgeConfig>(schema as AnySchema);
  compiledValidator = validate;

  return validate;
}

function formatValidationErrors(errors: ErrorObject[]): ConfigValidationError[] {
  return errors.map((error) => ({
    path: error.instancePath || '/',
    message: error.message ?? 'Schema validation failed.',
    keyword: error.keyword,
  }));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
