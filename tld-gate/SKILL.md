---
name: tld-gate
description: |
  Run a milestone boundary gate check for TLD. Use this skill whenever the user says "tld-gate", "tld gate", "run gate check", "gate check", or has finished all tickets in a milestone and needs full regression, consistency, and drift validation before moving to the next milestone. Accepts an optional milestone ID argument (`/tld-gate {milestoneId}`) which `/tld-next` emits automatically. This is the heavyweight verification that runs at milestone boundaries — not after every ticket. Operates ONLY against local database. Always use when /tld-next says to.
---

# TLD Gate

You are running a milestone boundary gate check. This is the heavyweight verification that runs after completing all tickets in a Linear milestone. It validates that everything built in this milestone works together, hasn't drifted from spec, and provides a solid foundation for the next milestone.

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

### 2. Local DB safety check

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

### 3. Identify the completed milestone

There are two modes here. Mode A is the safe, recommended path; Mode B is a fallback that can pick the wrong milestone in some Linear histories.

**Mode A — milestone ID provided as an argument (recommended):**

If the user invoked `/tld-gate {milestoneId}` (this is how `/tld-next` calls it), use that ID directly. Call `get_milestone` on it to load the full description. This is the authoritative path — it cannot pick the wrong milestone.

**Mode B — no argument provided (fallback, with warning):**

Query Linear for tickets in the configured project with status = "Done", sorted by `completedAt` descending. Take the first result — that ticket's `projectMilestone` is the milestone being gated.

Before proceeding, emit this warning:

```
⚠️ No milestone ID was provided to /tld-gate. Falling back to "most recent
Done ticket's milestone" — this can pick the WRONG milestone if Linear has
re-opened tickets, manually-flipped statuses, or parallel work across
milestones.

Recommended: re-run as `/tld-gate {milestoneId}` to gate a specific milestone.
`/tld-next` always emits the correct ID automatically.

Continuing in fallback mode against milestone: {name} ({id})
```

**Edge case — no Done tickets exist yet (Mode B only):** Stop and output:
  "No Done tickets yet — /tld-gate runs after a milestone's tickets are complete. Check /tld-dashboard for current state, or run /tld-setup to start the first ticket."
Do not silently select an arbitrary milestone.

Load the gated milestone's full description via `get_milestone` (already done in Mode A).

### 4. Verify milestone completion

Parse the milestone description's `## Order` section using the canonical algorithm:
1. Find the line matching `^## Order\s*$`.
2. Capture every following line until the next `^## ` header or end-of-description.
3. Within that block, scan line-by-line and take the first regex match of `({prefix}-\d+)` (unanchored, where `{prefix}` is the ticket prefix from campaign Project).
4. The resulting list in line order is the ticket sequence.

For each ticket ID in the Order, query Linear for its current status. **Done OR Canceled counts as resolved** for gate purposes.

If any Order ticket is still Todo or In Progress:
- Fail the gate immediately. Do not run the full test command. Do not perform consistency or drift checks.
- List each unresolved ticket (ID, title, status) in the verdict.
- Present the FAIL options block (below).

### 5. Full regression test

Run the `Full` command from campaign Test Commands. This is the cumulative regression, not just the current milestone's tests.

If `Test Commands.Full` is empty, stop and output:
  "No Full test command defined in .tld/campaign.md Test Commands. Run /campaign-edit to set one."

Capture full output.

### 6. Cross-ticket consistency check (scoped to the milestone's Order tickets)

Walk the tickets in the milestone's Order and look across their combined changes for consistency:

**Database consistency (if any ticket in Order touched migrations):**
- Run the stack's migration reset (for Supabase: `supabase db reset`) to verify all migrations apply cleanly in sequence.
- Check that tables, columns, constraints, and indexes match what tickets specified.
- Verify RLS policies are in place for any new tables.

**Backend function consistency (if any ticket touched backend code):**
- Verify each function references tables/columns that actually exist.
- Check that shared-module imports resolve correctly.
- Verify auth patterns are consistent across new functions.

**Frontend consistency (if any ticket touched frontend code):**
- Verify imports resolve — no broken references between new components.
- Check that API client calls match actual backend endpoints.
- Verify route structure matches the route table (if the project has one).

**Cross-milestone dependencies:**
- If this milestone's tickets depend on prior milestones, verify those integrations still work.
- Run a quick smoke test of the prior milestone's core functionality.

### 7. Drift check (scoped to the milestone's Order tickets)

Compare actual state against expected state from each Order ticket's spec:

**Schema drift:**
- Compare actual DB schema (from `supabase db dump` or equivalent) against what this milestone's tickets specified.
- Report columns, tables, or constraints that are missing, extra, or different.

**File drift:**
- List all files created/modified across this milestone's tickets.
- Check for unexpected files that were created but aren't referenced in any ticket.
- Check for expected files that are missing.

**For each drift item, output a specific fix action:**

```markdown
### Drift: [brief description]

**What:** [what's wrong]
**Expected:** [what the spec says should be there]
**Actual:** [what's actually there]
**Fix:** [exact command or code change to resolve this]
```

Don't just report "drift detected" — tell the user exactly what to do about it.

### 8. Gate verdict

**PASS** — All Order tickets resolved (Done or Canceled), all tests green, no consistency issues, no drift.
**FAIL** — Report every issue with fix actions.

This skill does NOT write to `.tld/campaign.md`. Runtime state lives in Linear; the gate reads, it does not transition.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Output

Determine the next milestone before composing the report: call `list_milestones` for the configured project with sortOrder ascending. Walk the list; for each milestone, parse its `## Order` and check ticket statuses. The **next milestone** is the first one whose Order contains any ticket that is not Done and not Canceled. If every milestone is fully resolved, there is no next milestone — the project is complete.

```markdown
# Gate Report: [gated milestone name]

## Safety
Local database confirmed — Stack.Database: [value from campaign]

## Tickets (milestone Order)
[list each Order ticket with status: Done / Canceled / unresolved]

## Test Results
[summary — X tests, all pass / N failures]
[if failures, list them with details]

## Consistency
[findings from cross-ticket checks, or "No issues found"]

## Drift
[findings with fix actions, or "No drift detected"]

## Verdict: [PASS / FAIL]
[if FAIL: list all issues with fix actions]

## Next Milestone
[name of next milestone, or "All milestones complete"]
```

**On PASS** (a next milestone exists):

Print this summary line immediately above the options block, using the gated milestone name, next milestone name, and first Order ticket ID of the next milestone:

```
Milestone [gated] complete. Next milestone [next]. First ticket [TICKET-ID]. Run /tld-setup [TICKET-ID].
```

Then:

---

**What's next?**

> **1.** Start next milestone with clean context (Recommended)
>    Best for: standard flow, clean slate for the next milestone's first ticket
>    Step 1: type `/clear` · Step 2: run the command below

```
/tld-setup [first-ticket-ID of next milestone]
```

> **2.** /tld-dashboard — review overall progress
>    Best for: want the big picture before deciding

> **3.** /tld-side-quest — polish before moving on
>    Best for: noticed cross-ticket cleanup from the gate

Type **2** or **3** to invoke those options. For option 1, run `/clear` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup`, do NOT start the next milestone, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

**On PASS with no next milestone** (every milestone in the project is fully resolved), replace the options block with:

---

**All milestones complete.** Full project gate review recommended before launch.

**On FAIL:**

---

**What's next?**

> **1.** Fix the issues listed above, then run /tld-gate again
>    Best for: issues are clear and in scope

> **2.** /tld-side-quest — address issues in separate side quest(s)
>    Best for: issues are cross-ticket or need separate tracking

> **3.** /tld-dashboard — see scope of issues in milestone context
>    Best for: want to understand blast radius before fixing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT fix issues yourself, do NOT re-run the gate, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
