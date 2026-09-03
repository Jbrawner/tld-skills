---
name: tld-gate
description: |
  Run a milestone boundary gate check for TLD. Use this skill whenever the user says "tld-gate", "tld gate", "run gate check", "gate check", or has finished all tickets in a milestone and needs full regression, consistency, drift, and merge-reconciliation validation before moving to the next milestone. The reconciliation pass tests every resolved ticket against the default branch and FAILs the gate on any ticket that reads Done while its code is not there; it is also the human-landed path's only writer of Done, closing out tickets whose merge it just confirmed. Accepts an optional milestone ID argument (`/tld-gate {milestoneId}`) which `/tld-next` emits automatically. This is the heavyweight verification that runs at milestone boundaries — not after every ticket. Operates ONLY against local database. Always use when /tld-next says to.
---

# TLD Gate

You are running a milestone boundary gate check. This is the heavyweight verification that runs after completing all tickets in a Linear milestone. It validates that everything built in this milestone works together, hasn't drifted from spec, is actually on the default branch, and provides a solid foundation for the next milestone.

**The gate is where Done gets written on the human-landed path.** Every other skill stops at the pre-merge status because none of them merge anything ([docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md)). Step 4.5 confirms the merges, step 8 closes out the tickets it confirmed, and a ticket that reads Done with no code on the default branch fails the gate outright.

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

> **Jira path:** the milestone's ticket set is the **Sub-tasks** of the milestone Story (`parent = "<storyKey>" ORDER BY Rank ASC`), not an `## Order` list. The milestone is complete when every such Sub-task is **work-complete** — in the `done` category, canceled, or in the project's pre-merge status (see [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md) § Two questions, two tests). Wherever the steps below say "the milestone's Order tickets" (the regression scope in steps 6–7), read it as "the milestone Story's Sub-tasks." See docs/JIRA.md § Milestone and ordering.

Parse the milestone description's `## Order` section using the canonical algorithm:
1. Find the line matching `^## Order\s*$`.
2. Capture every following line until the next `^## ` header or end-of-description.
3. Within that block, scan line-by-line and take the first regex match of `({prefix}-\d+)` (unanchored, where `{prefix}` is the ticket prefix from campaign Project).
4. The resulting list in line order is the ticket sequence.

For each ticket ID in the Order, query Linear for its current status. **Done, Canceled, OR the project's pre-merge status counts as resolved** for gate purposes.

Accepting the pre-merge status here is deliberate and is what keeps the gate from deadlocking against its own rule. On the human-landed path this gate runs at the milestone boundary, *before* the milestone's PR merges — so its tickets are finished but not yet Done. Resolve the pre-merge status per [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md) § The pre-merge status. What the gate does **not** relax is the rollup in step 8, which still requires real `done`-category children.

If any Order ticket is still Todo or In Progress:
- Fail the gate immediately. Do not run the full test command. Do not perform consistency or drift checks.
- List each unresolved ticket (ID, title, status) in the verdict.
- Present the FAIL options block (below).

### 4.5. Merge reconciliation

Test what the tracker claims against what is on the default branch. Full procedure, including why a commit-message grep is not an acceptable substitute: [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md) § Confirming a merge.

Scope: every ticket of the gated milestone that is in a **done-category** status or in the **pre-merge** status. `git fetch origin` once first so `origin/{default}` is current. For each, run Test 0 (a merged PR for the ticket's branch), then Test 1 (`git merge-base --is-ancestor origin/{branch} origin/{default}`), then Test 2 (file presence, including the rename check). Record which test answered.

Act on the result:

| Row | Verdict | Gate action |
|---|---|---|
| Done, **not** on the default branch | 🚨 FALSE DONE | **FAIL the gate.** Do not run the regression suite; do not roll anything up. |
| Done, merge unverifiable | ⚠️ unverified | Report it. Does not FAIL a gate whose tests are green, but **blocks the step-8 rollup**. |
| Pre-merge, confirmed merged | 📥 ready to close | On a PASS verdict, transition it to Done in step 8 — the merge is confirmed, so the rule is satisfied. |
| Pre-merge, not yet merged | ⏳ in flight | Normal. No action. |

**A FALSE DONE row fails the gate on its own**, ahead of the tests. A ticket that reads Done with its code nowhere near the default branch is the precise failure this gate exists to catch, and it is worse news than a red test: a red test is visible, and this is not. Name the ticket, the branch, and whether a PR was ever opened for it, and give `/tld-setup {ticket}` as the fix action so the work gets re-landed.

Report every row in step 9 even when all of them are clean — print `All {N} resolved tickets confirmed on {default}.` A check that prints nothing when it passes is indistinguishable from a check that never ran.

### 5. Full regression test

Run the `Full` command from campaign Test Commands. This is the cumulative regression, not just the current milestone's tests.

If `Test Commands.Full` is empty, stop and output:
  "No Full test command defined in .tld/campaign.md Test Commands. Run /campaign-edit to set one."

Capture full output.

### 5a. Browser suite (announced, never run here)

Read `Browser` from campaign `Test Commands`.

Do NOT run it. The browser suite is deliberately local-only and is not part of the
`Full` regression: running it inside every gate is slow and needs a booted stack. The
gate's job here is to HAND THE STEP OFF, not to perform it.

Record one of three states for the report:
- **Not run this cycle** — the default. The gate did not run it and has no evidence that
  anyone else did.
- **Run this cycle** — only if the operator states in this session that they ran it, and
  gives the result. Never infer this.
- **No Browser entry** — campaign `Test Commands` has no `Browser` field, or it is empty.
  Say so plainly rather than omitting the section.

Print whatever the `Browser` field holds. Never hardcode a suite name, runner, or command
into this skill: campaigns differ, and a value baked in here is wrong for every project
that does not share it.

### 6. Cross-ticket consistency check (scoped to the milestone's Order tickets)

Walk the tickets in the milestone's Order and look across their combined changes for consistency:

**Database consistency (if any ticket in Order touched migrations):**
- Run the stack's local-DB reset command (read `Stack.Database` from `.tld/campaign.md` to identify the database, then run the appropriate reset — for Supabase that's `supabase db reset`; for plain Postgres it might be `dropdb && createdb && psql -f schema.sql`; for SQLite it might be `rm db.sqlite && npm run migrate`) to verify all migrations apply cleanly in sequence.
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

**PASS** — All Order tickets resolved (Done, Canceled, or pre-merge), no FALSE DONE rows in step 4.5, all tests green, no consistency issues, no drift.
**FAIL** — Report every issue with fix actions. Any FALSE DONE row from step 4.5 is a FAIL by itself, regardless of the test results.

This skill does NOT write to `.tld/campaign.md`; runtime state lives in the tracker.

**Linear path:** the gate transitions only the 📥 ready-to-close tickets below — tickets whose merge step 4.5 confirmed. It performs no hierarchy rollup; milestone state is managed by the other skills.

**Close out confirmed merges first (PASS only, both trackers).** For every 📥 *ready to close* row from step 4.5 — a ticket in the pre-merge status whose code is confirmed on the default branch — transition it to a `done`-category status now. This is the human-landed path's only writer of Done, and it is allowed to write it because step 4.5 confirmed the merge. Never transition an ⏳ *in flight* or ⚠️ *unverified* row.

**Jira path — roll the hierarchy up on PASS only.** Jira is hierarchical (Epic → Story = milestone → Sub-task = ticket), and nothing else transitions the parent Story or its Epic, so the gate closes them out at the milestone boundary. On a **PASS** verdict only:

1. **Check the children first.** Transition the gated milestone **Story** to a `done`-category status only if every Sub-task is now genuinely in the `done` category (cancel-named statuses count as resolved; the pre-merge status does not). If any Sub-task is still pre-merge or unverified, **defer the rollup**: transition nothing above the ticket level and report "Rollup deferred — {N} Sub-tasks awaiting merge. Re-run /tld-gate {milestoneId} once the PR merges." A deferred rollup is a normal outcome on the human-landed path, not a failure, and the gate still PASSes.
2. If the Story was transitioned and it has a parent **Epic** and every child Story of the Epic is now `done`, transition the **Epic** to `done` as well; otherwise leave the Epic alone. A deferred Story rollup defers the Epic with it.

Use `getTransitionsForJiraIssue` → `transitionJiraIssue` (status changes are workflow transitions, not field writes). Only ascend — never transition sibling Stories or the Sub-tasks under another Story. On a **FAIL** verdict, transition nothing. Full procedure and guard rails: docs/JIRA.md § Hierarchy rollup.

**Release boundary — the browser suite is not optional there.** A gate whose PASS would
leave NO next milestone is a release boundary: every milestone in the project is resolved
and the next thing that happens is a launch. Step 9 already computes that distinction to
choose its closing block, so reuse it rather than adding anything a campaign has to
configure.

- If a release-boundary gate would otherwise PASS and the browser suite is recorded (step
  5a) as **Not run this cycle**, the verdict is **FAIL**. The fix action is: run the
  `Browser` command and re-gate.
- If the campaign has **no Browser entry**, the boundary rule cannot apply. PASS, and say
  in the verdict that no browser suite is configured.
- An ordinary milestone boundary (a next milestone exists) may PASS with the suite unrun.
  It still prints the Browser suite section.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Output

Determine the next milestone before composing the report: call `list_milestones` for the configured project with sortOrder ascending. Walk the list; for each milestone, parse its `## Order` and check ticket statuses. The **next milestone** is the first one whose Order contains any ticket that is not work-complete (not Done, not Canceled, and not in the pre-merge status). If every milestone is fully resolved, there is no next milestone — the project is complete.

```markdown
# Gate Report: [gated milestone name]

## Safety
Local database confirmed — Stack.Database: [value from campaign]

## Tickets (milestone Order)
[list each Order ticket with status: Done / Canceled / pre-merge / unresolved]

## Merge reconciliation
[checked against origin/{default} at {short-sha}. Either "All [N] resolved tickets confirmed on {default}." or a table of rows: ticket · tracker status · on {default}? · evidence · action. 🚨 rows first, then ⚠️, then 📥, then ⏳. Never omit this section — a silent check reads like a clean one.]

## Test Results
[summary — X tests, all pass / N failures]
[if failures, list them with details]

## Browser suite
[one of:
 "Not run this cycle. Run locally: `[Test Commands.Browser]`"
 "Run this cycle — [result the operator reported]"
 "No Browser entry in this campaign's Test Commands."]

## Consistency
[findings from cross-ticket checks, or "No issues found"]

## Drift
[findings with fix actions, or "No drift detected"]

## Verdict: [PASS / FAIL]
[if FAIL: list all issues with fix actions]

## Closed out on merge confirmation
[PASS only: each 📥 ready-to-close ticket transitioned to Done here, with the evidence that confirmed it. Otherwise "none".]

## Hierarchy rollup
[Jira + PASS only: "Story [KEY] → Done" plus the Epic outcome, e.g. "Epic [KEY] → Done (last Story closed)" or "Epic [KEY] left open (N of M Stories done)" or "no parent Epic". If deferred: "Deferred — N Sub-tasks awaiting merge. Re-run /tld-gate [milestoneId] once the PR merges." Otherwise: "n/a — Linear" or "n/a — gate did not pass".]

## Next Milestone
[name of next milestone, or "All milestones complete"]
```

**On PASS** (a next milestone exists):

Print this summary line immediately above the options block, using the gated milestone name, next milestone name, and first Order ticket ID of the next milestone:

```
Milestone [gated] complete. Next milestone [next]. First ticket [TICKET-ID]. Run /tld-setup [TICKET-ID].
Browser suite not run this cycle. Run it locally: [Test Commands.Browser]
```

Omit that second line when the operator reported running the suite this cycle, or when the
campaign has no `Browser` entry.

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
