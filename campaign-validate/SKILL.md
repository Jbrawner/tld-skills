---
name: campaign-validate
description: |
  Schema-only validator for this repo's `.tld/campaign.md`. Checks the four-section structure
  and required fields without reaching out to Linear or any other external system. Use this
  skill whenever the user says "campaign-validate", "campaign validate", "validate schema",
  "check the campaign file offline", or wants to confirm the local config parses correctly
  without paying for a Linear round-trip. Read-only — never writes to disk, never modifies
  Linear. For the connectivity check (team / project / labels reachable in Linear), use
  /campaign-test instead.
---

# Campaign Validate

You are running a schema-only check against this repo's campaign at `{cwd}/.tld/campaign.md`. This skill is the offline counterpart to `/campaign-test`: it validates the same local schema rules but does NOT call Linear, so it works without network access and without an MCP connection.

**This skill is fully read-only.** It never writes to `.tld/campaign.md`, never creates Linear labels, never makes any external call. The only side effect is the report you print to the user.

## When to use this vs `/campaign-test`

- **Use `/campaign-validate`** when you only need to confirm the file parses correctly — e.g., right after `/campaign-edit`, on an offline machine, or to debug a `/tld-setup` failure that complains about a malformed file before any Linear call would fire.
- **Use `/campaign-test`** when you need full connectivity verification — Linear reachability, team / project existence, ticket-prefix match, and the seven required workspace labels. It does everything `/campaign-validate` does AND the network-dependent checks.

If the user is unsure which to run, default to `/campaign-validate` — it's faster, free of network calls, and a clean schema is a prerequisite for `/campaign-test` passing anyway.

## Process

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run `/campaign-init` to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.

### 2. Validate the 4-section schema

Each check is independent — run all of them and report pass / fail for each, even if an earlier check failed. The user wants a complete picture of what's broken, not a fail-fast halt at the first issue.

**Sections present:**
- Section `Project` exists.
- Section `Test Commands` exists.
- Section `Stack` exists.
- Section `Commit format` exists.

**Project block fields:**
- `Issue tracker` is non-empty.
- `Project name` is non-empty.
- `Team` is non-empty.
- `Ticket prefix` is non-empty.

**Commit format fields:**
- `Pattern` is non-empty.

**Tracker advisory:**
- If `Issue tracker` ≠ `Linear`, add an advisory line to the report (not a failure): `⚠️ Tracker is '{tracker}', not Linear. The TLD pipeline calls Linear MCP tools by name and will hard-abort under a non-Linear tracker until a per-tracker adapter ships. See docs/ADAPTERS.md for the surface a future adapter must implement.`

**Optional / informational checks** (do not fail on these; just report current state):
- `Stack.Database` — print the configured value if present, or note it is blank.
- `Stack.Changelog path` — print the configured value if present, or note it is blank.
- `Commit format.Co-author` — print the configured value if present, or note it is blank.

### 3. Output

Report a compact pass / fail table grouped by section. Use ✅ for pass, ❌ for fail, ⚠️ for advisory (non-fatal), and ⏭ for skipped / informational.

```
## Campaign validate — {project name from file, or "(missing)"}

### Schema
| Check | Result |
|-------|--------|
| Section: Project | ✅ |
| Section: Test Commands | ✅ |
| Section: Stack | ✅ |
| Section: Commit format | ✅ |
| Project: Issue tracker | ✅ Linear |
| Project: Project name | ✅ {value} |
| Project: Team | ✅ {value} |
| Project: Ticket prefix | ✅ {value} |
| Commit format: Pattern | ✅ {value} |

### Advisories
- {tracker advisory if applicable, else "None"}

### Informational
| Field | Value |
|-------|-------|
| Stack.Database | {value or "(blank)"} |
| Stack.Changelog path | {value or "(blank)"} |
| Commit format.Co-author | {value or "(blank)"} |

**Result: {PASS | FAIL — {N} required check(s) failed}**
```

End with the "What's next?" block.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 4. Present options

---

**What's next?**

> **1.** /campaign-test — full connectivity check against Linear
>    Best for: schema is clean, want to verify Linear team / project / labels are reachable

> **2.** /campaign-edit — fix a specific field
>    Best for: a required check failed and you know what to fix

> **3.** /campaign-show — view the parsed config
>    Best for: want to see the full file rendered before deciding

Type **1**, **2**, or **3** to proceed.

**HARD STOP. Do NOT auto-invoke any other skill.** Wait for the user to choose.
