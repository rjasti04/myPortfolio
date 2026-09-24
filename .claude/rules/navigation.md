---
paths:
  # package-lock.json is deliberately absent: a path-scoped rule loads when
  # Claude reads a matching file, and `Read(./package-lock.json)` is in
  # permissions.deny, so that entry could never trigger. The deny rule is the
  # stronger guard and the "never read it" advice survives in the table below,
  # which the three globs here already reach.
  - frontend/**
  - server/**
  - scripts/**
---

# Navigating This Repo Without Burning Context

**Never read these files end-to-end.** Sizes are measured, not guessed: token
figures are `bytes ÷ 3.7` for code and markup, `bytes ÷ 4.0` for markdown
prose, rounded up to the next 500 — so they run slightly high rather than low.
`scripts/check_docs.py` recomputes this table in CI, so if you change one of
these files the number here has to move with it.

| File | Lines | ~Tokens | How to navigate instead |
| :--- | ---: | ---: | :--- |
| `frontend/styles.css` | 14,122 | ~120,500 | `grep -n '#region' frontend/styles.css` returns a 28-entry map with live line numbers (~500 tokens). Then `sed -n 'START,ENDp'`. |
| `package-lock.json` | 3,451 | ~32,500 | Never read. `package.json` lists every direct dep in 25 lines. |
| `frontend/index.html` | 2,618 | ~40,000 | `grep -n '<section id=' frontend/index.html` for the 8-section map. |
| `frontend/js/chat.js` | 2,527 | ~28,000 | One large `initChat()` from line 74; almost nothing is top-level. Map it with `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/chat.js` (56 hits). |
| `frontend/js/auth-ui.js` | 1,686 | ~22,000 | Same shape — one `initAuthUI()`. Use `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/auth-ui.js` (14 hits). |

`server/.venv/`, **once you have created one locally**, holds ~7,500 dependency
files (136 MB) against 147 tracked files. It is gitignored, so ripgrep-backed
`Grep`/`Glob` skip it — but plain Bash `find` / `grep -r` / `du` do **not**.
Always pass `--exclude-dir=.venv` (or `-not -path '*/.venv/*'`) when searching
from Bash: without it a repo-wide `grep -r --include=*.py` returns 1,950 files
instead of 40 and takes over two minutes.

A fresh clone — CI, and every Claude Code web session — has no `server/.venv` at
all, so none of that cost exists there. The guard in
`.claude/hooks/protect-bash-writes.py` checks for the directory before it
blocks, and an unqualified search is refused only where it really is present.
