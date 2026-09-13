#!/usr/bin/env python3
"""Verify the mechanically-derivable numbers in the docs still match the repo.

The prose in `docs/` is maintained by hand and stays accurate. The *numbers*
embedded in it do not: line counts, grep yields and token estimates decay
silently every time a file grows, and nothing fails when they do. A stale
figure is worse than a missing one, because the whole point of the navigation
table is that an agent budgets against it. Every entry it checks
was wrong by 14-39% when this script was written, all in the direction that
makes an agent under-budget and blow its context.

Checks:

  1. rules/navigation.md     - line counts and token estimates for the six
     files agents are told never to read whole.
  2. rules/navigation.md     - the advertised grep hit counts actually match
     what the commands return.
  3. rules/reference-docs.md - per-doc token estimates and heading counts,
     plus the two totals stated in the prose above it.
  4. JAVASCRIPT.md               - every documented module exists, every shipped
     module is documented, and the per-module line counts are right.
  5. TESTING.md                  - every test file is listed with its real length.

Exits non-zero listing each drifted figure and the value it should be.

    python scripts/check_docs.py [--fix] [--show-tokens]

`--fix` rewrites the numbers in place rather than just reporting them.
`--show-tokens` displays current document token estimates.
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Token estimate divisors. Code and markup tokenise denser than prose because
# punctuation and identifiers split more; these are the divisors
# .claude/rules/navigation.md documents, and the rounding runs up so a figure is
# never an under-estimate.
DIV_CODE = 3.7
DIV_PROSE = 4.0
ROUND_TO = 500

# Where JAVASCRIPT.md's `### `name.js`` headings resolve to on disk.
JS_ROOTS = ["frontend/js/", "frontend/js/terminal/", "frontend/js/arcade/", "frontend/js/cron/", "frontend/js/crypto/", "frontend/"]
TEST_ROOTS = ["frontend/tests/", "scripts/tests/"]

# Modules JAVASCRIPT.md deliberately does not cover as ES modules of the SPA.
JS_EXCLUDED = {
    "frontend/sw.js",  # service worker - documented in FRONTEND.md instead
}


def tokens(path: Path, divisor: float) -> int:
    # Measure bytes under normalized LF line endings so figures agree across
    # platforms regardless of git autocrlf checkout settings.
    size = len(path.read_bytes().replace(b"\r\n", b"\n"))
    return math.ceil(size / divisor / ROUND_TO) * ROUND_TO


def lines(path: Path) -> int:
    with path.open(encoding="utf-8", errors="replace") as fh:
        return sum(1 for _ in fh)


def grep_count(pattern: str, path: str, extended: bool = False) -> int:
    """Hit count for one of the recipes .claude/rules/navigation.md advertises."""
    file_path = ROOT / path
    if not file_path.exists():
        return 0
    if shutil.which("grep"):
        cmd = ["grep", "-cE" if extended else "-c", pattern, str(file_path)]
        out = subprocess.run(cmd, capture_output=True, text=True)
        return int(out.stdout.strip() or 0)
    regex = re.compile(pattern)
    with file_path.open(encoding="utf-8", errors="replace") as fh:
        return sum(1 for line in fh if regex.search(line))


def resolve(name: str, roots: list[str]) -> Path | None:
    for root in roots:
        candidate = ROOT / root / name
        if candidate.exists():
            return candidate
    return None


class Report:
    def __init__(self) -> None:
        self.problems: list[str] = []
        self.edits: dict[Path, list[tuple[str, str]]] = {}

    def drift(self, where: str, what: str, found: str, expected: str) -> None:
        self.problems.append(f"{where}: {what} says {found}, should be {expected}")

    def missing(self, where: str, what: str) -> None:
        self.problems.append(f"{where}: {what}")

    def edit(self, path: Path, old: str, new: str) -> None:
        self.edits.setdefault(path, []).append((old, new))


def check_nav_table(text: str, rep: Report, src: Path) -> None:
    """The 'never read these end-to-end' table in .claude/rules/navigation.md."""
    where = src.relative_to(ROOT).as_posix()
    rows = re.findall(
        r"^\| `([\w./-]+)` \| ([\d,]+) \| ~([\d,]+) \|", text, re.M
    )
    if len(rows) < 6:
        rep.missing(where, f"navigation table has {len(rows)} rows, expected 6")
    for name, claimed_lines, claimed_tokens in rows:
        path = ROOT / name
        if not path.exists():
            rep.missing(where, f"navigation table lists missing file {name}")
            continue
        actual_lines = lines(path)
        actual_tokens = tokens(path, DIV_CODE)
        lines_drifted = int(claimed_lines.replace(",", "")) != actual_lines
        tokens_drifted = int(claimed_tokens.replace(",", "")) != actual_tokens
        if lines_drifted:
            rep.drift(where, f"{name} lines", claimed_lines, f"{actual_lines:,}")
        if tokens_drifted:
            rep.drift(where, f"{name} tokens", f"~{claimed_tokens}", f"~{actual_tokens:,}")

        # One edit for the whole row rather than one per figure. Both are cut
        # from the row as it reads NOW, and the token edit has to name the line
        # count to place itself - so when both drift, the line edit lands first
        # and leaves the token edit anchored on a number that is no longer
        # there. It then matched nothing, silently, and --fix had to be run
        # twice to settle a file whose row moved in both columns.
        if lines_drifted or tokens_drifted:
            rep.edit(src,
                     f"| `{name}` | {claimed_lines} | ~{claimed_tokens} |",
                     f"| `{name}` | {actual_lines:,} | ~{actual_tokens:,} |")


def check_grep_recipes(text: str, rep: Report, src: Path) -> None:
    """The hit counts the navigation table promises for its grep recipes."""
    where = src.relative_to(ROOT).as_posix()
    recipes = [
        (r"#region", "frontend/styles.css", False, r"returns a (\d+)-entry map"),
        (r"<section id=", "frontend/index.html", False, r"for the (\d+)-section map"),
        (r"^\s{2,6}(async )?function \w+", "frontend/js/chat.js", True,
         r"chat\.js` \((\d+) hits\)"),
        (r"^\s{2,6}(async )?function \w+", "frontend/js/auth-ui.js", True,
         r"auth-ui\.js` \((\d+) hits\)"),
    ]
    for pattern, path, extended, claim_re in recipes:
        m = re.search(claim_re, text)
        if not m:
            rep.missing(where, f"no advertised hit count for the {path} recipe")
            continue
        actual = grep_count(pattern, path, extended)
        if int(m.group(1)) != actual:
            rep.drift(where, f"{path} recipe yield", m.group(1), str(actual))
            rep.edit(src, m.group(0), m.group(0).replace(m.group(1), str(actual), 1))


def check_reference_table(text: str, rep: Report, src: Path) -> None:
    """Per-doc token estimates and heading counts in the reference table."""
    where = src.relative_to(ROOT).as_posix()
    for name, claimed in re.findall(r"^\| `((?:docs/)?[A-Z]+\.md)` \| ~([\d,]+) \|", text, re.M):
        path = ROOT / name
        if not path.exists():
            rep.missing(where, f"reference table lists missing doc {name}")
            continue
        actual = tokens(path, DIV_PROSE)
        if int(claimed.replace(",", "")) != actual:
            rep.drift(where, f"{name} tokens", f"~{claimed}", f"~{actual:,}")
            rep.edit(src,
                     f"| `{name}` | ~{claimed} |", f"| `{name}` | ~{actual:,} |")

    # The count must match whatever the row's own recipe would return: some rows
    # advertise `grep -n '^## '`, others `^### `, others both levels. Counting a
    # different set than the command prints is its own kind of wrong number.
    for name, recipe, claimed, kind in re.findall(
        r"^\| `(docs/[A-Z]+\.md)` \|.*?\| `grep -n '(\^[^']+)'[^|]*?\((\d+) "
        r"(headings|module sections|endpoint sections)\)", text, re.M
    ):
        path = ROOT / name
        if not path.exists():
            continue
        body = path.read_text(encoding="utf-8")
        if recipe.startswith("^#\\{2,3\\}"):
            actual = len(re.findall(r"^#{2,3} ", body, re.M))
        elif recipe.startswith("^###"):
            actual = len(re.findall(r"^### ", body, re.M))
        elif recipe.startswith("^##"):
            actual = len(re.findall(r"^## ", body, re.M))
        else:
            continue
        if int(claimed) != actual:
            rep.drift(where, f"{name} {kind}", claimed, str(actual))
            rep.edit(src, f"({claimed} {kind})", f"({actual} {kind})")


def check_derived_prose(text: str, rep: Report, src: Path) -> None:
    """The two totals stated in prose above the reference table.

    They are sums of the table below them, so they drift whenever any doc grows
    - and unlike a table cell, a number buried in a sentence is easy to skim
    past while updating everything around it.
    """
    where = src.relative_to(ROOT).as_posix()
    docs = sorted((ROOT / "docs").glob("*.md"))
    total = sum(tokens(p, DIV_PROSE) for p in docs)
    m = re.search(r"Together they are ~([\d,]+)\ntokens", text)
    if m and int(m.group(1).replace(",", "")) != total:
        rep.drift(where, "docs/ token total", f"~{m.group(1)}", f"~{total:,}")
        rep.edit(src, f"Together they are ~{m.group(1)}", f"Together they are ~{total:,}")

    js = tokens(ROOT / "docs/JAVASCRIPT.md", DIV_PROSE)
    m = re.search(r"That turns a ([\d,]+)-token read", text)
    if m and int(m.group(1).replace(",", "")) != js:
        rep.drift(where, "JAVASCRIPT.md read-cost example", m.group(1), f"{js:,}")
        rep.edit(src, f"That turns a {m.group(1)}-token read",
                 f"That turns a {js:,}-token read")


def check_javascript_doc(rep: Report) -> None:
    """Module coverage and per-module line counts in JAVASCRIPT.md."""
    path = ROOT / "docs/JAVASCRIPT.md"
    text = path.read_text(encoding="utf-8")

    documented: set[str] = set()
    for name, claimed in re.findall(r"^### .*?`([\w./-]+\.js)` \(([\d,]+) lines", text, re.M):
        documented.add(name)
        target = resolve(name, JS_ROOTS)
        if target is None:
            rep.missing("JAVASCRIPT.md", f"documents {name}, which does not exist")
            continue
        actual = lines(target)
        if int(claimed.replace(",", "")) != actual:
            rep.drift("JAVASCRIPT.md", f"{name} lines", claimed, f"{actual:,}")
            rep.edit(path, f"`{name}` ({claimed} lines", f"`{name}` ({actual:,} lines")

    shipped = {
        p for p in ROOT.glob("frontend/**/*.js")
        if "vendor" not in p.parts and "tests" not in p.parts
    }
    for p in sorted(shipped):
        rel = p.relative_to(ROOT).as_posix()
        if rel in JS_EXCLUDED:
            continue
        if p.name not in documented:
            rep.missing("JAVASCRIPT.md", f"no section for shipped module {rel}")


def check_testing_doc(rep: Report) -> None:
    """Every JS test file listed, with its real length."""
    path = ROOT / "docs/TESTING.md"
    text = path.read_text(encoding="utf-8")

    listed: set[str] = set()
    for name, claimed in re.findall(r"\| `([\w.-]+\.test\.js)` \| (\d+) \|", text):
        listed.add(name)
        target = resolve(name, TEST_ROOTS)
        if target is None:
            rep.missing("TESTING.md", f"lists {name}, which does not exist")
            continue
        actual = lines(target)
        if int(claimed) != actual:
            rep.drift("TESTING.md", f"{name} lines", claimed, str(actual))
            rep.edit(path, f"| `{name}` | {claimed} |", f"| `{name}` | {actual} |")

    for root in TEST_ROOTS:
        for p in sorted((ROOT / root).glob("*.test.js")):
            if p.name not in listed:
                rep.missing("TESTING.md", f"no row for test file {root}{p.name}")


def display_token_usage() -> None:
    """Print the document token budget table."""
    print("\nDocument Token Usage (PROSE divisor: 4.0, rounded to 500):")
    print(f"  {'Document':<30} {'Tokens':>10}")
    print(f"  {'-'*30} {'-'*10}")
    docs = sorted((ROOT / "docs").glob("*.md"))
    doc_total = 0
    for doc in docs:
        t = tokens(doc, DIV_PROSE)
        doc_total += t
        rel = doc.relative_to(ROOT).as_posix()
        formatted_tok = f"~{t:,}"
        print(f"  {rel:<30} {formatted_tok:>10}")
    for standalone in ["AGENTS.md", "README.md",
                       ".claude/rules/navigation.md",
                       ".claude/rules/reference-docs.md"]:
        p = ROOT / standalone
        if p.exists():
            t = tokens(p, DIV_PROSE)
            formatted_tok = f"~{t:,}"
            print(f"  {standalone:<30} {formatted_tok:>10}")
    print(f"  {'-'*30} {'-'*10}")
    formatted_total = f"~{doc_total:,}"
    print(f"  {'Total (docs/*.md)':<30} {formatted_total:>10}")

    print("\nMonitored Code & Assets (CODE divisor: 3.7, rounded to 500):")
    print(f"  {'File':<30} {'Lines':>10} {'Tokens':>10}")
    print(f"  {'-'*30} {'-'*10} {'-'*10}")
    nav_files = [
        "frontend/styles.css",
        "package-lock.json",
        "frontend/index.html",
        "frontend/js/chat.js",
        "frontend/js/auth-ui.js",
        "frontend/three-bg.js",
    ]
    for rel in nav_files:
        p = ROOT / rel
        if p.exists():
            t = tokens(p, DIV_CODE)
            line_count = lines(p)
            formatted_tok = f"~{t:,}"
            print(f"  {rel:<30} {line_count:>10,} {formatted_tok:>10}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true",
                        help="rewrite drifted numbers in place")
    parser.add_argument("--show-tokens", action="store_true",
                        help="display current document token estimates")
    args = parser.parse_args()

    nav_src = ROOT / ".claude/rules/navigation.md"
    ref_src = ROOT / ".claude/rules/reference-docs.md"
    nav = nav_src.read_text(encoding="utf-8")
    ref = ref_src.read_text(encoding="utf-8")
    rep = Report()
    check_nav_table(nav, rep, nav_src)
    check_grep_recipes(nav, rep, nav_src)
    check_reference_table(ref, rep, ref_src)
    check_derived_prose(ref, rep, ref_src)
    check_javascript_doc(rep)
    check_testing_doc(rep)

    if not rep.problems:
        print("check_docs: all documented figures match the repository")
        if args.show_tokens:
            display_token_usage()
        return 0

    if args.fix and rep.edits:
        # Counted as they land, not as they were queued. An edit whose anchor
        # has already been rewritten by an earlier one matches nothing, and
        # reporting that as a rewrite is how a drifted number reaches CI
        # believing it was fixed.
        applied = 0
        stuck: list[str] = []
        for path, pairs in rep.edits.items():
            body = path.read_text(encoding="utf-8")
            for old, new in pairs:
                if old not in body:
                    stuck.append(f"{path.name}: nothing matching `{old}` left to rewrite")
                    continue
                body = body.replace(old, new, 1)
                applied += 1
            path.write_text(body, encoding="utf-8")
        print(f"check_docs: rewrote {applied} figure(s); re-run to confirm")
        unfixable = [p for p in rep.problems if " says " not in p] + stuck
        for problem in unfixable:
            print(f"  still open: {problem}")
        if args.show_tokens:
            display_token_usage()
        return 1 if unfixable else 0

    print(f"check_docs: {len(rep.problems)} documented figure(s) no longer match the repo\n")
    for problem in rep.problems:
        print(f"  {problem}")
    if args.show_tokens:
        display_token_usage()
    print("\nRun `python scripts/check_docs.py --fix` to update the counts,")
    print("then re-read the surrounding prose - a number that moved a long way")
    print("usually means the description above it is stale too.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
