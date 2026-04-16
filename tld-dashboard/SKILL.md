---
name: tld-dashboard
description: |
  Bird's eye view of playbook progress. Shows all steps, their tickets, and current status in a compact grid.
  Use this skill whenever the user says "tld-dashboard", "dashboard", "show progress", "playbook status",
  "how far along are we", or wants to see the overall state of the TLD implementation. Read-only — this skill
  does not modify anything.
---

# TLD Dashboard

You are presenting a progress overview of the TLD playbook. This is a read-only view that helps the user understand where things stand across all steps and tickets.

## Process

### 1. Read the playbook

Read `docs/EXECUTION_PLAYBOOK.md` to get the full structure:
- All steps (number, name)
- All tickets within each step (in order)
- Total ticket count

### 2. Query Linear for statuses

Use `list_issues` to get the current status of all tickets in the mAIn Character project (team: 2ndFoundry). Map each ticket ID to its status. Statuses to track:
- **Done** — completed and committed
- **In Progress** — actively being worked on
- **Todo** / **Backlog** — not started
- **Canceled** — skipped

### 3. Check git for recent activity

Run `git log --oneline -5` to show the most recent commits for context on what was just done.

### 4. Build the dashboard

Present the progress in this format:

```
## TLD Dashboard

### Overall Progress
[=========-----------] X/Y tickets (Z%)

### Recent Activity
- [commit hash] feat(2ND-XXX): [title] — [time ago]
- [commit hash] feat(2ND-YYY): [title] — [time ago]
```

Then for each step that has at least one non-Todo ticket, OR is the current/next step, show a detail table:

```
### Step N: [step name]
[===-------] X/Y tickets

| # | Ticket | Title | Status |
|---|--------|-------|--------|
| 1 | 2ND-150 | Create migrations | Done |
| 2 | 2ND-151 | Stored procedures | Done |
| 3 | 2ND-152 | Edge function | In Progress |
| 4 | 2ND-153 | Frontend component | Todo |
```

For steps that are fully Done and not the current step, show a collapsed summary:
```
### Step N: [step name] — Done (X tickets)
```

For steps that are entirely Todo and not the next step, skip them entirely to keep the output compact.

**Progress bar characters:**
- Use `=` for done portions and `-` for remaining
- Scale to 20 characters wide

**Status formatting:**
- Done → `Done`
- In Progress → `**In Progress**` (bold to highlight)
- Todo/Backlog → `Todo`
- Canceled → `~~Canceled~~` (strikethrough)

### 5. Highlight the active position

After the tables, add a clear summary:

```
### Current Position
**Active ticket:** [TICKET-ID] — [title] (Step N)
**Step progress:** X of Y tickets done in Step N
**Next up:** [next ticket ID or "gate check" or "all done"]
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Present options

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

**If a gate check is needed:**

**What's next?**

> **1.** /tld-gate — run step boundary validation
>    Best for: ready to close out the step

> **2.** /tld-side-quest — handle cleanup first
>    Best for: noticed polish to handle before the gate

Type **1** or **2** to proceed.

**If all tickets are done:**

**What's next?**

> **1.** /tld-gate — run a final project gate
>    Best for: full regression + drift check before launch

> **2.** /tld-ticket — plan follow-up work
>    Best for: create polish/QA tickets before shipping

> **3.** /tld-side-quest — handle any remaining polish
>    Best for: last-pass cleanup before launch

Type **1**, **2**, or **3** to proceed.
