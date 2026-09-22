# Claude Code Configuration Conformance Review

**Date:** 2026-09-22
**Scope:** `.claude/` — four subagents, ten skills, `settings.json`, five hooks,
two rules files, `CLAUDE.md` — plus `AGENTS.md` where it describes that
configuration, and `scripts/check_agent_config.py` where it validates it.
**Method:** every finding is checked against the published documentation at
`code.claude.com/docs` and cites the page it rests on. Nothing here is asserted
from recall.
**CLI:** `claude --version` reports **2.1.278**, which matters for two findings
whose documented behaviour is version-gated at v2.1.210.

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

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:8,11,14,17,19,22` |
| **The "Why"** | File permissions are checked against `Edit(path)` and `Read(path)` rules only: "If you write a path rule for `Write`, `NotebookEdit`, `Glob`, or the legacy `MultiEdit` tool instead, Claude Code accepts the rule but never consults it, and warns at startup" ([permissions](https://code.claude.com/docs/en/permissions)). That behaviour requires v2.1.210 or later; this install is 2.1.278. The six `Write(...)` entries are dead weight that each emit a startup warning, and they make the deny list read as though `Write` were separately covered when the `Edit(...)` twin is what does the work. |
| **The Fix** | Delete all six. `Edit(./.env)` already governs every file-modifying tool. |

```diff
   "Read(./.env)",
   "Edit(./.env)",
-  "Write(./.env)",
    ... and the same for .env.local, server/.env, server/.env.local,
        .claude/templates/** and package-lock.json
```

### 2. The `.env` deny list covers two variants and misses the rest

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:6-17` |
| **The "Why"** | Four exact paths are enumerated — `.env`, `.env.local`, `server/.env`, `server/.env.local`. A `.env.production`, `.env.development`, `.env.prod` or `server/.env.staging` is readable today. The documentation's own example pairs the exact path with a glob for exactly this reason: `"Read(./.env)"`, `"Read(./.env.*)"` ([settings](https://code.claude.com/docs/en/settings)). Read and Edit rules use gitignore pattern syntax, and a bare filename matches at any depth — "`Read(.env)` and `Read(**/.env)` are equivalent" ([permissions](https://code.claude.com/docs/en/permissions)) — so one pair of patterns covers the repo root and `server/` together. |
| **The Fix** | Replace the twelve enumerated rules with four patterns. |

```json
"deny": [
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Edit(**/.env)",
  "Edit(**/.env.*)"
]
```

Verify after the change that `.env.example`-style files, if any are ever added,
are carved out with a `!` negation rather than left matching — a deny pattern
starting with `!` is a gitignore negation against the `path` rules listed before
it in the same file.

### 3. `includeCoAuthoredBy` is deprecated

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Low |
| **Location** | `.claude/settings.json:3` |
| **The "Why"** | The settings reference lists the key as "Deprecated; use `attribution` to hide or change commit and PR attribution" ([settings-reference](https://code.claude.com/docs/en/settings-reference)). `attribution` takes `commit`, `pr` and `sessionUrl` sub-keys. |
| **The Fix** | Delete the line. It is set to `true`, which is the default — attribution is added unless you turn it off — so no `attribution` block is needed to preserve today's behaviour. Add one only to *change* the trailer, and note that the docs give no explicit `includeCoAuthoredBy: true` → `attribution` mapping, so translating rather than deleting would be a guess. |

### 4. `AGENTS.md` says the two verify hooks "block"; they notify

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (documentation an agent acts on) |
| **Severity** | Low |
| **Location** | `AGENTS.md`, §6 "Generated Counts and Hashes" |
| **The "Why"** | The text reads "The hooks run the *check*, not the repair: they block with the drifted figures and leave the fix to you." `verify-csp.sh` and `verify-docs.sh` are `PostToolUse` hooks, and `PostToolUse` cannot block: "Exit code 2 isn't honored for this event and the tool use continues unchanged" ([hooks](https://code.claude.com/docs/en/hooks)). The write has already landed when the hook runs. An agent reading "block" reasonably infers the bad edit did not persist, and therefore that a failing gate leaves nothing to undo. |
| **The Fix** | Say what happens: the hooks run the check *after* the write lands and surface the drifted figures to the agent, which must then repair the file. The mechanism itself needs no change — exit 2 on `PostToolUse` is the documented way to put stderr in front of Claude. |

---

## B. Works, but a documented feature does it better

### 5. Every `Write`/`Edit` in the repo spawns four hook processes; `if` would skip them

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Medium |
| **Location** | `.claude/settings.json:29` and `:59` (both `Write|Edit` matchers) |
| **The "Why"** | Both matchers are `"Write|Edit"`, so editing `server/services/auth_service.py` runs four bash scripts — two before, two after — each of which shells out to `jq`, tests the path against a `case` list, and exits 0. The hooks page documents an `if` field holding one permission rule, evaluated on tool events, precisely to filter this: `"if": "Edit(*.ts)"` ([hooks](https://code.claude.com/docs/en/hooks)). Only `protect-spa-egress.sh` needs to see a broad set of frontend files; the other three care about one path or a short list. |
| **The Fix** | Add an `if` to the three narrow hooks and keep each script's own `case` test as defence in depth. `verify-csp.sh` becomes `"if": "Edit(frontend/index.html)"`; `protect-migrations.sh` becomes `"if": "Edit(server/alembic/versions/**)"`. Note `if` holds exactly one rule — no lists — so `verify-docs.sh`, whose `case` spans six path shapes, keeps its bash test and gains nothing here. |

### 6. No `SessionStart` hook, though `AGENTS.md` spends a paragraph on the problem one solves

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/settings.json` (absent); `AGENTS.md` §6 "Install the dependencies before you judge a failure" |
| **The "Why"** | `AGENTS.md` warns that "A fresh clone has no `node_modules` and no installed backend packages, and both suites fail loudly and misleadingly without them — missing-module errors that read like broken code", and then asks the model to remember to install first. Every Claude Code web session is a fresh clone. The docs put this exact case on `SessionStart`: "A `type: \"command\"` hook on `SessionStart` runs at launch, so use one for anything the session needs from its first turn" ([hooks](https://code.claude.com/docs/en/hooks)). `check_agent_config.py` already lists `SessionStart` in `VALID_HOOK_EVENTS`, so the gate permits it, and a `session-start-hook` skill exists for authoring one. |
| **The Fix** | A `SessionStart` command hook running `npm ci --no-audit --no-fund` and the venv install, guarded so it is a no-op when both are already present. It converts three paragraphs of instruction into a precondition, and retires the "install before you judge a failure" rule from the always-loaded file. |

### 7. The `verifier` agent is documented as running in a clean context, and inherits every project instruction

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `.claude/agents/verifier.md:1-14` |
| **The "Why"** | Its own description is "Independent verification subagent that runs in a clean context to validate implementation correctness, test suites, and documentation counts." It does not run in a clean context: it loads `.claude/CLAUDE.md`, which imports `AGENTS.md` (~4,500 tokens), plus any path-scoped rule the files it reads trigger. Those are the same instructions whose claims it exists to check independently — an agent told that the counts in `navigation.md` are authoritative is a weaker check on whether they match the repo. `omitClaudeMd` is a documented subagent frontmatter boolean ([sub-agents](https://code.claude.com/docs/en/sub-agents)). |
| **The Fix** | `omitClaudeMd: true` on `verifier` only. It needs the commands, which the `verify` skill supplies through `skills:`, not the prose. Leave the three reviewer agents as they are: they are judging code *against* those standing decisions, so they need them. |

### 8. No skill uses the documented `paths:` field

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | all ten `.claude/skills/*/SKILL.md` |
| **The "Why"** | `paths` is a documented SKILL.md field taking glob patterns that limit skill activation ([skills](https://code.claude.com/docs/en/skills)). Today activation rests entirely on the model matching a description — which `AGENTS.md` reinforces in prose ("Use this project's Skills and Subagents when their descriptions match the task"). Three skills have unambiguous file territory. |
| **The Fix** | `paths: [server/alembic/**, server/models/**]` on `alembic-guard`; `frontend/**` on `frontend-module`; `server/**` on `fastapi-patterns`. Leave the orchestration skills (`review`, `verify`, `testing`, `intent-planner`) unscoped — they are invoked by name, not by file. |

### 9. `check_agent_config.py`'s hook-event allowlist is closed at nine of thirty-three

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Low |
| **Location** | `scripts/check_agent_config.py:18-21` |
| **The "Why"** | `VALID_HOOK_EVENTS` holds nine names. All nine are real — including `SessionEnd`, which a first pass of this review wrongly flagged. But the lifecycle table documents thirty-three, so the gate fails CI on a legitimate `Setup`, `PostToolUseFailure`, `FileChanged`, `InstructionsLoaded` or `PostCompact` hook. Finding 6 proposes a `SessionStart` hook, which passes; a `Setup` hook, which is the documented event for "one-time preparation in CI or scripts", would not. |
| **The Fix** | Either widen the set to the documented thirty-three, or invert it: keep a short deny list of events this project has decided against and accept the rest. The second ages better — the table has grown and will grow again. |

### 10. Four unbounded auditors: `maxTurns` and `effort` are unused

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | `.claude/agents/*.md` |
| **The "Why"** | `maxTurns` and `effort` are documented subagent fields ([sub-agents](https://code.claude.com/docs/en/sub-agents)). A read-only reviewer turned loose on `server/` with `Bash`, `Grep` and `Glob` has no turn ceiling, and `docs/review/bugs.md`'s own scope table shows how wide that surface is. |
| **The Fix** | A `maxTurns` ceiling on the three reviewers, sized from a real run rather than guessed. Treat `effort` as a separate decision: raising it on `security-reviewer` is defensible, and is a cost choice, not a conformance one. |

### 11. `allowed-tools` is unused on the two skills that exist to run commands

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Low |
| **Location** | `.claude/skills/testing/SKILL.md`, `.claude/skills/verify/SKILL.md` |
| **The "Why"** | Both skills exist to run a fixed, known-safe command set — `PYTHONPATH=. pytest`, `npm test`, `npm run lint`, `check_docs.py`, `check_csp_hashes.py`. `allowed-tools` grants "tools Claude can use without asking permission during the turn that invokes this skill", and the grant clears on the next message ([skills](https://code.handle.com/docs/en/skills)). |
| **The Fix** | Add an `allowed-tools` list naming those Bash invocations on both skills. It is the documented, turn-scoped version of what `fewer-permission-prompts` would otherwise write into a settings allowlist permanently. |

### 12. `navigation.md` scopes itself to a file whose reads are denied

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Low |
| **Location** | `.claude/rules/navigation.md:2-6`, `.claude/settings.json:20` |
| **The "Why"** | The rule's `paths` list includes `package-lock.json`, and a path-scoped rule loads "when Claude reads files matching the pattern". `Read(./package-lock.json)` is in `permissions.deny`, so that read cannot happen and the entry can never trigger. The rule's advice about the file ("Never read. `package.json` lists every direct dep in 25 lines") is sound and is reached through the other three globs anyway. |
| **The Fix** | Drop `package-lock.json` from the `paths` list. The deny rule is the stronger guard and the advice survives in the table. |

---

## C. Checked and conformant

Recorded so the next pass does not re-litigate them. Each was verified against
the page named, not assumed.

| Surface | Verdict | Page |
| :--- | :--- | :--- |
| Subagent frontmatter: `name`, `description`, `model`, `tools`, `disallowedTools`, `skills` | All six are documented fields. `tools`/`disallowedTools` accept a YAML list as well as a comma-separated string; `skills:` is a documented YAML list for preloading skill content; `model: sonnet` is a valid family alias | sub-agents |
| `.claude/rules/` with `paths:` as a YAML glob list | A documented feature, matching the documented format exactly. Unquoted globs are valid YAML | memory |
| Hook config fields `type: command`, `command`, `timeout`, `statusMessage`, and the group-level `matcher` | All documented. `statusMessage` is "a custom spinner message while the hook runs" | hooks |
| `PreToolUse` guards blocking with `exit 2` | The documented blocking mechanism, alongside the JSON `permissionDecision: "deny"` form. All three guards use it correctly | hooks |
| `PostToolUse` gates surfacing drift with `exit 2` | Correct — see the header note. Exit 2 does not block, and does put stderr in front of Claude | hooks |
| `$schema` in `settings.json` | Documented and explained on the settings page, absent from the settings-reference index. Both were checked before calling it conformant | settings |
| `@../AGENTS.md` import in `.claude/CLAUDE.md` | The documented import syntax. `AGENTS.md` alongside `CLAUDE.md` is explicitly supported | memory |
| `permissions.deny` entries in `Read(./path)` form | The documented form — it is the docs' own example spelling | settings, permissions |

## D. Unverified

Neither is a finding. Both are places where the documentation does not settle
the question, recorded rather than guessed.

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

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Medium |
| **Location** | `.claude/hooks/protect-bash-writes.py:166-180`, `.claude/hooks/_bash_targets.py:126` |
| **The "Why"** | `main()` resolves every path-shaped token `parse()` finds and refuses the command if any is a secret. `parse()` has no notion of which argument position a token occupies — there is no pattern-, `grep`- or search-awareness anywhere in it. So a read-only command that merely *names* a secret path inside a quoted regex is refused. This review hit it on `grep -n 'Read(\./\.env...' .claude/settings.json` — a grep of the settings file, reading no secret at all. The consequence is narrow but self-defeating: you cannot audit, document, or grep your own deny list from the shell, and the block arrives with a message about credential disclosure that does not describe what happened. |
| **The Fix** | Keep the mention-level check — it is the right conservative default when a shell command cannot be fully parsed, and loosening it to file-operand-only would be a security regression. Narrow it instead at the one place the position *is* unambiguous: for a known search command (`grep`, `rg`, `egrep`, `fgrep`, `awk`, `sed`), skip the first non-flag argument, which is the pattern rather than a path. That is a small change to `parse()` in `_bash_targets.py` and leaves every write path untouched. |
| **Workaround today** | Read the file with a command that does not spell the path — `cat -n .claude/settings.json` — or use the `Grep` tool, which the guard does not police. |

---

## Not findings

- **`disallowedTools` on the four agents duplicating `check_agent_config.py`'s
  assertion.** The validator requires `Write` and `Edit` in `disallowedTools`
  for every reviewer and the verifier. That is deliberate belt-and-braces: the
  frontmatter is the enforcement and the check is what stops the frontmatter
  being quietly edited away.
- **Ten skills where most carry only `name` and `description`.** Both are the
  only fields that matter for invocation, and `description` is the one the docs
  call "Recommended". Findings 8 and 11 propose adding fields to five of them on
  specific grounds; the other five need nothing.
- **`model: sonnet` on all four agents.** A read-only auditor on Sonnet is a
  cost choice this project is entitled to make, and `inherit` would hand audits
  to whatever the main session happens to be running.
- **No `.claude/commands/`.** `check_agent_config.py` prohibits the directory
  outright, and skills are user-invocable by default, so the slash commands
  exist without it.
