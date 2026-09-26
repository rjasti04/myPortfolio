#!/usr/bin/env python3
"""PreToolUse guard that holds a read-only subagent to read-only commands.

The four agents in .claude/agents/ call themselves read-only, and their
`disallowedTools` remove Write, Edit and NotebookEdit. Bash stays, and Bash can
`sed -i`, redirect into a file and `git commit`. A subagent runs in the main
session's permission mode whenever that is acceptEdits, auto or
bypassPermissions, and its own `permissionMode` is then ignored, so nothing else
held them to the promise.

This is registered in settings.json rather than in each agent's frontmatter.
Claude Code skips a project subagent's frontmatter hooks until the folder's
workspace-trust dialog is accepted, and a `-p` session never counts as trusted,
so a frontmatter hook would sit inert in exactly the headless runs nobody
watches. Settings hooks run inside subagents too, and their input names the
agent in `agent_type`.

Read-only is derived, not listed: an agent whose `disallowedTools` removes both
Write and Edit has declared it, which is the same criterion
scripts/check_agent_config.py enforces for the four. With no `agent_type`, or
any other agent, this exits 0 at once, so the main session is never judged.

The policy is an allow-list. A command passes only if everything in it is named
below, so a writer nobody thought to list (`install`, `patch`, `split`,
`curl -o`) is refused too. It stops the ways a well-meaning agent edits files
from a shell, and refuses what it cannot read. It is not a sandbox: an allowed
`npm test` still runs project code.

Exit 2 blocks the call and returns stderr to the agent.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bash_targets import (  # noqa: E402
    SUBSTITUTION, normalize, segments, strip_heredocs, tokenize,
)

# What an agent declares by removing both from itself.
READ_ONLY_MARK = {"Write", "Edit"}

# Utilities that only read, format or compare, with no way to write a file from
# their own arguments.
READERS = {
    "cat", "head", "tail", "wc", "nl", "od", "hexdump", "stat", "du", "df", "ls",
    "realpath", "readlink", "basename", "dirname", "pwd", "cd",
    "grep", "egrep", "fgrep", "cut", "tr", "paste", "join", "comm", "diff", "cmp",
    "column", "fold", "fmt", "expand", "unexpand", "rev", "tac", "jq",
    "sha256sum", "sha1sum", "md5sum", "cksum", "b2sum",
    "echo", "printf", "true", "false", "test", "[", "[[", ":", "read", "type",
    "which", "date", "id", "whoami", "uname", "printenv", "seq", "sleep", "expr",
    "exit", "export", "set", "unset",
}

# Shell words that open or close a construct rather than run anything.
KEYWORDS = {"if", "then", "else", "elif", "fi", "do", "done", "while", "until",
            "!", "{", "}", "time"}

ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*")

# Output redirections. `>&` is duplication when a descriptor follows it.
REDIRECT_OUT = {">", ">>", ">|", "&>", "&>>", "<>", ">&"}
REDIRECT_IN = {"<", "<<", "<<<", "<&"}

GIT_READERS = {
    "status", "diff", "log", "show", "blame", "annotate", "grep", "ls-files",
    "ls-tree", "rev-parse", "rev-list", "cat-file", "describe", "shortlog",
    "merge-base", "diff-tree", "diff-index", "diff-files", "show-ref",
    "for-each-ref", "check-ignore", "check-attr", "name-rev", "whatchanged",
    "count-objects", "range-diff", "cherry", "show-branch", "version", "help", "var",
}
GIT_BRANCH_WRITES = {"-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy",
                     "-f", "--force", "-u", "--set-upstream-to", "--unset-upstream",
                     "--edit-description", "-t", "--track", "--no-track", "--create-reflog"}
GIT_TAG_WRITES = {"-d", "--delete", "-a", "--annotate", "-s", "--sign", "-u",
                  "--local-user", "-f", "--force", "-m", "--message", "-F", "--file",
                  "-e", "--edit"}
GIT_CONFIG_WRITES = ("--unset", "--add", "--replace", "--rename", "--remove", "-e", "--edit")

# npm scripts, by what they do. test_readonly_bash_guard.py fails when
# package.json gains a script that is in neither set, so a new one is classified
# on purpose rather than refused or allowed by accident.
READ_SCRIPTS = {"lint", "lint:js", "lint:css", "test", "build", "format:check",
                "check:csp", "check:traces", "check:docs", "check:resume", "audit"}
WRITE_SCRIPTS = {"format", "generate:resume"}
NPM_READERS = {"test", "t", "tst", "ls", "list", "ll", "la", "view", "v", "info",
               "show", "outdated", "explain", "why", "help"}

# Repository scripts that only read. check_docs.py rewrites with --fix, and
# generate_resume.py writes unless it is given --check.
PY_SCRIPTS = {"scripts/check_agent_config.py", "scripts/check_backdrop_traces.py",
              "scripts/check_csp_hashes.py", "scripts/check_docs.py",
              "scripts/verify_images.py", "scripts/generate_resume.py"}

ALEMBIC_READERS = {"upgrade", "downgrade", "check", "current", "history", "heads",
                   "branches", "show"}

# A sed `w`/`W` (write a file) or `e` (run a command) command, or an `s///` flag.
SED_WRITE = re.compile(r"(?:^|[;{}\n!,$0-9])\s*[wWe](?:\s|$|[;}])|/[gpIiMm0-9]*[wWe](?:\s|$|[;}])")

# awk printing into a file or a pipe, running a command, or reading one.
AWK_WRITE = re.compile(r"\b(?:print|printf)\b[^;}\n]*[>|]|\bsystem\s*\(|\|&?\s*getline\b")


class Refused(Exception):
    """The reason a command was refused, worded to follow 'refused: '."""


def refuse(reason: str) -> None:
    raise Refused(reason)


def outside_repo(token: str, root: Path) -> bool:
    """True only for an absolute path that resolves outside the repository.

    A relative path is never outside: after a `cd` there is no telling where it
    points, and the hook does not track the shell's working directory.
    """
    token = token.strip("'\"")
    if not token.startswith("/"):
        return False
    try:
        Path(token).resolve().relative_to(root.resolve())
    except ValueError:
        return True
    return False


def short_flags(args: list[str]) -> str:
    """Every letter given in a short-option cluster: `-uo` gives "uo"."""
    return "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--") and len(a) > 1)


def operands(args: list[str], takes_value: set[str] = frozenset()) -> list[str]:
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a in takes_value:
            skip = True
        elif not a.startswith("-") or a == "-":
            out.append(a)
    return out


# --- conditional readers ----------------------------------------------------


def check_sort(args: list[str], root: Path) -> None:
    if "o" in short_flags(args) or any(a == "--output" or a.startswith("--output=") for a in args):
        refuse("`sort -o` writes its result to a file")


def check_uniq(args: list[str], root: Path) -> None:
    if len(operands(args, {"-f", "-s", "-w", "--skip-fields", "--skip-chars", "--check-chars"})) > 1:
        refuse("`uniq` writes to its second operand")


def check_xxd(args: list[str], root: Path) -> None:
    takes = {"-c", "-g", "-l", "-o", "-s", "-n", "-cols", "-groupsize", "-len", "-offset", "-seek", "-name"}
    if any(a in ("-r", "-revert") for a in args) or len(operands(args, takes)) > 1:
        refuse("`xxd` writes to its second operand, and `-r` rebuilds a file")


def check_rg(args: list[str], root: Path) -> None:
    if any(a == "--pre" or a.startswith("--pre=") for a in args):
        refuse("`rg --pre` runs a command for every file it searches")


def check_tree(args: list[str], root: Path) -> None:
    if "-o" in args:
        refuse("`tree -o` writes its listing to a file")


def check_base64(args: list[str], root: Path) -> None:
    if any(a == "-o" or a.startswith("--output") for a in args):
        refuse("`base64 -o` writes a file")


def check_file(args: list[str], root: Path) -> None:
    if "C" in short_flags(args) or "--compile" in args:
        refuse("`file -C` compiles a magic file")


def check_sed(args: list[str], root: Path) -> None:
    scripts: list[str] = []
    explicit = False
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--in-place"):
            refuse("`sed -i` edits files in place")
        if a in ("-f", "--file") or a.startswith("--file="):
            refuse("a sed script read from a file cannot be checked")
        if a in ("-e", "--expression"):
            scripts.append(args[i + 1] if i + 1 < len(args) else "")
            explicit = True
            i += 2
            continue
        if a.startswith("--expression="):
            scripts.append(a.split("=", 1)[1])
            explicit = True
        elif a in ("-l", "--line-length"):
            i += 1
        elif a.startswith("-") and not a.startswith("--") and len(a) > 1:
            cluster = a[1:]
            if "i" in cluster:
                refuse("`sed -i` edits files in place")
            if "f" in cluster:
                refuse("a sed script read from a file cannot be checked")
            if "e" in cluster:
                rest = cluster[cluster.index("e") + 1:]
                if rest:
                    scripts.append(rest)
                else:
                    scripts.append(args[i + 1] if i + 1 < len(args) else "")
                    i += 1
                explicit = True
        elif not a.startswith("-") and not explicit:
            scripts.append(a)
            explicit = True
        i += 1
    if any(SED_WRITE.search(s) for s in scripts):
        refuse("the sed script writes a file (`w`) or runs a command (`e`)")


def check_awk(args: list[str], root: Path) -> None:
    programs: list[str] = []
    given = False
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-f", "--file", "-i", "--include", "-E", "--exec", "-l", "--load") \
                or a.startswith(("--file=", "--include=", "--exec=", "--load=")):
            refuse("an awk program read from a file, or an extension it loads, cannot be checked")
        if a in ("-F", "-v", "--field-separator", "--assign"):
            i += 2
            continue
        if a in ("-e", "--source"):
            programs.append(args[i + 1] if i + 1 < len(args) else "")
            given = True
            i += 2
            continue
        if not a.startswith("-") and not given:
            programs.append(a)
            given = True
        i += 1
    if any(AWK_WRITE.search(p) for p in programs):
        refuse("the awk program writes into a file or a pipe, or runs a command")


def check_find(args: list[str], root: Path) -> None:
    for i, a in enumerate(args):
        if a == "-delete" or a.startswith("-fprint") or a == "-fls":
            refuse(f"`find {a}` deletes or writes files")
        if a in ("-exec", "-execdir", "-ok", "-okdir"):
            command = []
            for word in args[i + 1:]:
                if word in (";", "+"):
                    break
                command.append(word)
            if not command:
                refuse(f"`find {a}` names no command")
            try:
                check_command(command, root)
            except Refused as inner:
                refuse(f"`find {a}` runs a refused command: {inner}")


# --- project tooling --------------------------------------------------------


def check_git(args: list[str], root: Path) -> None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        a = args[i]
        if a == "-c" or a.startswith("--config-env"):
            refuse("`git -c` can set a pager, an editor or an alias; use `--no-pager` instead")
        if a.startswith("--exec-path"):
            refuse("`git --exec-path` changes which programs git runs")
        i += 2 if a in ("-C", "--git-dir", "--work-tree", "--namespace") else 1
    if i >= len(args):
        return
    sub, rest = args[i], args[i + 1:]
    if any(a.startswith("--output") for a in rest):
        refuse("`--output` writes the result to a file")
    ops = [a for a in rest if not a.startswith("-")]
    if sub in GIT_READERS:
        if sub == "grep" and any(a.startswith(("-O", "--open-files-in-pager")) for a in rest):
            refuse("`git grep -O` opens a program on the matches")
        return
    if sub == "branch":
        writes = GIT_BRANCH_WRITES.intersection(rest) or any(a.startswith("--set-upstream-to") for a in rest)
        if not writes and (not ops or "-l" in rest or "--list" in rest):
            return
    elif sub == "tag":
        if not GIT_TAG_WRITES.intersection(rest) and (not ops or "-l" in rest or "--list" in rest):
            return
    elif sub == "stash":
        if rest[:1] in (["list"], ["show"]):
            return
    elif sub == "remote":
        if not rest or set(rest) <= {"-v", "--verbose"} or rest[0] == "get-url":
            return
    elif sub == "config":
        reads = rest[:1] in (["get"], ["list"]) or any(
            a.startswith("--get") or a in ("--list", "-l") for a in rest)
        if reads and not any(a.startswith(GIT_CONFIG_WRITES) for a in rest):
            return
    elif sub == "worktree":
        if rest[:1] == ["list"]:
            return
    elif sub == "reflog":
        if not rest or rest[0] == "show" or rest[0].startswith("-"):
            return
    refuse(f"`git {sub}` is not a read-only git command")


def check_npm(args: list[str], root: Path) -> None:
    if not args or args[0] in ("--version", "-v"):
        return
    sub, rest = args[0], args[1:]
    if sub in NPM_READERS:
        return
    if sub == "audit" and "fix" not in rest:
        return
    if sub in ("run", "run-script"):
        if not rest or rest[0] in READ_SCRIPTS:
            return
        refuse(f"`npm run {rest[0]}` is not a read-only script")
    refuse(f"`npm {sub}` changes the installed packages or the project")


def check_pytest(args: list[str], root: Path) -> None:
    writers = ("--basetemp", "--junitxml", "--junit-xml", "--report-log", "--result-log", "--pastebin")
    if any(a.startswith(writers) for a in args):
        refuse("that pytest option writes or deletes files outside the usual caches")
    for i, a in enumerate(args):
        kind = a.split("=", 1)[1] if a.startswith("--cov-report=") else (
            args[i + 1] if a == "--cov-report" and i + 1 < len(args) else None)
        if kind is not None and kind.split(":", 1)[0] not in ("term", "term-missing"):
            refuse(f"`--cov-report={kind}` writes a report file")


def check_python(args: list[str], root: Path) -> None:
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--version", "-V"):
            return
        if a == "-":
            refuse("Python reading its program from stdin cannot be checked")
        if a == "-m":
            module = args[i + 1] if i + 1 < len(args) else ""
            if module == "pytest":
                return check_pytest(args[i + 2:], root)
            if module == "json.tool":
                return None
            refuse(f"`python -m {module}` is not a read-only module")
        if a.startswith("-") and not a.startswith("--"):
            if "c" in a[1:]:
                refuse("`python -c` runs code that cannot be checked")
            if "m" in a[1:]:
                refuse("a module run from a short-option cluster cannot be checked")
            i += 2 if a in ("-W", "-X") else 1
            continue
        if a.startswith("--"):
            i += 1
            continue
        script = normalize(a, root)
        if script not in PY_SCRIPTS:
            refuse(f"`{a}` is not one of the repository's read-only scripts")
        rest = args[i + 1:]
        if script == "scripts/check_docs.py" and "--fix" in rest:
            refuse("`check_docs.py --fix` rewrites documentation; run it without --fix and report the drift")
        if script == "scripts/generate_resume.py" and "--check" not in rest:
            refuse("`generate_resume.py` rewrites the resume unless it is given --check")
        return None
    refuse("Python with no script reads its program from stdin, which cannot be checked")


def check_node(args: list[str], root: Path) -> None:
    inline = ("-e", "--eval", "-p", "--print", "-i", "--interactive", "-r", "--require",
              "--import", "--loader", "--experimental-loader")
    if any(a in inline or a.startswith(tuple(f"{f}=" for f in inline)) for a in args):
        refuse("node running code from the command line, or a preloaded module, cannot be checked")
    if any(a.startswith("--test-reporter-destination") for a in args):
        refuse("`--test-reporter-destination` writes a report file")
    if "--test" in args or "--check" in args or "-c" in args:
        return
    if args and set(args) <= {"--version", "-v"}:
        return
    script = next((a for a in args if not a.startswith("-")), None)
    if script is not None and normalize(script, root) == "scripts/build.mjs":
        return
    refuse("node may run only `--test`, `--check` or scripts/build.mjs here")


def check_ruff(args: list[str], root: Path) -> None:
    if not args or args[0] in ("--version", "-V", "version", "rule", "linter", "config"):
        return
    sub, rest = args[0], args[1:]
    if sub == "check":
        fixes = ("--fix", "--unsafe-fixes", "--add-noqa", "--output-file", "--watch")
        if any(a.startswith(fixes) for a in rest) or "-o" in rest or "-w" in rest:
            refuse("that `ruff check` option rewrites files or writes a report")
        return
    if sub == "format" and ("--check" in rest or "--diff" in rest):
        return
    refuse(f"`ruff {sub}` rewrites files; `ruff check` and `ruff format --check` only read")


def check_alembic(args: list[str], root: Path) -> None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in ("-c", "--config", "-n", "--name", "-x") else 1
    if i >= len(args) or args[i] in ALEMBIC_READERS:
        return
    refuse(f"`alembic {args[i]}` writes a migration or rewrites the version table")


CONDITIONAL = {
    "sort": check_sort, "uniq": check_uniq, "xxd": check_xxd, "rg": check_rg,
    "tree": check_tree, "base64": check_base64, "file": check_file,
    "sed": check_sed, "awk": check_awk, "gawk": check_awk, "find": check_find,
    "git": check_git, "npm": check_npm, "pytest": check_pytest,
    "python": check_python, "python3": check_python, "node": check_node,
    "ruff": check_ruff, "alembic": check_alembic,
}


# --- wrappers and segments --------------------------------------------------


def unwrap(name: str, args: list[str]) -> list[str] | None:
    """The command a wrapper runs, or None when it runs nothing."""
    i = 0
    if name == "command":
        if args[:1] in (["-v"], ["-V"]):
            return None
        return args[1:] if args[:1] == ["-p"] else args
    if name == "env":
        while i < len(args):
            a = args[i]
            if a.startswith(("-S", "--split-string")):
                refuse("`env -S` splits a string into a command that cannot be checked")
            if a in ("-u", "--unset", "-C", "--chdir"):
                i += 2
            elif a.startswith("-") or ASSIGNMENT.fullmatch(a):
                i += 1
            else:
                break
    elif name == "time":
        if any(a in ("-o", "--output") or a.startswith("--output=") for a in args):
            refuse("`time -o` writes a file")
        while i < len(args) and args[i].startswith("-"):
            i += 1
    elif name == "nice":
        while i < len(args) and args[i].startswith("-"):
            i += 2 if args[i] == "-n" else 1
    elif name == "timeout":
        while i < len(args) and args[i].startswith("-"):
            i += 2 if args[i] in ("-s", "--signal", "-k", "--kill-after") else 1
        i += 1  # the duration
    elif name == "xargs":
        while i < len(args) and args[i].startswith("-"):
            i += 2 if args[i] in ("-n", "-L", "-P", "-s", "-I", "-E", "-d", "-a") else 1
    elif name == "exec":
        while i < len(args) and args[i].startswith("-"):
            i += 2 if args[i] == "-a" else 1
    return args[i:] or None


WRAPPERS = {"command", "env", "time", "nice", "nohup", "timeout", "xargs", "exec"}


def check_command(words: list[str], root: Path) -> None:
    head, args = words[0], words[1:]
    if "/" in head and not outside_repo(head, root):
        refuse(f"`{head}` runs a file from the repository directly")
    name = Path(head).name or head
    if name in WRAPPERS:
        inner = unwrap(name, args)
        if inner:
            check_segment(inner, root)
        return
    if name in READERS:
        return
    check = CONDITIONAL.get(name)
    if check is None:
        refuse(f"`{name}` is not on the read-only list")
    check(args, root)


def check_segment(words: list[str], root: Path) -> None:
    i = 0
    while i < len(words) and (words[i] in KEYWORDS or ASSIGNMENT.fullmatch(words[i])):
        i += 1
    words = words[i:]
    if not words or words[0].startswith("#") or words[0] == "for":
        return  # nothing runs: a closing keyword, a comment, a loop header
    check_command(words, root)


def split_redirects(segment: list[str], root: Path) -> list[str]:
    """The segment's words, with every redirection checked and removed."""
    words: list[str] = []
    i = 0
    while i < len(segment):
        tok = segment[i]
        target = segment[i + 1] if i + 1 < len(segment) else ""
        if tok in REDIRECT_OUT:
            if words and words[-1].isdigit():
                words.pop()  # the descriptor in `2>`
            if tok == ">&" and (target.isdigit() or target == "-"):
                i += 2
                continue
            if not outside_repo(target, root):
                refuse(f"it writes `{target}`; a read-only agent may redirect only onto an "
                       "absolute path outside the repository, such as /dev/null or /tmp/…")
            i += 2
            continue
        if tok in REDIRECT_IN:
            if words and words[-1].isdigit():
                words.pop()
            i += 2
            continue
        words.append(tok)
        i += 1
    return words


def refusal(command: str, root: Path) -> str | None:
    """Why the command is refused, or None if it only reads."""
    try:
        if SUBSTITUTION.search(command):
            refuse("command and process substitution (`$(…)`, backticks, `<(…)`, `>(…)`) run a "
                   "command where it cannot be checked; run the inner command on its own")
        stripped = strip_heredocs(command)
        try:
            shlex.split(stripped.replace("\\\n", ""))
        except ValueError:
            refuse("its quoting could not be parsed")
        for segment in segments(tokenize(stripped)):
            check_segment(split_redirects(segment, root), root)
    except Refused as reason:
        return str(reason)
    return None


def frontmatter(text: str) -> dict[str, str | list[str]]:
    """`name` and `disallowedTools` from an agent file's YAML frontmatter.

    Values may be a YAML block list, a flow list or a comma string, which is
    everything the sub-agents docs accept for a tool list.
    """
    if not text.startswith("---"):
        return {}
    fields: dict[str, str | list[str]] = {}
    key = ""
    for line in text.split("---", 2)[1].splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            if isinstance(fields.get(key), list):
                fields[key].append(stripped[2:].strip())
            continue
        if ":" in line and not line[:1].isspace():
            key, value = (part.strip() for part in line.split(":", 1))
            if key == "disallowedTools" or not value:
                fields[key] = [t.strip() for t in value.strip("[]").split(",") if t.strip()]
            else:
                fields[key] = value
    return fields


def read_only_agents(root: Path) -> set[str]:
    names = set()
    for path in sorted((root / ".claude" / "agents").glob("*.md")):
        fields = frontmatter(path.read_text(encoding="utf-8"))
        tools = fields.get("disallowedTools") or []
        if isinstance(tools, list) and READ_ONLY_MARK <= set(tools):
            name = fields.get("name")
            names.add(name if isinstance(name, str) and name else path.stem)
    return names


def die(agent: str, reason: str) -> None:
    print(f"readonly-bash: {agent} is read-only (its disallowedTools remove Write and Edit),",
          file=sys.stderr)
    print(f"so this command was refused: {reason}.", file=sys.stderr)
    print("Read with the Read, Grep and Glob tools, or run a read-only command. If a gate you "
          "were told to run was refused, report that rather than working around it.",
          file=sys.stderr)
    sys.exit(2)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # Like protect-bash-writes.py: never block the main session on a harness change.
    agent = payload.get("agent_type") if isinstance(payload, dict) else None
    if not agent:
        return 0
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    try:
        if agent not in read_only_agents(root):
            return 0
        reason = refusal((payload.get("tool_input") or {}).get("command") or "", root)
    except Exception as exc:
        # Only exit 2 blocks, and a traceback exits 1. A subagent whose
        # definitions cannot be read, or a command the guard trips over, is
        # refused rather than trusted.
        die(agent, f"the guard could not check it ({type(exc).__name__}: {exc})")
    if reason:
        die(agent, reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
