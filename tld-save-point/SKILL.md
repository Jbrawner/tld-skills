---
name: tld-save-point
description: |
  Smart context recovery for TLD workflows. Reads the playbook, checks Linear, and figures out exactly where you are
  so you can resume without pasting /compact prompts. Use this skill whenever the user says "tld-save-point", "save point",
  "where am I", "resume", "pick up where I left off", or starts a new conversation and needs to know what to work on next.
  Also trigger when the user has no TLD context in the conversation and asks about the current ticket or next steps.
---

# TLD Save Point

You are recovering the user's position in the TLD workflow. Your job is to figure out exactly where they are in the playbook, what state their current work is in, and present the right "What's next?" options so they can continue without friction.

This skill replaces the old pattern of pasting /compact prompts between conversations. Everything you need is in the playbook, Linear, and git history.

## When to use this

- Start of a new conversation with no TLD context
- After a /compact where the user didn't paste a context block
- User says "where am I?" or "what's next?"
- User wants to resume after a break

## Process

### 1. Read the playbook

Read `docs/EXECUTION_PLAYBOOK.md` to get the full structure: all steps, their tickets (in order), and the test commands for each step.

### 2. Query Linear for ticket statuses

Use `list_issues` to get the current status of all tickets in the mAIn Character project (team: 2ndFoundry). Build a map of ticket ID to status (Done, In Progress, Todo, Canceled, etc.).

### 3. Check git state

Run these commands to understand the current work state:

**Recent commits:**
- `git log --oneline -10` to see recent TLD commits (they follow the pattern `feat(2ND-XXX): ...`)

**Uncommitted changes:**
- `git status` to check for staged/unstaged changes
- `git diff --name-only` to see what files have been modified

**Current branch:**
- `git branch --show-current` to confirm which branch we're on

### 4. Determine position

Walk the playbook steps in order and cross-reference with Linear statuses:

**Check for In Progress tickets:**
- If any ticket is In Progress in Linear, that's the active ticket. Determine which TLD phase it's in:
  - Has uncommitted changes? → mid-implementation (tld-build was done, needs tld-run-test or tld-commit)
  - No changes but ticket is In Progress? → setup was done, needs tld-write-tests or tld-auto
  - Recent commit matches this ticket? → needs tld-next

**Check for pending commits:**
- If there are uncommitted changes AND a ticket is In Progress, the user may have been at the approval gate or did a side quest. Flag this and suggest `/tld-commit`.

**Check for completed steps needing gates:**
- Walk each step. If all tickets in a step are Done but the next step has no In Progress or Done tickets, a gate check may be needed. Check if the last commit message mentions "gate" for that step.

**Find the next ticket:**
- If no ticket is In Progress, find the first step that's not fully Done, then the first ticket in that step that's not Done. That's the next ticket.

**All done:**
- If every ticket in the playbook is Done, report that.

### 5. Load context for the active/next ticket

Use `get_issue` to pull the full ticket details (title, description, AC, dependencies). Also load the playbook step's context (test command, pattern references, etc.).

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output

Present a compact status summary followed by the right options:

```
## Save Point Restored

**Branch:** [current branch]
**Playbook step:** Step [N] — [step name] ([X]/[Y] tickets done)
**Active ticket:** [TICKET-ID] — [title]
**Status:** [what state it's in — e.g., "In Progress, implementation complete, pending commit"]

### Ticket Context
[Brief description + AC from the ticket]

### Test Command
[from playbook step]

### Files
[files to create/modify from the ticket, or files with uncommitted changes]
```

Then present the appropriate "What's next?" options based on the detected state:

**If ticket is In Progress with uncommitted changes (pending commit):**

---

**What's next?**

> **1.** /tld-commit — re-verify and commit the pending changes
>    Best for: standard resume after a detour

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: noticed another polish item

> **3.** /tld-dashboard — see where this pending work fits in the plan
>    Best for: want to check progress before committing or detouring

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-commit` or any other skill. Wait for the user to pick an option or type a command.**

**If ticket is In Progress with no changes (needs implementation):**

Apply a recommendation hint to one option before presenting. Default: mark `/tld-auto` as **(Recommended)**. Flip the mark to `/tld-write-tests` if the ticket description or AC mentions any of `auth`, `RLS`, `migration`, `payment`, `credentials`, `security`, OR the "Files to Create/Modify" list has 5+ files. Only option 1 or option 2 can receive the marker. Never mark `/tld-dashboard` or `/tld-side-quest`.

---

**What's next?**

> **1.** /tld-write-tests — step-by-step flow
>    Best for: complex tickets, new patterns, unfamiliar territory

> **2.** /tld-auto — automated pipeline
>    Best for: small, straightforward tickets you're confident about

> **3.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting this ticket

> **4.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something else before starting

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-write-tests`, `/tld-auto`, or any other skill. Wait for the user to pick an option or type a command.**

**If no ticket is In Progress (needs setup):**

---

**What's next?**

> **1.** /tld-setup [next-ticket-ID] — set up the next ticket
>    Best for: ready to start working on the next ticket in the playbook

> **2.** /tld-dashboard — see full playbook progress first
>    Best for: want to see where you are in the bigger picture

> **3.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before starting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**

**If a step is complete and needs a gate check:**

---

**What's next?**

> **1.** /tld-gate — run step boundary validation
>    Best for: standard flow, validate step cleanup

> **2.** /tld-dashboard — see full playbook progress first
>    Best for: want the big picture before gating

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**

**If all playbook tickets are Done:**

---

All playbook tickets are complete. Full project gate review recommended before launch.

**What's next?**

> **1.** /tld-dashboard — review final progress
>    Best for: final review of what was built

> **2.** /tld-side-quest — handle any remaining polish
>    Best for: last polish pass before launch

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
