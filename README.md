# Podcast Forge

Agent-powered podcast production studio: configurable research sources, model routing, script generation, audio/art production, approvals, publishing, and analytics.

This repo is the productized successor to the local TSL Command Center + Byte Sized pipeline experiments.

## Goals

- Turn a topic or source profile into researched podcast episode candidates.
- Preserve source evidence and editorial decisions.
- Let humans approve/reject key steps before public publishing.
- Support multiple shows with different voices, feeds, formats, and model preferences.
- Package the system cleanly enough that other creators can self-host it later.

## Repo status

Planning/scaffold phase. See:

- [PRD](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Configuration schema](schemas/podcast-forge.config.schema.json)
- [Example config](config/examples/the-synthetic-lens.json)
- [Development plan](docs/DEVELOPMENT_PLAN.md)

## Working title

Podcast Forge. Alternatives: CastForge, Episode Foundry, SignalCast Studio.

## Config validation

The API package can validate Podcast Forge JSON configs against
[`schemas/podcast-forge.config.schema.json`](schemas/podcast-forge.config.schema.json).

Run the config checks:

```sh
npm run test:config --workspace @podcast-forge/api
npm run check
```

Start the API:

```sh
npm run dev --workspace @podcast-forge/api
```

Available config endpoints:

- `GET /health` returns API health.
- `GET /config/example` returns the bundled Synthetic Lens example config.
- `POST /config/validate` accepts a JSON config body and returns `{ "ok": true }`
  or `{ "ok": false, "errors": [...] }`.
- `GET /config?path=./config/examples/the-synthetic-lens.json` loads and
  validates a config file path. Leading `~/` is expanded, and relative paths
  resolve from the API process working directory.

## Source profile UI

Source profiles and search queries are persisted in Postgres through the
`@podcast-forge/db` schema. To run the app locally:

```sh
cp .env.example .env
docker compose up -d postgres
npm run db:migrate --workspace @podcast-forge/db
npm run db:seed --workspace @podcast-forge/db
npm run dev --workspace @podcast-forge/api
```

Open `http://localhost:3450/ui` to edit source profiles and queries for
`the-synthetic-lens`. The UI can enable or disable profiles and individual
queries, edit query text, freshness, include/exclude domains, and weights, and
create or delete query buckets.

Source profile endpoints:

- `GET /shows`
- `GET /source-profiles?showSlug=the-synthetic-lens`
- `POST /source-profiles`
- `PATCH /source-profiles/:id`
- `GET /source-profiles/:id/queries`
- `GET /source-profiles/:id/queries?enabledOnly=true`
- `POST /source-profiles/:id/queries`
- `PATCH /source-queries/:id`
- `DELETE /source-queries/:id`

Use `enabledOnly=true` for search jobs so disabled profiles and queries are not
included in source discovery.
