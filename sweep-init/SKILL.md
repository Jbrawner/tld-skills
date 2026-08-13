---
name: sweep-init
description: |
  Scaffold the recurring-audit setup for a project: pick which of the four sweeps it wants
  (`/quality-sweep`, `/rls-audit`, `/test-audit`, `/docs-drift-audit`), write each one's baseline into
  the repo at a path that repo actually commits, generate one thin scheduled-routine wrapper per audit
  and per declared quality-sweep lens, and propose a schedule that spreads the slots instead of
  stacking them. Use whenever the user says "sweep-init", "sweep init", "set up the sweeps", "add the
  audits to this repo", "schedule the audits here", "point the sweeps at another project", or wants
  the recurring-check family standing up in a repo that does not have it yet. Writes the baseline, the
  wrappers, and the review folders; registers schedules only after the user approves the proposed
  slots. Never edits application code and never files a ticket.
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

**Write-scoped.** This skill writes a baseline, wrapper files, and review folders. It never edits
application code, never runs a migration, never writes to a database, never commits, never pushes,
never opens a pull request, and never files a ticket. Scheduling happens only after the user approves
the proposed slots.

## Layout

| Piece | Where | What it is |
| --- | --- | --- |
| The four skills | `quality-sweep/`, `rls-audit/`, `test-audit/`, `docs-drift-audit/`, next to this file | Project-neutral. This skill never copies or forks them |
| Baseline templates | `baseline.example.*` inside each of those folders | The starting point copied into the target repo |
| Baseline | in the target repo | That project's config, exceptions, and known-open findings |
| Wrappers | `~/.claude/scheduled-tasks/<task-id>/SKILL.md` | One per audit and per lens. Thin: names the project, invokes the shared skill |
| Run records | in the target repo | One folder per lens or audit, one dated document per run |

A wrapper carries the project, the tracker, the guardrails, and the baseline path. Nothing else. The
moment a wrapper starts explaining how to sweep, the skill has been forked into it and improving the
skill stops improving that project.

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

## Step 4: Choose where the baseline lives

`.tld/` is the natural home, but many repos gitignore it, and a baseline that is not committed forgets
everything between runs, which defeats the whole point. Decide by asking the repo, not by assuming:

```bash
git -C <repo-root> check-ignore -q .tld && echo "gitignored" || echo "tracked"
```

Prefer `.tld/` when the repo tracks it, `.claude/` when it does not, and the repo root only when the
repo ignores both. This is the same resolution order each of the four skills documents in its own Step
1, and it has to agree with them or the sweep will not find what this skill wrote.

State the chosen path and the reason in the report. A baseline in a gitignored directory is the
failure mode that looks like success for about three weeks.

## Step 5: Write the baselines

Copy each selected audit's `baseline.example.*` into the chosen location, renamed to the file that
audit looks for:

| Audit | Template | Becomes |
| --- | --- | --- |
| `/quality-sweep` | `quality-sweep/baseline.example.json` | `quality-sweep-baseline.json` |
| `/rls-audit` | `rls-audit/baseline.example.sql` | `rls-audit-baseline.sql` |
| `/test-audit` | `test-audit/baseline.example.json` | `test-audit-baseline.json` |
| `/docs-drift-audit` | `docs-drift-audit/baseline.example.toml` | `docs-drift-baseline.toml` |

Then fill in only what can be established by reading the repo, and leave the rest for Step 6:

- The tracker fields and the sibling labels from Step 3.
- `review_folder` per lens or audit, under the project's existing docs convention if it has one.
- Preflight commands that can be derived: the local database identity check from the repo's Supabase
  or Postgres config, the test command from `.tld/campaign.md` or the package manifest.
- Delete the template's underscore comment keys and its example rows. An example `accepted` entry left
  in place is a sign-off nobody gave.
- Leave `known_open` empty and every `last_completed` null. The first run of each audit establishes the
  baseline, and the skills already say to treat that run as establishing rather than as a list of
  emergencies.

Create the review folders, and a `README.md` for them if the project has no such convention yet.

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

Every wrapper follows this shape. It names the project and passes the baseline. It does not restate how
to sweep:

```markdown
Run the weekly **<Lens title>** quality sweep against **<Project>**.

Project: <Project> (<repo-basename>)
Repo: <absolute repo root>
Lens: `<lens>` (rank N of M)
Review folder: `<review_folder>`

## What to do

Invoke the `<skill>` skill and follow its SKILL.md exactly. It is a user-level skill at
<absolute skill dir>, so it is available from any directory. The skill is project-neutral:
everything specific to <Project>, including this lens's focus areas, its evidence bar, the benign
patterns that trip it on purpose and the findings already on a ticket, lives in the baseline at

  <absolute baseline path>

Pass it explicitly:

  <the exact engine invocation, with --baseline>

Run exactly one lens, `<lens>`. Do not run the others; each has its own scheduled slot.

Everything below is a summary so the run fails safe, not a replacement for reading SKILL.md.

## Guardrails
<baseline-missing rule, preflight rule, read-only rule, local-database rule, repo-scope rule>

## Tickets
<file automatically, de-dup on own label AND sibling labels, never cap, nothing dated in a lookup>

## Report
<counts table, name the project, then state what did not make it>
```

The four guardrails every wrapper carries, worded to fail safe:

- **A missing baseline is a SKIPPED RUN, not a first run.** Running without it reports every already
  tracked finding as new and duplicates every open ticket the project has.
- **An unavailable dependency is a SKIPPED RUN, not a clean pass.** Report what was unreachable and
  stop. Never report a green result from a check that did not execute. A missed week costs nothing; a
  false all-clear costs everything the check is for.
- **Read-only.** No code edits, no migrations, no database writes, no commits, no pushes, no pull
  requests, nothing moved to Done. The only writes are the tickets, the dated run record, and the
  baseline's own bookkeeping.
- **Local database only**, where the audit reads one. Pin the expected instance identity from the
  repo's own config and refuse any host that is not loopback.

**Write no date, month, year, or expected finding count into any wrapper.** A schedule's prompt is
written once and runs for years. Anything dated is derived from the real clock at run time. A stale
constant does not raise an error, it quietly stops matching, and here that inverts the feature: the
de-dup finds nothing, everything looks new, and the run duplicates every open ticket every week. A
dated label on ticket output is fine, because it is built at run time. A date inside a lookup is not.

**If the sweeps will run in a throwaway worktree**, the wrapper points the baseline at the main
checkout, deliberately, so the bookkeeping accumulates in one reviewable place instead of being
discarded with the worktree. Say so in the wrapper, with the reason, or a later reader will "fix" it.

## Step 8: Propose a schedule, then ask

Build the proposal, print it as a table, and **do not register anything until the user approves it.**

- One slot per wrapper. Lenses take slots in rank order.
- Spread them. Leave a gap wide enough for a full run between consecutive slots, using each audit's
  own `max_run_minutes` as the spacing floor. Stacked slots contend for the same machine and the
  lower-ranked ones lose.
- Keep the whole family inside a window the user is not working in, and keep any review or reporting
  routine on a different day from the sweeps it reads, so it reads a finished weekend.
- Cron is evaluated in local time.

On approval, register each wrapper. Then list the scheduled tasks back and confirm every one appears
with a sane next run. A wrapper written to disk but never registered is the failure this skill exists
partly to prevent, and it is invisible from the file listing.

## Step 9: Report

A table of what was created: each baseline with its path, each wrapper with its task id and slot, each
review folder. Then, separately and prominently, **what the user still has to do by hand**: the focus
areas per lens, the evidence bars, anything in the baseline left as a template default, and the fact
that the first run of each audit establishes rather than diagnoses.

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
