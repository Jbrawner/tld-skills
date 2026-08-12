---
name: rls-audit
description: |
  Recurring row-level-security and SECURITY DEFINER posture check for any Postgres or Supabase project.
  Runs a deterministic read-only SQL sweep against the LOCAL database and reports deviations: tables that
  lost RLS, DEFINER functions missing a pinned search_path, write policies missing WITH CHECK, internal-only
  helpers left executable by anon/authenticated, world-open policies, and unguarded data RPCs. Separates NEW
  deviations from ones already tracked by a ticket, and files a tracker ticket per confirmed new finding.
  Use whenever the user says "rls-audit", "rls audit", "check RLS", "run the RLS check", "did we break any
  RLS", "security posture check", or wants the recurring row-level-security regression sweep. Complements
  /tld-audit rather than repeating it: tld-audit reads the current diff, this reads the live database.
  Read-only on code and data; the only writes are tracker tickets and the project's own baseline file.
---

# RLS Audit

A recurring check that the database's actual security posture has not drifted.

**Why this exists as a live-database check.** Diff review catches a bad policy the day it is written.
It cannot catch a control that was correct when written and silently reverted later, which is the most
dangerous shape this class of bug takes: `CREATE OR REPLACE FUNCTION` resets a function's grants, so an
unrelated migration months later can quietly hand an internal helper back to every anonymous caller, with
no diff anywhere that looks wrong. Only reading the live catalog finds that. `/tld-audit` reads the diff;
this reads the database. Run both.

**Read-only.** Do NOT edit application code, write or apply a migration, run any database write, reset
the database, commit, push, open a PR, or move a ticket to Done. The only writes are (a) tracker tickets
for confirmed new findings and (b) the project's baseline file, which is this skill's own bookkeeping.

## Layout

| File | Where | What |
| --- | --- | --- |
| `rls-audit.sql` | next to this skill | the engine, identical for every project |
| `rls-audit-baseline.sql` | in the audited repo | that project's config, accepted exceptions, and known-open findings |
| `baseline.example.sql` | next to this skill | template to copy when a repo has no baseline yet |

## Step 1 — Resolve the project and its baseline

Work from the current repo root.

1. Find the baseline, taking the first that exists: `.tld/rls-audit-baseline.sql`,
   `.claude/rls-audit-baseline.sql`, then `rls-audit-baseline.sql` at the repo root. Prefer `.tld/` when
   writing a new one, but check whether the repo gitignores `.tld/` first: the baseline is worthless
   uncommitted, so in that case put it in `.claude/` instead.

   If none exists, say so plainly and continue: the sweep still runs, but with no baseline **every**
   finding reports as NEW, so treat the first run as establishing a baseline rather than as a list of
   emergencies. Offer to write one from `baseline.example.sql` at the end.
2. Determine the local database connection. In order:
   - a `[db] port` in `supabase/config.toml` or `backend/supabase/config.toml` (Supabase default: `54322`,
     user/password `postgres`/`postgres`, database `postgres`);
   - otherwise `DATABASE_URL` from the repo's `.env*`.

**Local-only rule.** This skill refuses any host that is not `127.0.0.1` or `localhost`. If the resolved
connection names anything else, STOP and report it. Do not audit it, and do not offer to.

> This is deliberately stricter than, and used instead of, the canonical **Local DB safety check** block.
> That block reads `Stack.Database` from `.tld/campaign.md` and exists to stop destructive operations.
> This skill is read-only, must work in repos with no campaign file, and applies a flat loopback-only
> refusal, which is the stronger rule. Not drift: a different and narrower job.

If a machine hosts more than one local stack, confirm you have the right one before reading anything.
For a Supabase repo, `project_id` in `config.toml` identifies it. Auditing the wrong database produces a
confident, entirely fictional report.

## Step 2 — Run the sweep

Load the baseline first so its config wins, in one psql session:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p <port> -U postgres -d postgres -q \
  -f <the baseline resolved in Step 1> \
  -f <path to this skill>/rls-audit.sql
```

Omit the first `-f` when the repo has no baseline. Confirm both files exist first: psql against a missing
file is an error, and an error must never be read as zero findings.

**Zero rows is a clean pass.** Each row is `severity | check_name | object | status | detail`.

| status | meaning | action |
| --- | --- | --- |
| `NEW` | on no list | triage in Step 3. Treat as a real regression until proven otherwise |
| `KNOWN-OPEN <KEY>` | already tracked by that ticket | do not re-file. Note it is still open |

| check_name | severity | what it catches |
| --- | --- | --- |
| `rls-disabled` | HIGH | a base table with row-level security turned off |
| `definer-no-search-path` | HIGH | a DEFINER function whose body can be hijacked by a shadowing schema |
| `write-policy-no-with-check` | HIGH | a policy that limits what you can read but not what you can write |
| `definer-anon-exec-no-authuid` | MEDIUM | a data-returning internal helper a client can call directly, skipping the wrapper that checks permission |
| `definer-anon-exec-unguarded` | LOW | the same, for boolean/void probe and write helpers |
| `policy-world-open` | MEDIUM | a policy whose USING clause is literally `true` for a client role |
| `report-rpc-unguarded` | HIGH | a data RPC matching the project's reporting convention that is anon-reachable or never authenticates |

## Step 3 — Triage every NEW row

The `definer-anon-exec-*` heuristics deliberately over-flag. A false positive costs a few minutes; a
missed hole costs a data leak. Two benign shapes trip them and must be confirmed by reading the function,
never dismissed on the check name:

1. **Delegating wrapper.** No authentication of its own, but it calls another function that does. Follow
   the call, and confirm the callee authenticates and checks membership. Then it is safe.
2. **Foundational helper.** Broadly executable on purpose because RLS policies call it as `fn(auth.uid())`,
   and it returns only membership ids or booleans, never business data. Then it is safe.

```bash
psql "$CONN" -c "select pg_get_functiondef('public.<fn>(<argtypes>)'::regprocedure);"
```

- Returns data or writes, no guard of its own, does not delegate to a guarded function → **real finding**, go to Step 4.
- Delegating wrapper or foundational helper → **false positive.** Add it to `rls_audit_accepted` in the
  project's baseline with a one-line reason naming what it delegates to, then re-run to confirm it is quiet.
  Adding a row there is a security sign-off: only do it after actually reading the function.

A project's own permission helpers will show up here, and each one belongs on `rls_audit_accepted`
individually, with the reason. There is deliberately **no** config regex for "treat these helper names as
a guard", and adding one back would be a regression rather than a convenience: a body calling
`is_member(auth.uid(), x)` already counts as guarded, so such a regex could only ever change the verdict
for a body calling `is_member(<a caller-supplied argument>, x)`, which is not a guard at all, since an
anonymous caller simply passes somebody else's id. It would turn the single riskiest shape into a silent
clean pass. Reviewing four helpers once is cheaper than never being told again.

For the four structural checks (`rls-disabled`, `definer-no-search-path`, `write-policy-no-with-check`,
`report-rpc-unguarded`) a NEW row is almost always a genuine regression. `policy-world-open` has real
exceptions, but each one is a product decision worth stating out loud in the baseline.

## Step 4 — File a ticket for every confirmed finding

**Filing is the default, not an offer.** This skill is built to run unattended on a schedule, and a
finding that exists only in a transcript nobody read is a finding nobody found. Stopping to confirm would
mean a weekend run sits on a real hole until someone happens to look.

The judgment is in Step 3, not here. Only file what you confirmed by reading the function. Never file a
row you have not triaged, and never file a `KNOWN-OPEN` row.

**Never cap how many tickets get filed.** No "top N", no "the most severe few", no sampling, no quietly
stopping once the list feels long. Every confirmed finding is filed. When the volume is genuinely large,
fold findings that share ONE root cause into a single ticket covering all of them: that is consolidation
and it loses nothing, unlike truncation, which loses precisely the findings nobody will ever see. A
capped report is worse than a long one because it is indistinguishable from a complete one, so the gap is
invisible and the work silently never happens. If anything is left out for any reason at all, including a
tracker error partway through, Step 5 must name it and say why.

### 4a — Resolve the tracker

Read `Project → Issue tracker` from `.tld/campaign.md` if the repo has one, and follow the canonical
Tracker resolution block below for it.

**Tracker resolution:**

This skill's ticket and milestone operations are written using Linear MCP tool names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Linear** — call the Linear MCP tools directly, as written in this skill. Contract: docs/ADAPTERS.md.
- **Jira** — perform the equivalent operation per docs/JIRA.md instead (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Linear, Jira. See LIMITATIONS.md."
  Do not invent an adapter.

If the repo has no campaign file, read the tracker keys from the baseline's `rls_audit_config`:
`tracker`, `tracker_cloud_id`, `tracker_project`, `ticket_labels`. These configure this skill only; they
are not a second source of general project config, and `.tld/campaign.md` wins wherever it exists.

If neither is present, do not guess. Report the findings in full, state that no tracker is configured, and
show exactly which baseline keys would enable filing.

### 4b — De-dup before creating anything

A recurring sweep re-detects an unfixed finding every single run. Filing it every run is worse than never
filing it, because it teaches everyone to ignore the label. Search the tracker first for open tickets
carrying the `rls-audit` label, and compare on the **affected object name**, not the ticket title: the same
hole re-detected next week will word itself differently.

**Search the stable `rls-audit` label only. Never put a dated label in the de-dup query.** A query
naming a specific month goes stale the moment the month turns, and it fails silently: the search returns
nothing, every finding looks new, and the sweep files a duplicate of every open ticket. Dated labels
exist to group a run's output for reading, never to find it again.

Findings tracked by an older ticket that predates this skill will not carry the `rls-audit` label at all.
Those belong in the baseline's `rls_audit_known_open` instead, which is why they never reach this step.

| situation | action |
| --- | --- |
| an open ticket already names this object | do not file. Comment only if something genuinely changed. Report it as "still open, KEY" |
| the object appears only on a **closed** ticket | file, and flag it as a **regression** of that key. This is the single most valuable thing this sweep produces |
| nothing names it | file it |

### 4c — Create the ticket

- Type: bug, or task for a verify/product-decision item.
- Labels: `rls-audit`, `security`, and a dated grouping label built from **today's date at the moment of
  the run** in the form `rls-audit-YYYY-MM`. Read the current date; never copy a month out of this file,
  a previous run, or a schedule's prompt.
- Fold findings sharing one root cause into one ticket; separate causes get separate tickets.
- Body: the affected object, the exact hole, how to reproduce it (the direct call that reaches it), the
  fix, and a **regression guard** — a test asserting the grant or policy stays closed. This class of bug
  reverts silently, so a fix without a guard will come back.

### 4d — Record it in the baseline

Add each filed object to `rls_audit_known_open` with its new ticket key, so the next run reports it as
tracked instead of re-triaging it from scratch. Leave the edit uncommitted and say so. The tracker search
in 4b is the real de-dup guard, so a dirty file is never a reason to skip filing.

## Step 5 — Report

Lead with a table: total rows, NEW versus KNOWN-OPEN, and **every** confirmed finding with its severity
and ticket key (new, already open, or regression-of). If nothing is new, say so in one line: "posture
unchanged, N items still tracked under KEY".

Then state anything that did not make it: a row left untriaged, a ticket that failed to create, a check
that could not run. List each one and why. "Here are the findings" must never quietly mean "here are some
of the findings", and a report that omits something silently is the one failure this whole skill is built
to prevent.

## Running on a schedule

Scheduled runs behave exactly like interactive ones and file tickets without asking, because nobody is
there to ask. Two failure modes a scheduled run must handle:

- **The database is not running.** That is a skipped run, not a clean pass. Report "could not run, local
  database not reachable". Never report a green posture from a sweep that did not execute. A missed week
  costs nothing; a false all-clear costs everything this check is for.
- **It runs in whatever checkout the schedule names**, so resolve every path from that repo root, and name
  the project in the report so the result is not mistaken for a different repo.

A schedule's prompt is written once and then runs for years, so nothing in it may be time-bound: no
month, no year, no "current" ticket keys, no expected finding counts that a landed fix will invalidate.
Anything dated is derived at run time from the actual date. A stale constant in a recurring prompt does
not raise an error, it just quietly stops matching, which is the failure mode this whole skill exists to
catch.

## Baseline maintenance

- `rls_audit_known_open` pairs an object with the ticket that will fix it. When the fix lands the row stops
  matching anyway, so prune it then.
- `rls_audit_accepted` holds reviewed exceptions. Grow it only via Step 3, always with the reason.
- Both match on the object **name**, so a brand-new overload reusing an accepted name is not flagged. If a
  review ever adds an overload to an accepted name, re-read every overload.

## Canonical blocks this skill does not embed

Recorded so a later reader does not mistake an omission for drift:

- **Load project config** does not apply. That block hard-stops when `.tld/campaign.md` is missing,
  and this skill must run in repos that have no campaign file, configuring itself from its own
  baseline instead.
- **Local DB safety check** is deliberately replaced, not omitted. Step 1 states the substitution and
  why: a flat loopback-only refusal is the stronger rule for a read-only sweep that must work without
  a campaign file.
- **Approval keyword set** does not apply. There is no approval gate: filing is the default, by
  design, because the skill is built to run with nobody watching.
- **Milestone completion check**, **Recommendation hint**, both **Manual-QA classification**
  variants, **Resolve next ticket (discovery)**, both **Require current ticket** variants, **Author
  Order block**, **Flow selection**, and **Required workspace labels** do not apply. Those govern
  the per-ticket build flow; this skill does not pick up, advance, or complete a ticket.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** Write or extend the baseline: turn this run's triage into accepted exceptions with their reasons
>    Best for: the sweep over-flagged, and the same rows will otherwise come back every week

> **2.** Nothing, the report and the tickets are the output
>    Best for: a scheduled run, or an interactive run that came back clean

> **3.** `/docs-drift-audit`, `/test-audit` or `/quality-sweep`: run the other recurring sweeps as well
>    Best for: you are doing a periodic health pass and want them in one sitting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
