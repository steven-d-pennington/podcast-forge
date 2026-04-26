# Copilot instructions for Podcast Forge

Podcast Forge is an agent-powered podcast/news production system. Editorial integrity is the north star: source provenance, explicit uncertainty, approval gates, and auditability matter more than speed.

Before reviewing or changing code, assume this repo uses npm workspaces with `packages/api` for Fastify/API/UI and `packages/db` for Drizzle/Postgres schema. Run validation from the repo root with `npm run check`. Do not run `npx jest`; this repo uses Node's test runner through package scripts.

When reviewing code, focus on:
- Provenance: generated stories, scripts, research packets, assets, and publish events must preserve source URLs/snapshots, model role/profile, warnings, and job metadata.
- No hardcoded show assumptions: generic pipeline code must not bake in The Synthetic Lens, Byte Sized, local paths, feed URLs, API keys, or model names except in example config/seed data.
- Provider boundaries: model, search, TTS, art, and publishing integrations should be injectable/testable and must not make live network calls in tests.
- Safety gates: public publishing should require explicit approval unless a show is deliberately configured otherwise.
- Data model consistency: schema, store/repository code, API routes, UI state, tests, and docs should stay aligned.
- Security/privacy: never commit secrets, local credential paths, private account details, customer data, PHI, or proprietary employer material.

Useful files:
- `AGENTS.md` — repo mission, coding workflow, and editorial principles.
- `HANDOFF.md` — active issue order/dependencies and current orchestration state.
- `LESSONS.md` — repo-specific gotchas.
- `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PLAN.md` — product/architecture context.

For PR reviews, call out blocking issues clearly. Prefer concrete, testable feedback over style nits. If a suggestion is future work rather than required for the current PR, label it as follow-up.
