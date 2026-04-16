---
name: tld-build
description: |
  Implement the functionality for the current TLD ticket (green phase). Use this skill whenever the user says "tld-build", "tld build", "build it", "implement the ticket", or wants to write the actual implementation code to make failing tests pass. This is the green phase — tests already exist and are failing, and you write the code to make them pass. Always use after /tld-write-tests. Does NOT commit.
---

# TLD Build

You are implementing the functionality for the active ticket. This is the GREEN phase of test-led development: tests already exist and are failing, and your job is to write the minimum implementation to make them pass.

## Process

### 1. Load context

Get the active ticket context. There is no TLD_ACTIVE.md file. Instead:

1. Check the conversation history for the `/tld-setup` output. It contains the ticket ID, AC, test command, files to modify, and pattern references.
2. If the conversation doesn't have setup context (e.g., after a `/compact`), pull it fresh:
   - Read `docs/EXECUTION_PLAYBOOK.md` to find the current step and ticket
   - Use `get_issue` from Linear to pull the ticket description and AC
   - The compact prompt should contain the active ticket ID

If you cannot determine the active ticket, stop and tell the user to run `/tld-setup` first.

### 2. Read the tests

Before writing any implementation, read every test file created during `/tld-write-tests`. The tests ARE the specification. Understand:
- What endpoints/functions are expected
- What inputs and outputs are defined
- What error cases are handled
- What data structures are expected

### 3. Implement

Write the implementation code to make all tests pass. Follow these principles:

- **Write the minimum code to pass the tests.** Don't add features, utilities, or abstractions that aren't tested. If something isn't covered by a test, it doesn't belong here.
- **Match existing patterns.** Read the pattern reference files from the setup context. Use the same code style, directory structure, naming conventions, and architectural patterns as the existing codebase.
- **Respect the ticket scope.** Only create/modify files listed in the ticket's "Files to Create/Modify." If you find yourself needing to change files outside this list, stop and flag it — that's scope creep.
- **Handle shared utilities carefully.** If the ticket mentions `_shared/` modules, use the existing ones. Don't create new shared utilities unless the ticket explicitly calls for it.

For different ticket types:
- **Migrations:** Write the SQL migration file. Ensure it's idempotent where possible.
- **Edge Functions:** Create the function directory and index.ts. Wire up routes, validation, auth.
- **Stored Procedures:** Write the SQL function. Include proper error handling and RLS considerations.
- **Frontend Components:** Create the React component files. Use existing design patterns from the codebase.
- **Tests/QA tickets:** These are already handled by `/tld-write-tests`. Build should focus on any supporting infrastructure.

### 4. Run tests

Run the test command from the playbook step. The goal is ALL GREEN — every test that was failing should now pass.

**If some tests fail:** Read the failure output carefully. Fix the implementation (not the tests). Run again. Repeat until green.

**If tests pass but with warnings:** Note the warnings in your output but don't block on them unless they indicate a real problem.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Output

Report:
- What files were created/modified
- All tests passing (GREEN state confirmed)
- Any concerns or scope questions that came up
- Any warnings from the test run
- This skill does NOT commit. The commit happens when `/tld-run-test` passes.

Then present the options block:

---

**What's next?**

> **1.** /tld-run-test — verify, QA, commit on approval
>    Best for: implementation done, ready for the gate

> **2.** /tld-audit — security and architecture review first
>    Best for: new endpoints, tables, auth changes, or data handling

> **3.** /tld-side-quest — quick fix first
>    Best for: noticed an adjacent issue to handle

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT run the verification, do NOT commit, do NOT invoke `/tld-run-test`. Wait for the user to pick an option or type a command. Your only job was writing implementation code.**
