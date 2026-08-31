---
name: test-audit
description: |
  Recurring check for tests that cannot fail and tests that never run, for any JavaScript or
  TypeScript project. Runs a deterministic read-only sweep over every test file and reports the
  ones that pass regardless of what the product does: bodies with no assertion, bodies where every
  assertion sits inside a conditional guard, empty wait callbacks, tautologies, negative-path tests
  whose only assertion is that no error came back, assertions on a component's source text rather
  than its rendered output, test files no runner collects, and CI test jobs switched off with a
  constant-false condition. Separates NEW deviations from ones already tracked by a ticket, and
  files a tracker ticket per confirmed new finding. Use whenever the user says "test-audit", "test
  audit", "audit the tests", "check the test suite", "which tests cannot fail", "are our tests
  real", "do the tests actually test anything", or wants the recurring test-suite health sweep.
  Complements /tld-audit rather than repeating it: tld-audit reads the current diff, this reads the
  whole suite. Read-only on code and tests; the only writes are tracker tickets and this audit's
  own baseline.
---

# Test Audit

A recurring check that a green suite still means something.

**Why this exists as a recurring check.** A test does not stop working the day it is written. It
stops working the day the element it looked for is renamed, the day a guard is added "just to make
it stable", the day a job is switched off to save CI minutes. None of those raise an error. The
suite keeps reporting green, and it keeps reporting green while the behaviour it claims to protect
is broken. That failure is invisible to everything except a check that goes looking for it, which
is why this runs on a schedule rather than when someone remembers to wonder.

**Read-only.** This skill never edits a test, never deletes one, never runs the suite, never
commits, never opens a pull request, and never moves a ticket to Done. The only writes it makes are
the tickets it files and its own baseline bookkeeping. A check that changes the thing it measures
cannot be re-run to compare.

## Layout

| Piece | Where | What it is |
| --- | --- | --- |
| Engine | `test-audit.mjs`, next to this file | Project-neutral. Nothing about any specific repo belongs in it |
| Baseline | in the audited repo | That project's config, its reviewed exceptions, and its known-open findings |
| Template | `baseline.example.json`, next to this file | A commented starting point to copy into a new project |

The split is the point. The engine can be improved without touching any project, and a project's
accepted exceptions are reviewed in that project's own pull requests, by the people who own the
tests.

## Step 1 — Resolve the project and its baseline

Resolve the repo root first. Interactively that is the current working directory; on a schedule it
is the checkout the schedule names. Every path below is relative to it, and the report names the
project, so a result is never mistaken for a different repo.

Then look for the baseline, in this order, and use the first that exists:

1. `.tld/test-audit-baseline.json`
2. `.claude/test-audit-baseline.json`
3. `test-audit-baseline.json` at the repo root

`.tld/` is the natural home, but many repos gitignore it, and a baseline that is not committed is
not reviewed. Check `git check-ignore` before recommending a location, and prefer a path this repo
actually tracks.

**If there is no baseline, run anyway.** The engine reports every finding as NEW and says so at the
top of its output. That is the correct first run for a new project, not a failure. Treat it as
establishing a baseline rather than as a list of emergencies, and do not file a hundred tickets
from it. Offer to write one from `baseline.example.json` instead.

**If a baseline path was named but is missing or malformed, the engine refuses and exits 2.** Do
not work around that by dropping the argument. A missing baseline read as an empty one turns every
tracked finding back into a new one and re-files the lot.

## Step 2 — Run the sweep

```bash
node <skill-dir>/test-audit.mjs --root <repo-root> --baseline <baseline-path>
```

Add `--json` when you want to post-process. Exit 0 means the sweep ran, with or without findings.
Exit 2 means it could not run, and there is no third state where a partial result is presented as a
clean one.

Each row is `SEVERITY | check | object | status | detail`. The OBJECT is the finding's identity: a
test file path, `file::test title`, or `workflow::job`. Status is `NEW` or `KNOWN-OPEN <ticket>`.
Rows the baseline accepts are suppressed and counted, never silently dropped.

| check | severity | what it found |
| --- | --- | --- |
| `no-assertion` | HIGH | The body does work and then ends without a single assertion |
| `assertion-only-in-conditional` | HIGH | Every assertion sits inside an `if` or optional guard, so a false guard asserts nothing and still passes |
| `empty-waitfor` | HIGH | The only wait callback is empty, so it resolves immediately and proves nothing |
| `tautology` | HIGH | An assertion compares a value with itself |
| `refusal-asserted-as-no-error` | HIGH | A test named for a refusal whose only assertion is that no error came back |
| `suite-not-collected` | HIGH | No declared runner collects this test file, so nothing executes it |
| `runner-job-disabled` | HIGH | A CI job that owns tests is switched off with a constant-false condition |
| `shape-only-assertion` | MEDIUM | Asserts only a type or that a key exists, which the language or the query already guaranteed |
| `source-text-assertion` | MEDIUM | Reads the component's source file and matches text in it, rather than rendering it |
| `skipped-test` | MEDIUM | Declared with a skip or todo marker, so it never executes |
| `conditional-skip` | LOW | Runtime skips guarded by a condition. Scoped rather than disabled, unless the condition is never false |
| `test-file-no-cases` | LOW | Matches the test-file pattern but declares no cases |

**`refusal-asserted-as-no-error` is the one to understand before triaging it.** In several client
libraries, PostgREST among them, a write that row-level security refuses returns no error and
changes zero rows. So `expect(error).toBeNull()` passes when the write succeeded and passes when it
was silently refused. On a test named "prevents X from deleting Y", that assertion cannot fail. The
fix is to assert the row count, or re-read with an elevated client and assert the row is still
there. The same trap runs in the other direction: a positive-path test named "does not block an
ordinary edit" asserting only `error` is null cannot tell a successful edit from a silent refusal
either.

**Two checks report SKIPPED unless the baseline configures them.** `suite-not-collected` needs
`config.runners`; `runner-job-disabled` needs `config.ci_workflow_dir`. A skipped check is printed
under a heading that says it is not a pass, and it must be reported that way. Never let an
unconfigured check read as a clean result.

## Step 3 — Triage every NEW row

Open the file. Read the test. The engine is deliberately built to over-flag, because a check tuned
until it is quiet is a check that has stopped working, so the judgment lives here and nowhere else.

A row survives triage only if you can say what break it fails to catch. If you cannot, it is either
a benign pattern for the baseline or something you did not understand yet, and those are different
outcomes: write the reason for the first, keep digging on the second.

Benign patterns seen often enough to name:

| Pattern | Why it trips a check | Why it is fine |
| --- | --- | --- |
| Runner project scoping | `test.skip(project !== 'chromium', ...)` looks like a disabled test | The condition is false in the named project, so the case does run there. Confirm the project exists in the runner config before accepting |
| Opt-in live suite | A suite gated on an environment flag never runs by default | Deliberate, when it calls a paid API or a real service. Confirm the flag is real and documented |
| Dispatch-only workflow | A disabled job in a manually-triggered workflow | It never reports a status on a pull request, so it cannot turn a code change green. A disabled job in a workflow that DOES gate pull requests is never benign |
| Assertion helper | A test whose only assertion is `expectRowCount(...)` reads as assertion-free | It does assert. Helpers defined in the same file are detected automatically; a shared helper needs `assertion_helper_regex` in the baseline, which is config, not an exception |

Accepting a row is a sign-off. It means you opened the file, read the case, and concluded the check
is over-flagging on something genuinely fine. It is never a way to make a noisy check quiet, and a
reason that only says "known" or "by design" is not a reason. Write it for someone who was not
there.

**Re-check the status of every KNOWN-OPEN key.** The baseline says a ticket exists, not that it is
still open. If the key has been closed and the finding is still here, it is a regression: the fix
either did not land or did not hold, and it needs a new ticket and a note saying which key it
regressed from. Never treat a closed key as coverage.

## Step 4 — File a ticket for every confirmed finding

**Filing is the default, not an offer.** This skill is built to run unattended on a schedule, and a
finding that exists only in a transcript nobody read is a finding nobody found. Stopping to confirm
would mean a weekend run sits on a test that cannot fail until someone happens to look.

The judgment is in Step 3, not here. Only file what you confirmed by reading the test. Never file a
row you have not triaged, never file a SKIPPED check as though it were a finding, and never file a
KNOWN-OPEN row.

**Never cap how many tickets get filed.** No "top N", no "the most severe few", no sampling, no
quietly stopping once the list feels long. Every confirmed finding is filed. When the volume is
genuinely large, fold findings that share ONE root cause into a single ticket covering all of them:
that is consolidation and it loses nothing, unlike truncation, which loses precisely the findings
nobody will ever see. A capped report is worse than a long one because it is indistinguishable from
a complete one, so the gap is invisible and the work silently never happens. If anything is left out
for any reason at all, including a tracker error partway through, Step 5 must name it and say why.

### 4a — Resolve the tracker

Read `Project → Issue tracker` from `.tld/campaign.md` if the repo has one, and follow the canonical
Tracker resolution block below for it.

**Tracker resolution:**

This skill's ticket and milestone operations are written using neutral adapter names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Jira** (default) — perform each operation per docs/JIRA.md (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Linear** — call the Linear MCP tools directly; they match the adapter names used in this skill. Contract: docs/ADAPTERS.md.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Jira, Linear. See LIMITATIONS.md."
  Do not invent an adapter.

If the repo has no campaign file, read the tracker keys from the baseline's `config`: `tracker`,
`tracker_cloud_id`, `tracker_project`, `ticket_labels`, then apply the same routing. These configure
this audit only; they are not a second source of general project config, and `.tld/campaign.md` wins
wherever it exists.

If neither is present, do not guess. Report the findings in full, state that no tracker is
configured, and show exactly which baseline keys would enable filing.

### 4b — De-dup before creating anything

A recurring sweep re-detects an unfixed finding every single run. Filing it every run is worse than
never filing it, because it teaches everyone to ignore the label. Search the tracker first for open
tickets carrying the stable `test-audit` label, and compare on the **affected object identity**, the
file plus the test title, workflow job, or path in the OBJECT column, not on the ticket title. The
same weak test re-detected next week will word itself differently, and a title match will miss it.

**Search the stable `test-audit` label only. Never put a dated label in the de-dup query.** A query
naming a specific month goes stale the moment the month turns, and it fails silently: the search
returns nothing, every finding looks new, and the sweep files a duplicate of every open ticket.
Dated labels exist to group a run's output for reading, never to find it again.

Findings tracked by an older ticket that predates this skill will not carry the `test-audit` label
at all. Those belong in the baseline's `known_open` instead, which is why they never reach this
step.

| situation | action |
| --- | --- |
| an open ticket already names this object | do not file. Comment only if something genuinely changed. Report it as "still open, KEY" |
| the object appears only on a **closed** ticket | file, and flag it as a **regression** of that key. A test that was repaired and went weak again names a process problem, not just a bad test |
| nothing names it | file it |

### 4c — Create the ticket

- Type: bug for a test that cannot fail or a job that does not run; task for a coverage question or
  a product decision about what the test should assert.
- Labels: **exactly the list in the baseline's `ticket_labels`, and nothing else.** That key is the
  project's decision about its own taxonomy and it overrides any example in this file. Never add a
  label because this engine is called the test audit, because a previous run used one, or because a
  label seems descriptive: a project whose tracker already carries that fact in a field will have
  deleted it, and re-creating it is a regression. If the project's task wrapper names additional
  labels, those apply too, and the wrapper wins over this file.
- **No dated grouping label** unless `ticket_labels` itself contains one. The provenance block in
  the body already records which run filed the ticket, so a date in a label duplicates it and
  silently stops matching every search written against it once the month turns.
- Fold findings sharing one root cause into one ticket; separate causes get separate tickets. One
  guard idiom copied across twelve tests is one ticket naming all twelve, not twelve tickets.
- Body: the file and line, the test title, what the test claims to cover, what it actually asserts,
  and the specific break it would not catch. Then say which it needs: the missing assertion, or
  deletion with the covering test named. Prefer repair where the test name describes something
  real. Then a **regression guard**: say that the check now watches this object from the next run
  onward. Do not ask anybody to prune the row when the ticket closes: the engine resolves every
  `known_open` ticket's status against the tracker on each run, and a row whose ticket has closed
  reports `REGRESSION KEY` instead of `KNOWN-OPEN KEY` on its own.

### 4d — Record it in the baseline

Add each filed object to `known_open` with its new ticket key, so the next run reports it as tracked
instead of re-triaging it from scratch. Add any pattern you accepted in Step 3 to `accepted` with
its reason at the same time. Leave the edit uncommitted and say so. The tracker search in 4b is the
real de-dup guard, so a dirty file is never a reason to skip filing.

### Regression rows

`REGRESSION KEY` means the check still fires on an object whose ticket is **closed**. Signed-off
work broke again, so it is more urgent than a `NEW` finding, not less, and it is not fresh work:
route it for human review rather than filing it as a new bug. Report the two header lines verbatim,
`rows ...` and `suppressions ...`, so a reader can see how many tickets were checked and how many
had closed.

## Step 5 — Report

Lead with a table: RUN STATUS, test files swept, total rows, NEW versus KNOWN-OPEN versus SKIPPED
versus suppressed, and **every** confirmed finding with its severity and ticket key (new, already
open, or regression-of). If nothing is new, say so in one line: "no new tests that cannot fail, N
still tracked under KEY". Name the project and the repo root that was swept.

Then state anything that did not make it: a row left untriaged, a ticket that failed to create, a
check that reported SKIPPED, a file the engine could not read or could not parse. List each one and
why. "Here are the findings" must never quietly mean "here are some of the findings", and a report
that omits something silently is the one failure this whole skill is built to prevent.

Report the suppressed count as a number every time, even when it is uninteresting. A baseline that
quietly grows is how a check dies, and the number is the only thing that makes it visible.

## Running on a schedule

Scheduled runs behave exactly like interactive ones and file tickets without asking, because nobody
is there to ask. Three failure modes a scheduled run must handle:

- **The repo is not available.** A checkout that moved, a worktree that was removed, a permissions
  failure. The engine exits 2 and that is a skipped run, not a clean pass. Report "could not run,
  repo root not reachable". Never report a healthy suite from a sweep that did not read it. A
  missed week costs nothing; a false all-clear costs everything this check is for.
- **The baseline is missing or malformed.** The engine refuses rather than reading it as empty.
  Report it and stop; do not re-run without the baseline to get output.
- **It runs in whatever checkout the schedule names**, so resolve every path from that repo root,
  and name the project in the report.

A schedule's prompt is written once and then runs for years, so nothing in it may be time-bound: no
month, no year, no "current" ticket keys, no expected finding counts that a landed fix will
invalidate. Anything dated is derived at run time from the actual date. A stale constant in a
recurring prompt does not raise an error, it just quietly stops matching, which is the same silent
failure this skill exists to find in the tests themselves.

## Baseline maintenance

- `known_open` pairs an object with the ticket that will fix it. **Leave the row in place when the
  ticket closes.** It is not stale, it is the regression guard: the fix landed, so the check stops
  firing and the row costs nothing, and the day the check fires again the row is what makes the run
  say `REGRESSION` rather than `NEW`.
- Ticket status is never stored in this file. `config.ticket_status_command` and
  `config.ticket_key_pattern` let the engine ask the tracker at run time, once per run, batched.
  Both are required for that check; with either missing the header prints `suppressions !!
  UNVERIFIED` and every `KNOWN-OPEN` row below it is an unchecked claim. If the command cannot run
  at all, the run **stops** and exits 2. That is a skipped run, not a clean one: trusting the rows
  blind mutes a closed ticket's defect forever, and ignoring them blind re-files every tracked
  finding as new.
- `accepted` holds reviewed exceptions. Grow it only via Step 3, always with the reason.
- `config.runners` is the audit's precision, and the only entry that can make the sweep lie in both
  directions. A runner you forget to declare turns its whole suite into false `suite-not-collected`
  rows; a runner listed that nothing actually invokes hides real ones. Re-read it whenever a test
  script changes.
- Both `accepted` and `known_open` match on the exact OBJECT string, so renaming a test detaches
  every row that referenced it. Rename deliberately, and re-point the rows in the same edit.
- Where one file has two cases with the same title, the second gets `#2` appended so each keeps its
  own identity. Fixing the first renumbers the second, so re-point those rows when you fix one.

## What this check cannot see

Say so in the report rather than letting the coverage be assumed:

- It reads source text. It does not run the suite, so it cannot tell you a test is flaky, slow,
  order-dependent, or passing for a reason other than the one it claims.
- It cannot tell you what is missing. A behaviour with no test at all produces no row, because
  there is no file to read. Coverage gaps need a reading pass, not this.
- It checks that a runner collects a file, not that CI invokes that runner. A suite that is
  collected locally and never run in CI looks clean here.
- Assertions inside helpers in other files are found by name, not by following the call. A helper
  with an unconventional name may still read as assertion-free.

## Canonical blocks this skill does not embed

Recorded so a later reader does not mistake an omission for drift:

- **Load project config** does not apply. That block hard-stops when `.tld/campaign.md` is missing,
  and this skill must run in repos that have no campaign file, configuring itself from its own
  baseline instead.
- The canonical local-database safety block does not apply. This skill never touches a database.
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

> **1.** Write or extend the baseline: turn this run's triage into accepted exceptions and declared runners
>    Best for: the sweep over-flagged, or a runner is missing and the collection check is reporting noise

> **2.** Nothing, the report and the tickets are the output
>    Best for: a scheduled run, or an interactive run that came back clean

> **3.** `/docs-drift-audit` or `/rls-audit`: run the other recurring sweeps as well
>    Best for: you are doing a periodic health pass and want them in one sitting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
