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
                 "check_mirror_drift", "check_templates", "check_rules",
                 "check_prohibited_config", "check_vendored_ecc"]:
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
