---
name: campaign-plan
description: |
  Full planning flow — walk scope → phases (milestones) → tickets, and create everything in
  Linear with properly formatted `## Order` sections. Use this skill whenever the user says
  "campaign-plan", "campaign plan", "plan the project", "new project from scratch", "scaffold
  the tracker", or needs to set up a Linear project end to end. Writes to Linear only — does
  NOT touch `.tld/campaign.md`. For a single milestone without the full flow, use
  /milestone-create. For existing milestones missing Order sections, use /milestone-sync.
---

# Campaign Plan

You are walking the user through project planning end to end: project scope → phases → per-phase tickets. At the end, Linear has a fully structured project: milestones with six-section descriptions (Purpose / Scope / Order / Exit Criteria / Dependencies / Risk), each with its tickets assigned and its `## Order` section populated with the final ticket IDs.

This skill writes to Linear only. It does NOT modify `.tld/campaign.md`. The campaign file has no Milestones or Active section — all structure lives in the tracker.

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
  "/campaign-plan writes Linear structure directly — it is not adapted to {tracker}. Create milestones and tickets in your tracker manually, then use /milestone-sync to author Order sections."

### 2. Collect project scope

Use AskUserQuestion with a single free-text prompt: "Describe the project scope in one paragraph — what's being built, the problem it solves, and any hard constraints that shape the plan."

Require non-empty; re-ask if the user submits an empty response. Store the scope; you will use it as grounding context when drafting phases and tickets, and you will echo it back in the final summary.

### 3. Collect the phase list

AskUserQuestion: "List the phases (milestones) this project will move through, in execution order. One per line — each phase should be a coherent unit of work that ends in a shippable or verifiable state. Aim for 3–8 phases."

Parse the response into an ordered list of phase names (split on newline, trim, drop blanks). Require at least one phase; re-ask if empty. Preserve the order the user gave.

### 4. For each phase, collect details

Walk the phases in order. For each one, ask three AskUserQuestion prompts:

1. **Brief description** — "What does the `{phase name}` phase cover? One paragraph: its purpose and what's in and out of scope. This becomes the milestone's Purpose + Scope."
2. **Risk** — enum with options `Low`, `Medium`, `High`. Hint: "Low = additive / docs / isolated. Medium = hot-path changes or shared utilities. High = architectural / pattern-setting / load-bearing for later phases."
3. **Ticket ideas** — "List the tickets that belong to this phase, in the order they should be worked. One per line; each line is a draft title."

Parse ticket ideas into an ordered list (split on newline, trim, drop blanks). Require at least one ticket per phase; re-ask if empty.

Do NOT write to Linear yet. Collect every phase's data first, then create in steps 6–8. Collecting everything up front lets you abort cleanly if the user cancels partway through without leaving a half-created Linear structure.

### 5. Collect label defaults

AskUserQuestion with two options:

1. **Default every ticket to `model:sonnet` + `effort:medium`** — fastest; you can re-label individual tickets in Linear later.
2. **Set `model:*` and `effort:*` per ticket** — slower; asks per ticket as they're created in step 7.

Record the choice.

### 6. Create milestones (first pass — placeholder Order)

Walk the phases in order. For each phase, call `save_milestone` with:

- `project`: the project name from campaign Project
- `name`: the phase name from step 3
- `description`: the six-section template below, filled in from step 4 answers, with the Order section as a literal placeholder line

Template:

```markdown
## Purpose
{first sentence of brief description, or whole description if ≤ 2 sentences}

## Scope
{brief description from step 4}

## Order
_To be populated after tickets are created._

## Exit Criteria
- All tickets listed in the Order section above are Done or Canceled.

## Dependencies
{previous phase name, or "None — this is the starting milestone."}

## Risk
{Low / Medium / High from step 4} — {one-line rationale inferred from the brief description}
```

Capture the returned milestone ID for each phase. You need it both to assign tickets in step 7 and to rewrite the description in step 8. Store phase→milestone-ID mapping locally for the rest of the run.

If any `save_milestone` call fails, stop and report which milestones were created before the failure so the user can decide whether to retry from the failed milestone or clean up and restart.

### 7. Create tickets per phase

Walk the phases in order. For each phase, walk its ticket list in order. For each ticket title:

1. **Draft the ticket description.** Keep it short — one-paragraph summary that grounds the title, plus a "Files to Create/Modify" section as `TBD` if unknown, plus a bulleted AC placeholder (`- [ ] TBD — refine before /tld-setup`). The user refines later (via Linear UI or /tld-ticket edits). This skill does not try to deeply spec each ticket.
2. **Pick labels.**
   - Default mode (step 5 option 1): apply `model:sonnet` + `effort:medium`.
   - Per-ticket mode (step 5 option 2): AskUserQuestion twice for this ticket — model (`sonnet` / `opus` / `haiku`) and effort (`low` / `medium` / `high`). Apply the picked `model:*` + `effort:*` labels.
3. **Create the ticket.** Call `save_issue` with:
   - `title`: the draft title
   - `description`: the drafted description
   - `team`: the team from campaign Project
   - `project`: the project name from campaign Project
   - `milestone`: the milestone ID from step 6 for this phase
   - `labels`: `[model:*, effort:*]` from step 2
4. **Capture the returned ticket identifier** (`PREFIX-XXX`). You will use it to build the Order section in step 8.

After all tickets for a phase are created, you have an ordered list of ticket identifiers for that phase.

If a `save_issue` call fails with a label-not-found error (e.g., the workspace is missing `model:sonnet` or `effort:medium`), stop and output:

> Label application failed: one of the required `model:*` / `effort:*` labels is not present in the workspace. This shouldn't happen if `/campaign-init` has been run. Re-run `/campaign-init` to restore the label set, then retry this skill.

For any other `save_issue` failure, stop and report which tickets in which phases were created before the failure. Do not attempt to recover automatically — the user may want to inspect Linear before retrying.

### 8. Update each milestone's Order section

For each phase in order:

1. Build the Order block:

   ```markdown
   ## Order
   1. {first ticket ID}
   2. {second ticket ID}
   3. ...
   ```

2. Compose the new milestone description by replacing the placeholder `## Order` block from step 6 with the populated block. Leave the other five sections (Purpose / Scope / Exit Criteria / Dependencies / Risk) unchanged.
3. Call `save_milestone` with the milestone ID from step 6 and the new description.

Write the plain `1. PREFIX-XXX` form. Linear will rewrite each line to `1. [PREFIX-XXX](url)` on save — that is expected, and the reader-side Order-section parser handles both forms. See CONTRIBUTING.md "Order-section parser" for the algorithm reader skills use.

### 9. Final output

Report to the user in this shape:

```
## Campaign plan complete — {project name}

**Scope:** {one-line echo of the scope paragraph, truncated to ~120 chars}

### Milestones created ({N})
1. {M1 name} — {X} tickets — Risk: {level}
2. {M2 name} — {Y} tickets — Risk: {level}
...

### Tickets created ({M} total)
All assigned to their milestones with `model:*` + `effort:*` labels applied.
Labels mode: {default-all | per-ticket}
First ticket: {PREFIX-XXX} in {M1 name}

### Next
Run /tld-setup to enter the first ticket. Each milestone's Order section is populated, so /tld-setup will pick up `{first ticket ID}` automatically.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 10. Present options

---

**What's next?**

> **1.** /tld-setup — enter the first ticket (Recommended)
>    Best for: ready to start implementation on the first milestone's first ticket

> **2.** /campaign-show — review the full structure you just created
>    Best for: want to sanity-check milestones + tickets in Linear before diving in

> **3.** /milestone-create — add another milestone you didn't plan upfront
>    Best for: realized during planning that you need one more phase

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Do NOT proceed to /tld-setup without the user picking an option. Wait for the user to pick an option or type a command.**
