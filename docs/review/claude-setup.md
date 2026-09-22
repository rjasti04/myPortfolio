# Claude Code Configuration Conformance Review

**Date:** 2026-09-22
**Remediated:** 2026-09-22 — see [Status](#status) for the per-finding outcome.
**Scope:** `.claude/` — four subagents, ten skills, `settings.json`, six hooks,
two rules files, `CLAUDE.md` — plus `AGENTS.md` where it describes that
configuration, and `scripts/check_agent_config.py` where it validates it.
**Method:** every finding is checked against the published documentation at
`code.claude.com/docs` and cites the page it rests on. Nothing here is asserted
from recall.
**CLI:** `claude --version` reports **2.1.278**, which matters for three findings
whose documented behaviour is version-gated (v2.1.210 for finding 1, v2.1.271
for finding 7).

> **Two of this review's own claims were wrong on first pass**, and both are
> corrected below rather than quietly dropped, because both would have produced
> a worse recommendation than the truth:
>
> - **`SessionEnd` is a documented hook event.** A first read of the lifecycle
>   table came back with 32 events and no `SessionEnd`, which made
>   `check_agent_config.py`'s allowlist look like it accepted an event that does
>   not exist. The table has 33 and `SessionEnd` is in it. The allowlist's nine
>   entries are all real; the finding shrank to what it rejects.
> - **`PostToolUse` exit 2 is the documented way to reach Claude, not a
>   mistake.** The per-event table reads "Can block? No — exit code 2 isn't
>   honored for this event", which looks like the CSP and docs gates are
>   shouting into a void. The exit-code section says the opposite and is
>   specific: "To surface a warning to Claude from a `PostToolUse` or
>   `PostToolUseFailure` hook, exit 2 instead so Claude sees the stderr even
>   though the tool already ran." Both are true — exit 2 does not *block*, and
>   it does deliver stderr. `verify-csp.sh` and `verify-docs.sh` are correct as
>   written. What survives is a wording problem in `AGENTS.md`, finding 4.
>
> **A third claim was wrong and is corrected at remediation time.** Finding 5's
> proposed fix would have introduced the bug it was meant to avoid — see
> [finding 5](#5-every-writeedit-in-the-repo-spawns-four-hook-processes-if-would-skip-them),
> now **rejected**, and finding 8, **rejected** as already-tried-and-reverted.

## Status

Every finding below was re-checked against the tree before being actioned; the
line numbers in each table are current as of remediation. Nine were fixed, two
were rejected on evidence, one is blocked on an approval this session could not
give, and one needed no change.

| # | Finding | Status |
| ---: | :--- | :--- |
| 1 | Six dead `Write(...)` deny rules | **Fixed** — deleted |
| 2 | `.env` deny list misses most variants | **Fixed** — globbed, with a `!` carve-out and a validator that can now see it |
| 3 | `includeCoAuthoredBy` deprecated | **Fixed** — deleted, and its reappearance is now a CI failure |
| 4 | `AGENTS.md` says the verify hooks "block" | **Fixed** — reworded |
| 5 | `if` would skip needless hook processes | **Rejected** — the proposed fix silently disables the gates for `Write`; the decision is now enforced |
| 6 | No `SessionStart` hook | **Fixed** — `.claude/hooks/session-start.sh` added and validated |
| 7 | `verifier` inherits the instructions it audits | **Fixed** — `omitClaudeMd: true`, plus the `skills:` it needed to stay useful |
| 8 | No skill uses `paths:` | **Rejected** — actively prohibited by `check_agent_config.py`, for a recorded reason the docs confirm |
| 9 | Hook-event allowlist closed at 9 of 33 | **Fixed** — widened to all 33 (not inverted; reasoning below) |
| 10 | Unbounded auditors | **Fixed** — `maxTurns` ceiling on all four agents; `effort` left alone |
| 11 | `allowed-tools` unused on `testing`/`verify` | **Blocked** — needs owner approval, see below |
| 12 | `navigation.md` scopes itself to a denied file | **Fixed** — entry dropped |
| 13 | Bash secret guard matches a token inside a search pattern | **Fixed** — exemption is positional and read-only-utility-only |

### Gates run at remediation

All green on the final tree:

| Gate | Result |
| :--- | :--- |
| `python3 scripts/check_agent_config.py` | passed |
| `python3 scripts/check_docs.py` | all documented figures match |
| `python3 scripts/check_csp_hashes.py` | 3/3 inline scripts allowed |
| `server/.venv/bin/ruff check server tests` | passed |
| `PYTHONPATH=. pytest --cov=server --cov-fail-under=55` | 349 passed, 66.24% |
| `npm run lint` | passed (ESLint + Stylelint) |
| `npm test` | 512 passed, 0 failed |
| `npm run build` | JS 93% / CSS 99% of budget |

## Verdict

**The configuration is substantially conformant, and more so than its age would
suggest.** Every subagent frontmatter key is real and in a documented form,
including the `skills:` preloading that three of the four use. The hook objects
use documented fields throughout, the `PreToolUse` guards use the documented
blocking mechanism, `.claude/rules/` with a `paths:` glob list is a first-class
documented feature rather than a local invention, and the `$schema` line is
explained on the settings page — it is absent from the settings *reference*
index, which is why both pages were checked before calling it conformant.

Four things are wrong against the docs. None is exploitable, and the largest is
a set of six permission rules the CLI accepts and then never consults. The more
valuable half of this review is the second: **eight documented capabilities this
setup does not use**, two of which solve problems `AGENTS.md` currently spends
prose asking a model to solve by judgment.

| Group | Count | Worst severity |
| :--- | ---: | :--- |
| Wrong per the docs | 4 | Medium |
| Works, but a documented feature does it better | 8 | Medium |
| Outside the conformance remit | 1 | Medium |
| Checked and conformant | 8 | — |
| Unverified | 2 | — |

---

## A. Wrong per the docs

### 1. Six `Write(...)` deny rules are accepted and never consulted

**Status: Fixed.** All six deleted. `.claude/settings.json:5-14` is now ten rules.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:8,11,14,17,19,22` (pre-fix) |
| **The "Why"** | File permissions are checked against `Edit(path)` and `Read(path)` rules only: "If you write a path rule for `Write`, `NotebookEdit`, `Glob`, or the legacy `MultiEdit` tool instead, Claude Code accepts the rule but never consults it, and warns at startup" ([permissions](https://code.claude.com/docs/en/permissions)). That behaviour requires v2.1.210 or later; this install is 2.1.278. The six `Write(...)` entries are dead weight that each emit a startup warning, and they make the deny list read as though `Write` were separately covered when the `Edit(...)` twin is what does the work. |
| **The Fix** | Delete all six. `Edit(./.env)` already governs every file-modifying tool. |

The same page also records why `Edit` rules are kept alongside `Read` ones
rather than folded away: "A `Read` deny rule also blocks the Edit and Write
tools on the same path… NotebookEdit isn't covered, so add an `Edit` deny rule
for paths no tool may change."

### 2. The `.env` deny list covers two variants and misses the rest

**Status: Fixed.** `.claude/settings.json:5-10`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:6-17` (pre-fix) |
| **The "Why"** | Four exact paths are enumerated — `.env`, `.env.local`, `server/.env`, `server/.env.local`. A `.env.production`, `.env.development`, `.env.prod` or `server/.env.staging` is readable today. The documentation's own example pairs the exact path with a glob for exactly this reason: `"Read(./.env)"`, `"Read(./.env.*)"` ([settings](https://code.claude.com/docs/en/settings)). Read and Edit rules use gitignore pattern syntax, and a bare filename matches at any depth — "`Read(.env)` and `Read(**/.env)` are equivalent" ([permissions](https://code.claude.com/docs/en/permissions)) — so one pair of patterns covers the repo root and `server/` together. |
| **The Fix** | Replace the twelve enumerated rules with four patterns, **plus the two negations the next paragraph turned out to require**. |

```json
"deny": [
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(!**/.env.example)",
  "Edit(**/.env)",
  "Edit(**/.env.*)",
  "Edit(!**/.env.example)"
]
```

The original text asked to "verify after the change that `.env.example`-style
files, **if any are ever added**, are carved out". One already exists: `.env.example`
is tracked, and `docs/CONFIGURATION.md` points at it as the documented variable
reference. `Read(**/.env.*)` covers it, and a `Read` deny also blocks Edit and
Write, so shipping the four-rule version alone would have made the one file an
agent is supposed to read unreadable. Hence the two `!` negations, which are
gitignore negations against "the `path` or `./path` rules listed before it"
([permissions](https://code.claude.com/docs/en/permissions)) — and which is why
they are listed *after*, since "a `!` rule listed first carves nothing out".

**`check_agent_config.py` could not see any of this.** Its `.env.example`
assertion used `fnmatch`, which reads `**/` as a literal path segment:
`fnmatch(".env.example", "**/.env.*")` is `False`, so the check would have
passed while Claude Code blocked the file — the same false negative its own
comment describes having fixed once before. `check_settings()` now resolves
rules with gitignore-ish semantics via `_pattern_covers()`
(`scripts/check_agent_config.py:195`) and evaluates `!` negations in order, per
tool. Six new cases in `tests/tooling/test_agent_config_check.py` pin it: four
glob shapes that must be rejected, the six-rule form above that must pass, and
one asserting that a negation listed first carves nothing out.

### 3. `includeCoAuthoredBy` is deprecated

**Status: Fixed.** Deleted, and its return is now a CI failure
(`scripts/check_agent_config.py:270`).

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Low |
| **Location** | `.claude/settings.json:3` (pre-fix) |
| **The "Why"** | The settings reference lists the key as "Deprecated; use `attribution` to hide or change commit and PR attribution" ([settings-reference](https://code.claude.com/docs/en/settings-reference)). `attribution` takes `commit`, `pr` and `sessionUrl` sub-keys. |
| **The Fix** | Delete the line. It is set to `true`, which is the default — attribution is added unless you turn it off — so no `attribution` block is needed to preserve today's behaviour. Add one only to *change* the trailer, and note that the docs give no explicit `includeCoAuthoredBy: true` → `attribution` mapping, so translating rather than deleting would be a guess. |

The deletion was right and the docs were re-checked to confirm no mapping is
published. What the finding missed is that the key's *presence* was
load-bearing in the other direction: `docs/ECC.md` records that ECC's
`scripts/lib/install/apply.js` writes `"includeCoAuthoredBy": false` on any
install into a Claude target **unless an explicit preference is already
present**, and the `true` was set to pre-empt that. Deleting it gives up the
pre-emption, so `check_settings()` now fails if the key reappears at all. That
is a strictly better guard than the placeholder value: a silent flip from `true`
to `false` looks like nothing in a diff, while a CI failure does not.
`docs/ECC.md` §"Why there is no attribution key" is updated to match.

### 4. `AGENTS.md` says the two verify hooks "block"; they notify

**Status: Fixed.** `AGENTS.md` §6 "Generated Counts and Hashes".

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (documentation an agent acts on) |
| **Severity** | Low |
| **Location** | `AGENTS.md`, §6 "Generated Counts and Hashes" |
| **The "Why"** | The text reads "The hooks run the *check*, not the repair: they block with the drifted figures and leave the fix to you." `verify-csp.sh` and `verify-docs.sh` are `PostToolUse` hooks, and `PostToolUse` cannot block: "Exit code 2 isn't honored for this event and the tool use continues unchanged" ([hooks](https://code.claude.com/docs/en/hooks)). The write has already landed when the hook runs. An agent reading "block" reasonably infers the bad edit did not persist, and therefore that a failing gate leaves nothing to undo. |
| **The Fix** | Say what happens: the hooks run the check *after* the write lands and surface the drifted figures to the agent, which must then repair the file. The mechanism itself needs no change — exit 2 on `PostToolUse` is the documented way to put stderr in front of Claude. |

The text now reads: "…they do not block: `PostToolUse` fires after the write has
already landed, so the drifted file is on disk and the hook's job is only to put
the drifted figures in front of you. Repairing them is yours." This finding
reproduced during its own remediation — editing `docs/ECC.md` tripped
`verify-docs.sh`, the harness surfaced it as a "blocking error", and the file
was on disk all the same.

---

## B. Works, but a documented feature does it better

### 5. Every `Write`/`Edit` in the repo spawns four hook processes; `if` would skip them

**Status: Rejected.** The fix as proposed would silently disable the CSP-hash
and migration-immutability gates for the `Write` tool. The decision is now
enforced at `scripts/check_agent_config.py:302`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:29` and `:59` (pre-fix; now `:33` and `:63`) |
| **The "Why"** | Both matchers are `"Write|Edit"`, so editing `server/services/auth_service.py` runs four bash scripts — two before, two after — each of which shells out to `jq`, tests the path against a `case` list, and exits 0. The hooks page documents an `if` field holding one permission rule, evaluated on tool events, precisely to filter this: `"if": "Edit(*.ts)"` ([hooks](https://code.claude.com/docs/en/hooks)). |
| **The Fix (proposed)** | `verify-csp.sh` becomes `"if": "Edit(frontend/index.html)"`; `protect-migrations.sh` becomes `"if": "Edit(server/alembic/versions/**)"`. |

**Why this was not done.** The `if` field matches "against the tool name and
arguments together" ([hooks](https://code.claude.com/docs/en/hooks)) and holds
exactly one rule — no lists. The permissions page's special case, where an
`Edit(path)` rule governs every file-modifying tool, is scoped to *file
permission checks*; nothing documents it extending to `if`. So on a group whose
matcher is `Write|Edit`, `"if": "Edit(frontend/index.html)"` most likely stops
the hook running when the `Write` tool writes that file.

That is precisely the asymmetry `.claude/hooks/_bash_targets.py` exists to
close — its docstring records that the `Write|Edit` guards "never see a change
made with `sed -i`, a heredoc or a shell redirection", which "left migration
immutability, the ADR-016 egress allowlist and the CSP-hash gate enforced on one
write path and unenforced on the other". Re-introducing that to save four
short-lived subshells is a bad trade at any severity, and the downside is
silent. The scripts' own `case` tests already make the no-op path cheap.

The safe version — splitting each group by tool so `if` can name the matching
one — is available if the process cost is ever measured and found to matter. In
the meantime `check_settings()` rejects an `if` on any group whose matcher
covers both `Write` and `Edit`, with two tests pinning both directions, so the
optimisation cannot be re-applied in its unsafe form by someone reading only
this report's original text.

### 6. No `SessionStart` hook, though `AGENTS.md` spends a paragraph on the problem one solves

**Status: Fixed.** `.claude/hooks/session-start.sh`, wired at
`.claude/settings.json:18-29`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/settings.json` (absent); `AGENTS.md` §6 "Install the dependencies before you judge a failure" |
| **The "Why"** | `AGENTS.md` warns that "A fresh clone has no `node_modules` and no installed backend packages, and both suites fail loudly and misleadingly without them — missing-module errors that read like broken code", and then asks the model to remember to install first. Every Claude Code web session is a fresh clone. The docs put this exact case on `SessionStart`: "A `type: \"command\"` hook on `SessionStart` runs at launch, so use one for anything the session needs from its first turn" ([hooks](https://code.claude.com/docs/en/hooks)). `check_agent_config.py` already lists `SessionStart` in `VALID_HOOK_EVENTS`, so the gate permits it, and a `session-start-hook` skill exists for authoring one. |
| **The Fix** | A `SessionStart` command hook running `npm ci --no-audit --no-fund` and the venv install, guarded so it is a no-op when both are already present. |

The session this was written in started with neither `node_modules` nor
`server/.venv`, so the premise held exactly. The hook:

- runs only when `CLAUDE_CODE_REMOTE=true`, since local shells have their own
  environments and re-installing hash-pinned requirements over a distro-managed
  package is the ADR-021 failure `AGENTS.md` warns about;
- skips each install when its target is already present, so the container's
  post-hook cache is worth having;
- uses `npm ci`, matching `AGENTS.md` §6 and `.github/workflows/deploy.yml`, so
  a green local run still means a green pipeline;
- exports `PYTHONPATH` through `$CLAUDE_ENV_FILE`;
- never fails the session — a failed install is reported on stderr and the
  session starts anyway.

Validated: first run installed 231 npm packages and built the venv (exit 0);
`import fastapi, sqlalchemy, asyncpg, pytest` succeeds against it; the second
run skipped both and exited 0. `AGENTS.md` §6 keeps the manual instructions for
everywhere the hook does not run, rather than retiring them outright as the
finding suggested — the hook is remote-only, so the rule is still live locally.

Note the knock-on: creating `server/.venv` activates `check_venv_search` in
`protect-bash-writes.py`, so repo-wide `grep`/`find` now need
`--exclude-dir=.venv`. That is the documented behaviour in
`.claude/rules/navigation.md`, not a regression.

### 7. The `verifier` agent is documented as running in a clean context, and inherits every project instruction

**Status: Fixed.** `.claude/agents/verifier.md:11`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/agents/verifier.md:1-14` (pre-fix) |
| **The "Why"** | Its own description is "Independent verification subagent that runs in a clean context to validate implementation correctness, test suites, and documentation counts." It does not run in a clean context: it loads `.claude/CLAUDE.md`, which imports `AGENTS.md` (~4,500 tokens), plus any path-scoped rule the files it reads trigger. Those are the same instructions whose claims it exists to check independently — an agent told that the counts in `navigation.md` are authoritative is a weaker check on whether they match the repo. `omitClaudeMd` is a documented subagent frontmatter boolean ([sub-agents](https://code.claude.com/docs/en/sub-agents)), requiring v2.1.271 or later; this install is 2.1.278. |
| **The Fix** | `omitClaudeMd: true` on `verifier` only. Leave the three reviewer agents as they are: they are judging code *against* those standing decisions, so they need them. |

One correction to the fix as written: it says the verifier "needs the commands,
which the `verify` skill supplies through `skills:`" — but `verifier.md` had no
`skills:` key at all, so `omitClaudeMd: true` alone would have removed the prose
and supplied nothing in its place. `skills: [verify, testing]` was added
alongside it. The body's `AGENTS.md §5` citation now says why the table is
reproduced inline and that the file can still be read directly.

### 8. No skill uses the documented `paths:` field

**Status: Rejected.** This was already tried in this repository, reverted, and
the reversal is enforced — `check_skills()` in `scripts/check_agent_config.py`
errors on any skill declaring `paths`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | all ten `.claude/skills/*/SKILL.md` |
| **The "Why" (as filed)** | `paths` is a documented SKILL.md field taking glob patterns that limit skill activation ([skills](https://code.claude.com/docs/en/skills)). |
| **The Fix (proposed)** | `paths:` on `alembic-guard`, `frontend-module` and `fastapi-patterns`. |

The validator's own comment records the outcome: "a path-gated skill here never
activates and never appears in the skill list. `alembic-guard` and
`frontend-module` were both invisible this way while this validator reported
green." The docs confirm the mechanism — `paths` means "Claude loads the skill
automatically only when working with files matching the patterns", i.e. on a
Read-tool touch. This repo's work routes through Bash, which is the entire
reason `.claude/hooks/_bash_targets.py` exists, so the trigger never fires.

The finding was filed against the docs alone without checking whether the repo
had already answered it. Path-scoped prose belongs in `.claude/rules/`, which
loads by a different mechanism. No change.

### 9. `check_agent_config.py`'s hook-event allowlist is closed at nine of thirty-three

**Status: Fixed.** Widened to all 33 (`scripts/check_agent_config.py:31`).

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Low |
| **Location** | `scripts/check_agent_config.py:18-21` (pre-fix) |
| **The "Why"** | `VALID_HOOK_EVENTS` holds nine names. All nine are real — including `SessionEnd`, which a first pass of this review wrongly flagged. But the lifecycle table documents thirty-three, so the gate fails CI on a legitimate `Setup`, `PostToolUseFailure`, `FileChanged`, `InstructionsLoaded` or `PostCompact` hook. |
| **The Fix** | Either widen the set to the documented thirty-three, or invert it: keep a short deny list of events this project has decided against and accept the rest. The second ages better — the table has grown and will grow again. |

**Widened rather than inverted**, against the finding's preference. The check is
a typo catcher, not a policy: a hook under a misspelt event name is simply never
dispatched, and nothing else in the repo would notice. An inverted deny list
accepts every typo by construction, which is the silent-drift failure mode this
repo's config consistently chooses against. A stale allowlist fails loudly and
costs one line to update. Both directions are pinned by tests — the five events
the finding names are accepted, and `SessionStrat` is still rejected.

This also removed a blocker `docs/ECC.md` was citing: ECC's hooks use
`PostToolUseFailure`, and its absence from the old nine was listed as one of four
independent reasons merging them fails CI. `check_vendored_ecc`'s authorship
requirement — every configured hook must run a script from `.claude/hooks/` — is
the real guard, and it holds under any event name. `docs/ECC.md` is updated to
say so.

### 10. Four unbounded auditors: `maxTurns` and `effort` are unused

**Status: Fixed** for `maxTurns`; `effort` deliberately left alone.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | `.claude/agents/*.md` |
| **The "Why"** | `maxTurns` and `effort` are documented subagent fields ([sub-agents](https://code.claude.com/docs/en/sub-agents)). A read-only reviewer turned loose on `server/` with `Bash`, `Grep` and `Glob` has no turn ceiling. |
| **The Fix** | A `maxTurns` ceiling on the three reviewers, sized from a real run rather than guessed. Treat `effort` as a separate decision: raising it on `security-reviewer` is defensible, and is a cost choice, not a conformance one. |

`maxTurns: 40` on all four agents (the verifier included, which the finding did
not mention but which is equally unbounded). No measured run was available, so
this is explicitly a runaway guard rather than a tuned value: set well above the
widest scope table in `docs/review/`, so a normal audit never reaches it, and an
agent that loops returns output marked partial instead of running unbounded.
Each file carries that reasoning and the instruction to lower it only against a
measured run. `effort` is untouched, as the finding advises.

### 11. `allowed-tools` is unused on the two skills that exist to run commands

**Status: Blocked — needs the owner's approval.** No change made.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | `.claude/skills/testing/SKILL.md`, `.claude/skills/verify/SKILL.md` |
| **The "Why"** | Both skills exist to run a fixed, known-safe command set — `PYTHONPATH=. pytest`, `npm test`, `npm run lint`, `check_docs.py`, `check_csp_hashes.py`. `allowed-tools` grants "tools Claude can use without asking permission during the turn that invokes this skill", and the grant clears on the next message ([skills](https://code.claude.com/docs/en/skills)). It accepts a space- or comma-separated string, or a YAML list. |
| **The Fix** | Add an `allowed-tools` list naming those Bash invocations on both skills. |

The change is well-formed and the docs check out, but adding `allowed-tools` is
an agent widening its own auto-approval surface, and the harness's safety
classifier declined the edit for that reason. The `testing` half went through
before `verify` was refused; it was reverted rather than shipped half-applied,
which would also have left `.agents/skills/` mirror drift and a failing
`check_mirror_drift`.

This needs a human to apply. Both skills take the same shape — the `testing`
list includes `Bash(python3 scripts/check_docs.py*)` because its full gate runs
`--fix`, while `verify` pins `Bash(python3 scripts/check_docs.py --show-tokens)`
because verification must not mutate the tree. Remember to mirror both files
into `.agents/skills/`, which `check_mirror_drift` requires to be byte-identical.

### 12. `navigation.md` scopes itself to a file whose reads are denied

**Status: Fixed.** `.claude/rules/navigation.md:2-11`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Low |
| **Location** | `.claude/rules/navigation.md:2-6`, `.claude/settings.json:20` (pre-fix) |
| **The "Why"** | The rule's `paths` list includes `package-lock.json`, and a path-scoped rule loads "when Claude reads files matching the pattern". `Read(./package-lock.json)` is in `permissions.deny`, so that read cannot happen and the entry can never trigger. The rule's advice about the file ("Never read. `package.json` lists every direct dep in 25 lines") is sound and is reached through the other three globs anyway. |
| **The Fix** | Drop `package-lock.json` from the `paths` list. The deny rule is the stronger guard and the advice survives in the table. |

Done, with the reasoning left in the frontmatter so the entry is not added back.
The table row is untouched; `check_docs.py` still recomputes its figures.

---

## C. Checked and conformant

Recorded so the next pass does not re-litigate them. Each was verified against
the page named, not assumed. All eight were re-confirmed at remediation.

| Surface | Verdict | Page |
| :--- | :--- | :--- |
| Subagent frontmatter: `name`, `description`, `model`, `tools`, `disallowedTools`, `skills` | All six are documented fields. `tools`/`disallowedTools` accept a YAML list as well as a comma-separated string; `skills:` is a documented YAML list for preloading skill content; `model: sonnet` is a valid family alias | sub-agents |
| `.claude/rules/` with `paths:` as a YAML glob list | A documented feature, matching the documented format exactly. Unquoted globs are valid YAML | memory |
| Hook config fields `type: command`, `command`, `timeout`, `statusMessage`, and the group-level `matcher` | All documented. `statusMessage` is "a custom spinner message while the hook runs" | hooks |
| `PreToolUse` guards blocking with `exit 2` | The documented blocking mechanism, alongside the JSON `permissionDecision: "deny"` form. All three guards use it correctly | hooks |
| `PostToolUse` gates surfacing drift with `exit 2` | Correct — see the header note. Exit 2 does not block, and does put stderr in front of Claude | hooks |
| `$schema` in `settings.json` | Documented and explained on the settings page, absent from the settings-reference index. Both were checked before calling it conformant | settings |
| `@../AGENTS.md` import in `.claude/CLAUDE.md` | The documented import syntax. `AGENTS.md` alongside `CLAUDE.md` is explicitly supported | memory |
| `permissions.deny` entries in `Read(./path)` form | The documented form — it is the docs' own example spelling. Still used for `package-lock.json` and `server/.venv/**`; the `.env` rules moved to the `**/` form under finding 2 | settings, permissions |

## D. Unverified

Neither is a finding. Both are places where the documentation does not settle
the question, recorded rather than guessed. Both remain unverified.

1. **`.tool_response.filePath` in all four path-reading hooks.** Each script
   falls back through `.tool_input.file_path // .tool_response.filePath //
   .tool_input.path`. The hooks page documents the input schema with a `Bash`
   example only and states that field names for file tools "are not explicitly
   documented", so whether a `Write`/`Edit` `tool_response` carries `filePath`
   is unconfirmed. It costs nothing today: `.tool_input.file_path` is the
   primary and is always present for both tools, so the fallback has probably
   never fired. Worth one `--debug` run to learn whether it is live code or
   decoration.

2. **When a path-scoped rule arrives relative to the read it governs.**
   Path-scoped rules "trigger when Claude reads files matching the pattern, not
   on every tool use". `navigation.md` exists to be known *before* someone opens
   `frontend/styles.css`, and it is scoped to `frontend/**`, `server/**` and
   `scripts/**` — broad enough that in practice almost any first read pulls it
   in, but the ordering is not guaranteed by anything documented. If a session
   is ever observed reading `styles.css` whole as its first file operation, the
   remedy is to move the five-row table's *headline* into the unconditional
   instructions and leave the detail path-scoped. Not worth pre-emptive action.

---

## E. Outside the conformance remit: the guard that blocked this review

Not a documentation-conformance finding — the docs have nothing to say about it.
It is recorded because this audit ran into it, and because the failure is
invisible until you hit it.

### 13. The Bash secret guard matches a token anywhere in the command, including inside a search pattern

**Status: Fixed.** `.claude/hooks/_bash_targets.py:66,148,266`.

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Medium |
| **Location** | `.claude/hooks/protect-bash-writes.py:172-178`, `.claude/hooks/_bash_targets.py:214` |
| **The "Why"** | `main()` resolves every path-shaped token `parse()` finds and refuses the command if any is a secret. `parse()` has no notion of which argument position a token occupies — there is no pattern-, `grep`- or search-awareness anywhere in it. So a read-only command that merely *names* a secret path inside a quoted regex is refused. This review hit it on `grep -n 'Read(\./\.env...' .claude/settings.json` — a grep of the settings file, reading no secret at all. The consequence is narrow but self-defeating: you cannot audit, document, or grep your own deny list from the shell, and the block arrives with a message about credential disclosure that does not describe what happened. |
| **The Fix** | Keep the mention-level check — it is the right conservative default when a shell command cannot be fully parsed, and loosening it to file-operand-only would be a security regression. Narrow it instead at the one place the position *is* unambiguous: for a known search command, skip the first non-flag argument, which is the pattern rather than a path. |

Reproduced live during remediation: the same grep was refused again, this time
against a cached documentation file holding no secret whatsoever.

Three deviations from the fix as written, each one deliberate:

- **`awk`, `sed` and `perl` are excluded from the exemption**, though the
  original text listed them among the "search commands". Each can write from
  inside its own program text — `awk '{print > "f"}'`, sed's `w` command — which
  is exactly why `awk` and `perl` are already in `OPAQUE`. Exempting their
  scripts would be a write-path regression. `SEARCH_ONLY` is limited to
  `grep`, `egrep`, `fgrep`, `rgrep` and `rg`, none of which can write a file.
- **The exemption is positional, not textual.** Subtracting every path-shaped
  string that appears in some pattern would let `grep .env f && cat .env`
  through, because the second mention would be cancelled by the first.
  `_split_search_patterns()` collects pattern-position and non-pattern-position
  candidates separately, and `parse()` subtracts only what appears *nowhere but*
  a pattern.
- **`-f`/`--file` names a real path and stays in the mention set.** `grep -f
  patterns.txt` opens that file. It is handled like `-e` in that it means there
  is no positional pattern to skip, but its argument is not exempted. Short-flag
  clusters containing `e` or `f` (`-ne`, `-nf`) are treated the same way, erring
  toward leaving the pattern in the mention set.

Seventeen new cases in `tests/tooling/test_bash_write_guard.py` pin both
directions: eight read-only searches that must now pass (including the
double-quoted, `-e`, `--regexp=` and directory-qualified forms), eight
path-position commands that must still be refused (`-f`, `--file=`, `-nf`, the
`grep … && cat …` pair, and the `awk`/`sed` write forms), and one asserting the
exemption never reaches a redirection or a `tee` in the same command.

| Attribute | Detail |
| :--- | :--- |
| **Workaround before the fix** | Read the file with a command that does not spell the path — `cat -n .claude/settings.json` — or use the `Grep` tool, which the guard does not police. |

---

## Not findings

- **`disallowedTools` on the four agents duplicating `check_agent_config.py`'s
  assertion.** The validator requires `Write` and `Edit` in `disallowedTools`
  for every reviewer and the verifier. That is deliberate belt-and-braces: the
  frontmatter is the enforcement and the check is what stops the frontmatter
  being quietly edited away.
- **Ten skills where most carry only `name` and `description`.** Both are the
  only fields that matter for invocation, and `description` is the one the docs
  call "Recommended". Finding 11 proposes adding fields to two of them on
  specific grounds; finding 8 is rejected, so the other eight need nothing.
- **`model: sonnet` on all four agents.** A read-only auditor on Sonnet is a
  cost choice this project is entitled to make, and `inherit` would hand audits
  to whatever the main session happens to be running.
- **No `.claude/commands/`.** `check_agent_config.py` prohibits the directory
  outright, and skills are user-invocable by default, so the slash commands
  exist without it.
