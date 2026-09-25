""".claude/rules/ is config the validator must accept, not config it must reject.

check_agent_config.py listed `.claude/rules` as a prohibited path before the
directory existed; the path-scoped navigation tables landed later and CI has
failed on every commit since. These tests pin both directions so the two cannot
drift apart again: the real repository has to pass, and a rules file that would
silently stop loading has to fail.

The same file now also owns the ECC boundary. ECC installs skill directories flat
into .claude/skills/, next to the project's own, and ships 24 hooks this repo runs
none of - so the only thing separating a deliberate three-skill integration from a
292-skill one is check_vendored_ecc. These cases pin that too: an unlisted skill, a
vendored file that lost its provenance marker, an install-state with nothing left to
uninstall, and a hook that did not come from .claude/hooks/ are each an error.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/check_agent_config.py"

RULE_FILE = "---\npaths:\n  - docs/**\n---\n\n# body\n"


def load_checker():
    spec = importlib.util.spec_from_file_location("check_agent_config", CHECKER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def checker(monkeypatch, tmp_path):
    """The validator against a throwaway ROOT, so a case can shape the tree."""
    module = load_checker()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    return module


def rules_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".claude" / "rules"
    d.mkdir(parents=True)
    return d


def write_skill(tmp_path: Path, name: str, origin: str | None) -> None:
    """A minimal SKILL.md, with or without the marker the installer writes."""
    d = tmp_path / ".claude" / "skills" / name
    d.mkdir(parents=True, exist_ok=True)
    marker = f"metadata:\n  origin: {origin}\n" if origin else ""
    d.joinpath("SKILL.md").write_text(
        f"---\nname: {name}\ndescription: x\n{marker}---\n\n# body\n",
        encoding="utf-8",
    )


def write_install_state(tmp_path: Path) -> None:
    d = tmp_path / ".claude" / "ecc"
    d.mkdir(parents=True, exist_ok=True)
    d.joinpath("install-state.json").write_text("{}", encoding="utf-8")


def test_repository_passes_its_own_validator():
    errors = []
    module = load_checker()
    for name in ["check_entrypoint", "check_skills", "check_agents", "check_settings",
                 "check_readonly_guard", "check_mirror_drift", "check_templates",
                 "check_rules", "check_prohibited_config", "check_vendored_ecc"]:
        getattr(module, name)(errors)
    assert errors == []


def test_rules_directory_is_not_prohibited(checker, tmp_path):
    rules_dir(tmp_path)
    errors = []
    checker.check_prohibited_config(errors)
    assert errors == []


@pytest.mark.parametrize("name", [".claudeignore", ".claude/commands",
                                  ".claude/adrs", ".claude/memory"])
def test_prohibited_paths_still_rejected(checker, tmp_path, name):
    (tmp_path / name).mkdir(parents=True)
    errors = []
    checker.check_prohibited_config(errors)
    assert len(errors) == 1 and name.split("/")[-1] in errors[0]


def test_missing_rules_file_is_an_error(checker, tmp_path):
    (rules_dir(tmp_path) / "navigation.md").write_text(RULE_FILE, encoding="utf-8")
    errors = []
    checker.check_rules(errors)
    assert len(errors) == 1 and "reference-docs.md" in errors[0]


def test_rules_file_without_paths_frontmatter_is_an_error(checker, tmp_path):
    d = rules_dir(tmp_path)
    d.joinpath("navigation.md").write_text("# no frontmatter\n", encoding="utf-8")
    d.joinpath("reference-docs.md").write_text(RULE_FILE, encoding="utf-8")
    errors = []
    checker.check_rules(errors)
    assert len(errors) == 1 and "paths" in errors[0]


def test_well_formed_rules_pass(checker, tmp_path):
    d = rules_dir(tmp_path)
    for name in ("navigation.md", "reference-docs.md"):
        d.joinpath(name).write_text(RULE_FILE, encoding="utf-8")
    errors = []
    checker.check_rules(errors)
    assert errors == []


def test_unlisted_skill_directory_is_rejected(checker, tmp_path):
    """The 293rd skill has to announce itself. `--profile` installs are how it arrives."""
    for name in checker.PROJECT_SKILLS:
        write_skill(tmp_path, name, None)
    for name in checker.VENDORED_ECC_SKILLS:
        write_skill(tmp_path, name, "ECC")
    write_install_state(tmp_path)
    write_skill(tmp_path, "tdd-workflow", "ECC")

    errors = []
    checker.check_vendored_ecc(errors)
    assert len(errors) == 1 and "tdd-workflow" in errors[0]


def test_vendored_skill_without_origin_marker_is_rejected(checker, tmp_path):
    """A lost marker means the file was hand-edited, which breaks the upgrade path."""
    for name in checker.PROJECT_SKILLS:
        write_skill(tmp_path, name, None)
    for name in checker.VENDORED_ECC_SKILLS:
        write_skill(tmp_path, name, "ECC")
    write_skill(tmp_path, checker.VENDORED_ECC_SKILLS[0], None)
    write_install_state(tmp_path)

    errors = []
    checker.check_vendored_ecc(errors)
    assert len(errors) == 1 and "origin: ECC" in errors[0]


def test_install_state_without_vendored_skills_is_rejected(checker, tmp_path):
    """Deleting the skills by hand leaves ECC state that nothing will ever collect."""
    for name in checker.PROJECT_SKILLS:
        write_skill(tmp_path, name, None)
    write_install_state(tmp_path)

    errors = []
    checker.check_vendored_ecc(errors)
    assert len(errors) == 1 and "install-state.json" in errors[0]


def test_hook_outside_project_hooks_directory_is_rejected(checker, tmp_path):
    """ECC's hooks are inline `node -e` commands under otherwise valid event names."""
    for name in checker.PROJECT_SKILLS:
        write_skill(tmp_path, name, None)
    settings = tmp_path / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(
        '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": '
        '[{"type": "command", "command": "node -e \\"require(\'ecc\')\\""}]}]}}',
        encoding="utf-8",
    )

    errors = []
    checker.check_vendored_ecc(errors)
    assert len(errors) == 1 and ".claude/hooks/" in errors[0]


# --- settings.json invariants ---------------------------------------------
#
# These three came out of docs/review/claude-setup.md. Each replaces a rule that
# was previously either prose or a coincidence, and each fails loudly rather than
# letting the configuration drift quietly.


def write_settings(tmp_path: Path, payload: dict) -> None:
    settings = tmp_path / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps(payload), encoding="utf-8")


SECRET = "." + "env"  # spelled out so this file is not itself a tripwire


@pytest.mark.parametrize("pattern", [
    f"Read(**/{SECRET}.*)",
    f"Edit(**/{SECRET}.*)",
    f"Read(./{SECRET}.example)",
    f"Read({SECRET}.*)",
])
def test_deny_rule_covering_the_example_file_is_rejected(checker, tmp_path, pattern):
    """`**/` is not a literal path segment, which fnmatch alone got wrong.

    .env.example is tracked and is the documented variable reference. A glob that
    swallows it makes the one file an agent is supposed to read unreadable, and
    Read also governs Edit and Write, so the block is total.
    """
    (tmp_path / f"{SECRET}.example").write_text("X=1\n", encoding="utf-8")
    write_settings(tmp_path, {"permissions": {"deny": [pattern]}})

    errors = []
    checker.check_settings(errors)
    assert any(".example" in e for e in errors), errors


def test_negation_after_the_rule_carves_the_example_back_out(checker, tmp_path):
    """A `!` rule is a gitignore negation against the rules listed before it."""
    (tmp_path / f"{SECRET}.example").write_text("X=1\n", encoding="utf-8")
    write_settings(tmp_path, {"permissions": {"deny": [
        f"Read(**/{SECRET})", f"Read(**/{SECRET}.*)", f"Read(!**/{SECRET}.example)",
        f"Edit(**/{SECRET})", f"Edit(**/{SECRET}.*)", f"Edit(!**/{SECRET}.example)",
    ]}})

    errors = []
    checker.check_settings(errors)
    assert not [e for e in errors if ".example" in e], errors


def test_negation_listed_first_carves_nothing_out(checker, tmp_path):
    """Order matters: a `!` rule only affects the rules above it."""
    (tmp_path / f"{SECRET}.example").write_text("X=1\n", encoding="utf-8")
    write_settings(tmp_path, {"permissions": {"deny": [
        f"Read(!**/{SECRET}.example)", f"Read(**/{SECRET}.*)",
    ]}})

    errors = []
    checker.check_settings(errors)
    assert any(".example" in e for e in errors), errors


def test_deprecated_attribution_key_is_rejected(checker, tmp_path):
    """ECC's installer writes this key back; its return must not be silent."""
    write_settings(tmp_path, {"includeCoAuthoredBy": False, "permissions": {"deny": []}})

    errors = []
    checker.check_settings(errors)
    assert any("includeCoAuthoredBy" in e for e in errors), errors


@pytest.mark.parametrize("event", [
    "Setup", "PostToolUseFailure", "FileChanged", "InstructionsLoaded", "PostCompact",
])
def test_documented_hook_events_are_accepted(checker, tmp_path, event):
    """The allowlist held nine of thirty-three and failed CI on legitimate hooks."""
    write_settings(tmp_path, {"hooks": {event: [{"hooks": [
        {"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh'},
    ]}]}})

    errors = []
    checker.check_settings(errors)
    assert not [e for e in errors if "Invalid hook event" in e], errors


def test_misspelt_hook_event_is_still_rejected(checker, tmp_path):
    """The point of a closed allowlist: a typo'd event is never dispatched."""
    write_settings(tmp_path, {"hooks": {"SessionStrat": [{"hooks": [
        {"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh'},
    ]}]}})

    errors = []
    checker.check_settings(errors)
    assert any("Invalid hook event" in e for e in errors), errors


def test_if_filter_on_a_write_and_edit_group_is_rejected(checker, tmp_path):
    """`if` names one tool, so on a Write|Edit group it disables half the gate."""
    write_settings(tmp_path, {"hooks": {"PostToolUse": [{
        "matcher": "Write|Edit",
        "hooks": [{
            "type": "command",
            "if": "Edit(frontend/index.html)",
            "command": '"$CLAUDE_PROJECT_DIR"/.claude/hooks/verify-csp.sh',
        }],
    }]}})

    errors = []
    checker.check_settings(errors)
    assert any("covers both Write and Edit" in e for e in errors), errors


def test_if_filter_on_a_single_tool_group_is_allowed(checker, tmp_path):
    """Narrowing is fine once the group cannot span both write paths."""
    write_settings(tmp_path, {"hooks": {"PostToolUse": [{
        "matcher": "Bash",
        "hooks": [{
            "type": "command",
            "if": "Bash(git *)",
            "command": '"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh',
        }],
    }]}})

    errors = []
    checker.check_settings(errors)
    assert not [e for e in errors if "covers both Write and Edit" in e], errors


# --- read-only agents -------------------------------------------------------
#
# From docs/review/codebase_review_20260924.md CS1. `disallowedTools` removed
# Write and Edit from the four reviewers, and Bash could still write for them.
# The guard that closes that is only as good as its registration, so the
# validator checks the registration exists wherever an agent needs it.


GUARD_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/readonly-bash.py'


def write_agent(tmp_path: Path, name: str, disallowed: list[str]) -> None:
    d = tmp_path / ".claude" / "agents"
    d.mkdir(parents=True, exist_ok=True)
    items = "".join(f"  - {tool}\n" for tool in disallowed)
    d.joinpath(f"{name}.md").write_text(
        f"---\nname: {name}\ndescription: x\ndisallowedTools:\n{items}---\n\n# body\n",
        encoding="utf-8",
    )


def test_read_only_agent_without_the_bash_guard_is_rejected(checker, tmp_path):
    write_agent(tmp_path, "auditor", ["Write", "Edit"])
    write_settings(tmp_path, {"hooks": {}})

    errors = []
    checker.check_readonly_guard(errors)
    assert len(errors) == 1 and "readonly-bash.py" in errors[0] and "auditor" in errors[0]


def test_bash_guard_registered_for_other_tools_does_not_count(checker, tmp_path):
    write_agent(tmp_path, "auditor", ["Write", "Edit"])
    write_settings(tmp_path, {"hooks": {"PreToolUse": [
        {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": GUARD_COMMAND}]},
    ]}})

    errors = []
    checker.check_readonly_guard(errors)
    assert len(errors) == 1


def test_bash_guard_registered_for_bash_passes(checker, tmp_path):
    write_agent(tmp_path, "auditor", ["Write", "Edit"])
    write_settings(tmp_path, {"hooks": {"PreToolUse": [
        {"matcher": "Bash", "hooks": [{"type": "command", "command": GUARD_COMMAND}]},
    ]}})

    errors = []
    checker.check_readonly_guard(errors)
    assert errors == []


def test_agent_that_keeps_write_needs_no_guard(checker, tmp_path):
    write_agent(tmp_path, "helper", ["NotebookEdit"])
    write_settings(tmp_path, {"hooks": {}})

    errors = []
    checker.check_readonly_guard(errors)
    assert errors == []
