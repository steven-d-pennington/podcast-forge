# Podcast Forge Product Context

register=product

## Product Purpose

Podcast Forge is an evidence-first editorial production cockpit for turning configurable story sources, research briefs, AI-assisted scripts, production assets, approval decisions, and RSS publishing into a repeatable podcast/news workflow.

The product is not an AI content mill, prompt playground, admin console, or debug dashboard. It exists to help an editor understand what happened, what sources support it, what remains uncertain, what is blocked, and what the next safe production action should be.

The core promise: if someone asks, "Why did the episode say that?", Podcast Forge should be able to answer with source snapshots, claim provenance, warnings, review decisions, and publish records.

## Primary Users

- Steven and Sam producing The Synthetic Lens and adjacent shows.
- Editors and operators running a breaking-news or recurring briefing workflow.
- A single human producer who needs AI assistance without losing editorial control.

Primary users are usually time-constrained, but they are not trying to bypass judgment. They need fast orientation, clear blockers, trustworthy source context, and explicit gates before public output.

## Future Users

- Independent creators producing research-backed podcast episodes.
- Newsletter and podcast teams that need recurring daily or weekly production.
- Agencies producing multiple client shows with distinct voices and approval rules.
- Operators managing several shows, feeds, source profiles, model roles, and publishing destinations.

The product must stay multi-show by design. Do not hardcode The Synthetic Lens, a specific feed, a provider, a model, or a publishing destination into generic product behavior.

## Product Jobs

Podcast Forge should help users:

1. Choose the active show and understand its feed, voice, approval mode, and configured AI roles.
2. Discover possible stories from saved search recipes, RSS feeds, manual URLs, and future curated providers.
3. Judge candidate stories by fit, freshness, source quality, uncertainty, and editorial importance.
4. Build research briefs with fetched source documents, cited claims, warnings, and source gaps.
5. Draft and revise scripts while preserving citation maps and provenance.
6. Run integrity review before audio production or publishing.
7. Generate and review audio, cover art, metadata, and transcripts.
8. Approve publishing only after required evidence and human review gates are satisfied.
9. Audit prior runs through jobs, logs, warnings, approval events, and publish events.

## Tone

The product voice is calm, precise, editorial, and accountable.

- Say what is known, what is missing, and what action is available.
- Prefer plain language over internal schema names in user-facing UI.
- Use active, concrete labels: "Build research brief", "Run integrity review", "Approve publishing".
- Keep uncertainty visible without being melodramatic.
- Treat AI as an assistant producer, editor, and reviewer, not as an autonomous publisher.
- Debug details can be available, but they should not dominate the main production workflow.

## Anti-References

Avoid these product directions:

- A generic admin dashboard where settings and debug panels compete with production work.
- A raw pipeline visualizer that celebrates automation but hides evidence and judgment.
- A content farm UI optimized for volume, novelty, or sensational hooks.
- A chat-only interface that loses durable audit records and workflow state.
- A provider console that exposes secrets, credentials, private paths, or raw environment details.
- A marketing landing page when the user needs the actual production cockpit.
- Beige SaaS confetti, decorative card grids, generic AI sparkle language, and empty hype metrics.

## Integrity Constraints

Integrity is the product's north star. All production features and future design work must preserve:

- Source provenance: show which source profile, query, URL, fetch time, and snapshot produced evidence.
- Claim traceability: important factual claims should map to source documents or explicit editorial overrides.
- Fact versus interpretation: distinguish source statements, analyst inference, and unresolved uncertainty.
- Corroboration: major claims should prefer primary sources and independent corroboration.
- Warnings: weak-source, inaccessible-source, freshness, high-stakes, and citation warnings must remain visible until resolved or explicitly overridden.
- No invented citations: never imply that a source was fetched, read, or cited if it was not.
- No hidden advertorial: sponsorships, affiliates, promotional content, and conflicts must be explicit if ever supported.
- No public publishing from unreviewed generated content unless a show is explicitly configured for that behavior and the audit trail records it.

## Approval-Gate Principles

Approval gates are product features, not friction to hide.

- Human approval is required before public RSS publishing by default.
- Audio and cover production should happen only after the script is ready for production or explicitly approved for that stage.
- Publishing approval should summarize blockers, warnings, source gaps, asset readiness, feed destination, and prior approvals.
- Overrides must require a reason and be saved as review decisions.
- AI rewrite, coaching, and repair actions may suggest fixes, but they must not silently bypass review state.
- Re-publishing must be explicit and auditable, with a changelog or reason.

## Static Frontend Constraint

The current frontend is intentionally static: Fastify serves `packages/api/public/index.html`, plain CSS, and vanilla JavaScript modules such as `ui.js`, `ui-view-model.js`, `ui-api.js`, `ui-state.js`, `ui-formatters.js`, and `ui-constants.js`.

Future agents must not introduce React, Next.js, Vite, Vue, Svelte, a component build pipeline, client-side package bundling, or a frontend framework unless Steven explicitly approves a frontend migration. Keep UI improvements within the existing static stack.

## Durable Product Direction

The primary screen is Produce Episode. Settings, admin, jobs, and debug tools remain available, but they are secondary. The cockpit should make these questions obvious:

- What show and episode context am I working in?
- What stage is current?
- What is blocked?
- What evidence supports this?
- What has AI suggested versus what a human approved?
- What is the next safe action?

Future design and implementation work should reinforce those answers before adding new surfaces.
