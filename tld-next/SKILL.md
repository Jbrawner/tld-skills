---
name: tld-next
description: |
  Transition to the next TLD ticket after a successful commit. Use this skill whenever the user says "tld-next", "tld next", "next ticket", or wants to mark the current ticket done and prepare for the next one. Marks the ticket Done in Linear, determines what's next (another ticket or a milestone gate), and outputs the /compact prompt for context reset. Always use after /tld-run-test commits successfully.
---

# TLD Next

You are transitioning from a completed ticket to the next one. Your job is to close out the current ticket, figure out what's next in its milestone Order, and give the user the exact command to run after a context reset.

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

### 2. Identify the current ticket

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That's the current ticket. Load via `get_issue` for `projectMilestone` and full context.

**Case B — zero In-Progress tickets:** Fall back to context:
1. Check the most recent conversation history for a `/tld-setup` output or ticket reference.
2. Check the most recent git commit message for a ticket ID (format: `feat({prefix}-XXX): ...`).
3. If still ambiguous, ask the user which ticket was just completed.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion`. One option per In-Progress ticket; each option's label is the ticket ID + title. Question text: "Multiple tickets are In Progress — pick the one you just completed."

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."

### 3. Verify commit exists

Check that the most recent git commit references the current ticket ID (e.g., `git log --oneline -5 | grep {ticket-id}`). This confirms `/tld-run-test` actually committed.

If no commit found for this ticket, stop and tell the user: "No commit found for {ticket ID}. Run `/tld-run-test` first."

### 4. Mark ticket Done in Linear

Use `save_issue` to set the ticket's state to "Done".
Never write to `.tld/campaign.md`.

### 5. Determine what's next

1. Read the current ticket's milestone via `get_milestone` using the `projectMilestone.id` captured in step 2.
2. Parse the `## Order` section using the unanchored regex algorithm:
   - Find the `^## Order\s*$` line.
   - Capture following lines until the next `^## ` header or end-of-description.
   - For each line, take the first regex match of `({prefix}-\d+)` — that's the ticket ID for that position. Do NOT anchor on `^\d+\.\s+` (Linear's auto-link rewrite breaks that).
3. Locate the current ticket's position in the parsed Order.
4. Walk forward from there. For each remaining ticket ID, look up its status. Return the first one whose status is **Todo** or **Backlog** — skip Done, Canceled, AND In Progress (another agent may have claimed it).

**If a next ticket is found:** set `next_action` = `/tld-setup {next-ticket-ID}`.

**If no Todo ticket remains in this milestone's Order:** set `next_action` = `/tld-gate`. Note the milestone name — it just completed.

**Edge — malformed Order:** If the Order section is missing or yields zero tickets, stop and output:
  "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it. Ticket {ID} was marked Done successfully."

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output

Report:
- Ticket {ID} marked Done in Linear
- Milestone progress (e.g., "3 of 5 tickets resolved in M3: Core TLD Wiring")
- What's next (next ticket ID or milestone gate)

Context is saved in Linear. The recommended flow is to clear this conversation's stale context and start the next action fresh.

### 7. Present options

**If next action is another ticket:**

---

**What's next?**

> **1.** Start next ticket with clean context (Recommended)
>    Best for: standard flow, clean slate for {next-ticket-ID}
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup {next-ticket-ID}
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see where you are before deciding

> **3.** /tld-side-quest — handle a quick fix before moving on
>    Best for: noticed polish to handle before next ticket

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**

**If next action is milestone gate:**

---

**What's next?**

> **1.** Run milestone-boundary gate with clean context (Recommended)
>    Best for: standard flow, ready to validate the completed milestone
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-gate
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see milestone status before gating

> **3.** /tld-side-quest — handle a quick fix before the gate
>    Best for: noticed polish to handle before validation

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**
