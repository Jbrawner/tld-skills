---
name: sweep-init
description: |
  Scaffold the recurring audits for a repo: pick which of /quality-sweep, /rls-audit, /test-audit
  and /docs-drift-audit it wants, write each baseline, generate a scheduled-routine wrapper per
  audit and lens, propose a schedule. Use when the user says "sweep-init", "set up the sweeps", "add
  the audits to this repo". Registers schedules only after approval; never edits app code or files
  tickets.
---

# Sweep Init

Stand up the recurring-audit family in a project that does not have it yet.

**Why this exists.** The four sweeps are already project-neutral: the engine and the prose live in one
place, and everything specific to a repo lives in that repo's baseline plus a thin scheduled wrapper
that names the project. That split is what makes them reusable. What it does not do is make them easy
to adopt, because adopting them by hand means writing one baseline and seventeen near-identical
wrappers, getting the de-dup labels consistent across all of them, and spreading the slots so they do
not all wake at once. Every one of those is mechanical, and every one of them is a place to introduce
a silent inconsistency that only shows up weeks later as a duplicated ticket or a lens that never
runs. This skill does the mechanical part so the human does the part that actually needs judgment.

**What it deliberately does not do.** It does not invent focus areas, evidence bars, or accepted
exceptions. Those are the entire precision of a sweep, they cannot be derived from reading a
directory listing, and a baseline full of plausible-looking generic defaults is worse than an empty
one because it looks finished. Step 6 hands those back as explicit homework and says so in the report.

**Write-scoped.** This skill writes a baseline, wrapper files, review folders, and a sweep calendar
entry when the project sweeps less often than every weekend. It never edits application code, never
runs a migration, never writes to a database, never commits, never pushes, never opens a pull
request, and never files a ticket. Scheduling happens only after the user approves the proposed slots.

## Layout

| Piece | Where | What it is |
| --- | --- | --- |
| The four skills | `quality-sweep/`, `rls-audit/`, `test-audit/`, `docs-drift-audit/`, next to this file | Project-neutral. This skill never copies or forks them |
| Run protocol | `quality-sweep/RUN_PROTOCOL.md`, next to this file | The one rulebook every scheduled run follows: where it reads, what it writes, what it pushes |
| Baseline templates | `baseline.example.*` inside each of those folders | The starting point copied into the target repo |
| Baselines | `quality-sweep/` in the target repo | That project's config and reviewed exceptions, curated by a human on `main` |
| Findings files | `quality-sweep/findings/<lens>/` in the target repo | One new file per run: what it filed and what it accepted. The engines read them all back |
| Wrappers | `~/.claude/scheduled-tasks/<task-id>/SKILL.md` | One per audit and per lens. Thin: names the project, the lens and the review folder, points at the run protocol |
| Sweep calendar | `~/.claude/sweep-weekends.json` | Only for a project that sweeps less often than every weekend: how many weeks apart, and the first sweep Saturday |
| Run records | `docs/auto_reviews/<review_folder>/` in the target repo | One folder per lens or audit, one dated document per run, listed in the folder's `README.md` |

A wrapper carries the project, the lens, the review folder, the tracker, and the ticket rules, and
points at RUN_PROTOCOL.md for everything else. The moment a wrapper starts explaining how to sweep,
the skill has been forked into it and improving the skill stops improving that project.

## Step 1: Resolve the target repo

Interactively that is the current working directory unless the user names another. Confirm it before
writing anything, and confirm it is a git repository: the baseline location decision in Step 4 depends
on `git check-ignore`, and a non-repo has nowhere durable to keep bookkeeping.

Read `.tld/campaign.md` if the repo has one. It is the authority for the tracker, the project key, and
the ticket prefix, and reading it means not asking the user for what the repo already states. If there
is no campaign file, the sweeps configure themselves from their own baseline instead, so ask for the
tracker and project key in Step 3 and write them there.

**If the repo already has any of the four baselines, this is not a first run.** Say which audits are
already set up, and offer to add only the missing ones. Never overwrite an existing baseline: it holds
reviewed sign-offs and the known-open list, and regenerating it from the template turns every tracked
finding back into a new one and re-files the lot on the next run.

## Step 2: Pick the audits

Ask which of the four the project wants, multi-select, with the honest cost of each:

| Audit | Needs | Skip it when |
| --- | --- | --- |
| `/quality-sweep` | Node 18+, one slot per lens per week | The project is small enough that one reader covers it |
| `/rls-audit` | Postgres or Supabase, reachable on loopback | There is no database, or no row-level security on it |
| `/test-audit` | Node 18+, a test suite that runs | There are no tests yet |
| `/docs-drift-audit` | Python 3.11+, documentation worth checking | The docs are a single README nobody relies on |

Do not default to all four. An audit scheduled against something a project does not have reports
SKIPPED forever, and a weekly SKIPPED that nobody acts on trains the user to ignore the whole family.

## Step 3: Resolve the tracker

Take the first that applies:

1. `.tld/campaign.md` in the target repo, which always wins when present.
2. What the user states, written into each baseline's `config.tracker`, `config.tracker_project`, and
   `config.tracker_cloud_id`.

Every filed ticket carries a **stable** family label (`quality-sweep`, `rls-audit`, `test-audit`,
`docs-drift`) plus a dated label derived at run time. The stable label is what the de-dup search reads.

**Set every selected audit's `sibling_labels` to the stable labels of the other selected audits.** This
is the single most important field this skill writes, and it is the one a human doing this by hand
forgets. The audits read the same tree on the same nights and file into the same project. A de-dup
search scoped only to its own label reports a sibling's ticket as new and files a duplicate hours after
the original. Two audits selected means each names the other. Four means each names the other three.

## Step 4: Confirm `quality-sweep/` is tracked

Every baseline lives in one folder, `quality-sweep/` at the repo root, and the scheduled runs write
beside them: each run's findings file under `quality-sweep/findings/<lens>/`, and the skip record of
a run that stopped early under `quality-sweep/skips/`. RUN_PROTOCOL.md section 1 sends every run
there, and each of the three standalone audits looks there first in its own Step 1. Their later
fallbacks (`.tld/`, `.claude/`, the repo root) serve repos set up before the move; this skill writes
to `quality-sweep/` only. It is not under `.claude/` because Claude Code stops for a human before
writing anything there, and a scheduled run has nobody to ask.

The folder has to be tracked. Each scheduled run works in a fresh worktree cut from `main`, so a
baseline git ignores never reaches a run, and git refuses to stage the findings file the run has to
push. Ask the repo rather than assuming:

```bash
git -C <repo-root> check-ignore -q quality-sweep && echo "gitignored" || echo "tracked"
```

If it prints `gitignored`, stop and say so: un-ignoring the folder is the user's change to make.
Another location is no workaround, because the runs read and push `quality-sweep/` and nothing
else. An ignored folder fails quietly: every run skips, and its skip record cannot be pushed either.

## Step 5: Write the baselines

Copy each selected audit's `baseline.example.*` into `quality-sweep/`, renamed to the file that
audit looks for:

| Audit | Template | Becomes |
| --- | --- | --- |
| `/quality-sweep` | `quality-sweep/baseline.example.json` | `quality-sweep/baseline.json` |
| `/rls-audit` | `rls-audit/baseline.example.sql` | `quality-sweep/rls-audit-baseline.sql` |
| `/test-audit` | `test-audit/baseline.example.json` | `quality-sweep/test-audit-baseline.json` |
| `/docs-drift-audit` | `docs-drift-audit/baseline.example.toml` | `quality-sweep/docs-drift-baseline.toml` |

Then fill in only what can be established by reading the repo, and leave the rest for Step 6:

- The tracker fields and the sibling labels from Step 3.
- Each lens's `review_folder`, as `docs/auto_reviews/<folder>`. RUN_PROTOCOL.md fixes that parent:
  the run record, its index row, and the wrapper's `<review_folder>` substitution all sit under it.
  The standalone audits name their folder in the wrapper instead (Step 7).
- Preflight commands that can be derived: the local database identity check from the repo's Supabase
  or Postgres config, the test command from `.tld/campaign.md` or the package manifest.
- The two blocks RUN_PROTOCOL.md reads from `quality-sweep/baseline.json` for every audit. That makes
  the file necessary even when `/quality-sweep` itself was not selected; then copy the template and
  keep only its `config` block.
  - `config.local_database`, whenever a selected audit or lens reads a database: the project ref, the
    loopback host and port, and the command that confirms them (section 5). Without it, every run
    that needs a database is a skipped run.
  - `config.ticket_routing`: the ready and review statuses with their transition ids, the ready
    priority, the review label, and the maintainer's name (section 8). Ask the user for these;
    they belong to the tracker's workflow, not to the repo.
- Delete the template's underscore comment keys and its example rows. An example `accepted` entry left
  in place is a sign-off nobody gave.
- Leave `known_open` empty and write no `last_completed` anywhere. From the first run on, what a run
  files goes into its own findings file, never into a baseline, and the engines derive each lens's
  last completed run from those files. The first run of each audit establishes the baseline, and the
  skills already say to treat that run as establishing rather than as a list of emergencies.
- Start `config.approval_list` empty and say so in the report: RUN_PROTOCOL.md section 8 treats an
  empty list as "no decisions written down yet", which leaves every routing call to the run.

Create each review folder, `docs/auto_reviews/<review_folder>/`, with a `README.md` whose `## Runs`
section reads "No runs yet". RUN_PROTOCOL.md section 4 has every run add its row to that table, and
a run record its own index never lists is a report nobody finds.

None of this reaches a scheduled run until it is on `main`, because every run works in a fresh
worktree cut from `main`. This skill does not commit, so Step 9 hands that landing to the user.

## Step 6: Declare the lenses, and be honest about what is still missing

This step applies to `/quality-sweep` only, and it is the one the user has to finish.

Walk the lens list in the template with the user and keep the ones this project can actually answer.
For each kept lens, set `rank`, `enabled`, `review_folder`, and `topic_labels`. Rank matters: lenses
run in straight rank order across the available slots, so the bottom of the list is what gets starved
when a slot runs dry, and that is the correct thing to lose.

Then stop and say plainly what you did not fill in:

- **`focus_areas`** is the sweep's precision, and the only field that can make it lie in both
  directions. An area nobody declares is never looked at, and its absence from a report is not evidence
  of anything. An area declared too broadly spends the whole budget everywhere and finds nothing
  anywhere. You cannot derive these from a directory listing, so do not try.
- **`evidence_bar`** and **`severity_scale`** decide what counts as a finding in this project. Copy the
  template's wording as a starting point and tell the user it is a starting point.
- **`benign_patterns`** is the noise control, and it is empty until a real run over-flags. That is
  expected: the first run of each lens is where it gets written.
- **`config.do_not_raise`** starts empty because nothing has been settled and re-litigated yet.

A lens left with template focus areas will run, produce confident-looking findings about the wrong part
of the codebase, and burn the slot. Say so.

## Step 7: Generate the wrappers

One wrapper per selected audit, plus one per declared quality-sweep lens. Task id convention:
`<audit>-<lens>-<project>` for lenses, `<audit>-<project>` for the standalone audits.

A wrapper names the project, the lens, and the review folder, points at RUN_PROTOCOL.md, and
carries the ticket rules. It restates neither how to sweep nor the run protocol: the protocol once
lived in fourteen wrapper copies, and a correction to one never reached the other thirteen.

### Where each run reads and writes

Each routine runs in a fresh git worktree cut from `main`, and RUN_PROTOCOL.md section 1 keeps it
there. It reads its baseline from that worktree, writes one new findings file and one run record,
adds its row to its own review folder's `README.md`, and pushes a `sweep/<lens>-<date>` branch. The
Monday collector routine gathers those branches into one pull request. No run edits a baseline, and
no two runs write the same file.

So a wrapper passes no `--baseline`, names no bookkeeping worktree, and runs no sync step. Until
August 2026 every routine read and wrote one shared bookkeeping worktree, and one half-finished merge
in it silenced every routine for two weekends. Both templates say so, with that reason, so a later
reader does not put the shared copy back.

Every run starts with RUN_PROTOCOL.md section 0, the sweep-weekend check, which takes the project
name from the wrapper's `Project:` line, the word before the parentheses. So keep that line's shape,
and write nothing about cadence into a wrapper: a slower rhythm lives in the sweep calendar (Step 8).

Both templates state that the task runs in a fresh git worktree cut from `main`. That is a promise
about how Step 8 registers the routine, and it has to hold: a routine registered against the main
checkout writes into a tree somebody works in.

### Placeholders

In the templates below, `{…}` is what this skill fills in. `<lens>`, `<review_folder>`, and `<date>`
are written into the wrapper exactly as shown: RUN_PROTOCOL.md defines them, and the run substitutes
them, `<date>` from the real clock. `{skills root}` is the absolute path of the folder that holds this
skill and its siblings.

### The lens wrapper

```markdown
---
name: {task id}
description: {Project}: {Lens title} Sweep. {One sentence: what this lens reads, and that it files {tracker project} tickets for confirmed new findings.}
---

Run the **{Lens title}** quality sweep against **{Project}**.

Project: {Project} ({repo basename})
Repo: {absolute repo root}
Lens: `{lens}`
Review folder: `docs/auto_reviews/{review folder}`

This task runs in a fresh git worktree cut from `main`, so the working directory is NOT the path
above. Use absolute paths for everything that must survive the worktree, and never assume the
working directory.

## What to do

Invoke the `quality-sweep` skill and follow its SKILL.md exactly. It is a user-level skill at
{skills root}/quality-sweep/, so it is available from any directory. The skill is project-neutral:
everything specific to {Project}, including this lens's focus areas, its evidence bar, the benign
patterns that trip it on purpose and the findings already on a ticket, lives in the baseline at

  quality-sweep/baseline.json

read from **this run's own worktree**, which is a fresh checkout of `main` and already has it.
Beside it, `quality-sweep/findings/` holds what previous runs found and ticketed, one file per lens
per run. The engine unions them for you, so pass no `--baseline`:

  node {skills root}/quality-sweep/quality-sweep.mjs --lens {lens}

## Run protocol

Follow **{skills root}/quality-sweep/RUN_PROTOCOL.md** exactly. It is the one shared copy of the
rules every sweep obeys: where the baseline and previous findings live, why you must never repair
git, the single new findings file you write, and the branch you commit and push before this
worktree is thrown away. There is no shared bookkeeping worktree any more and you must not look for
one: until August 2026 every routine merged and edited one shared copy, and a single half-finished
merge in it silenced every routine for two consecutive weekends.

For this task, substitute:

    <lens>           {lens}
    <review_folder>  {review folder}

so your two output files are:

    quality-sweep/findings/{lens}/<date>.json
    docs/auto_reviews/{review folder}/<date>.md

Where this file and RUN_PROTOCOL.md ever disagree, RUN_PROTOCOL.md wins. Report the disagreement
so it gets fixed once rather than in every wrapper.

Run exactly one lens, `{lens}`. Do not run the others; each has its own scheduled slot.

## Tickets
{the ticket rules below, with `quality-sweep` as the family label}

## Report
{the report rules below}
```

### The audit wrapper

For `/rls-audit`, `/test-audit`, and `/docs-drift-audit`. Same shape, with two additions. First, it
says the rows a run records go to the run's findings file and never into the baseline. That agrees
with each audit's own Step 4d, and the wrapper says it anyway because the baseline is the one file
two runs' branches could both change, which RUN_PROTOCOL.md section 3 rules out. Second, it carries
the guardrails below, because each audit's own SKILL.md says to run on without a baseline.

```markdown
---
name: {task id}
description: {Project}: {Audit title}. {One sentence: what it reads, and that it files {tracker project} tickets for confirmed new findings.}
---

Run the {audit purpose, for example "RLS security regression sweep"} against **{Project}**.

Project: {Project} ({repo basename})
Repo: {absolute repo root}

This task runs in a fresh git worktree cut from `main`, so the working directory is NOT the path
above. Use absolute paths for everything that must survive the worktree, and never assume the
working directory.

## What to do

Invoke the `{audit}` skill and follow its SKILL.md exactly. It is a user-level skill at
{skills root}/{audit}/, so it is available from any directory. The skill itself is
project-neutral; {Project}'s own config, reviewed exceptions and known-open findings live in
quality-sweep/{baseline file}, which the skill loads before the engine.

That path is relative to **this run's own worktree**, which is a fresh checkout of `main` and
already contains it. There is no shared bookkeeping worktree any more and you must not look for one:
until August 2026 every routine merged and edited one shared copy, and a single half-finished merge
in it silenced every routine for two consecutive weekends.

**Follow {skills root}/quality-sweep/RUN_PROTOCOL.md exactly.**
It is the shared copy of the rules every sweep obeys. Two of them matter most here: you never run a
git command to repair a state git is complaining about (you stop and report instead), and you commit
and push your own work before this worktree is thrown away.

For this task, substitute `<lens>` = `{lens}` and `<review_folder>` = `{review folder}`, so your
two output files are:

    quality-sweep/findings/{lens}/<date>.json
    docs/auto_reviews/{review folder}/<date>.md

Record in that findings file what the skill's Step 4d asks for: what you filed, and anything you
reviewed and accepted with its reason. Do **not** edit `{baseline file}` itself. {How the next run sees these rows, in one sentence taken from this audit's Step 4d.}

Everything below is a summary so the run fails safe, not a replacement for reading SKILL.md.

## Guardrails
{the guardrails below, with this project's database identity}

## Tickets
{the ticket rules below, with this audit's family label}

## Report
{the report rules below}
```

The audit values are fixed. Earlier runs are found by the `quality-sweep/findings/<lens>/` folder
name, so a different `{lens}` spelling is a run that forgets every one before it.

| Audit | `{lens}` | `{baseline file}` | Family label |
| --- | --- | --- | --- |
| `/rls-audit` | `rls-audit` | `rls-audit-baseline.sql` | `rls-audit` |
| `/test-audit` | `test-audit` | `test-audit-baseline.json` | `test-audit` |
| `/docs-drift-audit` | `docs-drift` | `docs-drift-baseline.toml` | `docs-drift` |

How the next run sees a run's rows differs by engine, and each audit's Step 4d says how. Take that
sentence from there when you write the wrapper rather than restating it here, so the wrapper follows
the engine when the engine changes.

### The guardrails every audit wrapper carries

A lens wrapper takes these from RUN_PROTOCOL.md section 5 and does not repeat them. Word them to
fail safe:

- **A missing baseline is a SKIPPED RUN, not a first run.** Running without it reports every already
  tracked finding as new and duplicates every open ticket the project has. Write the skip record
  RUN_PROTOCOL.md section 7 describes, push it, and stop.
- **An unavailable dependency is a SKIPPED RUN, not a clean pass.** A database that is not running,
  an engine that exits 2. Report what was unreachable and stop, with a skip record as above. Never
  report a green result from a check that did not execute. A missed week costs nothing; a false
  all-clear costs everything the check is for.
- **Read-only against the product.** No code edits, no migrations, no database writes, no `db reset`,
  nothing moved to Done, no pull request, no merge. The only writes are the tickets and the run's own
  files from RUN_PROTOCOL.md sections 3 and 4, committed and pushed on its own `sweep/<lens>-<date>`
  branch.
- **Local database only**, where the audit reads one. Name the expected instance from the repo's own
  config (project ref, loopback host and port) and the command that confirms it, name any other local
  stack on the machine as one never to touch, and refuse any host that is not loopback.

### The ticket rules every wrapper carries

- **Every ticket gets an explicit landing status**, per RUN_PROTOCOL.md section 8, using the two
  statuses `config.ticket_routing` names. When the run cannot decide, it is the review status. The
  report gives the split and names every review-status ticket with its reason.
- **File automatically, without asking**: nobody is awake to confirm. Never file a refuted candidate
  or a row the engine marked KNOWN-OPEN.
- **De-dup in two searches**: open tickets carrying the wrapper's family label, then open tickets
  carrying each sibling label from Step 3. Match on the affected object identity, never the title. An
  object found only on a closed ticket is filed as a regression of that key. The sibling search is
  the one a run skips, and skipping it files a duplicate of a ticket a sibling audit opened the night
  before.
- **Labels exactly as the skill says**: what the quality-sweep engine prints under `LABELS for
  anything filed`, or the audit baseline's `ticket_labels`. The wrapper adds none of its own. A label
  written into a wrapper is a second copy of the label rules, and the two drift.
- **Never cap how many tickets get filed.** Fold findings that share one root cause into one ticket;
  never truncate to the most severe few. A capped report is indistinguishable from a complete one.

### The report every wrapper asks for

The skill's own counts table, with every confirmed finding, its severity and its ticket key. Then the
closing lines RUN_PROTOCOL.md section 6 asks for: `RAN` or `SKIPPED`, the tickets filed, the branch
pushed, and the absolute path of the run record. Name the project, so a result is never mistaken for
another repo's. Then state anything that did not make it, each with why: "here are the findings"
must never quietly mean "here are some of the findings".

**Write no date, month, year, lens rank, or expected finding count into any wrapper.** A schedule's
prompt is written once and runs for years. Anything dated is derived from the real clock at run
time, which is why `<date>` stays a placeholder. A stale constant does not raise an error, it quietly
stops matching, and here that inverts the feature: the de-dup finds nothing, everything looks new,
and the run duplicates every open ticket every week. No label carries a date either (RUN_PROTOCOL.md
section 5). The one place a date belongs is the run's own file names and run record heading, which
carry the full `YYYY-MM-DD` read at run time.

## Step 8: Propose a schedule, then ask

Build the proposal, print it as a table, and **do not register anything until the user approves it.**

- One slot per wrapper. Lenses take slots in rank order.
- Spread them. Leave a gap wide enough for a full run between consecutive slots, using each audit's
  own `max_run_minutes` as the spacing floor. Stacked slots contend for the same machine and the
  lower-ranked ones lose.
- Keep the whole family inside a window the user is not working in, and keep any review or reporting
  routine on a different day from the sweeps it reads, so it reads a finished weekend.
- Cron is evaluated in local time.
- **Ask how often: every weekend, or every other weekend.** The scheduler only repeats weekly, so the
  slots stay weekly either way. A slower rhythm is one entry in `~/.claude/sweep-weekends.json`, which
  every run checks first (RUN_PROTOCOL.md section 0):

  ```json
  { "<Project>": { "every_weeks": 2, "first_weekend": "<the Saturday of the first sweep weekend>" } }
  ```

  Ask which Saturday starts it, add the entry beside any other project's, and put the output of
  `node <skills dir>/quality-sweep/sweep-weekend.mjs <Project> --next 4` in the proposal. That date is
  the point the rhythm counts from, not a lookup, so it never goes stale, and it lives in the calendar
  rather than in a wrapper. Any routine that reads the sweeps' output (a collector, a goal prompt, a
  review) starts with the same check and stops on `OFF`, so an off weekend is quiet end to end. Every
  weekend needs no entry.

On approval, register each wrapper. Then list the scheduled tasks back and confirm every one appears
with a sane next run. A wrapper written to disk but never registered is the failure this skill exists
partly to prevent, and it is invisible from the file listing.

## Step 9: Report

A table of what was created: each baseline with its path, each wrapper with its task id and slot, each
review folder. Then, separately and prominently, **what the user still has to do by hand**: landing
`quality-sweep/` and the review folders on `main` through a pull request before the first slot fires,
since every run reads from a fresh worktree of `main` and finds nothing until then; the focus areas per
lens; the evidence bars; anything in the baseline left as a template default; and the fact that the
first run of each audit establishes rather than diagnoses.

Then state anything that did not make it: an audit skipped because a dependency is absent, a wrapper
that failed to register, a baseline location that had to fall back to the repo root. "Here is your
sweep setup" must never quietly mean "here is some of it".

## What this skill cannot do

Say so rather than letting it be assumed:

- It cannot tell you whether a lens is worth having in this project. It can only tell you what the
  template offers.
- It cannot write focus areas. That needs someone who knows where this codebase actually goes wrong.
- It cannot verify a sweep will produce useful findings. Only a first run does that, and the first run
  of each audit is an establishing run by design.
- It does not tune anything after the fact. A lens that over-flags is fixed by adding benign patterns
  from a real run, not by anything decided here.
- It does not set up the Monday collector routine that RUN_PROTOCOL.md section 4 hands every run's
  branch to. Until the project has one, the `sweep/*` branches pile up on `origin` and nothing the
  runs wrote reaches `main`, so each run reads the same findings as the run before it.

## Canonical blocks this skill does not embed

Recorded so a later reader does not mistake an omission for drift:

- **Load project config** does not apply. That block hard-stops when `.tld/campaign.md` is missing, and
  this skill must run in repos that have no campaign file: reading one is an input, not a precondition.
- The canonical local-database safety block does not apply. This skill never reads or writes a
  database. It writes the database guardrail *into* a wrapper, pinned to that project's own instance.
- **Approval keyword set** does not apply. The only gate is Step 8's schedule approval, which is a
  plain question, and nothing is registered before it is answered.
- **Milestone completion check**, **Recommendation hint**, both **Manual-QA classification** variants,
  **Resolve next ticket (discovery)**, both **Require current ticket** variants, **Author Order block**,
  **Flow selection**, and **Required workspace labels** do not apply. Those govern the per-ticket build
  flow; this skill does not pick up, advance, or complete a ticket.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** Fill in the focus areas and evidence bars for the declared lenses
>    Best for: you just scaffolded `/quality-sweep` and want it looking in the right place before the first slot fires

> **2.** Run one audit now as an establishing run
>    Best for: you want to see what the baseline should hold rather than guessing at it

> **3.** Nothing, the baselines and schedules are the output
>    Best for: the sweeps are set up and you would rather let the first weekend produce the evidence

> **4.** Add another audit to this repo
>    Best for: you started with one and want the rest of the family alongside it

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
