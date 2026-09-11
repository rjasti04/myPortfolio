#!/usr/bin/env bash
set -euo pipefail

# Read input JSON from stdin
INPUT_JSON=$(cat)

FILE_PATH=$(echo "$INPUT_JSON" | jq -r '.tool_input.file_path // .tool_response.filePath // .tool_input.path // empty')

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Guarded vs Exempt files check
# Exempt: ucl.html, worldcup.html, frontend/tests/**
case "$REL_PATH" in
    frontend/ucl.html|frontend/worldcup.html|frontend/tests/*)
        exit 0
        ;;
    frontend/index.html|frontend/arcade.html|frontend/cron.html|frontend/crypto.html|frontend/styles.css|frontend/js/*.js|frontend/js/**/*.js|frontend/three-bg.js|frontend/sw.js)
        ;;
    *)
        exit 0
        ;;
esac

# Content to inspect
CONTENT=$(echo "$INPUT_JSON" | jq -r '.tool_input.content // .tool_input.new_content // .tool_input.text // empty')

if [ -z "$CONTENT" ]; then
    exit 0
fi

# Extract all unique external origins (http/https URLs)
# Allowlist: rjasti.com, www.rjasti.com, staging-api.rjasti.com, formsubmit.co, github.com, www.linkedin.com, w3.org, schema.org, localhost, 127.0.0.1

ALLOWED_REGEX='^(https?://)?(rjasti\.com|www\.rjasti\.com|staging-api\.rjasti\.com|formsubmit\.co|github\.com|www\.linkedin\.com|w3\.org|schema\.org|localhost|127\.0\.0\.1)(:[0-9]+)?(/.*)?$'

# Find URLs in content
URLS=$(echo "$CONTENT" | grep -oE 'https?://[a-zA-Z0-9.-]+(:[0-9]+)?' | sort -u || true)

for url in $URLS; do
    domain=$(echo "$url" | sed -E 's|^https?://||' | cut -d/ -f1 | cut -d: -f1)
    case "$domain" in
        rjasti.com|www.rjasti.com|staging-api.rjasti.com|formsubmit.co|github.com|www.linkedin.com|w3.org|schema.org|localhost|127.0.0.1)
            ;;
        *)
            echo "Error: Unapproved external asset/origin detected in $REL_PATH: $url" >&2
            echo "Egress protection blocked this modification per ADR-016." >&2
            exit 2
            ;;
    esac
done

exit 0
