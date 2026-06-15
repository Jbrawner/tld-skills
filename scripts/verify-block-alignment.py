#!/usr/bin/env python3
"""Verify canonical-block embeds across SKILL.md files match STANDARDS.md.

For each canonical block in STANDARDS.md, this script:
  1. Extracts the canonical body.
  2. Walks every */SKILL.md in the repo.
  3. If a file embeds the block (detected by a unique fingerprint substring),
     verifies the canonical body appears verbatim (byte-for-byte) in that file.

Also enforces:
  - No SKILL.md contains the OLD header `**Step completion check:**` or
    `### Step completion check`.
  - No SKILL.md contains the old playbook-step language strings
    (`docs/EXECUTION_PLAYBOOK.md`, `playbook step`, `step tickets`) inside a
    file that embeds the milestone-completion-check block.

Exit 0 = aligned. Exit 1 = drift detected.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STANDARDS = REPO_ROOT / "STANDARDS.md"

# (canonical_heading, fingerprint_for_detecting_embed)
# Fingerprint must be a substring distinctive enough to identify the block but
# invariant enough to also appear in already-drifted embeds (otherwise drift
# evades detection). The block heading text itself is usually the safest pick.
BLOCKS: list[tuple[str, str]] = [
    ("Numbered shortcut recognition", "### Numbered shortcut recognition"),
    ("Milestone completion check", "### Milestone completion check"),
    ("Recommendation hint", "**Default:** mark `/tld-partial-auto` as Recommended."),
    ("Manual-QA classification (setup-time)", "Manual-QA classification (setup-time)"),
    ("Manual-QA classification (verify-time)", "Manual-QA classification (verify-time)"),
    ("Approval keyword set", "### Approval keyword set"),
    (
        "Load project config",
        "If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output",
    ),
    (
        "Tracker resolution",
        "is not supported by the TLD skills. Supported: Linear, Jira.",
    ),
    (
        "Resolve next ticket (discovery)",
        "Auto-discover by walking milestones:",
    ),
    (
        "Require current ticket (strict)",
        "No In-Progress ticket found. Run /tld-setup to pick one up.\"",
    ),
    (
        "Require current ticket (strict, cancel variant)",
        "Run /tld-setup to pick one up, or pass a specific ticket ID to cancel.",
    ),
    (
        "Local DB safety check",
        "local-DB safety check",
    ),
    (
        "Flow selection (TLD vs NPC)",
        "**Classify the ticket as TLD or NPC before rendering the options block.**",
    ),
    (
        "Author Order block",
        "reader-side Order-section parser handles both forms",
    ),
    (
        "Required workspace labels",
        "| `model:sonnet` | `#5E6AD2` |",
    ),
]

BANNED_GLOBAL = [
    "**Step completion check:**",
    "### Step completion check",
]

BANNED_IN_MILESTONE_CHECK_CONTEXT = [
    "docs/EXECUTION_PLAYBOOK.md",
    "playbook step",
    "step tickets",
]

MILESTONE_CHECK_FINGERPRINT = "Milestone completion check"


def extract_canonical_body(text: str, heading: str) -> str:
    """Pull the body of a canonical block from STANDARDS.md.

    Heading lines may be `### {heading}` or `### Canonical paste-block: {heading}`.
    Body runs from the first non-blank line after the heading until the next
    `### `, `## `, `---`, or EOF. If the body is wrapped in a code fence
    (``` or ````), the fence lines are stripped so embed-comparison works
    against the raw text.
    """
    lines = text.splitlines()
    head_re = re.compile(
        rf"^### (?:Canonical paste-block: )?{re.escape(heading)}\s*$"
    )
    start = None
    for i, line in enumerate(lines):
        if head_re.match(line):
            start = i + 1
            break
    if start is None:
        sys.exit(f"FATAL: canonical heading not found in STANDARDS.md: {heading}")

    end = len(lines)
    in_fence: str | None = None
    fence_re = re.compile(r"^(`{3,})[A-Za-z0-9_+\-]*\s*$")
    for j in range(start, len(lines)):
        L = lines[j]
        m = fence_re.match(L)
        if m:
            tick = m.group(1)
            if in_fence is None:
                in_fence = tick
            elif L.strip() == in_fence:
                in_fence = None
            continue
        if in_fence is not None:
            continue
        if L.startswith("### ") or L.startswith("## ") or L.strip() == "---":
            end = j
            break

    body_lines = lines[start:end]

    # Strip a leading "**When to use:**" preamble paragraph if present.
    # STANDARDS.md headings may include a "When to use:" framing paragraph
    # that explains who the block is for. Embeds in skills do not include it,
    # so it must be excluded from the canonical body for byte-identical comparison.
    if body_lines:
        # Skip leading blank lines.
        i = 0
        while i < len(body_lines) and not body_lines[i].strip():
            i += 1
        if i < len(body_lines) and body_lines[i].lstrip().startswith("**When to use:**"):
            # Advance past the preamble paragraph (until next blank line).
            j = i + 1
            while j < len(body_lines) and body_lines[j].strip():
                j += 1
            body_lines = body_lines[j:]

    # Paste-blocks in STANDARDS.md wrap the canonical text in a code fence
    # (``` or ````), sometimes preceded by a prose preamble. When a fence is
    # present, the fence's interior IS the canonical body — the preamble is
    # just framing and must be excluded. Embeds include only the interior.
    fence_start = fence_end = None
    fence_marker: str | None = None
    for i, L in enumerate(body_lines):
        m = re.match(r"^(`{3,})\s*$", L)
        if m:
            if fence_start is None:
                fence_start = i
                fence_marker = m.group(1)
            elif L.startswith(fence_marker):
                fence_end = i
                break
    if fence_start is not None and fence_end is not None:
        body_lines = body_lines[fence_start + 1 : fence_end]

    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    while body_lines and not body_lines[-1].strip():
        body_lines.pop()

    return "\n".join(body_lines).strip()


def main() -> int:
    if not STANDARDS.exists():
        sys.exit(f"FATAL: {STANDARDS} not found")

    contrib_text = STANDARDS.read_text(encoding="utf-8")
    canonical = {h: extract_canonical_body(contrib_text, h) for h, _ in BLOCKS}

    skill_files = sorted(REPO_ROOT.glob("*/SKILL.md"))
    if not skill_files:
        sys.exit("FATAL: no SKILL.md files found at repo root")

    summary: list[str] = []
    drift_failures: list[str] = []

    for heading, fingerprint in BLOCKS:
        body = canonical[heading]
        embeds = 0
        diffs = 0
        for sf in skill_files:
            text = sf.read_text(encoding="utf-8")
            if fingerprint not in text:
                continue
            embeds += 1
            if body not in text:
                diffs += 1
                drift_failures.append(
                    f"DRIFT: {sf.relative_to(REPO_ROOT)} :: '{heading}' embed differs from canonical"
                )
        summary.append(f"  {heading}: {embeds} embeds, {diffs} drifted")

    banned_failures: list[str] = []
    for sf in skill_files:
        text = sf.read_text(encoding="utf-8")
        rel = sf.relative_to(REPO_ROOT)
        for banned in BANNED_GLOBAL:
            if banned in text:
                banned_failures.append(
                    f"BANNED HEADER: {rel} contains '{banned}'"
                )
        if MILESTONE_CHECK_FINGERPRINT in text:
            for banned in BANNED_IN_MILESTONE_CHECK_CONTEXT:
                if banned in text:
                    banned_failures.append(
                        f"BANNED LANGUAGE: {rel} contains '{banned}' "
                        "(old playbook-step language inside milestone-check context)"
                    )

    print("Canonical block alignment verification")
    print("=" * 50)
    print(
        f"  ({len(skill_files)} SKILL.md files scanned. "
        "tld-next is the legitimate exception for 'Numbered shortcut "
        "recognition' — it uses its own per-option block by design "
        "per STANDARDS.md, so a count of N-1 is expected.)"
    )
    print()
    for line in summary:
        print(line)
    print()
    if drift_failures:
        print("DRIFT FAILURES:")
        for f in drift_failures:
            print(f"  {f}")
        print()
    if banned_failures:
        print("BANNED-STRING FAILURES:")
        for f in banned_failures:
            print(f"  {f}")
        print()
    if drift_failures or banned_failures:
        print(
            f"FAIL: {len(drift_failures)} drift(s), "
            f"{len(banned_failures)} banned string(s)"
        )
        return 1
    print("PASS: every embedded copy is byte-identical to STANDARDS.md canonical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
