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

Active MVP build. See:

- [PRD](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [UX glossary](docs/UX_GLOSSARY.md)
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

## Story sources UI

Story sources, called source profiles in backend/API code, and search queries
are persisted in Postgres through the `@podcast-forge/db` schema. To run the app
locally:

```sh
cp .env.example .env
docker compose up -d postgres
npm run db:migrate --workspace @podcast-forge/db
npm run db:seed --workspace @podcast-forge/db
npm run dev --workspace @podcast-forge/api
```

Open `http://localhost:3450/ui` to edit story sources and search queries for
`the-synthetic-lens`. The UI can enable or disable story sources and individual
queries, edit query text, freshness, include/exclude domains, and weights, and
create or delete search queries.

The same local UI now starts with a guided episode pipeline. It walks each show
through choosing a story source/search recipe, finding candidate stories,
selecting and grouping candidate stories, building a research brief, drafting a
script, creating audio/cover previews, recording review decisions, and
publishing to RSS. Wired stages call the existing API endpoints; unavailable
source types or incomplete approval steps are shown as blocked/disabled instead
of failing the page.

## New show onboarding

Shows can be added from the local UI with `New Show`. The onboarding form
creates the show in `draft` or `active` setup state, adds a feed, creates a
starter story source/search query, and seeds AI role settings for each supported
model role. Draft shows are returned by `GET /shows`, so setup can be completed
over time without editing seed data, config files, or the database directly.

Show/feed endpoints:

- `GET /shows`
- `POST /shows`
- `PATCH /shows/:id`
- `GET /shows/:showSlug/feeds`
- `POST /shows/:showSlug/feeds`
- `PATCH /feeds/:id`

## Settings/admin UI

The local UI also includes a show-scoped Settings area with tabs for:

- Shows & feeds
- Story sources/search recipes
- Model roles
- Prompt templates
- Publishing/storage
- Scheduled pipelines

Wired sections use the existing show/feed, source profile/query, model profile,
prompt template, and scheduler endpoints. Prompt templates are currently
read-only because the backend exposes list/detail/render routes but not
create/update routes. Publishing settings show public URLs, RSS paths, storage
target labels, OP3 status, and approval/autopublish safety state without
displaying secrets, API keys, or local credential paths.

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

## AI role routing

Model choices are runtime configuration, not code constants. The supported
roles are `candidate_scorer`, `source_summarizer`, `claim_extractor`,
`research_synthesizer`, `script_writer`, `script_editor`, `metadata_writer`,
and `cover_prompt_writer`.

Seeded configs write each `models` entry into `model_profiles` with
provider/model, params, fallbacks, prompt template key, and budget. Worker-style
tasks resolve the active profile by show and role at runtime. `source.search`
records the resolved `candidate_scorer`; research brief generation records
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
- `GET /jobs?showSlug=the-synthetic-lens&limit=30`
- `GET /jobs/:id`
- `GET /story-candidates?showSlug=the-synthetic-lens`
- `POST /research-packets` accepts `{ candidateIds, extraUrls, angle, notes, targetFormat, targetRuntime }`

The local UI includes a show-scoped **Task Runs** panel at `/ui`. It lists
recent source, scheduled, research, script, production, and publishing jobs,
polls active runs every five seconds, and opens a detail view with logs,
warnings, stack-safe failure messages, retryability, linked artifact IDs, and
collapsed sanitized debug metadata. Scheduled-run retries use
`POST /scheduled-pipeline-runs/:jobId/retry`; failed audio and cover jobs retry
through the existing production endpoints and send `retryOfJobId` so the new
job can be linked back to the original. RSS publish jobs are never auto-retried
from the task panel.

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

## Research briefs

The UI calls these records research briefs. Backend/API code and route paths
still use `research_packets` and `/research-packets` for stable identifiers.

Selected candidate stories can produce evidence-first research briefs. The API
fetches readable source snapshots into `source_documents`, then writes a
`research_packets` row with source document references, cited claims, citation
URLs, warning objects, synthesis content, and readiness metadata. When injected
model runtime support is available, research uses the configured
`claim_extractor` and `research_synthesizer` roles; otherwise it falls back to
deterministic packet content from fetched source snapshots.

Build a packet from the candidate URL plus optional extra URLs:

```sh
curl -X POST http://localhost:3450/story-candidates/:id/research-packet \
  -H 'content-type: application/json' \
  -d '{"extraUrls":["https://example.org/second-source"]}'
```

Build a packet from multiple selected candidates:

```sh
curl -X POST http://localhost:3450/research-packets \
  -H 'content-type: application/json' \
  -d '{
    "candidateIds":["CANDIDATE_ID_1","CANDIDATE_ID_2"],
    "angle":"Why this cluster matters now",
    "extraUrls":["https://example.org/primary-source"]
  }'
```

The multi-candidate endpoint validates that all selected candidates exist,
belong to the same show, and are not ignored. Duplicate candidate IDs and
duplicate source URLs are recorded as warnings and skipped once. Fetch or model
failures are persisted in packet/job warnings and never create citations unless
there is a fetched `source_documents` row behind the claim.

Read and override warnings:

```sh
curl "http://localhost:3450/research-packets?showSlug=the-synthetic-lens"
curl http://localhost:3450/research-packets/:id

curl -X POST http://localhost:3450/research-packets/:id/override-warning \
  -H 'content-type: application/json' \
  -d '{"warningId":"INSUFFICIENT_INDEPENDENT_SOURCES","reason":"Editor approved with direct source material.","actor":"local-user"}'

curl -X POST http://localhost:3450/research-packets/:id/approve \
  -H 'content-type: application/json' \
  -d '{"actor":"editor@example.com","reason":"Sources, claims, citations, and warnings reviewed."}'
```

Research endpoints:

- `POST /story-candidates/:id/research-packet`
- `POST /research-packets`
- `GET /research-packets?showSlug=the-synthetic-lens`
- `GET /research-packets/:id`
- `POST /research-packets/:id/override-warning`
- `POST /research-packets/:id/approve`

Packet `status` is a readiness value: `ready`, `needs_more_sources`, or
`blocked`. The same object is also available at `content.readiness` with reasons
and counts such as `independentSourceCount`, `usableSourceCount`, and
`selectedCandidateCount`. Script generation should consume packet `claims`,
`citations`, `sourceDocumentIds`, and `warnings`, and should surface non-ready
or warning-bearing packets for editorial review before production. Research
approval records an `approval_events` row with gate `research-brief`; approval is
blocked until the packet is ready and all warnings have explicit override
reasons.

## Script generation workflow

Research packets can produce LLM-backed editable script drafts. The
`script.generate` job resolves the show-specific `script_writer` model profile,
renders the configured prompt template, validates the structured model output,
and records routing/runtime metadata in the job output and initial script
revision. Tests and local development can inject the deterministic `fake` LLM
runtime; if no runtime/profile is available, generation falls back to the
deterministic draft builder.

Generated revisions store `metadata.citationMap`, `metadata.provenance`, and
`metadata.validation` so reviewers can see which research packet, claim IDs,
source document IDs, citation URLs, model runtime, and warning state produced
the draft. If a model omits citation metadata or the packet contains claims
without usable provenance, the revision records explicit missing-provenance
warnings. Packets with `status: "blocked"` or `content.readiness.status:
"blocked"` are rejected before a script is persisted.

Generate a script from a research packet:

```sh
curl -X POST http://localhost:3450/research-packets/:id/script \
  -H 'content-type: application/json' \
  -d '{"format":"feature-analysis","actor":"editor@example.com"}'
```

Human edits are saved as new immutable revisions instead of silently
overwriting the previous body. Human edit revisions preserve the previous
revision's citation/provenance metadata and add fresh validation metadata.
Speaker labels such as `DAVID:` must match a configured cast member for the
show; unknown model-generated or human-entered speaker labels are rejected.

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
`art.generate` jobs with stage/progress logs, provider metadata, retryable
failure metadata, and links output rows in `episode_assets`.

The default development adapters are fake/local and deterministic. They write
placeholder audio and image files under `production.localAssetDir`,
`production.outputDir`, or `/tmp/podcast-forge-production-assets`, then persist
duration, byte size, MIME type, checksum, object key, local path, provider, and
adapter metadata for review screens. Tests inject fake adapters and never call
live audio, image, storage, or RSS providers.

```sh
curl -X POST http://localhost:3450/scripts/:id/production/audio-preview \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com"}'

curl -X POST http://localhost:3450/scripts/:id/production/cover-art \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com","prompt":"Quiet editorial cover art with abstract waveform lines."}'

curl http://localhost:3450/scripts/:id/production
```

If no cover prompt is provided and an LLM runtime plus `cover_prompt_writer`
profile is configured, the cover-art job uses the prompt registry and stores the
prompt-writer output and invocation metadata with the job and asset. Otherwise
it falls back to a deterministic prompt from the show, script, and research
packet context.

Production endpoints:

- `GET /scripts/:id/production`
- `POST /scripts/:id/production/audio-preview`
- `POST /scripts/:id/production/cover-art`

## Approval-gated RSS publishing

Episodes must reach `approved-for-publish` before `publish.rss` can update a
feed. The endpoint returns `PUBLISH_BLOCKED` with `blockedReasons` when research
approval, warning overrides, publish approval, feed config, or required
audio/cover assets are missing or unsafe. The publish
job uploads the selected audio and cover art through the configured feed storage
adapter, preserves the feed OP3 wrapping setting and metadata, upserts the RSS
item by episode/feed GUID, validates the resulting public URLs, records a
`publish_events` audit row, and marks the episode `published`.

Publishing an already-published episode without `republish: true` is an
idempotent no-op and returns the stored publish metadata without re-uploading
assets or mutating RSS. Explicit re-publish requires `republish: true` and a
non-empty `changelog`.

```sh
curl -X POST http://localhost:3450/episodes/:id/approve-for-publish \
  -H 'content-type: application/json' \
  -d '{"actor":"producer@example.com","reason":"Final assets approved."}'

curl -X POST http://localhost:3450/episodes/:id/publish/rss \
  -H 'content-type: application/json' \
  -d '{"actor":"publisher@example.com"}'

curl -X POST http://localhost:3450/episodes/:id/publish/rss \
  -H 'content-type: application/json' \
  -d '{"actor":"publisher@example.com","republish":true,"changelog":"Corrected feed metadata."}'
```

Publishing endpoints:

- `POST /episodes/:id/approve-for-publish`
- `POST /episodes/:id/publish/rss`

The local UI at `http://localhost:3450/ui` includes a Review Gates panel where
editors can inspect research sources, claims, citations, warnings, script
validation/provenance, audio and cover previews, asset metadata, and the publish
readiness checklist. The checklist blocks publish approval and RSS publishing
until research is approved, warnings are overridden, the selected script is
approved for audio, audio and cover assets are valid, feed/RSS targets are
configured, and the final publish action is explicit.
