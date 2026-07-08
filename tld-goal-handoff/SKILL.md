---
name: tld-goal-handoff
description: |
  Generate the two copy-paste prompts for a manual TLD build handoff: a /compact message and a /goal message. Use this skill whenever the user says "tld-goal-handoff", "goal handoff", "prep the handoff", "give me the compact and goal", "handoff prompt", or wants ready-to-paste /compact + /goal text for a ticket or Story. Reads the ticket(s) from Jira, resolves branch + commit format + Jira Done transition + local DB, then PRINTS two fenced blocks for the user to paste by hand — first /compact, then /goal after compaction finishes. There is NO hook, NO auto-fire, NO clipboard, and NO keystroke automation: this skill only composes and prints text. Optional argument: a ticket or Story key (e.g. /tld-goal-handoff LAB-398).
---

# TLD Goal Handoff — print the `/compact` and `/goal` prompts for manual paste

Your job: produce TWO ready-to-paste text blocks and nothing else — a **`/compact`** message and a **`/goal`** message — so the user pastes them by hand. You do NOT run `/compact` or `/goal`, you do NOT use a hook, you do NOT touch the clipboard, you do NOT inject keystrokes. Compose and print, then stop.

**The order the user will use them:** paste block 1 into `/compact`, wait for the compaction to fully finish, then paste block 2 into `/goal`.

**Hard rules:**
1. Block 1 (`/compact`) must be a single line of plain prose after the word `/compact`, containing **NO other slash-command token** (no `/goal`, no `/tld-*`). A second `/word` inside a `/compact` argument makes the app abort the compaction.
2. Keep block 2 (`/goal`) under ~4000 characters. Never leave a `{placeholder}` — resolve every value.

## Process

### 1. Load config and resolve the key
Read `.tld/campaign.md` (repo root). If missing: "No campaign found — run /campaign-init." and stop. Parse Project (Issue tracker, Ticket prefix), Stack (Database, Co-author), Commit format (Pattern).

Tracker is Jira (default): resolve cloudId via `getAccessibleAtlassianResources`; project key = `Ticket prefix` (quote in JQL).

Resolve the argument key:
- **Sub-task key** (e.g. `LAB-398`) → single-ticket handoff: the `/goal` message builds just that ticket.
- **Story key** (e.g. `LAB-397`) → whole-story handoff: the `/goal` message loops its unfinished Sub-tasks in rank order.
- **No argument** → first Story by rank with an unfinished Sub-task, treated as a Story handoff.

### 2. Gather what the `/goal` message needs
- **Tickets:** for a Story, `parent = "<key>" AND issuetype = Sub-task ORDER BY Rank ASC` (unfinished only), each with a one-line AC distillation and its type. For a single ticket, just that one.
- **Branch:** `git branch --show-current`.
- **Commit:** the campaign Commit `Pattern`; the `Co-Authored-By` trailer from Stack → Co-author (omit if blank).
- **Jira Done:** `getTransitionsForJiraIssue` on one ticket; pick the transition whose target status category is `done` and is NOT cancel. Capture its **id** and the **cloudId**. Bake real values in.
- **Local DB:** campaign Stack → Database. If `.tld/goal-notes.md` exists, read it for env quirks and any prod-DB-to-never-touch; fold into Safety.

### 3. Compose Block 1 — the `/compact` message
One line, plain prose, no other slash token. Shape:

`/compact Keep the campaign config, the {Story/this ticket}'s scope and its ticket list with a one-line status for each, and the outcome of any ticket already finished. Drop the previous ticket's verbose tool output, diffs, and resolved debugging so the next ticket starts from a clean slate.`

### 4. Compose Block 2 — the `/goal` message
Fill real values. For a **single ticket**, drop the ordered list and the "one ticket at a time" framing. For a **Story**, keep them.

```
/goal Drive {KEY} ({title}) through the TLD flow on branch {branch}{, one ticket at a time, in this order: {ORDERED-TICKET-LIST}}.

METHOD — non-negotiable:
- Drive EVERY ticket by invoking /tld-full-auto <ticket> via the Skill tool (it runs /tld-setup → /tld-write-tests → /tld-build → /tld-audit → /tld-run-test). Do NOT inline, reproduce, or shortcut those phases yourself.
- Strictly sequential, one ticket at a time. No subagents, no parallelism.
- If a skill errors, there is real ambiguity, or you are tempted to substitute your own faster process, STOP and report — do NOT hand-roll it. Substituting your own process is a FAILURE even if tests are green.

For each ticket:
1. Invoke /tld-full-auto <TICKET> via the Skill tool. It stops at the verified checkpoint and never commits.
2. Land it: stage ONLY that ticket's files (never `git add -A`), update the right CHANGE_LOG.md under [Unreleased], commit as `{Pattern}`{ with trailer `{trailer}`}, then transition it to Done in Jira (cloudId {cloudId}, transition id {id}).
3. Briefly report the result, then continue to the next ticket.

Ticket-type handling:
- Feature/bug tickets: normal red→green→verify. Each Jira description is decision-complete — do exactly what it says, no improvising.
- Migration/schema tickets: hand-apply to the LOCAL stack only; never `supabase db reset` from a worktree; run the backend tests too.

Safety (non-negotiable):
- DB = {local stack} only. Prove the target is local before ANY DB write. Never touch a non-local database{; never touch prod ref {prod ref}}.
- NEVER push, open a PR, or merge. Commit to the branch only.
- If a single ticket is blocked (env failure, ambiguity, full-auto can't proceed), SKIP it, log why, CONTINUE.

At the end: write a wake-up report (per ticket: built/committed/skipped, commit hash, test results, anything flagged) and STOP.
```

### 5. Print both blocks and stop
Print exactly this and nothing after it:

**Step 1 — paste this into `/compact` first:**

```
{block 1}
```

**Step 2 — after the compaction fully finishes, paste this into `/goal`:**

```
{block 2}
```

Then note the character count of block 2 (e.g. `goal message: 2,900 chars`). **STOP.** Do not run anything, do not invoke another skill, do not touch the clipboard or any hook. The user pastes these two blocks by hand.
