# LESSONS.md

Lessons learned from AI coding sessions on this project. Read this before starting any work.

This file grows automatically. Each session that encounters bugs, project quirks, or non-obvious patterns should append learnings here so the next agent avoids the same mistakes.

## Build & Test

<!-- Add your project's build/test commands here -->
<!-- Example:
- Build: `npm run build` or `npx next build`
- Test: `npx jest --no-coverage` (NOT vitest)
- Lint: `npm run lint`
- Type check: `npx tsc --noEmit`
-->

## Architecture Patterns

<!-- Add project-specific patterns here -->
<!-- Example:
- Components go in `components/` with co-located tests in `__tests__/`
- Database types are defined in `lib/db.ts` — always import from there
- Use `localDateKey()` for date strings, never `new Date().toISOString()`
-->

## Known Gotchas

<!-- Add things that look right but aren't -->
<!-- Example:
- Empty arrays `[]` are valid saved state — check `!== undefined` not `.length`
- The `date` field must come from the entry, not computed at save time (midnight rollover)
-->

## Session Learnings

<!-- New lessons are appended below this line -->
<!-- Format:
### [Brief Title] (YYYY-MM-DD)
**What happened:** One sentence describing the issue.
**Root cause:** Why it happened.
**Fix:** What to do instead.
**Applies to:** Which files/patterns this affects.
-->

### Workspace Script CWD for Legacy Paths (2026-04-25)
**What happened:** The legacy import default paths needed to work from both the repo root and the API workspace package.
**Root cause:** `npm run ... --workspace @podcast-forge/api` may execute with `packages/api` as the process working directory, while legacy folders sit beside the repo root.
**Fix:** Resolve legacy default paths against multiple likely roots, and keep explicit CLI/API path overrides available.
**Applies to:** `packages/api/src/import/legacy.ts`, any future filesystem import scripts.

### GLM 5.1 OpenAI-Compatible Params (2026-04-28)
**What happened:** Switching a model profile to `openai-compatible/glm-5.1` can still fail if Z.AI thinking mode is left enabled, if the generic adapter drops provider-specific params, or if Podcast Forge sends its rendered prompt as one `system` message.
**Root cause:** GLM 5.1 may put output into `reasoning_content` by default; Podcast Forge expects `message.content`, and the OpenAI-compatible adapter previously only forwarded temperature/maxTokens/response_format. Z.AI also rejects single-message `system` prompts for GLM 5.1 with HTTP 400/code `1214` (`messages parameter is illegal`).
**Fix:** Store `config.params.thinking = { type: 'disabled' }` for local GLM 5.1 text/JSON roles, forward safe params such as `thinking`, and send single rendered GLM system prompts as `user` messages while preserving normal multi-message requests.
**Applies to:** `packages/api/src/llm/providers.ts`, `packages/api/src/llm/runtime.test.ts`, GLM/Z.AI-backed model profiles.
