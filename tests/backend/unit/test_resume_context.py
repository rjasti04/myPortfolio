"""The chat persona's facts come from content/resume.json, not from prose.

The hand-maintained block these replace had drifted: it told visitors the
frontend was built with Three.js, which this repository has never contained.
These tests fail if the generated copy goes stale or if a factual claim is
typed back into the prompt by hand.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content" / "resume.json"


@pytest.fixture(scope="module")
def resume() -> dict:
    return json.loads(SOURCE.read_text(encoding="utf-8"))


def test_generated_copies_match_the_source():
    """`npm run check:resume`, as CI runs it."""
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "generate_resume.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_persona_facts_come_from_the_source(resume):
    from server.config.resume_context import ABOUT_THIS_SITE, KEY_INFORMATION

    for line in resume["persona"]["summary"]:
        assert line in KEY_INFORMATION
    for line in resume["persona"]["siteFacts"]:
        assert line in ABOUT_THIS_SITE


def test_the_system_prompt_carries_those_facts():
    from server.config.resume_context import ABOUT_THIS_SITE, KEY_INFORMATION
    from server.services.bedrock_service import DEFAULT_SYSTEM_PROMPT

    assert KEY_INFORMATION in DEFAULT_SYSTEM_PROMPT
    assert ABOUT_THIS_SITE in DEFAULT_SYSTEM_PROMPT


@pytest.mark.parametrize(
    "absent",
    ["Three.js", "React", "Vue", "jQuery", "Tailwind", "Bootstrap"],
)
def test_the_prompt_never_claims_a_framework_this_repo_does_not_use(absent):
    """Each of these is named in the prompt only as something the site does NOT use.

    The regression this guards is precise: the old prompt listed Three.js in a
    "Frontend Stack:" line, so the assistant asserted it as a fact. Naming it
    inside the sentence that denies it is correct and must stay allowed.
    """
    from server.services.bedrock_service import DEFAULT_SYSTEM_PROMPT

    denial = "no React, Vue, Svelte, jQuery, Three.js or CSS preprocessor"
    assert denial in DEFAULT_SYSTEM_PROMPT
    remainder = DEFAULT_SYSTEM_PROMPT.replace(denial, "")
    assert absent not in remainder


def test_no_frontend_framework_is_listed_as_a_stack_entry():
    from server.services.bedrock_service import DEFAULT_SYSTEM_PROMPT

    for line in DEFAULT_SYSTEM_PROMPT.splitlines():
        if line.startswith("- Frontend"):
            assert "Three.js" not in line
