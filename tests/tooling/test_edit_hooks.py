"""The Write/Edit hooks in .claude/hooks/ refuse when they cannot check.

Claude Code blocks a PreToolUse call on exit 2 and on nothing else: exit 1, 127
or a timeout is a "non-blocking error" and the edit goes ahead. Both shell guards
run under `set -euo pipefail` and read their input with `jq`, so a missing `jq`
(127) or input it cannot parse (5) used to wave through exactly the edit the
guard exists to stop. They now turn every failure into a refusal, and these
tests hold them to it.

The ADR-016 origin rule lives in two places, an ERE in protect-spa-egress.sh for
the Write/Edit path and a Python regex in protect-bash-writes.py for the Bash
path. One case table runs through both, so the two cannot drift apart. That is
the same promise spa-egress.json makes for the allowlist they share.
"""

from __future__ import annotations

import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / ".claude/hooks"
BASH = shutil.which("bash") or "/bin/bash"
GUARDS = ["protect-migrations.sh", "protect-spa-egress.sh"]


def tracked_migration() -> str:
    out = subprocess.run(["git", "ls-files", "--", "server/alembic/versions"],
                         cwd=ROOT, capture_output=True, text=True)
    files = [line for line in out.stdout.splitlines() if line.endswith(".py")]
    if not files:
        pytest.skip("no tracked migration to test immutability against")
    return files[0]


def edit(rel: str, new_string: str = "x", root: Path = ROOT) -> str:
    return json.dumps({"tool_name": "Edit", "tool_input": {
        "file_path": str(root / rel), "old_string": "a", "new_string": new_string}})


def run_hook(name: str, stdin: str, path: str = "/usr/bin:/bin:/usr/local/bin",
             root: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [BASH, str(HOOKS / name)], input=stdin, cwd=root, capture_output=True,
        text=True, env={"PATH": path, "CLAUDE_PROJECT_DIR": str(root)},
    )


def guarded_path(guard: str) -> str:
    return tracked_migration() if guard == "protect-migrations.sh" else "frontend/js/form.js"


@pytest.mark.parametrize("guard", GUARDS)
def test_guard_refuses_when_jq_is_missing(guard: str, tmp_path: Path) -> None:
    """Every other tool the guard uses is on PATH; only jq is not."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for tool in ("cat", "dirname", "git", "grep", "sed", "sort", "tr"):
        found = shutil.which(tool)
        if found:
            (bindir / tool).symlink_to(found)
    result = run_hook(guard, edit(guarded_path(guard)), path=str(bindir))
    assert result.returncode == 2, f"exit {result.returncode}: {result.stderr.strip()}"
    assert "jq" in result.stderr


@pytest.mark.parametrize("guard", GUARDS)
def test_guard_refuses_input_it_cannot_parse(guard: str) -> None:
    result = run_hook(guard, "not json")
    assert result.returncode == 2, f"exit {result.returncode}: {result.stderr.strip()}"
    assert "refusing" in result.stderr


@pytest.mark.parametrize("guard", GUARDS)
def test_guard_still_passes_an_unguarded_edit(guard: str) -> None:
    """The trap must not turn the ordinary no-op path into a refusal."""
    result = run_hook(guard, edit("docs/API.md"))
    assert result.returncode == 0, result.stderr.strip()


def test_migration_guard_refuses_a_tracked_migration() -> None:
    result = run_hook("protect-migrations.sh", edit(tracked_migration()))
    assert result.returncode == 2
    assert "immutable" in result.stderr


# (label, text written into an SPA file, refused?)
EGRESS_CASES = [
    ("https scheme", '<script src="https://cdn.example.com/x.js"></script>', True),
    ("protocol-relative src", '<script src="//cdn.example.com/x.js"></script>', True),
    ("protocol-relative import", "import x from '//cdn.example.com/x.js';", True),
    ("protocol-relative css url()", "url(//fonts.example.com/a.woff2)", True),
    ("second srcset candidate", '<img srcset="a.png 1x, //cdn.example.com/b.png 2x">', True),
    ("websocket scheme", "new WebSocket('wss://live.example.com/s')", True),
    ("ip literal", 'fetch("//10.0.0.5/beacon")', True),
    ("allowlisted protocol-relative", "//rjasti.com/x.js", False),
    ("allowlisted https", "https://formsubmit.co/ajax/x", False),
    ("line comment", "// see below", False),
    ("comment without a space", "//TODO fix", False),
    ("double slash inside a path", "a//b.c", False),
    ("loopback with a port", "http://localhost:8000/api", False),
]


@pytest.mark.parametrize("label,text,refused", EGRESS_CASES, ids=[c[0] for c in EGRESS_CASES])
def test_both_egress_guards_agree(label: str, text: str, refused: bool) -> None:
    """The Edit guard sees the new text; the Bash guard sees a command writing it."""
    by_edit = run_hook("protect-spa-egress.sh", edit("frontend/js/form.js", text))
    command = f"printf '%s' {shlex.quote(text)} >> frontend/js/form.js"
    by_bash = subprocess.run(
        [sys.executable, str(HOOKS / "protect-bash-writes.py")],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}}),
        cwd=ROOT, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "CLAUDE_PROJECT_DIR": str(ROOT)},
    )
    expected = 2 if refused else 0
    assert (by_edit.returncode, by_bash.returncode) == (expected, expected), (
        f"{label}: Edit guard {by_edit.returncode} ({by_edit.stderr.strip()}), "
        f"Bash guard {by_bash.returncode} ({by_bash.stderr.strip()})"
    )
