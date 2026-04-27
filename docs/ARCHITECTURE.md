# Architecture

## System overview

Podcast Forge is split into three apps:

1. **API server** — HTTP API, config CRUD, approvals, DB access.
2. **Web app** — command center UI.
3. **Worker** — long-running jobs: search, fetch, research, script, audio, art, publish.

Shared database: Postgres.
Shared storage: local filesystem in dev; S3/R2-compatible object storage in production.

## Core entities

See [UX glossary](UX_GLOSSARY.md) for how these backend entity names map to
user-facing labels in the app.

- `shows`
- `feeds`
- `source_profiles`
- `source_queries`
- `model_profiles`
- `prompt_templates`
- `story_candidates`
- `source_documents`
- `episode_candidates`
- `research_packets`
- `episodes`
- `episode_assets`
- `scheduled_pipelines`
- `jobs`
- `approval_events`
- `publish_events`

## Job types

- `source.search`
- `source.fetch`
- `episode.plan`
- `story.score`
- `episode.cluster`
- `research.packet`
- `script.generate`
- `script.polish`
- `audio.preview`
- `art.generate`
- `publish.rss`
- `analytics.sync`
- `pipeline.scheduled`
- `legacy.shell`

## Agent role adapters

Each agent role is an adapter over model providers:

- `query_expander`
- `episode_planner`
- `candidate_scorer`
- `source_summarizer`
- `claim_extractor`
- `research_synthesizer`
- `script_writer`
- `script_editor`
- `integrity_reviewer`
- `metadata_writer`
- `cover_prompt_writer`

The app should not hardcode model names in business logic. It should resolve `show.defaultModelProfile[role]` at runtime.

Prompt templates are a separate registry from model profiles. Model profiles may
point at a `promptTemplateKey`, while the prompt registry resolves a
show-specific DB template or a global default, validates required variables, and
returns LLM runtime messages plus structured JSON response hints. Output
validators live with the prompt domain so downstream workers can validate model
JSON before persisting generated scoring, research, script, metadata, or art
prompt records.

## Source adapters

V1:

- Brave search/news.
- RSS feed.
- Manual URL.
- Local JSON import.

Each adapter emits normalized `story_candidates` with raw provider payload attached.

## Storage layout

Recommended object keys:

```text
shows/{showSlug}/episodes/{episodeSlug}/script.txt
shows/{showSlug}/episodes/{episodeSlug}/audio-preview.mp3
shows/{showSlug}/episodes/{episodeSlug}/cover.png
shows/{showSlug}/sources/{sourceDocumentId}.md
shows/{showSlug}/research/{researchPacketId}.json
```

## Safety gates

Public publishing requires:

- episode has approved script or approved preview audio.
- required assets exist.
- asset and feed public URLs are valid HTTP(S) when configured.
- research warnings resolved or explicitly overridden.
- publish target configured.
- user-triggered publish action.

Scheduled pipeline publishing follows the same rule. A recurring pipeline can
prepare or queue publish work, but RSS publication stays blocked on approval
unless the schedule is explicitly configured for autopublish.

Production adapters are injectable. The default development adapters are
deterministic local fakes that create placeholder files and persist local path,
object key, URL, duration, size, MIME, checksum, provider, adapter, warnings,
and prompt metadata. Real TTS/image/storage/RSS adapters should stay behind the
same contracts so tests can continue to run without live provider calls.

Publishing is idempotent by episode/feed GUID. A second publish call for an
already-published episode is a no-op unless the caller sets `republish: true`,
which requires a changelog and writes an explicit publish event.

## Migration strategy from current tools

1. Import existing TSL/Byte Sized story JSON into `story_candidates`.
2. Create `scheduled_pipelines` records for existing TSL, Byte Sized, and
   Executive Lens cron cadences, preserving current shell commands in
   `legacyAdapter.command`.
3. Wrap existing production scripts behind worker adapters.
4. Replace JSON state files with DB reads/writes.
5. Port current TSL UI features into the new web app.
6. Gradually retire old command center endpoints.
