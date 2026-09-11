#!/usr/bin/env python3
"""
scripts/check_agent_config.py

Validator for AI agent configuration across .claude/, .agents/, and related CI workflows.
Ensures entrypoints, skills, agents, settings, permissions, templates, and mirror drift comply
with repository standards.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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

    expected_skills = ["alembic-guard", "frontend-module", "intent-planner", "security-audit", "testing", "review", "verify"]
    for name in expected_skills:
        skill_file = skills_dir / name / "SKILL.md"
        if not skill_file.exists():
            errors.append(f"Expected skill missing: {skill_file}")
            continue

        fm, body = parse_frontmatter(skill_file)
        if fm.get("name") != name:
            errors.append(f"Skill {skill_file} name in frontmatter '{fm.get('name')}' does not match directory name '{name}'.")

        if "paths" in fm:
            paths = fm["paths"]
            if isinstance(paths, str):
                paths = [paths]
            for glob_pattern in paths:
                # Support recursive wildcard matching for patterns like frontend/**/*.{js,css,html}
                if "**" in glob_pattern:
                    base_part, _, ext_part = glob_pattern.partition("**")
                    search_dir = ROOT / base_part.strip("/")
                    if not search_dir.exists():
                        errors.append(f"Skill {name} glob directory '{search_dir}' does not exist.")
                        continue
                    matches = list(search_dir.rglob("*"))
                else:
                    matches = list(ROOT.glob(glob_pattern))

                if not matches:
                    errors.append(f"Skill {name} glob pattern '{glob_pattern}' matched zero files.")


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

    perms = data.get("permissions", {}).get("deny", [])
    for deny_rule in perms:
        if ".env.example" in deny_rule:
            errors.append(f"permissions.deny rule '{deny_rule}' incorrectly matches tracked .env.example.")

    hooks = data.get("hooks", {})
    for event_name, hook_list in hooks.items():
        if event_name not in ["PreToolUse", "PostToolUse"]:
            errors.append(f"Invalid hook event name: {event_name}")
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

    mirrored_skills = ["alembic-guard", "frontend-module", "intent-planner", "security-audit"]
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


def check_prohibited_config(errors):
    prohibited = [
        ROOT / ".claudeignore",
        ROOT / ".claude" / "rules",
        ROOT / ".claude" / "commands",
        ROOT / ".claude" / "adrs",
        ROOT / ".claude" / "memory",
    ]
    for path in prohibited:
        if path.exists():
            errors.append(f"Prohibited agent configuration path exists: {path}")


def main():
    errors = []
    check_entrypoint(errors)
    check_skills(errors)
    check_agents(errors)
    check_settings(errors)
    check_mirror_drift(errors)
    check_templates(errors)
    check_prohibited_config(errors)

    if errors:
        print("Agent configuration check failed with errors:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    print("Agent configuration check passed: all invariants satisfied.")


if __name__ == "__main__":
    main()
