"""Shared Bash-command parsing for the hooks in this directory.

Claude Code matches hooks on tool name, so the `Write|Edit` guards here never
see a change made with `sed -i`, a heredoc or a shell redirection. Auto mode
routes edits through Bash by default, which left migration immutability, the
ADR-016 egress allowlist and the CSP-hash gate enforced on one write path and
unenforced on the other. These helpers pull the write targets out of a Bash
command so the same guards can cover it.

Full shell parsing is not attempted and is not the goal. The parser is
deliberately over-inclusive: a target it reports may not really be written, and
the cost of that is one blocked command carrying a message that says what to do
instead. The cost of the opposite error is an invariant that silently does not
hold.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

# Operators that end one simple command and begin the next. `(` and `)` are
# here because a subshell's first word is a command: without them `(sed -i …)`
# read as a command named `(`, and the `sed -i` inside was never seen.
SPLITTERS = {";", ";;", ";&", ";;&", "&&", "||", "|", "|&", "&", "\n", "(", ")"}

# What the lexer splits on. `\n` is in it so that a line break ends a command
# the way `;` does. shlex's default lexes a newline as whitespace, which merged
# every later line into the first line's segment: `cd x`, a newline, then
# `sed -i … <migration>` passed every guard, although the same `sed -i` on one
# line was refused.
PUNCTUATION = "();<>|&\n"

# The operators a run of punctuation can hold, longest first. shlex returns a
# glued run such as `);` or `)&&` as one token, which split nothing.
OPERATOR = re.compile(r"\n|;;&|;;|;&|;|&&|\|\||\|&|\||&>>|&>|>>|>\||>&|<>|<<<|<<|<&|>|<|&|\(|\)")

# Redirections that truncate or append to their operand.
REDIRECTS = {">", ">>", ">|", "&>", "&>>"}

# Utilities whose *last* operand is the destination.
DEST_LAST = {"cp", "mv", "install", "rsync"}

# Utilities that write every operand they are given.
DEST_ALL = {"rm", "unlink", "shred", "truncate"}

# Wrappers and shell keywords to step over before reading the real utility name.
# `if`, `while` and `{` were missing, so `if sed -i …; then` read as a command
# named `if`.
PREFIXES = {"sudo", "env", "nohup", "time", "command", "exec", "xargs", "then",
            "do", "else", "!", "if", "elif", "while", "until", "{"}

# Writers whose targets cannot be read off the command line. Their presence
# makes the whole command opaque, and the guards fall back to "was a protected
# path mentioned at all". The shells and `eval` run their argument as a whole
# new command, which is as unreadable as a Python one-liner: `bash -c "sed -i …"`
# rewrote a tracked migration with every guard passing it.
OPAQUE = {"python", "python3", "node", "ruby", "awk", "gawk", "patch",
          "bash", "sh", "zsh", "dash", "ksh", "eval", "source", "."}

# Command and process substitution run a command inside another one's words,
# where no segment ever sees it. Matched on the raw command, heredoc bodies
# included, because an unquoted heredoc delimiter expands `$(…)` in its body.
SUBSTITUTION = re.compile(r"\$\(|`|<\(|>\(")

# `find` actions that delete, write a file, or run a command per match.
FIND_ACTIONS = {"-delete", "-exec", "-execdir", "-ok", "-okdir",
                "-fprint", "-fprint0", "-fprintf", "-fls"}

# `git` subcommands that overwrite tracked files in the working tree.
OPAQUE_GIT = {"apply", "checkout", "restore", "clean", "stash", "reset"}

# Options that take the rest of their short-option cluster as an argument. An
# `i` before one of them is the in-place flag; after it, the `i` is text.
GLUED_ARG = {"sed": set("efl"), "perl": set("0DFIlmMxeE")}


HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

# Path-ish runs of characters. Used instead of shell tokens wherever a path can
# be buried inside a quoted argument: `python3 -c "open('a/b.py','w')"` is a
# single token to shlex but names a file all the same.
PATHLIKE = re.compile(r"[A-Za-z0-9_.@~/-]+")

# Basenames that are configuration secrets wherever they appear.
SECRET_PREFIX = "." + "env"

# Utilities that only ever read, and whose first operand is a search program
# rather than a path. `grep -n 'Read(./.env)' .claude/settings.json` reads the
# settings file and no secret at all, but the pattern spells one - which made it
# impossible to grep, audit or document the deny list from the shell.
#
# Deliberately excludes sed, awk and perl. Each can write from inside its own
# program text (`awk '{print > "f"}'`, sed's `w` command), which is why awk and
# perl are in OPAQUE, so their scripts stay in the mention set.
SEARCH_ONLY = {"grep", "egrep", "fgrep", "rgrep", "rg"}

# Flags that introduce a pattern as the following argument.
PATTERN_FLAGS = {"-e", "--regexp"}

# Flags whose argument is a *file* of patterns. It is a real path grep opens, so
# it stays in the mention set - and it also means there is no positional pattern
# to skip, exactly like -e.
FILE_FLAGS = {"-f", "--file"}


def _is_operand(arg: str) -> bool:
    return not arg.startswith("-") and "=" not in arg.split("/")[0]


def strip_heredocs(command: str) -> str:
    """Drop heredoc bodies, keeping the command lines around them.

    Without this the text being *written* is parsed as though it were operands,
    and a file whose contents merely mention a secret filename reads as an
    attempt to open one. This guard blocked its own patch that way once.
    """
    src = command.split("\n")
    out: list[str] = []
    i = 0
    while i < len(src):
        out.append(src[i])
        delimiters = [m.group(2) for m in HEREDOC.finditer(src[i])]
        i += 1
        for delimiter in delimiters:
            while i < len(src) and src[i].strip() != delimiter:
                i += 1
            i += 1  # the delimiter line itself
    return "\n".join(out)


def path_candidates(command: str) -> set[str]:
    """Every path-shaped substring of a command, heredoc bodies excluded."""
    return {tok for tok in PATHLIKE.findall(command)
            if "/" in tok or Path(tok).name.startswith(SECRET_PREFIX)}


def tokenize(command: str) -> list[str]:
    """Split a command into words and shell operators.

    Three things differ from shlex's defaults, and each one hid a write:

    - A line break is an operator (see PUNCTUATION).
    - A backslash-newline is a line continuation and is removed first, as the
      shell does. Left in, the escaped newline became a `"\\n"` token, which cut
      `sed -i \\` off from the operands on its next line.
    - shlex's `#` comments are off. shlex reads a comment to the end of its
      line, newline included, so `echo x # note` merged the next line into its
      segment. With comments off, a comment's words are ordinary arguments,
      and a comment line is a segment whose utility starts with `#`, which no
      rule names.
    """
    command = command.replace("\\\n", "")
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)
        lex.whitespace = " \t\r"
        lex.whitespace_split = True
        lex.commenters = ""
        raw = list(lex)
    except ValueError:
        # Unbalanced quotes, an unterminated heredoc. Fall back to raw words so
        # the guards still see the paths rather than silently allowing, and
        # keep the line breaks so the segments are still right.
        raw = [tok for line in command.split("\n")
               for tok in (*re.findall(r"\S+", line), "\n")]
    out: list[str] = []
    for tok in raw:
        if tok and all(c in PUNCTUATION for c in tok):
            out.extend(OPERATOR.findall(tok))
        else:
            out.append(tok)
    return out


def segments(tokens: list[str]) -> list[list[str]]:
    out: list[list[str]] = [[]]
    for tok in tokens:
        if tok in SPLITTERS:
            out.append([])
        else:
            out[-1].append(tok)
    return [s for s in out if s]


def _utility(segment: list[str]) -> tuple[str, list[str]]:
    """Utility name and its operands, stepping over env assignments/wrappers."""
    i = 0
    while i < len(segment):
        tok = segment[i]
        if tok in PREFIXES or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", tok):
            i += 1
            continue
        break
    if i >= len(segment):
        return "", []
    # `Path(".").name` is "", which read as "no utility" and dropped `. x.sh`.
    return Path(segment[i]).name or segment[i], segment[i + 1:]


def _operands(args: list[str]) -> list[str]:
    return [a for a in args if _is_operand(a)]


def _in_place(name: str, args: list[str]) -> bool:
    """`--in-place`, or an `i` anywhere in a short-option cluster.

    Testing `startswith("-i")` missed the clusters people actually type:
    `perl -pi -e …` is perl's own in-place idiom, and `sed -ni` or `sed -Ei`
    edit in place as surely as `sed -i`.
    """
    for a in args:
        if a == "--in-place" or a.startswith("--in-place="):
            return True
        if a.startswith("-") and not a.startswith("--"):
            for ch in a[1:]:
                if ch == "i":
                    return True
                if ch in GLUED_ARG[name]:
                    break
    return False


def _split_search_patterns(tokens: list[str]) -> tuple[set[str], set[str]]:
    """Return (paths named only inside a search pattern, paths named elsewhere).

    Position decides, not text. `grep .env f && cat .env` names the secret in a
    pattern *and* as a real operand, and the second one still counts - which is
    why the two sets are collected separately and the caller subtracts only what
    appears nowhere but a pattern.
    """
    in_pattern: set[str] = set()
    elsewhere: set[str] = set()

    for segment in segments(tokens):
        clean = [t for t in segment if t not in REDIRECTS]
        name, args = _utility(clean)

        pattern_idx: set[int] = set()
        if name in SEARCH_ONLY:
            explicit = False
            for i, arg in enumerate(args):
                short = arg.startswith("-") and not arg.startswith("--")
                if arg in PATTERN_FLAGS or arg.startswith("--regexp="):
                    explicit = True
                    if arg in PATTERN_FLAGS and i + 1 < len(args):
                        pattern_idx.add(i + 1)
                    elif arg.startswith("--regexp="):
                        pattern_idx.add(i)
                elif arg in FILE_FLAGS or arg.startswith("--file="):
                    # -f names a pattern file: a real path, left in the mention
                    # set, but it still means there is no positional pattern.
                    explicit = True
                elif short and ("e" in arg[1:] or "f" in arg[1:]):
                    # A short-flag cluster such as -ne or -nf takes the pattern
                    # (or pattern file) as its own argument, so again there is no
                    # positional one. Treating the cluster as opaque here is the
                    # conservative side: the pattern stays in the mention set.
                    explicit = True
            # Otherwise grep's first operand is the pattern and every operand
            # after it is a file to read.
            if not explicit:
                for i, arg in enumerate(args):
                    if _is_operand(arg):
                        pattern_idx.add(i)
                        break

        # The utility token itself, and any wrapper stepped over to reach it.
        for tok in clean[: len(clean) - len(args)]:
            elsewhere |= path_candidates(tok)
        for i, arg in enumerate(args):
            if i in pattern_idx:
                in_pattern |= path_candidates(arg)
            else:
                elsewhere |= path_candidates(arg)

    return in_pattern, elsewhere


def parse(command: str) -> tuple[set[str], set[str], bool]:
    """Return (write_targets, all_mentioned_paths, opaque).

    `opaque` is True when the command contains a writer whose targets cannot be
    determined from the command line.
    """
    opaque = bool(SUBSTITUTION.search(command))
    command = strip_heredocs(command)
    tokens = tokenize(command)
    targets: set[str] = set()
    mentioned = path_candidates(command)

    # Safety net for what the tokenizer can miss: `>file` with no space, `2>>f`,
    # and anything inside a heredoc body that made shlex give up.
    for m in re.finditer(r"(?:^|[\s;&|])\d?>{1,2}\s*([^\s;|&<>()]+)", command):
        targets.add(m.group(1))

    for segment in segments(tokens):
        # Redirections are positional and exact, so reading them off never makes
        # a command opaque. Pull them out before looking for the utility.
        clean: list[str] = []
        skip = False
        for i, tok in enumerate(segment):
            if skip:
                skip = False
                continue
            if tok in REDIRECTS:
                if i + 1 < len(segment):
                    targets.add(segment[i + 1])
                    skip = True
                continue
            clean.append(tok)

        name, args = _utility(clean)
        if not name:
            continue
        operands = _operands(args)

        # `xargs` runs its utility on words read from stdin, so its operands
        # are not on the command line at all: `… | xargs rm` named nothing.
        if "xargs" in clean[: len(clean) - len(args) - 1]:
            opaque = True
        if name == "find" and FIND_ACTIONS.intersection(args):
            opaque = True

        if name in ("sed", "perl") and _in_place(name, args):
            # sed's script is the first operand unless it was given with -e/-f.
            script_given = any(a.startswith(("-e", "-f")) for a in args)
            targets.update(operands if script_given else operands[1:])
        elif name == "tee":
            targets.update(operands)
        elif name in DEST_LAST and operands:
            targets.add(operands[-1])
        elif name in DEST_ALL:
            targets.update(operands)
        elif name == "dd":
            targets.update(a.split("=", 1)[1] for a in args if a.startswith("of="))
        elif name == "git" and args and args[0] in OPAQUE_GIT:
            opaque = True
        elif name in OPAQUE:
            opaque = True

    # Drop path-shaped text that exists only as a read-only search pattern. The
    # mention-level check stays otherwise untouched: it is the right conservative
    # default when a shell command cannot be fully parsed, and argument position
    # is unambiguous only for the utilities in SEARCH_ONLY.
    in_pattern, elsewhere = _split_search_patterns(tokens)
    mentioned -= in_pattern - elsewhere

    return {t for t in targets if t}, mentioned | targets, opaque


def normalize(token: str, root: Path) -> str | None:
    """Repo-relative POSIX path for a command token, or None if outside."""
    token = token.strip().strip("'\"")
    if not token or token.startswith("-"):
        return None
    p = Path(token)
    try:
        p = (root / p).resolve() if not p.is_absolute() else p.resolve()
        return p.relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return None


def expand(rel: str, root: Path) -> list[str]:
    """Glob a repo-relative token, or return it unchanged when it is literal."""
    if not any(c in rel for c in "*?["):
        return [rel]
    try:
        return sorted(p.relative_to(root).as_posix() for p in root.glob(rel))
    except (ValueError, OSError):
        return []
