---
name: tld-gate
description: |
  Run a phase/step boundary gate check for TLD. Use this skill whenever the user says "tld-gate", "tld gate", "run gate check", "gate check", or has finished all tickets in a playbook step and needs full regression, consistency, and drift validation before moving to the next step. This is the heavyweight verification that runs at phase boundaries — not after every ticket. Operates ONLY against local database. Always use when /tld-next says to.
---

# TLD Gate

You are running a phase boundary gate check. This is the heavyweight verification that runs after completing all tickets in a playbook step. It validates that everything built in this step works together, hasn't drifted from spec, and provides a solid foundation for the next step.

## SAFETY: Local Database Only

**This is the first thing you check. Before ANY database operation, before anything else.**

Verify the Supabase connection is pointed at the local instance:
1. Check for `127.0.0.1:54321` or `localhost:54321` in the Supabase config
2. Check environment variables for any database URLs
3. If you find ANY reference to a non-local database (anything that is not `127.0.0.1` or `localhost`), **HARD ABORT immediately**:

```
🛑 ABORT: Non-local database detected.

Found: [the URL/host that's not local]
Location: [where you found it]

This gate check runs destructive operations (db reset, seed). 
Refusing to proceed against a non-local database.

Fix: Ensure SUPABASE_URL or equivalent points to 127.0.0.1:54321
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

## Inputs

The user may provide:
- A step number — run the gate for that step
- Nothing — read from the playbook to determine which step was just completed (find the last step where all tickets are Done)

## Process

### 1. Safety check (above)

### 2. Identify the completed step

Read the playbook (`docs/EXECUTION_PLAYBOOK.md`). Determine which step this gate is for. List all tickets in that step and confirm they are all Done in Linear (use `list_issues` or `get_issue` for each).

If any ticket in the step is NOT Done, stop and report which ones are missing.

### 3. Full regression test

Run the test command from the playbook step. This should run ALL tests, not just the ones from the last ticket.

If the step's test command is backend-only (`cd backend && npm run test:run`), run that.
If it's frontend-only (`cd frontend-next && npm test`), run that.
If it's both (`cd frontend-next && npm test && cd ../backend && npm run test:run`), run both.

Also run any earlier steps' test commands to catch regressions across steps. The gate verifies the cumulative state, not just the current step.

Capture full output.

### 4. Cross-ticket consistency check

Look across all tickets completed in this step for consistency:

**Database consistency (for steps with migrations):**
- Run `supabase db reset` to verify all migrations apply cleanly in sequence
- Check that tables, columns, constraints, and indexes match what tickets specified
- Verify RLS policies are in place for any new tables

**Edge function consistency (for steps with functions):**
- Verify each function references tables/columns that actually exist
- Check that `_shared/` imports resolve correctly
- Verify auth patterns are consistent across functions

**Frontend consistency (for steps with components):**
- Verify imports resolve — no broken references between new components
- Check that API client calls match actual edge function endpoints
- Verify route structure matches the route table

**Cross-step dependencies:**
- If this step's tickets depend on previous steps, verify those integrations still work
- Run a quick smoke test of the previous step's core functionality

### 5. Drift check

Compare actual state against expected state from the ticket specs:

**Schema drift:**
- Compare actual DB schema (from `supabase db dump` or introspection) against what the tickets specified
- Report any columns, tables, or constraints that are missing, extra, or different

**File drift:**
- List all files created/modified across the step's tickets
- Check for any unexpected files that were created but aren't referenced in any ticket
- Check for any expected files that are missing

**For each drift item, output a specific fix action:**

```markdown
### Drift: [brief description]

**What:** [what's wrong]
**Expected:** [what the spec says should be there]  
**Actual:** [what's actually there]
**Fix:** [exact command or code change to resolve this]
```

Don't just report "drift detected" — tell the user exactly what to do about it.

### 6. Gate verdict

**PASS** — All tests green, no consistency issues, no drift.
**FAIL** — Report every issue with fix actions.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 7. Output

```markdown
# Gate Report: Step [N] — [step name]

## Safety
Local database confirmed (127.0.0.1:54321)

## Tickets
[list each ticket with Done status confirmed]

## Test Results
[summary — X tests, all pass / N failures]
[if failures, list them with details]

## Consistency
[findings from cross-ticket checks, or "No issues found"]

## Drift
[findings with fix actions, or "No drift detected"]

## Verdict: [PASS / FAIL]
[if FAIL: list all issues with fix actions]

## Next Step
[Read from playbook — what's the next step?]
Step [N+1]: [step name]
First ticket: [ticket ID]
```

Context is saved in Linear and the playbook. The recommended flow is to clear this conversation's stale context and start the first ticket of the next step fresh.

Then present the options:

**On PASS:**

---

**What's next?**

> **1.** Start next step with clean context (Recommended)
>    Best for: standard flow, clean slate for Step [N+1]'s first ticket
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup [first-ticket-ID]
```

> **2.** /tld-dashboard — review overall progress
>    Best for: want the big picture before deciding

> **3.** /tld-side-quest — polish before moving on
>    Best for: noticed cross-ticket cleanup from the gate

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup`, do NOT start the next step, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

**On FAIL:**

---

**What's next?**

> **1.** Fix the issues listed above, then run /tld-gate again
>    Best for: issues are clear and in scope

> **2.** /tld-side-quest — address issues in separate side quest(s)
>    Best for: issues are cross-ticket or need separate tracking

> **3.** /tld-dashboard — see scope of issues in playbook context
>    Best for: want to understand blast radius before fixing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT fix issues yourself, do NOT re-run the gate, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

If this was the last step in the playbook (Step 15), replace the options with:

---

**All steps complete.** Full project gate review recommended before launch.
