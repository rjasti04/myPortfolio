#!/usr/bin/env bash
set -euo pipefail

# Only exit 2 blocks a PreToolUse call. Any other failure - jq missing (127),
# input jq cannot parse (5), a `set -u` slip (1) - let the edit through
# unchecked, so every failure path is turned into a refusal here. An EXIT trap
# rather than ERR, because ERR does not fire on a `set -u` expansion error.
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then echo "Error: ${0##*/} failed (exit $rc); refusing the edit rather than passing it unchecked." >&2; exit 2; fi' EXIT
command -v jq >/dev/null 2>&1 || { echo "Error: ${0##*/} needs jq to read the edit; install jq, or every edit is refused." >&2; exit 2; }

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

# An origin reference: any scheme followed by //host, or a scheme-less //host
# that begins a token. `https?://` alone let `<script src="//cdn…">`,
# `import x from '//cdn…'` and `new WebSocket('wss://…')` through. The host must
# look like a host, so `// a comment` and `a//b` are not origins. POSIX ERE only
# (no -P, no \w, no lookaround), so BSD grep reads it the same way. Kept
# identical to ORIGIN_REF in protect-bash-writes.py: tests/tooling/
# test_edit_hooks.py runs one case table through both guards.
REF='(^|[^A-Za-z0-9_/:.])//(([A-Za-z0-9-]+\.)+[A-Za-z]{2,}|([0-9]{1,3}\.){3}[0-9]{1,3})|[A-Za-z][A-Za-z0-9+.-]*://[A-Za-z0-9.-]+'

# printf, not echo: content starting with -n or -e is text, not an option. The
# sed drops the character a scheme-less match carries in front of its //.
REFS=$(printf '%s\n' "$CONTENT" | grep -oE "$REF" | sed -E 's#^[^A-Za-z]*//#//#' | sort -u || true)

for ref in $REFS; do
    domain=${ref#*//}
    case " $ALLOWED " in
        *" $domain "*)
            ;;
        *)
            echo "Error: Unapproved external asset/origin detected in $REL_PATH: $ref" >&2
            echo "Egress protection blocked this modification per ADR-016." >&2
            echo "If this origin is legitimate, add it to .claude/hooks/spa-egress.json." >&2
            exit 2
            ;;
    esac
done

exit 0
