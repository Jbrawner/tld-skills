---
name: tld-setup
description: |
  Set up the next TLD (Test-Led Development) ticket for implementation. Use this skill whenever the user says "tld-setup", "tld setup", "set up next ticket", or wants to start working on the next ticket in the execution playbook. This skill finds the next ticket, pulls it from Linear, marks it In Progress, loads relevant files, and outputs the full context needed before writing tests. Always use this before starting any new ticket work.
---

# TLD Setup

You are preparing the next ticket for test-led development. Your job is to identify the right ticket, pull its full context, and give the user everything they need to review before running `/tld-write-tests` or `/tld-auto`.

## Inputs

The user may provide:
- A specific ticket ID (e.g., `2ND-149`) — use that ticket directly
- A playbook path — use it instead of the default
- Nothing — find the next ticket automatically

Default playbook location: `docs/EXECUTION_PLAYBOOK.md` (relative to repo root).

## Process

### 1. Determine the current ticket

**If a ticket ID was provided:** Use that ticket directly. Skip to step 2.

**If no ticket ID:** Find the next ticket to work on:
1. Read the playbook (`docs/EXECUTION_PLAYBOOK.md`)
2. Query Linear for tickets in the mAIn Character project (team: 2ndFoundry). Use `list_issues` to get current statuses.
3. Walk the playbook steps in order. Find the first step that is not fully Done.
4. Within that step, find the first ticket (in the listed order) that is not Done.
5. That's your ticket.

If all tickets in the playbook are Done, say so and stop.

### 2. Pull ticket details from Linear

Use `get_issue` with the ticket identifier (e.g., `2ND-149`). Extract:
- Title
- Full description
- Acceptance criteria
- Dependencies (blockedBy relations)
- Any test commands or file references mentioned

### 3. Check dependencies

For each dependency listed in the ticket:
- Query its status via `get_issue`
- If any dependency is NOT Done, stop and report: "Blocked — [dependency ticket] is not Done yet."

### 4. Mark In Progress

Use `save_issue` to set the ticket's state to "In Progress".

### 5. Load relevant files

Read the playbook entry for this step to find:
- "Context to give Claude Code" — load those files
- Test command for this step
- Any P2 fixes mentioned that should be done before starting

Also read any files explicitly referenced in the ticket description (e.g., existing test files as patterns, source files being ported).

### 5.5. Classify ticket type

Before presenting options, determine the ticket type. This controls which "What's next?" block to present.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

Record the classification. Use it in step 6 to pick the right options block.

### 5.6. Recommendation hint (CODE tickets only)

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-auto` as Recommended.

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `auth`, `RLS`, `migration`, `payment`, `credentials`, `security`
- "Files to Create/Modify" lists 5 or more files

Only one option gets the marker. Never mark `/tld-side-quest`. Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output

Present the full ticket context directly in the conversation. Structure your output as:

```
## Active Ticket: [TICKET-ID]

**Title:** [ticket title]
**Step:** [playbook step number and name]

### Description
[full ticket description from Linear]

### Acceptance Criteria
[extracted AC items as a checklist]

### Test Command
[from playbook step]

### Files to Create/Modify
[extracted from ticket description]

### Pattern References
[files loaded as context, with brief note on why each matters]

### Dependencies
[list with status — all should be Done]

### Notes
[any P2 fixes, gotchas, or special instructions from the playbook]
```

Then tell the user:
- Which ticket was selected and why (position in playbook)
- Summary of what it involves
- Any P2 fixes to handle first
- Dependencies confirmed Done

Then present the options block based on the ticket type classification from step 5.5.

**If ticket is a CODE ticket, present:** (apply the `(Recommended)` marker from step 5.6 to option 1 OR option 2, never both)

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
