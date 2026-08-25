# Quality sweep: run protocol

One shared copy of the rules every scheduled sweep follows. The per-lens task files point here
rather than restating it, because when this lived in fourteen copies a correction had to land in
fourteen places and never did.

Substitute for `<lens>` the lens slug your task names, and for `<date>` the **real current date** in
`YYYY-MM-DD`, read at run time. Never hard-code a date, a month or a year anywhere.

## 1. Everything you read and write is in your own worktree

Your task runs in a fresh git worktree cut from `main`. That worktree is yours alone for this run.
It already contains everything you need:

| What | Path, relative to your worktree root |
|------|--------------------------------------|
| The rules (config, lenses, focus areas, benign patterns, accepted exceptions) | `.claude/quality-sweep-baseline.json` |
| What previous runs already found and ticketed | `.claude/sweep-findings/<lens>/*.json` |
| Your run record goes here | `docs/auto_reviews/<review_folder>/<date>.md` |
| Your findings go here | `.claude/sweep-findings/<lens>/<date>.json` |
| Your run record's index row goes here | `docs/auto_reviews/<review_folder>/README.md` |

The engine reads the baseline and unions every findings file under `.claude/sweep-findings/`
automatically. Point it at your worktree and it resolves both:

    node /Users/johnbrawner/.claude/skills/quality-sweep/quality-sweep.mjs --lens <lens>

**There is no shared bookkeeping worktree any more, and you must not look for one.** Until August
2026 every routine merged and edited a single shared baseline file. One half-finished merge in that
file silenced all nineteen routines for two consecutive weekends. Nothing you write is shared with
another run, so nothing you write can block one.

If `.claude/quality-sweep-baseline.json` is not in your worktree, **this is a SKIPPED RUN**, not a
first run. Report exactly:

    Could not run. The quality-sweep baseline was not found in this run's worktree.

Then stop. Do not reconstruct it, do not fetch it from anywhere else, and do not continue without
it. A run without the baseline reports all ~1,250 tracked findings as new and duplicates every open
ticket the project has. A skipped week costs a week. A run without memory costs a duplicate of every
ticket, every week, forever.

## 2. Never repair git. Stop and report instead

Before you write anything, confirm your worktree is clean: `git status --porcelain` is empty.

If it is not clean, or any git command you run fails for any reason, **this is a SKIPPED RUN**.
Report exactly what the command was and what it printed, then stop.

You may not run `git stash`, `git reset`, `git checkout --`, `git merge`, `git rebase`,
`git cherry-pick`, `git clean`, or any other command whose purpose is to get git out of a state it
is complaining about. Not once, not as a workaround, not "just to try it".

This rule has a body count. On 22 August 2026 a run hit a merge that git refused, tried to work
around it by stashing, merging and unstashing, and left the repository in a state nothing could
recover from on its own. That single workaround cost fifteen further runs across two nights. The
run that simply stopped would have cost one.

A stopped run is a good outcome. Repairing git is never your job.

## 3. Write one new file. Never edit an existing one

Write your findings to `.claude/sweep-findings/<lens>/<date>.json`:

```json
{
  "lens": "<lens>",
  "date": "<date>",
  "completed": true,
  "known_open": [
    { "object": "<lens>::<file>::<symbol>", "ticket": "LAB-1234", "summary": "one line" }
  ],
  "accepted": [
    { "object": "<lens>::<file>::<symbol>", "reason": "why this is deliberately not a finding" }
  ]
}
```

- `known_open` gets one row for every ticket you filed this run, plus any finding you resolved by
  hand to an existing ticket. Without the row, the next run files it again.
- `accepted` gets anything you reviewed and deliberately decided is not a defect, with the reason
  written out. A row with no reason is worthless to the person reading it in six months.
- `completed` is `true` only if the lens actually ran to the end. A skipped or aborted run writes
  no file at all.
- `object` is the de-dup identity `<lens>::<file>::<symbol>`. Match on it, never on ticket title.

**Do not edit `.claude/quality-sweep-baseline.json`.** It is curated by a human on `main` and is
read-only to you. **Do not edit a findings file from an earlier run**, including your own lens's.
Every run writes exactly one new path, which is what makes conflicts between runs impossible.

If `.claude/sweep-findings/<lens>/<date>.json` already exists when you start, this lens has already
run today. Report that and stop rather than overwriting it.

## 4. Commit and push before you finish

Your worktree is thrown away after the run. Anything you have not pushed is lost, which is how
almost every run record written before September 2026 was destroyed.

Add your run to your lens's own index first, so the report can be found. Open
`docs/auto_reviews/<review_folder>/README.md` and add one row to its `## Runs` table, newest first,
in the format the table already uses. If the table still says "No runs yet", replace that line with
your row. Then:

    git checkout -b sweep/<lens>-<date>
    git add .claude/sweep-findings/<lens>/<date>.json \
            docs/auto_reviews/<review_folder>/<date>.md \
            docs/auto_reviews/<review_folder>/README.md
    git commit -m "Quality sweep: <lens> <date>"
    git push -u origin sweep/<lens>-<date>

Stage only those three paths. Never `git add -A` or `git add .`.

**The third path is your lens's own README, never the shared one.** `docs/auto_reviews/README.md`,
at the top level, is written by every lens and is the one file here that two runs can genuinely
collide on. Leave it alone. `docs/auto_reviews/<review_folder>/README.md` is yours alone, which is
what makes it safe to stage.

This third path was missing until August 2026, and the cost was invisible: on the weekend of
2026-08-24, twelve of seventeen lenses wrote a run record that their own index never listed, so the
index said "No runs yet" while the report sat in the same directory. Five lenses updated it anyway
and were the only ones findable. A report nobody can find is not a report.

Do not open a pull request and do not merge. The Monday collector routine gathers the weekend's
`sweep/*` branches into a single pull request. Do not add the `ci:run` label to anything; these
branches carry only documentation and data, and CI has nothing to check.

If the push fails, say so in your report and print the branch name. The commit still exists in the
worktree and a human can recover it. Do not try to fix the push.

## 5. Guardrails that apply to every lens

- **Read-only against the product.** No application code edits, no migrations, no database writes,
  no `db reset`, nothing moved to Done. The only writes are the tracker tickets and the two files
  in section 3.
- **If the thing this lens inspects is unavailable, that is a SKIPPED RUN, not a clean pass.**
  Never report a green result from a check that did not execute. A missed week costs nothing; a
  false all-clear costs everything the check is for.
- **Local database only**, if this lens touches one. Labsistant's local Supabase stack is project
  ref `pooeyppuyzvwgcbqctzm` on 127.0.0.1:54322. Confirm with
  `grep project_id /Users/johnbrawner/Code/lab-inventory/backend/supabase/config.toml`. A second
  local stack, `tyvqtjqhwkobfmkzyope`, belongs to a different product: never touch it. Refuse any
  non-loopback host.
- **No dates inside a lookup.** A dated label on ticket output is fine, because it is built from
  the real date at run time. A date inside a search or a check is a check that stops matching
  without ever reporting that it stopped.
- **Run exactly one lens**, the one your task names. Each of the others has its own slot.

## 6. Report

End with, in this order: the lens and date, `RAN` or `SKIPPED`, the count of tickets filed with
their keys, the branch you pushed, and the **absolute** path of the run record. Absolute, because
it lives in a worktree that is about to be deleted and a relative path helps nobody.

If the run was skipped, the reason is the whole report. Say it in one sentence and stop.

## 7. A skipped run must wake somebody up

**Any time you stop early for any reason, send a push notification before you finish.** Use the
`PushNotification` tool, one line, under 200 characters, naming the lens and the reason:

    PushNotification(status: "proactive",
      message: "Sweep SKIPPED: <lens> — <one-line reason>")

This is not optional and it is not a nicety. Between 22 and 24 August 2026, seventeen consecutive
runs skipped. Every one of them wrote a clear, correct explanation of why. Every one of those
explanations went into a transcript file that nobody opened. Two entire weekends of inspection were
lost, and the only reason it was ever noticed is that a human happened to wonder out loud.

A report nobody reads is not a report. If you stop, push.

Send it for every stopping condition in this document: a missing baseline, an unclean worktree, a
failed git command, an unavailable target, a findings file that already exists, a failed push. Send
exactly one, at the end, not one per failed step.

Do **not** send a notification for a normal completed run. A run that worked is not news, and a
notification for every routine every night is how the ones that matter stop being read.

## 8. Where a ticket lands: ready for dev, or human review

Filing a ticket is only half the job. A ticket that sits in the default queue tells nobody whether
it is safe to pick up. **Every ticket you file gets an explicit landing status.** There are two, and
the test between them is not how severe the finding is. It is how confident you are that a developer
can act on it without asking anyone a question.

### Selected for Development

Transition id `21`. Use it only when **all** of these are true:

- You **confirmed** the defect. You can point at the file and line, or a reproduction, not a
  suspicion or a pattern that looks wrong.
- The fix is **obvious and local**. One clear correct behaviour, not a choice between two
  defensible ones.
- It changes only behaviour that is **already wrong**. Nobody is relying on the current output.
- It touches **nothing on the approval list** below.

Set the built-in **Priority** field on these. The ready-for-dev queue is ordered by that field, so a
ticket that lands there without one is invisible in the ordering. Never use a `p-*` label; that
scheme was deleted project-wide and must not come back.

### Human Review

Transition id `4`. Also add the label `needs-john`. Use it when **any** of these is true:

- You could not confirm it. You suspect it, or the evidence is circumstantial.
- **More than one reasonable fix exists**, and choosing between them is a product decision rather
  than an engineering one.
- The fix would change something a user can currently see and may rely on.
- It is a **regression of a closed ticket**. John wants to see those himself, every time.
- The fix is large, spans more than one tree (`frontend/`, `backend/`, `mobile/`, `landing/`), or
  needs a migration.
- Acting on it would require you to guess at an intention that is not written down.
- It touches anything on the approval list.

### The approval list

Anything in this list goes to Human Review no matter how confident you are, because these are
decisions John has already made deliberately and a "fix" to one of them is a proposal, not a bug fix:

| Area | Why |
|---|---|
| A `<title>`, URL path, `_redirects` rule or `sitemap.xml` entry under `landing/` | Nine pages carry months of accumulated search ranking tied to their exact title and URL. One edit restarts Google's evaluation and blinds the data for weeks. This has already gone wrong once as an unrequested style cleanup |
| Any migration that changes an existing SQL function, or any schema or data migration | `CREATE OR REPLACE` replaces the whole body, so a line not carried forward is silently deleted |
| Deleting data, or changing what is retained | Irreversible |
| Location defaults, or removing a location prompt from any create or import flow | Every creation asks where the item is stored, with a real picker and no default. This is settled and is not a usability tradeoff |
| Regulated fields: lot, CAS, expiry, hazard, catalog number | A fabricated value is worse than a blank one |
| Currency handling, cost aggregation, or anything that mixes units or currencies | There is no FX rate in this system. Convert before aggregation, never after |
| Brand: colours, typography, logo | Approving a layout never approves a palette |
| Auth, row-level security, or tier gating | |
| Lifecycle email copy, or any copy taken verbatim from the copy document | |
| Anything that contradicts a decision written down in `CLAUDE.md` or under `docs/` | If it is written down, changing it is a proposal |

### Say which, and why

In the ticket body, one line under the provenance block:

    Landing: Human Review — regression of LAB-1683, and the fix spans frontend and mobile.
    Landing: Selected for Development — confirmed at inventoryList.ts:212, single-line guard.

And in your final report, give the split: how many went to each, and name every Human Review ticket
with its one-line reason. That list is the most useful thing the run produces for a human, because
it is exactly the set of things that need a person and nothing else does.

**When you cannot decide, it is Human Review.** The cost of a ready-for-dev ticket that turns out to
need a decision is a developer who starts work, hits the question, and stops. The cost of a human
review ticket that turned out to be obvious is ten seconds of John's morning.
