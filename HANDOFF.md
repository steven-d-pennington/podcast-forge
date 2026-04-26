# Podcast Forge — Orchestration Handoff

Last updated: 2026-04-26

This is the mission-control document for orchestrating the next Podcast Forge build wave. It sits above the GitHub issues and tells Sam/agents what order to run them in, what depends on what, and how to verify progress.

## North Star

Podcast Forge exists to produce reliably sourced, clearly attributed, evidence-first podcast/news episodes. Quality and editorial integrity beat raw automation speed.

Agents must preserve:

- source provenance
- explicit uncertainty/warnings
- human approval before public publishing
- configurable show/model/source settings
- auditability for every generated claim, asset, and publish action

## Repo / runtime basics

- Repo: `steven-d-pennington/podcast-forge`
- Local path: `~/clawd/projects/podcast-forge`
- Branch: `main`
- Package manager: npm workspaces
- API package: `packages/api`
- DB package: `packages/db`
- DB: Postgres via docker-compose, default port 5544
- API dev server: `npm run dev --workspace @podcast-forge/api`, default port 3450

Before any coding task:

```sh
git pull origin main
cat AGENTS.md
cat LESSONS.md
```

Verification gate for every issue:

```sh
npm run check
```

Critical: do **not** run `npx jest`. This repo uses Node test runner through package scripts.

## Current state snapshot

Already shipped/closed:

- #1 DB/schema foundation
- #2 config loader/validation
- #3 source profile CRUD/API/UI
- #4 Brave search + candidate ingestion
- #5 RSS + manual URL adapters
- #6 research packet builder v1
- #7 model profile routing
- #8 script generation workflow v1
- #9 audio/art jobs v1
- #10 RSS publishing adapter v1
- #11 legacy data import
- #12 scheduler
- #13 show onboarding wizard

Open build wave:

- #14 LLM runtime: provider adapter layer and job logging
- #15 Prompt template registry and structured output schemas
- #16 LLM candidate scoring and ranking
- #17 Multi-candidate research packet builder
- #18 LLM script generation and revision validation
- #19 Real production adapters for audio, cover art, and publishing
- #20 Guided episode pipeline UI
- #21 Multi-select candidate clustering UI
- #22 Settings/admin UI for shows, sources, models, prompts, publishing
- #23 Job progress, logs, warnings, and retry UI
- #24 Review and approval gates UI
- #25 UX terminology and inline help cleanup

## Recommended execution plan

### Lane A — Backend/model foundation

Run sequentially. These establish shared contracts and should not be parallelized unless agents coordinate carefully.

1. **#14 — LLM runtime**
   - Foundational runtime/provider adapter layer.
   - Needed by #16, #17, #18, partially #19.

2. **#15 — Prompt registry/schemas**
   - Depends conceptually on #14 but can be implemented adjacent if runtime is not merged yet.
   - Needed by #16, #17, #18, #22.

### Lane B — Backend pipeline features

Run after #14/#15, preferably sequential because each stage consumes the previous stage’s outputs.

3. **#16 — Candidate scoring**
   - Uses `candidate_scorer` role.
   - Feeds UI ranking and candidate selection.

4. **#17 — Multi-candidate research packets**
   - Uses selected candidates + source fetch/snapshots + claim extraction/synthesis.
   - Feeds script generation and review gates.

5. **#18 — Script generation/revisions**
   - Consumes research packets.
   - Produces script revisions/provenance/readiness for production/review.

6. **#19 — Production adapters**
   - Uses approved/ready scripts.
   - Produces audio/art/publish assets and hardens publishing gates.

### Lane C — UI/product shell

Can start after #14/#15 are underway, but best results come once #16/#17 APIs are at least shaped.

7. **#25 — UX terminology + inline help**
   - Can run early. Low backend risk.
   - Improves all later UI work.

8. **#20 — Guided episode pipeline UI**
   - Main workflow shell.
   - Should gracefully show placeholders for missing backend pieces.

9. **#22 — Settings/admin UI**
   - Uses show/feed/source/model/prompt/schedule endpoints.
   - Can run in parallel with #20 if agents coordinate UI files.

10. **#21 — Multi-select candidate clustering UI**
   - Best after #16/#17 and ideally after #20.

11. **#23 — Job progress/logs/retry UI**
   - Best after #19 or when richer jobs exist.
   - Can add a generic job panel earlier if careful.

12. **#24 — Review and approval gates UI**
   - Run late. It depends on research/script/production artifacts and approval event behavior.

## Practical orchestration batches

### Batch 1: foundation

- Dispatch #14.
- Verify `npm run check`.
- Merge/commit/push.
- Dispatch #15.
- Verify `npm run check`.

### Batch 2: backend pipeline

- Dispatch #16, then #17, then #18, then #19.
- Do one at a time unless there is a compelling reason to parallelize.
- After each issue, inspect diff for hardcoded TSL assumptions and missing tests.

### Batch 3: UI shell

- Dispatch #25 first.
- Then #20 and #22 can be parallel if agents are warned about UI file conflicts.
- Prefer sequential if using a single static UI file.

### Batch 4: integration UI

- Dispatch #21 after candidate/research APIs are real.
- Dispatch #23 after job metadata is rich enough.
- Dispatch #24 last.

## Agent task prompt footer

Every coding agent task should include:

```text
CRITICAL:
- Start with: git pull origin main && cat LESSONS.md
- Read AGENTS.md before coding.
- Skip npx jest. Use npm run check only.
- Do not make live network/model/provider calls in tests; inject fakes.
- Do not hardcode The Synthetic Lens behavior into generic code.
- Do not commit secrets, local credential paths, or private account details.
- Preserve source provenance, warnings, and approval gates.
- Before finishing, run npm run check.
- If you discover a repo gotcha, append it to LESSONS.md.
```

## Merge/review checklist per issue

Before accepting an agent result:

- [ ] Diff matches the GitHub issue scope.
- [ ] No unrelated rewrites.
- [ ] No committed secrets or local private paths.
- [ ] No TSL-only assumptions in generic pipeline code.
- [ ] Tests added/updated for meaningful behavior.
- [ ] `npm run check` passes.
- [ ] README/docs updated if behavior/API changed.
- [ ] LESSONS.md updated if a gotcha was discovered.
- [ ] GitHub issue comment includes files changed + verification output.

## Known constraints / preferences

- Steven’s Claude account is currently expired/unreliable. Use Codex/GPT-5.5 high-thinking for ACPX/coding agents until told otherwise.
- For direct local work, prefer focused commits and small diffs.
- Keep OpenClaw main session lean; heavy coding should happen in agents or background processes.
- If `sessions_spawn(runtime="acp")` fails repeatedly, use direct `npx acpx` / Codex invocation pattern from global AGENTS guidance.

## Current local dev commands

```sh
cp .env.example .env
docker compose up -d postgres
DATABASE_URL="postgres://podcast_forge:podcast_forge@localhost:5544/podcast_forge" npm run db:migrate --workspace @podcast-forge/db
DATABASE_URL="postgres://podcast_forge:podcast_forge@localhost:5544/podcast_forge" npm run db:seed --workspace @podcast-forge/db
DATABASE_URL="postgres://podcast_forge:podcast_forge@localhost:5544/podcast_forge" npm run dev --workspace @podcast-forge/api
```

Open UI:

```text
http://localhost:3450/ui
```

Health check:

```sh
curl http://localhost:3450/health
```

## Issue dependency graph

```text
#14 LLM runtime
  ├─ #16 candidate scoring
  ├─ #17 research packet v2
  ├─ #18 script generation/revisions
  └─ #19 production adapters (partial)

#15 prompt registry/schemas
  ├─ #16 candidate scoring
  ├─ #17 research packet v2
  ├─ #18 script generation/revisions
  └─ #22 settings/admin prompts

#16 candidate scoring
  ├─ #17 multi-candidate packets
  ├─ #20 pipeline UI
  └─ #21 clustering UI

#17 research packets
  ├─ #18 script generation
  ├─ #21 clustering UI
  └─ #24 review gates

#18 scripts
  ├─ #19 production adapters
  └─ #24 review gates

#19 production/publishing
  ├─ #23 job UI
  └─ #24 review gates

#25 terminology/help
  ├─ #20 pipeline UI
  └─ #22 settings/admin UI
```

## Standing open question

Decide whether to keep all work directly on `main` for speed or switch to PR branches for each issue. Current repo has been moving fast on `main`; if multiple agents run concurrently, branches become safer.
