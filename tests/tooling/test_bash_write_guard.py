"""The Bash hooks in .claude/hooks/ must hold the same lines the Write/Edit ones do.

These guards exist because Claude Code matches hooks on tool name: everything in
`.claude/hooks/*.sh` is wired to `Write|Edit`, so a `sed -i` or a `>` reached
none of them. The cases below are split into what must be blocked and what must
stay out of the way -- a guard that blocks `npm ci` or a documented `sed -n`
recipe gets switched off by the first person it annoys, which is the same as not
having one.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / ".claude/hooks/protect-bash-writes.py"
VERIFY = ROOT / ".claude/hooks/verify-bash-edits.py"
SECRET = "." + "env"  # spelled out so this file is not itself a tripwire


def tracked_migration() -> str:
    out = subprocess.run(["git", "ls-files", "--", "server/alembic/versions"],
                         cwd=ROOT, capture_output=True, text=True)
    files = [line for line in out.stdout.splitlines() if line.endswith(".py")]
    if not files:
        pytest.skip("no tracked migration to test immutability against")
    return files[0]


def run(hook: Path, command: str, root: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(hook)],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}}),
        cwd=root, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "CLAUDE_PROJECT_DIR": str(root)},
    )


BLOCKED = [
    ("secret read", f"cat {SECRET}"),
    ("secret grep", f"grep JWT_SECRET {SECRET}"),
    ("secret append", f"echo FOO=1 >> {SECRET}.local"),
    ("server secret", f"cat server/{SECRET}"),
    ("template overwrite", "cp draft.md .claude/templates/intent.md"),
    ("template redirect", "echo x > .claude/templates/spec.md"),
    ("egress via sed", "sed -i 's|a|https://evil.example.com/x|' frontend/js/form.js"),
    ("egress via redirect", "echo 'https://cdnjs.cloudflare.com/x.js' > frontend/sw.js"),
]

ALLOWED = [
    ("read a migration", "cat server/alembic/versions/{migration}"),
    ("new untracked migration", "sed -i 's/a/b/' server/alembic/versions/9999_new_head.py"),
    ("documented sed recipe", "sed -n '284,298p' docs/JAVASCRIPT.md"),
    ("documented grep recipe", "grep -n '#region' frontend/styles.css"),
    ("install deps", "npm ci --no-audit --no-fund"),
    ("run the suite", "PYTHONPATH=. pytest"),
    ("allowlisted origin", "sed -i 's|a|https://formsubmit.co/y|' frontend/js/form.js"),
    ("exempt predictor page", "sed -i 's|a|https://flagcdn.com/x.png|' frontend/ucl.html"),
    ("scratch file", "echo hi > /tmp/scratch.txt"),
    ("plain status", "git status --short"),
]


# The .venv rule is the one guard that is conditional by design: it fires only
# where server/.venv actually exists, because a fresh clone -- CI and every web
# session -- has none, and blocking there costs a call and a retry to avoid a
# directory walk that cannot happen. So the rule cannot be asserted against this
# repo, where the directory is present or absent depending on whose machine it
# is; it needs a root built either way, and both ways are pinned below.
VENV_BLOCKED = [
    ("venv-reachable grep", "grep -r 'async def' ."),
    ("venv-reachable grep on server", "grep -rn 'FastAPI' server"),
    ("venv-reachable find", "find . -name '*.py'"),
]

VENV_ALLOWED = [
    ("excluded grep", "grep -r 'async def' . --exclude-dir=.venv"),
    ("scoped grep", "grep -rn 'FastAPI' server/routes"),
    ("scoped find", "find frontend -name '*.js'"),
]


@pytest.fixture(scope="module")
def venv_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A project root holding server/.venv, so the repo never grows a fake one."""
    root = tmp_path_factory.mktemp("with-venv")
    (root / "server" / ".venv").mkdir(parents=True)
    return root


@pytest.mark.parametrize("label,command", BLOCKED, ids=[c[0] for c in BLOCKED])
def test_guard_blocks(label: str, command: str) -> None:
    result = run(GUARD, command)
    assert result.returncode == 2, f"{label}: expected a block, got {result.returncode}"
    assert result.stderr.strip(), f"{label}: blocked without telling the model why"


@pytest.mark.parametrize("label,command", ALLOWED, ids=[c[0] for c in ALLOWED])
def test_guard_allows(label: str, command: str) -> None:
    command = command.format(migration=Path(tracked_migration()).name)
    result = run(GUARD, command)
    assert result.returncode == 0, f"{label}: blocked, stderr={result.stderr.strip()}"


@pytest.mark.parametrize("label,command", VENV_BLOCKED, ids=[c[0] for c in VENV_BLOCKED])
def test_guard_blocks_venv_reachable_search(label: str, command: str, venv_root: Path) -> None:
    result = run(GUARD, command, root=venv_root)
    assert result.returncode == 2, f"{label}: expected a block, got {result.returncode}"
    assert result.stderr.strip(), f"{label}: blocked without telling the model why"


@pytest.mark.parametrize("label,command", VENV_ALLOWED, ids=[c[0] for c in VENV_ALLOWED])
def test_guard_allows_scoped_search(label: str, command: str, venv_root: Path) -> None:
    result = run(GUARD, command, root=venv_root)
    assert result.returncode == 0, f"{label}: blocked, stderr={result.stderr.strip()}"


@pytest.mark.parametrize("label,command", VENV_BLOCKED, ids=[c[0] for c in VENV_BLOCKED])
def test_venv_rule_is_quiet_without_a_venv(label: str, command: str, tmp_path: Path) -> None:
    """Nothing to descend into, so the same searches must cost nothing (#217)."""
    (tmp_path / "server").mkdir()
    result = run(GUARD, command, root=tmp_path)
    assert result.returncode == 0, f"{label}: blocked, stderr={result.stderr.strip()}"


@pytest.mark.parametrize("template", [
    "sed -i 's/a/b/' {path}",
    "echo x > {path}",
    "tee {path} < /dev/null",
    "cp /tmp/other.py {path}",
    "rm {path}",
    "python3 -c \"open('{path}', 'w')\"",
])
def test_tracked_migrations_are_immutable(template: str) -> None:
    result = run(GUARD, template.format(path=tracked_migration()))
    assert result.returncode == 2, f"migration write not blocked: {template}"
    assert "immutable" in result.stderr


def test_heredoc_body_is_not_read_as_operands() -> None:
    """Writing a file that merely mentions a guarded path must not be blocked."""
    body = f"cat > notes.md <<'EOF'\nwe never read {SECRET} from the shell\nEOF"
    assert run(GUARD, body).returncode == 0


def test_guard_ignores_malformed_payload() -> None:
    result = subprocess.run([sys.executable, str(GUARD)], input="not json",
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0


def test_verify_runs_gates_for_covered_paths() -> None:
    # Both gates pass on a clean tree, so a covered path must come back green
    # rather than quietly not running at all.
    assert run(VERIFY, "sed -i 's/a/a/' frontend/index.html").returncode == 0
    assert run(VERIFY, "sed -i 's/a/a/' docs/API.md").returncode == 0


def test_verify_skips_uncovered_paths() -> None:
    assert run(VERIFY, "echo hi > /tmp/scratch.txt").returncode == 0
