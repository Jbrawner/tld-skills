---
name: tld-commit
description: |
  Pick up a pending commit after a side quest detour or interrupted flow. Use this skill whenever the user says
  "tld-commit", "commit the ticket", "finish the commit", "approve the commit", or needs to resume committing
  changes that passed verification but weren't committed yet (e.g., because they ran a side quest first).
  This is a lightweight re-entry into the commit flow — it re-runs tests to confirm nothing broke, then asks
  how to land it: a plain **commit only** (leaves the ticket In Progress — the right choice for most tickets
  in a multi-ticket story, where you commit per ticket and open one PR at the end) or **commit and progress**
  (commit, mark the ticket Done, and surface the next ticket). It never pushes or opens a PR — use /tld-pr for
  the story-end PR.
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

**Tracker resolution:**

This skill's ticket and milestone operations are written using Linear MCP tool names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Linear** — call the Linear MCP tools directly, as written in this skill. Contract: docs/ADAPTERS.md.
- **Jira** — perform the equivalent operation per docs/JIRA.md instead (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Linear, Jira. See LIMITATIONS.md."
  Do not invent an adapter.

### 1a. Identify the pending work

Check for uncommitted changes:
- `git status` to see staged/unstaged files
- `git diff --name-only` to list modified files

If there are no uncommitted changes, stop: "No pending changes found. Nothing to commit."

### 2. Resolve current ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
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
   - All affected paths under `Stack.Landing directory` → landing-only.
   - Mixed, neither, or empty → both/unsure.

Pick the command from campaign Test Commands:
  - backend-only → Backend command.
  - frontend-only → Frontend command.
  - landing-only → Landing command.
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

### 5. Choose how to land it

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

Then ask **how to land it** — a plain commit, or commit and progress the ticket:

---

**What's next?**

> **1.** Commit only — commit the changes, leave the ticket In Progress
>    Best for: most tickets in a multi-ticket story — commit per ticket now, open one PR at the end. Also right for a mid-ticket checkpoint when more work remains.

> **2.** Commit and progress — commit, mark the ticket Done, and move to the next ticket
>    Best for: this ticket is fully complete and you want to advance

> **3.** /tld-side-quest — handle another quick fix first
>    Best for: noticed another polish item before committing

> **4.** Describe what looks wrong — I'll help fix it
>    Best for: spotted something that needs correction

Type **1**, **2**, **3**, or **4** to proceed.

### >>> MANDATORY APPROVAL GATE — STOP HERE <<<

**HARD STOP.** Do NOT commit until the user explicitly picks a landing mode. Wait for one of:
- "1", or any canonical approval keyword ("approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed" — see STANDARDS.md § Approval keyword set) → **Commit only**: do step 6, then stop (ticket stays In Progress; skip step 7)
- "2", "progress", or "commit and progress" → **Commit and progress**: do step 6, then step 7
- "3" or "side quest" → invoke `/tld-side-quest`, come back later with `/tld-commit`
- User describes a problem → suggest `/tld-align` or manual fix

**Do NOT interpret silence, partial responses, or questions as approval.** When the bare keyword "commit" is used, treat it as **Commit only** (option 1); only the explicit "2" / "commit and progress" advances the ticket.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Commit

Only after the user picks a landing mode (Commit only or Commit and progress):

1. Stage the relevant files: `git add [specific files]` — only files related to this ticket
2. Commit using the `Pattern` from `.tld/campaign.md`'s Commit format section, substituting the ticket ID and title (append ` — TLD verified`). If the campaign's `Co-author` field is non-empty, include that line in the commit trailer; if blank, omit it.
3. Verify the commit succeeded

**Do NOT push and do NOT open a PR.** `/tld-commit` never pushes or PRs — that is `/tld-pr`'s job (the story-end landing).

### 7. Progress the ticket (Commit and progress mode only)

**Skip this entire step if the user chose Commit only** — the commit is done and the ticket stays In Progress.

If the user chose **Commit and progress**:
1. Mark the ticket Done in the tracker via `save_issue` (set state to "Done").
2. Determine what's next from the current ticket's milestone:
   - Read the milestone's ordered ticket list (Linear: the `## Order` section parsed with the unanchored `({prefix}-\d+)` algorithm; Jira: the milestone Story's child tickets by rank).
   - Walk the Order from the current ticket forward and pick the first ticket whose status is `Todo` (skip Done / Canceled / In Progress).
   - **Next Todo found** → next action is `/tld-setup {next-id}`.
   - **No next Todo** (every later entry is Done / Canceled / In Progress) → next action is `/tld-gate {milestoneId}` — substitute the milestone's actual `id`; never emit the literal `{milestoneId}`. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly.
   - **Order section malformed or missing** → note it (the commit and Done already landed): "Committed and marked {ticket} Done, but couldn't resolve the next ticket — the milestone Order section is malformed. Run /milestone-sync to repair it." Do not invoke `/milestone-sync` yourself.

### 8. Output

**Never emit the literal text `{milestoneId}` or `{next-id}`** — substitute the actual values before rendering.

**If Commit only:**

```
## Committed — [TICKET-ID] — [title]
- Commit: [short-sha]
- Files: [list]
- Ticket: still In Progress (not advanced — run /tld-commit again and pick "commit and progress" when this ticket is done)
```

Then present:

---

**What's next?**

> **1.** Keep working on this ticket
>    Best for: that was a checkpoint and there's more to do here

> **2.** /tld-commit — land it and progress when the ticket is done
>    Best for: this ticket is now complete

> **3.** /tld-pr — open a PR for the branch
>    Best for: end of the story — push the branch and open the PR for review

Type **1**, **2**, or **3** to proceed.

**If Commit and progress:**

```
## Landed — [TICKET-ID] — [title]
- Commit: [short-sha]
- Files: [list]
- Tracker: marked Done
- Next: /tld-setup [next-id]   (or /tld-gate [milestoneId] if the milestone just completed)
```

Then present:

---

**What's next?**

> **1.** Start the next ticket with clean context (Recommended)
>    Best for: standard flow — `/clear`, then run `/tld-setup {next-id}` (or `/tld-gate {milestoneId}` if the milestone just completed)

> **2.** /tld-pr — open a PR for the work so far
>    Best for: end of the story — push the branch and open one PR for all its tickets

> **3.** /tld-dashboard — review milestone progress first
>    Best for: want the big picture before continuing

Type **1**, **2**, or **3** to proceed.
