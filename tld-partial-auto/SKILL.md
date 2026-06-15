---
name: tld-partial-auto
description: |
  Automated TLD pipeline with two review gates. Use this skill whenever the user says "tld-partial-auto", "tld auto", "auto run", "run the full cycle", or wants to execute the full test-led development pipeline (write tests, review gate, build, verify, commit, QA gate, mark done) with minimal interaction. Requires /tld-setup to have been run first. Chains all TLD phases automatically but STOPS after the RED phase for user review and again before marking Done for manual QA.
---

# TLD Auto

You are running the full TLD pipeline for the active ticket. This chains the RED phase, GREEN phase, verification, commit, and ticket transition into one automated flow, with **two mandatory review gates**.

## Why this exists

The individual TLD skills (`/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-next`) are designed as discrete steps with hard stops between them. This skill chains them together for speed, but keeps the gates that matter: reviewing the test specification before implementation, and manual QA before marking Done.

## Process

### Phase 1: RED — Write Failing Tests

#### 1.1 Load project config

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

#### 1.2 Resolve current ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.

#### 1.3 Resolve test command

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

#### 1.3a Local DB safety check

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

#### 1.4 Manual-QA classification (setup-time)

Classify the active ticket. This determines which phases to run.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

**If MANUAL-QA ticket, skip the rest of Phase 1 (RED), Phase 2 (GREEN), Phase 2.5 (audit), and Phase 3 (drift + commit).** Jump directly to Phase 4 (Manual QA Gate). There are no new tests to write, no code to build, no drift to check, and no changes to commit. The entire purpose is the manual walkthrough + mark Done.

**If CODE ticket**, proceed to 1.5 and continue through all phases as normal.

#### 1.5 Study the patterns

Read the pattern reference files from the setup context. Match the existing test style:
- Same test framework (Vitest, Jest, etc.)
- Same file naming conventions
- Same assertion patterns
- Same fixture/setup patterns

#### 1.6 Write test files

For each acceptance criterion, write test cases that verify it:

- **One AC item = at least one test case.** Every acceptance criterion must have a corresponding test. If an AC item has multiple conditions, write multiple test cases.
- **Test the behavior, not the implementation.** Tests should describe what the system does, not how it does it internally.
- **Include edge cases.** For each happy path, consider: what happens with invalid input? Missing auth? Duplicate data? Boundary values?
- **Name tests descriptively.** Use the pattern: `it('should [expected behavior] when [condition]')`.
- **Keep tests independent.** Each test should set up its own state and not depend on other tests running first.

#### 1.7 Run tests to confirm RED

Run the resolved test command from §1.3. Every new test should fail. This confirms:
- Tests are actually being picked up by the runner
- Tests are testing something real (not accidentally passing)
- The test assertions are correctly written (failing for the right reason)

**If any new test passes:** Flag this to the user. Either the feature already exists or the test isn't testing what it should.

**If tests fail to compile/run at all:** Fix syntax errors, missing imports, etc. The tests should run and produce failing assertions, not crash.

#### 1.8 RED Gate Output

Report to the user:
- How many test files were created/modified
- How many test cases written
- How many AC items covered (and if any are missing, why)
- The test names grouped by AC item, so the user can see the specification at a glance
- Test run summary showing all new tests fail (RED confirmed)

End with the summary line **"RED phase complete. [N] tests written, all failing. Review the test spec above."** then present:

---

**What's next?**

> **1.** Approve — proceed to GREEN phase (Recommended)
>    Best for: tests match the spec, ready to implement

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something unrelated worth doing before building

> **3.** Describe adjustments — refine the test spec
>    Best for: wrong assertion, missing edge case, or unclear expected output

Type **1**, **2**, or **3** to proceed.

### >>> MANDATORY REVIEW GATE 1 — STOP HERE <<<

**HARD STOP.** Do NOT proceed to Phase 2 until the user explicitly approves. Wait for one of:
- Any canonical approval keyword: "approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" (see STANDARDS.md § Approval keyword set for the full definition)
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

Run the resolved test command from §1.3. All tests should pass.

**If some tests fail:** Read the failure output. Fix the implementation (NOT the tests). Run again. Repeat until green. **Hard cap: 3 attempts**.

**If tests still fail after the 3rd attempt, STOP.** Do NOT silently proceed to audit, drift, or commit. Report the failures inline, then present:

---

**What's next?**

> **1.** /tld-align — auto-fix the implementation to match tests
>    Best for: failures look like small implementation gaps

> **2.** Fix manually, then run /tld-run-test
>    Best for: complex failures you want to debug yourself

> **3.** /tld-side-quest — bail to something else and come back
>    Best for: need a detour to understand the issue

Type **1**, **2**, or **3** to proceed.

**HARD STOP. Do NOT continue past the retry cap without explicit user approval.** Wait for a numeric choice or an equivalent command.

---

### Phase 2.5: Security Audit (automatic)

Before running drift check and verification, run the same checks as `/tld-audit` inline:
- Check for frontend code doing backend's job (data mutations, business logic, client-side auth)
- Check for missing auth on new/modified edge functions
- Check for RLS gaps on new/modified tables
- Check for input validation gaps
- Check for data exposure (SELECT *, leaked internals, verbose errors)

Sort findings by severity (HIGH → MEDIUM → LOW) and report inline in the same table format standalone `/tld-audit` uses (# | Severity | Check | File | Finding | Fix).

**If any HIGH severity findings exist, STOP.** Do NOT continue to drift or commit. Present:

---

**What's next?**

> **1.** Fix the findings above, then resume with `/tld-run-test`
>    Best for: standard flow after finding issues

> **2.** /tld-side-quest — address findings in a separate ticket
>    Best for: findings are out of scope for this ticket

> **3.** Skip audit fixes, continue to verify (not recommended)
>    Best for: you disagree with the audit and accept the risk

Type **1**, **2**, or **3** to proceed.

**HARD STOP. Do NOT proceed past HIGH findings without explicit user approval.**

**If MEDIUM findings exist (but no HIGH), STOP and surface them for explicit acknowledgement** — matching standalone `/tld-audit`'s behavior. tld-partial-auto must not silently swallow MEDIUM findings. Present:

---

**What's next?**

> **1.** Acknowledge the MEDIUM findings and continue to Phase 3 (drift + commit)
>    Best for: findings are understood and acceptable for this ticket

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: medium finding worth fixing inline

> **3.** Fix manually, then run /tld-run-test
>    Best for: you want to address the finding before committing

Type **1**, **2**, or **3** to proceed.

**HARD STOP. Do NOT proceed past MEDIUM findings without explicit user acknowledgement.**

**If only LOW or no findings**, note them in the output and continue to Phase 3 without a gate.

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

Read the `Changelog path` from `.tld/campaign.md`'s Stack section. If the value is blank, skip this step. Otherwise, check whether the file at that path was updated; if not, add an entry now documenting what changed and test counts. Projects that use a CI changelog gate will fail without it.

**Do NOT commit yet.** The commit happens after the user approves at the QA gate.

---

### Phase 4: Manual QA Gate + Commit + Transition

#### 4.0 Manual-QA classification (verify-time)

Re-classify the active ticket now that build is done. This catches the case where §1.4 classified the ticket as "code" but the build produced no changes (e.g., the implementation turned out to be a no-op or the spec was already satisfied), in which case Phase 4 should run the manual-walkthrough flow instead of the commit flow.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")
- `git diff` and `git diff --cached` show no uncommitted changes

**Code ticket** — everything else (the default).

If the verify-time classification flips the ticket to manual-QA (most commonly because the build was a no-op), follow the same skip path as §1.4: jump to the manual walkthrough + Done flow at the end of Phase 4 and do not run the commit step. If the classification stays "code", proceed to 4.1 normally.

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
- **Run column:** Show the exact command, URL, or action inline, wrapped in backticks (e.g., `` `curl http://127.0.0.1:54321/functions/v1/foo` ``). Keep it to one line — if the command is too long for a table cell, shorten the variable parts (e.g., `psql ... -f seed-X.sql`) and put the full command in a follow-up Commands section below. Inline is the default; the Commands section is only for commands too long to fit cleanly.
- **Pass if column:** Keep it to one short sentence. Be specific — not "works correctly" but "returns 16 rows with country names".

Guidelines for the test plan:
- **Be concrete.** Give exact URLs, curl commands, or UI paths. No "verify the endpoint works" — say `curl http://127.0.0.1:54321/functions/v1/[your-endpoint]` and what the response should contain.
- **Only include tests that need manual verification.** If something is fully covered by automated tests (like unit logic, error codes, auth checks), skip it. Focus on things a human eye catches better: data shape, ordering, integration between pieces, UI rendering.
- **If the ticket is purely backend logic with no user-facing surface** (like a migration or stored procedure), and automated tests fully cover the AC, say so explicitly: "All AC items are covered by automated tests. No manual QA needed." Then skip the gate.
- **Scale to the ticket.** A simple migration might need 0 manual tests. A new API endpoint might need 2-3. A frontend feature might need 5+. Don't pad.

#### 4.2 QA Gate

**If manual tests are needed:**

End the test plan with the instruction **"Run the manual tests above."** then present:

---

**What's next?**

> **1.** Approve — commit and mark Done (Recommended)
>    Best for: manual QA passed, ready to close out

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: manual QA revealed polish needed elsewhere

> **3.** Describe what failed — I'll help investigate
>    Best for: manual QA caught a real issue

Type **1**, **2**, or **3** to proceed.

**HARD STOP.** Wait for the user to confirm.

- User says any canonical approval keyword ("approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" — see STANDARDS.md § Approval keyword set) → proceed to 4.3
- User says "side quest" or "2" → invoke `/tld-side-quest`, come back to commit after
- User reports a failure → STOP. Tell them which files likely need fixing and suggest running `/tld-align` or fixing manually, then `/tld-run-test`.

**Do NOT interpret silence, partial responses, or questions as approval.**

**If no manual tests needed:**

Say "All AC items are covered by automated tests. No manual QA needed. Committing and marking Done." and proceed directly to 4.3.

#### 4.3 Commit (code tickets only)

**For code tickets**, only after explicit user approval (or no manual tests needed):

1. Stage relevant files: `git add [specific files]` — only files related to this ticket
2. Commit using the `Pattern` from `.tld/campaign.md`'s Commit format section, substituting the ticket ID and title (append ` — TLD verified`). If the campaign's `Co-author` field is non-empty, include that line in the commit trailer. If it is blank, omit the `Co-Authored-By` line entirely.
3. Verify commit succeeded

**Do NOT push.** Confirm with user before pushing (GitHub Actions budget).

**For manual-QA tickets**, skip this step entirely. There are no code changes to commit. Proceed directly to 4.4 (Mark ticket Done).

#### 4.4 Mark ticket Done

Use `save_issue` to set the ticket's state to "Done" in Linear.

#### 4.5 Determine what's next

Runtime state lives in Linear. From the current ticket's `projectMilestone` (captured in §1.2):

1. Call `get_milestone` on that milestone's ID.
2. Parse the `## Order` section using the canonical unanchored algorithm:
   - Find the line matching `^## Order\s*$`.
   - Capture every following line until the next `^## ` header or end-of-description.
   - Within that block, scan line-by-line and take the first regex match of `({prefix}-\d+)` (unanchored, where `{prefix}` is the ticket prefix from campaign Project).
3. The resulting list in line order is the milestone's ticket sequence.

Walk the Order from the current ticket's position forward. For each subsequent entry, look up its status via Linear. **Pick the first ticket whose status is `Todo`.** Skip `Done`, `Canceled`, and `In Progress` — those are not next-up candidates.

- **Next Todo ticket found** → next action is `/tld-setup {next-id}`.
- **No next Todo in this milestone's Order** (every subsequent entry is Done, Canceled, or In Progress) → next action is `/tld-gate {milestoneId}` — substitute the captured `projectMilestone.id` from §1.2 so `/tld-gate` runs against the correct milestone (its no-arg fallback can pick the wrong one in Linear histories with re-opened tickets or parallel work). Never emit the literal text `{milestoneId}`. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly.
- **Order section malformed or missing** → stop and output the same error `/tld-setup` uses: "Milestone's Order section is missing or malformed. Run /milestone-sync to regenerate." Do not attempt to guess.

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
- **Milestone progress:** [X] of [Y] tickets done in milestone [name]

### Next
[next ticket ID or /tld-gate]
```

Context is saved in Linear. The recommended flow is to clear this conversation's stale context and start the next action fresh.

Then present the options. Use Phase 4.5's milestone-Order walk: if the next action is `/tld-gate` (i.e., no next Todo in this milestone's Order), option 1's command becomes `/tld-gate` instead of `/tld-setup [next-ticket-ID]`.

---

**What's next?**

> **1.** Start next action with clean context (Recommended)
>    Best for: standard flow, clean slate for the next ticket or milestone boundary
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup [next-ticket-ID]
```

*(If no next Todo remains in the milestone's Order, use `/tld-gate {milestoneId}` as the command instead — substitute the milestone id captured in §1.2; never emit the literal `{milestoneId}`. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly.)*

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
