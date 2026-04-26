# AGENTS.md — Podcast Forge

## Mission / North Star

Podcast Forge exists to provide **reliably sourced, clearly attributed, and unbiased news as it breaks and beyond**.

Integrity is the North Star. ⭐️

This is not a content mill. It is an agent-powered podcast/news production system that should help people understand what happened, why it matters, what is known, what is uncertain, and where claims came from.

## Product Purpose

Podcast Forge turns configurable source profiles, research packets, model roles, script workflows, audio/art generation, approval gates, and RSS publishing into a repeatable pipeline for trustworthy audio news.

Primary intended use cases:
- Breaking or near-real-time news podcasts.
- Daily/recurring news briefings.
- Deep-dive follow-up episodes after stories develop.
- Multiple shows with separate editorial voices, feeds, source profiles, and publishing rules.

Examples this repo should eventually support:
- The Synthetic Lens
- Byte Sized AI
- Executive Lens
- Breadcrumbs / narrative shows
- Nick Chrome Chronicles / fiction shows
- Future shows added through the app, not bespoke scripts

## Editorial Principles

Agents must preserve editorial integrity over speed, novelty, or drama.

1. **Source first.** Do not present a factual claim as settled unless the system can point to a source snapshot or explicit human/editorial override.
2. **Separate fact from interpretation.** Scripts should distinguish what happened, what sources say, what analysts infer, and what remains unknown.
3. **Avoid false certainty.** If evidence is incomplete, say so plainly.
4. **Avoid sensationalism.** A story can be compelling without exaggerating risk, conflict, or certainty.
5. **Prefer primary sources.** Official posts, filings, papers, transcripts, company statements, court records, and direct interviews beat derivative summaries.
6. **Use independent corroboration for major claims.** Important claims should ideally have two or more independent fetchable sources.
7. **Preserve dissent and uncertainty.** If credible sources disagree, represent that disagreement instead of smoothing it away.
8. **Approval gates matter.** Publishing workflows should default to review/approval before RSS publication unless a show is explicitly configured otherwise.
9. **Do not invent citations.** If a source was not fetched/snapshotted, do not imply it was used.
10. **No hidden advertorial.** Sponsors, affiliate relationships, and promotional content must be explicit if ever added.

## Agent Workflow Requirements

Before coding:
1. Run `git pull`.
2. Read `HANDOFF.md` for the current orchestration plan, dependencies, and issue sequencing.
3. Read `LESSONS.md`.
4. Read the relevant docs in `docs/` for the feature area.
5. Check the GitHub issue acceptance criteria.

Before finishing:
1. Run `npm run check` from the repo root unless impossible.
2. Add/update tests for meaningful behavior changes.
3. Update README/docs if behavior or API changes.
4. Update `HANDOFF.md` if the orchestration plan, dependency graph, local dev commands, or issue status changed.
5. If you discover a repo-specific gotcha, append it to `LESSONS.md`.
6. Commit and push changes when you have write access.
7. Comment on/close the GitHub issue only after verification passes.

Review gate:
- Prefer GitHub Copilot review when available.
- If Copilot is unavailable, delayed, quota-exhausted, or insufficient, run `node scripts/local-pr-review.mjs <PR> --mode gemini` from a separate review step. Fallbacks: `--mode codex`, then `--mode static`.
- The same agent that implemented/fixed code must not be the only reviewer.
- A PR may merge only when checks pass and either Copilot or local review is clean.

## Current Architecture Notes

- Monorepo using npm workspaces.
- API package: `packages/api`.
- DB package: `packages/db`.
- Drizzle ORM schema lives in `packages/db/src/schema.ts`.
- Migrations live in `packages/db/drizzle/`.
- API Fastify app setup is split from server startup.
- Existing V1 implementation favors synchronous API-triggered jobs with persisted job status/logs. A real worker queue can come later.
- Tests should avoid live network calls; use fake/injected fetch clients.
- Source candidates, source documents, research packets, jobs, approval events, and publish events are first-class audit records.

## Data / Audit Trail Expectations

For any pipeline feature, preserve enough data for later review:
- What source/profile/query triggered the work.
- Which external URLs were fetched.
- What text/title was extracted.
- Which model/profile generated output.
- Which warnings were raised.
- Who/what approved an override or publish action.
- What asset/feed URL was published.

If a future user asks, “Why did the episode say that?”, the app should be able to answer.

## Coding Conventions

- Keep types explicit at module boundaries.
- Prefer small modules by domain (`sources`, `search`, `research`, `models`, `scripts`, `production`, `publishing`).
- Keep provider integrations injectable/testable.
- Do not bake show-specific assumptions into generic pipeline code.
- Avoid hardcoded show names, feed paths, API keys, or model names unless they are example config/seed data.
- Validate external input at API boundaries.
- Do not make public/external network calls in tests.

## Known Human Preference

Steven wants agents to be able to continue this project overnight, sequentially, with verification between issues. Quality and integrity beat raw speed.

`HANDOFF.md` is the master orchestration document for that overnight/multi-agent work. Keep it current when issue ordering, dependencies, batch plans, verification gates, or known blockers change.

Claude account access may be expired; use Codex / GPT-5.5 high-thinking for coding agents until told otherwise.
