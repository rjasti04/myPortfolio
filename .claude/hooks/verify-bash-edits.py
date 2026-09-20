#!/usr/bin/env python3
"""PostToolUse counterpart to verify-csp.sh and verify-docs.sh, for Bash.

Those two are matched on `Write|Edit` and key off `.tool_input.file_path`, which
a Bash command does not have. A `sed -i` against an inline script in
`frontend/index.html` therefore broke a pinned CSP hash with nothing failing
until CI. This runs the same two gates when a Bash command wrote a file either
of them covers.

Exit 2 returns the gate's output to the model.
"""

from __future__ import annotations

import fnmatch
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bash_targets import expand, normalize, parse  # noqa: E402

CSP_COVERED = ["frontend/index.html"]

DOCS_COVERED = [
    "docs/*.md",
    "AGENTS.md",
    ".claude/rules/*.md",
    "frontend/styles.css",
    "frontend/index.html",
    "frontend/js/*.js",
    "frontend/js/*/*.js",
    "frontend/tests/*.test.js",
    "scripts/tests/*.test.js",
]


def covered(paths: set[str], patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(p, pat) for p in paths for pat in patterns)


def run_gate(script: str, root: Path) -> int:
    out = subprocess.run([sys.executable, script], cwd=root,
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.stderr.write(out.stdout + out.stderr)
    return out.returncode


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command.strip():
        return 0

    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    targets_raw, mentioned_raw, opaque = parse(command)
    source = targets_raw | (mentioned_raw if opaque else set())

    written: set[str] = set()
    for tok in source:
        rel = normalize(tok, root)
        if rel is not None:
            written.update(expand(rel, root))
    if not written:
        return 0

    failed = 0
    if covered(written, CSP_COVERED):
        failed |= run_gate("scripts/check_csp_hashes.py", root)
    if covered(written, DOCS_COVERED):
        failed |= run_gate("scripts/check_docs.py", root)
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
