"""A read-only subagent stays read-only through Bash.

The four agents in .claude/agents/ remove Write, Edit and NotebookEdit from
themselves and keep Bash, which can `sed -i`, redirect and `git commit`. In
acceptEdits, auto or bypassPermissions mode the subagent inherits the main
session's mode, so nothing else held them to the promise. readonly-bash.py does,
for any agent whose `disallowedTools` removes both Write and Edit, and it is
inert for everyone else.

The refused cases cover every row of the policy's refused column. The allowed
ones are what a reviewer or the verifier really runs: a guard that blocks
`npm test` gets switched off, which is the same as not having one.
"""

from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / ".claude/hooks/readonly-bash.py"
AGENT = "security-reviewer"


def run(command: str, agent: str | None = AGENT, root: Path = ROOT) -> subprocess.CompletedProcess[str]:
    payload: dict = {"tool_name": "Bash", "tool_input": {"command": command}}
    if agent is not None:
        payload["agent_type"] = agent
    return subprocess.run(
        [sys.executable, str(GUARD)], input=json.dumps(payload), cwd=root,
        capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "CLAUDE_PROJECT_DIR": str(root)},
    )


def load_guard():
    spec = importlib.util.spec_from_file_location("readonly_bash", GUARD)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


REFUSED = [
    ("sed -i", "sed -i 's/a/b/' docs/API.md"),
    ("sed -n -i cluster", "sed -ni 's/a/b/p' docs/API.md"),
    ("sed w command", "sed -n 's/a/b/w out.txt' docs/API.md"),
    ("redirect into the repo", "echo x > notes.md"),
    ("append into the repo", "printf x >> docs/API.md"),
    ("heredoc into the repo", "cat > notes.md <<'EOF'\nx\nEOF"),
    ("absolute path inside the repo", f"echo x > {ROOT}/notes.md"),
    ("relative redirect after cd", "cd /tmp && echo x > notes.md"),
    ("tee", "echo x | tee notes.md"),
    ("cp", "cp /tmp/a docs/API.md"),
    ("mv", "mv docs/API.md /tmp/"),
    ("rm", "rm notes.md"),
    ("touch", "touch notes.md"),
    ("mkdir", "mkdir scratch"),
    ("curl -o", "curl -o x.js https://example.com/x.js"),
    ("git commit", "git commit -am wip"),
    ("git add", "git add ."),
    ("git checkout", "git checkout -- ."),
    ("git stash", "git stash"),
    ("git push", "git push"),
    ("git branch create", "git branch feature"),
    ("git -c", "git -c core.pager=cat log"),
    ("git diff --output", "git diff --output=x.patch"),
    ("check_docs --fix", "python3 scripts/check_docs.py --fix"),
    ("generate_resume without --check", "python3 scripts/generate_resume.py"),
    ("npm run format", "npm run format"),
    ("npm install", "npm install left-pad"),
    ("npx", "npx prettier --write ."),
    ("ruff --fix", "ruff check --fix server"),
    ("ruff format", "ruff format server"),
    ("python3 -c", "python3 -c \"print(1)\""),
    ("python3 -", "python3 - < /tmp/x.py"),
    ("python3 fed a heredoc", "python3 <<'EOF'\nprint(1)\nEOF"),
    ("another python script", "python3 scripts/optimize_images.py"),
    ("node -e", "node -e \"1\""),
    ("bash -c", "bash -c 'ls'"),
    ("eval", "eval ls"),
    ("source", "source .claude/hooks/session-start.sh"),
    ("command substitution", "echo $(git rev-parse HEAD)"),
    ("backticks", "echo `date`"),
    ("process substitution", "diff <(git show HEAD:README.md) README.md"),
    ("find -delete", "find . -name x -delete"),
    ("find -exec a writer", "find . -name x -exec rm {} +"),
    ("xargs a writer", "git ls-files | xargs rm"),
    ("a write on a second line", "git status\nsed -i 's/a/b/' docs/API.md"),
    ("pytest --basetemp", "pytest --basetemp=server"),
    ("pytest html report", "pytest --cov=server --cov-report=html"),
    ("alembic revision", "cd server && alembic revision -m x"),
    ("sort -o", "sort -o notes.md docs/API.md"),
    ("uniq's second operand", "uniq docs/API.md notes.md"),
    ("awk printing into a file", "awk '{print > \"x\"}' docs/API.md"),
    ("awk running a command", "awk 'BEGIN { system(\"date\") }'"),
    ("a repo file run directly", "./scripts/check_docs.py"),
    ("unbalanced quoting", "grep 'x docs/API.md"),
]

VERIFIER_GATES = [
    "ruff check server tests",
    "PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55",
    "npm run lint",
    "npm test",
    "npm run build",
    "python3 scripts/check_csp_hashes.py",
    "python3 scripts/check_docs.py --show-tokens",
]

ALLOWED = [
    ("documented sed recipe", "sed -n '284,298p' docs/JAVASCRIPT.md"),
    ("documented grep recipe", "grep -n '#region' frontend/styles.css"),
    ("security-audit route search", "grep -rn --exclude-dir=.venv 'add_api_route' server/routes"),
    ("stderr to /dev/null", "grep -q x docs/API.md 2>/dev/null"),
    ("pipeline", "git ls-files | grep '\\.py$' | wc -l"),
    ("git status", "git status --short"),
    ("git diff", "git diff --stat HEAD~1"),
    ("git log", "git --no-pager log --oneline -5"),
    ("git show", "git show HEAD --stat"),
    ("git -C", "git -C server diff"),
    ("git branch --show-current", "git branch --show-current"),
    ("git stash list", "git stash list"),
    ("git show into /tmp", "git show HEAD:README.md > /tmp/readme.md"),
    ("multi-line reads", "git status --short\ngit diff --stat"),
    ("for loop", "for f in docs/*.md; do wc -l \"$f\"; done"),
    ("find -exec a reader", "find frontend -name '*.js' -exec grep -l fetch {} +"),
    ("xargs a reader", "git ls-files docs | xargs wc -l"),
    ("jq with a comparison", "jq '.hooks | length > 1' .claude/settings.json"),
    ("awk with a comparison", "awk '$1 > 5 {print $1}' docs/API.md"),
    ("npm test to a scratch log", "npm test > /tmp/npm-test.log 2>&1"),
    ("alembic check", "cd server && PYTHONPATH=.. alembic check"),
    ("targeted node test", "node --test frontend/tests/activity-charts.test.js"),
    ("command -v", "command -v jq"),
    ("resume check", "npm run check:resume"),
    ("a comment line", "# where are the routes?\ngrep -rn 'APIRouter' server/routes"),
]


@pytest.mark.parametrize("label,command", REFUSED, ids=[c[0] for c in REFUSED])
def test_read_only_agent_is_refused(label: str, command: str) -> None:
    result = run(command)
    assert result.returncode == 2, f"{label}: expected a refusal, got {result.returncode}"
    assert "is read-only" in result.stderr and "refused:" in result.stderr


@pytest.mark.parametrize("command", VERIFIER_GATES)
def test_verifier_gates_are_allowed(command: str) -> None:
    """The seven commands verifier.md tells it to run, verbatim."""
    assert command in (ROOT / ".claude/agents/verifier.md").read_text(encoding="utf-8")
    result = run(command, agent="verifier")
    assert result.returncode == 0, result.stderr.strip()


@pytest.mark.parametrize("label,command", ALLOWED, ids=[c[0] for c in ALLOWED])
def test_read_only_agent_can_read(label: str, command: str) -> None:
    result = run(command)
    assert result.returncode == 0, f"{label}: {result.stderr.strip()}"


@pytest.mark.parametrize("agent", [None, "general-purpose"])
def test_other_callers_are_not_judged(agent: str | None) -> None:
    """No agent_type is the main session; general-purpose keeps Write and Edit."""
    assert run("sed -i 's/a/b/' docs/API.md", agent=agent).returncode == 0


@pytest.mark.parametrize("disallowed", ["\n  - Write\n  - Edit", " Write, Edit", " [Write, Edit]"])
def test_read_only_is_derived_from_disallowed_tools(disallowed: str, tmp_path: Path) -> None:
    """A fifth read-only agent is held the moment it exists, in any list form."""
    agents = tmp_path / ".claude" / "agents"
    agents.mkdir(parents=True)
    agents.joinpath("auditor.md").write_text(
        f"---\nname: auditor\ndescription: x\ndisallowedTools:{disallowed}\n---\n", encoding="utf-8")
    agents.joinpath("helper.md").write_text(
        "---\nname: helper\ndescription: x\ndisallowedTools:\n  - NotebookEdit\n---\n", encoding="utf-8")
    assert run("touch x", agent="auditor", root=tmp_path).returncode == 2
    assert run("touch x", agent="helper", root=tmp_path).returncode == 0


def test_every_npm_script_is_classified() -> None:
    """A new package.json script fails here until it is put in one of the sets."""
    guard = load_guard()
    scripts = set(json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"])
    assert guard.READ_SCRIPTS | guard.WRITE_SCRIPTS == scripts
    assert not guard.READ_SCRIPTS & guard.WRITE_SCRIPTS


def test_an_error_after_identification_refuses(monkeypatch: pytest.MonkeyPatch,
                                               capsys: pytest.CaptureFixture[str]) -> None:
    """Only exit 2 blocks, and a traceback exits 1: an error must not wave the command through."""
    guard = load_guard()

    def broken(command: str, root: Path) -> str | None:
        raise RuntimeError("boom")

    monkeypatch.setattr(guard, "refusal", broken)
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(ROOT))
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(
        {"agent_type": AGENT, "tool_input": {"command": "ls"}})))
    with pytest.raises(SystemExit) as exit_info:
        guard.main()
    assert exit_info.value.code == 2
    assert "could not check it" in capsys.readouterr().err


def test_malformed_payload_is_passed() -> None:
    """As in protect-bash-writes.py: a harness change must not block the main session."""
    result = subprocess.run([sys.executable, str(GUARD)], input="not json",
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0
