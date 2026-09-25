# Technical Specification: Whole-Codebase Review §5 — Claude Setup Remediation

**Related Intent**: `.claude/intents/2026-09-24-codebase-review-claude-setup.md`
**Source report**: `docs/review/codebase_review_20260924.md` §5 (CS1–CS7), plus
CS8–CS10, which were found while re-verifying it
**Target Audience**: Owner, then Work Sample
**Status**: implemented, phases A–D. Deviations from the plan are listed in
**Revised during implementation** at the end of §6.
**Tree**: line numbers are at `9aefeec`. §1–§4 did not touch the lines §5
cites, so they match the report's `f33d629` numbers too.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [ ] Frontend SPA: none.
  - [ ] Backend API: none. One test is added to
        `tests/backend/integration/test_chat_stream.py` (CS2).
  - [ ] Database Schema: none.
  - [ ] CI/CD & Deploy: no workflow changes. `backend-check` already runs
        `tests/tooling/` (it is in `pytest.ini`'s `testpaths`), and
        `agent-config-check` already runs `check_agent_config.py`.
  - [x] Claude Code configuration (not in the template's list):
        `.claude/hooks/_bash_targets.py`, `protect-bash-writes.py`,
        `protect-migrations.sh`, `protect-spa-egress.sh`, `verify-docs.sh`,
        `verify-bash-edits.py`, a new `readonly-bash.py`;
        `.claude/settings.json`; `scripts/check_agent_config.py`;
        `.claude/REVIEW.md`; `.claude/skills/security-audit/SKILL.md` and its
        `.agents/skills/` mirror; `.claude/rules/navigation.md`
  - [x] Tests: `tests/tooling/test_bash_write_guard.py`,
        `test_agent_config_check.py`, plus two new files,
        `tests/tooling/test_edit_hooks.py` and `test_readonly_bash_guard.py`
  - [x] Docs and hygiene: `docs/ECC.md`, `docs/TESTING.md`, `.gitignore`, one
        deleted file, and the report itself once each phase is green

- **No new runtime dependency.** The new hook is standard-library Python,
  like `protect-bash-writes.py`. The shell guards keep `jq`, and now say so
  when it is missing.

- **Delivery**: four phases, one commit each, in this order. Each runs the gates
  in §6.

| Phase | Findings | Files | Why grouped |
| :--- | :--- | :--- | :--- |
| **A** | CS8 (P2), CS9, CS3, CS4 | the three PreToolUse guards and `_bash_targets.py` | Everything that decides what a guard sees and what happens when it cannot look. B's guard is built on A's tokenizer |
| **B** | CS1 (P2) | new hook, `settings.json`, `check_agent_config.py` | One new enforcement point and its validator |
| **C** | CS5, CS10 | the two PostToolUse verify hooks, `navigation.md` | Drift the hooks should surface, and one piece of prose they contradict |
| **D** | CS2, CS6, CS7 | `REVIEW.md`, `security-audit`, `docs/ECC.md`, `.gitignore` | Policy text and hygiene. No hook changes |

---

## 2. Contracts

There is no HTTP API change. What changes is the contract between the hooks
and the commands they judge. It is stated here once, because every phase tests
against it.

### 2.1 What a segment is (CS8, CS9): `_bash_targets.py`

A *segment* is one simple command. Every Bash-path rule (migration
immutability, templates, egress, the venv search, the verify gates and, from
Phase B, the read-only policy) is decided per segment. Today a segment ends
only where `shlex` emits one of `SPLITTERS` as a token of its own. A line break
never becomes such a token, and an escaped line break does, which is the
wrong way round.

| Input | Today | After Phase A |
| :--- | :--- | :--- |
| `a` newline `b` | one segment: `shlex` with `whitespace_split` lexes `\n` as whitespace, so `SPLITTERS`' `"\n"` never occurs | two segments. `tokenize()` sets `lex.whitespace = " \t\r"` and `punctuation_chars="();<>\|&\n"`, so a newline is an operator |
| `sed -i \` newline `'s/a/b/' f` (a continuation) | two segments, wrongly: the escaped newline becomes a literal `"\n"` token, which splits `sed -i` from its operands, so no target is found | one segment. Continuations are removed before lexing, as the shell does |
| `a);b`, `(cd x)&&ls` | `);` and `)&&` are single tokens and split nothing | glued punctuation is decomposed into operators (`;`, `;;`, `;&`, `&&`, `\|\|`, `\|&`, `\|`, `&>>`, `&>`, `>>`, `>\|`, `>&`, `<>`, `<<<`, `<<`, `<&`, `>`, `<`, `&`, `(`, `)`, `\n`) |
| `( … )`, `{ …; }`, `if …; then`, `while …` | `(`, `{`, `if` and `while` become the "utility", so the real one is never seen | `(` and `)` split segments. `if`, `elif`, `while`, `until` and `{` join `PREFIXES` |
| a `ValueError` from `shlex` | falls back to `\S+` words, losing line breaks | the fallback keeps one `"\n"` token per line break |

**Opaque** means the targets cannot be read off the command line. The guards
then fall back to "was a protected path mentioned at all". Phase A widens
opacity from interpreters to every construct that runs text as a command:

- `OPAQUE` gains `bash`, `sh`, `zsh`, `dash`, `ksh`, `eval`, `source` and `.`.
  `_utility` returns `"."` for a bare dot, where `Path(".").name` gives `""`.
- `$(`, a backtick, `<(` or `>(` anywhere in the command, heredoc bodies
  included, makes it opaque. An unquoted heredoc delimiter expands `$(…)` in
  its body.
- A `find` segment carrying `-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`,
  `-fprint`, `-fprint0`, `-fprintf` or `-fls` is opaque.
- A segment in which `xargs` precedes the utility is opaque.

Mentions are still collected from the heredoc-**stripped** command, so a commit
message or a file body that merely names a protected path does not put it at
risk. `check_venv_search` switches to the stripped command for the same reason.
Once newlines split segments, a body line reading `find . -name x` would
otherwise look like a search.

`check_spa_egress` takes `targets | (mentioned if opaque else set())`, which is
what the migration and template rules already use. Today a `python3 -c` write
into an SPA file is never checked for origins.

### 2.2 The origin-reference rule (CS4)

An origin reference is **any scheme followed by `//host`**, or a
**scheme-less `//host` that begins a token**: not preceded by a word
character, `/`, `:` or `.`. The host must be a dotted name with an alphabetic
TLD, or an IPv4 literal. The reference's host is refused unless it is in
`spa-egress.json`. The allowlist itself is unchanged.

```text
# ERE, used by protect-spa-egress.sh. POSIX only (no -P, no \w, no lookaround),
# so BSD grep on macOS reads it the same way.
(^|[^A-Za-z0-9_/:.])//(([A-Za-z0-9-]+\.)+[A-Za-z]{2,}|([0-9]{1,3}\.){3}[0-9]{1,3})|[A-Za-z][A-Za-z0-9+.-]*://[A-Za-z0-9.-]+
```

The Python rule in `protect-bash-writes.py` has the same two alternatives, with
`re.M` so that `^` means line start as it does for `grep`. The two
alternatives cannot match at the same position: one begins with a non-word
character or a line start, the other with a letter. So POSIX leftmost-longest
and Python's leftmost-first return the same matches. **Parity is a test, not a
comment**: `test_edit_hooks.py` runs one case table through both guards.

Measured against today's tree (`git ls-files` for the SPA's guarded globs, 104
files), both rules flag exactly one non-allowlisted host, `www.w3.org`. It
appears in `styles.css:5663`'s SVG data URI and in the vendored
`purify.min.js`. So the new rule adds no false positive. The `www.w3.org`
mismatch predates this work. See the intent's non-goals.

### 2.3 Guard failure semantics (CS3)

Only exit 2 blocks. Each guard therefore turns "cannot check" into exit 2 itself:

```bash
# protect-migrations.sh and protect-spa-egress.sh, after `set -euo pipefail`.
# An EXIT trap rather than the report's ERR trap: ERR does not fire on a `set -u`
# expansion error, which exits 1 and passes (measured).
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
        echo "Error: ${0##*/} failed (exit $rc); refusing the edit rather than passing it unchecked." >&2
        exit 2
      fi' EXIT
command -v jq >/dev/null 2>&1 || { echo "Error: ${0##*/} needs jq; install it, or the guard refuses every edit." >&2; exit 2; }
```

`${0##*/}` avoids depending on `basename`. `protect-bash-writes.py`: an
exception escaping `main()` becomes `die(…)` (exit 2). Today it is a traceback
and exit 1, which passes. A payload that is not JSON still returns 0, because
`test_guard_ignores_malformed_payload` pins that decision.

### 2.4 The read-only policy (CS1): `.claude/hooks/readonly-bash.py`

**When it acts.** It is registered as the second hook of `settings.json`'s
`PreToolUse` `Bash` group. It reads `agent_type` from the payload, which the
hooks reference documents as present inside a subagent and set to the agent's
`name`. It then acts only if that agent is **read-only**, meaning its
frontmatter `disallowedTools` removes both `Write` and `Edit`. That is derived
from `.claude/agents/*.md` on each call, as a YAML list or a comma string.
With no `agent_type`, a non-read-only agent, or a payload that is not JSON, it
exits 0 at once. The main session never reaches the policy.

**Fail closed after identification.** Any exception once a read-only agent has
been identified exits 2 with the reason.

**The policy is an allow-list.** A segment passes only if every rule below
passes, and anything unlisted is refused. This is why an allow-list, not
`parse()`'s targets and opacity: an allow-list also refuses the writer nobody
thought to list (`install`, `patch`, `split`, `curl -o`, `tar -x`, `ed`).

| Class | Allowed | Refused |
| :--- | :--- | :--- |
| Shell structure | `;` `&&` `\|\|` `\|`, newlines, `( … )`, `{ …; }`, `if`/`then`/`elif`/`else`/`fi`, `for`/`while`/`until` … `do` … `done`, `VAR=value` prefixes, `export`, `set`, `unset` | `$(…)`, backticks, `<(…)`, `>(…)` (anywhere, heredoc bodies included); `case`, `select`, function definitions; `bash`, `sh`, `zsh`, `dash`, `ksh`, `eval`, `source`, `.` |
| Redirection | `<`, `<<`, `<<<`; descriptor duplication (`2>&1`, `>&-`); `>`, `>>`, `&>`, `>\|`, `>&`, `<>` onto an **absolute path outside the repository** (`/dev/null`, `/tmp/…`) | the same operators onto a relative path (after a `cd` it cannot be placed), or onto any path that resolves inside the repository, symlinks followed |
| Readers | `cat head tail wc nl od hexdump file stat du df ls tree realpath readlink basename dirname pwd cd grep egrep fgrep cut tr paste join comm diff cmp column fold fmt expand unexpand rev tac jq sha256sum sha1sum md5sum cksum b2sum base64 echo printf true false test [ [[ : read type which date id whoami uname printenv seq sleep expr exit` | every utility not named in this table: `cp`, `mv`, `rm`, `touch`, `mkdir`, `ln`, `chmod`, `tee`, `patch`, `curl`, `wget`, `tar`, `perl`, `npx`, `pip`, `sudo`, … |
| Conditional readers | `sort` (not `-o`/`--output`), `uniq` (at most one operand), `xxd` (at most one operand, not `-r`), `rg` (not `--pre`), `sed` (not `-i`/`--in-place`, and no `w`, `W` or `e` command in its script), `awk`/`gawk` (no `print`/`printf` into `>` or `\|`, no `system(`, no `getline` from a command), `find` (not `-delete`, `-fprint*`, `-fls`; the command after `-exec`, `-execdir`, `-ok` or `-okdir` must itself pass) | the flags and forms named |
| Wrappers | `env` (not `-S`), `time`, `nice`, `nohup`, `timeout`, `xargs`, `command`, `exec`: the wrapped command must pass. `command -v`/`-V` is a lookup | — |
| `git` | `status diff log show blame annotate grep ls-files ls-tree rev-parse rev-list cat-file describe shortlog merge-base diff-tree diff-index diff-files show-ref for-each-ref check-ignore check-attr name-rev whatchanged count-objects range-diff cherry show-branch version help var`. Also the list forms of `branch` and `tag` (no operand, or `-l`/`--list`), `stash list`/`show`, `remote` (bare, `-v`, `get-url`), `config` (`--get*`, `--list`/`-l`, `get`, `list`), `worktree list` and `reflog` (show). Global `-C`, `--no-pager`, `-P`, `--git-dir`, `--work-tree` | every other subcommand, including `commit`, `add`, `rm`, `mv`, `checkout`, `switch`, `restore`, `reset`, `clean`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `apply`, `fetch`, `pull`, `push`, `gc`, `update-index`, and `branch`/`tag`/`stash`/`config` in their writing forms. Also `-c` (it can set a pager, an editor or an alias), any `--output`, and `grep -O`/`--open-files-in-pager` |
| `npm` | `test`/`t`; `run` with no script, or a script in `READ_SCRIPTS` (`lint`, `lint:js`, `lint:css`, `test`, `build`, `format:check`, `check:csp`, `check:traces`, `check:docs`, `check:resume`, `audit`); `ls`, `view`, `outdated`, `explain`, `audit` (not `fix`), `--version` | `run format` and `run generate:resume` (`WRITE_SCRIPTS`), any script in neither set, every other subcommand (`install`, `ci`, `uninstall`, `update`, `exec`, …) |
| Python | `python`/`python3` running `scripts/check_agent_config.py`, `check_backdrop_traces.py`, `check_csp_hashes.py`, `check_docs.py` (not `--fix`), `verify_images.py` or `generate_resume.py --check`; `-m pytest`, `-m json.tool`, `--version`; `pytest` (not `--basetemp`, `--junitxml`/`--junit-xml`, a non-terminal `--cov-report`, or `--report-log`) | `-c`, `-`, no script (stdin or a heredoc), any other script or module |
| Node | `node --test …`, `node --check <file>`, `node scripts/build.mjs`, `--version` | `-e`/`--eval`, `-p`/`--print`, stdin, any other script |
| `ruff` | `check` (not `--fix`, `--unsafe-fixes`, `--add-noqa`, `-o`/`--output-file`), `format --check`/`--diff`, `rule`, `version`, `--version` | `format` without `--check`/`--diff`, `clean`, and every other subcommand |
| `alembic` | `upgrade`, `downgrade`, `check`, `current`, `history`, `heads`, `branches`, `show` (they write the database, not the repository, and the `testing` skill's round trip needs them) | `revision`, `merge`, `stamp`, `edit`, `init` |

Every allowed gate writes, at most, build output and tool caches, all of
which git ignores: `dist/`, `.coverage`, `.pytest_cache/`, `.ruff_cache/`,
`__pycache__/`.

**Its message** names the agent, the refused construct and the way out:

```text
readonly-bash: security-reviewer is read-only (its disallowedTools remove Write and Edit),
so this command was refused: `sed -i` edits files in place.
Read with the Read, Grep and Glob tools, or run a read-only command. If a gate you were
told to run was refused, report that rather than working around it.
```

### 2.5 The validator (CS1): `check_agent_config.check_readonly_guard`

If any `.claude/agents/*.md` is read-only by the §2.4 criterion,
`settings.json` must run `.claude/hooks/readonly-bash.py` from a `PreToolUse`
group whose matcher covers `Bash`: `Bash`, a `|`-list containing it, `*`, or
empty. Otherwise the error names the agents and the missing registration.
`check_settings` already fails a hook script that is missing or not
executable. `main()` and `test_repository_passes_its_own_validator` both call
the new check.

---

## 3. Database Schema & Migration Plan

None.

---

## 4. Implementation & Acceptance

Each row names the signal a test asserts. Tooling tests run the hook as a
subprocess with a JSON payload on stdin, as `test_bash_write_guard.py` already
does. A stub project root is a `tmp_path` whose `scripts/check_*.py` exits 1,
so that "the gate ran" is visible as exit 2 even on a clean tree.

### Phase A: the Bash-path guards see the whole command and fail closed

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **CS8** | §2.1: newline and glued-operator segmentation, continuations, `(`/`)` as splitters, the new `PREFIXES`, a line-preserving fallback, and `check_venv_search` on the stripped command. | `.claude/hooks/_bash_targets.py`, `.claude/hooks/protect-bash-writes.py` | All 54 existing cases still pass. `test_tracked_migrations_are_immutable` gains six templates: the write on a second line, after a line continuation, inside `( … )`, after `if`, inside `{ …; }`, and after `a);`. `BLOCKED` gains the egress write and the template overwrite, each on a second line. `ALLOWED` gains two multi-line read commands. New: in the `venv_root` fixture, a heredoc whose body holds `find . -name x` is allowed. New: `verify-bash-edits.py` against a stub root, with `cd /tmp`, a newline, then `sed -i … frontend/index.html`, exits 2. Today it exits 0 |
| **CS9** | §2.1: the opaque set, substitution, `find` actions, `xargs`; egress on opaque commands. | `.claude/hooks/_bash_targets.py`, `.claude/hooks/protect-bash-writes.py` | `test_tracked_migrations_are_immutable` gains `bash -c`, `sh -c`, `eval`, `x=$(rm …)`, `echo $(sed -i …)`, backticks, `find <path> -delete` and `echo <path> \| xargs rm`. All eight exit 0 today (measured). `BLOCKED` gains a `python3 -c` that appends a non-allowlisted URL to `frontend/js/form.js`. `ALLOWED` gains three commands. The first is `git commit -m "$(cat <<'EOF'` with a body that names a tracked migration and `frontend/index.html`. The other two are `git ls-files docs \| xargs wc -l` and `find frontend -name '*.js' -exec grep -l fetch {} +` |
| **CS3** | §2.3 in both shell guards; the exception wrapper in `protect-bash-writes.py`. | `.claude/hooks/protect-migrations.sh`, `protect-spa-egress.sh`, `protect-bash-writes.py` | New `test_edit_hooks.py`, for each shell guard. (1) With `PATH` holding every tool it uses except `jq`, it exits 2 and stderr names `jq`. Today that exits 127. (2) On input `not json` it exits 2. Today that exits 5. (3) An unguarded path (`docs/API.md`) still exits 0. Also: `protect-migrations.sh` refuses a tracked migration, which no test pinned before. `protect-bash-writes.py` with `CLAUDE_PROJECT_DIR` set to a missing directory exits 2. Today it exits 1 on the `git ls-files` `FileNotFoundError`. `test_guard_ignores_malformed_payload` is unchanged |
| **CS4** | §2.2 in both guards, replacing `protect-spa-egress.sh:63-77` and `protect-bash-writes.py:104-110`. The shell side pipes through `printf '%s\n'` rather than `echo`, so content that starts with `-n` or `-e` is not swallowed as an option. | `.claude/hooks/protect-spa-egress.sh`, `protect-bash-writes.py` | `test_edit_hooks.py`: one case table runs through the Edit guard (an `Edit` payload whose `new_string` is the text) and the Bash guard (`printf '%s' <shlex-quoted text> >> frontend/js/form.js`). The two must return the same verdict, and it must be the expected one. **Refused**: `https://cdn…` (control), `//cdn…` in `src=`, in an `import`, in `url()`, as `srcset`'s second candidate, `wss://…` and `//10.0.0.5/…`. **Allowed**: `//rjasti.com/…`, `https://formsubmit.co/…`, `// see below`, `//TODO fix`, `a//b.c` and `http://localhost:8000` |

### Phase B: read-only subagents are read-only

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **CS1** | (1) The §2.4 hook. (2) `settings.json`: the `PreToolUse` `Bash` group gets a second hook entry for `"$CLAUDE_PROJECT_DIR"/.claude/hooks/readonly-bash.py`, with `timeout: 15` and a `statusMessage`. The file is executable. (3) §2.5 in `check_agent_config.py`. | `.claude/hooks/readonly-bash.py`, `.claude/settings.json`, `scripts/check_agent_config.py` | New `test_readonly_bash_guard.py`. The payload carries `agent_type: "security-reviewer"`. **Refused**, covering every row of §2.4's refused column: `sed -i`; a redirect, an append and a heredoc into the repo; a relative redirect after `cd /tmp`; `tee`, `cp`, `mv`, `rm`, `touch` and `mkdir`; `git commit`, `add`, `checkout`, `stash`, `push`, `branch foo`, `-c core.pager=…` and `diff --output=x`; `check_docs.py --fix`; `npm run format`; `npm install x`; `npx`; `ruff check --fix`; `ruff format`; `python3 -c`, `python3 -`, and `python3` fed a heredoc; `node -e`; `bash -c`, `eval` and `source`; `$(…)`, backticks and `<(…)`; `find -delete` and `find -exec rm`; `xargs rm`; a `sed -i` on a second line; `pytest --basetemp=server`; `alembic revision`; `sort -o`; `awk` printing into a file; `sed … w out`; `curl -o`. **Allowed**: the seven gate commands in `verifier.md`, verbatim; the documented `sed -n` and `grep` recipes; `2>/dev/null`; pipelines; `git status`, `diff`, `log`, `show`, `-C`, `--no-pager`, `branch --show-current` and `stash list`; `git show … > /tmp/x`; multi-line reads; a `for` loop; `find … -exec grep`; `xargs wc`; `jq`; `npm test > /tmp/log 2>&1`; `cd server && PYTHONPATH=.. alembic check`; `node --test frontend/tests/<file>`; `command -v jq`. **Scope**: with no `agent_type`, or with `general-purpose`, the same `sed -i` passes. **Derivation**: in a stub root, an agent whose `disallowedTools` lists `Write` and `Edit` is held, as a YAML list and as a comma string, and one without them is not. **Classification**: `READ_SCRIPTS ∪ WRITE_SCRIPTS` equals `package.json`'s scripts, so a new script fails CI until it is classified. **Fail closed**: an exception raised after identification exits 2. `test_agent_config_check.py`: a read-only agent with no registration is an error naming `readonly-bash.py`, and a registration on a `Bash` group passes |

### Phase C: drift the hooks should surface

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **CS5** | `README.md` and `package-lock.json` join `verify-docs.sh:13` and `DOCS_COVERED` (`verify-bash-edits.py:28`). A comment beside each list says the test derives the set. `package-lock.json` rarely changes through a write a hook can see, because `npm install` is opaque, so CI stays the backstop for that row. | `.claude/hooks/verify-docs.sh`, `verify-bash-edits.py` | `test_edit_hooks.py` builds `check_docs_inputs()` the way `check_docs.py` does. It takes the first-column paths of both rules tables, the two rules files and `docs/*.md`. It adds the shipped JS modules, using `check_docs.py`'s own `JS_EXCLUDED`, and the test files under its own `TEST_ROOTS`, both imported rather than copied. Every input is `covered()` by `verify-bash-edits.py`. `verify-docs.sh` against a stub root exits 2 for each table-named input, plus one sample per glob. Today `README.md` and `package-lock.json` fail on both hooks |
| **CS10** | Prose only. Web sessions have `server/.venv`, because `session-start.sh` creates it; CI is the fresh clone. The rule itself is right and does not change. | `.claude/rules/navigation.md:36-39`, `.claude/hooks/protect-bash-writes.py:117-119`, `tests/tooling/test_bash_write_guard.py:69-74` | Read. `check_docs.py` still passes, because the table above that paragraph is untouched |

### Phase D: review policy and repo hygiene

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **CS2** | (1) `REVIEW.md:11` asks: *does any request schema accept a model id, a system prompt or an inference setting (a token ceiling, a temperature) from the client? That covers a new field on `ChatStreamRequest`, a `role` beyond `user`/`assistant`, or a route that reads the raw body.* The frontend not sending one is not the check, because the API is what an anonymous caller reaches. (2) `security-audit`: the §5 checklist gains that question, naming the pin. The `/chat/summarize` paragraph (`:50-54`) stops saying it skips the free-message budget, which §1's C17 fixed at `chat_routes.py:226`. It keeps "treat any change that widens it as a cost-exposure change". (3) The `.agents/skills/` copy is replaced byte for byte. (4) A new test sits after `test_system_prompt_override_is_not_accepted` (`test_chat_stream.py:391-409`). | `.claude/REVIEW.md`, `.claude/skills/security-audit/SKILL.md`, `.agents/skills/security-audit/SKILL.md`, `tests/backend/integration/test_chat_stream.py` | `test_chat_request_carries_nothing_the_server_owns` checks three things. `set(ChatStreamRequest.model_fields)` is `{"messages", "conversation_id", "stream"}`. `set(ChatMessage.model_fields)` is `{"role", "content"}`. `get_args(ChatMessage.model_fields["role"].annotation)` is `("user", "assistant")`. Adding a `max_tokens` field locally makes it fail, checked once and then reverted. `check_mirror_drift` passes |
| **CS6** | `docs/ECC.md` "Known rough edge" becomes "Known rough edges" and records the description defect. It gives the folded text and its cost (a stray word, and ~20 always-loaded tokens of iOS/Android scope). It records the evidence that the text is upstream's: the digest matches `install-state.json`, npm's `latest` is 2.2.1, and ECC's `main` is unchanged, all checked 2026-09-24. It adds that the documented upgrade command picks up a fix once one is released. The vendored file is not edited. | `docs/ECC.md` | `sha256sum .claude/skills/accessibility/SKILL.md` still starts `d8578fe7`. No link targets `#known-rough-edge` (grepped), so the heading can change |
| **CS7** | `git rm` the task file. `.gitignore` gains `.antigravity/antigravity-ide/` and a one-line reason. The three `.antigravity/` stubs that point at `AGENTS.md` stay. | `.antigravity/antigravity-ide/brain/1c01715d-…/task.md`, `.gitignore` | `git ls-files .antigravity` lists the three stubs only. `git check-ignore -v .antigravity/antigravity-ide/brain/x/task.md` names the new rule |

### DOM sanitization

Not touched.

### Styling

No CSS change.

---

## 5. Security & Rate Limiting Review

`docs/SECURITY.md`'s pre-merge checklist covers auth, tokens, rate limits, the
CSP and user-controlled output, and none of those change here. The guard-side
equivalents:

- [x] **Nothing widens an agent's reach.** No `permissions.allow` entry, no
      `allowed-tools`, no tool grant. Every change refuses more.
      claude-setup.md #11 stays blocked on the owner.
- [x] **Guards fail closed** when they cannot check (CS3). The read-only guard
      does too, once it knows the caller promised to be read-only.
- [x] **Egress**: stricter on both paths (CS4, CS8, CS9). The allowlist is
      unchanged.
- [x] **ADR-014**: tracked migrations are immutable on the Bash path again (CS8,
      CS9).
- [x] **ADR-023**: pinned by the request's shape, not only by one field name
      (CS2).
- [x] **No secrets logged**: the new hook prints only its refusal reason to
      stderr, which goes to the agent. It writes no log.
- [x] **CSP hashes**: no inline script changes.

---

## 6. Verification & Test Plan

Run each gate **once, after the last edit of that phase**. If one fails, fix it
and re-run that gate alone (`AGENTS.md` §6).

```bash
# Every phase
ruff check server tests
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55
python3 scripts/check_agent_config.py
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```

No phase touches `frontend/`, so `npm run lint` and `npm test` are not
required. In Phase A, the jq-less and malformed paths are also run once by
hand, against the real guards, and must match the test.

**Docs changed with the code**, in the same commit as the change they
describe:

| Phase | Doc | Change |
| :--- | :--- | :--- |
| A | `docs/TESTING.md` "Tooling tests" (`:168-176`) | New row for `test_edit_hooks.py`. `test_bash_write_guard.py`'s row gains the multi-line, shell and substitution cases. The counts are corrected: the section says 2 files and 50 tests (37 + 13), and pytest collects 82 (54 + 28) today |
| B | `docs/TESTING.md` "Tooling tests" | New row for `test_readonly_bash_guard.py`. `test_agent_config_check.py` count and description |
| B | `docs/ECC.md:35` | "the seven hooks in `.claude/hooks/`" becomes eight |
| C | `docs/TESTING.md` "Tooling tests" | `test_edit_hooks.py` gains the coverage test |
| D | `docs/TESTING.md:153` | `test_chat_stream.py`: 21 → 22, plus the shape pin |
| D | `docs/ECC.md` "Known rough edge" (`:71-76`) | CS6 |

`check_docs.py --fix` repairs `reference-docs.md`'s token figures for the docs
these edits grow.

**Report update.** `docs/review/codebase_review_20260924.md` is edited only
after a phase's gates pass. Each CS finding gains the `**Status**` and
`**What changed**` rows that §1–§4 use. Where the fix differs from the
report's suggestion (CS1, CS2, CS3, CS4, CS5, CS6), the row says so. CS8–CS10
go under a new `### Found during remediation (not scored)` heading at the end
of §5, in the same attribute-table format, with their own status. The summary
counts stay as the dated review scored them.

**Owner actions outside the repo** (listed in the summary, not done by the
agent):

- File the upstream ECC issue for CS6, using the draft below.
- Optionally, decide whether `www.w3.org` belongs in `spa-egress.json`, beside
  the existing `w3.org`, which matches none of the namespace URIs in use.
- After Phase B, run the `agent_type` check in "Unverified going in".

**CS6 upstream issue draft** (for `github.com/affaan-m/ECC`):

> **skills/accessibility: `description` has a stray "standards." fragment**
>
> The folded `description` in `skills/accessibility/SKILL.md` reads "…or when
> reviewing a change for keyboard, contrast, or screen-reader support.
> standards. Use this skill to generate semantic ARIA…". It looks as if the
> "Use when…" sentence was inserted into "…WCAG 2.2 Level AA standards.". It
> is present in 2.2.1 and on `main`. Suggested: "Design, implement, and audit
> inclusive digital products to WCAG 2.2 Level AA. Use when building or
> auditing UI that must meet WCAG 2.2 AA, or when reviewing a change for
> keyboard, contrast or screen-reader support." Since the description is
> always loaded, the iOS/Android sentence also costs every install tokens
> whether or not it targets native platforms.

### Sequencing with the report's other sections

§1–§4 are implemented, and none of them touched a file this spec changes,
apart from the count repairs in the two rules files. §2's spec deferred CS2
until S1 had removed `model_id`. S1 is done, and CS2's pin is the check that
the §2 spec asked for.

### Unverified going in

- **`agent_type` in a subagent's `PreToolUse` input.** It is documented in the
  hooks reference's common input fields, but not observed here, because no
  subagent was spawned. After Phase B: spawn `security-reviewer` and ask it to
  run `echo x > /tmp/ro-check` (allowed) and `echo x > ro-check` (refused). If
  the second passes, the field is absent, the guard is inert (no worse than
  today), and the registration moves to agent frontmatter, with the
  workspace-trust caveat the intent records.
- **BSD `grep`.** The §2.2 ERE uses POSIX features only. CI and web sessions
  run GNU `grep`, and macOS was not exercised.
- **`shlex` with `"\n"` in `punctuation_chars`.** A custom punctuation string
  has been supported since Python 3.6, so it holds on both legs of CI's
  matrix (3.10 and 3.12). Phase A's tests run on each.
- **A project subagent's frontmatter hooks in this environment.** Moot for the
  design, which does not rely on them. The report's route would have been
  inert here if these web sessions count as untrusted.

### Revised during implementation

| # | Plan | What shipped, and why |
| :--- | :--- | :--- |
| CS8 | Newlines, continuations, glued operators, `(`/`)` and the new `PREFIXES` | Also turns off shlex's `#` comments. shlex reads a comment through the end of its line, newline included, so `echo x # note` would still have merged the next line into its segment. A comment-then-write template pins it |
| CS9 | Shells, `eval`, substitution, `find` actions, `xargs` | Also an in-place flag inside an option cluster. `parse()` tested only `startswith("-i")`, so `perl -pi -e` (perl's own in-place idiom), `sed -ni` and `sed -Ei` rewrote a tracked migration unchecked. It now reads the whole cluster, stopping at an option that takes the rest as its argument. That comes as its own commit after Phase D |
| CS1 | Redirect targets from `parse()` | Read from operator tokens instead. `parse()`'s regex safety net takes a quoted ` > ` for a redirection, so `jq 'select(.x > 1)'` and `awk '$3 > 100'` would have been refused as writes. A command whose quoting shlex cannot parse is refused outright, because its tokens cannot be trusted |
| CS1 | `file`, `tree` and `base64` as plain readers | Conditional readers: `file -C`, `tree -o` and `base64 -o` write files |
| CS1 | sed and awk conditions | Also refused: `sed -f`, `awk -f`, and gawk's `-i` (in place), `-E` and `-l`, whose programs or extensions cannot be read. A sed `-i` inside a cluster (`-ni`, `-ie`) is refused too |
| CS1 | Refuse after identification | A subagent whose agent definitions cannot be read is refused rather than trusted |
| CS5 | The derived coverage test | Plus a check that the derivation itself finds `README.md`, `package-lock.json`, `frontend/styles.css` and `docs/API.md`, so a changed table format cannot make the coverage tests pass vacuously |

**Drift fixed along the way**, each where the change touched the doc anyway.
`TESTING.md`'s tooling section said 2 files and 50 tests, where pytest collected
82. Its backend line said 15 files and 225 test functions, where there were 16
files and 258 functions before CS2 added one.
