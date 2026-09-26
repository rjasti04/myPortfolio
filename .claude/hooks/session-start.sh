#!/usr/bin/env bash
# SessionStart hook: make the two test suites runnable from the first turn.
#
# Every Claude Code on the web session is a fresh clone with no node_modules and
# no installed backend packages. AGENTS.md 6 used to carry this as a rule an
# agent had to remember ("Install the dependencies before you judge a failure"),
# because both suites fail with missing-module errors that read like broken code.
# This turns that rule into a precondition.
#
# Never fails the session: a dependency install that cannot complete is reported
# on stderr and the session starts anyway, because a working tree the agent can
# still read is more useful than a refused launch.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" || exit 0

# Local shells already have their own environments, and re-running an install
# over a distro-managed package is how AGENTS.md's hash-pinning note (ADR-021)
# gets tripped. Remote sessions are the ones that start empty.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

note() { printf '%s\n' "$*" >&2; }

# Frontend. `npm ci` is what AGENTS.md 6 and .github/workflows/deploy.yml both
# run, so a green local suite means a green pipeline. It is skipped entirely
# when node_modules is already present, which is what makes the container's
# post-hook cache worth having.
if [ -d node_modules ]; then
    note "session-start: node_modules present, skipping npm ci."
elif [ -f package-lock.json ]; then
    note "session-start: installing npm dependencies..."
    npm ci --no-audit --no-fund >&2 || note "session-start: npm ci failed; run it by hand before judging a frontend failure."
fi

# Backend. The venv is what avoids installing hash-pinned requirements over a
# distro-managed package (ADR-021), and server/.venv/bin is one of the paths
# AGENTS.md 6 tells an agent to look in.
if [ -x server/.venv/bin/python ]; then
    note "session-start: server/.venv present, skipping pip install."
elif [ -f server/requirements.txt ]; then
    note "session-start: creating server/.venv and installing backend dependencies..."
    if python3 -m venv server/.venv >&2; then
        server/.venv/bin/pip install --quiet --disable-pip-version-check \
            -r server/requirements.txt -r server/requirements-dev.txt >&2 \
            || note "session-start: backend install failed; run it by hand before judging a backend failure."
    else
        note "session-start: could not create server/.venv; python3-venv may be missing."
    fi
fi

# PYTHONPATH must include the repo root for `pytest` to import `server` at all
# (AGENTS.md 6). Exporting it here removes the per-command prefix.
#
# server/.venv/bin goes first on PATH because a bare `pytest` otherwise resolves
# to a user-site copy in ~/.local/bin that lacks the backend packages, and fails
# with exactly the missing-module error AGENTS.md 6 says to treat as real.
#
# npm's node-options puts `npm test` on the dot reporter: dots, plus full detail
# for any failure, instead of a TAP line per test with the summary buried at the
# end of a very long tool result. It reaches npm scripts only, so an explicit
# `node --test --test-reporter=...` still works (NODE_OPTIONS would make that
# throw); it also replaces NODE_OPTIONS for those scripts, hence carrying the
# existing value along. CI and a human's terminal never source this file.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf 'export PYTHONPATH="%s${PYTHONPATH:+:$PYTHONPATH}"\n' "$PROJECT_DIR" >> "$CLAUDE_ENV_FILE"
    printf 'export PATH="%s/server/.venv/bin:$PATH"\n' "$PROJECT_DIR" >> "$CLAUDE_ENV_FILE"
    printf 'export npm_config_node_options="--test-reporter=dot${NODE_OPTIONS:+ $NODE_OPTIONS}"\n' >> "$CLAUDE_ENV_FILE"
fi

exit 0
