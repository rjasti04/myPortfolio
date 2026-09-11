#!/usr/bin/env bash
set -euo pipefail

# Read file path passed from tool input or response
FILE_PATH=$(jq -r '.tool_input.file_path // .tool_response.filePath // .tool_input.path // empty')

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Resolve relative to project dir
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

if [ "$REL_PATH" = "frontend/index.html" ]; then
    cd "$PROJECT_DIR"
    python3 scripts/check_csp_hashes.py >&2 || exit 2
fi

exit 0
