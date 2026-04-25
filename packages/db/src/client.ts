import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env or export DATABASE_URL.');
  }

  return new Pool({ connectionString });
}

export function createDb(connectionString = process.env.DATABASE_URL) {
  const pool = createPool(connectionString);
  return {
    pool,
    db: drizzle(pool, { schema })
  };
}

export type Database = ReturnType<typeof createDb>['db'];
