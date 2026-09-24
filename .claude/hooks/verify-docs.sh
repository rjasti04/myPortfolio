#!/usr/bin/env bash
set -euo pipefail

FILE_PATH=$(jq -r '.tool_input.file_path // .tool_response.filePath // .tool_input.path // empty')

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Every file scripts/check_docs.py reads, kept identical to DOCS_COVERED in
# verify-bash-edits.py. tests/tooling/test_edit_hooks.py derives that set from
# check_docs.py's own tables and fails when a file is missing here: README.md
# was, and its drift surfaced only in CI.
case "$REL_PATH" in
    docs/*.md|AGENTS.md|README.md|package-lock.json|.claude/rules/*.md|frontend/styles.css|frontend/index.html|frontend/js/*.js|frontend/js/**/*.js|frontend/tests/*.test.js|scripts/tests/*.test.js)
        cd "$PROJECT_DIR"
        python3 scripts/check_docs.py >&2 || exit 2
        ;;
esac

exit 0
