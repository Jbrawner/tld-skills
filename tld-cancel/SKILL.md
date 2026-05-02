---
name: tld-cancel
description: |
  Cancel the current In-Progress TLD ticket — mark it Canceled in Linear, remove it from the active milestone's
  `## Order` section, and suggest the next ticket. Use this skill whenever the user says "tld-cancel",
  "tld cancel", "cancel ticket", "cancel this ticket", "drop this ticket", "this ticket is no longer needed",
  "scrap this ticket", or wants to permanently remove the current ticket from the work queue without
  completing it. Unlike `/tld-skip`, the canceled ticket does NOT stay in the milestone's Order — it is
  removed entirely and will not be picked up by future `/tld-setup` runs. Does NOT modify files, branches,
  or `.tld/campaign.md`.
---

# TLD Cancel

You are permanently removing the current ticket from the milestone's work queue. Your job is to flip the In-Progress ticket to Canceled in Linear, edit the active milestone's `## Order` section to remove the ticket ID, figure out what comes next in the (now shorter) Order, and hand the user the command to pick it up.

## When to use this vs other skills

- **`/tld-cancel`** — the ticket is no longer needed. The work won't happen, ever. Sets status → Canceled and removes the ID from the milestone's Order so future `/tld-setup` runs skip past it.
- **`/tld-skip`** — the ticket is fine, you just don't want to work it right now. Reverts In Progress → Todo. The ID stays in Order.
- **`/tld-next`** — the ticket is Done. Advances to the next ticket.
- **`/tld-side-quest`** — handle a small polish task in an isolated worktree without changing the current ticket's status.

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
  "No In-Progress ticket found. Run /tld-setup to pick one up, or pass a specific ticket ID to cancel."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to cancel." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 3. Confirm cancellation

Use `AskUserQuestion` with default-No to gate the destructive action.

- Question: `Cancel ticket {TICKET-ID} ({title})? It will be marked Canceled in Linear and removed from milestone '{milestone name}'.`
- Header: `Cancel ticket`
- Options (in this order):
  1. **No, keep it (default)** — abort cleanly. Do not modify anything. Report: "Cancellation aborted. {TICKET-ID} is unchanged." Stop.
  2. **Yes, cancel it** — proceed to step 4.

If the user's response is ambiguous or any non-Yes value, default to **No**. Only proceed when the user explicitly picks "Yes, cancel it".

### 4. Resolve the Canceled status

Call `list_issue_statuses` for the configured team. Scan the returned states for one whose `type` is `canceled` (or whose `name` is `Canceled`, case-insensitive).

If no Canceled state exists, **HARD STOP**. Do NOT fall back to another state. Output:
  "Team '{team}' has no Canceled state. /tld-cancel cannot proceed — add a Canceled workflow state in Linear's team settings, or use /tld-skip if you only want to set this ticket aside."
The ticket stays In Progress. Nothing else changes.

Record the chosen Canceled state's name; the output needs to report which state the ticket landed in.

### 5. Flip the ticket's status

Call `save_issue` with the ticket's ID and `state` set to the Canceled state from step 4.

Never write to `.tld/campaign.md` at any point — this skill does not touch the campaign file.

### 6. Remove the ticket from the milestone's Order

1. From the canceled ticket's `projectMilestone.id` (captured in step 2), call `get_milestone` to read the milestone description.
2. Parse the `## Order` section using the canonical unanchored algorithm:
   - Find the line matching `^## Order\s*$`.
   - Capture every following line until the next `^## ` header or end-of-description.
   - Within that block, scan line-by-line. For each line, take the first regex match of `({prefix}-\d+)` (unanchored — do NOT anchor on `^\d+\.\s+` because Linear rewrites `1. PREFIX-XXX` to `1. [PREFIX-XXX](url)`).
   - The resulting list, in line order, is the ticket sequence.
3. The `{prefix}` comes from the Ticket prefix field of the campaign file — it is not hardcoded.
4. Locate the canceled ticket's position in the parsed Order and capture it for the output (e.g., "was position 4 of 7").
5. Remove the ticket's row from Order. Linear rewrites Order line numbering on save — no manual renumber needed.
6. Compose the updated milestone description: keep every other section (Purpose / Scope / Exit Criteria / Dependencies / Risk) byte-identical, replace only the `## Order` block.
7. Call `save_milestone` with the milestone ID and the rewritten description.

**Edge — malformed or missing Order:** The status is already Canceled. Output:
  "Milestone '{name}' has a malformed or missing `## Order` section, so I could not remove {ID} from it. Status is already Canceled in Linear. Run /milestone-sync to repair the Order section, then re-confirm with /campaign-show."
Continue to step 7 anyway — the user still needs the next-step suggestion.

**Edge — `save_milestone` fails:** Status is already Canceled. Report the failure and the milestone description state you tried to write. The user can fix it manually in the Linear UI; the cancellation itself is durable.

### 7. Find the next ticket in the (rewritten) Order

1. Walk the rewritten Order from position 1. For each remaining ticket ID, look up its status via Linear.
2. **Return the first one whose status is `Todo` or `Backlog`** — skip `Done`, `Canceled`, and `In Progress`.

**If a next ticket is found:** set `next_action` = `/tld-setup {next-ticket-ID}`.

**If no Todo ticket remains in this milestone's Order:** set `next_action` = `/tld-gate {milestoneId}` — substitute the canceled ticket's `projectMilestone.id` so `/tld-gate` runs against the correct milestone (its no-arg fallback can pick the wrong one in Linear histories with re-opened tickets or parallel work). **Never emit the literal text `{milestoneId}` to the user** — substitute the actual id BEFORE rendering. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly. Note the milestone name — every ticket left in this milestone is already resolved.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 8. Output

Report:
- Ticket `{ID}` — `{title}` set to `{Canceled state name}` in Linear
- Milestone: `{milestone name}` — Order rewritten ({original total} tickets → {new total})
- Removed from position: `{N}` of `{original total}`
- Next ticket: `{next-ticket-ID}` (or "milestone gate — every remaining ticket in this milestone is resolved")
- Reminder: cancellation is permanent. To restore the ticket, change its status in Linear's UI and add it back to the milestone's Order with `/milestone-sync` or `/campaign-edit`.

### 9. Present options

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
>    Best for: every remaining ticket in this milestone is already resolved
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
