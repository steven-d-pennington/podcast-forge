# CLAUDE.md

## Before Any Work

Read `AGENTS.md` and `LESSONS.md` in this repo root before making changes. `AGENTS.md` explains the product mission, editorial integrity standards, architecture conventions, and workflow. `LESSONS.md` contains project-specific patterns, known gotchas, and learnings from previous sessions.

```bash
cat AGENTS.md
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
