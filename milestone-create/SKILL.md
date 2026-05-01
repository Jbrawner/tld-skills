---
name: milestone-create
description: |
  Create a single Linear milestone with an optional set of tickets and a populated
  `## Order` section. Use this skill whenever the user says "milestone-create",
  "milestone create", "add a milestone", "new milestone", "one more phase", or wants
  to scaffold one milestone without the full /campaign-plan flow. Writes to Linear
  only — does NOT touch `.tld/campaign.md`. For full project planning from scratch
  use /campaign-plan. For repairing Order sections on existing milestones use
  /milestone-sync.
---

# Milestone Create

You are creating ONE Linear milestone and (optionally) its tickets. At the end, Linear has a new milestone with a six-section description (Purpose / Scope / Order / Exit Criteria / Dependencies / Risk), plus any ticket ideas the user provided, each assigned to the milestone with `model:*` + `effort:*` labels. The milestone's `## Order` section is populated with the final ticket IDs in the sequence the user gave.

This skill writes to Linear only. It does NOT modify `.tld/campaign.md`. The campaign file has no Milestones or Active section — all structure lives in the tracker. If you need the full project-planning flow (scope → many phases → tickets), use /campaign-plan instead.

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
  "/milestone-create writes Linear structure directly — it is not adapted to {tracker}. Create the milestone in your tracker manually, then use /milestone-sync to author its Order section."

### 2. Collect milestone name + description

Call AskUserQuestion twice (separate questions in one tool call is fine):

1. **Name** — free text: "What is the name of the milestone? Typical shape: `M3: Planning Skills` or `Phase 2 — Payments`."
2. **Description** — free text: "One paragraph: what this milestone covers, why it exists, and what's in and out of scope. This becomes the milestone's Purpose + Scope."

Require non-empty responses; re-ask if either is empty.

### 3. Collect risk + optional target date

AskUserQuestion:

1. **Risk** — enum: `Low`, `Medium`, `High`. Hint: "Low = additive / docs / isolated. Medium = hot-path or shared utilities. High = architectural / pattern-setting / load-bearing for later work."
2. **Target date** — free text, optional: "Target completion date in ISO format (e.g., `2026-05-15`), or leave blank."

If the target date response is blank, record `null`. If it is non-blank but not a valid ISO date, re-ask once; if still invalid, record `null` and note it in the summary.

### 4. Collect ticket ideas (skippable)

AskUserQuestion with two options:

1. **Add tickets now** — "List the tickets for this milestone, in execution order. One per line; each line is a draft title."
2. **Skip — add tickets later via /tld-ticket** — the milestone is created with an empty Order section; the user can populate it later.

If the user picks option 1, collect the ticket list. Parse into an ordered list (split on newline, trim, drop blanks). Require at least one ticket; re-ask if empty. Preserve the order the user gave.

If the user picks option 2, skip to step 6. The milestone's `## Order` section will read `_No tickets yet. Add with /tld-ticket._` and no tickets will be created.

### 5. Collect label defaults (only if tickets were provided)

AskUserQuestion with two options:

1. **Default every ticket to `model:sonnet` + `effort:medium`** — fastest; you can re-label individual tickets in Linear later.
2. **Set `model:*` and `effort:*` per ticket** — slower; asks per ticket as they're created in step 7.

Record the choice.

### 6. Create the milestone (first pass — placeholder Order)

Call `save_milestone` with:

- `project`: the project name from campaign Project
- `name`: the milestone name from step 2
- `description`: the six-section template below, filled in from steps 2–3, with the Order section as either a literal placeholder (if tickets will be created) or the empty-state line (if tickets were skipped)
- `targetDate`: the ISO date from step 3, or omit if `null`

Template (tickets mode — Order will be rewritten in step 8):

```markdown
## Purpose
{first sentence of description, or whole description if ≤ 2 sentences}

## Scope
{description from step 2}

## Order
_To be populated after tickets are created._

## Exit Criteria
- All tickets listed in the Order section above are Done or Canceled.

## Dependencies
_Specify dependent milestones or "None" after creation._

## Risk
{Low / Medium / High from step 3} — {one-line rationale inferred from the description}
```

Template (skip mode — no tickets, Order stays empty):

```markdown
## Purpose
{first sentence of description, or whole description if ≤ 2 sentences}

## Scope
{description from step 2}

## Order
_No tickets yet. Add with /tld-ticket._

## Exit Criteria
- All tickets listed in the Order section above are Done or Canceled.

## Dependencies
_Specify dependent milestones or "None" after creation._

## Risk
{Low / Medium / High from step 3} — {one-line rationale inferred from the description}
```

Capture the returned milestone ID. You need it both to assign tickets in step 7 and to rewrite the description in step 8.

If `save_milestone` fails, stop and report the failure. No partial state to clean up — nothing else was written yet.

**If the user picked skip mode in step 4, jump straight to step 9.** Steps 7 and 8 apply only when tickets were collected.

### 7. Create tickets per the list

Walk the ticket list in order. For each ticket title:

1. **Draft the ticket description.** Keep it short — one-paragraph summary that grounds the title, plus a "Files to Create/Modify" section as `TBD` if unknown, plus a bulleted AC placeholder (`- [ ] TBD — refine before /tld-setup`). The user refines later (via Linear UI or /tld-ticket edits). This skill does not try to deeply spec each ticket.
2. **Pick labels.**
   - Default mode (step 5 option 1): apply `model:sonnet` + `effort:medium`.
   - Per-ticket mode (step 5 option 2): AskUserQuestion twice for this ticket — model (`sonnet` / `opus` / `haiku`) and effort (`low` / `medium` / `high`). Apply the picked `model:*` + `effort:*` labels.
3. **Create the ticket.** Call `save_issue` with:
   - `title`: the draft title
   - `description`: the drafted description
   - `team`: the team from campaign Project
   - `project`: the project name from campaign Project
   - `milestone`: the milestone ID from step 6
   - `labels`: `[model:*, effort:*]` from step 2
4. **Capture the returned ticket identifier** (`{prefix}-XXX`). You will use it to build the Order section in step 8.

If a `save_issue` call fails with a label-not-found error (e.g., the workspace is missing `model:sonnet` or `effort:medium`), stop and output:

> Label application failed: one of the required `model:*` / `effort:*` labels is not present in the workspace. This shouldn't happen if `/campaign-init` has been run. Re-run `/campaign-init` to restore the label set, then retry this skill.

For any other `save_issue` failure, stop and report which tickets were created before the failure. Do not attempt to recover automatically — the user may want to inspect Linear before retrying. The milestone itself was already created; tickets created before the failure are already attached.

After the loop, you have an ordered list of ticket identifiers for this milestone.

### 8. Update the milestone's Order section

Build the Order block:

```markdown
## Order
1. {first ticket ID}
2. {second ticket ID}
3. ...
```

Compose the new milestone description by replacing the placeholder `## Order` block from step 6 with the populated block. Leave the other five sections (Purpose / Scope / Exit Criteria / Dependencies / Risk) unchanged.

Call `save_milestone` with the milestone ID from step 6 and the new description.

Write the plain `1. {prefix}-XXX` form. Linear will rewrite each line to `1. [{prefix}-XXX](url)` on save — that is expected, and the reader-side Order-section parser handles both forms. See STANDARDS.md "Order-section parser" for the algorithm reader skills use.

### 9. Final output

Report to the user in this shape:

```
## Milestone created — {milestone name}

**Project:** {project name}
**Target date:** {date or "—"}
**Risk:** {level}

### Purpose
{one-line echo of the description, truncated to ~120 chars}

### Tickets created ({N})
1. {PREFIX-XXX} — {title}
2. {PREFIX-YYY} — {title}
...

Labels mode: {default-all | per-ticket | n/a — no tickets}
Order section: {populated with N tickets | empty — add via /tld-ticket}

### Next
{if tickets present} Run /tld-setup to pick up {first ticket ID} in this milestone.
{if no tickets} Add tickets with /tld-ticket, then /tld-setup to pick one up.
```

⚠️ Linear places new milestones at the bottom of the project. If this milestone should appear elsewhere in the order, drag it into position in the Linear UI now (Linear API does not support `sortOrder` writes). See LIMITATIONS.md.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 10. Present options

---

**What's next?**

> **1.** /tld-setup — enter the first ticket in this milestone (Recommended)
>    Best for: this milestone is the one to start on and has tickets populated

> **2.** /tld-ticket — add tickets to this milestone
>    Best for: you skipped tickets in step 4, or want to add more

> **3.** /milestone-create — add another milestone
>    Best for: need one more phase scaffolded

> **4.** /campaign-show — review what's in the project now
>    Best for: want to sanity-check milestones + tickets in Linear before diving in

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Do NOT proceed to /tld-setup without the user picking an option. Wait for the user to pick an option or type a command.**
