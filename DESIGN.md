# Podcast Forge Design Context

Podcast Forge is a product-register interface: a dense, evidence-first editorial production cockpit. Design should serve source review, editorial judgment, approval safety, and repeatable production work.

## UI Principles

- Lead with production context: active show, current episode, current stage, blockers, and next safe action.
- Make evidence visible before generation. Candidate stories, research briefs, source snapshots, citation counts, and source gaps should be easy to scan.
- Separate AI assistance from human decisions. AI suggestions, integrity review output, and rewrite coaching must look different from approvals and overrides.
- Keep admin and debug surfaces reachable but secondary. The main workflow is Produce Episode, not settings management.
- Use familiar product patterns: top navigation, side context, tabs, forms, details disclosures, lists, tables, and inline actions.
- Prefer dense, calm surfaces over oversized hero treatments. This is an operational tool for repeated use.
- Avoid nested cards and decorative containers. Use panels, sections, lists, tables, and inline metadata when they communicate structure better.
- Keep copy actionable and specific. Labels should explain what will happen and why an action may be blocked.

## Semantic Color and State Vocabulary

Use color as operational language, not decoration. Add or adjust colors through named CSS variables and consistent state roles.

- Primary action: the next safe action for the current stage.
- Selected/current: active show, active source, active stage, selected candidate, or current artifact.
- Success/ready: evidence captured, brief ready, script approved, asset ready, publish complete.
- Warning/needs review: uncertainty, weak corroboration, missing freshness metadata, source disagreement, non-blocking integrity notes.
- Error/blocking: failed job, missing required source, missing approval, invalid feed destination, citation breakage, publishing blocker.
- Info/AI assist: episode plan assistant, source-gap suggestions, rewrite coaching, integrity reviewer observations.
- Human decision: approvals, rejects, overrides, and publish decisions. These should not share the same treatment as AI suggestions.
- Archived/history: prior drafts, old jobs, superseded assets, previous publish records.
- Debug/technical: IDs, raw JSON, logs, provider details, and route names. Keep these lower emphasis and often behind details disclosures.

Avoid using a saturated accent for inactive decorations. State color must mean something consistent across the cockpit.

## Typography and Font Policy

- Use system UI fonts or the current Inter/system stack. Do not add webfont dependencies for routine product UI.
- Use one main sans-serif family across headings, labels, controls, and body text.
- Use monospace only for technical IDs, logs, checksums, code-like values, route names, and raw snippets.
- Use fixed rem-based type scales. Do not scale font size directly with viewport width.
- Keep body/help line lengths readable, ideally 65 to 75 characters where prose appears.
- Inside compact panels, use restrained heading sizes. Reserve large display type for true orientation moments, not repeated controls.
- Maintain clear hierarchy through weight, spacing, and size, not novelty fonts or decorative effects.

## Spacing and Density

- Favor cockpit density: users should see the current workflow, evidence state, and blockers without excessive scrolling.
- Use predictable grids and lists so operators can build muscle memory.
- Keep repeated cards compact, with stable heights where practical to avoid layout shift.
- Let page sections be full-width bands or unframed layouts. Use cards for repeated items, modals, and framed tools only.
- Do not put cards inside cards.
- Keep command surfaces sticky only when they remain compact. Sticky mobile UI must not consume most of the viewport.
- Use spacing rhythm intentionally: tighter spacing for metadata and review queues, more air around stage boundaries and major decisions.

## Artifact Presentation Rules

Different artifact types should have distinct structure and affordances.

- Candidate stories: present as a ranked editorial review queue with title, source, URL/domain, freshness, score, status, and curation actions such as shortlist, ignore, clear, or inspect.
- Story sources/search recipes: show provider, enabled state, freshness settings, domain constraints, credential availability, last run, and discovery blockers.
- Research briefs: emphasize known facts, cited claims, source gaps, warnings, citation count, readiness, and approval state.
- Source documents: show origin URL, fetch timestamp, title/text extraction status, and whether the source is primary, secondary, inaccessible, duplicated, or stale.
- AI episode plans and suggestions: label as AI assistance, show rationale and open questions, and provide apply/reject style actions where supported.
- Scripts: prioritize readable script text, speaker labels, revision state, citation-map health, edit provenance, and approval readiness.
- Integrity reviews: separate blockers from warnings, show suggested wording changes, and require explicit resolution or override reasons.
- Audio and cover assets: show current active assets apart from history, with preview, duration or dimensions, generation status, storage/public URL readiness, and accessibility metadata when available.
- Publishing records: show approval, feed destination, GUID, public asset URLs, publish time, idempotency or re-publish status, and changelog/reason.
- Jobs/debug records: show status, progress, logs, retry affordances, warnings, and technical IDs without turning the main workflow into a log viewer.

## Motion Policy

- Motion should explain state changes: selection, reveal, loading, completion, warning, or failure.
- Keep routine transitions short, usually 150 to 250 ms.
- Do not animate layout properties that cause jank.
- Avoid decorative page-load choreography, bouncing, elastic motion, and animation that delays the next action.
- Respect reduced-motion preferences.

## Responsive Guidance

- Mobile is first-class, especially for review and approval moments.
- Collapse sidebars and secondary metadata before shrinking the main task.
- Stage navigation should become compact, horizontally scrollable, or stacked without hiding blocker state.
- Sticky bottom or top actions are acceptable only when compact and when content remains visible.
- Long tables and queues should become readable stacked rows or horizontally scrollable regions with clear labels.
- Text must fit inside buttons, chips, list rows, and panels at narrow widths.
- Touch targets must remain usable. Do not pack critical approve/publish actions into tiny controls.
- Preserve access to technical details, but do not let logs or raw IDs dominate small screens.

## Explicit Anti-Patterns

Avoid:

- Treating Produce Episode as an admin/settings dashboard.
- Hiding source gaps, warnings, or approval blockers behind generic success states.
- Presenting AI output and human approval with the same visual language.
- Publishing actions that look routine when required gates are unresolved.
- Decorative gradient text, glassmorphism, side-stripe alert borders, bokeh/orb backgrounds, and generic AI sparkle motifs.
- Identical card grids for every artifact type.
- Oversized hero sections inside operational workflows.
- Modals as the first answer for routine review, editing, or confirmation flows.
- Full-saturation color on inactive items.
- Debug identifiers as primary labels in user-facing workflow surfaces.
- New frontend frameworks, bundlers, or generated component systems without explicit approval.

## Implementation Fit

Design work should fit the current static frontend: HTML, CSS, and vanilla JavaScript modules served by Fastify. Prefer improving semantic structure, CSS variables, view-model rendering, accessible states, and focused UI copy over adding dependencies.

When changing UI in future issues, verify visual behavior with local smoke checks and screenshots where practical, especially for mobile Produce Episode flows and approval gates.
