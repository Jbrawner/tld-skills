---
name: tld-spot-check
description: |
  Final code spot-check for a container (Story/Epic) closeout — the last human-style read of the Story's
  combined changes across all its children, catching the integration-seam and final-polish issues that
  per-ticket audits miss: leftover debug/TODOs, inconsistent patterns between children, dead seams where one
  child's code meets another's, and acceptance criteria claimed-but-not-actually-in-the-code. Use this skill
  whenever the user says "tld-spot-check", "spot check", "final code check", "closeout spot check", or when the
  configured container pipeline reaches its spot-check step. It REUSES tld-gate for regression/consistency and
  does NOT re-run tests itself; it is a focused code read, not exhaustive. Read-only: it reports findings but
  does NOT modify code and does NOT transition any ticket. Optional argument: the Story key
  (`/tld-spot-check DROSS-30`); with no argument it resolves the current Story context. This is the Claude
  container-closeout spot-check of the dual-runtime workflow: it is ADDITIVE and reads the same standardized
  child comments Matt's Codex path writes.
---

# TLD Spot Check

You are doing the **final code spot-check** of a container closeout. A Story (the Jira milestone) has had all
its child Sub-tasks implemented, audited per-ticket, and rolled up. Before it closes, this is the last set of
eyes on the *combined* result: read the Story's changes as one body of code and catch what the per-ticket flow
could not see — the seams between children, the leftovers, and whether the Story's goal is actually realized in
the code rather than merely asserted in the write-ups.

**This skill is read-only. It reports findings but does NOT modify code and does NOT transition any ticket.**

## Where this sits

In a container pipeline the closeout is a sequence:

```
story:  tld-gate  →  tld-story-review  →  tld-spot-check
```

The division of labor is deliberate, so nothing is done twice:

| Step | Owns | Does not |
|---|---|---|
| `tld-gate` | Full regression, cross-ticket consistency, drift; transitions the Story→Done on PASS | Not a human code read |
| `tld-story-review` | Aggregates children's write-ups + audit comments into the rollup | Runs no tests, changes no state |
| `tld-spot-check` (this) | The final manual code read of the combined diff | **Does not re-run regression — that is `tld-gate`'s job**; changes no code; transitions nothing |

Because `tld-gate` already ran the regression and consistency checks, this skill **reuses that result** and does
not repeat it. If `tld-gate` has not passed for this Story yet, say so and point back to it rather than running
tests here.

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

### 2. Determine the spot-check scope (the Story's combined changes)

**Story key provided as an argument (recommended):** if the user invoked `/tld-spot-check {storyKey}` (this is
how a container pipeline calls it), use that key. Otherwise resolve the current Story from context; if it is
ambiguous, stop and output:
  "No Story specified and the current Story is ambiguous. Re-run as /tld-spot-check {storyKey}."

Assemble the set of files that make up the Story's combined change:

1. **From the children's write-ups.** Load the Story's children (Jira: Sub-tasks of the Story; Linear: milestone
   Order) and read each child's completion write-up comment (`# <CHILD-KEY> complete — <title>`). Collect the
   union of files listed in each `## What changed` section.
2. **From git.** List the files changed on the Story's branch against its base (`git diff --name-only <base>...HEAD`,
   or the closest available range). Union this with the write-up file list.
3. If the two disagree (a file changed in git that no write-up mentions, or vice versa), note it — that mismatch is
   itself a spot-check finding.

Read those files **as they now stand** (the integrated result), not each child's diff in isolation.

### 3. Spot-check passes

This is a focused read, **not** an exhaustive re-audit. Concentrate on what only shows up when the children are
looked at together:

**PASS A — Integration seams.** Where two or more children touched the same file, module, table, or endpoint: do
their changes cohere? Look for conflicting assumptions, duplicated logic that should have been shared, mismatched
function signatures or types across the seam, and one child calling something another child changed or removed.

**PASS B — Leftovers.** Debug logging (`console.log`, `print`, dumps of request bodies), commented-out code,
`TODO`/`FIXME`/`XXX`, temporary hacks, stray scaffolding or fixtures, and hardcoded test values left in the
Story's files.

**PASS C — Cross-child consistency.** Naming, error handling, auth patterns, and structure applied uniformly
across the Story's changes — not each child doing it its own way.

**PASS D — Acceptance realized in code.** Read the Story's own description (goals / acceptance criteria) and
confirm the *union* of the children actually delivers it in the code, not merely that each write-up claimed its
slice. Flag any Story-level goal that no child's code visibly implements.

**PASS E — Open audit findings still live.** Cross-reference the open findings from the `tld-story-review` rollup
(and each child's `# <CHILD-KEY> audit findings — non-blockers` comment). For any finding still marked `open`,
check whether it is still present in the code as it now stands. Report the ones that are.

### 4. Output

Present findings in a severity-grouped table. Severity here is closeout-scoped:

- **BLOCKER** — should not close the Story: a broken seam, an unmet Story goal, an open finding that is actually a defect.
- **NIT** — worth fixing but not close-blocking: leftovers, minor inconsistency.

```markdown
## Spot-Check — [Story key] [story title]

**Scope:** [N] files across [M] children
**Regression:** [reused from tld-gate: PASS / not yet run — see tld-gate]
**Findings:** [count] ([X] blocker, [Y] nit)
```

**If findings exist:**

| # | Severity | Pass | File | Finding | Suggested fix |
|---|----------|------|------|---------|---------------|
| 1 | BLOCKER | Seam | `functions/foo/index.ts` | Calls `scoreRound()` removed by DROSS-31 | Restore or update the caller |
| 2 | NIT | Leftover | `components/Bracket.tsx:88` | `console.log(payload)` left in | Remove before close |

Sort BLOCKER first, then NIT; then by pass.

**If no findings:**

```
Spot-check clean. The Story's combined changes read consistently, no leftovers, and the Story's goals are realized in the code.
```

This skill posts **no** comment — the durable closeout artifact is the `tld-story-review` rollup. Spot-check
reports to the closeout for a human decision.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Present options

---

**If BLOCKER findings exist:**

**What's next?**

> **1.** Fix the blockers above (in the relevant child), then re-run /tld-spot-check
>    Best for: standard flow — the Story should not close with an open blocker

> **2.** /tld-side-quest — track the blockers as separate ticket(s)
>    Best for: the fix is out of this Story's scope

> **3.** /tld-dashboard — see the Story's state in context
>    Best for: want the blast radius before deciding

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT fix the findings yourself, do NOT close or transition the Story, do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

**If only NITs, or no findings:**

**What's next?**

> **1.** /tld-gate {storyKey} — run (or confirm) the regression gate and roll the Story up to Done
>    Best for: standard flow — spot-check is clean, let the gate close the Story

> **2.** Fix the nits above first, then re-run /tld-spot-check
>    Best for: the leftovers are quick and worth clearing before close

> **3.** /tld-dashboard — review overall progress
>    Best for: want the big picture before closing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT close or transition the Story, do NOT run the gate yourself, do NOT invoke any other skill. Spot-check reports; it does not close. Wait for the user to pick an option or type a command.**

## What this skill does NOT do

- **No regression.** It never runs a test command or a destructive operation. Regression and consistency are `tld-gate`'s job and are reused here, not repeated — so this skill needs no local-database safety gate.
- **No transitions.** It never moves the Story, its Epic, or any child. `tld-gate` transitions on PASS.
- **No code changes and no fixing.** It reads the combined result and reports; a human or a follow-up ticket resolves what it finds.
- **Not exhaustive.** It is a spot-check of the seams and the leftovers, not a re-run of every per-ticket audit.

## Limitations

- **Depends on the closeout order.** It reuses `tld-gate`'s regression result and reads the `tld-story-review`
  rollup, so it is most useful last in `tld-gate → tld-story-review → tld-spot-check`. Run alone, it still does its
  code read but reports regression as "not yet run — see tld-gate".
- **Scope is only as good as the write-ups + git range.** If a child's write-up omitted a changed file and the git
  base range is wrong, a file can be missed. The git/write-up mismatch check in §2 is the guard, but it is not a
  substitute for correct child write-ups.
- **Container wiring.** `tld-orchestrate` does not yet drive the `story:` pipeline end to end (its container
  fan-out is a follow-up); this skill is invocable directly by Story key today.
