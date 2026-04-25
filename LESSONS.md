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
