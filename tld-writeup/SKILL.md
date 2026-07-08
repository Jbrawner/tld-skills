---
name: tld-writeup
description: |
  Per-ticket completion writer — the bridge between the TLD flow and the orchestrator's "done" signal.
  Runs as a pipeline step AFTER tld-commit and BEFORE tld-next: it fills the standardized output template
  from the finished ticket's prior-step data (setup, build, run-test, audit, commit), posts exactly ONE
  idempotent completion comment to the tracker, and writes the machine-readable handoff block
  (handoff_state / handoff_validation_summary / handoff_changed_files_summary / handoff_token_usage /
  handoff_blocker) into the shared checklist so the orchestrator sees the result without reading chatter.
  Use this skill whenever the user says "tld-writeup", "tld writeup", "write up the ticket", "post the
  completion comment", "record the handoff", or when the configured pipeline reaches its write-up step.
  It does NOT advance the ticket, commit, push, PR, or mark Done — tld-next owns the transition. This is
  an ADDITIVE Claude skill: it mirrors Matt's Codex `bin/workflow-final-comment` without touching it.
---

# TLD Writeup — the completion + handoff bridge

You are writing the standardized completion record for a ticket whose work is already committed. This is
the **single bridge** between two views of "done": the human-readable completion comment on the ticket,
and the machine-readable handoff block in the shared checklist that the orchestrator reads. The dual-runtime
plan flags this seam as the highest-risk one — if the handoff is not written faithfully, the tracker and the
orchestrator disagree about whether the ticket is done. Doing the human comment and the machine handoff in
**one** skill is deliberate: it collapses that seam into one place.

The contract, in one line: **fill the output template from prior-step data, post exactly one idempotent
completion comment, write the handoff block into the shared checklist, and advance nothing.**

## Where this sits (dual-runtime + pipeline order)

- **Pipeline position:** `… → tld-run-test → tld-commit → **tld-writeup** → tld-next`. It runs after the
  work is committed and before the ticket is transitioned. It never advances the ticket itself.
- **Additive.** This is a new Claude skill that mirrors Matt's Codex `bin/workflow-final-comment` (which
  builds the completion comment from the checklist projection and marks the checklist keys). It touches no
  Codex script, no `CODEX_*` name, no `~/.codex` path. The `handoff_*` field names it writes are exactly
  the checklist keys Matt's `jdev` already writes, so it plugs into the shared engine with no translation.

## When to use this

- Invoked as the write-up step of a configured pipeline (via `/tld-orchestrate`), right after `tld-commit`.
- Run by hand after a ticket's work is committed but before `/tld-next`, to post the completion record and
  write the handoff.

Trigger phrases: `tld-writeup`, "write up the ticket", "post the completion comment", "record the handoff".

## Process

### 0. Preflight

#### 0.1 Load project config

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

**Comment operation.** This skill's whole job includes writing a ticket comment. Resolve it explicitly: on
**Linear** use the comment-create / comment-update call; on **Jira** use `addCommentToJiraIssue` — which
takes an optional `commentId` to **update** an existing comment (the idempotency mechanism in §3). See
docs/JIRA.md § Completion comment + handoff.

#### 0.2 Resolve the current ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

- **Exactly one In-Progress ticket assigned to me:** that is the ticket to write up. Load its full
  description, AC, labels, and milestone.
- **Zero In-Progress tickets assigned to me:** stop and output:
    "No In-Progress ticket found to write up. Run /tld-setup to pick one up, or /tld-commit first."
- **Two or more:** stop and call `AskUserQuestion` with one option per ticket (label = ticket ID + title):
    "Multiple tickets are In Progress — pick the one to write up." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode." There is no offline mode; do not fabricate a write-up.

#### 0.3 Confirm the work is committed

`tld-writeup` records what shipped, so there must be something that shipped. Check that the most recent
commit references this ticket ID (`git log --oneline -5 | grep {ticket-id}`).
- **No commit for this ticket** → stop: "No commit found for {ticket ID}. Run /tld-commit first — tld-writeup
  records a committed result, it does not create one." (This mirrors tld-next's commit-exists check.)

### 1. Gather the prior-step data

Fill the template from what the earlier steps actually produced. **Never invent a result.** For each field,
pull from the real source below; if the source is missing or unreadable, record the gap in that field
(e.g. "not recorded — no run-test output found") rather than guessing or omitting it silently (AC: missing
data is surfaced, not faked).

| Template field | Source of truth |
|---|---|
| Ticket key / title / type | The loaded ticket (§0.2) |
| Run (session id) | The current session id — the same ownership stamp the orchestrator claimed with |
| Timestamp | Current date/time |
| Result status | The pipeline outcome that led here: normally `done` (writeup runs after a clean commit). If the run reached writeup in a `blocked` / `needs_user` / `failed` state, record that instead |
| What changed | `git show --stat {commit}` for this ticket's commit(s) — the changed files and one-line notes |
| Tests | The resolved test command (from campaign Test Commands, matched to scope) and its last result: `passed` / `failed` / `skipped (<reason>)`. For a `skip` campaign, `skipped (content/doc campaign)` |
| Validation | What was validated and the outcome (from run-test's manual-QA plan / drift check), or the gap if none |
| Audit | tld-audit's findings comment on this ticket: non-blocker count, open, resolved — or "none" if audit recorded nothing |
| Acceptance Criteria | The ticket's AC, each marked met `[x]` or unmet `[ ]` with a one-line why-not for unmet items |
| PR | Normally none yet — writeup runs before the story-end PR — so "no PR — committed to {branch}" |
| Follow-ups | Deferred work noted by any step, or "none" |
| Handoff block | Derived: `handoff_state` = the Result status; `handoff_validation_summary` = one line from Validation; `handoff_changed_files_summary` = one line from What changed; `handoff_token_usage` = from the harness result if available, else omitted (never faked); `handoff_blocker` = present only when state is blocked/needs_user/failed |

Prefer the **shared checklist** as the structured source when it is seeded (the orchestrator seeds it per
`/tld-orchestrate` §3.5): earlier steps' notes and any `handoff_*` values already set are readable via
`agent-checklist` (its `.sanitized.md` projection, or `agent-checklist show`). Fall back to git + the
ticket + conversation when a value is not in the checklist.

### 2. Fill the output template

Fill **every** section of the standardized output template (below) from §1. Keep the structure fixed — only
the content varies. An empty section is filled with the recorded gap, never deleted.

### 3. Post the completion comment — idempotently

Post the filled template as a comment on the ticket, posting **exactly one completion comment per ticket
per run**. Re-running updates that comment instead of adding a duplicate (AC: idempotent, keyed by ticket +
run).

**Idempotency by marker.** The comment's first line is the stable marker `# {TICKET-KEY} complete — {title}`
and its Handoff block carries `Run: {session id}`. To stay idempotent:

1. Read the ticket's existing comments (Jira: `getJiraIssue` with the `comment` field; Linear: the issue's
   comments).
2. Look for a prior completion comment for **this ticket + this run** — one whose body contains the
   `# {TICKET-KEY} complete` marker **and** the same `Run: {session id}`.
   - **Found** → update it in place: `addCommentToJiraIssue` with that comment's `commentId` (Linear:
     comment-update). Do not add a new comment.
   - **Not found** → add a new comment (`addCommentToJiraIssue` with no `commentId`).
3. Never post a second completion comment for the same ticket + run. If you cannot read existing comments
   (tracker error), stop and report rather than risk a duplicate — do not blind-post.

Use markdown content format. The comment is the human-facing record; the handoff block inside it is also
machine-readable, which §4 mirrors into the checklist.

### 4. Write the handoff block into the shared checklist

Mirror the Handoff block into the shared checklist so the orchestrator reads the result from structured
state, not from the comment prose. Use the **existing `handoff_*` keys** (the same ones Matt's `jdev`
writes), via the checklist engine:

```
agent-checklist set --field handoff_state               --value <done|blocked|needs_user|failed>
agent-checklist set --field handoff_validation_summary  --value "<one line>"
agent-checklist set --field handoff_changed_files_summary --value "<one line>"
agent-checklist set --field handoff_token_usage         --value "<n in / n out · $cost>"   # omit if unavailable
agent-checklist set --field handoff_blocker             --value "<reason + exact question>" # only when not done
```

Then mark the handoff recorded: `agent-checklist check --key handoff_state_recorded`.

Resolve the checklist for this run the way the engine does — run from the ticket's worktree so the active
`.agent` context is unambiguous, or pass `--repo`/`--thread-id`/`--slug` (the session id and ticket key
from §1). If no checklist has been seeded (running `tld-writeup` outside an orchestrated pipeline, or before
the engine capability is installed — see Limitations), skip the checklist writes and record in the output
(§5) that the handoff block was posted to the comment only. Never fail the write-up just because the shared
checklist is absent — the comment is still posted.

### 5. Output — and hand off to tld-next

`tld-writeup` **advances nothing**: it does not commit, push, open a PR, mark the ticket Done, or run
`/tld-next`. Report what it recorded, then point at the next step:

```
## 📝 Written up — {TICKET-KEY} — {title}

- Completion comment: {posted new | updated existing} on {ticket}
- Handoff: handoff_state={state} written to the shared checklist {or "comment only — no checklist seeded"}
- Gaps recorded: {list of fields that had missing data, or "none"}

Next: /tld-next  (marks the ticket Done and surfaces the next ticket)
```

Then present:

---

**What's next?**

> **1.** /tld-next — mark this ticket Done and move to the next
>    Best for: the write-up is posted and the ticket is finished

> **2.** Re-run /tld-writeup — I filled a gap or a prior step now has data
>    Best for: something was missing; re-running updates the same comment (idempotent)

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT mark the ticket Done, do NOT invoke /tld-next,
do NOT commit or push. Wait for the user (or the pipeline runner) to advance.**

## The standardized output template

Fill this exactly; structure is fixed, content varies. (Canonical source: the dual-runtime plan's output
template. Phase 4 extracts it to a shared `share/templates/` file both agents read; until then this skill
carries it inline so it cannot drift out from under the write-up.)

```markdown
# <TICKET-KEY> complete — <short title>

Type: <Feature|Bug|QA|Polish>   Run: <session id>   <timestamp>

## Result
Status: done | blocked | needs_user | failed
[One plain line: what shipped, or why it stopped]

## What changed
- `path/to/file.ts` — [what changed]

## Tests
- Command: `<exact test command>`
- Result: passed | failed | skipped (<reason>)

## Validation
- [what was validated and the outcome, or the gap if not]

## Audit
- Non-blocker findings recorded: <N>   Open: <N>   Resolved: <N>   (or "none")

## Acceptance Criteria
- [x] [criterion met]
- [ ] [criterion not met — why, and what remains]

## PR
- <PR URL, or "no PR — committed to <branch>">

## Follow-ups
- [deferred work, or "none"]

## Handoff (machine-readable)
- handoff_state: done
- handoff_validation_summary: <one line>
- handoff_changed_files_summary: <one line>
- handoff_token_usage: <n in / n out · $cost>   (optional)
- handoff_blocker: <reason + exact question>   (only when blocked/needs_user/failed)
```

## Guardrails

- **Advance nothing.** No commit, push, PR, or Done transition. `tld-next` owns the transition; `tld-writeup`
  only records.
- **Never invent a result.** Every field comes from a real prior-step source; missing data is written as a
  recorded gap, never fabricated or silently dropped.
- **Exactly one completion comment per ticket + run.** Always look for the existing marked comment and update
  it; never blind-post a duplicate. On an unreadable comment list, stop rather than risk a double-post.
- **The handoff field names are fixed.** Use the existing `handoff_*` keys verbatim so the orchestrator and
  Matt's `jdev` read the same signal. Do not rename or add new handoff keys here.
- **Additive.** Mirrors `bin/workflow-final-comment`; never edits or replaces it.

## Limitations

- **Shared template is inline for now.** The canonical output template lives in the dual-runtime plan and is
  extracted to `share/templates/` in Phase 4 (workflow-tools). Until then this skill carries the template
  inline. When the shared file lands, switch to reading it so the two agents cannot drift.
- **Checklist handoff needs the seeded engine.** Writing `handoff_*` into the shared checklist assumes a
  checklist exists for the run — seeded by `/tld-orchestrate` §3.5, which depends on the engine capability
  `WORKFLOW_PIPELINE_STEPS` (currently only on the unmerged workflow-tools branch). Without a seeded
  checklist, the handoff is recorded in the completion comment only; the comment post always works.
- **Token usage is optional.** `handoff_token_usage` is filled from the harness result when available and
  omitted otherwise — it is never faked (matching the plan's token-visibility rule).

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a
number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you
presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.
