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

## New show onboarding

Shows can be added from the local UI with `New Show`. The onboarding form
creates the show in `draft` or `active` setup state, adds a feed, creates a
starter source profile and query, and seeds model profiles for each supported
agent role. Draft shows are returned by `GET /shows`, so setup can be completed
over time without editing seed data, config files, or the database directly.

Show/feed endpoints:

- `GET /shows`
- `POST /shows`
- `PATCH /shows/:id`
- `GET /shows/:showSlug/feeds`
- `POST /shows/:showSlug/feeds`
- `PATCH /feeds/:id`

Source profile endpoints:

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

## Model profile routing

Model choices are runtime configuration, not code constants. The supported
roles are `candidate_scorer`, `source_summarizer`, `claim_extractor`,
`research_synthesizer`, `script_writer`, `script_editor`, `metadata_writer`,
and `cover_prompt_writer`.

Seeded configs write each `models` entry into `model_profiles` with
provider/model, params, fallbacks, prompt template key, and budget. Worker-style
jobs resolve the active profile by show and role at runtime. `source.search`
records the resolved `candidate_scorer`; research packet generation records
`source_summarizer`, `claim_extractor`, and `research_synthesizer` in both the
job metadata and packet content.

Model profile endpoints:

- `GET /model-profiles?showSlug=the-synthetic-lens`
- `GET /model-profiles?showSlug=the-synthetic-lens&role=script_writer&includeGlobal=true`
- `POST /model-profiles`
- `PATCH /model-profiles/:id`

Example update without code changes:

```sh
curl -X PATCH http://localhost:3450/model-profiles/:id \
  -H 'content-type: application/json' \
  -d '{"provider":"openai","model":"gpt-5.5","params":{"reasoningEffort":"high"}}'
```

## LLM runtime

The API package exposes an internal `packages/api/src/llm` runtime for
role-based text and JSON model calls. Callers pass a resolved `model_profiles`
record, prompt messages, and optional JSON validation; the runtime selects the
configured provider/model, tries configured fallbacks, and returns normalized
text/JSON plus invocation metadata suitable for `jobs.output.llmInvocations`
and `jobs.logs`.

Available adapters:

- `fake` is deterministic and intended for tests and local development.
- `openai` / `openai-compatible` use a Chat Completions-compatible HTTP path
  when `OPENAI_API_KEY` is set. `OPENAI_BASE_URL` can point at another
  compatible endpoint. Tests inject fakes and do not make live provider calls.

Fallback strings may be plain model names, which reuse the profile provider, or
`provider/model` strings, which switch provider and model for that attempt.

## Prompt templates

Prompt templates live under `packages/api/src/prompts`. Podcast Forge ships
safe default templates for each supported model role, keyed as
`<role>.default`, plus zod validators for the structured JSON outputs expected
by candidate scoring, source summarization, claim extraction, research
synthesis, script generation/revision, metadata, and cover prompts.

Pipeline code can render a prompt before calling the LLM runtime:

```ts
const registry = createPromptRegistry({ store });
const rendered = await renderPromptTemplate(registry, {
  key: modelProfile.promptTemplateKey ?? 'script_writer.default',
  variables: {
    show_context: show,
    research_packet: packet,
    format_notes: show.format,
  },
});
```

`rendered.messages` and `rendered.responseFormat` are compatible with the LLM
runtime. Missing required variables fail before any provider call.

Prompt template endpoints for future settings/admin UI:

- `GET /prompt-templates`
- `GET /prompt-templates?role=script_writer`
- `GET /prompt-templates/:key?version=1`
- `POST /prompt-templates/render`

The existing `prompt_templates` table can store show-specific or global
overrides. Default code templates remain the fallback path so a fresh install
can render prompts before editable DB prompts are added.

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

New candidates are scored synchronously as a pragmatic V1 pass, capped at 10
candidates per source profile by default. Override the cap with
`source_profiles.config.candidateScoringLimit`, `scoringLimit`, or
`scoring.limit`. When a `candidate_scorer` model profile is configured, search
renders the candidate scorer prompt and calls the LLM runtime for structured
JSON scoring. If no scorer is configured, validation fails, or the scorer
errors, ingestion still keeps the candidate and records deterministic fallback
metadata with `metadata.scoringStatus`, `score`, `scoreBreakdown.rationale`,
component scores, warnings, flags, and scorer/runtime metadata where available.

Search/job endpoints:

- `POST /source-profiles/:id/search`
- `POST /source-profiles/:id/ingest`
- `POST /story-candidates/manual`
- `GET /jobs/:id`
- `GET /story-candidates?showSlug=the-synthetic-lens`

`GET /story-candidates` defaults to `sort=score`, returning scored candidates
highest first with unscored candidates last. Use `sort=discovered` to show the
newest discovered candidates first.

## Scheduled pipelines

Recurring show workflows are stored as `scheduled_pipelines` records. A
schedule belongs to a show, can point at a feed and source profile, uses a
five-field cron expression, and records each launch as a durable
`pipeline.scheduled` job. The scheduler is intentionally runtime-neutral:
Sam/OpenClaw, system cron, GitHub Actions, or another heartbeat can call the
API while Podcast Forge keeps the definitions, run history, logs, progress, and
retry state.

Create a scheduled pipeline:

```sh
curl -X POST http://localhost:3450/scheduled-pipelines \
  -H 'content-type: application/json' \
  -d '{
    "showSlug": "the-synthetic-lens",
    "sourceProfileId": "SOURCE_PROFILE_ID",
    "slug": "weekday-ai-brief",
    "name": "Weekday AI Brief",
    "cron": "0 6 * * 1-5",
    "timezone": "UTC",
    "workflow": ["ingest", "research", "script", "audio", "publish"],
    "autopublish": false,
    "legacyAdapter": { "command": "/path/to/current/openclaw-pipeline.sh" }
  }'
```

Run a schedule immediately from the dashboard or API:

```sh
curl -X POST http://localhost:3450/scheduled-pipelines/:id/run \
  -H 'content-type: application/json' \
  -d '{"actor":"local-user"}'
```

External cron/heartbeat integrations should call:

```sh
curl -X POST http://localhost:3450/scheduler/heartbeat \
  -H 'content-type: application/json' \
  -d '{"runnerId":"openclaw-cron"}'
```

Failed scheduled runs are visible and retryable:

```sh
curl "http://localhost:3450/scheduled-pipeline-runs?showSlug=the-synthetic-lens&status=failed"
curl -X POST http://localhost:3450/scheduled-pipeline-runs/:jobId/retry \
  -H 'content-type: application/json' \
  -d '{"actor":"local-user"}'
```

V1 runs source ingest/search directly for RSS and Brave source profiles.
Research, script, audio, and publish stages are represented as child jobs so
the control plane can track the intended workflow while worker adapters are
migrated. Publishing remains approval-gated unless the scheduled pipeline sets
`autopublish: true`.

Migration path for existing Executive Lens, TSL, and Byte Sized cron workflows:
create one schedule per show/feed/source profile, copy the current cron cadence
into `cron`, copy the current shell command into `legacyAdapter.command`, and
enable native stages as each worker adapter is moved behind Podcast Forge job
records. During migration, old cron can keep executing the shell command while
`/scheduler/heartbeat` records due runs and failures in the same job history.

## Legacy TSL and Byte Sized import

After seeding the Synthetic Lens config, import the current local TSL Command
Center and Byte Sized data into Postgres:

```sh
npm run import:legacy --workspace @podcast-forge/api
```

By default the importer assumes this repo sits beside the legacy project
folders and reads:

- `../tsl-command-center/data/stories.json`
- `../tsl-command-center/data/episodes.json`
- `../byte-sized/raw`
- `../byte-sized/output/*-ranked.json`

Override paths when needed:

```sh
npm run import:legacy --workspace @podcast-forge/api -- \
  --show-slug=the-synthetic-lens \
  --tsl-stories=/path/to/stories.json \
  --tsl-episodes=/path/to/episodes.json \
  --byte-raw=/path/to/byte-sized/raw \
  --byte-ranked=/path/to/byte-sized/output
```

The import is repeatable. It upserts story candidates by canonical URL, upserts
TSL episodes by show/slug, refreshes only previously imported episode assets,
and records one idempotent `source.import` job per Byte Sized raw date. Published
episode metadata such as EP85 number, public audio/cover URLs, feed GUID, and
publish event details are preserved where present.

The same flow is available from the local UI with `Import Legacy`, or through:

```sh
curl -X POST http://localhost:3450/imports/legacy \
  -H 'content-type: application/json' \
  -d '{"showSlug":"the-synthetic-lens"}'
```

Read imported records:

- `GET /story-candidates?showSlug=the-synthetic-lens`
- `GET /episodes?showSlug=the-synthetic-lens`

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

## Script generation workflow

Research packets can produce deterministic editable script drafts. The
`script.generate` job resolves the show-specific `script_writer` model profile
and records that routing in the job input/output and initial script revision,
but it does not call an external LLM yet. Drafts are generated from packet
claims, citations, warnings, the show format, and the configured show cast.

Generate a script from a research packet:

```sh
curl -X POST http://localhost:3450/research-packets/:id/script \
  -H 'content-type: application/json' \
  -d '{"format":"feature-analysis","actor":"editor@example.com"}'
```

Human edits are saved as new immutable revisions instead of silently
overwriting the previous body. Speaker labels such as `DAVID:` must match a
configured cast member for the show.

```sh
curl -X POST http://localhost:3450/scripts/:id/revisions \
  -H 'content-type: application/json' \
  -d '{"body":"DAVID: Revised opening.","actor":"editor@example.com"}'

curl -X POST http://localhost:3450/scripts/:id/revisions/:revisionId/approve-for-audio \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com","reason":"Ready for audio preview."}'
```

Script endpoints:

- `POST /research-packets/:id/script`
- `GET /scripts?showSlug=the-synthetic-lens`
- `GET /scripts/:id`
- `GET /scripts/:id/revisions`
- `POST /scripts/:id/revisions`
- `POST /scripts/:id/revisions/:revisionId/approve-for-audio`

## Preview audio and cover art

Approved script revisions can produce durable production jobs. The API creates
or reuses an episode record for the script, writes `audio.preview` and
`art.generate` jobs with logs/progress, and links output rows in
`episode_assets`.

```sh
curl -X POST http://localhost:3450/scripts/:id/production/audio-preview \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com"}'

curl -X POST http://localhost:3450/scripts/:id/production/cover-art \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com"}'

curl http://localhost:3450/scripts/:id/production
```

Production endpoints:

- `GET /scripts/:id/production`
- `POST /scripts/:id/production/audio-preview`
- `POST /scripts/:id/production/cover-art`

## Approval-gated RSS publishing

Episodes must reach `approved-for-publish` before `publish.rss` can update a
feed. The publish job uploads the selected audio and cover art through the
configured feed storage adapter, preserves the feed OP3 wrapping setting, upserts
the RSS item by episode/feed GUID, validates the resulting public URLs, records a
`publish_events` audit row, and marks the episode `published`.

```sh
curl -X POST http://localhost:3450/episodes/:id/approve-for-publish \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com","reason":"Final assets approved."}'

curl -X POST http://localhost:3450/episodes/:id/publish/rss \
  -H 'content-type: application/json' \
  -d '{"actor":"publisher@example.com"}'
```

Publishing endpoints:

- `POST /episodes/:id/approve-for-publish`
- `POST /episodes/:id/publish/rss`

The local UI at `http://localhost:3450/ui` includes a script review panel where
editors can paste a research packet ID, generate a draft, edit the latest
revision, and approve it for audio.
