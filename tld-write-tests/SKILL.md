---
name: tld-write-tests
description: |
  Write tests for the current TLD ticket (red phase). Use this skill whenever the user says "tld-write-tests", "tld write tests", "write the tests", or wants to create test files for the active ticket before implementation. This is the red phase of test-led development — tests are written first and should all fail because the implementation doesn't exist yet. Always use after /tld-setup and before /tld-build.
---

# TLD Write Tests

You are writing tests for the active ticket. This is the RED phase of test-led development: every test you write should fail right now because the implementation doesn't exist yet. You are defining the specification through tests.

## Process

### 1. Load context

Get the active ticket context. There is no TLD_ACTIVE.md file. Instead:

1. Check the conversation history for the `/tld-setup` output. It contains the ticket ID, AC, test command, files to modify, and pattern references.
2. If the conversation doesn't have setup context (e.g., after a `/compact`), pull it fresh:
   - Read `docs/EXECUTION_PLAYBOOK.md` to find the current step and ticket
   - Use `get_issue` from Linear to pull the ticket description and AC
   - The compact prompt should contain the active ticket ID

If you cannot determine the active ticket, stop and tell the user to run `/tld-setup` first.

### 2. Study the patterns

Read the pattern reference files identified during setup. Match the existing test style:
- Same test framework (Vitest, Jest, etc.)
- Same file naming conventions
- Same assertion patterns
- Same fixture/setup patterns

### 3. Write test files

For each acceptance criterion, write test cases that verify it. Follow these principles:

- **One AC item = at least one test case.** Every acceptance criterion must have a corresponding test. If an AC item has multiple conditions, write multiple test cases.
- **Test the behavior, not the implementation.** Tests should describe what the system does, not how it does it internally.
- **Include edge cases.** For each happy path, consider: what happens with invalid input? Missing auth? Duplicate data? Boundary values?
- **Name tests descriptively.** Someone reading just the test names should understand the full specification. Use the pattern: `it('should [expected behavior] when [condition]')`.
- **Keep tests independent.** Each test should set up its own state and not depend on other tests running first.

### 4. Run tests to confirm RED

Run the test command from the playbook step. Every new test should fail. This confirms:
- Tests are actually being picked up by the runner
- Tests are testing something real (not accidentally passing)
- The test assertions are correctly written (failing for the right reason)

**If any new test passes:** That's a problem. Either the feature already exists (check if work was already done) or the test isn't actually testing what it should. Flag this to the user.

**If tests fail to compile/run at all:** That's different from failing assertions. Fix syntax errors, missing imports, etc. The tests should run and produce failing assertions, not crash.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Output

Report:
- How many test files were created/modified
- How many test cases written
- How many AC items covered (and if any are missing, why)
- Test run output showing all tests fail (RED state confirmed)

Then present the options block:

---

**What's next?**

> **1.** /tld-build — implement code to make tests pass (green phase)
>    Best for: tests match the spec, ready to build

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something unrelated to polish

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT write implementation code, do NOT start the green phase, do NOT invoke `/tld-build`. Wait for the user to pick an option or type a command. Your only job was writing failing tests.**
