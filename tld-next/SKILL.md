---
name: tld-next
description: |
  Transition to the next TLD ticket after a successful commit. Use this skill whenever the user says "tld-next", "tld next", "next ticket", or wants to mark the current ticket done and prepare for the next one. Marks the ticket Done in Linear, determines what's next (another ticket or a gate check), and outputs the /compact prompt for context reset. Always use after /tld-run-test commits successfully.
---

# TLD Next

You are transitioning from a completed ticket to the next one. Your job is to close out the current ticket, figure out what's next, and give the user the exact `/compact` prompt to use for a clean context reset.

## Process

### 1. Identify the current ticket

Get the active ticket from context. There is no TLD_ACTIVE.md file. Instead:

1. Check the conversation history for the `/tld-setup` output or the ticket ID referenced in the recent commit.
2. Check the most recent git commit message for the ticket ID (format: `feat(2ND-XXX): ...`)
3. If needed, read `docs/EXECUTION_PLAYBOOK.md` and query Linear to determine current position.

If you cannot determine the active ticket, ask the user which ticket was just completed.

### 2. Verify commit exists

Check that the most recent git commit references the current ticket ID. This confirms `/tld-run-test` actually committed.

If no commit found for this ticket, stop and tell the user: "No commit found for [ticket ID]. Run `/tld-run-test` first."

### 3. Mark ticket Done in Linear

Use `save_issue` to set the ticket's state to "Done".

### 4. Determine what's next

Read the playbook (`docs/EXECUTION_PLAYBOOK.md`). Find the current step and ticket position.

**If there are more tickets in the current step:**
- Identify the next ticket ID in the step's ordered list
- Set `next_action` = `/tld-setup [next-ticket-ID]`

**If this was the last ticket in the current step:**
- Set `next_action` = `/tld-gate`
- Note which step was just completed

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Output

Report:
- Ticket [ID] marked Done in Linear
- Step progress (e.g., "3 of 5 tickets done in Step 5")
- What's next (next ticket ID or gate check)

Context is saved in Linear and the playbook. The recommended flow is to clear this conversation's stale context and start the next action fresh.

### 6. Present options

**If next action is another ticket:**

---

**What's next?**

> **1.** Start next ticket with clean context (Recommended)
>    Best for: standard flow, clean slate for [next-ticket-ID]
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup [next-ticket-ID]
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see where you are before deciding

> **3.** /tld-side-quest — handle a quick fix before moving on
>    Best for: noticed polish to handle before next ticket

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**

**If next action is gate check:**

---

**What's next?**

> **1.** Run step-boundary gate with clean context (Recommended)
>    Best for: standard flow, ready to validate the completed step
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-gate
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see step status before gating

> **3.** /tld-side-quest — handle a quick fix before the gate
>    Best for: noticed polish to handle before validation

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**
