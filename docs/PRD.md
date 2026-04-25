# PRD: Podcast Forge

## 1. Summary

Podcast Forge is an agent-powered podcast building tool for producing research-backed episodes from configurable source profiles. It combines news/search ingestion, source fetching, evidence clustering, research agents, script-writing agents, TTS/art production, human approval gates, RSS publishing, and analytics tracking in one packaged app.

The first production target is **The Synthetic Lens** workflow currently running through the local TSL Command Center and Byte Sized scripts. The product should be designed as multi-show and configurable from the start.

## 2. Problem

The current pipeline works, but it is script-heavy and brittle:

- Search sources and queries are hardcoded.
- Story candidates live in JSON files.
- Research/source evidence is not first-class enough.
- Model choices are spread across scripts/prompts.
- Publishing has safety gates but not a clean job model.
- Adding another show requires duplicating scripts and conventions.

Creators need a configurable system that can repeatedly turn source material into publishable podcast episodes while preserving editorial control and evidence.

## 3. Target users

### Primary

- Steven/Sam producing The Synthetic Lens and adjacent shows.

### Future

- Independent creators who want AI-assisted research-backed podcast production.
- Newsletter/podcast operators who need recurring episode workflows.
- Agencies producing client podcasts with human approval gates.

## 4. Core use cases

1. Configure a show: title, feed, voice cast, tone, runtime targets, publishing destination.
2. Configure source profiles: Brave/news queries, RSS feeds, domains, blocked domains, source freshness, scoring weights.
3. Run a fresh search and ingest story candidates.
4. Cluster related stories into episode candidates.
5. Fetch and snapshot source documents.
6. Build a research packet with claims, citations, and warnings.
7. Generate a script using a configurable script model/profile.
8. Generate preview audio and cover art.
9. Review, override warnings, approve production/publishing.
10. Publish to RSS/storage and record analytics metadata.

## 5. Product principles

- **Evidence first:** Every factual script claim should trace back to source documents where possible.
- **Human approval before public output:** Publishing requires explicit approval state.
- **Config over code:** Sources, models, voice maps, prompts, and gates should be editable without code changes.
- **Multi-show by design:** Do not bake in TSL-only assumptions.
- **Self-hostable first:** Local-first Postgres + file/object storage. SaaS can come later.
- **Job visibility:** Long-running tasks need status, logs, retry, and failure reasons.

## 6. Functional requirements

### 6.1 Show management

- Create/edit shows.
- Store feed metadata, RSS path/URL, storage target, default artwork style, episode numbering policy.
- Store format templates: daily brief, feature episode, interview, fiction/radio-play, etc.

### 6.2 Source profiles

A source profile defines where story candidates come from and how they are scored.

Required source types for v1:

- Brave News/Search query list.
- RSS feeds.
- Manual URL submission.
- Local file import for current Byte Sized/TSL compatibility.

Later source types:

- Hacker News.
- Reddit.
- YouTube transcripts.
- GitHub releases/issues.
- Arxiv/Semantic Scholar.
- Email/newsletters.

Source profiles should support:

- enabled/disabled sources.
- query strings.
- freshness windows.
- include/exclude domains.
- language/region.
- per-source priority/weight.
- rate-limit settings.

### 6.3 Model routing/configuration

Configurable agent roles:

- search/query expansion model.
- relevance/scoring model.
- source summarizer model.
- claim extractor model.
- research synthesis model.
- script writer model.
- script editor/polish model.
- title/description model.
- cover prompt model.

Each role should support:

- provider/model.
- temperature/top_p where supported.
- max tokens.
- budget cap per job.
- fallback models.
- prompt template/version.

### 6.4 Story candidate pipeline

- Run source profile search.
- Dedupe by URL and normalized title.
- Persist raw result, source metadata, query/source origin.
- Score candidates for significance, fit, novelty, and source quality.
- Allow user to shortlist/ignore/merge candidates.

### 6.5 Research packets

- Fetch readable content for source URLs.
- Snapshot raw text/markdown plus fetch timestamp.
- Extract claims and supporting citations.
- Cluster sources around an episode angle.
- Detect weak-source warnings:
  - fewer than N independent sources.
  - source inaccessible.
  - circular sourcing/syndicated duplicates.
  - high-stakes claim without primary source.
- Allow editorial override with reason.

### 6.6 Script generation

- Generate scripts from selected episode candidate + research packet.
- Support configurable format templates.
- Preserve citation map internally even if not read aloud.
- Support revision passes and human edits.
- Validate speaker labels against show cast.

### 6.7 Audio/art production

- Generate preview audio from approved script.
- Generate cover art or use uploaded art.
- Track production jobs with logs/progress.
- Support multiple TTS providers via adapter:
  - Gemini/Vertex AI initially.
  - ElevenLabs later/optional.
- Normalize and validate audio duration/metadata.

### 6.8 Approval and publishing

- Approval states:
  - draft
  - research-ready
  - script-ready
  - approved-for-audio
  - audio-ready
  - approved-for-publish
  - published
- Publishing should upload audio/art, update RSS, record feed GUID, and validate public URLs.
- Publishing must be idempotent.
- Re-publishing requires explicit action and changelog.

### 6.9 Analytics

- Store published episode metadata.
- Support OP3-wrapped audio URLs.
- Later: ingest OP3/download analytics and display trends.

## 7. Non-functional requirements

- Self-hostable on a single machine.
- Postgres-backed persistence.
- No secrets committed to repo.
- Long-running jobs survive page refresh.
- Clear logs and failure recovery.
- Minimal viable UI should remain fast and simple.

## 8. Suggested stack

- TypeScript monorepo.
- API: Node.js/Fastify or Express.
- Web: React/Vite or Next.js.
- Worker: Node job runner.
- DB: Postgres + Drizzle or Prisma.
- Queue: start with DB-backed jobs; upgrade to BullMQ/Redis later if needed.
- Storage: local filesystem + S3/R2 adapter.

## 9. MVP scope

MVP should productize the existing TSL flow:

1. Postgres schema and migrations.
2. Configurable show/source/model profiles.
3. Brave search + RSS/manual URL ingestion.
4. Candidate scoring and story list UI.
5. Research packet creation with source snapshots.
6. Script generation for TSL-style episodes.
7. Preview audio/art job tracking.
8. Approval-gated RSS publishing.
9. Import adapter for existing TSL/Byte Sized JSON data.

## 10. Out of scope for MVP

- Multi-tenant SaaS auth/billing.
- Mobile app.
- Full analytics dashboard.
- Marketplace of templates.
- Fully automated publishing without human approval.

## 11. Open questions

- Should the first public release be generic Podcast Forge or explicitly TSL-branded internally?
- Should SQLite be supported for lightweight installs, or Postgres only?
- Which providers/models should be first-class in v1 config?
- Should source fetching archive full HTML, markdown only, or both?
- How much of the current TSL Command Center UI should be ported vs redesigned?
