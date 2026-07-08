---
name: tld-full-auto
description: |
  Full-auto — take ONE code ticket through the COMPLETE TLD pipeline end-to-end with every phase skill
  formally invoked via its slash command (/tld-setup → /tld-write-tests → /tld-build → /tld-audit →
  /tld-run-test), treating routine approval gates as pre-approved and stopping ONLY when something is
  actually wrong — then it STOPS before commit, preps your manual check, and hands the landing to you.
  Use this skill whenever the user says "tld-full-auto", "full auto", "full-auto", "run the whole
  ticket hands off", or "only flag me if something breaks", or wants one ticket driven to a verified,
  ready-to-land state with no review pauses (this is the most automated TLD skill; for the gated
  version with a test-spec review and a QA gate, use /tld-partial-auto). Optional argument: a ticket
  ID passed through to /tld-setup (e.g. /tld-full-auto AMAI-159); with no argument /tld-setup
  discovers the next ticket. TLD keeps you in control of the landing: full-auto NEVER commits, pushes,
  opens a PR, marks the ticket Done, or runs /tld-gate — it stops at the verified checkpoint so you do
  your manual check, then run /tld-commit to commit the ticket (the right call mid-story) or /tld-pr to
  commit → push → open a PR at the story's end. Stops and alerts on any real problem
  (a HIGH audit finding or genuine data-integrity/security risk, unfixable failure, drift, out-of-scope
  work, non-local DB, tracker error); records non-blocking MEDIUM/LOW audit findings as a ticket comment
  and keeps moving. Handles migration/schema tickets instead of refusing them: it recognizes a migration
  ticket, applies the migration to the LOCAL database, and verifies it there. Not for `skip`
  (content/doc) campaigns — use /npc-partial or /npc-full there.
---

# TLD Full-auto

Drive one code ticket through the whole TLD pipeline with zero routine pauses, then **stop at the verified-but-unlanded checkpoint and hand the landing to you.** Full-auto runs setup, failing tests, implementation, audit, and verification; it auto-clears the routine review gates and only interrupts when something is actually wrong. It does **not** commit, push, open a PR, or mark the ticket Done — in the TLD family you always own the landing. When it stops, you do your manual check and run `/tld-pr` to commit → push → open PR.

Every phase skill is **formally invoked via the Skill tool** — this skill is an aggregator and re-implements nothing.

The contract, in one line: **call every phase skill in order, show every skill's output, auto-approve the boring gates, wave loudly the moment something is wrong, and stop at the commit line so the human lands it.**

## When to use this

- The ticket is a normal code ticket that can be verified by automated tests
- You want the whole red → green → audit → verify loop to run unattended (e.g. with auto-accept permissions on)
- You only want to be interrupted for real problems, not for routine "type 1 to continue" gates
- You want to do your own manual check and control the commit/push/PR yourself afterward

Trigger phrases: `tld-full-auto`, `full auto`, `full-auto`, "hands off", "only stop if something goes wrong".

**Use `/tld-partial-auto` instead** if you want the two human review gates (test-spec review after RED, manual QA before commit) *and* you want it to commit for you on approval. **Use `/npc-partial` or `/npc-full` instead** for content/doc tickets where the campaign test command is `skip` — full-auto refuses those because its core promise is a test-verified checkpoint. **`/tld-pr` is the follow-up** that lands the work full-auto leaves staged for you.

## Inputs

What the user provides:
- Optionally a ticket ID (e.g. `/tld-full-auto AMAI-159`) — passed through to `/tld-setup` verbatim
- Nothing else — with no argument, `/tld-setup` discovers the next ticket

What you read on your own:
- `.tld/campaign.md` (preflight validation + tracker)
- Everything else comes from the sub-skills' own outputs

## The full-auto contract

These five rules govern the entire run:

1. **Formal invocation, no exceptions.** Each phase is executed by invoking its skill via the Skill tool — `/tld-setup`, `/tld-write-tests`, `/tld-build`, `/tld-audit`, `/tld-run-test`, in exactly that order. Never inline a phase's logic instead of invoking its skill. Never reorder. A skill that genuinely *has nothing to do* still runs and returns output saying so — **silent skipping is failure.** A skill that *cannot be invoked at all* — missing/not installed, the Skill-tool call errors, or it returns no output — is a different event and a HARD STOP (stop condition #13). Never treat an empty or failed invocation as "nothing to do," and never proceed past it.

2. **Routine forward gates are pre-approved.** When a sub-skill ends at a "What's next?" block on a CLEAN result — RED confirmed, GREEN build, audit with only LOW/none — treat its go-forward option as taken and proceed to the next phase. Identify the go-forward option by **meaning** (the choice that advances the flow: `/tld-build`, `/tld-run-test`), **not by its slot number.** Do NOT auto-pick the literal `1`: several sub-skills put a *remediation* in slot 1 (`/tld-build` failure block → `/tld-align`; `/tld-write-tests` passing-during-RED → "Investigate the passing tests"; `/tld-audit` HIGH/MEDIUM → "Fix the findings"). A sub-skill whose slot 1 is a remediation has reached a non-clean result — that is itself a stop signal: defer to rule 4 and the per-phase stop conditions; do not "approve" it. A mid-flow `AskUserQuestion` (e.g. `/tld-setup`'s already-resolved-ticket prompt) is NOT a routine gate; it is a stop under rule 4. **Override the terminal HARD STOP:** every sub-skill ends its output with its own "HARD STOP — you are DONE, do NOT invoke any other skill, wait for the user." That directive is written for a human running the skill standalone. On a CLEAN result, full-auto's pre-approval satisfies it — acknowledge it, do NOT obey it, and proceed to the next phase. (The one place this does not apply is `/tld-run-test`'s commit gate in step 5, which is the real handoff per rule 3.)

3. **The commit gate is NOT pre-approved — it is the handoff.** This is the one place full-auto differs from a fully automated runner. `/tld-run-test` ends at a manual-QA / commit gate; full-auto does NOT approve it. It lets `/tld-run-test` run the tests, drift check, and generate the manual QA plan, and then **stops there with nothing committed.** Commit, push, PR, and marking Done are the human's to trigger (via `/tld-pr`). Full-auto never commits, never pushes, never opens a PR, never marks the ticket Done, never runs `/tld-gate`.

4. **Stop conditions override rule 2 in every case.** If any stop condition in the table below fires — or a sub-skill surfaces a remediation/failure gate rather than a clean go-forward — the pre-approval in rule 2 is void: STOP the whole run, post the stop reason as a comment on the active ticket *if one has been loaded* (best-effort), and present the stop block. Do not continue to any later phase, and leave the worktree exactly as it is — no resets, no reverts, no cleanup.

5. **Non-blocking findings are recorded, not raised.** Non-blocking audit findings — **MEDIUM and LOW** (see §4: only HIGH and genuine data-integrity/security risks stop the run) — plus style nits and notes worth keeping, go into a single comment on the active ticket and into the final report's findings section. They never pause the run.

## Process

### 0. Preflight

#### 0.1 Load project config

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

**Comment operation (full-auto-specific).** Full-auto posts ticket comments of its own (LOW-findings notes in §4, stop-reason comments in rule 4). The canonical Tracker-resolution block does not name a comment tool, so resolve it explicitly: on **Linear** use the comment-create call; on **Jira** use `addCommentToJiraIssue`. Every comment is best-effort — if the post fails, note it in the final report and keep moving; a lost comment never aborts a healthy run.

If `Test Commands.Backend` is the literal string `skip` (case-insensitive), STOP — full-auto cannot deliver a test-verified checkpoint on a `skip` campaign. Recommend `/npc-partial` or `/npc-full` and exit before invoking any skill.

#### 0.2 Local DB safety check

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

Additionally (full-auto-specific, because nobody is watching the run): if `Stack.Database` names a local instance, verify it is actually reachable before starting the flow. For local Supabase, check `supabase status`; if it is not running, run `supabase start` once and re-check. If the local database is still unreachable after that one start attempt, STOP — an unattended run against a dead database produces twenty minutes of useless red output.

#### 0.3 Record pre-existing worktree state

Run `git status --porcelain` and record every already-dirty path. These paths are **not part of this run** — `/tld-pr` will need to keep them out of the eventual commit, so surfacing them now prevents a surprise at landing time. Two stop checks come out of this list:

- **Ticket-scope overlap.** After step 1 loads the ticket, if any pre-existing dirty path overlaps the ticket's "Files to Create/Modify," STOP — full-auto cannot separate prior edits from this run's work in the same file, and a half-finished edit muddies the checkpoint you are about to inspect.
- **Changelog special case.** The configured `Changelog path` (`.tld/campaign.md` → Stack → Changelog path) is never listed in a ticket's "Files to Create/Modify," yet `/tld-pr` will stage it. So if the changelog path is among the pre-existing dirty paths recorded here, STOP before invoking any skill — full-auto cannot tell the user's in-progress changelog edits apart from this run's work.

### 1. Invoke /tld-setup

Invoke `/tld-setup` via the Skill tool — with the user's ticket ID argument if one was given, with no argument otherwise. Show its output. It finds/loads the ticket, marks it In Progress, and surfaces description, AC, files, and milestone.

- If `/tld-setup` stops on its own error (no campaign, malformed Order section, tracker unreachable, nothing to do), the run stops with it — surface that output in the stop block.
- If `/tld-setup` raises an interactive `AskUserQuestion` rather than stopping on an error — specifically the Mode-A "Ticket {ID} is already {Done|Canceled} — proceed with setup anyway?" prompt that fires when a passed ticket ID is already resolved — treat it as a STOP, NOT a gate covered by rule 2. Do not auto-answer it. Surface the question verbatim in the stop block and let the user decide.
- If `/tld-setup` classifies the ticket as **NPC**, STOP — a no-test content flow belongs to the NPC variants; recommend `/npc-partial` or `/npc-full` in the stop block.
- If `/tld-setup` classifies the ticket as **manual-QA**, run the **migration re-check** before honoring it. `/tld-setup` labels a ticket manual-QA when it has no "Files to Create/Modify" section — but a migration ticket is real code that just lacks that section. Classify the active ticket as a **migration ticket** if EITHER its description mentions `migration`, `schema`, a column / constraint / CHECK change, or `supabase migration(s)`; OR its file scope is `*.sql` under `supabase/migrations/` (or the campaign's migrations path).
   - **If it IS a migration ticket** → do NOT stop. Treat it as a code ticket on the **migration path**: steps 2–3 cover any automatable part (a paired edge-function change usually has `deno test`s), step 3 authors the migration SQL, and step 5 verifies it by applying to the LOCAL database and running a confirmation check (see §5). Remember this classification — steps 2, 3, and 5 below check for it.
   - **If it is NOT a migration ticket** (a genuine human walkthrough) → STOP. Recommend `/tld-partial-auto` in the stop block.
- Ignore `/tld-setup`'s recommended-next-step options — full-auto's sequence is fixed. Proceed to step 2.
- Now that the ticket's file list is known, complete the §0.3 ticket-scope overlap check.

### 2. Invoke /tld-write-tests

Invoke `/tld-write-tests` via the Skill tool. Show its output (test count, AC coverage, RED confirmation). Its end-of-phase review gate is pre-approved per the contract — proceed directly to step 3 unless a stop condition fires:

- Any AC item that could not be encoded as a test → STOP. With no human reviewing the test spec, "all AC covered or wave" is the safety net. **Exception — migration tickets** (per §1's re-check): a schema/migration AC often has no automated harness in this repo. Write tests for any automatable part (e.g. a paired edge function), and for the migration itself note "no automated harness — verified by local apply in §5" and continue rather than stopping.
- Any new test that PASSES during RED → STOP. Either the feature already exists or the test isn't testing what it should — both need a human.
- Tests still won't compile/run after `/tld-write-tests`' best-effort fix (it makes a single pass at syntax errors and missing imports — there is no capped retry loop) → STOP.

### 3. Invoke /tld-build

Invoke `/tld-build` via the Skill tool. Show its output. Proceed to step 4 on a green build. (On a **migration ticket** per §1's re-check, "green" means any automatable tests pass and the migration SQL is authored — the migration's own verification happens in step 5, not here.) Stop conditions:

- The build cannot go green within `/tld-build`'s own 3-attempt retry cap → STOP and show the failing output verbatim. **This is the one "What's next?" block rule 2 does NOT pre-approve:** when `/tld-build` ends at its retry-cap block (option 1 = `/tld-align`), do NOT treat it as a routine gate — it is stop condition #8. Full-auto's single `/tld-align` cycle is verify-time only (step 5); firing it at build time is forbidden.
- `/tld-build` flags that it needs to change files outside the ticket's "Files to Create/Modify" → STOP. Scope creep is a human decision.
- The implementation would touch migrations, seed data, schema, auth, or validation semantics that the ticket does not explicitly list → STOP. **Exception — migration tickets** (per §1's re-check): authoring the migration SQL and the schema change the ticket describes IS the listed work, so this does not fire for it. It still fires for schema/auth edits the migration ticket does not call for.

### 4. Invoke /tld-audit

Invoke `/tld-audit` via the Skill tool. Show its findings table, then route:

- **Any HIGH finding → STOP.** These are the genuine risks — missing/broken auth, RLS gaps, exposed secrets, SQL injection, data leaks. A human decides.
- **Data-integrity / security backstop (escalates a non-HIGH finding to a STOP):** even at MEDIUM or LOW, STOP if the finding would **change a seed row, a migration, or validator semantics, or expose data or credentials.** This is the narrow safety floor; if the audit text describes that, treat it like a HIGH.
- **Everything else — all other MEDIUM and LOW findings (any check) → record-and-continue.** This is the relaxation: the architecture/style MEDIUMs that fire on most tickets (missing CORS, duplicate types, hardcoded values, missing body validation on a tested endpoint, missing error handling, etc.) no longer halt the run. Post them as a single comment on the active ticket (e.g. "Full-auto audit notes — MEDIUM/LOW: …") via the comment operation resolved in §0.1 (Linear comment-create / Jira `addCommentToJiraIssue`), note them for the final report, and proceed. `/tld-audit`'s terminal "What's next?" gate (including its HARD STOP) is pre-approved per the contract; it does not halt the run.

### 5. Invoke /tld-run-test (verify only — do NOT commit)

Invoke `/tld-run-test` via the Skill tool. It runs the resolved test command, the drift check, and generates the manual QA plan, then ends at its commit gate.

**Migration tickets (per §1's re-check) — verify by local apply.** A migration has no red→green harness, so its verification is NOT the test command. For a migration ticket: let `/tld-run-test` run any automatable tests (paired edge-function `deno test`s) and the file-scope drift check as usual, but do NOT treat "no unit test covers the migration" as a failure, a no-op, or AC-coverage drift. Then **apply the migration to the LOCAL database** (§0.2 already proved the DB is loopback-only — never prod; never `db reset`) and run the confirmation check the ticket implies — e.g. a query showing the new column/constraint accepts the intended values and rejects bad ones — capturing the output as the checkpoint evidence. If the apply errors or the confirmation check does not pass → STOP (a broken migration is a real problem). Otherwise proceed to step 6 and label the checkpoint **locally verified**. (Skip the no-op guard below for migration tickets — the `.sql` file is the change.)

**No-op-build guard (non-migration tickets — check first).** If `/tld-run-test` reports no uncommitted changes — i.e. it reclassifies the ticket onto its verify-time manual-QA path (empty `git diff` / `git diff --cached`) — then `/tld-build` was a no-op: it produced no changes to verify or land. STOP (condition #10). A no-op build on a ticket that setup classified as a code ticket needs a human (the feature may already exist, or the spec was already satisfied).

**On clean pass (tests + drift clean):** this is the handoff. Per rule 3, do NOT approve `/tld-run-test`'s commit gate. Capture the test results, the drift result, and the manual QA plan, then proceed to step 6 (the report). **Nothing is committed, pushed, or marked Done.**

**On failure (tests red or drift detected) — one self-heal cycle, exactly once per run:**
1. Invoke `/tld-align` via the Skill tool. Show its output.
2. Re-invoke `/tld-run-test` via the Skill tool.
3. If it now passes cleanly, continue to step 6 (the report must note the align cycle happened).
4. If it is still red or still drifted → STOP. Never loop align more than once; an unattended fix-loop that keeps "fixing" is how implementations drift away from spec.

**If `/tld-align` proposes modifying tests rather than implementation → STOP.** Changing the spec to match the code is a human decision, always.

### 6. Final report — verified, ready to land

Output, in this shape:

```
## 🛫 Full-auto — {prefix}-{N} verified, ready to land

| Phase | Skill | Result |
|---|---|---|
| Setup | /tld-setup | ✅ {ticket} loaded, In Progress |
| Red | /tld-write-tests | ✅ {N} tests, all failing, {M}/{M} AC covered |
| Green | /tld-build | ✅ {files} files, all tests passing |
| Audit | /tld-audit | ✅ 0 blocking ({k} MEDIUM/LOW recorded) |
| Verify | /tld-run-test | ✅ tests + drift clean — NOT committed (yours to land) |

*(Migration ticket: the Verify row instead reads "✅ migration applied to local DB + confirmation check passed — **locally verified** (no automated harness), NOT committed".)*

**Recorded findings:** {LOW list + "commented on ticket", or "none"}
**Align cycle used:** {yes — what it fixed / no}

**Your manual check — run these before landing:**
{the manual QA table from /tld-run-test, or "All AC covered by automated tests — no manual QA needed."}

**Nothing has been committed, pushed, or marked Done — that is yours to trigger.**
**To land it:** do the manual check above, then — mid-story — `/tld-commit` (commit this ticket; choose "commit and progress" to mark it Done and advance), or at the end of the story `/tld-pr` (commit → push → open PR, stops before merge).
```

## Stop conditions (when full-auto waves)

| # | Trigger | Where |
|---|---|---|
| 1 | Campaign missing/invalid, unsupported tracker, or tracker unreachable | Preflight / any phase |
| 2 | Non-local database, or local database unreachable after one start attempt | Preflight |
| 3 | Campaign test command is `skip` (NPC territory) | Preflight |
| 4 | Pre-existing dirty file overlaps the ticket's file scope, or the configured changelog is already dirty at preflight | Preflight / setup |
| 5 | Ticket classifies as NPC; or as manual-QA AND the §1 migration re-check says it is NOT a migration ticket (a genuine walkthrough) | Setup |
| 6 | `/tld-setup` raises an interactive prompt (Mode-A "ticket already Done/Canceled — proceed anyway?") | Setup |
| 7 | An AC item that cannot be encoded as a test, or a new test passing during RED | Write-tests |
| 8 | Build cannot go green within `/tld-build`'s retry cap (its retry-cap "What's next?" block is a STOP, not a pre-approved gate), or build needs files outside the ticket's scope | Build |
| 9 | Any **HIGH** audit finding; or any finding (any severity) that would change a seed row, migration, or validator semantics, or expose data/credentials. Other MEDIUM/LOW findings are recorded and the run continues. | Audit |
| 10 | `/tld-build` was a no-op: `/tld-run-test` finds no uncommitted changes and reclassifies to manual-QA at verify time (does NOT apply to migration tickets — the `.sql` file is the change) | Run-test |
| 11 | Tests still red or drift still present after the single `/tld-align` cycle, or align wants to edit tests | Run-test |
| 12 | Anything that would touch migrations, seed data, schema, auth, or validator semantics not explicitly in the ticket (exception: a migration ticket's own listed schema work — see §1 re-check) | Any phase |
| 13 | A Skill-tool invocation fails to run, errors at the tool level, or returns no output | Any phase |
| 14 | Any result the verdict depends on that you cannot positively confirm | Any phase |

When a stop condition fires, output the stop block and end the turn:

```
## 🛑 Full-auto stopped — {phase}

| Phase | Skill | Result |
|---|---|---|
| {completed phases} | … | ✅ |
| {stopping phase} | {skill} | ⛔ {one-line reason} |
| {remaining phases} | … | ⏭ not reached |

**Why:** {the finding/failure, verbatim from the sub-skill's output}
**Worktree:** {uncommitted files left in place — nothing was committed or reverted}
**Ticket:** {if a ticket was loaded and marked In Progress: "still In Progress; stop reason posted as a comment (or note the post failed)". For a preflight stop that fires before /tld-setup runs (conditions 1–3): "no ticket loaded yet — nothing to revert, no comment posted".}
**Resume:** {the exact command to run after addressing it, e.g. fix X then /tld-run-test}
```

**HARD STOP after the stop block.** Do not fix the cause, do not retry, do not invoke any further skill. Wait for the user.

## Guardrails

- **Never commit, push, open a PR, merge, or mark the ticket Done.** Full-auto ends at a verified, uncommitted checkpoint. `/tld-pr` does the landing — and even that stops before merge.
- **Never run destructive database commands** (resets, drops, re-seeds). Nothing in this flow needs them.
- **Never touch production credentials or hosts.** The §0.2 check enforces local-only; treat any ambiguity as a stop.
- **Never run `/tld-gate`, never start the next ticket.** One ticket per run; the landing and milestone boundaries always return to the user.
- **Side quests are intentionally off on full-auto.** Every sub-skill presents a `/tld-side-quest` option at its "What's next?" gate; rule 2 pre-approves the *go-forward* option, so the side-quest option is always treated as not-chosen. Out-of-scope work is handled by the stop table instead (build-time scope creep → #8; migrations/seed/schema/auth not in the ticket → #12), at which point the user can run `/tld-side-quest` manually.
- **If the run is interrupted** (you stop it, send a new message mid-phase, or `/clear` the conversation): nothing is committed or reverted mid-flow, so the ticket stays In Progress and any uncommitted work stays in the worktree exactly as the last phase left it. To pick back up, run `/tld-save-point` — it re-reads the campaign, finds your In-Progress ticket, inspects git, and tells you which single phase to resume from. Do NOT just re-run `/tld-full-auto` to resume: with no ticket-ID argument it discovers the NEXT Todo ticket, and even with the same ID it would re-run `/tld-write-tests` and `/tld-build` over a half-finished worktree.
- **On any stop: leave everything as-is.** Uncommitted work stays in the worktree for the user to inspect.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

## Output

After the §6 report, present:

---

**What's next?**

> **1.** /tld-commit — commit this ticket (Recommended mid-story)
>    Best for: one of many tickets in the story — commit now (pick "commit and progress" to mark it Done and advance); the PR comes at the story's end

> **2.** /tld-pr — land the whole branch: commit → push → open PR
>    Best for: this was the last ticket of the story — ready to ship for review (stops before merge)

> **3.** Describe what your manual check caught — I'll help fix it
>    Best for: the manual QA surfaced a real issue before anything landed

> **4.** /tld-dashboard — review milestone progress first
>    Best for: want a bird's-eye view before landing

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT commit, push, open a PR, mark the ticket Done, or invoke any other skill. Wait for the user to do their manual check and pick an option.**
