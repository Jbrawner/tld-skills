---
name: tld-save-point
description: |
  Smart context recovery for TLD workflows. Reads the campaign file, checks Linear, and figures out exactly where you are
  so you can resume without pasting /compact prompts. Use this skill whenever the user says "tld-save-point", "save point",
  "where am I", "resume", "pick up where I left off", or starts a new conversation and needs to know what to work on next.
  Also trigger when the user has no TLD context in the conversation and asks about the current ticket or next steps.
---

# TLD Save Point

You are recovering the user's position in the TLD workflow. Your job is to figure out exactly where they are, what state their current work is in, and present the right "What's next?" options so they can continue without friction.

Everything comes from the campaign file, Linear, and git history. There is no local state cache.

## When to use this

- Start of a new conversation with no TLD context
- After a /compact where the user didn't paste a context block
- User says "where am I?" or "what's next?"
- User wants to resume after a break

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

### 2. Resolve current position

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Auto-discover by walking milestones:
1. Call `list_milestones` for the configured project, sorted by `sortOrder` ascending.
2. If the result is empty, stop and output:
     "No milestones in project '{project name}' — run /campaign-plan or /milestone-create to create one."
3. Walk the milestones in order. For each milestone:
   a. Call `get_milestone` to read its description.
   b. Parse the `## Order` section using the unanchored regex algorithm (find `^## Order\s*$`, capture lines until the next `## ` header, take the first `({prefix}-\d+)` match per line).
   c. If the `## Order` section is missing or yields zero ticket IDs, stop and output:
        "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it."
   d. For each ticket ID in the parsed Order, look up its status. Return the first ticket whose status is neither Done nor Canceled.
4. If every ticket in every milestone is Done or Canceled, stop and output:
     "All tickets in all milestones are resolved. Nothing to do."

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 3. Parse milestone Order (for context)

Once the active/next ticket is known, call `get_milestone` on its milestone and parse the `## Order` section using the unanchored regex algorithm:
- Find `^## Order\s*$`; capture lines until the next `^## ` header or end-of-description.
- For each line, take the first regex match of `({prefix}-\d+)` — unanchored. Do NOT anchor on `^\d+\.\s+` (Linear's auto-link rewrite breaks that).

The parsed list tells you:
- Position: where in the milestone Order the active ticket sits
- Next up: the next Todo ticket after it
- Milestone completion: total resolved / total

If the Order section is malformed for the active milestone, note this in output but continue — the user still gets their position, just without a "next up" recommendation.

### 4. Check git state

**Recent commits:**
- `git log --oneline -10` to see recent TLD commits (they follow the pattern `feat({prefix}-XXX): ...`)

**Uncommitted changes:**
- `git status` to check for staged/unstaged changes
- `git diff --name-only` to see what files have been modified

**Current branch:**
- `git branch --show-current` to confirm which branch we're on

### 5. Determine phase

Cross-reference Linear state + git state:

**If a ticket is In Progress:**
- Uncommitted changes + no commit for this ticket yet → mid-implementation (tld-build was done, needs tld-run-test)
- No uncommitted changes + no commit for this ticket → just set up, needs tld-write-tests or tld-auto
- No uncommitted changes + commit for this ticket exists → ready for tld-next
- Uncommitted changes AND commit for this ticket exists → detour or side-quest artifacts; suggest `/tld-commit`

**If no ticket is In Progress:**
- Cross-check first: look up the most recent TLD commit (`git log --oneline -10` filtered for the campaign's commit pattern), resolve that ticket via Linear, and check whether its `projectMilestone` is now fully resolved (every ticket in that milestone's Order is Done or Canceled).
  - If yes AND there is still an unresolved milestone after it → **milestone just completed** — the user finished the last ticket and `/clear`'d before `/tld-gate`. Needs `/tld-gate` for the just-finished milestone before picking up the next one. Capture that milestone's `id` for the gate option block below.
  - Otherwise → next up is from the milestone walk (case B above) — needs `/tld-setup`.

**If every ticket in every milestone is resolved:** All done.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output

Present a compact status summary followed by the right options:

```
## Save Point Restored

**Branch:** {current branch}
**Milestone:** {milestone name} ({X}/{Y} tickets resolved)
**Active ticket:** {TICKET-ID} — {title}
**Status:** {phase description — e.g., "In Progress, implementation complete, pending commit"}

### Ticket Context
{Brief description + AC from the ticket}

### Test Command
{from campaign.md Test Commands section}

### Files
{files to create/modify from the ticket, or files with uncommitted changes}
```

Then present the appropriate "What's next?" options based on the detected phase:

**If ticket is In Progress with uncommitted changes AND a commit for this ticket already exists in `git log` (detour / side-quest artifact):**

---

The current ticket already has a commit, but there are extra uncommitted changes — likely a side-quest detour or manual edit since the commit. `/tld-commit` will re-verify and add a new commit for the pending work.

**What's next?**

> **1.** /tld-commit — re-verify and commit the new changes on top of the existing ticket commit
>    Best for: detour finished, ready to land the additional pending work

> **2.** /tld-side-quest — handle another quick fix first
>    Best for: noticed another polish item before resuming the commit flow

> **3.** /tld-dashboard — see where this pending work fits in the plan
>    Best for: want to check progress before committing or detouring

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-commit` or any other skill. Wait for the user to pick an option or type a command.**

**If ticket is In Progress with uncommitted changes AND no commit for this ticket exists yet (pending first commit):**

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

> **1.** /tld-setup {next-ticket-ID} — set up the next ticket
>    Best for: ready to start working on the next ticket in the milestone

> **2.** /tld-dashboard — see full milestone progress first
>    Best for: want to see where you are in the bigger picture

> **3.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before starting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**

**If a milestone just completed and needs a gate check** (triggered by the cross-check in step 5: most recent commit's ticket is in a milestone that is now fully resolved, and there are still unresolved milestones after it):

Use the milestone `id` captured in step 5's cross-check. Substitute it into the `{milestoneId}` placeholder in option 1 below — `/tld-gate`'s no-arg fallback can pick the wrong milestone in Linear histories with re-opened tickets or parallel work, so the explicit ID matters. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly.

---

**What's next?**

> **1.** /tld-gate {milestoneId} — run milestone boundary validation
>    Best for: standard flow, validate milestone cleanup

> **2.** /tld-dashboard — see full milestone progress first
>    Best for: want the big picture before gating

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**

**If all tickets in all milestones are resolved:**

---

All tickets across every milestone are resolved. Full project gate review recommended before launch.

**What's next?**

> **1.** /tld-dashboard — review final progress
>    Best for: final review of what was built

> **2.** /tld-side-quest — handle any remaining polish
>    Best for: last polish pass before launch

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
