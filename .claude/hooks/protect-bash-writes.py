#!/usr/bin/env python3
"""PreToolUse guard for Bash, mirroring the Write/Edit guards in this directory.

`protect-migrations.sh` and `protect-spa-egress.sh` are matched on `Write|Edit`,
so `sed -i`, `tee`, a heredoc or a plain `>` slipped past all of them. This
covers the same invariants on the Bash path, plus the two rules that only ever
existed as prose in AGENTS.md: secrets are never read from the shell, and a
repo-wide search never descends into `server/.venv/`.

Exit 2 blocks the call and returns stderr to the model.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bash_targets import (  # noqa: E402
    REDIRECTS, _operands, _utility, expand, normalize, parse, segments, tokenize,
)

SEARCHERS = {"grep", "egrep", "fgrep", "rgrep", "find", "du"}

# ADR-016. Kept identical to protect-spa-egress.sh, which enforces the same
# allowlist on the Write/Edit path.
SPA_GUARDED = ["frontend/index.html", "frontend/arcade.html", "frontend/cron.html",
               "frontend/crypto.html", "frontend/styles.css", "frontend/three-bg.js",
               "frontend/sw.js", "frontend/js/*.js", "frontend/js/*/*.js"]
SPA_EXEMPT = ["frontend/ucl.html", "frontend/worldcup.html", "frontend/tests/*"]
SPA_ALLOWED_ORIGINS = {
    "rjasti.com", "www.rjasti.com", "staging-api.rjasti.com", "formsubmit.co",
    "github.com", "www.linkedin.com", "w3.org", "schema.org", "localhost",
    "127.0.0.1",
}

# Search roots from which a plain find/grep can descend into server/.venv.
VENV_REACHABLE = {"", ".", "server"}


def die(*lines: str) -> None:
    for line in lines:
        print(line, file=sys.stderr)
    sys.exit(2)


def tracked(root: Path, pathspec: str) -> set[str]:
    out = subprocess.run(["git", "ls-files", "--", pathspec],
                         cwd=root, capture_output=True, text=True)
    return {line for line in out.stdout.splitlines() if line}


def resolve_all(tokens: set[str], root: Path) -> set[str]:
    found: set[str] = set()
    for tok in tokens:
        rel = normalize(tok, root)
        if rel is not None:
            found.update(expand(rel, root))
    return found


def is_secret(rel: str) -> bool:
    name = Path(rel).name
    parent = Path(rel).parent.as_posix()
    return name.startswith(".env") and parent in (".", "server")


def check_spa_egress(command: str, written: set[str]) -> None:
    """ADR-016, on the Bash write path. The new text is the command itself."""
    guarded = [p for p in written
               if any(fnmatch.fnmatch(p, g) for g in SPA_GUARDED)
               and not any(fnmatch.fnmatch(p, e) for e in SPA_EXEMPT)]
    if not guarded:
        return
    for url in sorted(set(re.findall(r"https?://[A-Za-z0-9.-]+", command))):
        host = url.split("//", 1)[1]
        if host not in SPA_ALLOWED_ORIGINS:
            die(
                f"Error: Unapproved external asset/origin detected in {guarded[0]}: {url}",
                "Egress protection blocked this modification per ADR-016.",
            )


def check_venv_search(command: str, root: Path) -> None:
    """AGENTS.md's '--exclude-dir=.venv' rule, as an actual guarantee."""
    if ".venv" in command:
        return
    for segment in segments(tokenize(command)):
        clean = [t for t in segment if t not in REDIRECTS]
        name, args = _utility(clean)
        if name not in SEARCHERS:
            continue
        operands = _operands(args)
        if name == "find":
            roots = operands or ["."]
        elif name == "du":
            roots = operands or ["."]
        else:
            recursive = any(
                a == "--recursive" or a == "--dereference-recursive"
                or (a.startswith("-") and not a.startswith("--") and ("r" in a or "R" in a))
                for a in args
            )
            if not recursive and name != "rgrep":
                continue
            pattern_given = any(a.startswith(("-e", "-f", "--regexp", "--file")) for a in args)
            roots = (operands if pattern_given else operands[1:]) or ["."]

        for candidate in roots:
            rel = normalize(candidate, root)
            if rel is not None and rel.rstrip("/") in VENV_REACHABLE:
                die(
                    f"Error: `{name}` over `{candidate}` descends into server/.venv/ "
                    "(~7,500 files, 136 MB) and takes minutes.",
                    "Pass --exclude-dir=.venv (grep/du) or -not -path '*/.venv/*' (find),",
                    "or use the ripgrep-backed Grep/Glob tools, which skip it already.",
                    "See .claude/rules/navigation.md.",
                )


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
    targets = resolve_all(targets_raw, root)
    mentioned = resolve_all(mentioned_raw, root)

    # Secrets: reading one from the shell is as bad as writing it, and the
    # permissions deny list in settings.json only covers Read/Edit/Write.
    for rel in sorted(mentioned):
        if is_secret(rel):
            die(
                f"Error: {rel} holds live credentials and is denied to Read/Edit/Write.",
                "Reading it through Bash is the same disclosure. Use "
                "docs/CONFIGURATION.md for what a variable means, or ask the owner.",
            )

    # Tracked migrations are immutable (ADR-014). Untracked ones are new work.
    immutable = tracked(root, "server/alembic/versions")
    at_risk = targets | (mentioned if opaque else set())
    for rel in sorted(at_risk & immutable):
        die(
            f"Error: Migration {rel} is already tracked by git and immutable.",
            "Add a new revision instead: server/.venv/bin/alembic revision -m '<change>'.",
            "Refer to .claude/skills/alembic-guard/SKILL.md 1 for migration rules.",
        )

    # AGENTS.md 2: the intent/spec templates are copied, never overwritten.
    for rel in sorted(at_risk):
        if rel.startswith(".claude/templates/"):
            die(
                f"Error: {rel} is a template and is never written in place.",
                "Save to .claude/intents/YYYY-MM-DD-<slug>.md or "
                ".claude/specs/YYYY-MM-DD-<slug>.md instead (AGENTS.md 2).",
            )

    check_spa_egress(command, targets)
    check_venv_search(command, root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
