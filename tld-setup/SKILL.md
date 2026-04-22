---
name: tld-setup
description: |
  Set up the next TLD (Test-Led Development) ticket for implementation. Use this skill whenever the user says "tld-setup", "tld setup", "set up next ticket", or wants to start working on the next ticket. This skill finds the next ticket, pulls it from Linear, marks it In Progress, loads relevant files, and outputs the full context needed before writing tests. Always use this before starting any new ticket work.
---

# TLD Setup

You are preparing the next ticket for test-led development. Your job is to identify the right ticket, pull its full context from Linear, and give the user everything they need to review before running `/tld-write-tests` or `/tld-auto`.

## Inputs

The user may provide:
- A specific ticket ID (e.g., `2ND-149`) — Mode A: use that ticket directly
- Nothing — Mode B: find the next ticket automatically from Linear milestones

Structure and order come from Linear. Local project config comes from `.tld/campaign.md`. There is no playbook file.

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

### 2. Determine the target ticket

**Mode A — explicit ticket ID provided:**

Validate the ID matches the `{prefix}-\d+` pattern from the campaign. If not, stop and ask the user to re-run with a valid ID.

Call `get_issue` on the ID with `includeRelations: true`. If the ticket is already Done or Canceled, warn and ask whether to proceed anyway. If In Progress, proceed (the user is resuming). Capture `projectMilestone` for context.

Skip to step 4.

**Mode B — no ticket ID:**

1. Call `list_milestones` for the configured Linear project, sorted by `sortOrder` ascending.
2. If the result is empty, stop and output:
     "No milestones in project '{project name}' — run /campaign-plan or /milestone-create to create one."
3. Walk the milestones in order. For each milestone:
   a. Call `get_milestone` to read its description.
   b. Parse the `## Order` section using the algorithm in step 3.
   c. If the `## Order` section is missing or yields zero ticket IDs, stop and output:
        "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it."
   d. For each ticket ID in the parsed Order, look up its status (batched `list_issues` or per-ticket `get_issue`).
   e. Return the first ticket whose status is **neither Done NOR Canceled**. Both statuses count as "already resolved" — skip both.
4. If every ticket in every milestone is Done or Canceled, stop and output:
     "All tickets in all milestones are resolved. Nothing to do."

### 3. Parse the `## Order` section

Use this algorithm on the milestone description:

1. Find the line matching `^## Order\s*$`.
2. Capture every following line until the next `^## ` header or end-of-description.
3. Within that block, scan line-by-line. For each line, take the first regex match of `({prefix}-\d+)` (unanchored — do NOT anchor on `^\d+\.\s+` because Linear rewrites `1. PREFIX-XXX` to `1. [PREFIX-XXX](url)`, breaking any anchor that assumes the ID immediately follows the list marker).
4. The resulting list, in line order, is the ticket sequence.

The `{prefix}` comes from the Ticket prefix field of the campaign file — it is not hardcoded.

### 4. Pull ticket details

Use `get_issue` with `includeRelations: true` on the target ticket. Extract:
- Title
- Full description
- Acceptance criteria
- Dependencies (`blockedBy` relations)
- Milestone (`projectMilestone`)
- Any test commands or file references mentioned in the description

### 5. Check dependencies

For each blocker in `blockedBy`:
- Check its status.
- If any blocker is NOT Done or Canceled, stop and report:
    "Blocked — {blocker-id} is {status}. Resolve it first."

### 6. Mark In Progress

If the ticket's current status is Todo or Backlog, call `save_issue` to set `state` to "In Progress".
If it is already In Progress, leave it alone (user is resuming).
Never write to `.tld/campaign.md` at any point — this skill does not touch the campaign file.

### 7. Load pattern references

Read any files explicitly referenced in the ticket description (pattern refs, existing tests, source files being ported). Use the Test Commands and Stack sections of the campaign file for test-command hints — these values come from campaign, not the ticket.

### 8. Classify ticket type

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

Record the classification. Use it in step 10 to pick the right options block.

### 9. Recommendation hint (CODE tickets only)

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-auto` as Recommended.

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `auth`, `RLS`, `migration`, `payment`, `credentials`, `security`
- "Files to Create/Modify" lists 5 or more files

Only one option gets the marker. Never mark `/tld-side-quest`. Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 10. Output

Present the full ticket context directly in the conversation. Structure your output as:

```
## Active Ticket: {TICKET-ID}

**Title:** {ticket title}
**Milestone:** {milestone name}

### Description
{full ticket description from Linear}

### Acceptance Criteria
{extracted AC items as a checklist}

### Test Command
{from campaign.md Test Commands section, matched to the ticket's stack/scope}

### Files to Create/Modify
{extracted from ticket description}

### Pattern References
{files loaded as context, with brief note on why each matters}

### Dependencies
{list with status — all should be Done or Canceled}

### Notes
{any gotchas or special instructions from the ticket description}
```

Then tell the user:
- Which ticket was selected and why (position in milestone Order, or "you specified it" for Mode A)
- Summary of what it involves
- Dependencies confirmed clear

Then present the options block based on the ticket type classification from step 8.

**If ticket is a CODE ticket, present:** (apply the `(Recommended)` marker from step 9 to option 1 OR option 2, never both)

---

**What's next?**

> **1.** /tld-write-tests — step-by-step flow
>    Best for: complex tickets, new patterns, unfamiliar territory
>    Flow: write-tests → build → (audit) → run-test → next

> **2.** /tld-auto — automated pipeline
>    Best for: small, straightforward tickets you're confident about
>    Gates: 2 stops (test review, QA approval)

> **3.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting this ticket

> **4.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something else before starting this ticket

Type **1**, **2**, **3**, or **4** to proceed.

**If ticket is a MANUAL-QA ticket, present:**

---

**What's next?**

> **1.** /tld-run-test — step-by-step manual walkthrough
>    Best for: first-time QA, tickets with many verification steps
>    Flow: checklist → approve each → mark Done

> **2.** /tld-auto — QA gate in one pass
>    Best for: quick re-verification or simple QA tickets
>    Trade-off: approve everything or nothing

> **3.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting manual QA

> **4.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before starting the walkthrough

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT write tests, do NOT write implementation code, do NOT invoke any other TLD skill. Wait for the user to pick an option or type a command. Your only job was setup.**
