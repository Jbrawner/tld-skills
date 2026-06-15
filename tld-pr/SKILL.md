---
name: tld-pr
description: |
  Land the current TLD ticket — commit the verified work, mark the ticket Done, push the branch, and
  open a pull request, then STOP before merge so you stay in control of the merge. Use this skill
  whenever the user says "tld-pr", "make a PR", "open a PR", "land it", "land the ticket", "push and
  PR", or wants to ship a ticket that has already passed verification (typically right after
  /tld-full-auto stops at its verified checkpoint, or after /tld-partial-auto / /tld-run-test have
  committed). This is the TLD family's landing step: TLD keeps the human in control of the outward git
  actions, and tld-pr is the one place they happen. It re-runs the tests to confirm nothing broke,
  shows exactly what it will commit/push/PR, HARD STOPS for your approval, then commits (if not
  already committed), marks the ticket Done, pushes, and opens the PR. It NEVER merges — that stays
  yours. Refuses to run on the default branch (push to a feature branch only) and never force-pushes.
---

# TLD PR

Land a verified ticket: commit → mark Done → push → open a pull request, and **stop before merge.** This is the TLD family's deliberate "you own the landing" step — `/tld-full-auto` leaves a verified, uncommitted checkpoint, and `tld-pr` is how you ship it once your manual check passes. It also works after `/tld-partial-auto`, `/tld-run-test`, or `/tld-commit` have already committed (it will skip the commit and just push + open the PR).

**Nothing pushes or opens a PR without your explicit approval at the gate. Merging is never automated.**

## When to use this

- Right after `/tld-full-auto` stops at its verified checkpoint and your manual check passed
- After `/tld-partial-auto`, `/tld-run-test`, or `/tld-commit` committed locally and you now want a PR
- Any time the current ticket's work is verified and you want it committed (if needed), pushed, and PR'd

Trigger phrases: `tld-pr`, "make a PR", "open a PR", "land it", "land the ticket", "push and PR".

**Use `/tld-commit` instead** if you only want a local commit and no push/PR. **Use `/tld-next` instead** if the work is already committed *and* pushed and you just want to mark Done and move on without a PR.

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

### 2. Resolve current ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 3. Branch safety

Determine the current branch (`git rev-parse --abbrev-ref HEAD`) and the repo's default branch (`origin/HEAD` → otherwise `main`, then `master`).

**If the current branch IS the default branch, STOP:**
  "On the default branch ({branch}) — refusing to commit/push a ticket here. Cut a feature branch first (e.g. /tld-recenter), then re-run /tld-pr."
Never commit ticket work directly onto the default branch, and never push to it from this skill.

### 4. Identify what's already done

- `git status --porcelain` and `git diff --name-only` — see what is uncommitted.
- `git log origin/{default}..HEAD --oneline` (or compare against the upstream) — see whether this ticket is already committed.
- Record any pre-existing dirty paths that are NOT part of this ticket's "Files to Create/Modify" (and the configured `Changelog path`). These must never be staged. If a pre-existing dirty path overlaps the ticket's file scope so you cannot tell prior edits from this ticket's work, STOP and ask the user to resolve it.

Two cases:
- **Uncommitted ticket work present** → you will commit it in step 8 after approval.
- **Already committed (clean tree, commits ahead of upstream)** → skip the commit; you will only push + open the PR.

If there is neither uncommitted ticket work nor any unpushed commit, STOP: "Nothing to land — no uncommitted changes and nothing ahead of {default}."

### 5. Local DB safety check

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

This skill runs tests or destructive operations against the database.
Refusing to proceed against a non-local database.

Fix: Ensure the configured database URL points at local (matches Stack.Database).
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

### 6. Re-run tests

The work is supposed to be verified, but the tree may have changed since. Re-run tests to confirm green before landing.

**Resolve the test command:**

Determine the affected directory scope:
1. Collect the union of:
   a. Files listed in the ticket's "Files to Create/Modify" section.
   b. Uncommitted paths from `git diff --name-only` and `git diff --name-only --cached`, plus files in this ticket's unpushed commits.
2. Classify the scope against campaign Stack paths:
   - All affected paths under `Stack.Backend directory` → backend-only.
   - All affected paths under `Stack.Frontend directory` → frontend-only.
   - All affected paths under `Stack.Landing directory` → landing-only.
   - Mixed, neither, or empty → both/unsure.

Pick the command from campaign Test Commands:
  - backend-only → Backend command.
  - frontend-only → Frontend command.
  - landing-only → Landing command.
  - both/unsure → Full command.

If the chosen command is empty, fall back to the Full command.
If the Full command is also empty, stop and output:
  "No test command defined in .tld/campaign.md Test Commands. Run /campaign-edit to set one."

Run the resolved command. Capture full output.

**If tests fail, STOP — do NOT commit, push, or open a PR.** Report the failures and present:

---

**What's next?**

> **1.** /tld-align — auto-fix the implementation to match tests
>    Best for: failures look like small implementation gaps

> **2.** Fix manually, then run /tld-pr again
>    Best for: complex failures you want to debug yourself

> **3.** /tld-side-quest — bail to something else and come back
>    Best for: need a detour to understand the issue

Type **1**, **2**, or **3** to proceed.

### 7. Update CHANGE_LOG.md

Read the `Changelog path` from `.tld/campaign.md`'s Stack section. If the value is blank, skip this step. Otherwise, if the changes are not already committed and the changelog was not updated, add an entry now documenting what changed and the test counts. Projects that use a CI changelog gate will fail without it. (If the work is already committed, do not amend it to add a changelog entry — note the omission for the user instead.)

### 8. Present the landing plan for approval

Show the user exactly what will happen:

```
## Ready to land: [TICKET-ID] — [title]

### Branch
[current feature branch] → PR into [default branch]

### Commit (if uncommitted)
- Files: [list each file with a one-line note on what changed]
- Message: [resolved from .tld/campaign.md Commit format Pattern, ticket ID + title substituted, ` — TLD verified` appended]
[or: "Already committed — will push existing commit(s) and open the PR only."]

### Test results
All [N] tests passing

### Pull request
- Title: [ticket ID — title]
- Base: [default branch]  ·  Head: [feature branch]
- Will NOT merge — stops after opening the PR
```

Then present:

---

**What's next?**

> **1.** Approve — commit (if needed), push, and open the PR
>    Best for: manual check passed, ready to land (no merge)

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish to do before landing

> **3.** Describe what looks wrong — I'll help fix it
>    Best for: spotted something that needs correction

Type **1**, **2**, or **3** to proceed.

### >>> MANDATORY APPROVAL GATE — STOP HERE <<<

**HARD STOP.** Do NOT commit, push, or open a PR until the user explicitly approves. Wait for one of:
- Any canonical approval keyword: "approve", "commit", "lgtm", "looks good", "ship it", "go", "proceed", or "1" (see STANDARDS.md § Approval keyword set) → proceed to step 9
- User describes a problem → suggest `/tld-align` or a manual fix, then re-run `/tld-pr`
- "2" or "side quest" → invoke `/tld-side-quest`, come back later with `/tld-pr`

**Do NOT interpret silence, partial responses, or questions as approval.**

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Land it

Only after explicit user approval, in this order:

1. **Commit (only if there is uncommitted ticket work):** stage just this ticket's files (`git add [specific files]` — only files related to this ticket, plus the changelog from step 7 if updated; never `git add -A`/`.`, never stage a pre-existing dirty path recorded in step 4). Commit using the `Pattern` from `.tld/campaign.md`'s Commit format section, ticket ID + title substituted, ` — TLD verified` appended. Include the campaign's `Co-author` trailer if non-empty; omit it if blank. Never `--amend`. If a pre-commit hook fails, fix the cause and make a NEW commit; do not bypass the hook.
2. **Verify the commit succeeded** (or that the tree was already committed).
3. **Mark the ticket Done** in the tracker via `save_issue` (set state to "Done").
4. **Push the feature branch** to its remote (`git push -u origin {branch}`). Never force-push.
5. **Open the PR** with `gh pr create --base {default} --head {branch}`, title `[TICKET-ID] — [title]`, and a body that summarizes what changed, lists the test results, links the ticket, and notes "TLD verified." Capture the PR URL.

**Do NOT merge the PR.** Merging stays with the user — this skill always stops at an open PR.

### 10. Determine what's next

Runtime state lives in the tracker. From the current ticket's milestone:
1. Read the milestone's ordered ticket list (Linear: the `## Order` section of the milestone description, parsed with the unanchored `({prefix}-\d+)` algorithm; Jira: the milestone Story's child tickets by rank).
2. Walk the Order from the current ticket forward and look up each subsequent ticket's status. **Pick the first ticket whose status is `Todo`** (skip Done / Canceled / In Progress).

- **Next Todo ticket found** → next action is `/tld-setup {next-id}`.
- **No next Todo in this milestone's Order** (every subsequent entry is Done, Canceled, or In Progress) → next action is `/tld-gate {milestoneId}` — substitute the milestone's actual `id`; never emit the literal `{milestoneId}`. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly.
- **Order section malformed or missing** → note it (the work is already landed): "Landed {ticket} and opened the PR, but could not resolve the next ticket — the milestone Order section is malformed. Run /milestone-sync to repair it." Do not invoke `/milestone-sync` yourself.

### 11. Output

```
## 🚀 Landed — [TICKET-ID] — [title]

- **Commit:** [short-sha] [or "already committed"]
- **Pushed:** [feature branch] → origin
- **PR:** [PR URL]  (open — not merged)
- **Tracker:** marked Done
- **Next:** /tld-setup [next-id]   (or /tld-gate [milestoneId] if the milestone just completed)

Review and merge the PR yourself when ready. Run `/clear` then the command above to start the next ticket.
```

**Never emit the literal text `{milestoneId}` or `{next-id}`** — substitute actual values before rendering.

---

**What's next?**

> **1.** Start the next ticket with clean context (Recommended)
>    Best for: PR is open, ready to move on — `/clear`, then run `/tld-setup {next-id}` (or `/tld-gate {milestoneId}` if the milestone just completed)

> **2.** /tld-dashboard — review milestone progress first
>    Best for: want the big picture before continuing

> **3.** Stay here to review/merge the PR
>    Best for: you want to look at the PR before doing anything else

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT merge the PR, do NOT invoke /tld-setup or any other skill. Wait for the user.**

## Guardrails

- **Never merge.** This skill always stops at an open PR; merging is the user's call.
- **Never push to the default branch**, and never force-push. Refuse on the default branch (step 3).
- **Stage only this ticket's files** (+ the changelog). Never `git add -A`/`.`; never stage a pre-existing dirty path recorded in step 4.
- **Never `--amend`.** A pre-commit hook failure becomes a new commit, not a bypass.
- **No commit, push, or PR without explicit approval** at the step-8 gate.
