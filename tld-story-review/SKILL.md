---
name: tld-story-review
description: |
  Story closeout rollup — reads every child Sub-task's completion write-up (tld-writeup output) and
  standardized audit-findings comment (tld-audit output), surfaces open findings and unmet acceptance
  criteria across the children, and posts ONE idempotent Story rollup comment for humans and the Epic-level
  review to read. Use this skill whenever the user says "tld-story-review", "story review", "story rollup",
  "close out the story", "roll up the sub-tasks", or when the configured container pipeline reaches its
  review step. Read-mostly: it reads child comments and writes exactly one rollup comment. It does NOT run
  tests, does NOT modify code, and does NOT transition any ticket — tld-gate owns regression and the Story
  transition. Optional argument: the Story key (`/tld-story-review DROSS-30`); with no argument it resolves
  the current Story context. This is the Claude container-closeout review of the dual-runtime workflow: it is
  ADDITIVE and parses the same standardized comments Matt's Codex path writes.
---

# TLD Story Review

You are writing the **Story closeout rollup**. A Story (the Jira milestone) holds child Sub-tasks that have
each been implemented and written up. Your job is to read what every child produced — its completion write-up
and its audit-findings comment — aggregate the state, surface anything still open, and post one rollup comment
that tells a human (and a later Epic review) whether the Story is clean to close.

**This skill is read-mostly. It reads child comments and posts exactly one rollup comment. It does NOT run
tests, does NOT modify code, and does NOT transition any ticket.** Regression and the Story→Done transition
belong to `tld-gate`; this review only reads and reports.

## Where this sits

In a container pipeline the closeout is a sequence, not one skill:

```
story:  tld-gate  →  tld-story-review  →  tld-spot-check
```

`tld-gate` verifies every child is resolved and the full regression is green, and on PASS rolls the Story (and
possibly its Epic) up to Done. `tld-story-review` — this skill — produces the human-and-machine rollup of what
the children delivered. It is deliberately transition-free so it can be run at any point in the closeout (before
or after the gate) without changing ticket state.

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

This skill's ticket and milestone operations are written using Linear MCP tool names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Linear** — call the Linear MCP tools directly, as written in this skill. Contract: docs/ADAPTERS.md.
- **Jira** — perform the equivalent operation per docs/JIRA.md instead (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Linear, Jira. See LIMITATIONS.md."
  Do not invent an adapter.

### 2. Identify the Story and its children

**Story key provided as an argument (recommended):** if the user invoked `/tld-story-review {storyKey}` (this
is how a container pipeline calls it), use that key directly. This is authoritative.

**No argument (fallback):** resolve the Story from context. If the conversation names the current Story
(milestone) being closed out, use it. Otherwise, resolve "me" via the tracker's current-user call and look for
the Story whose Sub-tasks were just being worked; if it is ambiguous, stop and output:
  "No Story specified and the current Story is ambiguous. Re-run as /tld-story-review {storyKey}."
Do not guess — the rollup is written onto a specific parent, and writing it on the wrong one is worse than stopping.

Load the children:

- **Jira** — the children are the Story's **Sub-tasks**: `parent = "<storyKey>" ORDER BY Rank ASC`. See
  docs/JIRA.md § Milestone and ordering.
- **Linear** — the children are the milestone's tickets in `## Order`.

If the Story has zero children, stop and output:
  "Story {storyKey} has no child tickets to roll up."

### 3. Read each child's write-up and audit comment

For every child, read its comments (Jira: `getJiraIssue` with the `comment` field; Linear: list comments) and
find the two standardized comments by their marker first lines:

| Source comment | Marker (first line) | Written by |
|---|---|---|
| Completion write-up | `# <CHILD-KEY> complete — <title>` | `tld-writeup` |
| Audit findings | `# <CHILD-KEY> audit findings — non-blockers` | `tld-audit` |

From each child, extract:

| Field | Source of truth | If missing |
|---|---|---|
| state | write-up Handoff `handoff_state`, else the Result `Status:` line | fall back to the child's tracker status; record a gap |
| tests | write-up `## Tests` → `Result:` (passed \| failed \| skipped) | record "unknown" and a gap |
| open findings | audit comment `Summary:` line → the `<O> open` count | **absent audit comment means zero findings** — `tld-audit` only posts when low/medium findings exist. Not a gap. |
| unmet AC | write-up `## Acceptance Criteria` → count of unchecked `- [ ]` items, with their text | if there is no write-up, record a gap |

**Never invent a result.** If a child has no completion write-up comment, do not synthesize its state from the
diff or the ticket body — record it in the Gaps section as "no completion write-up found" and mark its state
from the tracker status only. A child with no write-up is either unfinished or had its write-up step skipped;
either way the rollup must show the gap, not paper over it.

### 4. Aggregate

Compute the rollup totals from §3:

- **Children:** total; count `done`; count `blocked`/`failed`; count missing a write-up.
- **Open findings:** sum of each child's `open` count, and how many children carry at least one.
- **Unmet AC:** total unchecked criteria across all children, listed per child.
- **Gaps:** any child missing a write-up, missing test result, or otherwise unreadable.

### 5. Post the rollup comment

Post exactly **one** rollup comment on the **Story** (the parent), updating it in place on every re-run — never
a second comment. Resolve against the tracker:

- **Jira** — per docs/JIRA.md: `getJiraIssue` on the Story with the `comment` field, find the comment whose
  first line is the rollup marker, then `addCommentToJiraIssue` passing its `commentId` to update in place;
  else add a new comment. Use `contentFormat: markdown`.
- **Linear** — find the existing rollup comment by its marker first line and update it; else create it.

Fill every line; keep the structure fixed:

````markdown
# <STORY-KEY> story rollup — <story title>

Run: <session id>   <timestamp>
Children: <N> total · <D> done · <B> blocked/failed · <G> missing write-up
Open findings: <O> across <C> children   Unmet AC: <U>

## Children
| child | state | tests | open findings | unmet AC |
|-------|-------|-------|---------------|----------|
| DROSS-30 | done | passed | 0 | 0 |
| DROSS-31 | done | passed | 2 | 1 |
| DROSS-32 | blocked | unknown | — | — |

## Open findings (across children)
- DROSS-31 a1 (medium): Score calc in component; belongs in an edge function — `components/Bracket.tsx:42`

## Unmet acceptance criteria
- DROSS-31: returns 200 with {token} — deferred, see the child's follow-ups

## Gaps
- DROSS-32: no completion write-up found (child unfinished, or write-up step skipped)

## Verdict
not ready — 1 child blocked, 2 findings open, 1 unmet criterion
````

Rules for the rollup:

- The **marker** is the first line, `# <STORY-KEY> story rollup — <story title>`. It is how the comment is found
  for idempotent update and how a later Epic review (`tld-epic-review`) locates each Story's rollup. Do not alter it.
- The `Children:` and `Open findings:` / `Unmet AC:` lines are the machine-readable summary — the stable contract
  an Epic review parses, the same way this skill parses each child's `Summary:` line. The tables and lists are detail.
- **Verdict** is `ready to close` only when every child is `done`, there are no open findings, no unmet AC, and no
  gaps. Otherwise it is `not ready` with a one-line reason. This is a recommendation surfaced for the human and the
  gate — this skill does not itself transition or block anything.
- Every section is always present. Empty sections read `- none`, not an omitted heading, so the shape stays parseable.

> **Template location.** This rollup shape is carried inline here for now. Phase 4 extracts the standardized
> templates to a shared `share/templates/` file both agents read (in workflow-tools); when the shared Story-rollup
> template lands, switch to reading it so the Codex and Claude copies cannot drift.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Output and options

Print the rollup you posted, then the verdict, then:

**If the verdict is `ready to close`:**

**What's next?**

> **1.** /tld-spot-check — final code spot-check on the Story's changes (Recommended)
>    Best for: standard closeout flow — the rollup is clean, do the last look

> **2.** /tld-gate {storyKey} — run the regression/consistency gate and roll the Story up to Done
>    Best for: the gate has not run yet for this Story

> **3.** /tld-dashboard — review overall progress
>    Best for: want the big picture before closing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke /tld-spot-check, /tld-gate, or any other skill, and do NOT transition the Story. Wait for the user to pick an option or type a command.**

**If the verdict is `not ready`:**

**What's next?**

> **1.** Address the open findings / unmet AC listed above (in the relevant child), then re-run /tld-story-review
>    Best for: standard flow — the rollup found real gaps

> **2.** /tld-side-quest — track the open items as separate ticket(s)
>    Best for: the gaps are out of this Story's scope

> **3.** /tld-dashboard — see the Story's state in context
>    Best for: want to understand what is left before deciding

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT fix the findings yourself, do NOT transition the Story, do NOT invoke any other skill. A `not ready` rollup is a report, not a to-do you execute. Wait for the user to pick an option or type a command.**

## What this skill does NOT do

- **No tests.** Regression is `tld-gate`'s job. This skill never runs a test command or a destructive operation, so it needs no local-database safety gate.
- **No transitions.** It never moves the Story, its Epic, or any child. `tld-gate` transitions on PASS.
- **No code changes.** It reads comments and writes one comment.
- **No fixing.** It surfaces open findings and unmet AC; a human or a follow-up ticket resolves them.

## Limitations

- **Reads the standardized comments, not chat.** The rollup is only as good as the child write-ups and audit
  comments. A child whose `tld-writeup` step was skipped shows up as a gap, by design. This is the intended
  pressure to keep the pipeline's write-up step in place.
- **Shared template is inline for now.** The canonical Story-rollup template lives in the dual-runtime plan and is
  extracted to `share/templates/` in Phase 4 (workflow-tools). Until then this skill carries it inline. When the
  shared file lands, switch to reading it so the two agents cannot drift.
- **Story level only.** The Epic-level version (`tld-epic-review`) is later work; it will parse the `story rollup`
  markers this skill writes the same way this skill parses child `complete` and `audit findings` markers.
- **Container wiring.** `tld-orchestrate` currently stops at a container ticket (its Phase 4 guard). Wiring the
  `story:` pipeline (gate → review → spot-check) through the runner is a follow-up; this skill is invocable directly
  by key today.
