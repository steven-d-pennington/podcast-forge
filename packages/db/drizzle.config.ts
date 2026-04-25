import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://podcast_forge:podcast_forge@localhost:5544/podcast_forge'
  },
  verbose: true,
  strict: true
});
