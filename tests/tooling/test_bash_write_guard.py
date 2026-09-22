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


# A read-only search whose *pattern* spells a guarded path touches nothing. The
# guard refused these for as long as it existed, which meant the deny list could
# not be grepped, audited or documented from the shell -- and the refusal arrived
# citing credential disclosure, which is not what happened. The exemption is
# positional and stops at the utilities that cannot write: the pattern operand of
# grep and friends, and nothing else.
SEARCH_PATTERN_ALLOWED = [
    ("grep the deny list", r"""grep -n 'Read(\./\{s})' .claude/settings.json"""),
    ("double-quoted pattern", r"""grep -n "Read(\./\{s})" .claude/settings.json"""),
    ("recursive search", r"""grep -rn '\{s}' scripts/"""),
    ("explicit -e pattern", r"""grep -e '{s}.local' docs/SECURITY.md"""),
    ("--regexp= form", r"""grep --regexp='\{s}' docs/SECURITY.md"""),
    ("egrep alternation", r"""egrep '(\{s}|secret)' docs/SECURITY.md"""),
    ("ripgrep", r"""rg '\{s}\.' docs/"""),
    # A directory-qualified pattern is the stronger case: `\{s}` on its own is
    # dropped by normalize() when it cannot be made repo-relative, while
    # `server/{s}` resolves to a real guarded path and is exempt only because of
    # the argument position it sits in.
    ("directory-qualified pattern", r"""grep -rn 'server/{s}' docs/"""),
]

# The same text in an argument position that really is a path stays refused.
SEARCH_PATTERN_BLOCKED = [
    ("pattern is a flag, file is the secret", "grep -n 'JWT' {s}"),
    ("pattern file is a real path", "grep -f {s} docs/SECURITY.md"),
    ("--file= is a real path", "grep --file={s} docs/SECURITY.md"),
    ("short cluster -nf takes a file", "grep -nf {s} docs/SECURITY.md"),
    ("-e given, so the operand is a file", "grep -e JWT {s}"),
    ("pattern in one command, read in the next", "grep {s} notes.md && cat {s}"),
    # awk, sed and perl can write from inside their own program text -- which is
    # why awk and perl are OPAQUE -- so their scripts are deliberately outside
    # the exemption even though they look like search patterns.
    ("awk program can write", "awk '{{print > \"server/{s}\"}}' notes.md"),
    ("sed w-command can write", "sed 's/a/b/w' server/{s} notes.md"),
]


@pytest.mark.parametrize("label,command", SEARCH_PATTERN_ALLOWED,
                         ids=[c[0] for c in SEARCH_PATTERN_ALLOWED])
def test_search_pattern_naming_a_secret_is_allowed(label: str, command: str) -> None:
    result = run(GUARD, command.format(s=SECRET))
    assert result.returncode == 0, f"{label}: blocked, stderr={result.stderr.strip()}"


@pytest.mark.parametrize("label,command", SEARCH_PATTERN_BLOCKED,
                         ids=[c[0] for c in SEARCH_PATTERN_BLOCKED])
def test_secret_in_a_path_position_is_still_blocked(label: str, command: str) -> None:
    result = run(GUARD, command.format(s=SECRET))
    assert result.returncode == 2, f"{label}: expected a block, got {result.returncode}"
    assert result.stderr.strip(), f"{label}: blocked without telling the model why"


def test_search_exemption_does_not_reach_write_targets() -> None:
    """The pattern is exempt; a redirection or a tee in the same command is not."""
    assert run(GUARD, f"grep -rn '{SECRET}' docs/ > {SECRET}").returncode == 2
    assert run(GUARD, f"grep -rn 'x' docs/ | tee {SECRET}").returncode == 2


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
