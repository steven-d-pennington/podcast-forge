# Development Plan

## Phase 0 — Product definition

- PRD, architecture, config schema, issue backlog.

## Phase 1 — Foundation

- Monorepo setup.
- Postgres migrations.
- Config loader/validator.
- Basic API health/config endpoints.
- Minimal web shell.

## Phase 2 — Source ingestion

- Source profile CRUD.
- Brave adapter from current Byte Sized query list.
- RSS adapter.
- Manual URL ingest.
- Candidate dedupe/scoring.

## Phase 3 — Research packets

- Source fetch/snapshot.
- Claim extraction.
- Cluster/episode candidate creation.
- Research warnings + editorial override.

## Phase 4 — Script and assets

- Script generation role/config.
- Script revision UI.
- Preview audio job adapter.
- Cover art job adapter.

## Phase 5 — Publishing

- Approval state machine.
- R2/local upload adapter.
- RSS feed update adapter.
- OP3 wrapping.
- Idempotent publish records.

## Phase 6 — Polish/productization

- Installer/dev setup docs.
- Example templates.
- Import old TSL data.
- Basic analytics.

## Static UI View-Model Guardrails

The Produce workflow should render from `deriveProductionViewModel()` in
`packages/api/public/ui-view-model.js`. Keep `packages/api/public/ui.js` as the
renderer that consumes that contract for the production command bar, workflow
context, and 8-stage tracker. Future UI work should extend the view-model first,
then render from named fields; avoid reaching directly into raw API state from
new Produce controls unless the state is first represented in the view-model.

`scripts/ui-complexity-smoke.test.mjs` guards the normal initial Produce render
without browser automation. It snapshots the command bar plus stage tracker
contract and enforces thresholds for visible controls, DOM nodes, one expanded
current stage, and collapsed non-current stages. When a feature intentionally
adds controls, group or collapse them in the relevant stage first, then update
the threshold in that test with the reason in the PR. Do not raise the threshold
to hide unrelated button growth.
