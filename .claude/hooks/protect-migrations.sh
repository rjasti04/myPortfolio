#!/usr/bin/env bash
set -euo pipefail

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
