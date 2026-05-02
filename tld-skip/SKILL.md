---
name: tld-skip
description: |
  Skip the current In-Progress TLD ticket without marking it Done. Reverts the ticket's status to Todo
  (or a dedicated "Skipped" state if the Linear team has one), reads the active milestone's `## Order`
  section, and suggests the next ticket to pick up. Use this skill whenever the user says "tld-skip",
  "tld skip", "skip this ticket", "skip ticket", "skip for now", "come back to this later",
  "move past this one", "not ready for this", or wants to set aside the current ticket and move on
  without completing it. The skipped ticket stays in the milestone's Order and can be resumed at any
  time via `/tld-setup {id}`.
---

# TLD Skip

You are stepping away from the current ticket without completing it. Your job is to flip the In-Progress ticket back to a not-done status, figure out what comes next in the milestone's Order, and hand the user the command to pick it up.

## When to use this vs other skills

- **`/tld-skip`** — the ticket is fine, you just don't want to work it right now (order is wrong for today, practical blocker not modeled in Linear, waiting on something). Reverts In Progress → Todo. Stays in Order.
- **`/tld-next`** — the ticket is Done (tests pass, manual QA approved, commit landed). Advances to the next ticket.
- **`/tld-side-quest`** — you noticed a small polish task you want to handle in an isolated worktree before continuing. Does not change the current ticket's status.
- **Canceling a ticket in Linear** — the ticket should not be worked at all. That's a Linear action, not a skill.

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

### 2. Find the current In-Progress ticket

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 3. Determine the skip-target status

Call `list_issue_statuses` for the configured team. Scan the returned states:

1. If a state exists whose `type` is `unstarted` (or `backlog`) AND whose `name` (case-insensitive) is `Skipped`, use that state's name as the skip target.
2. Otherwise, fall back to `Todo`.

Record the chosen target. The user-facing output needs to report which state the ticket landed in so the behavior is transparent.

### 4. Flip the ticket's status

Call `save_issue` with the ticket's ID and `state` set to the chosen skip target from step 3. This transitions the ticket from In Progress back to Todo (or Skipped).

Never write to `.tld/campaign.md` at any point — this skill does not touch the campaign file. The milestone's `## Order` section is ALSO left unchanged — the skipped ticket stays in its original position so it can be resumed later.

### 5. Find the next ticket in the milestone's Order

1. From the skipped ticket's `projectMilestone.id` (captured in step 2), call `get_milestone` to read the milestone description.
2. Parse the `## Order` section using the canonical unanchored algorithm:
   - Find the line matching `^## Order\s*$`.
   - Capture every following line until the next `^## ` header or end-of-description.
   - Within that block, scan line-by-line. For each line, take the first regex match of `({prefix}-\d+)` (unanchored — do NOT anchor on `^\d+\.\s+` because Linear rewrites `1. PREFIX-XXX` to `1. [PREFIX-XXX](url)`).
   - The resulting list, in line order, is the ticket sequence.
3. The `{prefix}` comes from the Ticket prefix field of the campaign file — it is not hardcoded.
4. Locate the skipped ticket's position in the parsed Order.
5. Walk forward from there. For each remaining ticket ID, look up its status via Linear. **Return the first one whose status is `Todo` or `Backlog`** — skip `Done`, `Canceled`, and `In Progress`. The just-skipped ticket is now Todo/Skipped at its own position, but we never pick it as "next" because we start the walk from the position *after* it.

**If a next ticket is found:** set `next_action` = `/tld-setup {next-ticket-ID}`.

**If no Todo ticket remains after the skipped one in this milestone's Order:** set `next_action` = `/tld-gate {milestoneId}` — substitute the skipped ticket's `projectMilestone.id` so `/tld-gate` runs against the correct milestone (its no-arg fallback can pick the wrong one in Linear histories with re-opened tickets or parallel work). **Never emit the literal text `{milestoneId}` to the user** — substitute the actual id BEFORE rendering. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly. Note the milestone name — every ticket after the skipped one is already resolved.

**Edge — malformed or missing Order:** Stop and output:
  "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it. Ticket {ID} was reverted to {skip-target} successfully."
The status transition has already happened; the user can resume manually.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output

Report:
- Ticket `{ID}` — `{title}` reverted to `{skip-target}` in Linear
- Milestone: `{milestone name}`
- Position in Order: `{N}` of `{total}`
- Next ticket: `{next-ticket-ID}` (or "milestone gate — every subsequent ticket in this milestone is resolved")
- Reminder: the skipped ticket stays in the milestone's Order. Run `/tld-setup {ID}` any time to resume it.

### 7. Present options

**If next action is another ticket:**

---

**What's next?**

> **1.** Start next ticket with clean context (Recommended)
>    Best for: standard flow, clean slate for `{next-ticket-ID}`
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup {next-ticket-ID}
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see where things stand before deciding

> **3.** /tld-side-quest — handle a quick fix before moving on
>    Best for: noticed polish to handle before the next ticket

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**

**If next action is milestone gate:**

---

**What's next?**

> **1.** Run milestone-boundary gate with clean context (Recommended)
>    Best for: every remaining ticket in this milestone is already resolved — the skipped one will be picked up later
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-gate {milestoneId}
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see milestone status before gating

> **3.** /tld-side-quest — handle a quick fix before the gate
>    Best for: noticed polish to handle before validation

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**
