---
name: tld-auto
description: |
  Automated TLD pipeline with two review gates. Use this skill whenever the user says "tld-auto", "tld auto", "auto run", "run the full cycle", or wants to execute the full test-led development pipeline (write tests, review gate, build, verify, commit, QA gate, mark done) with minimal interaction. Requires /tld-setup to have been run first. Chains all TLD phases automatically but STOPS after the RED phase for user review and again before marking Done for manual QA.
---

# TLD Auto

You are running the full TLD pipeline for the active ticket. This chains the RED phase, GREEN phase, verification, commit, and ticket transition into one automated flow, with **two mandatory review gates**.

## Why this exists

The individual TLD skills (`/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-next`) are designed as discrete steps with hard stops between them. This skill chains them together for speed, but keeps the gates that matter: reviewing the test specification before implementation, and manual QA before marking Done.

## Process

### Phase 1: RED — Write Failing Tests

#### 1.1 Load context

Get the active ticket context. There is no TLD_ACTIVE.md file. Instead:

1. Check the conversation history for the `/tld-setup` output. It contains the ticket ID, AC, test command, files to modify, and pattern references.
2. If the conversation doesn't have setup context (e.g., after a `/compact`), pull it fresh:
   - Read `docs/EXECUTION_PLAYBOOK.md` to find the current step and ticket
   - Use `get_issue` from Linear to pull the ticket description and AC
   - The compact prompt should contain the active ticket ID

If you cannot determine the active ticket, stop and tell the user to run `/tld-setup` first.

#### 1.1.5 Detect ticket type

Classify the active ticket. This determines which phases to run.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end"
- "Files to Create/Modify" is "None" or empty
- All AC items describe user actions

**Code ticket** — everything else (the default).

**If MANUAL-QA ticket, skip Phase 1 (RED), Phase 2 (GREEN), Phase 2.5 (audit), and Phase 3 (drift + commit).** Jump directly to Phase 4 (Manual QA Gate). There are no new tests to write, no code to build, no drift to check, and no changes to commit. The entire purpose is the manual walkthrough + mark Done.

**If CODE ticket**, proceed to 1.2 and continue through all phases as normal.

#### 1.2 Study the patterns

Read the pattern reference files from the setup context. Match the existing test style:
- Same test framework (Vitest, Jest, etc.)
- Same file naming conventions
- Same assertion patterns
- Same fixture/setup patterns

#### 1.3 Write test files

For each acceptance criterion, write test cases that verify it:

- **One AC item = at least one test case.** Every acceptance criterion must have a corresponding test. If an AC item has multiple conditions, write multiple test cases.
- **Test the behavior, not the implementation.** Tests should describe what the system does, not how it does it internally.
- **Include edge cases.** For each happy path, consider: what happens with invalid input? Missing auth? Duplicate data? Boundary values?
- **Name tests descriptively.** Use the pattern: `it('should [expected behavior] when [condition]')`.
- **Keep tests independent.** Each test should set up its own state and not depend on other tests running first.

#### 1.4 Run tests to confirm RED

Run the test command from the playbook step. Every new test should fail. This confirms:
- Tests are actually being picked up by the runner
- Tests are testing something real (not accidentally passing)
- The test assertions are correctly written (failing for the right reason)

**If any new test passes:** Flag this to the user. Either the feature already exists or the test isn't testing what it should.

**If tests fail to compile/run at all:** Fix syntax errors, missing imports, etc. The tests should run and produce failing assertions, not crash.

#### 1.5 RED Gate Output

Report to the user:
- How many test files were created/modified
- How many test cases written
- How many AC items covered (and if any are missing, why)
- The test names grouped by AC item, so the user can see the specification at a glance
- Test run summary showing all new tests fail (RED confirmed)

End with: **"RED phase complete. [N] tests written, all failing. Review the test spec above. Reply 'go' to proceed with build, or give feedback to adjust."**

### >>> MANDATORY REVIEW GATE 1 — STOP HERE <<<

**HARD STOP.** Do NOT proceed to Phase 2 until the user explicitly approves. Wait for one of:
- "go", "looks good", "proceed", "lgtm", "approved", "continue", "ship it", or similar affirmative
- Feedback/changes — make the requested adjustments to tests, re-run to confirm RED, then present the gate again

**If the user gives feedback:** Modify the tests as requested, re-run to confirm they still fail, and present the RED Gate Output again. Repeat until the user approves.

**Do NOT interpret silence, partial responses, or questions as approval.** Only an explicit affirmative moves to Phase 2.

---

### Phase 2: GREEN — Build Implementation

This phase runs ONLY after the user approves at the review gate.

#### 2.1 Read the tests

Before writing any implementation, re-read every test file. The tests ARE the specification. Understand:
- What endpoints/functions are expected
- What inputs and outputs are defined
- What error cases are handled
- What data structures are expected

#### 2.2 Implement

Write the implementation code to make all tests pass:

- **Write the minimum code to pass the tests.** Don't add features, utilities, or abstractions that aren't tested.
- **Match existing patterns.** Use the same code style, directory structure, naming conventions, and architectural patterns as the existing codebase.
- **Respect the ticket scope.** Only create/modify files listed in the ticket's "Files to Create/Modify." If you need to change files outside this list, flag it.
- **Handle shared utilities carefully.** Use existing `_shared/` modules. Don't create new ones unless the ticket explicitly calls for it.

#### 2.3 Run tests to confirm GREEN

Run the test command from the playbook step. All tests should pass.

**If some tests fail:** Read the failure output. Fix the implementation (NOT the tests). Run again. Repeat until green. Up to 3 attempts. If still failing after 3 attempts, stop and report failures to the user, suggest running `/tld-align`.

---

### Phase 2.5: Security Audit (automatic)

Before running drift check and verification, run the same checks as `/tld-audit` inline:
- Check for frontend code doing backend's job (data mutations, business logic, client-side auth)
- Check for missing auth on new/modified edge functions
- Check for RLS gaps on new/modified tables
- Check for input validation gaps
- Check for data exposure (SELECT *, leaked internals, verbose errors)

If any HIGH severity findings are detected, report them inline and **STOP**. Present:

**What's next?**

> **1.** Fix the findings above, then resume with `/tld-run-test`
> **2.** Skip audit fixes, continue to verify (not recommended)

Type **1** or **2** to proceed.

If only MEDIUM/LOW or no findings, note them in the output and continue to Phase 3.

---

### Phase 3: Verify + Commit

#### 3.1 Drift check

Run a drift check to catch cases where tests pass but implementation doesn't match the ticket spec:

**File scope check:**
- `git diff --name-only` and `git diff --name-only --cached`
- Compare against "Files to Create/Modify" from the ticket
- Flag unexpected changes or missing work

**AC coverage check:**
- Walk each acceptance criterion from the ticket
- Confirm at least one passing test per AC item
- Flag any uncovered AC items

**Pattern conformance check:**
- Compare implementation against pattern references
- Flag significant deviations

**If drift detected:** Do NOT commit. Report the drift findings inline. Tell the user what needs to change. End with: **"Tests pass but drift detected. Review findings above. Run `/tld-align` or fix manually, then `/tld-run-test`."** STOP here.

#### 3.2 Update CHANGE_LOG.md

Check if this ticket touches `backend/`. If so, check whether `backend/CHANGE_LOG.md` was updated. If not, add an entry now documenting what changed and test counts. This is required or CI will fail.

**Do NOT commit yet.** The commit happens after the user approves at the QA gate.

---

### Phase 4: Manual QA Gate + Commit + Transition

#### 4.1 Generate manual test plan

Before committing, present a manual QA checklist for the user. Analyze the ticket's acceptance criteria and the implementation to produce a test plan written as if for a manual QA tester who has never seen the code. **Use a table format for scannability — no walls of text.**

The test plan format:

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

Guidelines for the test plan:
- **Be concrete.** Give exact URLs, curl commands, or UI paths. No "verify the endpoint works" — say `curl http://127.0.0.1:54321/functions/v1/tournament?type=world_cup` and what the response should contain.
- **Only include tests that need manual verification.** If something is fully covered by automated tests (like unit logic, error codes, auth checks), skip it. Focus on things a human eye catches better: data shape, ordering, integration between pieces, UI rendering.
- **If the ticket is purely backend logic with no user-facing surface** (like a migration or stored procedure), and automated tests fully cover the AC, say so explicitly: "All AC items are covered by automated tests. No manual QA needed." Then skip the gate.
- **Scale to the ticket.** A simple migration might need 0 manual tests. A new API endpoint might need 2-3. A frontend feature might need 5+. Don't pad.

#### 4.2 QA Gate

**If manual tests are needed:**

End the test plan with: **"Run the manual tests above. Reply 'approve' to commit and mark Done, or report what failed. You can also say 'side quest' to handle a quick fix before committing."**

**HARD STOP.** Wait for the user to confirm.

- User says "approve", "done", "commit", "lgtm", "looks good", "ship it", etc. → proceed to 4.3
- User says "side quest" or "2" → invoke `/tld-side-quest`, come back to commit after
- User reports a failure → STOP. Tell them which files likely need fixing and suggest running `/tld-align` or fixing manually, then `/tld-run-test`.

**Do NOT interpret silence, partial responses, or questions as approval.**

**If no manual tests needed:**

Say "All AC items are covered by automated tests. No manual QA needed. Committing and marking Done." and proceed directly to 4.3.

#### 4.3 Commit (code tickets only)

**For code tickets**, only after explicit user approval (or no manual tests needed):

1. Stage relevant files: `git add [specific files]` — only files related to this ticket
2. Commit with format: `feat(2ND-XXX): [ticket title] — TLD verified`
   Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
3. Verify commit succeeded

**Do NOT push.** Confirm with user before pushing (GitHub Actions budget).

**For manual-QA tickets**, skip this step entirely. There are no code changes to commit. Proceed directly to 4.4 (Mark ticket Done).

#### 4.4 Mark ticket Done

Use `save_issue` to set the ticket's state to "Done" in Linear.

#### 4.5 Determine what's next

Read `docs/EXECUTION_PLAYBOOK.md`. Find the current step and ticket position.

- **More tickets in step:** Identify next ticket ID
- **Last ticket in step:** Next action is `/tld-gate`

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately. For option "1" involving `/compact`, remind the user to paste the compact prompt shown above.

#### 4.6 Final Output

Report the full run summary:

```
## TLD Auto — Complete

### Ticket: [ID] — [title]
- **RED:** [N] tests written across [M] files
- **GREEN:** [N] files created/modified
- **Verify:** All tests pass, no drift
- **Commit:** [hash]
- **Linear:** Marked Done
- **Step progress:** [X] of [Y] tickets done in Step [N]

### Next
[next ticket ID or /tld-gate]
```

Context is saved in Linear and the playbook. The recommended flow is to clear this conversation's stale context and start the next action fresh.

Then present the options. Use Phase 4.5's step-completion result: if the next action is `/tld-gate` (i.e., this was the last ticket in the step), option 1's command becomes `/tld-gate` instead of `/tld-setup [next-ticket-ID]`.

---

**What's next?**

> **1.** Start next action with clean context (Recommended)
>    Best for: standard flow, clean slate for the next step
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup [next-ticket-ID]
```

*(If this was the last ticket in the step, use `/tld-gate` as the command instead.)*

> **2.** /tld-dashboard — review overall progress first
>    Best for: want the big picture before deciding

> **3.** /tld-side-quest — handle a quick fix before moving on
>    Best for: noticed polish to handle before next ticket

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

---

## Error Handling

At any point if something goes critically wrong, STOP and report everything that was completed successfully before the failure so the user knows where to pick up. Then present the relevant options:

- **Tests won't compile after 2 fix attempts:** STOP. Report the compilation errors.

  **What's next?**
  > **1.** Fix manually, then run /tld-run-test

- **Tests fail after 3 green-phase attempts:** STOP. Report failures inline.

  **What's next?**
  > **1.** /tld-align — auto-fix the implementation to match tests
  > **2.** Fix manually, then run /tld-run-test

- **Drift detected:** STOP. Report drift inline.

  **What's next?**
  > **1.** /tld-align — fix drift issues
  > **2.** Fix manually, then run /tld-run-test

- **Linear API fails:** Note it, continue with the rest. The user can mark Done manually.
- **Git commit fails:** STOP. Report the error. Do not retry destructive git operations.

  **What's next?**
  > **1.** Fix manually, then run /tld-run-test

Type the number to proceed.
