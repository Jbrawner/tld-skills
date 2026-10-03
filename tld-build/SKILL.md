---
name: tld-build
description: |
  Green phase: implement the current TLD ticket so the failing tests pass. Use when the user says
  "tld-build", "build it", "implement the ticket". Runs after /tld-write-tests. Does NOT commit.
---

# TLD Build

You are implementing the functionality for the active ticket. This is the GREEN phase of test-led development: tests already exist and are failing, and your job is to write the minimum implementation to make them pass.

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

This skill's ticket and milestone operations are written using neutral adapter names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Jira** (default) — perform each operation per docs/JIRA.md (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Linear** — call the Linear MCP tools directly; they match the adapter names used in this skill. Contract: docs/ADAPTERS.md.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Jira, Linear. See LIMITATIONS.md."
  Do not invent an adapter.

### 1a. Resolve current ticket

**Case A0 — same-session setup context (check this first):** if THIS session already ran a formal `/tld-setup` whose output carries the active ticket (ID, AC, Files to Create/Modify) and nothing since indicates the ticket changed — no `/tld-next`, `/tld-skip`, or `/tld-cancel` has run, and the user has not said otherwise — use that in-conversation context as the current ticket and skip the tracker query below. A session without that context falls through to the cases below unchanged.

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/JIRA.md for Jira, docs/ADAPTERS.md for Linear).

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

**Literal-skip guard:** if the resolved command is the literal `skip` (case-insensitive) or an `echo`-style SKIP placeholder (a command that merely prints "SKIP…" instead of running anything), do NOT execute it — a placebo command only fakes a green run. Treat it as "no runnable suite" and state that in the output. In `/tld-run-test`, this routes to the manual-QA-style verify path instead of a test run.

### 1c. Local DB safety check

**Run the local-DB safety check before any test command or destructive database operation.**

Read `Stack.Database` from `.tld/campaign.md`. It names every local database this project may use, one or more, each by address and, where two projects can share a port, by container (e.g. `Supabase local at 127.0.0.1:54321 (container supabase_db_abc); stack 2 at 127.0.0.1:54621 (container supabase_db_abc_2)`). A lane picks one of them with the prefix its test commands carry.

Work out which database the commands will reach, without opening any file that is a link:
1. **The command prefix.** If a test command begins by sourcing a file (`. <file> &&` or `source <file> &&`), run that prefix in the same command and print the host and port of each database variable it sets, never a key, token or password: `. <file> && env | grep -E '^(SUPABASE_URL|VITE_SUPABASE_URL|DATABASE_URL|SUPABASE_PROJECT_ID|SUPABASE_DB_PORT)=' | sed -E 's#//[^@/]*@#//#'`, or the equivalent for this project's stack. What the prefix sets wins over any file.
2. **The env files.** Where the prefix sets nothing, the tools read the repo's env files (`.env*`, the platform config). `ls -la` each file's folder to see which are links. A real file: read its database URL lines only. A link into another checkout: leave it closed; the checkout hook that made it refuses a file naming a remote host, so the link counts as local and stands for the first database `Stack.Database` names.
3. **The container.** If `Stack.Database` names a container for that database, confirm with `docker ps --format '{{.Names}} {{.Ports}}'` that this container owns its port; two projects can share a port, and only the container name tells them apart.

If the database found names a host that is not `127.0.0.1` or `localhost`, or is one `Stack.Database` does not name, **HARD ABORT immediately**:

```
🛑 ABORT: [Non-local database detected | Database not named by Stack.Database]

Found: [host:port, and the container that owns the port]
Set by: [the prefix file, env file or config that set it]
Campaign Stack.Database: [value from campaign.md]

This skill runs tests or destructive operations against the database.
Refusing to proceed against a database the campaign does not name as local.

Fix: point the commands at a database Stack.Database names. If this one is local and meant to be used, add it to Stack.Database first.
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

Otherwise say in one line which named database the commands reach and what set it, e.g. `Database: stack 2 at 127.0.0.1:54621 (supabase_db_abc_2), set by .tld/lane-2-env.sh`.

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

Run the resolved test command from step 1b. The goal is ALL GREEN — every test that was failing should now pass.

**If some tests fail:** Read the failure output carefully. Fix the implementation (not the tests). Run again. **Hard cap: 3 attempts.** Track which attempt you are on (1, 2, 3) so you have a clear stop condition. Do not retry a fourth time — getting stuck after 3 attempts means the failure is not a small implementation gap, and the right next move is `/tld-align`, a manual fix, or stepping aside via `/tld-side-quest`.

**If tests still fail after the 3rd attempt, STOP.** Do NOT silently keep iterating. Do NOT proceed to commit. Report the failures inline, then present:

---

**What's next?**

> **1.** /tld-align — auto-fix the implementation to match tests
>    Best for: failures look like small implementation gaps

> **2.** Fix manually, then run /tld-run-test again
>    Best for: complex failures you want to debug yourself

> **3.** /tld-side-quest — bail to something else and come back
>    Best for: need a break or a detour to understand the issue

Type **1**, **2**, or **3** to proceed.

**HARD STOP. Do NOT continue past the retry cap without explicit user approval.**

**If tests pass but with warnings:** Note the warnings in your output but don't block on them unless they indicate a real problem.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Output

Report:
- What files were created/modified
- All tests passing (GREEN state confirmed)
- Any concerns or scope questions that came up
- Any warnings from the test run
- This skill does NOT commit. The commit happens when `/tld-run-test` passes.

Then present the options block.

**Pick the (Recommended) marker before rendering:**

Read `.tld/campaign.md` for `Stack.Backend directory` (and treat any path containing "supabase/", "migrations/", or "api/" as backend-side too). Compute the touched-files set from `git diff --name-only` + `git diff --cached --name-only`.

- **Mark `/tld-audit` as (Recommended)** if ANY of the following is true:
  - At least one touched file is under `Stack.Backend directory`.
  - At least one touched file path contains `migrations/`, `supabase/`, `api/`, `auth/`, or `rls/` (case-insensitive).
  - The ticket description or AC mentions any of: `endpoint`, `route`, `RLS`, `policy`, `migration`, `auth`, `permission`, `secret`, `credentials`.
- **Otherwise, mark `/tld-run-test` as (Recommended)** — frontend-only / docs-only / landing-only changes rarely benefit from the audit pass and the verify gate is the right next step.

Only one option gets the `(Recommended)` marker. Resolve the marker BEFORE rendering — substitute the literal string ` (Recommended)` into the chosen option's title and substitute an empty string into the other option's title. Never emit the literal `{run-test-marker}` or `{audit-marker}` to the user. If for any reason you cannot determine which option to mark, omit both markers (render neither as Recommended) rather than leak a placeholder.

Render whichever variant matches:

**If `/tld-audit` is recommended:**

---

**What's next?**

> **1.** /tld-run-test — verify, QA, commit on approval
>    Best for: implementation done, ready for the gate

> **2.** /tld-audit — security and architecture review first (Recommended)
>    Best for: new endpoints, tables, auth changes, or data handling

> **3.** /tld-side-quest — quick fix first
>    Best for: noticed an adjacent issue to handle

Type **1**, **2**, or **3** to proceed.

**If `/tld-run-test` is recommended:**

---

**What's next?**

> **1.** /tld-run-test — verify, QA, commit on approval (Recommended)
>    Best for: implementation done, ready for the gate

> **2.** /tld-audit — security and architecture review first
>    Best for: new endpoints, tables, auth changes, or data handling

> **3.** /tld-side-quest — quick fix first
>    Best for: noticed an adjacent issue to handle

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT run the verification, do NOT commit, do NOT invoke `/tld-run-test`. Wait for the user to pick an option or type a command. Your only job was writing implementation code.**
