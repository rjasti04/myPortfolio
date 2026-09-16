---
paths:
  - docs/**/*.md
  - frontend/**
  - server/**
  - scripts/**
---

# Reference Docs - Read Only When Relevant

Do not preload these. Each entry states its trigger. If you know the task but
not the document, use the task index in `docs/README.md` — it chains the reads
in order ("add or change an API endpoint" -> `API.md` -> `BACKEND.md` ->
`SECURITY.md#checklist-for-changes`). The table below is for budgeting the read
once you know which doc you want.

**These docs are also too big to read whole.** Together they are ~104,500
tokens, and every one is cleanly sectioned. Get the heading map first, then
pull only the section you need:

```bash
grep -n '^#\{2,3\} ' docs/JAVASCRIPT.md   # 94 headings, ~1,000 tokens
sed -n '284,298p' docs/JAVASCRIPT.md      # just the module you are touching
```

That turns a 22,500-token read into roughly 1,000. Use it by default; read a
whole doc only when you genuinely need all of it.

| Doc | ~Tokens | Read it before... | Jump to a section with |
| :--- | ---: | :--- | :--- |
| `docs/ARCHITECTURE.md` | ~7,500 | you need the repo map, the request lifecycle, or how the tiers interact | `grep -n '^#\{2,3\} '` (19 headings) |
| `docs/API.md` | ~9,000 | adding or modifying a FastAPI route, or calling one from the client | `grep -n '^### ' docs/API.md` (39 endpoint sections) |
| `docs/BACKEND.md` | ~7,000 | changing anything under `server/` - it is the package-by-package reference | `grep -n '^#\{2,3\} '` (33 headings) |
| `docs/DATABASE.md` | ~4,000 | changing a model, an index, or writing a migration | `grep -n '^#\{2,3\} '` (16 headings) |
| `docs/JAVASCRIPT.md` | ~22,500 | adding or refactoring a frontend ES module | `grep -n '^### ' docs/JAVASCRIPT.md` (80 module sections) |
| `docs/FRONTEND.md` | ~13,000 | touching `index.html`, the CSS, the service worker, the fonts, or the build | `grep -n '^#\{2,3\} '` (21 headings) |
| `docs/DESIGN.md` | ~3,000 | adding a colour, a size, a duration or an easing to the stylesheet - it is the token contract, not the plumbing | `grep -n '^#\{2,3\} '` (12 headings) |
| `docs/CONFIGURATION.md` | ~4,500 | adding or interpreting an environment variable | `grep -n '^## '` (16 headings), or just grep the variable name |
| `docs/SECURITY.md` | ~6,500 | touching auth, session tokens, rate limits, the CSP, or any user-controlled output - it ends with a pre-merge checklist | `grep -n '^## '` (18 headings) |
| `docs/OPERATIONS.md` | ~5,000 | changing CI/CD, diagnosing a deploy, or running a manual procedure | `grep -n '^#\{2,3\} '` (28 headings) |
| `docs/TESTING.md` | ~11,500 | writing tests, or checking whether something is actually covered | `grep -n '^#\{2,3\} '` (14 headings) |
| `docs/ADR.md` | ~7,000 | you want to know why a decision was made and whether it still holds | Read the status table at the top (lines 1-36) first, then `sed -n` the one ADR you need |
| `docs/ECC.md` | ~2,500 | you are adding, upgrading or removing a vendored Everything Claude Code skill, or want to know why the rest of ECC was refused | `grep -n '^## '` (6 headings) |
| `docs/README.md` | ~1,500 | you want the doc index and a task-to-document map | Small enough to read whole |
| `README.md` | ~5,000 | you need setup, the quick start, or the canonical local commands — it is authoritative for those, and the stack summary in `AGENTS.md` is only a faster orientation | Small enough to read whole |
