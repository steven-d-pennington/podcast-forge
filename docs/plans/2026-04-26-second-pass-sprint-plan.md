# Podcast Forge Second-Pass Sprint Plan

> **For Hermes/Sam:** Use the Podcast Forge `HANDOFF.md` workflow. One GitHub issue per coding agent. Use Codex/GPT-5.5 high-thinking until Claude auth is restored. Do **not** run `npx jest`; use `npm run check`.

**Goal:** Convert the first-pass functional/admin UI into a guided, AI-powered editorial production workflow while hardening the major audit findings that can hurt trust, safety, or maintainability.

**Architecture:** Keep the existing Fastify + vanilla public UI architecture for this pass, but isolate workflow helpers inside `packages/api/public/ui.js` enough to stop making every change a 4,400-line spelunking expedition. Prioritize the creator/editor journey: show → source/story → evidence brief → script → AI integrity review → production → approval → publish. Backend work must preserve source provenance, uncertainty, approval gates, and auditability.

**Rough UI prototype:** `docs/prototypes/second-pass-rough-ui-prototype.html` is a rough design-direction prototype only. It communicates product character, workflow hierarchy, mobile-first navigation, the next-best-action concept, the visible AI integrity gate, and admin/debug separation. It is **not** a final visual spec and should not be copied verbatim.

**Frontend stack:** Current frontend is static HTML + vanilla JS + plain CSS served by Fastify: `packages/api/public/index.html`, `packages/api/public/ui.js`, and `packages/api/public/styles.css`. No React, Next, Vite, Vue, Svelte, or build pipeline for this pass.

**Tech Stack:** npm workspaces, Fastify API (`packages/api/src`), DB package (`packages/db`), static UI (`packages/api/public/ui.js`, `styles.css`, `index.html`), Node test runner via `npm run check`.

---

## Workflow Contract for This Sprint

Before each coding ticket:

```sh
cd /home/steven/clawd/projects/podcast-forge
git pull origin main
cat AGENTS.md
cat HANDOFF.md
cat LESSONS.md
```

Agent contract:
- One issue per agent unless Steven explicitly approves batching.
- Branch per issue is preferred for this second pass because the UI file is a conflict magnet.
- Keep diffs scoped. No drive-by rewrites.
- Add/update tests for meaningful behavior.
- No live network/model/provider calls in tests; inject fakes.
- Preserve source provenance, warnings, editorial approvals, and audit trail.
- Run `npm run check` before completion.
- Use review gate from `HANDOFF.md`: Copilot if available, otherwise `node scripts/local-pr-review.mjs <PR> --mode gemini`, fallback `--mode codex`, fallback `--mode static`.

Recommended branch prefix: `second-pass/<ticket-id-slug>`.

---

## Sprint Sequencing

### Batch 0 — Already Open / Highest AI Leverage
1. **Existing #38 — Add Integrity Reviewer — AI quality gate between script writing and production**

### Batch 1 — Workflow-first UI Shell
2. **#44 / PF2-01 — Make the guided workflow the primary UI**
3. **#45 / PF2-02 — Add always-visible next-best-action and blocker explanations**
4. **#46 / PF2-03 — Move admin/settings/debug surfaces out of the production flow**

### Batch 2 — AI-powered editorial assistance
5. **#47 / PF2-04 — Add AI story brief / episode plan assistant**
6. **#48 / PF2-05 — Add AI source-gap and claim-coverage surfacing in the review UI**
7. **#49 / PF2-06 — Add AI rewrite/coaching actions for scripts without bypassing approval**

### Batch 3 — Trust, safety, and data correctness hardening
8. **#50 / PF2-07 — Enforce source query domain/freshness controls or remove dead UI fields**
9. **#51 / PF2-08 — Fix script edit provenance and citation-map invalidation**
10. **#52 / PF2-09 — Harden publishing validation and scheduled-run status semantics**

### Batch 4 — Maintainability / polish
11. **#53 / PF2-10 — Split UI state/render helpers into testable modules or sections**
12. **#54 / PF2-11 — Replace destructive/critical prompts with explicit confirmation dialogs**
13. **#55 / PF2-12 — Add local UI smoke checks for the guided flow**

---

# Ticket Drafts

## Existing #38 — Add Integrity Reviewer — AI quality gate between script writing and production

**Why:** This is the strongest AI-powered improvement. It makes the app feel like an editorial assistant instead of a button farm, and it protects the North Star: sourced, unbiased, uncertainty-aware news.

**Likely files:**
- `packages/api/src/scripts/*`
- `packages/api/src/research/*`
- `packages/api/src/models/*`
- `packages/api/src/prompts/*`
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`
- tests near affected API modules

**Acceptance criteria:**
- Add an `integrity_reviewer` model role or equivalent explicit review profile.
- Review consumes script revision + research packet + source/citation metadata.
- Produces structured output: verdict, claim issues, missing citations, unsupported certainty, bias/sensationalism warnings, suggested fixes.
- Production/audio generation is blocked unless integrity review is clean or explicitly overridden with reason.
- UI shows review status and unresolved issues in the script/review stage.
- Tests use fake model responses and fake stores.
- `npm run check` passes.

---

## PF2-01 — Make the guided workflow the primary UI

**Objective:** Reframe the app around the 8-step editorial production journey instead of a dense admin dashboard.

**Problem:** Audit/dogfood found the UI communicates “operator/admin console” more than “guided creator workflow.” The pipeline exists, but it is not dominant enough.

**Likely files:**
- `packages/api/public/index.html`
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`
- `packages/api/src/app.test.ts` if static UI assertions need updates

**Implementation notes:**
- Make the pipeline/wizard the top-level experience after show selection.
- Define user-facing stage names:
  1. Choose show
  2. Find story candidates
  3. Pick / cluster story
  4. Build evidence brief
  5. Generate script
  6. Integrity review
  7. Produce audio/cover
  8. Approve and publish
- Keep existing panels reachable, but subordinate them to the active stage.
- Avoid backend terminology in primary labels.

**Acceptance criteria:**
- On `/ui`, a user can immediately tell what stage they are in and what comes next.
- The selected show and current episode/story context are visible near the top.
- Stage cards link/scroll to their relevant panels.
- Existing actions remain available; no workflow regression.
- No debug JSON in the main workflow.
- Browser console has no new errors during basic navigation.
- `npm run check` passes.

**Single-agent boundary:** UI layout and stage hierarchy only. Do not change backend stage semantics.

---

## PF2-02 — Add always-visible next-best-action and blocker explanations

**Objective:** Make disabled buttons and blocked stages explain themselves without making the user reverse-engineer state.

**Problem:** Audit found many disabled actions with weak/non-obvious blockers. The app knows why things are blocked, but the UI does not consistently surface it.

**Likely files:**
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`

**Implementation notes:**
- Add a “Next best action” card/panel driven by existing stage state.
- Normalize blocker messages for each stage/action.
- Add `title`/inline helper text for disabled primary buttons.
- Prefer explicit copy like “Select at least one candidate before building a brief” over generic “blocked.”

**Acceptance criteria:**
- Every primary stage action has a visible enabled/disabled reason.
- There is one prominent next action at all times.
- Empty states point to the next action, not just “none found.”
- Approval/publish blockers list concrete missing checklist items.
- `npm run check` passes.

**Single-agent boundary:** UI state explanation only. No API behavior changes.

---

## PF2-03 — Move admin/settings/debug surfaces out of the production flow

**Objective:** Separate creator workflow from admin/configuration/debugging.

**Problem:** Settings, internal IDs, model profiles, prompts, schedules, jobs, and pipeline debug data compete with the editorial flow.

**Likely files:**
- `packages/api/public/index.html`
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`

**Implementation notes:**
- Add a clear top-level split: `Produce Episode` vs `Admin / Settings`.
- Hide `pipelineDebug` by default; expose only behind a debug/details toggle.
- Keep jobs/logs accessible contextually, not as a visual peer of the main workflow.

**Acceptance criteria:**
- Main episode workflow is usable without seeing model/prompt/source admin controls.
- Debug/internal ID data is hidden by default.
- Settings remain reachable and functional.
- User can navigate back to the workflow from settings without losing selected show/story state.
- `npm run check` passes.

**Single-agent boundary:** UI organization only. Do not refactor API or DB.

---

## PF2-04 — Add AI story brief / episode plan assistant

**Objective:** Use AI to help users decide what episode to make from candidate stories before generating the full research packet/script.

**Problem:** The current workflow has model-backed scoring, but the user still lacks an editorial “why this story, what angle, what open questions” plan.

**Likely files:**
- `packages/api/src/search/*` or new `packages/api/src/planning/*`
- `packages/api/src/prompts/*`
- `packages/api/src/models/*`
- `packages/api/public/ui.js`
- tests in `packages/api/src/**/*test.ts`

**Implementation notes:**
- Add or reuse a model role like `story_planner` / `episode_planner`.
- Input: selected candidate(s), source metadata, show editorial profile.
- Output schema: proposed angle, why now, audience relevance, known facts, unknowns, questions to answer, recommended sources to fetch next.
- Persist as a lightweight artifact or attach to research packet metadata if existing schema supports it.

**Acceptance criteria:**
- User can request an AI episode plan from selected candidate(s).
- Plan is clearly marked as AI-generated editorial assistance, not sourced fact.
- Plan does not bypass research packet/source requirements.
- Tests cover fake model output validation and failure handling.
- `npm run check` passes.

**Single-agent boundary:** Episode planning assistant only. Do not implement full new research builder here.

---

## PF2-05 — Add AI source-gap and claim-coverage surfacing in the review UI

**Objective:** Make the app show where evidence is weak before script approval.

**Problem:** Podcast Forge’s value proposition is trust. Users need to see unsupported claims, single-source claims, missing primary sources, stale sources, and uncertainty gaps.

**Likely files:**
- `packages/api/src/research/*`
- `packages/api/src/scripts/*`
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`
- tests near research/script modules

**Implementation notes:**
- If #38 lands first, consume its integrity-review output.
- If not, create a non-model deterministic summary from existing research packet warnings/claim metadata.
- UI should group issues by severity: blocking, warning, informational.
- Include suggested next actions: fetch more sources, edit claim, add override reason, regenerate section.

**Acceptance criteria:**
- Script review panel shows claim/source coverage status.
- Unsupported or weakly supported claims are visible before approval.
- The user can understand exactly what blocks approval.
- No approval gate is weakened.
- `npm run check` passes.

**Single-agent boundary:** Evidence visibility only. Do not change publishing logic.

---

## PF2-06 — Add AI rewrite/coaching actions for scripts without bypassing approval

**Objective:** Let AI improve script quality while preserving human review and citation integrity.

**Problem:** AI generation exists, but the workflow needs safer iteration: “make this less certain,” “tighten intro,” “add uncertainty language,” “reduce sensationalism,” etc.

**Likely files:**
- `packages/api/src/scripts/routes.ts`
- `packages/api/src/scripts/builder.ts` or new helper
- `packages/api/src/prompts/*`
- `packages/api/public/ui.js`
- tests near script routes/builder

**Implementation notes:**
- Add constrained rewrite actions that produce a new script revision.
- Inputs include current revision, research packet, reviewer/integrity warnings.
- Output must keep or explicitly flag citation changes.
- Any AI rewrite invalidates prior human approval and requires re-review.

**Acceptance criteria:**
- UI offers at least 3 safe rewrite/coaching actions tied to editorial integrity.
- Rewrites create new revisions, not destructive edits.
- Existing approval is invalidated or clearly not carried over to changed text.
- Tests cover approval invalidation and fake model rewrite output.
- `npm run check` passes.

**Single-agent boundary:** Script rewrite workflow only. Do not add audio/publishing changes.

---

## PF2-07 — Enforce source query domain/freshness controls or remove dead UI fields

**Objective:** Resolve schema/UI mismatch and make source controls honest.

**Problem:** Audit found UI fields for freshness/include/exclude domains that may not be persisted/enforced consistently. Dead controls are worse than absent controls.

**Likely files:**
- `packages/db/src/schema.ts`
- `packages/db/drizzle/*` if schema migration is needed
- `packages/api/src/sources/*`
- `packages/api/src/search/*`
- `packages/api/public/ui.js`
- tests in source/search route suites

**Implementation options:**
1. Implement the controls end-to-end: schema, routes, search/RSS/manual enforcement, UI.
2. If too large, remove/disable fields with explicit “coming later” copy.

**Acceptance criteria:**
- Include/exclude domains and freshness controls are either fully enforced or not shown as active controls.
- Tests prove enforcement for search/RSS where applicable.
- Existing source profile/query creation still works.
- `npm run check` passes.

**Single-agent boundary:** Source query controls only.

---

## PF2-08 — Fix script edit provenance and citation-map invalidation

**Objective:** Prevent edited scripts from inheriting stale citation maps/approval state.

**Problem:** Audit flagged that human script edits can inherit old citation maps even after text changes. That undermines “why did it say that?” auditability.

**Likely files:**
- `packages/api/src/scripts/routes.ts`
- `packages/api/src/scripts/store*` / source store methods if present
- `packages/db/src/schema.ts` if revision metadata changes are needed
- tests near script routes/revisions

**Acceptance criteria:**
- Editing script text creates a new revision or updates revision metadata safely.
- Prior approvals do not silently apply to materially changed text.
- Citation/provenance mapping is invalidated, marked stale, or recalculated.
- UI reflects stale/unverified provenance before approval.
- Tests cover edit → stale citations/approval invalidation.
- `npm run check` passes.

**Single-agent boundary:** Script edit/provenance semantics only.

---

## PF2-09 — Harden publishing validation and scheduled-run status semantics

**Objective:** Make scheduled pipeline and publishing outcomes truthful.

**Problem:** Audit flagged syntactic-only publishing URL validation and scheduled parent jobs marked succeeded when downstream stages are placeholder/queued/failing.

**Likely files:**
- `packages/api/src/production/routes.ts`
- `packages/api/src/publishing/*`
- `packages/api/src/scheduler/runner.ts`
- `packages/api/src/scheduler/routes.test.ts`
- `packages/api/src/production/*.test.ts`

**Acceptance criteria:**
- Publishing validates required asset/feed fields before mutating RSS/publish state.
- Partial publish failures do not leave misleading success events.
- Scheduled pipeline parent run status reflects downstream stage status: queued/running/partial/failed/succeeded as appropriate.
- Tests cover failed downstream stage and publish validation failure.
- `npm run check` passes.

**Single-agent boundary:** Backend status/validation hardening only. No UI redesign.

---

## PF2-10 — Split UI state/render helpers into testable modules or sections

**Objective:** Reduce risk from the monolithic `ui.js` without doing a framework migration.

**Problem:** Audit found `ui.js` is roughly 4,400 lines. Every UI ticket touching one file increases merge conflicts and regression risk.

**Likely files:**
- `packages/api/public/ui.js`
- Possibly new static JS files under `packages/api/public/`
- `packages/api/src/app.ts` if additional static JS routes are needed
- `packages/api/src/app.test.ts`

**Implementation notes:**
- Do not introduce a build step unless explicitly justified.
- Prefer small static modules if browser/module support is already acceptable, or internal section split with clearer boundaries.
- Candidate sections: state/actions, API client, pipeline rendering, settings rendering, review rendering, job rendering.

**Acceptance criteria:**
- UI code has clearer boundaries and fewer giant mixed-purpose regions.
- Existing `/ui` still loads all required scripts.
- Static route tests updated if new files are served.
- No behavior regression in basic workflow.
- `npm run check` passes.

**Single-agent boundary:** Maintainability refactor only. No product behavior changes except equivalent loading.

---

## PF2-11 — Replace destructive/critical prompts with explicit confirmation dialogs

**Objective:** Stop using `window.prompt()` and instant destructive actions for critical editorial/admin decisions.

**Problem:** Audit found destructive delete actions and approval/override flows relying on browser prompts. That is weak UX for trust-critical software.

**Likely files:**
- `packages/api/public/ui.js`
- `packages/api/public/styles.css`

**Acceptance criteria:**
- Deleting a source query requires explicit confirmation.
- Research warning overrides and approval reasons use visible modal/panel UI, not `window.prompt()`.
- Confirmation copy states consequence plainly.
- Keyboard/cancel path works.
- `npm run check` passes.

**Single-agent boundary:** UI confirmation mechanisms only.

---

## PF2-12 — Add local UI smoke checks for the guided flow

**Objective:** Add a cheap regression net for the static UI flow.

**Problem:** Current checks catch TypeScript and API tests, but the big UX surface can regress silently.

**Likely files:**
- `scripts/*` or `packages/api/src/app.test.ts`
- `packages/api/public/*`
- `package.json` if adding a script is warranted

**Implementation notes:**
- Avoid heavy browser dependencies unless already present.
- Prefer deterministic static checks or lightweight Node-based HTML/JS assertions.
- Verify key elements/functions exist: stage cards, next action, settings separation, approval blocker copy.

**Acceptance criteria:**
- `npm run check` includes the smoke checks or a documented script runs them.
- Checks fail if core guided-flow elements disappear.
- No network/model calls.
- `npm run check` passes.

**Single-agent boundary:** Test/smoke coverage only.

---

## Recommended First Run Order

If Steven approves, run:

1. **#38** — Integrity reviewer AI gate.
2. **PF2-01** — Guided workflow primary UI.
3. **PF2-02** — Next action + blockers.
4. **PF2-03** — Separate admin/debug.
5. **PF2-08** — Provenance/citation invalidation.
6. **PF2-07** — Honest source controls.
7. **PF2-09** — Publishing/scheduler truthfulness.
8. **PF2-04/PF2-05/PF2-06** — AI assistant enhancements, ordered based on what #38 exposes.
9. **PF2-10/PF2-11/PF2-12** — Maintainability and regression safety.

## Issues to Create After Approval

Create GitHub issues for PF2-01 through PF2-12, linking this plan and the audit report. Do not create them from raw model output without this human/orchestrator review.

Audit report URL while local server is up:
`http://127.0.0.1:3451/podcast-forge-audit-2026-04-26.html`

Audit artifact folder:
`/home/steven/clawd/data/podcast-forge-audit/2026-04-26-212003b/`
