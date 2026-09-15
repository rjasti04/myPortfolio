#!/usr/bin/env python3
"""Generate every hand-maintained copy of the résumé from one source.

`content/resume.json` is the source of truth. The same biography used to be
typed out in five places, and they had drifted: the chat persona told visitors
the frontend was built with Three.js, which this repository has never used.

This script writes these targets, each between GENERATED markers so the
surrounding hand-written code is never touched:

    frontend/index.html                 JSON-LD @graph, the Experience section,
                                        and its technology tag list
    frontend/js/terminal/registry.js    SKILL_GROUPS and SKILL_TAGS
    frontend/js/search-index.js         the Ctrl+K palette's content index
    server/config/resume_context.py     the Bedrock persona's Key Information

    python scripts/generate_resume.py            # rewrite the targets
    python scripts/generate_resume.py --check    # exit 1 if any is stale

`--check` is what CI runs, so a hand-edit to a generated region fails the
build instead of silently becoming the next drift.

index.html carries `sha256-` CSP hashes over its two executable inline
scripts. None of the regions below is one of those, and the JSON-LD block is a
data block that `check_csp_hashes.py` deliberately skips - but run
`npm run check:csp` anyway after changing this script's HTML output.
"""

from __future__ import annotations

import json
import re
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "content" / "resume.json"

INDEX_HTML = ROOT / "frontend" / "index.html"
REGISTRY_JS = ROOT / "frontend" / "js" / "terminal" / "registry.js"
SEARCH_INDEX_JS = ROOT / "frontend" / "js" / "search-index.js"
RESUME_CONTEXT_PY = ROOT / "server" / "config" / "resume_context.py"

# Entities the hand-written markup used. Kept so the generated output reads the
# same as the rest of the file rather than mixing raw UTF-8 punctuation in.
ENTITIES = {"—": "&mdash;", "–": "&ndash;", "•": "&bull;"}


def esc(text: str) -> str:
    """HTML-escape, then restore the punctuation entities the page already uses."""
    out = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    for char, entity in ENTITIES.items():
        out = out.replace(char, entity)
    return out


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def wrap(text: str, width: int, indent: str) -> list[str]:
    """Wrap one already-escaped string, continuation lines at `indent`.

    Breaking is on whitespace only. A break inside "cross-hyphenated" would
    survive into the rendered page as "cross- hyphenated", because HTML folds
    the newline into a space; and a break inside "&mdash;" would emit the
    entity as literal text.
    """
    return (
        textwrap.wrap(
            text,
            width=width,
            subsequent_indent=indent,
            break_on_hyphens=False,
            break_long_words=False,
        )
        or [""]
    )


# --- region rewriting -------------------------------------------------------

def region(name: str, comment: str) -> tuple[re.Pattern[str], str, str]:
    """The start/end markers for a named region in a given comment syntax."""
    if comment == "html":
        start, end = f"<!-- GENERATED:{name} -->", f"<!-- /GENERATED:{name} -->"
    else:
        start, end = f"/* GENERATED:{name} */", f"/* /GENERATED:{name} */"
    pattern = re.compile(
        re.escape(start) + r"\n.*?\n[ \t]*" + re.escape(end), re.S
    )
    return pattern, start, end


def replace_region(text: str, name: str, comment: str, body: str, indent: str) -> str:
    pattern, start, end = region(name, comment)
    if not pattern.search(text):
        raise SystemExit(
            f"marker '{start}' … '{end}' not found. The generated region was "
            f"removed or renamed; restore the markers before regenerating."
        )
    return pattern.sub(lambda _: f"{start}\n{body}\n{indent}{end}", text, count=1)


# --- builders ---------------------------------------------------------------

def build_jsonld(data: dict) -> str:
    person, site = data["person"], data["site"]
    graph = [
        {
            "@type": "Person",
            "@id": f"{site['url']}#person",
            "name": person["name"],
            "jobTitle": person["jobTitle"],
            "description": person["description"],
            "url": person["url"],
            "image": {
                "@type": "ImageObject",
                "url": person["image"]["url"],
                "width": person["image"]["width"],
                "height": person["image"]["height"],
            },
            "sameAs": person["sameAs"],
        },
        {
            "@type": "WebSite",
            "@id": f"{site['url']}#website",
            "url": site["url"],
            "name": site["name"],
            "description": site["description"],
            "publisher": {"@id": f"{site['url']}#person"},
            "inLanguage": site["inLanguage"],
        },
        {
            "@type": "WebPage",
            "@id": f"{site['url']}#webpage",
            "url": site["url"],
            "name": site["pageName"],
            "description": site["description"],
            "isPartOf": {"@id": f"{site['url']}#website"},
            "about": {"@id": f"{site['url']}#person"},
            "primaryImageOfPage": {
                "@type": "ImageObject",
                "url": site["primaryImage"]["url"],
                "width": site["primaryImage"]["width"],
                "height": site["primaryImage"]["height"],
            },
            "inLanguage": site["inLanguage"],
        },
    ]
    payload = {"@context": "https://schema.org", "@graph": graph}
    body = textwrap.indent(json.dumps(payload, indent=2, ensure_ascii=False), "  ")
    # The markers wrap the whole element, not its contents: an HTML comment
    # inside application/ld+json would be part of the JSON and invalidate it.
    return f'  <script type="application/ld+json">\n{body}\n  </script>'


def build_experience(data: dict) -> str:
    lines: list[str] = []
    pad = " " * 10
    for job in data["experience"]:
        lines += [
            f'{pad}<div class="item-header">',
            f'{pad}  <span class="item-date">{esc(job["dateRange"])}</span>',
            f'{pad}  <span class="item-badge">{esc(job["location"])}</span>',
            f"{pad}</div>",
            f'{pad}<h3>{esc(job["company"])}</h3>',
            f'{pad}<div class="experience-roles">',
        ]
        for role in job["roles"]:
            lines += [
                f'{pad}  <div class="role-entry">',
                f'{pad}    <span class="role-title">{esc(role["title"])}</span>',
                f'{pad}    <span class="role-period">({esc(role["period"])})</span>',
                f"{pad}  </div>",
            ]
        lines.append(f"{pad}</div>")

        for group in job["groups"]:
            anchor = f"exp-{slug(group['heading'])}"
            lines += [
                f'{pad}<h4 class="item-bullets-group" id="{anchor}">{esc(group["heading"])}</h4>',
                f'{pad}<ul class="item-bullets">',
            ]
            for bullet in group["bullets"]:
                wrapped = wrap(f"<li>{esc(bullet)}</li>", 118, f"{pad}    ")
                lines += [f"{pad}  {wrapped[0]}"] + wrapped[1:]
            lines.append(f"{pad}</ul>")
    return "\n".join(lines)


def build_tags(data: dict) -> str:
    lines: list[str] = []
    pad = " " * 10
    lines.append(f'{pad}<dl class="item-tags">')
    for job in data["experience"]:
        for group in job["tagGroups"]:
            lines += [
                f'{pad}  <div class="tag-group">',
                f'{pad}    <dt>{esc(group["label"])}</dt>',
                f"{pad}    <dd>",
            ]
            lines += [f"{pad}      <span>{esc(tag)}</span>" for tag in group["tags"]]
            lines += [f"{pad}    </dd>", f"{pad}  </div>"]
    lines.append(f"{pad}</dl>")
    return "\n".join(lines)


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_skill_groups(data: dict) -> str:
    lines = ["const SKILL_GROUPS = ["]
    for label, body in data["skillGroups"]:
        lines.append(f"  [{js_string(label)}, {js_string(body)}],")
    lines.append("];")
    return "\n".join(lines)


def build_skill_tags(data: dict) -> str:
    """Pack the tags several per line, breaking only between items.

    Wrapping the joined text instead would split inside a quoted string as soon
    as a tag contained a space ("Amazon Bedrock"), which is a syntax error.
    """
    lines = ["const SKILL_TAGS = ["]
    current = "  "
    for tag in data["skillTags"]:
        item = js_string(tag) + ","
        if current.strip() and len(current) + 1 + len(item) > 78:
            lines.append(current.rstrip())
            current = "  "
        current += item + " "
    if current.strip():
        lines.append(current.rstrip())
    lines.append("];")
    return "\n".join(lines)


SECTION_TITLE = re.compile(
    r'<section id="(?P<id>[\w-]+)"[^>]*>\s*'
    r'<h2 class="section-title">(?P<title>.*?)</h2>'
    r"(?:\s*<p>(?P<intro>.*?)</p>)?",
    re.S,
)


def unescape_html(text: str) -> str:
    out = re.sub(r"<[^>]+>", "", text)
    for char, entity in ENTITIES.items():
        out = out.replace(entity, char)
    return re.sub(r"\s+", " ", out.replace("&amp;", "&")).strip()


def build_search_index(data: dict, html: str) -> str:
    """Entries the Ctrl+K palette searches alongside its commands.

    Section titles and intros are read back out of index.html rather than
    duplicated into resume.json: the page owns its own headings, and this keeps
    a new section searchable the moment it is written.
    """
    entries: list[dict] = []

    for match in SECTION_TITLE.finditer(html):
        intro = unescape_html(match.group("intro") or "")
        entries.append(
            {
                "section": match.group("id"),
                "title": unescape_html(match.group("title")),
                "text": intro,
                "kind": "section",
            }
        )

    for job in data["experience"]:
        for group in job["groups"]:
            entries.append(
                {
                    "section": "resume",
                    "anchor": f"exp-{slug(group['heading'])}",
                    "title": group["heading"],
                    "text": " ".join(group["bullets"]),
                    "kind": "experience",
                }
            )
        for group in job["tagGroups"]:
            entries.append(
                {
                    "section": "resume",
                    "title": f"{group['label']} technologies",
                    "text": ", ".join(group["tags"]),
                    "kind": "skills",
                }
            )

    for label, body in data["skillGroups"]:
        entries.append(
            {
                "section": "about",
                "title": label.rstrip(":"),
                "text": body,
                "kind": "skills",
            }
        )

    body = json.dumps(entries, indent=2, ensure_ascii=False)
    return f"export const CONTENT_INDEX = {body};"


def build_resume_context(data: dict) -> str:
    persona = data["persona"]
    lines = [
        '"""Facts about Rajeev Jasti and this site, for the Bedrock chat persona.',
        "",
        "GENERATED by scripts/generate_resume.py from content/resume.json.",
        "Do not edit: `npm run check:resume` fails CI when this drifts from the source.",
        "",
        "This block used to be typed by hand inside bedrock_service.DEFAULT_SYSTEM_PROMPT,",
        "where it went stale - it described a Three.js frontend that this repository has",
        "never contained, and predated the arcade, the predictors and the whole auth tier.",
        '"""',
        "",
        "KEY_INFORMATION = \"\"\"\\",
    ]
    for item in persona["summary"]:
        lines.append(f"- {item}")
    lines.append('"""')
    lines += ["", "ABOUT_THIS_SITE = \"\"\"\\"]
    for item in persona["siteFacts"]:
        lines.append(f"- {item}")
    lines.append('"""')
    return "\n".join(lines) + "\n"


# --- driver -----------------------------------------------------------------

def render(data: dict) -> dict[Path, str]:
    html = INDEX_HTML.read_text(encoding="utf-8")
    html = replace_region(html, "jsonld", "html", build_jsonld(data), "  ")
    html = replace_region(html, "experience", "html", build_experience(data), " " * 10)
    html = replace_region(html, "resume-tags", "html", build_tags(data), " " * 10)

    registry = REGISTRY_JS.read_text(encoding="utf-8")
    registry = replace_region(registry, "skill-groups", "js", build_skill_groups(data), "")
    registry = replace_region(registry, "skill-tags", "js", build_skill_tags(data), "")

    banner = (
        "// GENERATED by scripts/generate_resume.py from content/resume.json.\n"
        "// Do not edit: `npm run check:resume` fails CI when this drifts.\n"
        "//\n"
        "// The Ctrl+K palette renders these alongside the command registry, so a\n"
        "// visitor searching \"Redshift\" or \"Kafka\" lands on the section that says so.\n"
        "// Find-in-page cannot do this job: the router only renders one section at a\n"
        "// time, so the browser never has the other seven in the DOM to search.\n\n"
    )

    return {
        INDEX_HTML: html,
        REGISTRY_JS: registry,
        SEARCH_INDEX_JS: banner + build_search_index(data, html) + "\n",
        RESUME_CONTEXT_PY: build_resume_context(data),
    }


def main(argv: list[str]) -> int:
    check_only = "--check" in argv[1:]
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    rendered = render(data)

    stale: list[str] = []
    for path, content in rendered.items():
        name = path.relative_to(ROOT)
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == content:
            print(f"  ok      {name}")
            continue
        stale.append(str(name))
        if check_only:
            print(f"  STALE   {name}")
        else:
            path.write_text(content, encoding="utf-8")
            print(f"  written {name}")

    if check_only and stale:
        print(
            "\ncheck_resume: "
            + ", ".join(stale)
            + " no longer match content/resume.json.\n"
            "Edit content/resume.json, then run: npm run generate:resume"
        )
        return 1

    print("\ncheck_resume: every generated copy matches content/resume.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
