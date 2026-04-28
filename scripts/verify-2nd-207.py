#!/usr/bin/env python3
"""Verification checks for 2ND-207: adapter interface documentation.

AC1: docs/ADAPTERS.md exists
AC2: Every Linear MCP call the TLD skills make is documented
AC3: Input parameters and output fields are specified for each call
AC4: Edge cases documented (auto-linking, rate-limiting)
AC6: README and LIMITATIONS link to docs/ADAPTERS.md

Exit 0 = all checks pass. Exit 1 = one or more failures.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ADAPTERS = REPO_ROOT / "docs" / "ADAPTERS.md"
README = REPO_ROOT / "README.md"
LIMITATIONS = REPO_ROOT / "LIMITATIONS.md"

MCP_CALLS = [
    "list_issues",
    "get_issue",
    "save_issue",
    "list_milestones",
    "get_milestone",
    "save_milestone",
    "list_issue_labels",
    "create_issue_label",
    "list_issue_statuses",
    "list_teams",
    "get_project",
]

PARAM_SIGNALS = ["parameters", "parameter", "params", "input"]
RESPONSE_SIGNALS = ["response", "returns", "output", "fields"]
AUTOLINKING_SIGNALS = ["auto-link", "autolink", "auto_link", "auto link", "rewrite"]
RATE_LIMIT_SIGNALS = ["rate-limit", "rate_limit", "rate limit"]

passes: list[str] = []
failures: list[str] = []


def check(desc: str, condition: bool) -> None:
    if condition:
        passes.append(f"PASS: {desc}")
    else:
        failures.append(f"FAIL: {desc}")


# AC1 — file exists
check("docs/ADAPTERS.md exists", ADAPTERS.exists())

if ADAPTERS.exists():
    text = ADAPTERS.read_text(encoding="utf-8").lower()

    # AC2 — all 11 MCP calls documented
    for call in MCP_CALLS:
        check(f"'{call}' is documented in ADAPTERS.md", call.lower() in text)

    # AC3 — input parameters and output fields specified
    has_params = any(sig in text for sig in PARAM_SIGNALS)
    has_response = any(sig in text for sig in RESPONSE_SIGNALS)
    check("ADAPTERS.md specifies input parameters for calls", has_params)
    check("ADAPTERS.md specifies response/output fields for calls", has_response)

    # AC4 — edge cases
    has_autolinking = any(sig in text for sig in AUTOLINKING_SIGNALS)
    has_rate_limit = any(sig in text for sig in RATE_LIMIT_SIGNALS)
    check("Auto-linking edge case documented in ADAPTERS.md", has_autolinking)
    check("Rate-limiting edge case documented in ADAPTERS.md", has_rate_limit)

else:
    for call in MCP_CALLS:
        check(f"'{call}' is documented in ADAPTERS.md", False)
    check("ADAPTERS.md specifies input parameters for calls", False)
    check("ADAPTERS.md specifies response/output fields for calls", False)
    check("Auto-linking edge case documented in ADAPTERS.md", False)
    check("Rate-limiting edge case documented in ADAPTERS.md", False)

# AC6 — README and LIMITATIONS link to ADAPTERS.md
readme_text = README.read_text(encoding="utf-8") if README.exists() else ""
limitations_text = LIMITATIONS.read_text(encoding="utf-8") if LIMITATIONS.exists() else ""

check("README.md references ADAPTERS.md", "adapters.md" in readme_text.lower())
check("LIMITATIONS.md references ADAPTERS.md as a link", "adapters.md" in limitations_text.lower())

# Report
print("Adapter interface documentation verification — 2ND-207")
print("=" * 55)
for line in passes:
    print(line)
for line in failures:
    print(line)
print()
print(f"Results: {len(passes)} passed, {len(failures)} failed")

sys.exit(0 if not failures else 1)
