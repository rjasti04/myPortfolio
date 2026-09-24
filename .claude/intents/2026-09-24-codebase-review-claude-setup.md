# Intent: Whole-Codebase Review §5 — Claude Setup Remediation

**Source report**: `docs/review/codebase_review_20260924.md`, §5 "Claude setup",
findings **CS1–CS7** (1 × P2, 6 × P3). The report's line numbers refer to
`f33d629`. HEAD at the time of writing is `9aefeec`, which carries §1–§4. Of the
files §5 cites, those commits changed only count figures in the two
`.claude/rules/` files and `.gitignore`, so every line number the report gives
for a hook, an agent, a skill or `check_docs.py` still holds.
**Companion spec**: `.claude/specs/2026-09-24-codebase-review-claude-setup.md`
**Status**: implemented, in the four phases the spec sets out (A–D), one
commit per phase. All seven findings are resolved, and so are the three found
while re-verifying. CS6 is resolved as a recorded upstream defect. Where
implementation departed from the plan, the spec's **Revised during
implementation** table says so.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter: indirectly at most. Nothing here ships to a
        visitor. The egress guard (CS4, CS8) keeps an agent from writing a
        third-party asset reference into the SPA. The CSP would block that
        reference at runtime, so what a visitor would see is a broken feature,
        not a leak.
  - [x] 2. Portfolio as a Work Sample: the Claude Code setup is part of the
        sample. It has guards, a validator and tests, and it makes claims.
        Four of those claims don't hold: the reviewers are "read-only" (CS1),
        the guards block (CS3, CS8, CS9), the review policy enforces ADR-023
        (CS2), and web sessions have no `server/.venv` (CS10). A reviewer of
        the setup finds a stated guarantee that doesn't hold before anything
        else.
  - [x] 3. Owner: he runs the four subagents to audit changes. In auto mode, a
        reviewer that can `sed -i` or `git commit` edits the thing it is
        meant to audit. The guards are what keep his migrations immutable
        (ADR-014), his CSP hashes pinned, and his intent/spec templates intact
        while an agent works through the shell.

- **Problem Statement**:
  Every finding was re-checked against the working tree before this was
  written, and **all seven still reproduce**. The report's fix doesn't work as
  written for five of them, and the spec corrects each:

  1. **CS1**: the suggested frontmatter hook would not run where it matters.
     The docs say Claude Code **skips a project subagent's frontmatter hooks**
     until the folder's workspace-trust dialog is accepted, and that a `-p`
     session never counts as trusted. So the guard would be inert in exactly
     the headless runs where nobody is watching. `settings.json` hooks do
     fire inside subagents, and their input carries `agent_type`, which is the
     agent's `name`. The guard is registered there instead. The suggested
     policy also fails. It exits 2 on `_bash_targets.parse()`'s targets or
     opaque flag, and that would:
     - refuse every `2>/dev/null`, because `/dev/null` is a target;
     - refuse the verifier's own gates, because `python3` is in `OPAQUE`;
     - still miss `git commit` (the report's own example), `touch`, `mkdir`,
       `find -delete`, `xargs rm`, `check_docs.py --fix`, `npm run format`
       and `ruff --fix`.

     The spec uses an **allow-list**: known readers, the gate commands the
     `testing` and `verify` skills prescribe (minus their mutating modes),
     and read-only `git`. Everything else is refused.
  2. **CS2**: the pinning test the report asks for already exists. §2 Phase A
     added `test_a_supplied_model_id_is_ignored` (and its `/summarize` twin)
     beside the older `system_prompt` pin. What no test covers is the rest of
     ADR-023: a token ceiling, an inference setting, or any new field would
     pass them all. The new pin asserts the request's exact shape.
     Separately, the `security-audit` skill still says `/chat/summarize`
     skips the free-message cap. §1's C17 fixed that at `chat_routes.py:226`.
  3. **CS3**: the suggested `trap … ERR` doesn't fire on a `set -u` expansion
     error. Measured: that path still exits 1 and lets the edit through. An
     `EXIT` trap covers every path.
  4. **CS4**: matching only in `src=`/`href=`/`url(` contexts still misses
     `import x from '//cdn…/x.js'` and `fetch('//…')`. `wss://` also passes
     both guards today. One rule replaces it: any scheme, or a scheme-less
     `//host` that begins a token. Across the 104 files the guard covers, it
     flags **exactly** the hosts today's rule flags, so it adds no false
     positive.
  5. **CS6**: there is nothing to upgrade to. npm's `latest` is still 2.2.1,
     and ECC's `main` carries the same garbled frontmatter (both checked
     2026-09-24). "Record a local override so `check_agent_config.py` expects
     the new digest" fails on two counts. That script checks no digest. And a
     hand edit is exactly what `docs/ECC.md` forbids, because ECC's installer
     compares digests. The repo already records one upstream defect in this
     same file under "Known rough edge", and this one is recorded the same
     way.

  CS5 is widened: `package-lock.json` has the same gap as `README.md`. A test
  derives every file `check_docs.py` reads, so the next table row cannot
  reopen the gap. CS7 goes as proposed.

  **Three gaps the report missed**, found while re-verifying. Each is the same
  kind of defect, in the same files, and each would defeat a §5 fix if left
  open:

  - **CS8 (P2) — a newline hides the rest of a command from every Bash-path
    guard.** `_bash_targets.tokenize()` lexes `\n` as whitespace, so a second
    line merges into the first line's segment. `cd <repo>`, a newline, then
    `sed -i … <tracked migration>`: the guard exits 0. On one line it exits 2.
    The same holds for the ADR-016 egress check and the template guard, and
    `verify-bash-edits.py` finds no target, so the CSP and docs gates never
    run. A line continuation fails the other way round. Its escaped newline
    *does* split the command, so `sed -i \`, a newline, then `'s/a/b/'
    <migration>` loses its operands and passes too. Agents write multi-line
    commands all the time.
  - **CS9 (P3) — shells, `eval`, substitution, `find -delete` and `xargs`
    hide a write.** `bash -c`, `sh -c`, `eval`, `x=$(rm …)`, `echo $(sed -i
    …)`, backticks, `find <migration> -delete` and `… | xargs rm` each rewrite
    or delete a tracked migration with the guard exiting 0.
  - **CS10 (P3) — "a web session has no `server/.venv`" is stale.**
    `navigation.md:36-39`, a comment in `protect-bash-writes.py` and one in
    its test say so. `session-start.sh` (added 2026-09-22 in `f1bf3b6`)
    creates the venv in every web session, and this session's first
    repo-wide `find` was refused for exactly that reason. The rule is right,
    but the prose tells web agents it doesn't apply to them.

  The ten findings fall into four groups, and each group is one phase:

  | Phase | Group | Findings |
  | :--- | :--- | :--- |
  | A | The Bash-path guards see the whole command and fail closed | CS8, CS9, CS3, CS4 |
  | B | Read-only subagents are read-only | CS1 |
  | C | Drift the hooks should surface | CS5, CS10 |
  | D | Review policy and repo hygiene | CS2, CS6, CS7 |

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001, ADR-016, ADR-023: no application code changes. One backend test
    is added (CS2), and it pins ADR-023. The egress guard gets stricter. The
    origin allowlist in `.claude/hooks/spa-egress.json` does not change.
  - ADR-014: migrations stay immutable. CS8 and CS9 restore that on the Bash
    path.
  - `docs/ECC.md`: a vendored `SKILL.md` is never hand-edited (CS6).
  - Hook semantics per the hooks reference: only exit 2 blocks a `PreToolUse`
    call. Any other exit, and a timeout, let it through.
  - The new hook lives in `.claude/hooks/`, so `check_vendored_ecc`'s
    authorship rule holds. It sets no `if` filter, so `check_settings`'
    Write/Edit rule (claude-setup.md #5) is not touched.
  - **Every change narrows what an agent can do.** No permission is added, no
    tool is granted, and no auto-approval widens.

- **Standing decisions deliberately kept**:
  - `test_guard_ignores_malformed_payload` pins that the Bash guard passes a
    payload it cannot parse. That stays, and the read-only guard behaves the
    same way when it cannot tell who is calling, so a harness change never
    blocks the main session. Once a read-only agent has been identified, an
    unexpected error refuses.
  - The `testing` skill's full gate still runs `check_docs.py --fix`. That is
    the main session's gate. The read-only guard refuses `--fix` for
    subagents, which is what the `verify` skill already says.

- **Explicit Non-Goals**:
  - claude-setup.md #11 (`allowed-tools` on `testing`/`verify`) stays blocked
    on the owner's approval, as that review recorded.
  - No change to `spa-egress.json`. The allowlist holds `w3.org`, but the
    namespace URIs actually in use are `www.w3.org` (`styles.css:5663`,
    `vendor/purify.min.js`), so an edit that rewrites an inline SVG data URI
    is refused today by both the old rule and the new one. Relaxing an egress
    allowlist is the owner's call. The spec records it.
  - The read-only guard is not a sandbox. It stops the ways a well-meaning
    agent edits files from a shell, and it refuses what it cannot read. An
    allowed `npm test` still runs project code, and a hostile process is out
    of scope.
  - No upstream issue is filed by the agent (CS6). That is outward-facing and
    goes out under the owner's account. The spec carries a draft.
  - The PostToolUse verify hooks' own error paths are unchanged. They cannot
    block, and CI stays the gate.
  - Sections 1–4 of the report. All four are implemented.

## 3. Impacted Layer Matrix & Quality Gates

- [ ] **Frontend**: no file under `frontend/` changes, so `npm run lint` and
      `npm test` are not required.
- [x] **Backend** (every phase): `ruff check server tests` &&
      `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`.
      `tests/tooling/` is in `pytest.ini`'s `testpaths`, and CI's
      `backend-check` job runs it, so every hook test counts here. Phase D
      adds one backend test.
- [ ] **Database**: none.
- [x] **Docs / Hashes** (every phase): `python3 scripts/check_csp_hashes.py` &&
      `python3 scripts/check_docs.py --fix --show-tokens`. No phase touches an
      inline script.
- [x] **Agent config** (every phase): `python3 scripts/check_agent_config.py`,
      which is CI's `agent-config-check` job. Phase B extends it.

## 4. Risks & Mitigations

- **A guard that blocks real work gets switched off.** `test_bash_write_guard.py`
  says so in its first paragraph, and it is the main risk here. Mitigations:
  - All 54 existing guard cases keep passing.
  - New allowed cases cover the forms Phases A and B now look into:
    multi-line reads, a heredoc body that mentions `find .`, `2>/dev/null`,
    `git commit -m "$(cat <<'EOF' … EOF)"`, and a `// comment` in an SPA
    file.
  - The read-only guard is inert in the main session, because there is no
    `agent_type` there.
  - Every refusal says what to do instead.
- **The commit idiom becomes opaque (CS9).** `$(…)` marks a command opaque,
  and opaque commands fall back to "was a protected path mentioned". The
  heredoc body is stripped before mentions are collected, so a commit message
  that names a migration is not at risk. A test pins this.
- **Better segmentation, new false positives (CS8).**
  `check_venv_search` tokenizes the raw command, heredoc bodies included. Once
  newlines split segments, a body line reading `find . -name x` would trip the
  venv rule. It is switched to the stripped command, and a test pins it.
- **`agent_type` is documented, not observed here.** No subagent was spawned
  in this session. If the field were absent, the guard would be inert, which
  is no worse than today. After Phase B, one manual check settles it (spec
  §6, "Unverified going in").
- **Fail-closed side effects.** On a machine without `jq`, every Write and Edit
  is refused with "jq is required". That failure is loud, where today's is
  silent. CI runners and web sessions have `jq`.
- **Cost**: one more Python process per Bash call. It reads the payload and
  exits when there is no read-only `agent_type`. The existing guard takes
  about 45 ms. claude-setup.md #5 already decided that correctness outranks
  process count here. No API, Bedrock or database cost changes.

## 5. Assumptions

This is a non-interactive session (Claude Code on the web), so the
intent-planner interview was skipped. These answers were inferred and chosen:

1. **Scope** is CS1–CS7 plus CS8–CS10. Without the three additions, the
   report's own fixes can be walked around: CS1's guard by a newline, and the
   migration guard by `bash -c`. Nothing from §1–§4 is included.
2. **This task's deliverable** is the intent and the spec. "Before
   implementing" is read as a gate, as the §1–§4 work read it.
   Implementation follows, phase by phase, once the spec is approved.
3. **Delivery** is four phases, A–D, one commit each on this branch. A comes
   first because B's guard builds on A's tokenizer. The P2s (CS8, CS1) land
   in the first two.
4. **CS1 is registered in `settings.json` and keyed on `agent_type`**, not in
   agent frontmatter. See the problem statement, correction 1.
5. **Read-only is derived, not listed.** An agent whose `disallowedTools`
   removes both `Write` and `Edit` is read-only. That is the criterion
   `check_agents` already enforces for the four, so a fifth read-only agent is
   covered the moment it exists.
6. **CS1 redirection** is allowed only to an absolute path outside the
   repository (`/dev/null`, `/tmp/…`). A relative target is refused, because
   after a `cd` the hook cannot know where it points.
7. **`alembic upgrade`/`downgrade` stay allowed for read-only agents.** The
   `testing` skill's migration round trip needs them, and they write no
   repository file. `revision`, `merge` and `stamp` are refused.
8. **CS2's pin asserts exact field sets**, not a list of forbidden names. Any
   new field on the chat request then forces an ADR-023 decision.
9. **CS6 is recorded, not patched.** Its cost is a stray word and about 20
   always-loaded tokens. A hand edit would break the uninstall and upgrade
   path that `docs/ECC.md` exists to protect.
10. **New findings are recorded in the report** under a separate "found during
    remediation" heading, not added to its scored totals, because the report
    is a dated snapshot.
