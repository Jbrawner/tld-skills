---
name: milestone-sync
description: |
  Author `## Order` sections on existing Linear milestones that don't have them yet.
  Use this skill whenever the user says "milestone-sync", "milestone sync", "sync
  milestones", "repair order sections", "fix order sections", or when /tld-setup
  fails because a milestone's description is missing or has a malformed `## Order`
  section. Writes to Linear milestone descriptions only — does NOT touch
  `.tld/campaign.md`, does NOT create new milestones or tickets. Idempotent:
  re-running skips milestones that already have a valid Order section. For creating
  milestones from scratch use /campaign-plan (full project) or /milestone-create
  (single phase).
---

# Milestone Sync

You are sweeping the configured Linear project for milestones whose descriptions lack a properly formatted `## Order` section, and helping the user author one for each. The `## Order` section is the authoritative ticket sequence that `/tld-setup` reads to pick the next ticket — without it, milestone progression breaks.

This skill writes to Linear milestone descriptions only. It does NOT modify `.tld/campaign.md`. It does NOT create milestones or tickets. It is idempotent: milestones that already have a valid Order section are reported and skipped. For creating milestones from scratch, use /campaign-plan (full project) or /milestone-create (single phase).

## Process

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The tracker, team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.

If the tracker is not `Linear`, stop and output:
  "/milestone-sync writes Linear milestone descriptions directly — it is not adapted to {tracker}. Author Order sections in your tracker manually."

### 2. List milestones

Call `list_milestones` for the configured Linear project, sorted by `sortOrder` ascending.

If the result is empty, stop and output:
  "No milestones in project '{project name}'. Run /campaign-plan or /milestone-create to create one."

### 3. Inspect each milestone

For each milestone in the returned order, call `get_milestone` to read its full description. Classify the description using the canonical Order-section parser algorithm from CONTRIBUTING.md:

1. Find the line matching `^## Order\s*$`.
2. If no such line exists → **Missing Order section** — needs authoring.
3. Otherwise capture every following line until the next `^## ` header or end-of-description.
4. Within that block, scan line-by-line and take the first regex match of `({prefix}-\d+)` (unanchored). `{prefix}` is the ticket prefix from campaign Project — compose the regex from that value; do not hardcode.
5. If zero ticket IDs are parsed from the block → **Malformed Order section** — needs authoring (overwrite the block).
6. If one or more ticket IDs are parsed → **Valid Order section** — skip this milestone.

Record each milestone's classification. Do not write anything yet.

### 4. Collect tickets per milestone needing authoring

For each milestone classified as Missing or Malformed, call `list_issues` filtered to that milestone ID. Capture each ticket's identifier, title, and status.

If a milestone has zero tickets, record it as "no tickets — nothing to order" and skip (no Order section to author).

### 5. Classify the surrounding description

For each milestone needing authoring, check whether the description already contains any of the other five canonical sections (Purpose, Scope, Exit Criteria, Dependencies, Risk):

- **Has other sections** — at least one of {Purpose, Scope, Exit Criteria, Dependencies, Risk} present as a `^## X\s*$` line. Leave them untouched; only add or replace the Order section.
- **Minimal description** — zero of those five sections present. Offer the full six-section template.

### 6. Confirm per milestone

Walk the milestones needing authoring in `sortOrder`. For each one, present its context inline:

```
### Milestone {N}: {name}
Current Order section: {Missing | Malformed}
Surrounding sections: {comma-separated list of ## headings present, or "(none)"}
Tickets ({N}):
  1. {PREFIX-XXX} — {title} ({status})
  2. {PREFIX-YYY} — {title} ({status})
  ...
```

Then AskUserQuestion with three options:

1. **Accept this order** — keep the ticket sequence as listed above.
2. **Reorder** — follow-up free-text prompt: "Paste the tickets in desired order, one ID per line."
3. **Skip this milestone** — leave its description unchanged.

If the user picks **Reorder**, collect the free-text response and validate:
- Every line must contain exactly one `{prefix}-\d+` ID.
- Every submitted ID must match one from the milestone's ticket list (no duplicates, no extras, no missing).
- If validation fails, re-ask once with a concrete error message. If it fails again, treat as Skip for this milestone and record the reason.

If the milestone is classified as **Minimal description** in step 5, ask a follow-up AskUserQuestion:

1. **Full template** — author a complete six-section description (Purpose / Scope / Order / Exit Criteria / Dependencies / Risk) with placeholder text for the five non-Order sections that the user can fill in later.
2. **Order only** — append just the Order section to the existing description.

If the milestone has other sections (not Minimal), default to Order-only mode — do not offer the full template, because it would clobber existing content.

Record the final authoring decision (ticket sequence + mode) for each milestone.

### 7. Write the milestone descriptions

For each milestone with an authoring decision:

**Build the Order block:**

```markdown
## Order
1. {first ticket ID}
2. {second ticket ID}
3. ...
```

**Compose the new description:**

- **Full template mode:** Replace the entire description with:

  ```markdown
  ## Purpose
  _To be filled in._

  ## Scope
  _To be filled in._

  ## Order
  1. {ticket IDs in confirmed sequence}

  ## Exit Criteria
  - All tickets listed in the Order section above are Done or Canceled.

  ## Dependencies
  _Specify dependent milestones or "None"._

  ## Risk
  _Low / Medium / High — one-line rationale._
  ```

- **Order-only mode, Malformed existing Order:** Replace the existing `## Order` block — the line matching `^## Order\s*$` and every following line up to the next `^## ` header (or end-of-description) — with the new Order block. Leave the rest of the description untouched.

- **Order-only mode, Missing Order:** Append the new Order block to the end of the existing description, separated by a blank line. Do not try to insert at the canonical position between Scope and Exit Criteria; the reader-side parser scans for `## Order` regardless of where it appears.

**Call `save_milestone`** with the milestone ID and the composed description.

Write the plain `1. {prefix}-XXX` form. Linear will rewrite each line to `1. [{prefix}-XXX](url)` on save — that is expected, and the reader-side Order-section parser (see CONTRIBUTING.md "Order-section parser") handles both forms.

If `save_milestone` fails for any milestone, record the failure and continue with the next milestone. Do not abort the whole run — partial progress is useful, and the user can re-run /milestone-sync to retry the failures.

### 8. Final output

Report the full sweep in a compact summary:

```
## Milestone sync complete — {project name}

### Summary

| # | Milestone | Result |
|---|-----------|--------|
| 1 | {name} | Already had Order — skipped |
| 2 | {name} | Wrote Order ({N} tickets) |
| 3 | {name} | Wrote full template + Order ({N} tickets) |
| 4 | {name} | No tickets — skipped |
| 5 | {name} | Skipped by user |
| 6 | {name} | Failed — {short error summary} |

**Authored:** {X} milestones
**Skipped:** {Y} milestones (already had Order, no tickets, or user chose skip)
**Failed:** {Z} milestones
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Present options

---

**What's next?**

> **1.** /tld-setup — enter the first ticket of the first milestone (Recommended)
>    Best for: Order sections are populated and you're ready to start implementation

> **2.** /campaign-show — review the project structure before diving in
>    Best for: want to sanity-check milestones + tickets in Linear first

> **3.** /milestone-create — add another milestone you're missing
>    Best for: noticed a phase is missing while reviewing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Do NOT proceed to /tld-setup without the user picking an option. Wait for the user to pick an option or type a command.**
