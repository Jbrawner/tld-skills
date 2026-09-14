---
name: week-plan
description: |
  A weekly plan as a source of truth: one file per week under docs/plans/ holds what gets
  built and in what order, and the tracker holds status. `/week-plan status` prints the
  current plan with live status and what is next. `/week-plan next` drafts next week's file
  from what this week did not finish plus the dev queue, shows it, and stops for a ruling.
  Reads the repo's docs/plans/README.md contract; knows nothing about the product itself.
  Use when the user says "week plan", "what's next this week", "plan next week", "what did
  we not finish", or on the planning day the contract names.
---

# Week plan

This skill is project-agnostic. It knows nothing about the product except what the contract
in `docs/plans/README.md` tells it. The plan file holds the order and the reasons, which are
decisions. It never holds status, which is a fact the tracker already knows: a status written
into a file is stale the moment a ticket moves, and two copies of a fact drift.

## Inputs

- `status` (default when no argument is given), or `next`.
- Optional after `status`: a plan file path. Defaults to the newest `<date>-week.md` in the
  plan folder.

## Process

### 1. Load the contract

Read `docs/plans/README.md` from the current repo root. If it does not exist, stop and output:

  "No week-plan contract found. Create `docs/plans/` with `README.md` and `TEMPLATE.md`
  (see the tld-skills README for the shape)."

Parse the **Project config** table. Every key is required: `Tracker`, `Project key`,
`Ticket link`, `Plan folder`, `Dev queue`, `Needs a ruling`, `Build workflow`, `Cut ticket`,
`Cadence`. If one is missing, stop and name it.

`Tracker` must be Jira for now: the status script uses `acli` and Jira's three status
categories (To Do, In Progress, Done). On any other tracker stop and output:

  "The week-plan skill supports Jira only today. See LIMITATIONS.md."

### 2. `status`

1. Run `~/.claude/skills/week-plan/plan-status.sh` from the repo root, passing the plan file
   if one was given. It finds the newest week file, takes every linked ticket in the order the
   plan gives, asks the tracker once, and prints one table per section with the live status,
   the counts by category, and "Next up": the first ticket in the first work table that is
   still in the To Do category.
2. Show the output as it is: the tables, the counts, the "Next up" line.
3. If "Next up" names a ticket, say it and stop. Do not start it: starting a ticket is a
   separate ask, and it runs through the `Build workflow` the contract names.

### 3. `next`

Drafts, shows, and waits. Runs on the planning day the `Cadence` key names, or when asked.

1. **Carry-over.** Run the status script on the current plan. Every ticket whose category is
   not Done goes into the draft, in the same section and the same order. A ticket in the In
   Progress category stays at the top of its section so it finishes first. Nothing is dropped:
   removing a row is the user's call, and the draft says which rows they would be dropping.
2. **Feature focus.** If the current plan's first work table is fully Done, ask for the
   week's one feature focus. If rows remain, the focus carries over and the question is not
   asked.
3. **Stability picks.** Query the `Dev queue` status ordered by priority:

   ```bash
   acli jira workitem search --jql 'project = <Project key> AND status = "<Dev queue>" ORDER BY priority DESC, key ASC' --fields key,summary,priority,labels --paginate --json
   ```

   Keep every ticket that meets the bar in the contract (the `What goes in a plan` table's
   stability rule) and is not already in the draft. Group by theme, in the theme order the
   current plan uses. No cap: the bar is the only filter.
4. **The cut.** The cut day from `Cadence`, the step table from `TEMPLATE.md`, and a
   placeholder key until the user approves filing the cut ticket. The ticket's type,
   priority, label and summary shape are the `Cut ticket` key. It is linked as blocked by
   the last feature ticket.
5. **Waiting on a ruling.** Every ticket in the `Needs a ruling` status that the draft's
   feature work depends on.
6. **Write the draft** as `<Plan folder>/<next planning day>-week.md` from `TEMPLATE.md`, on
   a branch cut from the default branch. Every ticket in the work tables is a link in the
   `Ticket link` format. No em dashes in prose. No status column and no progress notes: the
   file holds order and reasons only.
7. **Show it and stop.** Print the day-by-day table and the feature table, then numbered
   options: approve as is, reorder, change the focus, file the cut ticket. Commit, push, and
   the cut ticket each need the user's explicit word. Never open a pull request unless asked.

## What this skill does NOT do

- It never writes status into a plan file. Status lives in the tracker and is read live.
- It never starts a ticket. Ticketed work runs through the `Build workflow` the contract names.
- It never commits, pushes, opens a PR, or files the cut ticket on its own.
- It never drops an unfinished ticket from the carry-over.
- It does not support Linear yet. The status script is `acli` and Jira status categories.
