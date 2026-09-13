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

# Operators that end one simple command and begin the next.
SPLITTERS = {";", "&&", "||", "|", "|&", "&", "\n"}

# Redirections that truncate or append to their operand.
REDIRECTS = {">", ">>", ">|", "&>", "&>>"}

# Utilities whose *last* operand is the destination.
DEST_LAST = {"cp", "mv", "install", "rsync"}

# Utilities that write every operand they are given.
DEST_ALL = {"rm", "unlink", "shred", "truncate"}

# Wrappers to step over before reading the real utility name.
PREFIXES = {"sudo", "env", "nohup", "time", "command", "exec", "xargs", "then",
            "do", "else", "!"}

# Writers whose targets cannot be read off the command line. Their presence
# makes the whole command opaque, and the guards fall back to "was a protected
# path mentioned at all".
OPAQUE = {"python", "python3", "node", "ruby", "awk", "gawk", "patch"}

# `git` subcommands that overwrite tracked files in the working tree.
OPAQUE_GIT = {"apply", "checkout", "restore", "clean", "stash", "reset"}


HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

# Path-ish runs of characters. Used instead of shell tokens wherever a path can
# be buried inside a quoted argument: `python3 -c "open('a/b.py','w')"` is a
# single token to shlex but names a file all the same.
PATHLIKE = re.compile(r"[A-Za-z0-9_.@~/-]+")

# Basenames that are configuration secrets wherever they appear.
SECRET_PREFIX = "." + "env"


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
    """Split a command into words and shell operators, or [] if unparseable."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        return list(lex)
    except ValueError:
        # Unbalanced quotes, an unterminated heredoc. Fall back to raw words so
        # the guards still see the paths rather than silently allowing.
        return re.findall(r"\S+", command)


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
    return Path(segment[i]).name, segment[i + 1:]


def _operands(args: list[str]) -> list[str]:
    return [a for a in args if not a.startswith("-") and "=" not in a.split("/")[0]]


def parse(command: str) -> tuple[set[str], set[str], bool]:
    """Return (write_targets, all_mentioned_paths, opaque).

    `opaque` is True when the command contains a writer whose targets cannot be
    determined from the command line.
    """
    command = strip_heredocs(command)
    tokens = tokenize(command)
    targets: set[str] = set()
    opaque = False
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

        if name in ("sed", "perl") and any(
            a == "--in-place" or (a.startswith("-i") and not a.startswith("--"))
            for a in args
        ):
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
