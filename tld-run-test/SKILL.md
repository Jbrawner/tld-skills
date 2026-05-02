---
name: tld-run-test
description: |
  Run tests and drift check for the current TLD ticket, then present manual QA and commit on user approval. Use this skill whenever the user says "tld-run-test", "tld run test", "run the tests", "verify and commit", or wants to independently verify that the implementation passes tests and hasn't drifted from the spec. This is the verification gate before committing. Does NOT auto-commit — waits for user approval after manual testing. Always use after /tld-build.
---

# TLD Run Test

You are independently verifying the current ticket's implementation. Your job is to run the tests, check for drift from the spec, and commit if everything is clean. This is the quality gate between implementation and committing to git history.

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

### 1a. Resolve current ticket

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 1b. Resolve test command

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

Use the resolved command for any test run in this skill. Do not invent commands.

### 1c. Local DB safety check

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

### 1.5. Manual-QA classification (verify-time)

Classify the active ticket to determine which path to take.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")
- `git diff` and `git diff --cached` show no uncommitted changes

**Code ticket** — everything else (the default).

**If MANUAL-QA ticket, skip steps 2 and 3 and jump directly to step 4 (Manual QA gate).** There are no new tests to run, no files to drift-check, and nothing to commit. The whole purpose is the manual walkthrough.

**If CODE ticket**, proceed to step 2.

### 2. Run the test command

Run the resolved test command from step 1b. Do not modify or skip any tests.

Capture the full output.

**If tests fail:** Do NOT commit. Report the failure details directly in the conversation:

- Which tests failed and their error messages
- Your assessment: is this an implementation bug, a test bug, or an AC ambiguity?

Then tell the user: **"Tests failed. Run `/tld-align` to fix implementation, or fix manually."**

Stop here on failure. Do not proceed to drift check or commit.

### 3. Drift check

If tests pass, run a drift check. This catches cases where tests pass but the implementation doesn't actually match the ticket spec. Check:

**File scope check:**
- List all files modified since the last commit (`git diff --name-only` and `git diff --name-only --cached`)
- Compare against the "Files to Create/Modify" list from the ticket
- Flag any files that were changed but aren't in the expected list (unexpected changes)
- Flag any files that should have been created/modified but weren't (missing work)

**AC coverage check:**
- Walk through each acceptance criterion from the ticket
- For each AC item, confirm there is at least one passing test that specifically verifies it
- Flag any AC items that don't have clear test coverage

**Pattern conformance check:**
- Compare the implementation against the pattern references from the ticket
- Flag significant deviations from established patterns (different naming conventions, different error handling approach, different file structure)

**If drift is detected:** Do NOT commit. Report the drift findings directly in the conversation with specific fix actions for each issue.

Then tell the user: **"Tests pass but drift detected. Run `/tld-align` or fix manually."**

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 4. Manual QA gate (tests pass, no drift)

If tests pass AND no drift detected, do NOT commit yet. Present a manual test checklist so the user can verify before anything goes into git history.

Generate a manual QA checklist based on the ticket's acceptance criteria and the implementation. Write it as if for a tester who hasn't seen the code. **Use a table format for scannability — no walls of text.**

```
## Manual QA — [ticket ID]

**What changed:** [1-2 sentence plain-English summary from a user perspective]

**Prerequisites:** [Local Supabase running, seeded data, env vars, etc. — or "None" if not needed]

### Test Steps

| # | Test | Run | Pass if |
|---|------|-----|---------|
| 1 | [behavior being verified] | `[exact command, URL, or action]` | [concrete expected result] |
| 2 | [behavior being verified] | `[exact command, URL, or action]` | [concrete expected result] |
| 3 | [behavior being verified] | `[exact command, URL, or action]` | [concrete expected result] |

### Edge cases to poke at
- [optional: anything worth trying manually that automated tests can't cover]
```

**Table formatting rules:**
- **Run column:** Show the exact command, URL, or action inline, wrapped in backticks (e.g., `` `curl http://127.0.0.1:54321/functions/v1/foo` ``). Keep it to one line — if the command is too long for a table cell, shorten the variable parts (e.g., `psql ... -f seed-X.sql`) and put the full command in a follow-up Commands section below. Inline is the default; the Commands section is only for commands too long to fit cleanly.
- **Pass if column:** Keep it to one short sentence. Be specific — not "works correctly" but "returns 16 rows with country names".

Guidelines:
- **Be concrete.** Give exact URLs, curl commands, or UI paths.
- **Only include tests that need manual verification.** Skip things fully covered by automated tests. Focus on what a human eye catches better: data shape, integration, UI rendering.
- **If purely backend logic with no user-facing surface** and automated tests fully cover the AC, say so: "All AC items are covered by automated tests. No manual QA needed." Then still present the standard numbered "What's next?" block so the user can approve, detour to a side quest, or flag an issue.
- **Scale to the ticket.** Don't pad.

Then present the options:

**If this is a CODE ticket (has uncommitted changes to commit):**

---

**What's next?**

> **1.** Approve — commit the changes
>    Best for: manual QA passed, ready to commit

> **2.** /tld-side-quest — quick fix before committing
>    Best for: manual QA revealed polish needed (run /tld-commit after to resume)

> **3.** Describe what failed — I'll fix it
>    Best for: manual QA caught a real issue

Type **1**, **2**, or **3** to proceed.

**If this is a MANUAL-QA ticket (nothing to commit):**

---

**What's next?**

> **1.** Approve — mark ticket Done
>    Best for: manual QA passed, ready to close out

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: manual QA revealed polish needed elsewhere

> **3.** Describe what failed — I'll help investigate
>    Best for: manual QA caught a real issue

Type **1**, **2**, or **3** to proceed.

### >>> MANDATORY APPROVAL GATE — STOP HERE <<<

**HARD STOP.** Do NOT commit or mark Done until the user explicitly approves. Wait for one of:
- Any canonical approval keyword: "approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" (see STANDARDS.md § Approval keyword set) → proceed to step 5
- User describes a problem → report which files likely need fixing, suggest `/tld-align` or manual fix, then re-run `/tld-run-test`
- "2" or "side quest" → invoke `/tld-side-quest`, come back to commit after

**Do NOT interpret silence, partial responses, or questions as approval.**

### 4.5. Update CHANGE_LOG.md

Read the `Changelog path` from `.tld/campaign.md`'s Stack section. If the value is blank, skip this step. Otherwise, check whether the file at that path was updated; if not, add an entry now documenting what changed and test counts. Projects that use a CI changelog gate will fail without it.

### 5. Commit (code tickets) or Skip (manual-QA tickets)

**For code tickets**, only after explicit user approval:

1. Stage the relevant files: `git add [specific files]` — only files related to this ticket, not unrelated changes. Include the changelog file from step 4.5 if it was updated.
2. Commit using the `Pattern` from `.tld/campaign.md`'s Commit format section, substituting the ticket ID and title (append ` — TLD verified`). If the campaign's `Co-author` field is non-empty, include that line in the commit trailer; if blank, omit it.
3. Verify the commit succeeded

**For manual-QA tickets**, there is nothing to commit. Skip directly to the output step.

### 6. Output

**On successful commit (code ticket):**

Report:
- Test results summary (all pass)
- Drift check results (clean)
- Commit hash

### Milestone completion check

Before presenting options, check if this was the last ticket in its milestone:
1. Read the current ticket via `get_issue` and note its `projectMilestone`
2. Read that milestone's description via `get_milestone` and parse the `## Order` section for the ticket sequence
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the milestone is Done, append the 4th option below. Otherwise present only the first 3.
6. When appending option 4, substitute the milestone's actual `id` into the `{milestoneId}` placeholder BEFORE rendering — never emit the literal text `{milestoneId}` to the user. If you cannot capture the id (e.g., the `get_milestone` call failed), do NOT render option 4; fall back to the 3-option block.

Then present the options block:

---

**What's next?**

> **1.** /tld-next — mark ticket done, move to next
>    Best for: ticket is fully complete

> **2.** /tld-side-quest — quick fix first
>    Best for: noticed something to polish before moving on

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where this ticket lands in the overall plan

> **4.** /tld-gate {milestoneId} — run milestone-boundary gate now
>    Best for: this was the last ticket in the milestone; ready for milestone validation
>    *(only shown when every ticket in the current milestone is Done or Canceled; substitute the milestone's actual `id`)*

Type **1**, **2**, **3**, or **4** to proceed.

**On manual QA approval (manual-QA ticket, nothing committed):**

Report:
- Manual QA items confirmed
- No changes to commit (manual-QA ticket)

### Milestone completion check

Before presenting options, check if this was the last ticket in its milestone:
1. Read the current ticket via `get_issue` and note its `projectMilestone`
2. Read that milestone's description via `get_milestone` and parse the `## Order` section for the ticket sequence
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the milestone is Done, append the 4th option below. Otherwise present only the first 3.
6. When appending option 4, substitute the milestone's actual `id` into the `{milestoneId}` placeholder BEFORE rendering — never emit the literal text `{milestoneId}` to the user. If you cannot capture the id (e.g., the `get_milestone` call failed), do NOT render option 4; fall back to the 3-option block.

Then present the options block:

---

**What's next?**

> **1.** /tld-next — mark ticket done, move to next
>    Best for: manual QA is complete

> **2.** /tld-side-quest — quick fix first
>    Best for: noticed polish during QA

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where this ticket lands in the overall plan

> **4.** /tld-gate {milestoneId} — run milestone-boundary gate now
>    Best for: this was the last ticket in the milestone; ready for milestone validation
>    *(only shown when every ticket in the current milestone is Done or Canceled; substitute the milestone's actual `id`)*

Type **1**, **2**, **3**, or **4** to proceed.

**On failure (tests fail OR drift detected — before QA gate):**

Report:
- Test failure output or drift findings (reported inline, no file written)

Then present the options block:

---

**What's next?**

> **1.** /tld-align — auto-fix the implementation to match tests
>    Best for: failures look like small implementation gaps

> **2.** Fix manually, then run /tld-run-test again
>    Best for: complex failures you want to debug yourself

> **3.** /tld-side-quest — bail to something else and come back
>    Best for: need a break or a detour to understand the issue

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT proceed to `/tld-next`, do NOT fix failures yourself, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
