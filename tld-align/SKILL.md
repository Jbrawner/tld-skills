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

### 1. Load failure context

Check the conversation history for the `/tld-run-test` failure output. It contains:
- Which tests failed (and their error messages)
- Or which drift issues were found
- An analysis of whether the issue is in implementation, tests, or AC interpretation

Also get the ticket context from the conversation (from `/tld-setup` output) or pull fresh from Linear + playbook if needed.

If there's no failure context in the conversation, stop and tell the user: "No failure output found. Run `/tld-run-test` first."

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

After making fixes, run the test command from the playbook step locally to check if things look better. This isn't the official verification (that's `/tld-run-test`), just a sanity check.

If your fix didn't resolve the failure, diagnose further. Don't just keep making changes blindly — understand why the fix didn't work.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

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
