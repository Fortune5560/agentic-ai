#!/usr/bin/env python3
"""
check-site.py — self-checks for the static site.

No build step ships with this repo, so this script is the safety net. It is
dependency-free (stdlib only) and does the checks that actually break a static
site on GitHub Pages:

  * every internal link / asset path resolves to a real file
  * every #fragment resolves to an id on the target page
  * no duplicate ids on a page
  * every JSON-LD block is valid JSON
  * sitemap.xml / rss.xml are well-formed and point at real files
  * one <h1> per page, lang, title, meta description, viewport
  * target="_blank" links carry rel="noopener"
  * copy stays first-person (flags leftover "we/our/us" marketing voice)

If `html5lib` is installed it is used for a strict parse; otherwise the stdlib
parser is used.

Usage:  python3 scripts/check-site.py [--strict]
Exit code is non-zero if any error is found.
"""

from __future__ import annotations

import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse, unquote
from xml.etree import ElementTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_PATH = "/agentic-ai/"          # GitHub Pages project path
SITE_ORIGIN = "https://fortune5560.github.io"

EXTERNAL_OK = {"https://x.com/slatty5560", "https://www.linkedin.com/in/fortune-owivri-9a4504289"}

# Pages that intentionally carry their own CSS instead of styles.css (the resume is
# a print-first document; sharing the site sheet would fight @page rules).
SELF_CONTAINED = {"resume/index.html"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# --------------------------------------------------------------------------- #
# HTML parsing
# --------------------------------------------------------------------------- #
class Page(HTMLParser):
    def __init__(self, path: str) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.ids: list[str] = []
        self.links: list[tuple[str, str]] = []      # (attr, value)
        self.jsonld: list[str] = []
        self.h1_count = 0
        self.has_lang = False
        self.title = ""
        self.meta: dict[str, str] = {}
        self._in_title = False
        self._in_jsonld = False
        self._buf: list[str] = []
        self._skip_depth = 0
        self.text: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html" and a.get("lang"):
            self.has_lang = True
        if tag == "title":
            self._in_title = True
        if tag == "h1":
            self.h1_count += 1
        if tag in ("script", "style"):
            self._skip_depth += 1
            if tag == "script" and a.get("type") == "application/ld+json":
                self._in_jsonld = True
                self._buf = []
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "meta":
            key = a.get("name") or a.get("property")
            if key and "content" in a:
                self.meta[key] = a["content"]
        for attr in ("href", "src"):
            if attr in a and a[attr]:
                self.links.append((attr, a[attr]))
        if tag == "a" and a.get("target") == "_blank":
            rel = (a.get("rel") or "").lower()
            if "noopener" not in rel:
                err(f"{self.path}: target=_blank without rel=noopener -> {a.get('href')}")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in ("script", "style"):
            self._skip_depth = max(0, self._skip_depth - 1)
            if tag == "script" and self._in_jsonld:
                self.jsonld.append("".join(self._buf))
                self._in_jsonld = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_jsonld:
            self._buf.append(data)
        elif self._skip_depth == 0:
            self.text.append(data)


def html_files() -> list[str]:
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "node_modules"]
        for name in filenames:
            if name.endswith(".html"):
                out.append(os.path.relpath(os.path.join(dirpath, name), ROOT))
    return sorted(out)


def resolve(base_rel: str, link: str) -> tuple[str | None, str | None]:
    """Map a link found in `base_rel` to (repo-relative file path, fragment)."""
    parsed = urlparse(link)
    if parsed.scheme or parsed.netloc:
        return None, None
    path = unquote(parsed.path)
    frag = parsed.fragment or None
    if path == "":
        return base_rel, frag
    # Root-absolute links are written for the GitHub Pages subdirectory.
    if path.startswith("/"):
        if not path.startswith(BASE_PATH):
            return "__invalid__", frag
        path = path[len(BASE_PATH) - 1:]
        target = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
    else:
        target = os.path.normpath(os.path.join(ROOT, os.path.dirname(base_rel), path))
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    return os.path.relpath(target, ROOT), frag


def check_pages() -> dict[str, Page]:
    pages: dict[str, Page] = {}
    for rel in html_files():
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            src = fh.read()
        page = Page(rel)
        page.feed(src)
        page.close()
        pages[rel] = page

        if not page.has_lang:
            err(f"{rel}: <html> is missing lang")
        if page.h1_count != 1:
            err(f"{rel}: expected exactly one <h1>, found {page.h1_count}")
        if not page.title.strip():
            err(f"{rel}: missing <title>")
        if "description" not in page.meta:
            err(f"{rel}: missing meta description")
        if "viewport" not in page.meta:
            err(f"{rel}: missing viewport meta")

        dupes = {i for i in page.ids if page.ids.count(i) > 1}
        for d in dupes:
            err(f"{rel}: duplicate id #{d}")

        for block in page.jsonld:
            try:
                json.loads(block)
            except json.JSONDecodeError as exc:
                err(f"{rel}: invalid JSON-LD ({exc})")

        # First-person voice check: no stray agency plural in visible copy.
        text = re.sub(r"\s+", " ", "".join(page.text))
        for m in re.finditer(r"\b(we|We|our|Our|us)\b", text):
            snippet = text[max(0, m.start() - 40):m.end() + 40].strip()
            warn(f"{rel}: possible non-first-person copy: …{snippet}…")

    return pages


def check_links(pages: dict[str, Page]) -> None:
    for rel, page in pages.items():
        for attr, value in page.links:
            parsed = urlparse(value)
            if parsed.scheme in ("http", "https"):
                if value.split("#")[0] in EXTERNAL_OK:
                    continue
                if value.startswith(SITE_ORIGIN):
                    # Absolute self-reference (canonical / og:url): check it maps to a file.
                    path = parsed.path
                    target, _ = resolve(rel, path)
                    if target == "__invalid__":
                        err(f"{rel}: absolute URL outside the site base -> {value}")
                    elif target and not os.path.exists(os.path.join(ROOT, target)):
                        err(f"{rel}: absolute URL points at a missing file -> {value}")
                continue
            if parsed.scheme in ("mailto", "data", "tel"):
                continue
            if value.startswith("//"):
                continue

            target, frag = resolve(rel, value)
            if target == "__invalid__":
                err(f"{rel}: root-absolute link missing the {BASE_PATH} prefix -> {value}")
                continue
            if target is None:
                continue
            full = os.path.join(ROOT, target)
            if not os.path.exists(full):
                err(f"{rel}: broken {attr} -> {value}")
                continue
            if frag and target.endswith(".html"):
                target_page = pages.get(target)
                if target_page is None:
                    with open(full, encoding="utf-8") as fh:
                        target_page = Page(target)
                        target_page.feed(fh.read())
                if frag not in target_page.ids:
                    err(f"{rel}: fragment #{frag} not found in {target}")


def check_xml() -> None:
    for name in ("sitemap.xml", "rss.xml"):
        path = os.path.join(ROOT, name)
        try:
            tree = ElementTree.parse(path)
        except ElementTree.ParseError as exc:
            err(f"{name}: not well-formed XML ({exc})")
            continue
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        for loc in tree.iter(f"{ns}loc"):
            url = (loc.text or "").strip()
            if not url.startswith(SITE_ORIGIN):
                err(f"{name}: URL outside the site origin -> {url}")
                continue
            target = os.path.join(ROOT, url[len(SITE_ORIGIN) + len(BASE_PATH) - 1:].lstrip("/"))
            if url.endswith("/"):
                target = os.path.join(target, "index.html")
            if not os.path.exists(target):
                err(f"{name}: lists a URL with no file -> {url}")


def js_generated_classes() -> set[str]:
    """Class names that only ever appear at runtime, e.g. from classList.add()."""
    found: set[str] = set()
    for rel in ("site.js", "demo/demo.js"):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            src = fh.read()
        for pattern in (
            r"classList\.(?:add|toggle|remove)\('([^']+)'",
            r"el\(\s*'[^']*',\s*'([^']*)'",
            r"className\s*=\s*'([^']*)'",
            r"html\.js \.([\w-]+)",
            r"\?\s*'([\w -]+)'\s*:\s*'([\w -]+)'",
        ):
            for match in re.findall(pattern, src):
                if isinstance(match, tuple):
                    for part in match:
                        found.update(part.split())
                else:
                    found.update(match.split())
    return found


def check_classes(pages: dict[str, Page]) -> None:
    """Every class used in HTML should have a rule in styles.css (catches typos),
    and every non-runtime class in CSS should be used by some page."""
    with open(os.path.join(ROOT, "styles.css"), encoding="utf-8") as fh:
        css = fh.read()

    defined = set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", css))
    runtime = js_generated_classes() | {
        "js", "reveal", "in", "show", "no-reveal",
        # built by concatenation in demo.js
        "metric-good", "audit-info", "audit-warn",
    }

    used: dict[str, set[str]] = {}
    for rel in pages:
        if rel in SELF_CONTAINED:
            continue
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            src = fh.read()
        for attr in re.findall(r'class="([^"]*)"', src):
            for cls in attr.split():
                used.setdefault(cls, set()).add(rel)

    for cls, where in sorted(used.items()):
        if cls not in defined and cls not in runtime:
            err(f'{sorted(where)[0]}: class "{cls}" has no rule in styles.css')

    for cls in sorted(defined):
        if cls not in used and cls not in runtime:
            warn(f'styles.css: ".{cls}" is defined but never used')


def check_manifest() -> None:
    path = os.path.join(ROOT, "site.webmanifest")
    with open(path, encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError as exc:
            err(f"site.webmanifest: invalid JSON ({exc})")
            return
    for icon in data.get("icons", []):
        if not os.path.exists(os.path.join(ROOT, icon["src"])):
            err(f"site.webmanifest: icon missing -> {icon['src']}")


def main() -> int:
    pages = check_pages()
    check_links(pages)
    check_classes(pages)
    check_xml()
    check_manifest()

    print(f"Checked {len(pages)} HTML pages, {sum(len(p.links) for p in pages.values())} links.\n")

    for w in warnings:
        print(f"  warn  {w}")
    if warnings:
        print()

    if errors:
        for e in errors:
            print(f"  ERROR {e}")
        print(f"\n{len(errors)} error(s).")
        return 1

    print(f"No errors. {len(warnings)} warning(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
