---
name: tld-align
description: |
  Align implementation to pass failing tests after a /tld-run-test failure. Use this skill whenever the user says "tld-align", "tld align", "align the implementation", "fix the failures", or wants to correct implementation code that failed verification. Reads the failure output and fixes the implementation to match expectations. Does NOT modify tests unless flagged for user decision. Always use after /tld-run-test reports a failure.
---

# TLD Align

You are fixing an implementation that failed `/tld-run-test`. Your job is to read the failure details, understand what went wrong, fix the implementation (not the tests), and get things back on track for another test run.

## Core Principle

**Tests represent the specification. Implementation must conform to tests.**

The default action is always to fix the implementation. Tests should only change if they genuinely misrepresent the acceptance criteria — and that's a decision for the user, not for you.

## Process

### 1. Load context

**1a. Load project config.**

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The tracker, team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.

**1b. Load failure output.**

Check the conversation history for the `/tld-run-test` failure output. It contains:
- Which tests failed (and their error messages)
- Or which drift issues were found
- An analysis of whether the issue is in implementation, tests, or AC interpretation

If there's no failure context in the conversation, stop and tell the user: "No failure output found. Run `/tld-run-test` first."

**1c. Resolve current ticket.**

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.

**1d. Resolve test command.**

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

Use the resolved command for any test run in this skill. Do not invent commands or read any playbook file.

### 2. Diagnose

Categorize each failure into one of three buckets:

**Implementation bug** — The test is correct, the code is wrong. Examples:
- Wrong return value
- Missing error handling
- Incorrect SQL query
- Wrong HTTP status code
- Missing field in response

→ Fix the implementation.

**Drift issue** — Tests pass but implementation doesn't match the spec. Examples:
- Changed files outside the ticket scope
- Missing AC coverage
- Deviated from established patterns

→ Fix the implementation to match the spec.

**Possible test issue** — The test might be wrong. Examples:
- Test expects behavior not described in the AC
- Test has a hardcoded value that doesn't match the ticket spec
- Test setup creates conditions that don't reflect real usage

→ **DO NOT fix the test.** Flag it for the user with this format:

```
⚠️ POSSIBLE TEST ISSUE — needs your decision

Test: [test name]
File: [test file path]
What it expects: [what the test asserts]
What the AC says: [what the acceptance criteria actually states]
The gap: [why these might not match]

Options:
A) Keep the test, fix implementation to match it
B) The test misinterprets the AC — [suggested test change]

Waiting for your call.
```

Stop and wait for the user to decide. Do not proceed with fixes until they respond.

### 3. Fix implementation

For each implementation bug or drift issue:
1. Read the relevant source file
2. Identify the specific lines that need to change
3. Make the fix
4. Briefly note what you changed and why

Do NOT:
- Add features not required by the tests
- Refactor unrelated code
- Change the test files
- Change files outside the ticket scope

### 4. Pre-verify

After making fixes, run the resolved test command from step 1d locally to check if things look better. This isn't the official verification (that's `/tld-run-test`), just a sanity check.

If your fix didn't resolve the failure, diagnose further. Don't just keep making changes blindly — understand why the fix didn't work.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Output

Report:
- How many issues were found
- For each: what was wrong, what was changed, why
- Any flagged test issues waiting for user decision
- Pre-verification results

Then present the options block:

---

**What's next?**

> **1.** /tld-run-test — verify fixes and commit
>    Best for: fixes look complete, ready for verification

> **2.** /tld-audit — security review before verifying
>    Best for: fixes touched auth, validation, or RLS code

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT run `/tld-run-test`, do NOT re-verify, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
