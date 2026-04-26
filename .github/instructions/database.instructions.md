---
applyTo: "packages/db/**/*.ts,packages/db/drizzle/**/*"
---

Database changes must preserve auditability: source documents, story candidates, research packets, generated scripts, jobs, approvals, assets, and publish events should retain enough metadata to answer why an episode said something.

If schema changes affect API/store behavior, update seed data, store code, tests, and docs together.
