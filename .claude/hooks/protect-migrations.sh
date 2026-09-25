#!/usr/bin/env bash
set -euo pipefail

# Only exit 2 blocks a PreToolUse call. Any other failure - jq missing (127),
# input jq cannot parse (5), a `set -u` slip (1) - let the edit through
# unchecked, so every failure path is turned into a refusal here. An EXIT trap
# rather than ERR, because ERR does not fire on a `set -u` expansion error.
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then echo "Error: ${0##*/} failed (exit $rc); refusing the edit rather than passing it unchecked." >&2; exit 2; fi' EXIT
command -v jq >/dev/null 2>&1 || { echo "Error: ${0##*/} needs jq to read the edit; install jq, or every edit is refused." >&2; exit 2; }

FILE_PATH=$(jq -r '.tool_input.file_path // .tool_response.filePath // .tool_input.path // empty')

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Only check alembic version files
case "$REL_PATH" in
    server/alembic/versions/*.py)
        cd "$PROJECT_DIR"
        if git ls-files --error-unmatch "$REL_PATH" >/dev/null 2>&1; then
            echo "Error: Migration $REL_PATH is already tracked by git and immutable." >&2
            echo "Refer to .claude/skills/alembic-guard/SKILL.md §1 for migration rules." >&2
            exit 2
        fi
        ;;
esac

exit 0
