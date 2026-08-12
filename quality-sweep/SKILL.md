---
name: quality-sweep
description: |
  Recurring multi-agent quality sweep of a whole codebase, one lens per run, for any project. Each
  lens is a standing question the sweep asks every week: does this produce wrong output, does it fail
  silently, is it slow, does it contradict the project's own written rules, is the copy consistent,
  is it reachable by keyboard, are the dependencies safe, is the backlog honest. Agents find, other
  agents try to refute, and only what survives is reported. Separates NEW findings from ones already
  tracked by a ticket and from exceptions a human reviewed and accepted, files a tracker ticket for
  every confirmed new finding without asking, and writes a dated run record into the repo. Use
  whenever the user says "quality-sweep", "quality sweep", "run the bug hunt", "run the performance
  sweep", "sweep the codebase", "weekly code sweep", names one of the lenses, or wants the recurring
  whole-codebase quality check. Complements /tld-audit rather than repeating it: tld-audit reads the
  current diff, this reads the whole tree. Read-only on code; the only writes are tracker tickets,
  the run record, and this sweep's own baseline.
---

# Quality Sweep

A recurring, adversarial read of a whole codebase through one lens at a time.

**Why this exists as a recurring check.** Every other check in this family looks for a specific
mechanical shape: a doc that disagrees with the code, a test that cannot fail, a policy that does not
hold. This one looks for the defects that have no shape. A page that downloads the whole table to
render four numbers, a write that half-completes and reports success, a guard that is green in the
unit test and inert in production, a help article describing a screen that was removed. No parser
finds those. A reader does. So the engine here does not find defects at all: it owns the part that
must be deterministic, which is deciding what is actually new. That is the harder half, because a
recurring report that reprints the same known findings every week stops being read, and a real
finding then hides inside the list.

**One lens per run, on purpose.** A sweep that asks nine questions at once asks all of them badly,
and it cannot be scheduled, ranked or starved independently. Each lens is its own run, its own
record and its own slot.

**Read-only.** This skill never edits code, never runs a migration, never writes to a database, never
commits, never pushes, never opens a pull request, and never moves a ticket to Done. The only writes
it makes are the tickets it files, the dated run record, and its own baseline bookkeeping. A check
that changes the thing it measures cannot be re-run to compare.

## Layout

| Piece | Where | What it is |
| --- | --- | --- |
| Engine | `quality-sweep.mjs`, next to this file | Project-neutral. Nothing about any specific repo belongs in it |
| Baseline | in the audited repo | That project's config, its lenses, its benign patterns, its reviewed exceptions, and its known-open findings |
| Template | `baseline.example.json`, next to this file | A commented starting point to copy into a new project |
| Run records | in the audited repo | One folder per lens, one dated document per run |

The split is the point. The engine can be improved without touching any project, and a project's
accepted exceptions are reviewed in that project's own pull requests, by the people who own the code.

## Step 1 — Resolve the project, the lens and its baseline

Resolve the repo root first. Interactively that is the current working directory; on a schedule it is
the checkout the schedule names. Every path below is relative to it, and the report names the
project, so a result is never mistaken for a different repo.

Then look for the baseline, in this order, and use the first that exists:

1. `.tld/quality-sweep-baseline.json`
2. `.claude/quality-sweep-baseline.json`
3. `quality-sweep-baseline.json` at the repo root

`.tld/` is the natural home, but many repos gitignore it, and a baseline that is not committed
forgets everything between runs, which defeats the whole point. Check `git check-ignore` before
recommending a location, and prefer a path this repo actually tracks.

**If there is no baseline, run anyway.** The engine reports every finding as NEW and says so loudly
at the top of its output. That is the correct first run for a new project, not a failure. Treat it as
establishing a baseline rather than as a list of emergencies, and do not file a hundred tickets from
it. Offer to write one from `baseline.example.json` instead.

**If a baseline path was named but is missing or malformed, the engine refuses and exits 2.** Do not
work around that by dropping the argument. A missing baseline read as an empty one turns every
tracked finding back into a new one and re-files the lot.

Then resolve the lens. One run sweeps exactly one. `--list-lenses` prints what this project declares,
in rank order. A lens the baseline does not declare has no focus areas, no evidence bar and no benign
patterns, so the engine refuses it rather than running unguided.

## Step 2 — Run the sweep

### 2a — Read the manifest, and treat a failed preflight as a skipped run

```bash
node <skill-dir>/quality-sweep.mjs --root <repo-root> --lens <lens> --baseline <baseline-path>
```

The manifest is what this lens sweeps and the bar it holds findings to: focus areas, severity scale,
evidence bar, ticket granularity, benign patterns, the do-not-raise list, how long it has been since
this lens last completed, and a DEADLINE timestamp.

Some lenses need something outside the repo: a database that is up, a dev server that answers, a
model endpoint that responds, a package registry that is reachable. Those are the manifest's
preflight lines, and each must pass before the sweep starts.

**If a preflight fails, that is a SKIPPED RUN, not a clean pass.** Report "could not run" and name
what was unavailable. Never report a green result from a check that did not execute. A missed week
costs nothing; a false all-clear costs everything the check is for. Do not substitute a shallower
check and present its result as the lens's result, and do not retry against a remote or production
equivalent of a local dependency.

**The DEADLINE is a hard stop.** Past it, stop fanning out new agents, finish triaging what is
already confirmed, file those, and report PARTIAL naming the areas not reached. Stopping early is
allowed. Stopping early and reporting clean is not.

### 2b — Sweep

The structure is the same for every lens, and it is adversarial on purpose:

1. **Find.** Run one agent per focus area, in parallel. Each gets the lens's evidence bar and the
   benign-pattern list, and returns candidate findings with a file, a symbol, a severity and the
   trace that establishes it.
2. **Refute.** Every candidate goes to an independent agent instructed to refute it, defaulting to
   refuted when uncertain. A candidate that survives is confirmed. A candidate that does not is
   recorded as refuted with the reason, never silently dropped, because the reason is what stops the
   same non-finding coming back next week.
3. **Look for the gap.** A completeness pass asks what was not looked at: a focus area with no
   findings that also had no coverage, a directory nobody opened, a claim nobody checked. What it
   returns is either another round of finding or an entry in the run's "anything left out" list.

Let the finders over-flag. A check tuned until it is quiet is a check that has stopped working. The
benign-pattern list exists so that over-flagging costs a lookup rather than a fresh investigation
every week, which is the whole reason each benign pattern carries a written reason.

Candidates that cannot be confirmed are downgraded, not dropped. They are reported and filed as
unconfirmed, with what would settle them.

### 2c — Classify

Write the findings to JSON and hand them to the engine:

```bash
node <skill-dir>/quality-sweep.mjs --root <repo-root> --lens <lens> --classify <findings.json> --deadline <manifest-deadline>
```

The findings file is `{ "runStatus", "notReached": [], "coverage": {}, "findings": [], "refuted": [] }`,
each finding carrying `file`, `symbol`, `line`, `severity`, `title`, `detail`, and `confirmed`.

The identity a row is matched on is `<lens>::<file>::<symbol>`, never the title: the same defect
re-found next week is described in different words by a different agent, and a title match will miss
it every time. A baseline entry may use `*` in place of the lens, meaning it applies whatever lens
found it. Known-open entries normally do, because lenses overlap and a defect one sweep ticketed
last month is the same defect another finds this week.

| Stamp | Meaning | What to do |
| --- | --- | --- |
| `NEW` | Nothing in the baseline names this object | Triage it in Step 3 |
| `KNOWN-OPEN <ticket>` | An open ticket names this exact object | Do not file. Re-check the ticket is genuinely still open |
| `KNOWN-FILE <ticket>` | An open ticket names something in this file, but not which thing | Read that ticket. Same defect: report KNOWN-OPEN, do not file. Different defect in the same file: file it |
| `SUPPRESSED <reason>` | A human reviewed this and signed it off | Counted and reported, never silently dropped |

`KNOWN-FILE` exists because a seeded baseline usually knows the file a ticket is about and not the
symbol. Letting a file-scoped entry suppress outright would swallow a second, different defect in
the same file in complete silence, which is the exact failure this skill is built to prevent.
Filing them all blind would duplicate tickets instead. So it forces the one thing that resolves it:
read the ticket.

Exit 0 means the sweep ran and every check executed. Exit 1 means it ran but coverage is incomplete.
Exit 2 means it could not run. There is no state in which a partial result reads as a clean one, and
the engine forces PARTIAL by itself when the deadline has passed.

## Step 3 — Triage every NEW row, and resolve every KNOWN-FILE row

Open the file. Read the code. The finders are built to over-flag, so the judgment lives here and
nowhere else.

A `KNOWN-FILE` row is resolved by reading the ticket it names, not by guessing from its title. It
ends up in exactly one of two places: reported as KNOWN-OPEN and not filed, or filed as a separate
defect that happens to live in the same file. Leaving one unresolved is the same as dropping it.

A busy file will name a dozen open tickets at once, because a seeded baseline knows the file each
ticket is about and not the symbol. Resolve that row by searching those ticket bodies for the symbol
and the line rather than reading each ticket end to end; if not one of them names this symbol, it is
a different defect in a busy file and it gets filed. The engine prints a long key list as a footnote
under the table rather than in the column, so the row stays readable. Every key is still printed:
that is a relocation, not a cap.

The manifest also prints the open tickets that have no file to match on at all. The de-dup cannot
catch those for you, so read that list before filing anything that sounds like one of them.

A row survives triage only if you can say what actually goes wrong: which input produces which wrong
output, which user sees which wrong screen, which write is lost. If you cannot, it is either a benign
pattern for the baseline or something you did not understand yet, and those are different outcomes:
write the reason for the first, keep digging on the second.

Two things that look like findings and are not:

| Pattern | Why it trips a check | Why it is fine |
| --- | --- | --- |
| Deliberate duplication behind a boundary | Two modules do a similar thing | Two callers with different rules that happen to look alike today. Confirm the rules really are separate before accepting |
| A guard enforced somewhere else | A client path has no check | The server enforces it independently. Confirm by reading the enforcing code, never by reading a comment claiming it |

Check the baseline's known non-signals before citing any tool output as evidence. Every project has a
warning that is loud and meaningless, and a finding resting on one of those is not a finding.

Accepting a row is a sign-off. It means you opened the file, read the code, and concluded the sweep
is over-flagging on something genuinely fine. It is never a way to make a noisy check quiet, and a
reason that only says "known" or "by design" is not a reason. Write it for someone who was not there.

**Re-check the status of every KNOWN-OPEN key.** The baseline says a ticket exists, not that it is
still open. If the key has been closed and the finding is still here, it is a regression: the fix
either did not land or did not hold, and it needs a new ticket and a note saying which key it
regressed from. Never treat a closed key as coverage.

## Step 4 — File a ticket for every confirmed finding

**Filing is the default, not an offer.** This skill is built to run unattended on a schedule, and a
finding that exists only in a transcript nobody read is a finding nobody found. Stopping to confirm
would mean a weekend run sits on a confirmed defect until someone happens to look.

The judgment is in Step 3, not here. Only file what you confirmed by reading the code. Never file a
row you have not triaged, never file a refuted candidate, and never file a KNOWN-OPEN row. A
KNOWN-FILE row is filed only once Step 3 has read the ticket and established it is a different
defect.

**Never cap how many tickets get filed.** No "top N", no "the most severe few", no sampling, no
quietly stopping once the list feels long. Every confirmed finding is filed. When the volume is
genuinely large, fold findings that share ONE root cause into a single ticket covering all of them:
that is consolidation and it loses nothing, unlike truncation, which loses precisely the findings
nobody will ever see. A capped report is worse than a long one because it is indistinguishable from
a complete one, so the gap is invisible and the work silently never happens. If anything is left out
for any reason at all, including a tracker error partway through, Step 6 must name it and say why.

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

If the repo has no campaign file, read the tracker keys from the baseline's `config`: `tracker`,
`tracker_cloud_id`, `tracker_project`, `ticket_labels`, then apply the same routing. These configure
this audit only; they are not a second source of general project config, and `.tld/campaign.md` wins
wherever it exists.

If neither is present, do not guess. Report the findings in full, state that no tracker is
configured, and show exactly which baseline keys would enable filing.

### 4b — De-dup before creating anything

A recurring sweep re-detects an unfixed finding every single run. Filing it every run is worse than
never filing it, because it teaches everyone to ignore the label. Search the tracker first for open
tickets carrying the stable `quality-sweep` label, and compare on the **affected object identity**,
the file plus the symbol in the OBJECT column, not on the ticket title. The same defect re-detected
next week will word itself differently, and a title match will miss it.

Search the family label rather than the lens label. Lenses overlap, and a defect the performance
sweep filed last month is the same defect the bug hunt finds this week.

**Then search every label in the manifest's sibling list too.** This is not the same check as the
one above and skipping it is the most likely way this skill files a duplicate. Other recurring
audits read the same tree and file into the same tracker, and what they filed carries THEIR stable
label, not this one. A lookup scoped to this sweep's own label reports their ticket as new, and the
duplicate lands hours after the original. The sibling list is a baseline key rather than something
this file names, because which other checks a project runs is a property of that project.

**Search the stable `quality-sweep` label only. Never put a dated label in the de-dup query.** A
query naming a specific month goes stale the moment the month turns, and it fails silently: the
search returns nothing, every finding looks new, and the sweep files a duplicate of every open
ticket. Dated labels exist to group a run's output for reading, never to find it again.

Findings tracked by an older ticket that predates this skill will not carry the `quality-sweep` label
at all. Those belong in the baseline's `known_open` instead, which is why they never reach this step.

| situation | action |
| --- | --- |
| an open ticket already names this object | do not file. Comment only if something genuinely changed. Report it as "still open, KEY" |
| the object appears only on a **closed** ticket | file, and flag it as a **regression** of that key. A defect that was fixed and came back names a process problem, not just a bad line of code |
| nothing names it | file it |

### 4c — Create the ticket

- Type: bug for wrong behaviour, lost data, or a guard that does not hold; task for a question, a
  product decision, or work with no single wrong line.
- Labels: the stable family label `quality-sweep`, the lens label `quality-sweep-<lens>`, the
  project's own topic labels for this lens, and a dated grouping label built from **today's date at
  the moment of the run** in the form `quality-sweep-YYYY-MM`. Read the current date; never copy a
  month out of this file, a previous run, or a schedule's prompt. Only the family and lens labels are
  ever searched.
- Fold findings sharing one root cause into one ticket; separate causes get separate tickets. One
  bad idiom copied across twelve files is one ticket naming all twelve, not twelve tickets.
- Body, in this order: a provenance line naming the lens, the run record's path and the object
  identity, so a ticket read six months later says which sweep produced it. Then the file and line,
  what happens now, what should happen, and the trace that establishes it. Then whether it was
  confirmed or is unconfirmed and what would settle it. Then a **regression guard**: say that this
  lens now watches this object from the next run onward, and that the ticket's `known_open` rows must
  be pruned from the baseline when it closes. A closed key left in that file suppresses the finding
  forever, which is the one way this check goes quiet while the defect is still in the tree.

### 4d — Record it in the baseline

Add each filed object to `known_open` with its new ticket key, so the next run reports it as tracked
instead of re-triaging it from scratch. Add any pattern you accepted in Step 3 to `accepted` with its
reason at the same time. Leave the edit uncommitted and say so. The tracker search in 4b is the real
de-dup guard, so a dirty file is never a reason to skip filing.

**Take the object strings from the engine, never from your own notes.** The classify output ends with
a `BASELINE ROWS TO ADD AFTER FILING` block containing the exact key the engine used for every row
that needs recording. Copy those verbatim. A key retyped from your triage prose reads as correct and
matches nothing, because next week's finder spells the symbol the way the code spells it rather than
the way you tidied it up in a table. This is the same failure as retyping a SQL function body instead
of extracting it, and it fails the same way: no error, just a silent stop, and here a silent stop
means the ticket is filed a second time.

**Record the rows you resolved by hand, not only the ones you filed.** A KNOWN-FILE row that you read
the ticket for and judged to be the same defect is a decision the engine could not make and cannot
re-derive. If you leave it unrecorded because you did not file anything, it returns as NEW next week
and duplicates the ticket it already matched. The engine lists those rows in the same block for
exactly this reason. Record the hand-resolved ones, and record any ticket you found through the
sibling-label search in 4b as well: those are the rows most likely to be missed, because finding one
means you did not file, and not filing is what makes it easy to forget.

Also set this lens's `last_completed` to today's date, read from the clock, and only when the run
status was COMPLETE. A PARTIAL or skipped run must leave it alone, because that field is what makes a
starved lens visible.

Slots can overlap, so two lenses may be writing this file at once. Re-read it immediately before
writing, and merge rather than overwrite. Object keys are lens-prefixed, so two lenses cannot collide
on the same key.

## Step 5 — Write the run record

A report that lives only in a transcript is gone by Monday. Each run leaves a dated document in the
repo, under whatever folder the lens's `review_folder` names.

```bash
node <skill-dir>/quality-sweep.mjs --root <repo-root> --lens <lens> --render <classified.json> --date <today> --keys "<ticket keys>"
```

Do this after Step 4, not before, and add each row's `filedTicket` to the classified JSON first, so
the document records which finding became which ticket. That link is what makes a ticket read six
months later say which sweep produced it, and a run record say what it cost.

The date comes from the real clock at the moment of the run, never from this file and never from the
schedule's prompt. A run that fires after midnight correctly writes the following day's date.

Three writes, not one:

| Write | What |
| --- | --- |
| `<review_folder>/<YYYY-MM-DD>.md` | The run document the command above prints |
| `<review_folder>/README.md` | Append the index row the command prints after the document |
| The parent index, if the project keeps one | Update this lens's "latest run" cell |

If the folder does not exist yet, create it with a `README.md` index carrying an empty Runs table,
matching whatever shape that project's other review folders use.

**Leave all of it uncommitted and name the paths in the report.** An unattended run does not commit,
does not push, and does not open a pull request. Reviewing and committing the record is a human act.

## Step 6 — Report

Lead with a table: RUN STATUS, the lens, days since this lens last completed, what was swept, total
rows, NEW versus KNOWN-OPEN versus KNOWN-FILE versus SUPPRESSED versus refuted, and **every** confirmed finding with
its severity and ticket key (new, already open, or regression-of). If nothing is new, say so in one
line naming the project and the tracked count. Name the project and the repo root that was swept, so
a result is never mistaken for a different repo. Give the run record's path.

Then state anything that did not make it: a row left untriaged, a ticket that failed to create, a
focus area the deadline cut off, a preflight that failed. List each one and why. "Here are the
findings" must never quietly mean "here are some of the findings", and a report that omits something
silently is the one failure this whole skill is built to prevent.

Report the suppressed count as a number every time, even when it is uninteresting. A baseline that
quietly grows is how a check dies, and the number is the only thing that makes it visible.

## Running on a schedule

Scheduled runs behave exactly like interactive ones and file tickets without asking, because nobody
is there to ask. Failure modes a scheduled run must handle:

- **The repo is not available.** A checkout that moved, a worktree that was removed, a permissions
  failure. The engine exits 2 and that is a skipped run, not a clean pass. Report "could not run,
  repo root not reachable". Never report a healthy codebase from a sweep that did not read it. A
  missed week costs nothing; a false all-clear costs everything this check is for.
- **A preflight dependency is down.** Same rule. SKIPPED, named, and never substituted.
- **The baseline is missing or malformed.** The engine refuses rather than reading it as empty.
  Report it and stop; do not re-run without the baseline to get output.
- **The budget runs out partway.** File what is confirmed, report PARTIAL, and leave `last_completed`
  untouched so the starvation shows up as a growing number rather than as silence.
- **It runs in whatever checkout the schedule names**, so resolve every path from that repo root, and
  name the project in the report.

When lenses are ranked, run them in straight rank order across the available slots. Alternating them
to spread the load looks fairer and is worse: whichever slot runs dry loses the same top-ranked lens
every week, whereas straight order always loses the bottom of the list, which is the entire reason
for having a ranking.

A schedule's prompt is written once and then runs for years, so nothing in it may be time-bound: no
month, no year, no "current" ticket keys, no expected finding counts that a landed fix will
invalidate. Anything dated is derived at run time from the actual date. A stale constant in a
recurring prompt does not raise an error, it just quietly stops matching, which here inverts the
feature: the de-dup finds nothing, everything looks new, and the run duplicates every open ticket
every week.

## Baseline maintenance

- `known_open` pairs an object with the ticket that will fix it. Prune the row when the ticket
  closes; Step 3 re-checks the status of every key precisely because that pruning gets forgotten.
- `accepted` holds reviewed exceptions, each with a written reason. Grow it only via Step 3.
- `benign_patterns` is the noise control, and it is what makes triage a lookup instead of a fresh
  investigation every week. Every entry needs the reason it is benign, written for someone who was
  not there.
- `config.do_not_raise` holds topics a human has already settled and does not want re-litigated.
  Re-raising one wastes a whole run's attention, so read it before the finders start.
- `lenses.<lens>.focus_areas` is the sweep's precision, and the only entry that can make it lie in
  both directions. An area you forget to declare is never looked at; an area declared too broadly
  spends the budget everywhere and finds nothing anywhere.
- `accepted` and `known_open` match on the exact OBJECT string, so renaming a file or a symbol
  detaches every row that referenced it. Rename deliberately, and re-point the rows in the same edit.
- Re-rank when `last_completed` shows a lens has not finished in weeks. Either it moves up or it is
  not worth having, and leaving it at the bottom to never run is the one outcome that helps nobody.

## What this check cannot see

Say so in the report rather than letting the coverage be assumed:

- It reads code and, for some lenses, a running instance. It is not a user. It cannot tell you a
  workflow is confusing, a feature is unwanted, or a screen is unpleasant to use.
- It cannot tell you what is missing. A feature nobody wrote produces no finding, because there is no
  code to read.
- Findings are as good as the lens's focus areas. An area the baseline does not declare is not swept,
  and its absence from the report is not evidence of anything.
- Each lens sees its own slice. Silence from one lens says nothing about the others, and the run
  record is per-lens for exactly that reason.
- A confirmed finding is confirmed by reading, not by running. Where a lens cannot execute the path
  it describes, the finding says so.

## Canonical blocks this skill does not embed

Recorded so a later reader does not mistake an omission for drift:

- **Load project config** does not apply. That block hard-stops when `.tld/campaign.md` is missing,
  and this skill must run in repos that have no campaign file, configuring itself from its own
  baseline instead.
- The canonical local-database safety block does not apply here even though some lenses read a
  database, because this skill never writes to one and never runs a destructive command. Where a
  project's own database has a safety rule, it belongs in that project's baseline preflight, next to
  the identity check that proves which instance is being read.
- **Approval keyword set** does not apply. There is no approval gate: filing is the default, by
  design, because the skill is built to run with nobody watching.
- **Milestone completion check**, **Recommendation hint**, both **Manual-QA classification**
  variants, **Resolve next ticket (discovery)**, both **Require current ticket** variants, **Author
  Order block**, **Flow selection**, and **Required workspace labels** do not apply. Those govern the
  per-ticket build flow; this skill does not pick up, advance, or complete a ticket.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** Write or extend the baseline: turn this run's triage into accepted exceptions, benign patterns and declared focus areas
>    Best for: the sweep over-flagged, or a focus area is missing and the lens is looking in the wrong place

> **2.** Nothing, the report and the tickets are the output
>    Best for: a scheduled run, or an interactive run that came back clean

> **3.** Run another lens
>    Best for: you are doing a periodic health pass and want more than one question answered in one sitting

> **4.** `/docs-drift-audit`, `/test-audit` or `/rls-audit`: run the other recurring sweeps as well
>    Best for: a full health pass across the whole family

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
