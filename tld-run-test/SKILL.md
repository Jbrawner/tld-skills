---
name: tld-run-test
description: |
  Run tests and drift check for the current TLD ticket, then present manual QA and commit on user approval. Use this skill whenever the user says "tld-run-test", "tld run test", "run the tests", "verify and commit", or wants to independently verify that the implementation passes tests and hasn't drifted from the spec. This is the verification gate before committing. Does NOT auto-commit — waits for user approval after manual testing. Always use after /tld-build.
---

# TLD Run Test

You are independently verifying the current ticket's implementation. Your job is to run the tests, check for drift from the spec, and commit if everything is clean. This is the quality gate between implementation and committing to git history.

## Process

### 1. Load context

Get the active ticket context. There is no TLD_ACTIVE.md file. Instead:

1. Check the conversation history for the `/tld-setup` output. It contains the ticket ID, AC, test command, files to modify, and pattern references.
2. If the conversation doesn't have setup context (e.g., after a `/compact`), pull it fresh:
   - Read `docs/EXECUTION_PLAYBOOK.md` to find the current step and ticket
   - Use `get_issue` from Linear to pull the ticket description and AC
   - The compact prompt should contain the active ticket ID

If you cannot determine the active ticket, stop and tell the user to run `/tld-setup` first.

### 1.5. Detect ticket type

Classify the active ticket to determine which path to take.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end"
- "Files to Create/Modify" is "None" or empty
- All AC items describe user actions ("Navigate to...", "Click...", "Verify that...")
- `git diff` and `git diff --cached` show no uncommitted changes

**Code ticket** — everything else (the default).

**If MANUAL-QA ticket, skip steps 2 and 3 and jump directly to step 4 (Manual QA gate).** There are no new tests to run, no files to drift-check, and nothing to commit. The whole purpose is the manual walkthrough.

**If CODE ticket**, proceed to step 2.

### 2. Run the test command

Run the exact test command from the playbook step. Do not modify or skip any tests.

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
- Compare the implementation against the pattern references from the playbook step
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
- **Run column:** Reference commands by number (e.g., "Cmd 1" or "Cmd 1, then 2"). The actual commands go in the Commands section below.
- **Pass if column:** Keep it to one short sentence. Be specific — not "works correctly" but "returns 16 rows with country names".
- **Commands section:** ALWAYS put commands in a numbered section below the table. Each command gets its own fenced code block (```sh) so the user can single-click copy. Format:
  ```
  ### Commands

  **1.** Run the group-open seed script
  ```sh
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f backend/supabase/seed-wc-group-open.sql
  ```

  **2.** Check dates are in future
  ```sh
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "SELECT ..."
  ```
  ```
- **One command per code block.** Never put multiple commands in the same block. Each block = one click to copy.

Guidelines:
- **Be concrete.** Give exact URLs, curl commands, or UI paths.
- **Only include tests that need manual verification.** Skip things fully covered by automated tests. Focus on what a human eye catches better: data shape, integration, UI rendering.
- **If purely backend logic with no user-facing surface** and automated tests fully cover the AC, say so: "All AC items are covered by automated tests. No manual QA needed — reply 'approve' to commit."
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
- "1", "approve", "commit", "lgtm", "looks good", "ship it", or similar affirmative → proceed to step 5
- User describes a problem → report which files likely need fixing, suggest `/tld-align` or manual fix, then re-run `/tld-run-test`
- "2" or "side quest" → invoke `/tld-side-quest`, come back to commit after

**Do NOT interpret silence, partial responses, or questions as approval.**

### 5. Commit (code tickets) or Skip (manual-QA tickets)

**For code tickets**, only after explicit user approval:

1. Stage the relevant files: `git add [specific files]` — only files related to this ticket, not unrelated changes
2. Commit with message format: `feat(2ND-XXX): [ticket title] — TLD verified`
3. Verify the commit succeeded

**For manual-QA tickets**, there is nothing to commit. Skip directly to the output step.

### 6. Output

**On successful commit (code ticket):**

Report:
- Test results summary (all pass)
- Drift check results (clean)
- Commit hash

**Step completion check:** Before presenting options, check if this was the last ticket in its playbook step:
1. Read `docs/EXECUTION_PLAYBOOK.md` to find the step containing the current ticket
2. List all tickets in that step (playbook order)
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the step is Done, append the 4th option below. Otherwise present only the first 3.

Then present the options block:

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

**On manual QA approval (manual-QA ticket, nothing committed):**

Report:
- Manual QA items confirmed
- No changes to commit (manual-QA ticket)

**Step completion check:** Before presenting options, check if this was the last ticket in its playbook step (same logic as the code-ticket branch above: read playbook, list step tickets, query Linear, treat current ticket as Done). If every ticket in the step is Done, append the 4th option below.

Then present the options block:

---

**What's next?**

> **1.** /tld-next — mark ticket done, move to next
>    Best for: manual QA is complete

> **2.** /tld-side-quest — quick fix first
>    Best for: noticed polish during QA

> **3.** /tld-dashboard — review progress before deciding
>    Best for: want to see where this ticket lands in the overall plan

> **4.** /tld-gate — run step boundary gate now
>    Best for: this was the last ticket in the step; ready for step validation
>    *(only shown when every ticket in the current step is Done)*

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
