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

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The tracker, team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.

### 1a. Identify the pending work

Check for uncommitted changes:
- `git status` to see staged/unstaged files
- `git diff --name-only` to list modified files

If there are no uncommitted changes, stop: "No pending changes found. Nothing to commit."

### 2. Resolve current ticket

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 2a. Local DB safety check

**Run the local-DB safety check before any test command or destructive database operation.**

Read `Stack.Database` from `.tld/campaign.md` — this names the expected local instance (e.g., `Supabase local at 127.0.0.1:54321`).

Verify the live database connection also points at local:
1. Scan the repo for database URL references (Supabase config, `.env*`, `SUPABASE_URL`, `DATABASE_URL`, or equivalent for this project's stack).
2. If any reference names a non-local host (anything that is not `127.0.0.1` or `localhost`), **HARD ABORT immediately**:

```
🛑 ABORT: Non-local database detected.

Found: [the URL/host that's not local]
Location: [where you found it]
Campaign Stack.Database: [value from campaign.md]

This skill runs tests or destructive operations against the database.
Refusing to proceed against a non-local database.

Fix: Ensure the configured database URL points at local (matches Stack.Database).
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

### 3. Re-run tests

Since the codebase may have changed (side quest, manual edits), re-run tests to make sure everything still passes.

**Resolve the test command:**

Determine the affected directory scope:
1. Collect the union of:
   a. Files listed in the ticket's "Files to Create/Modify" section.
   b. Uncommitted paths from `git diff --name-only` and `git diff --name-only --cached`.
2. Classify the scope against campaign Stack paths:
   - All affected paths under `Stack.Backend directory` → backend-only.
   - All affected paths under `Stack.Frontend directory` → frontend-only.
   - Mixed, neither, or empty → both/unsure.

Pick the command from campaign Test Commands:
  - backend-only → Backend command.
  - frontend-only → Frontend command.
  - both/unsure → Full command.

If the chosen command is empty, fall back to the Full command.
If the Full command is also empty, stop and output:
  "No test command defined in .tld/campaign.md Test Commands. Run /campaign-edit to set one."

Run the resolved command. Capture full output.

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

Read the `Changelog path` from `.tld/campaign.md`'s Stack section. If the value is blank, skip this step. Otherwise, check whether the file at that path was updated; if not, add an entry now. Projects that use a CI changelog gate will fail without it.

### 5. Present for approval

If tests pass, show the user what will be committed:

```
## Ready to Commit: [TICKET-ID] — [title]

### Files to commit
[list each file with a one-line note on what changed]

### Test results
All [N] tests passing

### Commit message
[resolved from .tld/campaign.md Commit format Pattern, with the ticket ID and title substituted in, and ` — TLD verified` appended]
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
- Any canonical approval keyword: "approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" (see CONTRIBUTING.md § Approval keyword set) → proceed to step 6
- User describes a problem → suggest `/tld-align` or manual fix
- "2" or "side quest" → invoke `/tld-side-quest`, come back later with `/tld-commit`

**Do NOT interpret silence, partial responses, or questions as approval.**

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Commit

Only after explicit user approval:

1. Stage the relevant files: `git add [specific files]` — only files related to this ticket
2. Commit using the `Pattern` from `.tld/campaign.md`'s Commit format section, substituting the ticket ID and title (append ` — TLD verified`). If the campaign's `Co-author` field is non-empty, include that line in the commit trailer; if blank, omit it.
3. Verify the commit succeeded

**Do NOT push.** Confirm with user before pushing (GitHub Actions budget).

### 7. Output

Report:
- Commit hash
- Files committed

**Milestone completion check:** Before presenting options, check if this was the last ticket in its milestone:
1. Call `get_milestone` on the current ticket's `projectMilestone.id` (captured in step 2).
2. Parse the `## Order` section using the unanchored regex algorithm:
   - Find the `^## Order\s*$` line.
   - Capture following lines until the next `^## ` header or end-of-description.
   - For each line, take the first regex match of `({prefix}-\d+)` — Do NOT anchor on `^\d+\.\s+` (Linear's auto-link rewrite breaks that).
3. For each ticket ID in Order, look up its status via `list_issues` or `get_issue`.
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next).
5. If every ticket in the milestone Order is Done or Canceled, append the 4th option below. Otherwise present only the first 3.

Then present the options:

---

**What's next?**

> **1.** /tld-next — mark ticket done, move to next
>    Best for: ticket is fully complete

> **2.** /tld-side-quest — quick fix first
>    Best for: noticed something to polish before moving on

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where this ticket lands in the overall plan

> **4.** /tld-gate — run milestone-boundary gate now
>    Best for: this was the last ticket in the milestone; ready for milestone validation
>    *(only shown when every ticket in the current milestone is Done or Canceled)*

Type **1**, **2**, **3**, or **4** to proceed.
