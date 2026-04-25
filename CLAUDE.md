# CLAUDE.md

## Before Any Work

Read `LESSONS.md` in this repo root before making changes. It contains project-specific patterns, known gotchas, and learnings from previous sessions.

```bash
cat LESSONS.md
```

## After Completing Work

If you encountered bugs, discovered project quirks, or learned something non-obvious during this session, append it to `LESSONS.md`:

```markdown
### [Brief Title] (YYYY-MM-DD)
**What happened:** One sentence.
**Root cause:** Why.
**Fix:** What to do instead.
**Applies to:** Which files/patterns.
```

Then commit:
```bash
git add LESSONS.md && git commit -m "chore: update lessons" && git push || true
```
