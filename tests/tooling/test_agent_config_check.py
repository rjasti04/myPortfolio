""".claude/rules/ is config the validator must accept, not config it must reject.

check_agent_config.py listed `.claude/rules` as a prohibited path before the
directory existed; the path-scoped navigation tables landed later and CI has
failed on every commit since. These tests pin both directions so the two cannot
drift apart again: the real repository has to pass, and a rules file that would
silently stop loading has to fail.
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


def test_repository_passes_its_own_validator():
    errors = []
    module = load_checker()
    for name in ["check_entrypoint", "check_skills", "check_agents", "check_settings",
                 "check_mirror_drift", "check_templates", "check_rules",
                 "check_prohibited_config"]:
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
