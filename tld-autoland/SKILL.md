---
name: tld-autoland
description: |
  Autoland — take one small bug-fix ticket, or a chunk of them, all the way to MERGED on the default
  branch with no stops: eligibility check → fresh branch → /tld-full-auto → commit → push → open PR →
  watch CI → squash-merge → delete branch → back to main → next ticket. Use this skill whenever the
  user says "tld-autoland", "autoland", "auto land", "land it all the way", "merge it for me", "I
  don't want to deal with the PR", or hands over a batch of small fixes to be shipped end-to-end.
  Optional argument: one or more ticket IDs (`/tld-autoland AS-31 AS-32 AS-33`), a Story / milestone
  key that expands to its child tickets in order (`/tld-autoland AS-30`), or nothing (the next
  eligible Todo ticket). One PR per ticket — each ticket gets its own branch cut from the latest
  default branch, its own PR, and its own merge, so one bad fix never blocks the rest. This is the
  ONLY TLD skill that merges. It is gated hard: a ticket must carry the `auto-land` label, and any
  ticket or diff that touches migrations, schema, auth, RLS, secrets, seed data, billing, or CI
  workflow files is refused outright and handed back to the gated flow. Merges only after the PR's
  CI checks go green — never on red, never with --force, never on the default branch directly. Not
  for feature work, not for anything you would want to eyeball before it hits main — use
  /tld-full-auto + /tld-pr for those.
---

# TLD Autoland

Ship small bug fixes all the way into the default branch, unattended. Autoland is the one place in the TLD family where a merge happens without a human at the keyboard — every other skill deliberately stops at an open PR.

The whole point: you hand it a bug (or a stack of them), and the next thing you hear is what merged and what didn't. No commit gate, no PR gate, no merge gate.

The contract, in one line: **only clearly-small, explicitly-labeled, low-risk tickets get in; each one gets its own branch and PR; nothing merges until CI is green; anything that surprises the flow is parked with the work preserved and the run keeps going.**

## Authorization — read this once

Your standing rules say Claude never commits, pushes, opens a PR, or merges unless you explicitly ask. **Typing `/tld-autoland` IS that explicit ask**, for the tickets in that one invocation only. The skill commits, pushes, opens PRs, and merges into the default branch as its normal operation, and it does not stop to re-confirm any of them.

That authorization does not travel. It covers the tickets named in the invocation and nothing else — not the next ticket, not the next session, not any other branch.

## When to use this

- A small bug fix: a wrong comparison, an off-by-one, a bad default, a missing null guard, a typo'd string, a stale doc line
- A batch of such fixes you want cleared out without babysitting each PR
- Work where you genuinely do not need to look at the diff before it hits the default branch

Trigger phrases: `tld-autoland`, `autoland`, "land it all the way", "merge it for me", "I don't want to deal with the PR", "clear these bugs".

**Use `/tld-full-auto` + `/tld-pr` instead** for anything you'd want to see before it merges — that pair stops at a verified checkpoint and then at an open PR. **Use `/tld-partial-auto`** when you want the test-spec review gate. **Use `/npc-full`** for content/doc tickets in a `skip`-command campaign (autoland refuses those: with no test signal there is nothing to gate the merge on).

## Inputs

What the user provides (all optional):
- **Nothing** — autoland resolves the next Todo ticket in milestone order and runs it, provided it is eligible
- **One or more ticket IDs** — `/tld-autoland AS-31 AS-32 AS-33` (space- or comma-separated), run in the order given
- **A Story / milestone key** — `/tld-autoland AS-30` expands to that milestone's child tickets in tracker order (Linear: the `## Order` section; Jira: child sub-tasks by rank), and runs each eligible one

What you read on your own:
- `.tld/campaign.md` (project config, test commands, stack, commit format, changelog path)
- Each ticket from the tracker (labels, description, AC, Files to Create/Modify)
- Everything else comes from `/tld-full-auto`'s output and from git / `gh`

## The autoland contract

Six rules govern the entire run:

1. **The eligibility gate is absolute.** A ticket enters the flow only if it carries the `auto-land` label AND passes the risky-surface scan (§1.1). An ineligible ticket is **skipped, not run** — autoland never "decides" a ticket is small enough. There is no override argument and no approval keyword that admits an ineligible ticket; the fix is to label the ticket or run the gated flow instead.

2. **One ticket, one branch, one PR, one merge.** Every ticket is cut fresh from the latest default branch, so tickets never stack on each other and a parked ticket never blocks the next one. Autoland never reuses a branch across tickets.

3. **Nothing merges on red or on unknown.** The merge happens only after the PR's checks report success. Red checks, a check that never finishes inside the watch window, a merge conflict, or any state you cannot positively confirm → the PR stays open and the ticket is parked. "I could not tell" is treated exactly like "it failed."

4. **Failures park, they do not cascade.** When a ticket fails anywhere in the flow, autoland preserves the work (commit + push the branch), records why on the ticket, returns the ticket to Todo so exactly one ticket is In Progress at a time, restores a clean tree on the default branch, and **moves to the next ticket.** A parked ticket is reported loudly at the end. Only the abort conditions in §Abort stop the whole run.

5. **The risk gate runs twice — on the ticket text and on the real diff.** A ticket can read like a one-line fix and produce a migration. §1.1 screens the ticket before any work; §1.5 re-screens the actual diff before anything is pushed. A diff that trips the second screen still gets its PR opened — but **it is never merged**, it is handed to you, and the ticket is parked.

6. **Autoland reports what happened, not what it hoped.** Every ticket lands in the final table as merged, parked, or skipped, with the reason. A ticket whose merge could not be confirmed is reported as parked, never as merged.

## Process

### 0. Preflight — once per run, before any ticket

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

This skill's ticket and milestone operations are written using neutral adapter names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Jira** (default) — perform each operation per docs/JIRA.md (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Linear** — call the Linear MCP tools directly; they match the adapter names used in this skill. Contract: docs/ADAPTERS.md.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Jira, Linear. See LIMITATIONS.md."
  Do not invent an adapter.

**Comment operation.** Autoland posts ticket comments (park reasons in §2, merge receipts in §1.9). Resolve it explicitly: on **Linear** use the comment-create call; on **Jira** use `addCommentToJiraIssue`. Comments are best-effort — a failed post is noted in the report and never aborts a run.

**Test-command guard.** If `Test Commands.Backend` is the literal string `skip` (case-insensitive), ABORT the whole run — autoland's merge gate is "tests green," and a `skip` campaign has no test signal to gate on. Recommend `/npc-partial` or `/npc-full` and exit before touching any ticket.

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

This skill runs tests or destructive operations against the database.
Refusing to proceed against a non-local database.

Fix: Ensure the configured database URL points at local (matches Stack.Database).
```

Do not proceed. Do not run any tests. Do not run any commands. Stop completely.

Additionally (autoland-specific, because nobody is watching): if `Stack.Database` names a local instance, confirm it is reachable before starting. For local Supabase, check `supabase status`; if it is not running, run `supabase start` once and re-check. Still unreachable after that one attempt → ABORT.

#### 0.3 Landing preflight

Autoland pushes and merges, so prove the landing path works before doing any work:

1. **Clean tree.** `git status --porcelain` must be empty. Uncommitted work → ABORT: autoland cuts branches and switches between them, and it will not carry, stash, or discard your changes. Tell the user to commit or stash first.
2. **Default branch.** Resolve it: `origin/HEAD` → otherwise `main`, then `master`. Record as `{default}`. Autoland only ever reads `origin/{default}` and pushes PRs against it — it never checks out, pulls, or commits to a local `{default}`, which is what makes the whole flow safe to run from inside a git worktree.
3. **`gh` is present and authenticated.** `gh auth status`. Not installed or not authed → ABORT with the exact remediation `gh` printed.
4. **Merge permission.** Confirm the repo allows squash merges and that the current user can merge (`gh repo view --json mergeCommitAllowed,squashMergeAllowed,viewerPermission`). No squash, or permission below write → ABORT and say so; do not fall back to another merge method or to a local merge + push.
5. **Default branch is healthy.** `git fetch origin {default}` and confirm the fetch succeeded. A default branch you cannot fetch means every branch you cut is wrong.

#### 0.4 Resolve the work list

Build the ordered list of candidate tickets from the argument:

- **Ticket IDs given** → that list, in the order given.
- **A Story / milestone key given** → its child tickets in tracker order (Linear: parse the `## Order` section with the unanchored `({prefix}-\d+)` algorithm; Jira: child sub-tasks by rank ascending). Drop any that are already work-complete — Done, Canceled, or in the project's pre-merge status (docs/DONE_MEANS_MERGED.md). A pre-merge ticket has been built and is waiting on a merge somebody else owns; autoland must not rebuild it.
- **No argument** → resolve the next Todo ticket exactly as `/tld-setup`'s discovery does (walk milestones in order, first ticket that is neither work-complete — Done, Canceled, or pre-merge — nor In Progress for someone else). The list is that one ticket.

If the list is empty, stop and output: "Nothing to autoland — no candidate tickets resolved." Then end the turn.

Print the candidate list before starting so the run is legible from its first line.

### 1. Per-ticket flow

Run these steps for each candidate ticket in order. Announce which ticket is starting and its position in the run (`[2/5] AS-32`).

#### 1.1 Eligibility gate

Load the ticket. Two checks, both must pass. **A failure here is a SKIP, not a park** — no branch is cut, no work is done, and the ticket's status is left exactly as it was.

**Check A — the `auto-land` label.** The ticket's labels must include `auto-land`. Missing → SKIP with:
  "{ID} is not labeled `auto-land` — autoland only runs explicitly opted-in tickets. Label it, or run /tld-full-auto {ID} for the gated flow."

**Check B — risky-surface screen on the ticket text.** Read the ticket's description, AC, and "Files to Create/Modify." SKIP if any of these appear:

| Surface | Signals in the ticket |
|---|---|
| Database schema | `migration`, `schema`, `DDL`, `ALTER TABLE`, `CREATE TABLE`, a column/constraint/index change, files under `migrations/` or `supabase/migrations/` |
| Auth & access | `auth`, `login`, `session`, `token`, `permission`, `role`, `RLS`, `policy`, files under `auth/` or `rls/` |
| Secrets & config | `secret`, `credential`, `API key`, `.env`, files matching `.env*` or a secrets/config store |
| Seed & fixtures | `seed`, `seed data`, `fixture data`, files under `seeds/` or `fixtures/` |
| Money | `billing`, `payment`, `invoice`, `subscription`, `Stripe`, `pricing` |
| The gate itself | `.github/workflows/`, branch-protection rules, `CODEOWNERS`, `.tld/campaign.md`, or any CI config — a self-merging flow must never edit the check that authorizes its own merges |

SKIP with:
  "{ID} touches a protected surface ({which}) — autoland refuses these by design. Run /tld-full-auto {ID}, then /tld-pr."

Ambiguity counts as a hit. If you cannot tell whether a ticket touches a listed surface, SKIP it — the cost of a wrong skip is one manual run; the cost of a wrong merge is a bad change on the default branch.

#### 1.2 Cut a fresh branch

From a clean tree:
1. `git fetch origin {default}`. A failed fetch → ABORT the run; every branch you cut from a stale ref would be wrong.
2. `git checkout -b autoland/{ID}-{short-slug} origin/{default}` where `{short-slug}` is the ticket title lowercased, non-alphanumerics collapsed to `-`, truncated to ~40 characters.

**Branch from `origin/{default}`, never from a locally checked-out `{default}`.** This is deliberate and not a stylistic choice: in a git worktree the default branch is usually checked out in a *different* worktree, and `git checkout {default}` fails outright with "already checked out at ...". Cutting straight from the remote-tracking ref works identically in a plain clone and in a worktree, and it removes the local-default-has-diverged failure mode entirely — there is no local `{default}` in the loop to diverge.

Every ticket gets its own branch off the freshly-fetched remote default. Never reuse a branch, never branch off another ticket's branch.

#### 1.3 Invoke /tld-full-auto

Invoke `/tld-full-auto {ID}` via the Skill tool. Show its output. It runs setup → write-tests → build → audit → run-test and stops at a verified, uncommitted checkpoint — which is exactly the state autoland wants to land.

Do not re-implement any of it, do not skip it, do not substitute a lighter path. Autoland adds landing to full-auto; it does not replace full-auto's verification.

- **Full-auto reaches its verified checkpoint** → continue to §1.4.
- **Full-auto stops for any reason** (any of its stop conditions: audit HIGH, build failure, drift, scope creep, a manual-QA or NPC classification, tracker error) → **PARK this ticket** (§2) and move to the next candidate. Full-auto's stop reason is the park reason, verbatim.
- **Full-auto could not be invoked at all** (missing, tool error, no output) → ABORT the whole run. A broken pipeline skill is not a per-ticket problem.

#### 1.4 Confirm the checkpoint is real

Autoland merges on the strength of full-auto's verification, so confirm it rather than assume it:

- There ARE uncommitted changes (`git status --porcelain` is non-empty). An empty tree means the build was a no-op → PARK.
- Full-auto's report shows tests passing and the drift check clean. Anything less → PARK.
- Full-auto's report shows zero blocking audit findings. Recorded MEDIUM/LOW findings are fine and carry into the PR body.

#### 1.5 Risk gate on the real diff

Now screen what was actually written, not what the ticket promised. Run `git status --porcelain` and `git diff --stat`, and check every changed path and the diff content against the same table in §1.1.

- **Clean** → continue to §1.6, and this ticket is merge-eligible.
- **Trips the screen** → the ticket is **park-with-PR**: still commit, push, and open the PR (the work is good and you want it visible), but mark it **DO NOT MERGE**, skip §1.7–1.8 entirely, park the ticket per §2 with the reason "diff touches {surface} — merge is yours," and move on. Never merge a diff that trips this gate, no matter how small it is.

Also record `git diff --stat` totals (files changed, insertions, deletions) for the run report. Autoland does not enforce a size cap, but an unexpectedly large diff is the single most useful thing to see in the summary afterward.

#### 1.6 Land it: commit → push → PR

No approval gate — this is the step the invocation authorized.

1. **Changelog.** Read `Changelog path` from `.tld/campaign.md` → Stack. If non-blank, add an entry for this fix under the appropriate heading before committing. Blank → skip.
2. **Stage precisely.** `git add {specific files}` — only the files this ticket's work touched, plus the changelog. Never `git add -A` or `git add .`.
3. **Commit.** Build the subject from the campaign's Commit format `Pattern` with the ticket ID and title substituted, and append ` — TLD verified` (full-auto did verify it). Include the campaign's `Co-author` trailer if non-empty. Never `--amend`. If a pre-commit hook fails, fix the cause and make a NEW commit; never bypass the hook. If it still fails → PARK.
4. **Push.** `git push -u origin autoland/{ID}-{slug}`. Never force-push.
5. **Open the PR.** `gh pr create --base {default} --head {branch}`, title `[{ID}] — {title}`, body containing: what changed, the test results from full-auto, the diff stat, any recorded MEDIUM/LOW audit findings, a link to the ticket, and the line `Landed by /tld-autoland — TLD verified.` For a park-with-PR ticket (§1.5) prefix the title with `[DO NOT MERGE]` and say why in the body. Capture the PR URL.

**The ticket is NOT marked Done here.** It is marked Done in §1.8, only after the merge is confirmed. Ordering it that way is what keeps the tracker honest: a ticket marked Done at commit time would read as finished even when the push failed, CI went red, or the merge was blocked — three states that all end with the fix nowhere near the default branch. In autoland, Done means merged.

#### 1.7 Watch CI

Merge-eligible tickets only (skip for park-with-PR).

Run `gh pr checks {url} --watch --fail-fast`, invoked with the Bash tool's own `timeout` set to **20 minutes** (1200000 ms) — do not rely on a `timeout(1)` binary, which is not present by default on macOS. If the call is cut off by that ceiling, that is the timeout row below. Then route on what actually came back:

| Result | Action |
|---|---|
| All checks passed | Continue to §1.8 — merge |
| Any check failed | PARK. PR stays open, ticket comment carries the failing check name and its log URL |
| Still running at 20 minutes | PARK — "CI did not finish inside the watch window." PR stays open. Do NOT enable auto-merge as a consolation: an unattended merge you never report is exactly the outcome rule 6 forbids |
| **No checks configured on this repo** | Merge anyway, and say so explicitly in the report and the ticket comment: "no CI checks configured — merged on local tests only." Do not silently present this as a CI-verified merge |
| Anything else / cannot tell | PARK. Unknown is treated as failed (rule 3) |

#### 1.8 Merge

`gh pr merge {url} --squash --delete-branch`.

- **Merge succeeds** → confirm it before believing it: re-read the PR state (`gh pr view {url} --json state,mergedAt,mergeCommit`) and treat it as merged only when GitHub itself reports `MERGED`. Then, and only then:
  1. **Mark the ticket Done** in the tracker (Linear: `save_issue` state Done; Jira: `getTransitionsForJiraIssue` → `transitionJiraIssue` to a `done`-category status).
  2. Post a ticket comment with the PR URL and the merge commit SHA.
  3. Record as **merged** in the run report.
  If the merge command returns success but the state re-read does not say `MERGED`, treat it as unknown → PARK (rule 3). Do not mark the ticket Done on an unconfirmed merge.
- **Merge conflict, blocked by a required review, or any other refusal** → PARK. The PR stays open, unmerged, with the reason on the ticket. Never resolve a conflict on the default branch, never force anything, never bypass a required review.

#### 1.9 Reset for the next ticket

1. `git fetch origin {default}` so the next ticket's branch is cut from a default that already contains this merge.
2. Confirm the tree is clean (`git status --porcelain` empty). If it is not, ABORT rather than carrying stray state into the next ticket.

Stay on the current branch — there is no need to check out `{default}`, and in a worktree you often cannot. §1.2 cuts the next branch from `origin/{default}` directly, so the branch you happen to be standing on does not matter.

**At the very end of the run** (after the last candidate), try `git checkout {default}` so the repo is left somewhere sensible. If it fails because `{default}` is checked out in another worktree, that is expected and fine — stay put and say which branch the repo was left on in the run report. Never delete the local branch you are standing on, even when its remote counterpart was deleted by the merge.

### 2. Parking a ticket

When any step above says PARK, do all of this before moving on:

1. **Preserve the work.** If there are uncommitted changes, commit them to the ticket's branch with the campaign Pattern subject prefixed `wip` instead of the usual type, and push the branch. Nothing is ever discarded, reverted, or reset.
2. **Record why.** Post a comment on the ticket: the park reason (verbatim from whatever produced it), the branch name, the PR URL if one was opened, and the exact command to resume (usually `/tld-full-auto {ID}` or `/tld-pr`).
3. **Restore the invariant.** Set the ticket back to **Todo** (Linear: `save_issue` to the unstarted state; Jira: transition to a `new`-category status). Autoland keeps at most one ticket In Progress at a time — a parked ticket left In Progress makes the *next* ticket's "In Progress and assigned to me" resolution ambiguous and stops the run mid-flight. This is unconditional: a parked ticket is never Done, because §1.8 is the only place Done is set and a parked ticket never reached it.
4. **Get back to a clean base.** `git fetch origin {default}` and confirm `git status --porcelain` is empty. Do not check out `{default}` (see §1.9 — the next branch is cut from `origin/{default}` regardless of where you are standing).
5. **Continue** to the next candidate.

### 3. Run report

After the last candidate, output:

```
## 🛬 Autoland — {M} merged, {P} parked, {S} skipped

| # | Ticket | Diff | Result | Detail |
|---|---|---|---|---|
| 1 | {ID} — {title} | +{i}/-{d}, {f} files | ✅ merged | {PR URL} · {merge sha} |
| 2 | {ID} — {title} | +{i}/-{d}, {f} files | 🅿️ parked | {reason} · branch `{branch}` · {PR URL or "no PR"} |
| 3 | {ID} — {title} | — | ⏭ skipped | {not labeled auto-land / touches {surface}} |

**Default branch:** {default} — now at {sha}, {M} commit(s) added this run
**Needs you:** {one line per parked ticket with the exact resume command, or "nothing"}
```

Then present the "What's next?" block from §Output.

## Abort conditions — these stop the whole run

Everything else parks one ticket and continues. These stop everything:

| # | Trigger | Where |
|---|---|---|
| 1 | Campaign missing / invalid field / unsupported tracker / tracker unreachable | Preflight, any ticket |
| 2 | Campaign test command is `skip` — no signal to gate a merge on | Preflight |
| 3 | Non-local database, or local DB unreachable after one start attempt | Preflight |
| 4 | Working tree dirty at the start of the run | Preflight |
| 5 | `gh` missing / not authenticated / cannot merge / squash-merge disabled on the repo | Preflight |
| 6 | Cannot fetch `origin/{default}` | Preflight, §1.2, §1.9 |
| 7 | `/tld-full-auto` cannot be invoked at all (missing, tool error, no output) | §1.3 |
| 8 | Tree is not clean after a ticket completes or parks | §1.9, §2 |

On abort, output what completed, what was in flight, exactly where the worktree and branch are, and stop. Do not revert, do not clean up, do not retry.

```
## 🛑 Autoland aborted — {phase}

**Why:** {reason}
**Completed this run:** {the run-report table for tickets already finished, or "none"}
**In flight:** {ticket and its state — branch, whether pushed, whether a PR exists}
**Worktree:** {current branch, clean or dirty — left exactly as-is}
**Resume:** {the exact command}
```

**HARD STOP after an abort block.** Do not fix the cause, do not retry, do not start another ticket.

## Guardrails

- **The `auto-land` label is the only door in.** No argument, flag, or approval keyword admits an unlabeled ticket. If you find yourself wanting one, the ticket belongs in `/tld-full-auto`.
- **Never merge on red or on unknown.** Rule 3 is the whole safety model — a merge that "probably passed" is a merge that gets reverted.
- **Never touch the protected surfaces**, on either screen. Migrations, auth, RLS, secrets, seed data, billing, and CI/branch-protection config never autoland, even when the ticket says the change is one line.
- **Never force-push, never `--amend`, never `git add -A`/`.`, never commit onto the default branch**, and never bypass a pre-commit hook or a required review.
- **Never resolve a merge conflict unattended.** A conflict parks the ticket; you resolve it.
- **Never discard work.** Parking always commits and pushes first. There is no path through this skill that runs `git reset --hard`, `git checkout -- .`, `git stash drop`, or `git clean`.
- **Never run `/tld-gate`, never start work outside the candidate list.** If the last merge completes a milestone, say so in the report and recommend `/tld-gate {milestoneId}` — do not run it.
- **If the run is interrupted** mid-ticket: nothing is reverted, so the in-flight ticket's branch is wherever the last completed step left it. Run `/tld-save-point` to see where you are; do not re-run `/tld-autoland` on the same ticket blindly, since it would cut a second branch and re-run the build over a half-finished worktree.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

## Output

After the §3 run report, present:

---

**What's next?**

> **1.** Hand me the next batch — `/tld-autoland {IDs}`
>    Best for: more labeled bugs waiting; merged work is already on {default}

> **2.** /tld-full-auto {ID} — take a parked ticket through the gated flow
>    Best for: something parked and you want to drive it yourself from the verified checkpoint

> **3.** /tld-dashboard — see where the milestone stands now
>    Best for: several tickets just merged and you want the big picture

> **4.** /tld-gate {milestoneId} — run the milestone gate
>    Best for: this run finished the milestone (only offer this option when it did)

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT start another ticket, do NOT run /tld-gate, do NOT merge anything else. Wait for the user.**
