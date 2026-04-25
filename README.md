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

## Brave source search

Brave source profiles can be searched from the API using the enabled
`source_queries` rows stored in Postgres. Set a Brave API key before starting
the API:

```sh
BRAVE_API_KEY=your_brave_search_key npm run dev --workspace @podcast-forge/api
```

Run a search for a Brave source profile:

```sh
curl -X POST http://localhost:3450/source-profiles/:id/search
```

The endpoint runs a synchronous `source.search` job for now and writes new
`story_candidates` for deduped Brave news results. It respects count,
freshness, region/language, and simple rate-limit delay config from the source
profile/query records where present.

Search/job endpoints:

- `POST /source-profiles/:id/search`
- `POST /source-profiles/:id/ingest`
- `POST /story-candidates/manual`
- `GET /jobs/:id`
- `GET /story-candidates?showSlug=the-synthetic-lens`

## RSS and manual source ingest

RSS source profiles use enabled `source_queries.query` values as feed URLs.
Profiles may also set `config.feedUrl` or `config.feedUrls` for feed URLs
that should always be ingested. Run RSS ingest synchronously for V1:

```sh
curl -X POST http://localhost:3450/source-profiles/:rss_profile_id/ingest
```

The endpoint writes deduped RSS/Atom items into `story_candidates` and creates
a `source.ingest` job. Dedupe is shared with Brave and manual candidates using
canonical URL and normalized title checks.

Manual URLs can be submitted without a source profile:

```sh
curl -X POST http://localhost:3450/story-candidates/manual \
  -H 'content-type: application/json' \
  -d '{"showSlug":"the-synthetic-lens","url":"https://example.com/story","title":"Example Story"}'
```

The local UI at `http://localhost:3450/ui` includes a manual URL form. For RSS,
create or edit a profile with type `rss`, add enabled query rows containing feed
URLs, then use the `Ingest RSS` action shown for RSS profiles.

## Research packets

Selected story candidates can produce deterministic research packets without an
LLM dependency. The API fetches readable source snapshots into
`source_documents`, then writes a `research_packets` row with summary content,
cited claims, citations, and warning objects.

Build a packet from the candidate URL plus optional extra URLs:

```sh
curl -X POST http://localhost:3450/story-candidates/:id/research-packet \
  -H 'content-type: application/json' \
  -d '{"extraUrls":["https://example.org/second-source"]}'
```

Read and override warnings:

```sh
curl http://localhost:3450/research-packets/:id

curl -X POST http://localhost:3450/research-packets/:id/override-warning \
  -H 'content-type: application/json' \
  -d '{"warningId":"INSUFFICIENT_INDEPENDENT_SOURCES","reason":"Editor approved with direct source material.","actor":"local-user"}'
```

Research endpoints:

- `POST /story-candidates/:id/research-packet`
- `GET /research-packets/:id`
- `POST /research-packets/:id/override-warning`
