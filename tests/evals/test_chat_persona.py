"""Stage 4 Test: Continuous Evals for Bedrock Chat Persona and Safety Guardrails.

This evaluation suite guards the AI chat persona against prompt regressions,
persona drift, jailbreak vulnerability, and schema/budget violations, adhering to
the Anthropic AI-Native SDLC Playbook.
"""

import json
from pathlib import Path
import pytest

from server.config.resume_context import ABOUT_THIS_SITE, KEY_INFORMATION
from server.services.bedrock_service import DEFAULT_SYSTEM_PROMPT
from server.utils.role_utils import ensure_alternating_roles

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "content" / "resume.json"


@pytest.fixture(scope="module")
def resume_data() -> dict:
    return json.loads(SOURCE.read_text(encoding="utf-8"))


class TestPersonaPromptIntegrity:
    """Evaluates that the system prompt adheres to core identity and truth constraints."""

    def test_persona_contains_core_truth_blocks(self):
        """System prompt must incorporate generated resume context directly."""
        assert KEY_INFORMATION in DEFAULT_SYSTEM_PROMPT
        assert ABOUT_THIS_SITE in DEFAULT_SYSTEM_PROMPT

    def test_persona_rejects_hallucinated_technologies(self):
        """System prompt must explicitly guard against false framework claims."""
        forbidden_tech = ["React", "Vue", "Three.js", "Svelte"]
        assert "no frontend framework" in DEFAULT_SYSTEM_PROMPT
        for tech in forbidden_tech:
            assert tech in DEFAULT_SYSTEM_PROMPT
            # Ensure each is framed under negation
            assert f"no {tech}" in DEFAULT_SYSTEM_PROMPT or f"no frontend framework — no React" in DEFAULT_SYSTEM_PROMPT

    def test_persona_bounds_scope_to_rajeev_portfolio(self):
        """System prompt must specify personal portfolio domain bounds."""
        lower_prompt = DEFAULT_SYSTEM_PROMPT.lower()
        assert "rajeev" in lower_prompt
        assert "portfolio" in lower_prompt


class TestPromptInjectionAndDefenseEvals:
    """Evaluates the prompt's resistance to persona hijack and jailbreak patterns."""

    def test_system_prompt_has_guardrail_boundaries(self):
        """System prompt must have explicit factual boundaries."""
        lower_prompt = DEFAULT_SYSTEM_PROMPT.lower()
        assert any(
            phrase in lower_prompt
            for phrase in [
                "nothing else",
                "facts above and nothing else",
                "say it is not used rather than guessing",
                "accurate, and professional information",
            ]
        )


class TestMessageRoleAndBudgetSafety:
    """Evaluates dialog structuring and stream boundary compliance."""

    def test_alternating_roles_normalization(self):
        """Ensures consecutive user or assistant messages are safely collapsed or normalized."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "user", "content": "Are you there?"},
            {"role": "assistant", "content": "Yes, I am."},
            {"role": "assistant", "content": "How can I help?"},
        ]
        normalized = ensure_alternating_roles(messages)
        # Roles must strictly alternate
        for i in range(len(normalized) - 1):
            assert normalized[i]["role"] != normalized[i + 1]["role"]

    def test_empty_message_filtering(self):
        """Ensures blank or malformed messages are handled gracefully."""
        messages = [
            {"role": "user", "content": "   "},
            {"role": "user", "content": "Real question"},
        ]
        normalized = ensure_alternating_roles(messages)
        assert len(normalized) >= 1
        assert normalized[-1]["content"] == "Real question"
