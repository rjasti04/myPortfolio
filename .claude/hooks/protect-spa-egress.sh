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

# Deny by default. The guarded set used to be a hand-listed set of page names,
# which meant every page added after it was written - diff.html and json.html
# among them - fell through to the catch-all and shipped unguarded. Guard every
# front-end source file and carve out the exemptions explicitly instead, so a
# new page is covered the moment it exists.
#
# Note `*` in a case pattern also matches `/`, so frontend/*.js covers
# frontend/js/diff/diff.js. Kept identical to SPA_GUARDED/SPA_EXEMPT in
# protect-bash-writes.py.
case "$REL_PATH" in
    # ucl.html and worldcup.html are the deliberate ADR-016 exception: standalone
    # single-file predictors outside the SPA's CSP (see AGENTS.md).
    frontend/ucl.html|frontend/worldcup.html|frontend/tests/*)
        exit 0
        ;;
    frontend/*.html|frontend/*.js|frontend/*.css)
        ;;
    *)
        exit 0
        ;;
esac

# Content to inspect.
# Write carries the whole file in .content; Edit carries only the replacement in
# .new_string and NotebookEdit in .new_source. Reading .content alone let every
# Edit through unchecked, so collect every field that can carry new text.
CONTENT=$(echo "$INPUT_JSON" | jq -r '
    [ .tool_input.content,
      .tool_input.new_string,
      .tool_input.new_source,
      .tool_input.new_content,
      .tool_input.text ]
    | map(select(type == "string"))
    | join("\n")')

if [ -z "$CONTENT" ]; then
    exit 0
fi

# Single source of truth for the allowlist, shared with protect-bash-writes.py.
POLICY="$(dirname "$0")/spa-egress.json"
if [ ! -f "$POLICY" ]; then
    echo "Error: egress allowlist $POLICY is missing; refusing to pass the edit unchecked." >&2
    exit 2
fi
ALLOWED=$(jq -r '.allowed_origins[]' "$POLICY" | tr '\n' ' ')

URLS=$(echo "$CONTENT" | grep -oE 'https?://[a-zA-Z0-9.-]+(:[0-9]+)?' | sort -u || true)

for url in $URLS; do
    domain=$(echo "$url" | sed -E 's|^https?://||' | cut -d/ -f1 | cut -d: -f1)
    case " $ALLOWED " in
        *" $domain "*)
            ;;
        *)
            echo "Error: Unapproved external asset/origin detected in $REL_PATH: $url" >&2
            echo "Egress protection blocked this modification per ADR-016." >&2
            echo "If this origin is legitimate, add it to .claude/hooks/spa-egress.json." >&2
            exit 2
            ;;
    esac
done

exit 0
