---
name: tld-orchestrate
description: |
  Config-driven pipeline runner — read the `pipelines:` config from `.tld/campaign.md`, resolve the
  current ticket's type against the cascade (team standard → project override → type override), and
  drive each step's TLD skill in order, handling every outcome (done / failed / blocked / needs_user),
  the `stop_after` review pause, per-step retries with a circuit breaker, and resume-from-where-it-stopped.
  Use this skill whenever the user says "tld-orchestrate", "orchestrate", "run the pipeline", "run the
  configured pipeline", "drive this ticket by config", or wants ONE ticket taken through whatever step
  sequence the project configured (instead of the fixed sequence /tld-full-auto hard-codes). Optional
  argument: a ticket ID passed through to the first step (e.g. /tld-orchestrate DROSS-19); with no
  argument the first step (/tld-setup) discovers the next ticket. This is the Claude pipeline runner of
  the dual-runtime workflow: it is ADDITIVE and reads the same per-type config Matt's Codex path will
  read later. It never invents flow — the config decides which steps run, which agent, and where it
  pauses. For the fixed, non-configurable leaf flow use /tld-full-auto; for the two-gate version use
  /tld-partial-auto.
---

# TLD Orchestrate — the config-driven pipeline runner

Drive **one** ticket through the step sequence its **type** resolves to in the project's `pipelines:`
config. This skill is an **aggregator**: every step is a TLD skill formally invoked via the Skill tool,
and this skill re-implements none of them. What it owns is the *control flow* around them — reading the
config, resolving the per-type pipeline, invoking each step in order, and acting on each step's outcome
(advance, retry-then-fail, stop-and-record, or escalate).

The contract, in one line: **read the config, resolve the pipeline for this ticket's type, invoke each
step's skill in order, route on its outcome, honor `stop_after`, break the circuit after N failed fix
attempts, and leave every stop resumable — never restart from the top.**

## Where this sits (dual-runtime)

This is the **Claude pipeline runner** from the dual-runtime plan (Phase 3). It is purely additive:

- It is a **new Claude skill**. It changes nothing in the Codex `skills/` folder, no `CODEX_*` names, no
  `~/.codex` paths. Matt's flows are untouched.
- It reads the **same per-type pipeline config** the Codex path will read later, so a project's flow is
  defined once and both agents honor it.
- Where a project has **no** `pipelines:` config at all, the built-in **team-standard default** (the leaf
  flow below) applies, so existing campaigns keep working unchanged.

**Not the same as `/tld-full-auto`.** Full-auto hard-codes one leaf sequence
(setup → write-tests → build → audit → run-test) and always stops before commit. This skill runs
**whatever the config says** — a different sequence per project or per ticket type, with configurable
pause points and a configurable commit/write-up/next tail. If the config is just the standard leaf
pipeline and you want the fixed behavior, `/tld-full-auto` is the simpler tool.

## When to use this

- One ticket, driven end to end by the project's configured pipeline rather than a fixed sequence.
- A project whose flow differs from the default (extra steps, a pause after tests, a different tail).
- You want outcome routing (retry-then-fail, stop-and-record-blocker, escalate-needs-user) instead of
  full-auto's "stop on anything not perfectly clean."

Trigger phrases: `tld-orchestrate`, `orchestrate`, "run the pipeline", "run the configured pipeline",
"drive this ticket by config".

## Inputs

What the user provides:
- Optionally a ticket ID (e.g. `/tld-orchestrate DROSS-19`) — passed through **verbatim** to the first
  step (`/tld-setup`). With no argument, the first step discovers the next ticket.
- Nothing else — the flow comes from the config, the ticket details come from the sub-skills.

What you read on your own:
- `.tld/campaign.md` — the four standard sections **plus** the optional `## Pipelines` section (below).
- Everything else comes from the sub-skills' own outputs.

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

**Comment operation.** This skill posts ticket comments of its own (the blocker/needs_user records in §5). The canonical Tracker-resolution block does not name a comment tool, so resolve it explicitly: on **Linear** use the comment-create call; on **Jira** use `addCommentToJiraIssue`.

#### 0.2 Local DB safety check

**Run the local-DB safety check before any test command or destructive database operation.**

Read `Stack.Database` from `.tld/campaign.md` — this names the expected local instance (e.g., `Supabase local at 127.0.0.1:54321`).

Verify the live database connection also points at local:
1. Scan the repo for database URL references (Supabase config, `.env*`, `SUPABASE_URL`, `DATABASE_URL`, or equivalent for this project's stack).
2. If any reference names a non-local host (anything that is not `127.0.0.1` or `localhost`), **HARD ABORT immediately**:

```
🛑 ABORT: Non-local database detected.

Found: [the URL/host that's not local]
Location: [where you found it]
Campaign Stack.Database: [value from campaign.md]

This skill drives steps that run tests or destructive operations against the database.
Refusing to proceed against a non-local database.

Fix: Ensure the configured database URL points at local (matches Stack.Database).
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

#### 0.3 Record pre-existing worktree state

Run `git status --porcelain` and record every already-dirty path. These paths are **not part of this run**. After the first step loads the ticket, if any pre-existing dirty path overlaps the ticket's "Files to Create/Modify," STOP — the runner cannot separate prior edits from this run's work in the same file. The configured `Changelog path` is a known exception the commit step will stage; if it is among the pre-existing dirty paths, STOP before invoking any step.

### 1. Read the pipeline config

The pipeline config lives in an optional `## Pipelines` section of `.tld/campaign.md`, holding a fenced
`yaml` block — a map of pipelines keyed by ticket type. It is **local overrides only**; anything the
project does not override falls back to the built-in team standard in §2. Example:

```yaml
pipelines:
  default:                 # leaf; anything unlisted inherits this
    - skill: tld-setup
    - skill: tld-write-tests
    - skill: tld-build
    - skill: tld-audit
    - skill: tld-run-test
    - skill: tld-commit
    - skill: tld-writeup
    - skill: tld-next
  bug:     { use: default }
  subtask: { use: default }

  story:                   # container; fires when children are done
    trigger: all_children_done
    steps:
      - skill: tld-gate
      - skill: tld-story-review
      - skill: tld-spot-check
```

Per-step keys the runner honors:

| Key | Meaning | Default |
|---|---|---|
| `skill:` | The TLD skill to invoke for this step (required) | — |
| `stop_after:` | `true` → pause for human review after this step succeeds | `false` |
| `on_fail:` | Which skill to invoke to fix a `failed` outcome | `tld-align` |
| `retries:` | How many `on_fail` attempts before the circuit breaks | `2` |

If `.tld/campaign.md` has **no** `## Pipelines` section, use the built-in team standard from §2 as-is.
Do **not** stop for a missing config — its absence means "use the standard," which is the common case.

### 2. Resolve this ticket's pipeline (the cascade)

Resolution is three layers, and nothing is ever undefined — everything falls back to the standard:

```
team standard (built into this skill)  →  project override (## Pipelines)  →  type override
```

**The built-in team standard** (used whenever the project has not overridden it) is the leaf pipeline:

```
tld-setup → tld-write-tests → tld-build → tld-audit → tld-run-test → tld-commit → tld-writeup → tld-next
```

Resolve as follows:

1. **Determine the ticket's type.** Read the ticket (the first step will load it in full; for resolution
   you only need its issue type). Map the type to a flow shape:
   - **Leaf** — Sub-task, Bug, Task → pipeline key `default` (or the type's own key if the config defines one).
   - **Container** — Story, Epic → pipeline key `story` / `epic`. See §3 — container flows are not shipped yet.
2. **Look up the key** in the resolved config (project override merged over the built-in standard):
   - Key present with `use: X` → resolve to pipeline `X` (follow one level of indirection).
   - Key present with an explicit step list (or `steps:` under a `trigger:`) → use it.
   - Key absent → fall back to `default`.
   - `default` absent from the project config → fall back to the **built-in standard** above.
3. The result is an **ordered list of steps**. That list is the pipeline for this run.

> **Checklist seeding (DROSS-20).** Seeding the shared `agent-checklist` from this resolved step list —
> so the gates and the orchestrator's done-signal match the configured flow — is a **separate ticket
> (DROSS-20)** and uses the engine capability `WORKFLOW_PIPELINE_STEPS`. This skill resolves and drives
> the steps; DROSS-20 makes the resolved list durable in the checklist. See the Limitations note at the
> end for what that means for resume today.

### 3. Container guard (leaf ships first)

If the resolved pipeline is a **container** flow (type Story/Epic, or a config entry with a `trigger:`),
STOP with a clear message:

```
Container pipelines (Story/Epic closeout) are not available yet.

The closeout steps they invoke — tld-story-review, tld-spot-check — ship in Phase 4.
This ticket resolves to a container flow ({type}), so there is nothing to drive yet.

Run /tld-orchestrate against a leaf ticket (Sub-task / Bug / Task), or drive the
container's children individually for now.
```

Do not attempt to invoke a closeout step that does not exist. (A configured step whose skill is genuinely
not installed is a different event — a HARD STOP under §4's invocation rule.)

### 4. Drive the steps

Walk the resolved step list **in order**. For each step:

1. **Formally invoke the step's skill via the Skill tool** — with the user's ticket-ID argument on the
   first step if one was given, no argument otherwise. Never inline a step's logic instead of invoking
   its skill. Never reorder. A skill that genuinely *has nothing to do* still runs and returns output
   saying so — **silent skipping is failure.** A skill that **cannot be invoked at all** (missing / not
   installed, the Skill-tool call errors, or it returns no output) is a **HARD STOP** — never treat an
   empty or failed invocation as "nothing to do," and never proceed past it.
2. **Show the step's output.**
3. **Determine the step's outcome** (§5) and route on it.
4. On `done`: if the step has `stop_after: true`, go to §6 (pause). Otherwise advance to the next step.

When the last step returns `done`, the pipeline is complete — go to §7 (report).

### 5. Outcome routing

Each step reports one of four outcomes. The vocabulary matches the checklist engine
(`done` / `failed` / `blocked` / `needs_user`).

**How to read a step's outcome.** The TLD sub-skills end at a "What's next?" block rather than printing a
literal outcome word, so infer the outcome from what the step surfaced (the same interpretation
`/tld-full-auto` uses):

| Outcome | How a step signals it | Runner behavior |
|---|---|---|
| **done** | Ends on a clean go-forward gate — RED confirmed, GREEN build, audit LOW/none, tests+drift clean, commit landed. Once `tld-writeup` has run, its `handoff_state: done` in the write-up is the authoritative signal. | Advance to the next step (or pause if `stop_after`). |
| **failed** | Ran but couldn't pass — tests red, build stuck at its retry cap, drift detected, or a remediation gate in slot 1 (`/tld-align`). `handoff_state: failed`. | Route to the fix step — see the circuit breaker below. |
| **blocked** | An external thing is missing — creds, a service, a dependency, tracker unreachable, non-local DB. `handoff_state: blocked`. | STOP. Record the blocker (below). Leave resumable. |
| **needs_user** | A genuine human decision — a step raises an interactive `AskUserQuestion` that is not a routine forward gate, or asks the spec/tests be changed. `handoff_state: needs_user`. | Escalate (below). Do not auto-answer. |

Distinguishing a **routine forward gate** (which is `done`) from a **remediation gate** (which is
`failed`/`needs_user`): identify the go-forward option by **meaning**, not slot number. Several sub-skills
put a *remediation* in slot 1 (`/tld-build` retry-cap → `/tld-align`; `/tld-write-tests` passing-during-RED
→ "Investigate"; `/tld-audit` HIGH/MEDIUM → "Fix the findings"). A step whose slot 1 is a remediation has
**not** reached a clean result — treat it as `failed`, not as an approved advance.

**failed → circuit breaker.** When a step is `failed`:
1. Invoke its `on_fail` skill (default `tld-align`) via the Skill tool. Show its output.
2. Re-invoke the failed step.
3. If it is now `done`, advance (and note the fix cycle in the report).
4. Count the attempts. After `retries` failed fix attempts on the **same** step (default 2), **the circuit
   breaks**: STOP as `failed` rather than looping and burning tokens. Report which step broke and the last
   failing output verbatim.

**If the fix step (`tld-align`) proposes changing tests rather than implementation → STOP as `needs_user`.**
Changing the spec to match the code is always a human decision.

**blocked → record and stop.** Post a standardized blocker comment on the active ticket (via the comment
operation from §0.1): what is missing and the exact thing needed. Then STOP — the pipeline is resumable
from this step once the blocker clears. Do not revert or clean up the worktree.

**needs_user → escalate, park, stop.** Post the standardized record on the ticket: the blocker and the
**exact question** the human must answer. Then STOP the pipeline, parked and resumable from this step.

> The full `needs_user` escalation — push the question to the phone, park the ticket with a wait deadline,
> and keep working *other* tickets while it waits — is the **orchestrator's** job (Phase 5), because it
> spans more than one ticket and one session. This single-ticket skill's responsibility is to **record the
> question on the ticket and stop cleanly and resumably.** It never silently drops the question, and it
> never guesses the answer.

### 6. `stop_after` — pause for human review

When a step that completed `done` has `stop_after: true`, do **not** advance. Pause and present:

```
## ⏸ Pipeline paused after {step-skill} — {ticket}

{the step's own output / result summary}

Steps done:      {list}
Paused after:    {step-skill}  (stop_after)
Remaining steps: {list}

Review the result above. To continue, run /tld-orchestrate again — it resumes from the next step.
```

Then STOP the turn. This flag is the per-project lifecycle: some projects run straight through, others
pause after tests or before commit, all from the same config.

### 7. Resume (resumable, never restart)

A stopped pipeline — `blocked`, `needs_user`, a broken circuit, or a `stop_after` pause — resumes from
**where it stopped**, never from the top. On a fresh `/tld-orchestrate` invocation:

1. Re-run preflight (§0) and re-resolve the pipeline (§1–§2) for the same ticket.
2. Determine the **resume point** — the first step not yet `done`.
3. Continue driving from that step (§4).

**Where the resume point comes from.** The durable record of "which steps are done" is the shared
`agent-checklist`, seeded from the resolved steps in **DROSS-20**. Until that engine capability is
installed (see Limitations), the runner cannot read a seeded step-state, so today it determines the resume
point the way `/tld-save-point` does — by re-reading the ticket status, the git worktree state, and any
`tld-writeup` handoff already posted — and asks the user to confirm the resume step if it is ambiguous.
Do not re-run a step that has already landed its work (a second `tld-build` over a finished worktree, a
second `tld-commit`); when unsure whether a step already ran, ask rather than repeat it.

### 8. Report

On completion (last step `done`), output:

```
## ✅ Pipeline complete — {ticket} — {title}

| # | Step | Outcome |
|---|---|---|
| 1 | {skill} | ✅ done |
| … | … | … |

Fix cycles used: {step: n, or "none"}
Recorded on ticket: {blocker/needs_user notes posted, or "none"}
```

For a stop (`blocked` / `needs_user` / broken circuit), output instead:

```
## 🛑 Pipeline stopped at {step} — {ticket}

| # | Step | Outcome |
|---|---|---|
| … | {completed} | ✅ done |
| n | {stopping step} | ⛔ {failed | blocked | needs_user} — {one-line reason} |
| … | {remaining} | ⏭ not reached |

**Why:** {the finding/failure/question, verbatim from the step's output}
**Recorded:** {the ticket comment posted, or "none"}
**Worktree:** {uncommitted files left in place — nothing reverted}
**Resume:** run /tld-orchestrate again — it resumes from {step}.
```

## Guardrails

- **Additive only.** This skill adds a Claude path; it never changes Codex behavior, `CODEX_*` names, or
  the Codex `skills/` folder.
- **The config decides the flow, not this skill.** Never add, drop, or reorder steps beyond what the
  resolved pipeline says. If the flow is wrong, fix the config, not the run.
- **No step's logic is inlined.** Every step is a formal Skill-tool invocation; a failed or empty
  invocation is a HARD STOP, never "nothing to do."
- **The runner does not itself commit, push, PR, or mark Done.** Those happen only if the configured
  pipeline includes the step that does them (`tld-commit`, `tld-next`), invoked as steps — and each of
  those keeps its own approval gate. The runner never reaches around a step to land work.
- **Never run destructive database commands.** The §0.2 check enforces local-only; treat any ambiguity as
  a stop.
- **Every stop is resumable and non-destructive.** On any stop, leave the worktree exactly as it is — no
  resets, no reverts, no cleanup.

## Limitations (read before claiming an end-to-end run)

- **Checklist-seeded resume is not wired yet.** Seeding the shared checklist from the resolved step list —
  and reading it back to find the resume point — depends on the engine capability
  **`WORKFLOW_PIPELINE_STEPS`**, which is delivered by **DROSS-20** and currently exists only on the
  unmerged workflow-tools branch `claude/codex-tools-claude-review-4f9de5`. The installed `agent-checklist`
  does not have it yet. Until that engine work is merged and reinstalled (or `install.sh` is run from that
  branch), this skill drives steps and routes outcomes correctly, but **resume falls back to the
  `/tld-save-point`-style re-read of ticket + git state** rather than a durable seeded step-state. Do not
  claim a fully checklist-driven end-to-end run until that capability is installed.
- **Container flows are Phase 4.** Story/Epic closeout pipelines stop at §3 until `tld-story-review` and
  `tld-spot-check` exist.
- **`tld-writeup` is a sibling ticket (DROSS-1).** The `handoff_state` signal this skill reads as the
  authoritative per-step outcome is written by `tld-writeup`; until that skill is present, outcome
  detection relies on interpreting each step's "What's next?" gate.

### Numbered shortcut recognition

When you present a "What's next?" block, the user may respond with just a number. If the next message is a
bare number matching one of the options you presented, treat it as if they typed the corresponding slash
command and invoke that skill immediately.
