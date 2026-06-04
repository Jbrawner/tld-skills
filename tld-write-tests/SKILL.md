---
name: tld-write-tests
description: |
  Write tests for the current TLD ticket (red phase). Use this skill whenever the user says "tld-write-tests", "tld write tests", "write the tests", or wants to create test files for the active ticket before implementation. This is the red phase of test-led development — tests are written first and should all fail because the implementation doesn't exist yet. Always use after /tld-setup and before /tld-build.
---

# TLD Write Tests

You are writing tests for the active ticket. This is the RED phase of test-led development: every test you write should fail right now because the implementation doesn't exist yet. You are defining the specification through tests.

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

### 1a. Resolve current ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 1b. Resolve test command

Determine the affected directory scope:
1. Collect the union of:
   a. Files listed in the ticket's "Files to Create/Modify" section.
   b. Uncommitted paths from `git diff --name-only` and `git diff --name-only --cached` (typically empty in the RED phase — that is fine).
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

Run the resolved test command from step 1b. Every new test should fail. This confirms:
- Tests are actually being picked up by the runner
- Tests are testing something real (not accidentally passing)
- The test assertions are correctly written (failing for the right reason)

**If any new test passes:** That's a problem. Either the feature already exists (check if work was already done) or the test isn't actually testing what it should. Flag this to the user.

> ⚠️ One or more new tests passed unexpectedly. The implementation may already exist, or the test isn't actually exercising the new behavior.
>
> **What's next?**
>
> > **1.** Investigate the passing tests — they may be testing existing code or be tautologies
> >
> > **2.** /tld-build — proceed anyway (only if you're sure the test is correct)
> >
> > **3.** /tld-side-quest — handle a quick adjustment to the test first
>
> **HARD STOP: Do NOT invoke /tld-build automatically. Wait for the user to pick an option or type a command.**

**If tests fail to compile/run at all:** That's different from failing assertions. Fix syntax errors, missing imports, etc. The tests should run and produce failing assertions, not crash.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

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
