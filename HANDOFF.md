# Podcast Forge — Orchestration Handoff

Last updated: 2026-04-27

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
cat HANDOFF.md
cat LESSONS.md
```

Verification gate for every issue:

```sh
npm run check
```

Critical: do **not** run `npx jest`. This repo uses Node test runner through package scripts.

## ACPX / Codex execution contract

Use Codex / GPT-5.5 high-thinking for ACPX coding sessions until Steven says Claude auth is fixed.

Each ACPX session should receive **one GitHub issue only** unless Sam explicitly batches work. The agent must treat the issue acceptance criteria, `AGENTS.md`, this `HANDOFF.md`, and `LESSONS.md` as the complete work order.

Required agent behavior:

1. Start by reading `AGENTS.md`, `HANDOFF.md`, and `LESSONS.md`.
2. Confirm which issue number/title it is implementing.
3. Inspect the relevant existing code before editing.
4. Keep the diff limited to that issue's scope.
5. Add or update tests for meaningful behavior.
6. Run `npm run check` before claiming completion.
7. Update `HANDOFF.md` only if orchestration state, dependencies, issue ordering, local dev commands, or blockers changed.
8. Update `LESSONS.md` only for durable repo gotchas, not routine implementation notes.
9. Commit and push if the harness has write access; otherwise leave a clear diff summary and exact verification output.
10. Never post PR reviews. Never self-review. Only comment on the GitHub issue with implementation + verification when appropriate.

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

- #14 LLM runtime: provider adapter layer and job logging ✅ merged (#31)
- #15 Prompt template registry and structured output schemas ✅ merged (#32)
- #16 LLM candidate scoring and ranking ✅ merged (#33)
- #17 Multi-candidate research packet builder
- #18 LLM script generation and revision validation ✅ implemented locally on `issue-18-script-generation`; `npm run check` passed. Commit/push may need recovery if sandbox `.git` permissions block writes.
- #19 Real production adapters for audio, cover art, and publishing ✅ implemented locally on `main` worktree because sandbox `.git/FETCH_HEAD` was read-only; `npm run check` passed. Commit/push may need recovery if sandbox `.git` permissions block writes.
- #20 Guided episode pipeline UI ✅ implemented locally on `issue-20-guided-pipeline-ui`; `npm run check` passed.
- #21 Multi-select candidate clustering UI ✅ implemented locally on `issue-21-candidate-clustering-ui`; `npm run check` passed.
- #22 Settings/admin UI for shows, sources, models, prompts, publishing ✅ implemented locally on `issue-22-settings-admin-ui`; `npm run check` passed.
- #23 Job progress, logs, warnings, and retry UI ✅ implemented locally on `issue-23-job-progress-ui`; `npm run check` passed.
- #24 Review and approval gates UI ✅ implemented locally on `issue-24-review-approval-gates`; `npm run check` passed.
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
- You are working in ~/clawd/projects/podcast-forge on exactly one GitHub issue unless told otherwise.
- Start with: git pull origin main && cat AGENTS.md && cat HANDOFF.md && cat LESSONS.md
- Confirm the issue number/title and acceptance criteria before editing.
- Skip npx jest. Use npm run check only.
- Do not make live network/model/provider calls in tests; inject fakes.
- Do not hardcode The Synthetic Lens behavior into generic code.
- Do not commit secrets, local credential paths, or private account details.
- Preserve source provenance, warnings, and approval gates.
- Keep the diff scoped to the issue; avoid drive-by rewrites.
- Update README/docs if behavior or API changes.
- Update HANDOFF.md only if orchestration/dependencies/status/blockers changed.
- If you discover a repo gotcha, append it to LESSONS.md.
- Before finishing, run npm run check.
- Finish with: files changed, verification result, commit SHA if committed, and any follow-up issue dependencies.
```


## Durable orchestration loop

Podcast Forge is an active managed sprint. Do **not** rely on session memory to keep it moving. Use these durable anchors:

- Sprint state: `~/clawd/data/podcast-forge-sprint-state.json`
- Repo handoff: this `HANDOFF.md`
- Repo agent rules: `AGENTS.md`
- Repo gotchas: `LESSONS.md`
- Rough second-pass UI direction: `docs/prototypes/second-pass-rough-ui-prototype.html` (rough draft only; preserve workflow/product intent, do not copy verbatim)
- Review/comment shepherd state: `~/clawd/data/pr-comment-shepherd/` and `~/clawd/data/pr-shepherd/`

Every heartbeat or resume should:

1. Check GitHub PRs/issues first; GitHub is truth.
2. If an agent finished but could not commit/push, Sam must copy/recover the diff into the canonical repo, run `npm run check`, open a PR, review, and merge if clean.
3. If a PR is open, finish that PR's review/shepherd/merge loop before starting the next issue.
4. If no PR/agent is active, start the next unblocked issue from the sprint state queue.
5. Update this file and sprint state whenever issue ordering, blockers, or escalation status changes.

Escalate to Steven only for:

- publication approval or external public posting,
- ambiguous product/editorial direction,
- repeated failing checks after a focused fix attempt,
- conflicting reviews where the stricter path is not obvious,
- credentials/auth/account access that cannot be safely handled locally,
- scope changes that materially alter the product direction.

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
- [ ] Review gate is satisfied: Copilot review is clean, or `node scripts/local-pr-review.mjs <PR> --mode gemini` (fallback: `--mode codex`, final fallback: `--mode static`) produced a clean local review artifact.

## Review fallback policy

Copilot review is preferred, but it is not a single point of failure. If Copilot is unavailable, quota-exhausted, delayed, or insufficient, use the local review fallback before merge.

Recommended order:

1. `node scripts/local-pr-review.mjs <PR> --mode gemini` — independent semantic review.
2. `node scripts/local-pr-review.mjs <PR> --mode codex` — Codex/GPT-5.5 high-thinking review-only fallback.
3. `node scripts/local-pr-review.mjs <PR> --mode static` — deterministic safety-net review if model CLIs are unavailable.

The implementation/fix shepherd must not be the only reviewer. Store review artifacts under `data/reviews/`. Post the review summary to the PR only from the orchestrator, clearly labeled as a local automated review fallback. If Copilot and local review disagree, prefer the stricter result or escalate to Steven.

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

## Cold-start prompt template for ACPX/Codex

Use this shape when launching a coding session:

```text
You are implementing Podcast Forge GitHub issue #<number>: <title>.

Repo: /home/steven/clawd/projects/podcast-forge
Branch: main unless instructed otherwise.

Start by running:
git pull origin main && cat AGENTS.md && cat HANDOFF.md && cat LESSONS.md

Then inspect the issue acceptance criteria and relevant code. Implement only this issue. Keep tests fake/injected; no live network/model/provider calls in tests. Do not run npx jest. Run npm run check before finishing.

If you change orchestration/dependencies/status/blockers, update HANDOFF.md. If you discover a durable repo gotcha, update LESSONS.md.

At the end, provide:
- summary of implementation
- files changed
- tests/verification output
- commit SHA if committed
- any follow-up dependencies or blockers
```

This template is intentionally repetitive. ACPX sessions may start cold; make the workflow impossible to miss.

## Local Review Fallback Checkpoint

Podcast Forge now has a durable review fallback for when GitHub Copilot review is unavailable, quota-limited, delayed, or insufficient.

Workflow:
1. Open one feature branch + PR per issue.
2. Run `npm run check` locally before PR/merge.
3. Request Copilot review when available.
4. If Copilot does not produce useful review signal, run local review:
   - Preferred: `node scripts/local-pr-review.mjs <pr-number> --mode gemini`
   - Fallback: `node scripts/local-pr-review.mjs <pr-number> --mode codex`
   - Safety net: `node scripts/local-pr-review.mjs <pr-number> --mode static`
5. Store/review the artifact under `data/reviews/`.
6. The orchestrator may post a clearly labeled local automated review summary to the PR.
7. Merge only when checks pass and the active review path is clean.

Guardrail: fix/shepherd agents must not approve or self-review their own work. If Copilot and local review disagree, prefer the stricter result or escalate to Steven.

Checkpoint reference: Issue #28 / PR #29 implemented this policy and merged successfully. Issue #28 is closed. Next build target after the fallback is Issue #14: LLM runtime/provider adapter layer and job logging.


## Second-pass UI/product sprint direction

Approved direction: use the rough prototype at `docs/prototypes/second-pass-rough-ui-prototype.html` as a design-direction artifact, not a pixel-perfect spec.

Preserve these product decisions:
- The episode production workflow is the primary UI, not the admin dashboard.
- The app should always expose a next-best-action and concrete blocker reasons.
- AI should feel like a producer/editor assistant: episode planning, source-gap surfacing, integrity review, and safe rewrites.
- Integrity review is a visible workflow gate between script generation and production.
- Admin/settings/debug surfaces should remain reachable but secondary.
- Mobile usability is first-class: stacked panels, horizontal/compact step navigation, and bottom actions where useful.

Current frontend stack remains static HTML + vanilla JS + plain CSS served by Fastify. Do not introduce React/Next/Vite/etc. unless Steven explicitly approves a frontend migration.


### Second-pass issue queue (created 2026-04-26)

Run one issue per coding agent, preferably branch/PR per issue because the static UI files are conflict-prone.

Recommended order:
1. #38 — Add Integrity Reviewer — AI quality gate between script writing and production ✅ merged (#56)
2. #44 — PF2-01 Make the guided workflow the primary UI ✅ merged (#57)
3. #45 — PF2-02 Add always-visible next-best-action and blocker explanations ✅ merged (#58)
4. #46 — PF2-03 Move admin/settings/debug surfaces out of the production flow ✅ merged (#59)
5. #51 — PF2-08 Fix script edit provenance and citation-map invalidation ✅ merged (#60)
6. #50 — PF2-07 Enforce source query domain/freshness controls or remove dead UI fields ✅ merged (#61)
7. #52 — PF2-09 Harden publishing validation and scheduled-run status semantics ✅ merged (#62)
8. #47 — PF2-04 Add AI story brief / episode plan assistant ✅ merged (#63)
9. #48 — PF2-05 Add AI source-gap and claim-coverage surfacing in review UI ✅ merged (#64)
10. #49 — PF2-06 Add AI rewrite/coaching actions for scripts without bypassing approval ✅ merged (#65)
11. #53 — PF2-10 Split UI state/render helpers into testable modules or sections ✅ merged (#66)
12. #54 — PF2-11 Replace destructive/critical prompts with explicit confirmation dialogs ✅ merged (#68)
13. #55 — PF2-12 Add local UI smoke checks for the guided flow ✅ merged (#69)

## Third-pass UI architecture sprint — Produce view-model + Production Cockpit

Created: 2026-04-27
Sprint plan: `/home/steven/clawd/data/podcast-forge-vm-sprint-2026-04-27/SPRINT_PLAN.md`
Sprint state: `~/clawd/data/podcast-forge-sprint-state.json`

Goal: introduce a proper static frontend view-model layer and render the Produce workflow as a guided Production Cockpit, without starting a framework migration.

Constraints:
- Keep the static frontend stack for this sprint: `packages/api/public/index.html`, split `ui-*.js` modules, `styles.css`, and Fastify static routes.
- One GitHub issue per coding agent.
- One branch/worktree/PR per issue because Produce/UI files remain conflict-prone.
- Merge/review gate between issues: `npm run check`, Copilot dynamic log inspection when available, local review fallback when needed.
- Skip `npx jest`; use package scripts only.
- No live provider/model/network calls in tests.
- Preserve source provenance, warnings, approval gates, and auditability.

Recommended order:
1. #75 — PF3-01 Define Produce workspace view-model contract and fixtures ✅ merged (#83)
2. #76 — PF3-02 Render sticky Production Command Bar from view-model ✅ merged (#84)
3. #77 — PF3-03 Render compact 8-stage tracker and expand only current stage ✅ merged (#85)
4. #78 — PF3-04 Separate active production artifacts from historical/archive artifacts ✅ merged (#86)
5. #79 — PF3-05 Redesign Story Sources selector and source search controls ✅ merged (#88)
6. #80 — PF3-06 Move action feedback and job result summaries into workflow context ✅ merged (#89)
7. #67 — PF3-06B Make generated audio assets accessible from local UI ✅ merged (#90)
8. #81 — PF3-07 Replace ambiguous workflow labels and improve accessibility semantics
9. #82 — PF3-08 Add UI architecture guardrails for view-model rendering and complexity

#67 is no longer backlog for this pass; treat it as part of the PF3 sprint queue.
