---
name: tld-dashboard
description: |
  Bird's eye view of milestone progress. Shows all milestones, their tickets, and current status in a compact grid,
  and reconciles the tracker against git — which tickets read Done but have no code on the default branch, and which
  merged tickets are still waiting to be closed out. Use this skill whenever the user says "tld-dashboard",
  "dashboard", "show progress", "milestone status", "how far along are we", "did that actually ship", or wants to see
  the overall state of the TLD implementation. Read-only — this skill does not modify anything.
---

# TLD Dashboard

You are presenting a progress overview of the project's milestones. This is a read-only view that helps the user understand where things stand across all milestones and tickets.

It also answers the question a tracker cannot answer by itself: **is the code actually there?** Step 4.5 tests every Done ticket against the default branch, because a ticket's status is a claim and git is the record. See [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md) for why that check exists and how it decides.

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

### 2. List milestones

Call `list_milestones` for the configured project, sorted by `sortOrder` ascending.

**Empty state:** If the result is empty, render the empty dashboard and stop:

```
## TLD Dashboard

No milestones in project "{project name}" yet.

### What's next?

> **1.** /campaign-plan — plan milestones for this project
>    Best for: starting a new project structure

> **2.** /milestone-create — create a single milestone by hand
>    Best for: adding one milestone to an existing plan

Type **1** or **2** to proceed.
```

Skip the remaining steps when rendering the empty state.

### 3. Build per-milestone Order and statuses

For each milestone in sortOrder:
1. Call `get_milestone` and parse the `## Order` section using the unanchored regex algorithm:
   - Find `^## Order\s*$`; capture lines until the next `^## ` header or end-of-description.
   - For each line, take the first regex match of `({prefix}-\d+)` — unanchored. Do NOT anchor on `^\d+\.\s+` (Linear's auto-link rewrite breaks that).
2. If the Order section is malformed, render the milestone row with a warning marker (e.g., `⚠ Order malformed — run /milestone-sync`) and continue. Do not fail the whole dashboard.
3. For each ticket ID in Order, look up the current status via a batched `list_issues` (preferred) or per-ticket `get_issue`.
4. Track totals: work-complete (Done + Canceled + the pre-merge status) vs total, and whether there's an In-Progress ticket in this milestone. Track the pre-merge count separately — step 4.5 needs it, and it is the count of tickets whose work is finished but not yet on the default branch.

### 4. Check git for recent activity

Run `git log --oneline -5` to show the most recent commits for context.

### 4.5. Merge reconciliation

**This is the check that catches a tracker claiming work that never shipped.** Under [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md), `Done` means the code is on the default branch. This step tests that claim against git, and it is the reason the dashboard is worth reading rather than just pretty. The dashboard **reports only** — it writes nothing to the tracker, which is its contract.

Run it over two sets of tickets:

- every ticket in a **done-category** status across the project's milestones, and
- every ticket in the **pre-merge** status.

Everything else (Todo, In Progress, Canceled) is out of scope.

**Confirm each one per docs/DONE_MEANS_MERGED.md § Confirming a merge — Test 0 (a merged PR for the ticket's branch), then Test 1 (`git merge-base --is-ancestor`), then Test 2 (file presence, with the rename check).** Never decide this by grepping the default branch's log for a ticket key: a squash merge erases every key while keeping the code, and a key matches prose and substrings. That document explains both failures with the cases that produced them.

Before running the tests, `git fetch origin` once so `origin/{default}` is current — a stale remote ref reports merged work as unmerged.

Render the result as its own section, immediately after Recent Activity, so it cannot be missed:

```
### Merge reconciliation
{N} Done · {M} awaiting merge · checked against origin/{default} at {short-sha}

| Ticket | Status | On {default}? | Evidence | Action |
|--------|--------|---------------|----------|--------|
| {PREFIX}-864 | Done | 🚨 **NO** | branch `{branch}` exists, 0 PRs ever opened | `/tld-setup {PREFIX}-864` — the work has to be re-landed |
| {PREFIX}-870 | Done | ⚠️ unverified | no branch, no PR, ticket lists no files | needs a human |
| {PREFIX}-871 | In PR | 📥 merged | PR #412 MERGED | `/tld-gate {milestoneId}` marks it Done |
| {PREFIX}-872 | In PR | ⏳ not yet | PR #418 open | nothing — normal |
```

Rules for this section:

- **Omit the whole section only when both sets are empty.** A project with nothing Done and nothing pre-merge has nothing to reconcile. Never omit it because every row is clean — print `All {N} Done tickets confirmed on {default}.` A silent check is indistinguishable from a check that did not run.
- **Sort 🚨 rows first**, then ⚠️, then 📥, then ⏳. The first row a reader sees should be the worst one.
- **A 🚨 row is the headline.** Repeat its count in the Overall Progress line as `⚠ {K} tickets read Done but are not on {default}` so it survives a reader who only skims the top.
- **Never soften an unverified row into a pass.** "I could not tell" is reported as unverified, exactly as `/tld-autoland` treats an unconfirmable merge.
- **Cap the work, not the truth.** If the project has more than 50 tickets in scope, test the most recent 50 and print `checked the {N} most recently updated; {M} older not checked` — a silently narrowed check reads exactly like a clean one.

### 5. Build the dashboard

Present the progress in this format:

```
## TLD Dashboard

### Overall Progress
[=========-----------] X/Y tickets resolved (Z%)

### Recent Activity
- {commit hash} feat({prefix}-XXX): {title}
- {commit hash} feat({prefix}-YYY): {title}
```

Then render each milestone based on its state:

**Fully-resolved milestone (every ticket work-complete — Done, Canceled, or pre-merge), NOT the current milestone:**
```
### {milestone name} — Complete ({N} tickets){, awaiting merge: {M} if any ticket is pre-merge}
```

**Fully-Todo milestone, NOT the next-up milestone:**
Skip entirely to keep the output compact.

**Current milestone** (contains an In-Progress ticket) **or next-up milestone** (first non-resolved):
```
### {milestone name}
[===-------] X/Y tickets resolved

| # | Ticket | Title | Status |
|---|--------|-------|--------|
| 1 | {PREFIX}-150 | Create migrations | Done |
| 2 | {PREFIX}-151 | Stored procedures | Done |
| 3 | {PREFIX}-152 | Edge function | **In Progress** |
| 4 | {PREFIX}-153 | Frontend component | Todo |
```

**Progress bar characters:**
- Use `=` for resolved portions and `-` for remaining
- Scale to 20 characters wide
- Resolved = work-complete = Done + Canceled + pre-merge

**Status formatting:**
- Done → `Done`, or `Done 🚨` when step 4.5 could not find its code on the default branch
- Pre-merge (e.g. `In PR`) → `In PR` — work finished, not yet merged
- In Progress → `**In Progress**` (bold to highlight)
- Todo / Backlog → `Todo`
- Canceled → `~~Canceled~~` (strikethrough)

### 6. Highlight the active position

After the tables, add a clear summary. The active ticket comes from Linear's In-Progress query (not from a local cache).

```
### Current Position
**Active ticket:** {TICKET-ID} — {title} ({milestone name})
**Milestone progress:** X of Y tickets resolved in {milestone name}
**Next up:** {next ticket ID, or "milestone gate" if milestone is complete, or "all done" if every milestone is complete}
```

If there is no In-Progress ticket, show:
```
### Current Position
**Active ticket:** none
**Next up:** {next-ticket-id} ({milestone name})
```

If multiple tickets are In Progress, show all of them:
```
### Current Position
**Active tickets (multiple):**
- {TICKET-ID-A} — {title} ({milestone name})
- {TICKET-ID-B} — {title} ({milestone name})
Run /tld-save-point to pick which to resume.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 7. Present options

---

**If there's an active or next ticket:**

**What's next?**

> **1.** /tld-save-point — load context and start working
>    Best for: ready to start the active/next ticket

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling first

> **3.** /tld-help — see full skill reference
>    Best for: unsure which skill fits your situation

> **4.** /tld-ticket — plan a new ticket
>    Best for: spotted work that should be tracked before starting

Type **1**, **2**, **3**, or **4** to proceed.

**If a milestone is complete and a gate check is needed:**

Before rendering the options block, capture the completed milestone's `id` from the `get_milestone` call made in step 3. Substitute it into the `{milestoneId}` placeholder in option 1 below — `/tld-gate`'s no-arg fallback can pick the wrong milestone in Linear histories with re-opened tickets or parallel work, so the explicit ID matters.

**What's next?**

> **1.** /tld-gate {milestoneId} — run milestone boundary validation
>    Best for: ready to close out the milestone

> **2.** /tld-side-quest — handle cleanup first
>    Best for: noticed polish to handle before the gate

Type **1** or **2** to proceed.

**If all tickets across every milestone are resolved:**

Before rendering the options block, capture the **last** milestone's `id` (the final entry in the `list_milestones` sortOrder walk from step 2). Substitute it into the `{milestoneId}` placeholder in option 1 below — even on a final project gate, passing the explicit ID prevents Mode B fallback from picking a re-opened earlier milestone.

**What's next?**

> **1.** /tld-gate {milestoneId} — run a final project gate
>    Best for: full regression + drift check before launch

> **2.** /tld-ticket — plan follow-up work
>    Best for: create polish/QA tickets before shipping

> **3.** /tld-side-quest — handle any remaining polish
>    Best for: last-pass cleanup before launch

Type **1**, **2**, or **3** to proceed.
