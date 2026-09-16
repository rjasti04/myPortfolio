#!/usr/bin/env python3
"""
scripts/check_agent_config.py

Validator for AI agent configuration across .claude/, .agents/, and related CI workflows.
Ensures entrypoints, skills, agents, settings, permissions, templates, mirror drift, and
the vendored-ECC boundary comply with repository standards.
"""

import fnmatch
import json
import os
import re
import sys
from pathlib import Path

# Every lifecycle event Claude Code dispatches a hook for.
VALID_HOOK_EVENTS = {
    "PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification",
    "Stop", "SubagentStop", "SessionStart", "SessionEnd", "PreCompact",
}

ROOT = Path(__file__).resolve().parent.parent

# The skills this repository authors and mirrors into .agents/skills/.
PROJECT_SKILLS = [
    "alembic-guard", "frontend-module", "intent-planner",
    "security-audit", "testing", "review", "verify",
]

# ECC (github.com/affaan-m/ECC) is vendored deliberately narrowly: three skill
# directories installed project-local with
#   npx ecc-universal@<version> install --target claude-project --skills ...
# and no ECC rules, agents, commands, hooks or memory. docs/ECC.md records why each
# one is here and what was rejected.
#
# The boundary lives in this validator rather than in prose because the failure mode
# is silent drift. A later `--profile` install, or one hand-copied SKILL.md, adds
# always-loaded description lines and a second source of truth for testing, security
# or review - and nothing else in the repo would notice.
VENDORED_ECC_SKILLS = ["accessibility", "context-budget", "fastapi-patterns"]

def check_entrypoint(errors):
    claude_md = ROOT / ".claude" / "CLAUDE.md"
    if not claude_md.exists():
        errors.append(".claude/CLAUDE.md does not exist.")
        return

    content = claude_md.read_text(encoding="utf-8")
    if "@../AGENTS.md" not in content:
        errors.append(".claude/CLAUDE.md does not contain required import '@../AGENTS.md'.")

    # Resolve import relative to .claude/CLAUDE.md
    target = (claude_md.parent / "../AGENTS.md").resolve()
    if not target.exists():
        errors.append(f".claude/CLAUDE.md import target {target} does not exist.")

    # Ensure CLAUDE.md is not a bulk copy of AGENTS.md
    agents_md = ROOT / "AGENTS.md"
    if agents_md.exists():
        agents_len = len(agents_md.read_text(encoding="utf-8"))
        if len(content) > agents_len * 0.5:
            errors.append(".claude/CLAUDE.md appears to be a bulk copy of AGENTS.md rather than a minimal entrypoint.")


def parse_frontmatter(file_path):
    text = file_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}, text

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text

    fm_text = parts[1]
    body = parts[2]

    # Simple YAML subset parser for frontmatter
    fm = {}
    current_key = None
    for line in fm_text.splitlines():
        line_str = line.strip()
        if not line_str or line_str.startswith("#"):
            continue
        if line_str.startswith("- ") and current_key:
            if not isinstance(fm[current_key], list):
                fm[current_key] = []
            fm[current_key].append(line_str[2:].strip())
        elif ":" in line:
            key, val = line.split(":", 1)
            key = key.strip()
            val = val.strip()
            current_key = key
            if val:
                fm[key] = val
            else:
                fm[key] = []
    return fm, body


def check_skills(errors):
    skills_dir = ROOT / ".claude" / "skills"
    if not skills_dir.is_dir():
        errors.append(".claude/skills directory missing.")
        return

    for name in PROJECT_SKILLS:
        skill_file = skills_dir / name / "SKILL.md"
        if not skill_file.exists():
            errors.append(f"Expected skill missing: {skill_file}")
            continue

        fm, body = parse_frontmatter(skill_file)
        if fm.get("name") != name:
            errors.append(f"Skill {skill_file} name in frontmatter '{fm.get('name')}' does not match directory name '{name}'.")

        # `paths` is a valid skill key, but it makes the skill load only when
        # Claude reaches a matching file through the Read tool. This repo's work
        # routes through Bash - that is the whole reason the hooks in
        # .claude/hooks/ exist (see _bash_targets.py) - so a path-gated skill
        # here never activates and never appears in the skill list. alembic-guard
        # and frontend-module were both invisible this way while this validator
        # reported green. Path-scoped prose belongs in .claude/rules/, which is
        # loaded by a different mechanism and is checked by check_rules below.
        if "paths" in fm:
            errors.append(
                f"Skill {skill_file} declares 'paths'. Skills here must stay "
                "unconditional: path-gated skills only load on a Read-tool touch, "
                "which this repo's Bash-first workflow does not produce. Move "
                "path-scoped guidance to .claude/rules/ instead."
            )


def check_agents(errors):
    agents_dir = ROOT / ".claude" / "agents"
    if not agents_dir.is_dir():
        errors.append(".claude/agents directory missing.")
        return

    expected_agents = ["verifier", "security-reviewer", "frontend-reviewer", "backend-reviewer"]
    for name in expected_agents:
        agent_file = agents_dir / f"{name}.md"
        if not agent_file.exists():
            errors.append(f"Expected agent missing: {agent_file}")
            continue

        fm, body = parse_frontmatter(agent_file)
        if fm.get("name") != name:
            errors.append(f"Agent {agent_file} name in frontmatter '{fm.get('name')}' does not match expected '{name}'.")

        disallowed = fm.get("disallowedTools", [])
        if isinstance(disallowed, str):
            disallowed = [disallowed]

        if "reviewer" in name or name == "verifier":
            tools = fm.get("tools", [])
            if isinstance(tools, str):
                tools = [tools]
            if "Write" in tools or "Edit" in tools:
                errors.append(f"Reviewer/verifier agent {name} must not allow Write or Edit tools.")
            if "Write" not in disallowed or "Edit" not in disallowed:
                errors.append(f"Reviewer/verifier agent {name} must declare Write and Edit in disallowedTools.")

        if name == "verifier" and "isolation" in fm:
            errors.append("Verifier agent must not specify an 'isolation' key (must inspect primary working tree).")

        skills = fm.get("skills", [])
        if isinstance(skills, str):
            skills = [skills]
        for s in skills:
            if not (ROOT / ".claude" / "skills" / s / "SKILL.md").exists():
                errors.append(f"Agent {name} references non-existent skill '{s}'.")


def check_settings(errors):
    settings_file = ROOT / ".claude" / "settings.json"
    if not settings_file.exists():
        errors.append(".claude/settings.json missing.")
        return

    try:
        data = json.loads(settings_file.read_text(encoding="utf-8"))
    except Exception as e:
        errors.append(f".claude/settings.json is invalid JSON: {e}")
        return

    # .env.example is tracked and is the documented variable reference, so no
    # deny rule may cover it. The old test looked for the literal string
    # ".env.example" in the rule, which a glob like "Read(./.env*)" never
    # contains - so the one rule that actually blocked the file passed this
    # check for as long as it existed. Resolve the glob instead.
    example = ROOT / ".env.example"
    perms = data.get("permissions", {}).get("deny", [])
    for deny_rule in perms:
        m = re.match(r"^\w+\((.*)\)$", deny_rule.strip())
        if not m:
            continue
        pattern = m.group(1).lstrip("./")
        if example.exists() and fnmatch.fnmatch(".env.example", pattern):
            errors.append(
                f"permissions.deny rule '{deny_rule}' matches tracked .env.example."
            )

    hooks = data.get("hooks", {})
    for event_name, hook_list in hooks.items():
        # Restricting this to the two tool events rejected every other valid
        # Claude Code lifecycle event - SessionStart among them, which is the
        # documented way to prepare a repo for Claude Code on the web.
        if event_name not in VALID_HOOK_EVENTS:
            errors.append(
                f"Invalid hook event name: {event_name} "
                f"(expected one of {', '.join(sorted(VALID_HOOK_EVENTS))})"
            )
        for item in hook_list:
            for h in item.get("hooks", []):
                cmd = h.get("command", "")
                if ".claude/hooks/" in cmd:
                    # Clean command token to find relative script path
                    clean_cmd = cmd.replace('"$CLAUDE_PROJECT_DIR"/', "").replace("$CLAUDE_PROJECT_DIR/", "")
                    script_rel = clean_cmd.strip('"\'')
                    script_path = ROOT / script_rel
                    if not script_path.exists():
                        errors.append(f"Settings references missing hook script: {script_path}")
                    elif not os.access(script_path, os.X_OK):
                        errors.append(f"Hook script is not executable: {script_path}")


def check_mirror_drift(errors):
    claude_skills = ROOT / ".claude" / "skills"
    agents_skills = ROOT / ".agents" / "skills"

    # Derived, not hand-listed. The literal list named four of the seven
    # mirrored skills, so review/, testing/ and verify/ could drift apart
    # silently - the exact failure this check exists to prevent.
    mirrored_skills = sorted(
        d.name for d in agents_skills.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ) if agents_skills.is_dir() else []
    if not mirrored_skills:
        errors.append(f"No mirrored skills found under {agents_skills}.")
    for name in mirrored_skills:
        c_file = claude_skills / name / "SKILL.md"
        a_file = agents_skills / name / "SKILL.md"

        if not c_file.exists():
            errors.append(f".claude skill missing for mirror check: {c_file}")
            continue
        if not a_file.exists():
            errors.append(f".agents skill missing for mirror check: {a_file}")
            continue

        if c_file.read_bytes() != a_file.read_bytes():
            errors.append(f"Mirror drift detected: {c_file} and {a_file} are not byte-identical.")


def check_templates(errors):
    templates_dir = ROOT / ".claude" / "templates"
    for t_name in ["intent.md", "spec.md"]:
        t_file = templates_dir / t_name
        if not t_file.exists():
            errors.append(f"Template missing: {t_file}")
            continue

        text = t_file.read_text(encoding="utf-8")
        if "$env:" in text:
            errors.append(f"Template {t_file} contains PowerShell '$env:' syntax.")
        if "--fix" in text and "check_docs.py --fix" in text:
            errors.append(f"Template {t_file} contains mutating '--fix' in verification block.")


def check_rules(errors):
    """.claude/rules/ holds the path-scoped tables AGENTS.md delegates to.

    They are loaded only when Claude touches a matching file, so each one has to
    declare a 'paths' frontmatter list - without it the file either never loads
    or loads on every session, and the token budget AGENTS.md 'Navigating This
    Repo' relies on is gone either way.
    """
    rules_dir = ROOT / ".claude" / "rules"
    if not rules_dir.is_dir():
        errors.append(".claude/rules directory missing.")
        return

    expected_rules = ["navigation.md", "reference-docs.md"]
    for name in expected_rules:
        rule_file = rules_dir / name
        if not rule_file.exists():
            errors.append(f"Expected rules file missing: {rule_file}")
            continue

        fm, body = parse_frontmatter(rule_file)
        paths = fm.get("paths", [])
        if isinstance(paths, str):
            paths = [paths]
        if not paths:
            errors.append(f"Rules file {rule_file} does not declare a non-empty 'paths' frontmatter list.")


def check_prohibited_config(errors):
    # .claude/rules is deliberately absent from this list: it is a supported
    # path-scoped config directory and is validated by check_rules above.
    prohibited = [
        ROOT / ".claudeignore",
        ROOT / ".claude" / "commands",
        ROOT / ".claude" / "adrs",
        ROOT / ".claude" / "memory",
    ]
    for path in prohibited:
        if path.exists():
            errors.append(f"Prohibited agent configuration path exists: {path}")


def check_vendored_ecc(errors):
    """ECC stays inside the three skills it was vendored for.

    .claude/skills/ is flat: ECC's claude-project adapter copies skill directories
    straight into it, alongside the project's own. Nothing in that layout records
    which side a directory belongs to, so this check does: the set of directories is
    closed, and every vendored one has to keep the `origin: ECC` frontmatter marker
    the installer wrote. Losing the marker means the file was hand-edited, which
    breaks ECC's content-digest upgrade path as surely as deleting it would.
    """
    skills_dir = ROOT / ".claude" / "skills"
    if not skills_dir.is_dir():
        return  # check_skills already reported the missing directory.

    present = {d.name for d in skills_dir.iterdir() if d.is_dir()}
    for name in sorted(present - set(PROJECT_SKILLS) - set(VENDORED_ECC_SKILLS)):
        errors.append(
            f"Unrecognised skill directory .claude/skills/{name}: it is neither a "
            "project skill nor one of the vendored ECC skills. Add it to "
            "PROJECT_SKILLS or VENDORED_ECC_SKILLS (and to docs/ECC.md) on purpose, "
            "or remove it - an unlisted skill costs always-loaded context silently."
        )

    installed = sorted(present & set(VENDORED_ECC_SKILLS))
    for name in installed:
        skill_file = skills_dir / name / "SKILL.md"
        if not skill_file.exists():
            errors.append(f"Vendored ECC skill missing its SKILL.md: {skill_file}")
            continue
        fm, _body = parse_frontmatter(skill_file)
        if fm.get("origin") != "ECC":
            errors.append(
                f"Vendored skill {skill_file} has lost its 'origin: ECC' marker. "
                "ECC-owned files are replaced by the installer, never hand-edited."
            )

    # The install-state is what makes the integration reversible: uninstall removes
    # only the paths recorded in it. Skills without it are an orphaned copy.
    state_file = ROOT / ".claude" / "ecc" / "install-state.json"
    if installed:
        if not state_file.exists():
            errors.append(
                f"Vendored ECC skills are present but {state_file} is missing; "
                "the install is no longer uninstallable."
            )
        else:
            try:
                json.loads(state_file.read_text(encoding="utf-8"))
            except Exception as e:
                errors.append(f"{state_file} is invalid JSON: {e}")
    elif state_file.exists():
        errors.append(
            f"{state_file} exists but no vendored ECC skill does. Run "
            "`npx ecc-universal@<version> uninstall --target claude-project`."
        )

    # Hooks stay project-owned. ECC ships 24 of them and this repo runs none: two of
    # its events are not even in VALID_HOOK_EVENTS, and its GateGuard hook blocks the
    # first edit to every file. check_settings validates the events; this validates
    # the authorship, so a third-party hook cannot arrive under a valid event name.
    settings_file = ROOT / ".claude" / "settings.json"
    if settings_file.exists():
        try:
            data = json.loads(settings_file.read_text(encoding="utf-8"))
        except Exception:
            return  # check_settings already reported the parse failure.
        for event_name, hook_list in data.get("hooks", {}).items():
            for item in hook_list:
                for h in item.get("hooks", []):
                    cmd = h.get("command", "")
                    if ".claude/hooks/" not in cmd:
                        errors.append(
                            f"Hook under {event_name} does not run a script from "
                            f".claude/hooks/: {cmd[:60]!r}. Hooks in this repo are "
                            "project-owned; ECC hooks are deliberately not installed."
                        )


def main():
    errors = []
    check_entrypoint(errors)
    check_skills(errors)
    check_agents(errors)
    check_settings(errors)
    check_mirror_drift(errors)
    check_templates(errors)
    check_rules(errors)
    check_prohibited_config(errors)
    check_vendored_ecc(errors)

    if errors:
        print("Agent configuration check failed with errors:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    print("Agent configuration check passed: all invariants satisfied.")


if __name__ == "__main__":
    main()
