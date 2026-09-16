---
paths:
  - frontend/**
  - server/**
  - scripts/**
  - package-lock.json
---

# Navigating This Repo Without Burning Context

**Never read these files end-to-end.** Sizes are measured, not guessed: token
figures are `bytes ÷ 3.7` for code and markup, `bytes ÷ 4.0` for markdown
prose, rounded up to the next 500 — so they run slightly high rather than low.
`scripts/check_docs.py` recomputes this table in CI, so if you change one of
these files the number here has to move with it.

| File | Lines | ~Tokens | How to navigate instead |
| :--- | ---: | ---: | :--- |
| `frontend/styles.css` | 13,284 | ~106,500 | `grep -n '#region' frontend/styles.css` returns a 27-entry map with live line numbers (~500 tokens). Then `sed -n 'START,ENDp'`. |
| `package-lock.json` | 3,453 | ~32,500 | Never read. `package.json` lists every direct dep in 25 lines. |
| `frontend/index.html` | 2,501 | ~38,000 | `grep -n '<section id=' frontend/index.html` for the 8-section map. |
| `frontend/js/chat.js` | 2,317 | ~25,000 | One large `initChat()` from line 57; almost nothing is top-level. Map it with `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/chat.js` (52 hits). |
| `frontend/js/auth-ui.js` | 1,586 | ~20,000 | Same shape — one `initAuthUI()`. Use `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/auth-ui.js` (14 hits). |
| `frontend/three-bg.js` | 1,563 | ~14,500 | **Retired** — the animated background is off and nothing imports this. Kept on disk only so the work is recoverable. You almost certainly do not need to read it. |

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
