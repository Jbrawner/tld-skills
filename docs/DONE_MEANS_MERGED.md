# Done Means Merged

A ticket may move to a **done-category status only after a merge into the default branch is
confirmed.** Before that it goes to the project's **pre-merge status**, or stays In Progress if the
tracker has none. No skill, script, or composed goal in this framework sets Done on a commit, on a
push, or on an opened pull request.

This document is the single source of truth for that rule: which statuses to use, how to confirm a
merge, and how to reconcile a tracker that has drifted. Skills reference it rather than restating it.

---

## Why the rule exists

The rule is written from an incident, not from principle. On one project 26 tickets read `Done`
while their code sat on branches that were never merged and for which no pull request was ever
opened. Three branches were still unmerged five weeks later, by then 235–238 commits behind the
default branch and no longer mergeable at all. Nine tickets had to be reopened and rebuilt.

The mechanism was ordinary and worth naming precisely:

- A ticket was transitioned to `Done` **six seconds** after its commit was authored. The commit was
  real; nothing had asked for a merge.
- The runner that set it had `git push` and `gh` denied by design, so it *could not* have checked
  whether anything merged. It reported a status it had no way to verify.
- The only reminder that a branch still owed a PR was a `PR_DRAFT.md` file written into a
  gitignored directory — invisible from the tracker, from the forge, and from every other worktree.
- A later triage closed the parent Stories on the grounds that "all children are Done," which
  laundered the whole thing into a clean-looking board.

Every step read as success. The tracker was the only place the truth could have shown up, and the
tracker had been told the work was finished.

**The failure the rule prevents is overstatement.** The rule creates an opposite, deliberately
tolerated failure: a merged ticket that still reads pre-merge because nobody ran reconciliation.
That one understates progress, is visible on `/tld-dashboard`, and is fixed by a status change. It
is the safe direction, and the framework accepts it on purpose.

---

## Where Done may be set

Four places, and in each one a merge has already been confirmed:

| Path | Where Done is set | What confirms the merge |
|---|---|---|
| `/tld-autoland` | § 1.8, after its own squash-merge | A `gh pr view` re-read returns state `MERGED`. An unconfirmed merge parks the ticket instead. |
| Every human-landed path | `/tld-gate` step 8, on the rows step 4.5 confirmed (reported read-only by `/tld-dashboard`) | The merge-confirmation tests below |
| The composed `/tld-goal-handoff` goal | The Story mark, after `gh pr merge --squash` | A `gh pr view` re-read returns state `MERGED`; the Sub-tasks and then the Story are closed out |
| `scripts/tld-loop.sh --merge` | The wrapper's landing phase, after its own squash-merge | A `gh pr view` re-read returns state `MERGED`; red, ceiling-hit, and unconfirmable all refuse the merge and mark nothing. The flag is per-run permission, and the inner Claude runs stay hard-denied `git push`/`gh` on every path. |

Everything else — `/tld-commit`, `/tld-next`, `/tld-run-test`, `/tld-partial-auto`, `/tld-pr`,
`/tld-side-quest`, `/npc-full`, `/npc-partial`, and `scripts/tld-loop.sh` without `--merge` — sets the
pre-merge status or leaves the ticket In Progress. There is one narrow exception for tickets that produce no code at
all; it is defined below and is claimed by outcome, never by label.

`/tld-gate`'s hierarchy rollup (Story → Epic) is unaffected in principle: it fires only when every
child is already in the `done` category, and under this rule that now means every child is merged.
It gains one guard, in § Rollup under this rule, for the case where children are merely
work-complete.

---

## The pre-merge status

### Resolving it

Resolve once per run, in this order. Never hardcode a status name.

1. **Campaign file.** If `.tld/campaign.md` has an `## Allowed statuses` section, the candidate set
   is that list. Otherwise the candidate set is whatever the tracker reports.
2. **Ask the tracker** for the ticket's reachable statuses — `list_issue_statuses` on Linear,
   `getTransitionsForJiraIssue` on the ticket key for Jira (status changes there are workflow
   transitions, not field writes; see [JIRA.md](JIRA.md) § Statuses).
3. **Match by name**, case-insensitively, against: `In PR`, `In Review`, `In Merge`, `Code Review`,
   `Review`, `Ready to Merge`, `Awaiting Merge`, `Pending Merge`. First match wins.
4. **Reject any candidate in the done category** even if the name matches — a project that named a
   done-category status "In Review" must not satisfy this lookup. Category beats name, always.
5. **No match → do not transition.** The ticket stays In Progress. Say so in the output. Never fall
   back to Done, and never invent a status.

The framework's own default `Allowed statuses` list (`In Progress`, `In PR`, `In Release`, `Done` —
see [CAMPAIGN_SCHEMA.md](CAMPAIGN_SCHEMA.md)) already carries `In PR` in this role.

### When to set it

| Moment | Status |
|---|---|
| Commit landed, more work remains on the ticket | In Progress (unchanged) |
| Commit landed, the ticket's work is finished | Pre-merge status |
| Branch pushed and a PR is open | Pre-merge status |
| PR merged into the default branch, **confirmed** | Done |
| PR closed without merging | Back to In Progress or Todo, per the skill |

The pre-merge status means **work complete, awaiting merge.** It does not assert that a PR is open —
a project whose status is literally named `In PR` is naming the common case, not stating a
precondition. What it does assert is the part that matters: this ticket is out of the working set,
and its code is not yet on the default branch.

Moving a finished ticket out of In Progress is also what keeps the *next* ticket resolvable. Several
skills find the current ticket by asking the tracker for "In Progress and assigned to me"; a finished
ticket left In Progress makes that lookup ambiguous and stalls the pipeline. A local commit is still
not a ship, though — the pre-merge status is as far as any pre-merge skill may go.

### The one exception: tickets with no code

A ticket that produces **no code changes at all** has nothing to merge, so there is nothing for the
rule to protect. Manual-QA walkthroughs, verification tickets, and decision records may be marked
Done on approval, by whichever skill runs their gate.

The exception is narrow on purpose, and it is claimed by *outcome*, never by label:

- The realized diff for the ticket must be empty. A ticket that was *classified* manual-QA but ended
  up touching a file is a code ticket, and takes the pre-merge path like any other.
- A changelog-only or docs-only change is still a change. It has to reach the default branch to be
  worth anything, so it follows the normal rule.

When a skill takes this exception, it says so in its output: "no code changes — marked Done
directly." A Done with no explanation is what the rule is trying to make impossible.

### Two questions, two tests

Splitting Done from "the work is finished" splits a question the skills used to ask once. Keep them
apart by name:

| Question | Term | Statuses that satisfy it | Who asks |
|---|---|---|---|
| "Is there anything left to build here?" | **work-complete** | done-category, cancel, **or** the pre-merge status | Order walks, "what's next" lookups, `/tld-gate`'s milestone-completion check |
| "Is this actually on the default branch?" | **done-category** | done-category only, cancel excluded | Reconciliation, hierarchy rollup, release claims |

A ticket in the pre-merge status is work-complete and not done. Every "skip Done/Canceled" walk in
the framework means "skip work-complete" and must also skip the pre-merge status, or the pipeline
will hand the same finished ticket back to the next `/tld-setup`.

---

## Confirming a merge

**Never decide this by grepping the default branch's commit messages for a ticket key.** Key-grep is
unsound in both directions, and both directions were observed during the same incident:

- **False negative.** A squash merge collapses every commit into one message, so individual ticket
  keys vanish from the default branch's history while the code is fully present. One PR
  squash-merged 76 ticket keys under a title naming none of them, and a sweep read that silence as
  30 stranded tickets. Repos that squash-merge exclusively are the normal case, not an edge case.
- **False positive.** A key matches prose and substrings. One ticket "passed" because a *different*
  ticket's changelog narrated it ("the problem LAB-889 had just removed"). Another passed on the
  substring inside `XLAB-887-${Date.now()}` in a test file.

Use the tests below instead, cheapest first. Stop at the first one that returns a definite answer.

### Test 0 — the pull request, if there is one

A merged PR is the strongest evidence available, and it survives squash merges:

```bash
gh pr list --head "$BRANCH" --state all --json number,state,mergeCommit,headRefName
```

`state: MERGED` on a PR whose `headRefName` is the ticket's own branch → **MERGED.** An empty result
is not a verdict on its own — it means no PR was ever opened for that branch, which is exactly the
incident's shape, so fall through to Test 1 rather than concluding anything.

Searching PRs by ticket key (`gh pr list --search "$KEY"`) may be used to *find* a candidate PR, but
never to conclude on its own: a key can appear in an unrelated PR's body. Treat a search hit as a
pointer to a branch, then confirm that branch with the tests below.

### Test 1 — ancestry

Exact, cheap, and correct for merge commits and fast-forwards:

```bash
git merge-base --is-ancestor "origin/$BRANCH" "origin/$DEFAULT" && echo MERGED || echo NOT-MERGED
```

`MERGED` here is definitive. `NOT-MERGED` is **not** definitive: a squash merge leaves the branch tip
off the default branch even though every line landed. Fall through to Test 2.

### Test 2 — file presence

For a squashed branch, or one deleted from the remote, compare what the branch *changed* against the
default branch. Content, never messages:

```bash
BASE=$(git merge-base "origin/$BRANCH" "origin/$DEFAULT")
git diff --name-status "$BASE" "origin/$BRANCH"
```

Then, per entry:

| Entry | Test | Reading |
|---|---|---|
| `A path` (added) | `git cat-file -e "origin/$DEFAULT:path"` | Present → landed. Absent → check for a rename before concluding. |
| `M path` (modified) | `git rev-parse "origin/$BRANCH:path"` vs `origin/$DEFAULT:path` | Same blob → landed. Different → **ambiguous**, the default branch may have moved on. |
| `D path` (deleted) | `git cat-file -e "origin/$DEFAULT:path"` | Absent → consistent with merged. Present → weak evidence against. |

**Check renames before calling a file absent.** In the same incident four files looked missing from
the default branch and had simply been renamed on the way in. An exact content match anywhere in the
default tree settles it:

```bash
BLOB=$(git rev-parse "origin/$BRANCH:path")
git ls-tree -r "origin/$DEFAULT" | grep -q "$BLOB" && echo "landed (renamed)" || echo absent
```

**Verdict rule,** applied in this order:

1. Any added file absent by path **and** absent as a blob anywhere in the default tree → **NOT
   MERGED.** This is the strongest negative available and it settles the question on its own.
2. Otherwise, if the branch adds at least one file and every added file is present (by path or by
   identical blob) → **MERGED.**
3. The branch adds nothing, only modifies: every modified path's blob matches the default branch →
   **MERGED.** Any of them differs → **UNKNOWN.**

A file being absent is strong evidence only for a file the branch **adds**. For a modified file,
"content differs" proves nothing, because the default branch has its own history — which is why a
differing modification yields UNKNOWN rather than NOT MERGED.

### UNKNOWN is not MERGED

If no test returns a definite answer — no PR, no branch left to test, no file list on the ticket —
the verdict is **UNRESOLVED**, it is reported to a human, and the ticket is not marked Done. This
mirrors `/tld-autoland`'s rule that "I could not tell" is treated identically to "it failed." A
status the framework cannot verify is a status the framework does not write.

### Finding what to test

Resolve a ticket's branch or files in this order, and record which source answered:

1. A PR whose head branch names the ticket (Test 0).
2. A remote branch matching the ticket key: `git ls-remote --heads origin | grep -i "$KEY"`.
3. The ticket's own record — `/tld-autoland` merge receipts and `/tld-writeup` completion comments
   name the commit and branch.
4. The ticket's **Files to Create/Modify** list, tested for presence on the default branch (Test 2's
   added-file rule, applied to the listed paths).
5. Nothing resolves → **UNRESOLVED.** Report it; do not guess.

---

## Reconciliation

The check that answers *"which tickets read Done but have no code on the default branch?"* It runs
in two places: `/tld-dashboard` reports it (read-only), and `/tld-gate` acts on it at the milestone
boundary.

Scope it to the milestone's tickets, or to the project when run standalone. **Run `git fetch origin`
once first** — every test below compares against `origin/{default}`, and a stale remote ref reports
merged work as unmerged, which is the one false alarm guaranteed to get the whole check ignored.

For each ticket:

| Tracker status | Merge verdict | Row | What it means |
|---|---|---|---|
| Done | MERGED | ✅ consistent | Nothing to do |
| Done | NOT MERGED | 🚨 **FALSE DONE** | The incident's shape. Loudest row in the report. |
| Done | UNKNOWN / UNRESOLVED | ⚠️ unverified | A human must look |
| Pre-merge | MERGED | 📥 **ready to close** | The safe drift. Mark Done. |
| Pre-merge | NOT MERGED | ⏳ in flight | Normal, PR still open |
| Pre-merge | UNKNOWN / UNRESOLVED | ⏳ in flight | Same handling — an unverifiable pre-merge ticket is not a defect, it is just not closeable yet |
| In Progress / Todo | anything | — | Out of scope |

**`/tld-dashboard`** prints the table and the exact command to fix each row. It writes nothing —
that is its contract.

**`/tld-gate`** applies it at the milestone boundary:

- Any **FALSE DONE** row in the gated milestone → the gate **FAILs**, regardless of test results.
  Name the ticket, its branch, and whether a PR ever existed. This direction is always a real
  defect, whether the gate is running before or after the milestone's PR.
- **Ready-to-close** rows are transitioned to Done as part of the gate's write step — the merge is
  confirmed, so the rule is satisfied.
- **Unverified** rows are reported and block the hierarchy rollup, but do not by themselves FAIL a
  gate whose tests are green.

### Rollup under this rule

`/tld-gate` runs at the milestone boundary, which on the human-landed path is *before* the
milestone's PR is merged. Its completion check therefore accepts a ticket that is resolved **or** in
the pre-merge status as work-complete, so the gate does not deadlock against its own rule.

The Story → Epic rollup keeps the stricter test: it fires only when every child is genuinely in the
`done` category. If a milestone passes with children still pre-merge, the gate **defers the rollup**
and says so, naming the command to finish the job once the PR lands. A deferred rollup is a normal
outcome, not a failure.

---

## Tracker query traps

**`acli` truncates silently.** `acli jira workitem search` caps at roughly 30 rows with no truncation
marker, so a reconciliation sweep that counts tickets will quietly report the cap as the total. The
incident's headline figure of "30 stranded tickets" was that cap, not a count. Always pass
`--paginate` on any search whose result feeds a count or a completeness claim.

**A count you did not paginate is not a count.** If a query cannot be paginated, report the number as
a floor ("at least N") rather than a total.
