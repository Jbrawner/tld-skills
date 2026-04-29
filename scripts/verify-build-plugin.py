#!/usr/bin/env python3
"""Verify scripts/build-plugin.sh satisfies the AC for 2ND-215.

Mechanically checks every acceptance criterion for the M7 plugin packaging
build script:
  1. scripts/build-plugin.sh exists and is executable.
  2. Running it produces dist/tld-plugin/ with valid plugin layout
     (.claude-plugin/plugin.json + skills/ subdirectory containing every skill
     folder from the repo root).
  3. dist/tld-plugin/.claude-plugin/plugin.json is valid JSON with non-empty
     `name` and `version` fields.
  4. Cross-references in every copied skills/<name>/SKILL.md use the /tld:
     namespace — no bare `/tld-x` or `/campaign-x` slash commands remain.
  5. Script is idempotent — running it twice yields byte-identical output.

Exit 0 = pass. Exit 1 = fail.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-plugin.sh"
DIST_DIR = REPO_ROOT / "dist" / "tld-plugin"

# Directories at the repo root that are NOT skills (they should not appear
# under dist/tld-plugin/skills/).
NON_SKILL_DIRS = {
    ".git",
    ".tld",
    ".claude",
    "dist",
    "docs",
    "scripts",
    "node_modules",
    "__pycache__",
}

# Slash-command references that should NOT remain in copied SKILL.md files
# after the namespace rewrite. Both patterns are the *unrewritten* forms:
#   /tld-x       (should have become /tld:x)
#   /campaign-x  (should have become /tld:campaign-x)
# We allow `/tld:` (the rewritten form) and `/tld:campaign-` (the rewritten
# campaign form) — both contain neither forbidden pattern when scanned with
# the regexes below.
FORBIDDEN_REF_PATTERNS = [
    # /tld- followed by a letter, NOT preceded by a colon (so /tld:setup is OK
    # but /tld-setup is not). Also excludes /tld:campaign- (preceded by `:`).
    (re.compile(r"(?<![:\w])/tld-[a-z]"), "/tld-x reference (should be /tld:x)"),
    # /campaign- not preceded by `:` (so /tld:campaign-init is OK).
    (re.compile(r"(?<![:\w])/campaign-[a-z]"), "/campaign-x reference (should be /tld:campaign-x)"),
]


def discover_skill_dirs() -> list[Path]:
    """Return every directory at repo root that looks like a skill folder."""
    out: list[Path] = []
    for child in sorted(REPO_ROOT.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        if child.name in NON_SKILL_DIRS:
            continue
        if (child / "SKILL.md").exists():
            out.append(child)
    return out


def snapshot_tree(root: Path) -> dict[str, str]:
    """Return {relpath: sha256} for every file under root, sorted by path."""
    snap: dict[str, str] = {}
    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        rel = str(f.relative_to(root))
        snap[rel] = hashlib.sha256(f.read_bytes()).hexdigest()
    return snap


def main() -> int:
    failures: list[str] = []

    # AC 1: build-plugin.sh exists and is executable.
    if not BUILD_SCRIPT.exists():
        print("Build-plugin verification (2ND-215)")
        print("=" * 50)
        print("FAIL: scripts/build-plugin.sh does not exist")
        return 1
    if not (BUILD_SCRIPT.stat().st_mode & 0o111):
        failures.append("scripts/build-plugin.sh is not executable")

    # AC 2 + 5 setup: run the script twice; capture snapshots.
    try:
        subprocess.run(
            [str(BUILD_SCRIPT)],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        print("Build-plugin verification (2ND-215)")
        print("=" * 50)
        print("FAIL: build-plugin.sh exited non-zero on first run")
        print(f"  stdout: {e.stdout}")
        print(f"  stderr: {e.stderr}")
        return 1

    if not DIST_DIR.exists():
        print("Build-plugin verification (2ND-215)")
        print("=" * 50)
        print(f"FAIL: {DIST_DIR.relative_to(REPO_ROOT)} not created by build script")
        return 1

    snap_first = snapshot_tree(DIST_DIR)

    # AC 2: valid plugin layout.
    plugin_json_path = DIST_DIR / ".claude-plugin" / "plugin.json"
    if not plugin_json_path.exists():
        failures.append(".claude-plugin/plugin.json missing from dist/tld-plugin/")

    skills_dir = DIST_DIR / "skills"
    if not skills_dir.exists() or not skills_dir.is_dir():
        failures.append("skills/ subdirectory missing from dist/tld-plugin/")

    # AC 2: every repo-root skill folder is present under dist/tld-plugin/skills/.
    expected_skills = {p.name for p in discover_skill_dirs()}
    if skills_dir.exists():
        copied_skills = {p.name for p in skills_dir.iterdir() if p.is_dir()}
        missing = expected_skills - copied_skills
        if missing:
            failures.append(
                f"skill folders missing from dist/tld-plugin/skills/: "
                f"{', '.join(sorted(missing))}"
            )

    # AC 3: plugin.json is valid JSON with name + version.
    if plugin_json_path.exists():
        try:
            meta = json.loads(plugin_json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            failures.append(f"plugin.json is not valid JSON: {e}")
            meta = None
        if meta is not None:
            for field in ("name", "version"):
                val = meta.get(field)
                if not isinstance(val, str) or not val.strip():
                    failures.append(
                        f"plugin.json field '{field}' missing or empty "
                        f"(got {val!r})"
                    )

    # AC 4: every copied SKILL.md uses /tld: namespace.
    if skills_dir.exists():
        for skill_md in sorted(skills_dir.rglob("SKILL.md")):
            text = skill_md.read_text(encoding="utf-8")
            rel = skill_md.relative_to(DIST_DIR)
            for pattern, label in FORBIDDEN_REF_PATTERNS:
                for m in pattern.finditer(text):
                    line_no = text.count("\n", 0, m.start()) + 1
                    failures.append(
                        f"{rel}:{line_no}: {label}: '{m.group(0)}'"
                    )

    # AC 5: idempotent — second run yields identical output.
    try:
        subprocess.run(
            [str(BUILD_SCRIPT)],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        failures.append(
            f"build-plugin.sh exited non-zero on second run: {e.stderr}"
        )
        snap_second: dict[str, str] = {}
    else:
        snap_second = snapshot_tree(DIST_DIR)

    if snap_first and snap_second and snap_first != snap_second:
        only_first = sorted(set(snap_first) - set(snap_second))
        only_second = sorted(set(snap_second) - set(snap_first))
        changed = sorted(
            p for p in snap_first
            if p in snap_second and snap_first[p] != snap_second[p]
        )
        details = []
        if only_first:
            details.append(f"removed on rerun: {only_first[:5]}")
        if only_second:
            details.append(f"added on rerun: {only_second[:5]}")
        if changed:
            details.append(f"content differs on rerun: {changed[:5]}")
        failures.append(
            "build script is not idempotent; "
            + "; ".join(details)
        )

    print("Build-plugin verification (2ND-215)")
    print("=" * 50)
    if failures:
        print(f"FAIL: {len(failures)} issue(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS: build-plugin.sh satisfies all mechanically-checkable AC items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
