---
applyTo: "**/*.ts,**/*.tsx,packages/**/*.ts,packages/**/*.tsx"
---

TypeScript changes should keep explicit types at module/API boundaries and avoid `any` unless there is a documented integration boundary.

Keep provider integrations injectable. Tests should use fakes/mocks and must not call live LLM/search/TTS/art/publishing providers.

When adding API behavior, update route tests and ensure `npm run check` passes from the repo root.
