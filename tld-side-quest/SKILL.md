---
name: tld-side-quest
description: |
  Run a small side quest (polish, minor fix, small feature) without polluting the main conversation context.
  Use this skill whenever the user says "tld-side-quest", "side quest", "side-quest", "quick fix", "polish task",
  or wants to handle a small ticket/task in isolation so their main TLD workflow stays clean.
  This skill spawns a subagent to do the work, then pauses for manual testing before committing.
  Always use when the user has a small task they don't want mixed into their current context — even if they don't
  say "side quest" explicitly, trigger on phrases like "handle this on the side", "do this without messing up context",
  "quick detour", or "small thing I need done".
---

# TLD Side Quest

You are running a small, isolated task — polish, a minor fix, or a small feature — without polluting the user's main conversation context. The key idea: a subagent does all the implementation work in a git worktree, reports back what changed, then the user manually tests and gives explicit approval before anything gets committed.

**No commit happens without the user's explicit approval. This is a hard rule.**

## When to use this

Side quests are for work that is small enough to not warrant the full TLD ceremony (write-tests → build → run-test → next) but still needs to be tracked and done cleanly. Think: UI polish, copy changes, small bug fixes, adding a minor utility, config tweaks across 1-5 files.

If the task is large (new feature, multiple components, schema changes), push back and suggest the full TLD flow instead.

## Inputs

The user provides one of:

- A Linear ticket ID (e.g., 2ND-200) — use that ticket directly
- A description of what to do — create a Linear ticket for it first
- Both — use the ticket, augment with their description

## Process

### 0. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The tracker, team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.

### 1. Get or create the ticket

**If ticket ID provided:**
- Pull it from Linear via `get_issue`
- Extract title, description, acceptance criteria

**If only a description provided:**
- Create a ticket in Linear via `save_issue`, passing `project` = campaign `Project.Project name` and `team` = campaign `Project.Team`
- Use a clear title and the user's description as the body
- Label it with "side-quest" if that label exists (check via `list_issue_labels` first; if it doesn't exist, skip the label — don't create one)

Mark the ticket **In Progress** via `save_issue`.

### 2. Identify the affected files

Before spawning the subagent, figure out what files are involved. Read the ticket description, check for file paths mentioned, and use grep/glob if needed to locate relevant code. The subagent needs to know exactly where to work.

Build a file manifest:
- Files to modify (with brief note on what changes)
- Pattern/reference files to follow (existing code style)
- Test files that cover the affected area (if any exist)

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

The subagent will run tests inside its worktree; gating here ensures the parent has confirmed a local target before any test command fires downstream.

### 3. Spawn the implementation subagent

Launch a subagent with `isolation: "worktree"` so it gets its own copy of the repo. Give it a complete brief:

```
You are implementing a small side quest for ticket [TICKET-ID]: [title]

## What to do
[ticket description / user's description]

## Acceptance criteria
[from ticket, or inferred from description]

## Files to modify
[file manifest from step 2]

## Pattern references
[relevant existing files to match style]

## Rules
- Only modify the files listed above. If you need to touch other files, note it in your report but don't do it.
- Match existing code patterns and style.
- Run any existing tests that cover the affected area to make sure you haven't broken anything.
- Do NOT commit. Do NOT push. Your changes stay in the worktree.

## Output required
When done, produce a report with:
1. CHANGES: List every file modified and what changed (be specific — not "updated styles" but "changed button padding from 8px to 12px in SubmitButton component")
2. TEST RESULTS: Output of any tests you ran (command + result)
3. MANUAL TEST CHECKLIST: Step-by-step instructions for the user to verify the changes manually. Be specific — tell them what to look at, what to click, what to expect. Think about it from the user's perspective: they need to know how to confirm this works without reading the code.
4. RISKS: Anything you're unsure about or that might have side effects
```

### 4. Report back to the user

When the subagent returns, present a clean summary:

```
## Side Quest: [TICKET-ID] — [title]

### What changed
[list from subagent report — file-by-file specifics]

### Test results
[automated test output, or "no existing tests cover this area"]

### Manual test checklist
[step-by-step from subagent, refined for clarity]
- [ ] Step 1: ...
- [ ] Step 2: ...
- [ ] Step 3: ...

### Risks / notes
[anything flagged by the subagent]

### Worktree location
[path to the worktree where changes live]
```

Then tell the user: "Changes are ready in an isolated worktree. Please test manually using the checklist above." and present:

---

**What's next?**

> **1.** Approve — commit and merge (Recommended)
>    Best for: manual test passed, ready to ship this side quest

> **2.** Describe adjustments — I'll re-iterate in the worktree
>    Best for: small tweak needed before committing

> **3.** Reject — discard the worktree and abort
>    Best for: this isn't the right direction; throw it away

Type **1**, **2**, or **3** to proceed.

### 5. Wait for approval

This is the hard gate. Do nothing until the user responds.

**If the user says any canonical approval keyword** ("approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" — see STANDARDS.md § Approval keyword set):
- Proceed to step 6.

**If the user says "2", describes issues, or asks for adjustments:**
- Either fix inline (if trivial) or spawn another subagent iteration in the same worktree
- Present updated changes and test checklist
- Wait for approval again

**If the user says "3", "reject", or "cancel":**
- Clean up the worktree (`git worktree remove`)
- Set the ticket back to its previous state (or to "Canceled" if it was newly created)
- Report: "Side quest canceled. Worktree cleaned up. No changes committed."

### 6. Commit and close

Only after explicit user approval:

- From the worktree, stage only the relevant files: `git add [specific files]`
- Build the commit message from campaign `Commit format.Pattern` (e.g., `feat(PREFIX-XXX): title`), substituting the ticket ID and title. Append ` — side quest` to the title. Choose the commit type based on the work: `fix()` for bug fixes, `chore()` for polish/cleanup, `feat()` for small features — override the pattern's type when the default doesn't fit.
- Append the `Co-author` trailer from campaign `Commit format.Co-author` (via HEREDOC, preserving the full `Co-Authored-By:` line).
- Merge the worktree branch back into the working branch
- Clean up the worktree
- Mark the ticket **Done** in Linear via `save_issue`

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 7. Output

```
## Side Quest Complete: [TICKET-ID]

- Committed: [commit hash]  
- Branch merged and worktree cleaned up
- Ticket marked Done in Linear

Your main context is untouched.
```

Then present context-aware options. Check conversation history AND git status to determine where the user was in the TLD flow before the side quest.

**First, check for uncommitted TLD changes** (via `git status` / `git diff --name-only`). If there are uncommitted changes from a different ticket (not the side quest), the user was likely at the approval gate before the side quest:

---

**What's next?** You have uncommitted changes from a previous ticket:

> **1.** /tld-commit — commit the pending ticket changes
>    Best for: resume the approval gate you left before the side quest

> **2.** Start another /tld-side-quest
>    Best for: stacking multiple small fixes before committing

> **3.** /tld-save-point — re-load full context for the pending work
>    Best for: not sure what the pending changes are for, need to re-orient

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-commit` or any other skill. Wait for the user to pick an option or type a command.**

**If no pending changes and the user was mid-flow (between /tld-setup and /tld-run-test):**

---

**What's next?** Back to main flow:

> **1.** Resume where you left off — [identify the next skill based on conversation context]
>    Best for: continue the ticket you were working on

> **2.** Start another /tld-side-quest
>    Best for: noticed another small fix

> **3.** /tld-dashboard — see progress before resuming
>    Best for: want the big picture before diving back in

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT resume the previous flow on your own. Wait for the user to pick an option or type a command.**

**If no pending changes and the user had just finished a ticket (post /tld-run-test or /tld-next):**

---

**What's next?**

> **1.** /tld-next — mark done and move to next ticket
>    Best for: standard flow after completing a ticket

> **2.** Start another /tld-side-quest
>    Best for: stacking polish items

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where you landed before moving on

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-next` or any other skill. Wait for the user to pick an option or type a command.**

**If you cannot determine where the user was in the flow:**

---

**What's next?**

> **1.** /tld-save-point — figure out where you are and resume
>    Best for: lost context, need to re-orient

> **2.** Start another /tld-side-quest
>    Best for: keep doing small isolated fixes

> **3.** /tld-dashboard — see overall milestone progress
>    Best for: want the big picture before deciding what to do next

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-save-point` or any other skill. Wait for the user to pick an option or type a command.**

## Edge cases

**Merge conflicts when merging worktree back:** If the main branch moved while the side quest was in progress, report the conflict to the user with specifics. Don't auto-resolve — let them decide.

**Subagent timeout or failure:** Report what happened, keep the worktree alive so nothing is lost, and let the user decide how to proceed.

**User wants to see the diff before approving:** Run `git diff` in the worktree and show it. This is a reasonable ask — don't push back on it.

**Task turns out to be bigger than expected:** If the subagent reports it needs to modify more than 5 files or the scope seems to be growing, flag it: "This is looking bigger than a side quest. Want to continue here, or should we spin up the full TLD flow?"
