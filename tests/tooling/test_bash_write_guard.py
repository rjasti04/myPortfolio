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
    # A line break ends a command. It used to be lexed as whitespace, so every
    # later line merged into the first line's segment and was never judged.
    ("egress on a second line", "cd /tmp\nsed -i 's|a|https://evil.example.com/x|' frontend/js/form.js"),
    ("template on a second line", "cd /tmp\ncp draft.md .claude/templates/intent.md"),
    # Scheme-less and non-http origins are origins too.
    ("protocol-relative egress", "sed -i 's|a|//evil.example.com/x.js|' frontend/js/form.js"),
    ("websocket egress", "sed -i \"s|a|new WebSocket('wss://evil.example.com')|\" frontend/js/form.js"),
    # An opaque writer into an SPA file is checked for origins, as it already
    # was for migrations and templates.
    ("egress through python3 -c",
     "python3 -c \"open('frontend/js/form.js', 'a').write('https://evil.example.com/x.js')\""),
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
    # The forms the tokenizer now looks into, used the way agents use them.
    ("multi-line reads", "git status --short\ngit diff --stat"),
    ("a comment, then a read", "# look first\ngit log --oneline -3"),
    ("xargs into a reader", "git ls-files docs | xargs wc -l"),
    ("find -exec into a reader", "find frontend -name '*.js' -exec grep -l fetch {{}} +"),
    ("allowlisted protocol-relative origin", "sed -i 's|a|//rjasti.com/x.js|' frontend/js/form.js"),
    ("a line comment is not an origin", "sed -i 's|a|// see below|' frontend/js/form.js"),
    # Clusters that read: no `i` among the flags, or one that is only text.
    ("sed -nE reads", "sed -nE '/x/p' server/alembic/versions/{migration}"),
    ("perl -ne reads", "perl -ne 'print if /i/' server/alembic/versions/{migration}"),
]


# The .venv rule is the one guard that is conditional by design: it fires only
# where server/.venv actually exists. CI's fresh clone has none, and blocking
# there costs a call and a retry to avoid a directory walk that cannot happen;
# a web session has one, because session-start.sh creates it. So the rule
# cannot be asserted against this repo, where the directory is present or absent
# depending on where it runs; it needs a root built either way, and both ways
# are pinned below.
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
    # Segmentation: each of these reached the write from a place the old
    # tokenizer merged away or split wrongly.
    "cd /tmp\nsed -i 's/a/b/' {path}",
    "sed -i \\\n  's/a/b/' {path}",
    "echo start # tidy up\nsed -i 's/a/b/' {path}",
    "(sed -i 's/a/b/' {path})",
    "(true);sed -i 's/a/b/' {path}",
    "if sed -i 's/a/b/' {path}; then :; fi",
    "{{ sed -i 's/a/b/' {path}; }}",
    # Opacity: text run as a command somewhere no segment sees it.
    "bash -c \"sed -i 's/a/b/' {path}\"",
    "sh -c 'rm {path}'",
    "eval \"rm {path}\"",
    "x=$(rm {path})",
    "echo $(sed -i 's/a/b/' {path})",
    "echo `rm {path}`",
    "find {path} -delete",
    "echo {path} | xargs rm",
    # In place from inside an option cluster, which `startswith("-i")` missed.
    "perl -pi -e 's/a/b/' {path}",
    "sed -ni 's/a/b/p' {path}",
    "sed -Ei 's/a/b/' {path}",
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


def test_heredoc_body_is_not_a_search(venv_root: Path) -> None:
    """A body line is text being written. Once line breaks split segments, a
    body line reading `find .` looked like a search that descends into .venv."""
    body = "cat > notes.md <<'EOF'\nfind . -name '*.py'\ngrep -r x .\nEOF"
    assert run(GUARD, body, root=venv_root).returncode == 0


def test_commit_message_naming_guarded_paths_is_allowed() -> None:
    """`$(…)` makes a command opaque, and an opaque command falls back to the
    paths it mentions. The heredoc body is stripped before mentions are
    collected, so the usual commit idiom stays usable even when the message
    names a migration, an SPA file and an origin."""
    message = f"Touch {tracked_migration()} and frontend/index.html (https://evil.example.com)"
    command = f"git commit -m \"$(cat <<'EOF'\n{message}\nEOF\n)\""
    result = run(GUARD, command)
    assert result.returncode == 0, result.stderr.strip()


def test_guard_refuses_when_it_cannot_check(tmp_path: Path) -> None:
    """Only exit 2 blocks. A traceback exits 1, and the command would run
    unchecked, so an unexpected error refuses instead. A project root that does
    not exist makes `git ls-files` raise."""
    result = subprocess.run(
        [sys.executable, str(GUARD)],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git status"}}),
        cwd=ROOT, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "CLAUDE_PROJECT_DIR": str(tmp_path / "missing")},
    )
    assert result.returncode == 2
    assert "refusing" in result.stderr


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


def test_verify_sees_a_write_on_a_second_line(tmp_path: Path) -> None:
    """The CSP gate has to run for a write found only after a line break.

    Against this repo the gate passes whether it runs or not, so the root here
    is a stub whose check exits 1: exit 2 is then proof that it ran.
    """
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "check_csp_hashes.py").write_text("raise SystemExit(1)\n", encoding="utf-8")
    result = run(VERIFY, "cd /tmp\nsed -i 's/a/a/' frontend/index.html", root=tmp_path)
    assert result.returncode == 2
