---
name: tld-commit
description: |
  Pick up a pending commit after a side quest detour or interrupted flow. Use this skill whenever the user says
  "tld-commit", "commit the ticket", "finish the commit", "approve the commit", or needs to resume committing
  changes that passed verification but weren't committed yet (e.g., because they ran a side quest first).
  This is a lightweight re-entry into the commit flow — it re-runs tests to confirm nothing broke, then waits
  for approval before committing.
---

# TLD Commit

You are picking up a pending commit. The user was at (or past) the tld-run-test approval gate, chose to do something else (side quest, break, new conversation), and now wants to finalize the commit.

**No commit happens without the user's explicit approval. This is a hard rule.**

## When to use this

- After a `/tld-side-quest` when there are uncommitted TLD changes
- Resuming from a `/tld-save-point` that detected pending changes
- User explicitly asks to commit the current ticket's work

## Process

### 1. Identify the pending work

Check for uncommitted changes:
- `git status` to see staged/unstaged files
- `git diff --name-only` to list modified files

If there are no uncommitted changes, stop: "No pending changes found. Nothing to commit."

### 2. Identify the ticket

Figure out which ticket these changes belong to:

1. Check Linear for In Progress tickets in the mAIn Character project (team: 2ndFoundry) via `list_issues`
2. Cross-reference the modified files against the ticket's "Files to Create/Modify"
3. If multiple In Progress tickets exist, check which one matches the file changes

If you can't determine the ticket, ask the user: "Which ticket are these changes for?"

Use `get_issue` to pull the full ticket details (title, description, AC).

### 3. Re-run tests

Since the codebase may have changed (side quest, manual edits), re-run the test command from the playbook step to make sure everything still passes.

Read `docs/EXECUTION_PLAYBOOK.md` to find the test command for the current step.

Run the tests. Capture full output.

**If tests fail:**

Report the failures and present options:

---

**What's next?**

> **1.** /tld-align — auto-fix the implementation to match tests
>    Best for: failures look like small implementation gaps

> **2.** Fix manually, then run /tld-commit again
>    Best for: complex failures you want to debug yourself

> **3.** /tld-side-quest — bail to something else and come back
>    Best for: need a detour to understand the issue

Type **1**, **2**, or **3** to proceed.

Stop here. Do not commit.

### 4. Update CHANGE_LOG.md

If this ticket touches `backend/`, check whether `backend/CHANGE_LOG.md` was updated. If not, add an entry now. This is required or CI will fail.

### 5. Present for approval

If tests pass, show the user what will be committed:

```
## Ready to Commit: [TICKET-ID] — [title]

### Files to commit
[list each file with a one-line note on what changed]

### Test results
All [N] tests passing

### Commit message
feat(2ND-XXX): [ticket title] — TLD verified
```

Then present the options:

---

**What's next?**

> **1.** Approve — commit the changes
>    Best for: everything looks right, ready to commit

> **2.** /tld-side-quest — handle another quick fix first
>    Best for: noticed another polish item before committing

> **3.** Describe what looks wrong — I'll help fix it
>    Best for: spotted something that needs correction

Type **1**, **2**, or **3** to proceed.

### >>> MANDATORY APPROVAL GATE — STOP HERE <<<

**HARD STOP.** Do NOT commit until the user explicitly approves. Wait for one of:
- "1", "approve", "commit", "lgtm", "looks good", "ship it" → proceed to step 6
- User describes a problem → suggest `/tld-align` or manual fix
- "2" or "side quest" → invoke `/tld-side-quest`, come back later with `/tld-commit`

**Do NOT interpret silence, partial responses, or questions as approval.**

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Commit

Only after explicit user approval:

1. Stage the relevant files: `git add [specific files]` — only files related to this ticket
2. Commit with message format: `feat(2ND-XXX): [ticket title] — TLD verified`
   Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
3. Verify the commit succeeded

**Do NOT push.** Confirm with user before pushing (GitHub Actions budget).

### 7. Output

Report:
- Commit hash
- Files committed

**Step completion check:** Before presenting options, check if this was the last ticket in its playbook step:
1. Read `docs/EXECUTION_PLAYBOOK.md` to find the step containing the current ticket
2. List all tickets in that step (playbook order)
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the step is Done, append the 4th option below. Otherwise present only the first 3.

Then present the options:

---

**What's next?**

> **1.** /tld-next — mark ticket done, move to next
>    Best for: ticket is fully complete

> **2.** /tld-side-quest — quick fix first
>    Best for: noticed something to polish before moving on

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where this ticket lands in the overall plan

> **4.** /tld-gate — run step boundary gate now
>    Best for: this was the last ticket in the step; ready for step validation
>    *(only shown when every ticket in the current step is Done)*

Type **1**, **2**, **3**, or **4** to proceed.
