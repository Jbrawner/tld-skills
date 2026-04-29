#!/usr/bin/env python3
"""Verify README.md satisfies the AC for 2ND-209.

Mechanically checks the testable acceptance criteria for the M6 README full pass:
  1. Required top-level sections present (Philosophy, Install, Getting Started,
     Compatibility, Resources).
  2. Each required section has non-trivial content (>= MIN_SECTION_WORDS words).
  3. Getting Started walks through the per-repo campaign flow
     (mentions /campaign-init, then /campaign-plan or /milestone-sync, then
     /tld-setup, in that order, inside the Getting Started section).
  4. Forbidden references absent globally (/campaign-define, /campaign-switch,
     docs/EXECUTION_PLAYBOOK.md, docs/PLAYBOOK_SCHEMA.md).
  5. All relative markdown links resolve to existing files in the repo.

The "10-minute new-reader" AC is intentionally NOT checked here — that is a
human-judgment item the user verifies during /tld-run-test.

Exit 0 = pass. Exit 1 = fail.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
README = REPO_ROOT / "README.md"

REQUIRED_SECTIONS = [
    "Philosophy",
    "Install",
    "Getting Started",
    "Compatibility",
    "Resources",
]

MIN_SECTION_WORDS = 40

GETTING_STARTED_FLOW = [
    ("/campaign-init", ["/campaign-init"]),
    ("/campaign-plan or /milestone-sync", ["/campaign-plan", "/milestone-sync"]),
    ("/tld-setup", ["/tld-setup"]),
]

FORBIDDEN_REFS = [
    "/campaign-define",
    "/campaign-switch",
    "docs/EXECUTION_PLAYBOOK.md",
    "docs/PLAYBOOK_SCHEMA.md",
]


def split_sections(text: str) -> dict[str, str]:
    """Return {heading_text: body} for every `## ` section in the document."""
    sections: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m and not line.startswith("### "):
            if current is not None:
                sections[current] = "\n".join(buf).strip()
            current = m.group(1).strip()
            buf = []
        else:
            if current is not None:
                buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf).strip()
    return sections


def word_count(s: str) -> int:
    return len(re.findall(r"\b\w+\b", s))


def find_relative_links(text: str) -> list[tuple[str, int]]:
    """Return [(href, line_no)] for markdown links pointing to relative paths."""
    out: list[tuple[str, int]] = []
    link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for i, line in enumerate(text.splitlines(), start=1):
        for m in link_re.finditer(line):
            href = m.group(1).strip()
            if not href:
                continue
            if href.startswith(("http://", "https://", "mailto:", "#")):
                continue
            href = href.split("#", 1)[0].split("?", 1)[0]
            if not href:
                continue
            out.append((href, i))
    return out


def main() -> int:
    if not README.exists():
        print(f"FAIL: {README} not found")
        return 1

    text = README.read_text(encoding="utf-8")
    sections = split_sections(text)

    failures: list[str] = []

    # AC: Required sections present.
    missing_sections = [s for s in REQUIRED_SECTIONS if s not in sections]
    if missing_sections:
        failures.append(
            f"missing required ## sections: {', '.join(missing_sections)}"
        )

    # AC: Each required section has non-trivial content.
    for s in REQUIRED_SECTIONS:
        if s not in sections:
            continue
        wc = word_count(sections[s])
        if wc < MIN_SECTION_WORDS:
            failures.append(
                f"section '## {s}' has only {wc} words "
                f"(minimum {MIN_SECTION_WORDS})"
            )

    # AC: Getting Started walks through the per-repo campaign flow in order.
    gs = sections.get("Getting Started", "")
    if gs:
        last_pos = -1
        last_label = "<start>"
        for label, alts in GETTING_STARTED_FLOW:
            positions = [gs.find(a) for a in alts if gs.find(a) != -1]
            if not positions:
                failures.append(
                    f"Getting Started missing step: {label}"
                )
                last_pos = -1
                break
            pos = min(positions)
            if pos < last_pos:
                failures.append(
                    f"Getting Started flow out of order: "
                    f"'{label}' appears before '{last_label}'"
                )
            last_pos = pos
            last_label = label

    # AC: Forbidden references absent globally.
    for ref in FORBIDDEN_REFS:
        if ref in text:
            for i, line in enumerate(text.splitlines(), start=1):
                if ref in line:
                    failures.append(
                        f"forbidden reference '{ref}' at README.md:{i}"
                    )
                    break

    # AC: All relative markdown links resolve.
    for href, line_no in find_relative_links(text):
        target = (REPO_ROOT / href).resolve()
        try:
            target.relative_to(REPO_ROOT)
        except ValueError:
            failures.append(
                f"link escapes repo root at README.md:{line_no}: {href}"
            )
            continue
        if not target.exists():
            failures.append(
                f"broken link at README.md:{line_no}: {href} "
                f"(resolved to {target.relative_to(REPO_ROOT)})"
            )

    print("README verification (2ND-209)")
    print("=" * 50)
    if failures:
        print(f"FAIL: {len(failures)} issue(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS: README satisfies all mechanically-checkable AC items")
    print("NOTE: '10-minute new-reader' AC is human-verified, not checked here.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
