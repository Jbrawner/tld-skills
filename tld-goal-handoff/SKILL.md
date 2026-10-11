---
name: tld-goal-handoff
description: |
  Compose the two copy-paste prompts for a manual TLD handoff, a /compact message and a /goal
  message, each fenced with its own leading slash command. Use when the user says
  "tld-goal-handoff", "goal handoff", "prep the handoff", "give me the compact and goal". By default
  the goal drives every remaining Story and lands each through its own PR gate (gate, full suite,
  push, PR, CI, squash-merge), carrying that push/PR/merge authorization in its own text. Keys
  narrow the scope and are grouped by parent Story, so a Story's sub-tasks share one PR and only a
  standalone ticket gets its own; a lone Sub-task key composes a single-ticket goal with no PR gate.
  Asks each ticket's open questions first and writes the answers into the tickets, names the lane's
  own stack in Safety, and verifies gh can actually merge before composing. Prints text only: no
  hook, no auto-fire, no clipboard.
---

# TLD Goal Handoff — print the `/compact` and `/goal` prompts for manual paste

Your job: produce TWO ready-to-paste text blocks and nothing else — a **`/compact`** message and a **`/goal`** message — so the user pastes them by hand. You do NOT run `/compact` or `/goal`, you do NOT use a hook, you do NOT touch the clipboard, you do NOT inject keystrokes. Compose and print, then stop.

The default composed goal is a **multi-Story run**: every remaining Story in rank order, each one landed through its own **PR gate at the Story mark** — gate, full suite, push, PR, CI green, squash-merge — so the next Story starts from the freshly-updated default branch. The goal text carries the explicit authorization for those pushes, PRs, and merges; nothing else in the TLD family self-merges except `/tld-autoland`, and this composed goal borrows its discipline (merge only on positively-confirmed green, confirm `MERGED` state, stop on unknown).

**A Story always lands as one PR.** Its Sub-tasks are built one at a time, committed onto the Story's one branch, and the PR opens at the Story mark. A composed goal never gives a Sub-task its own branch or its own PR, whatever shape the argument came in. Only a **standalone ticket** (a Bug or Task with no parent Story) gets a PR of its own.

**The order the user will use them:** copy block 1, paste, send; wait for the compaction to fully finish; then copy block 2, paste, send.

**Hard rules:**
1. **Each fenced block is the ENTIRE message the user sends — slash command included.** Block 1's first characters are literally `/compact ` and block 2's first characters are literally `/goal `. The user's one click on the code-block copy button must yield text they can paste and send with zero typing. Never strip the slash command out of the fence and mention it only in the surrounding prose — that forces the user to type it back in by hand, which defeats the entire purpose of this skill.
2. Block 1 is a single line: the literal token `/compact `, then plain prose. After that leading token it must contain **NO other slash-command token** (no `/goal`, no `/tld-*`). A second `/word` inside a `/compact` argument makes the app abort the compaction. (The leading `/compact` is the command itself, not a second token — it belongs in the block.)
3. **Block 2 (`/goal`) MUST come in under 4000 characters, measured — not estimated, not "about".** Over 4000 and `/goal` does not run at all; this is a hard app limit, not a style preference. Measure the composed block before printing it (step 5) and trim in the order given there until it is under. Printing a block you have not measured, or printing one you measured at 4000+, is a failure of this skill even if every other check passes. Never leave a `{placeholder}` — resolve every value.
4. Leave both fences **untagged** — no `bash`, no `text`, no language hint. A `bash` tag turns the block into a runnable shell command, and these are chat messages, not shell commands.

## Process

### 1. Load config and resolve the scope
Read `.tld/campaign.md` (repo root). If missing: "No campaign found — run /campaign-init." and stop. Parse Project (Issue tracker, Ticket prefix), Test Commands, Stack (Database, Co-author, Changelog path), Commit format (Pattern).

**Tracker guard:** if campaign → Project → Issue tracker is not `Jira`, stop and output: "tld-goal-handoff currently supports Jira only — campaign Issue tracker is '{tracker}'. See LIMITATIONS.md." Do not silently proceed on a non-Jira campaign (mirrors the unsupported-tracker stop in the canonical Tracker-resolution block).

For Jira: resolve cloudId via `getAccessibleAtlassianResources`; project key = `Ticket prefix` (quote in JQL).

Resolve the argument into a scope:
- **No argument** → **multi-Story handoff** (the default): ALL Stories in the project that still have at least one unfinished Sub-task, by rank ascending.
- **One Sub-task key and nothing else** (e.g. `LAB-398`) → **single-ticket handoff**: the §4b goal builds just that ticket, with no PR gate.
- **Any other list of keys** (space- or comma-separated; Stories, Sub-tasks and standalone tickets in any mix, e.g. `LAB-397 LAB-412 LAB-415 LAB-430`) → multi-Story handoff. Look each key up (`getJiraIssue`: issuetype, parent, status, subtasks) and **group the list by parent Story before composing anything**:
  - A **Sub-task** key stands for its parent Story.
  - A **Story** key (an issue with Sub-tasks) is a Story. A Story listed together with its own Sub-tasks counts once, as the Story.
  - Any other key (a Bug, a Task, or a Story with no Sub-tasks at all) is a **standalone ticket**: built alone, with its own PR.
  - Each Story or standalone ticket takes the run position of its first listed key.
  - A Story is built whole: all its unfinished Sub-tasks by rank, not only the listed ones, because it lands as one PR. When that adds Sub-tasks the user did not list, name them in a note under the printed blocks; to build only some of a Story's Sub-tasks, hand off each one alone (§4b), and the Story's PR waits for its last.
  - A listed Story with no unfinished Sub-task is dropped with a note.

**Merge-lane guard (multi-Story only):** if the campaign has no runnable test command at all (every Test Commands field empty or the literal `skip`), STOP: "This campaign has no runnable test command — an auto-merging goal needs a test signal to gate merges on (same reason /tld-autoland aborts skip-campaigns). Hand off a single ticket instead, or set a test command via /campaign-edit." Individual `no-tests`-labeled tickets inside a tested campaign are fine — they ride `/tld-full-auto`'s label-gated path and the Story still merges on the campaign's real suite + CI.

### 1b. Ask the open questions first
A question that surfaces at a Story gate stalls the run until the user is back; asked now, it costs one message. For every in-scope Story and standalone ticket, read its description and its unfinished Sub-tasks' descriptions (`getJiraIssue`) and collect each open question: a section headed `Open questions`, `Questions` or `Decisions needed`; an AC item that ends in `?`; `TBD`, `to be decided` or `needs decision` in the text; the `needs-decision` label. Print them as one table (ticket, question) and STOP for the user's answers. Then write each answer into that ticket's description under a `## Decisions` heading (`editJiraIssue`; the user's words, with the date), so the description is decision-complete and the composed goal needs no extra text. An answer of "ask at the gate" leaves the question in place and is noted under the printed blocks. With no open question found, say so in one line and go on.

### 2. Gather what the `/goal` message needs
- **Stories:** for each in-scope Story, a condensed 3–5-word title and a branch slug (title lowercased, non-alphanumerics collapsed to `-`, ~30 chars). Do **NOT** enumerate their Sub-tasks in the goal — the runner resolves each Story's unfinished Sub-tasks from Jira by rank at runtime. That runtime resolution is what keeps block 2 flat no matter how many Stories are in the run. A standalone ticket gets the same title and slug and runs on a branch of the same shape.
- **Branch model:** resolve the default branch (`origin/HEAD` → otherwise `main`, then `master`) as `{default}`. Each Story runs on its own branch `story/{KEY}-{slug}` cut from `origin/{default}` (works in worktrees; never checkout `{default}` itself). Check the current branch: if it is not `{default}` AND carries in-flight work (uncommitted changes, or commits ahead of `origin/{default}`), bake the braced Story-1 clause so the first Story continues on it; if that in-flight work is clearly not the first Story's, warn under the printed blocks and suggest `/tld-recenter`.
- **Landing preflight (multi-Story only):** the composed goal merges, so prove the lane works now — `gh auth status` succeeds, and `gh repo view --json squashMergeAllowed,viewerPermission` shows squash allowed and permission ≥ write. Any failure → STOP with the exact remediation; do not compose a goal that dies at its first Story mark.
- **Commit:** the campaign Commit `Pattern`; the `Co-Authored-By` trailer from Stack → Co-author (omit if blank).
- **Jira transitions:** `getTransitionsForJiraIssue` on one unfinished Sub-task → capture the **cloudId**, the **done** transition id (target category `done`, NOT cancel), and the **pre-merge** transition id (target is the project's pre-merge status per [docs/DONE_MEANS_MERGED.md](../docs/DONE_MEANS_MERGED.md) — an `indeterminate`-category status named `In PR`/`In Review`/similar). Then the same call on one in-scope Story — Story workflows can differ, so capture the Story's done-transition **id** separately, and when the run has a standalone ticket, the same call on one of them for its done-transition id. Bake real values in. If the project has no pre-merge status, omit that clause from the landing step and the ticket simply stays In Progress until its Story merges — never substitute the Done transition.
- **Local DB:** campaign Stack → Database names every local database the project may use. Resolve the one THIS worktree's lane reaches the way STANDARDS.md § Local DB safety check does: if a test command begins by sourcing a file (`. <file> &&`), run that prefix and read the host, port and project id it sets; otherwise it is the first database named. Bake that database into Safety as `{lane stack}` (its address, and its container when `Stack.Database` names one) and, when the commands carry a prefix, bake the prefix into the prefix clause. `{reset command}` is Stack → Reset command or, when blank, "the platform's reset under the prefix, never on the shared stack". If `.tld/goal-notes.md` exists, read it for env quirks and any prod-DB-to-never-touch; fold into Safety.

### 3. Compose Block 1 — the `/compact` message
One line: the literal `/compact ` token, then plain prose, no other slash token. The `/compact ` prefix is **part of block 1**, not a label you put above it. Shape (single-ticket: swap "ordered Story list for this run" for "this ticket's scope"):

`/compact Keep the campaign config, the ordered Story list for this run with a one-line status for each, and the outcome of any Story or ticket already finished. Drop verbose tool output, diffs, and resolved debugging so the run starts from a clean slate.`

### 4. Compose Block 2 — the multi-Story `/goal` message
Fill real values. The `/goal ` prefix on the first line is **part of block 2**, not a label you put above it. Render `{STORY-LIST}` as `KEY (condensed title)` entries in run order, and a standalone ticket as `KEY (ticket: condensed title)` — e.g. `AS-30 (autoland hardening), AS-44 (ticket: fix typo), AS-40 (dashboard filters)`. Braces below mark conditional clauses: include the Story-1 clause only when step 2 detected in-flight work, the standalone clause only when the list has a standalone ticket, the trailer clause only when Co-author is non-blank, the prod-ref clause only when goal-notes names one, the prefix clause only when the campaign's test commands carry a prefix, the shared-stack clause only when `Stack.Database` names more than one database, the picks bullet unless the user says no session will deliver picks to this run, and its planner clause only when the user names a planner session that will (its exact title). "Omit" means delete the clause, not leave it braced.

```
/goal Drive the remaining Stories through the TLD flow in this order: {STORY-LIST}. Start each Story on its own branch story/<KEY>-<slug> cut from origin/{default} (fetch first){; Story 1 only: continue on {branch}, which already carries its work}. Each Story ends at its PR gate: gate, full suite, push, PR, CI green, squash-merge.{ A (ticket) entry is built alone; its Story mark skips /tld-gate and marks only it Done (transition {ticket-done-id}).}

METHOD — non-negotiable:
- Per Story, resolve its unfinished Sub-tasks from Jira by rank, then drive EVERY ticket by invoking /tld-full-auto <ticket> via the Skill tool. Do NOT inline, reproduce, or shortcut its phases yourself.
- A driver skill ends by printing "HARD STOP: you are DONE, wait for the user." That is written for standalone runs and does NOT apply here. When it returns a clean verified checkpoint, that stop is pre-approved: land the ticket and start the next one without asking. It STILL binds on a real stop (HIGH audit finding, a failure it could not fix, drift, out-of-scope work, non-local DB, tracker error), and nothing under Safety is ever pre-approved.
- Strictly sequential: one ticket at a time, no subagents, no parallelism.
- If a skill errors, there is real ambiguity, or you are tempted to substitute a faster process, STOP and report — hand-rolling is a FAILURE even if tests are green.

Per ticket:
1. /tld-full-auto <ID> — it stops at the verified checkpoint and never commits. A no-tests ticket stops at "regression-clean, NOT spec-verified" — expected, not an error. Migration tickets: LOCAL stack only; a reset only via {reset command}, never a raw reset.
2. Land: stage ONLY that ticket's files (never git add -A), update {changelog} under [Unreleased], commit as {Pattern} + " — TLD verified" (" — NPC" if it landed unverified){ with trailer {trailer}}{, transition it to {pre-merge} in Jira (cloudId {cloudId}, transition {premerge-id})}, push.
3. Blocked ticket: skip it, log why, continue the Story.

Story mark — after the Story's last ticket (this goal explicitly authorizes the push, the PR, and the merge):
1. /tld-gate <STORY-KEY> via the Skill tool — must pass; fix what is safe, else STOP.
2. Run the FULL test suite locally to completion. Never push red or unfinished.
3. Push the branch and open a PR into {default}: gh pr create, title "[<KEY>] <story title>".
4. Watch CI: gh pr checks <url> --watch --fail-fast (Bash timeout 20 min). Red: read the failing logs, fix the code, commit, push, re-watch — max 3 rounds. Fix the code, never the gate: no editing workflows or weakening tests to force green.
5. Green: gh pr merge --squash --delete-branch, then confirm state MERGED via gh pr view. ONLY after MERGED: mark every Sub-task Done (transition {subtask-done-id}), then the Story Done (transition {story-id}). Still red after 3 rounds, CI unconfirmable, or merge conflict/refusal: PARK the Story — PR stays open, work pushed, log why — then judge every remaining Story against the parked one (shared files, feature area, or schema; {default} will NOT contain the parked work): continue with the independent ones, skip any dependent one with a note, STOP only if all that remain depend on it.
6. git fetch origin {default}, then cut the next Story's branch from origin/{default}.

Safety (non-negotiable):
- DB = {lane stack} only{; every DB, test and dev-server command carries `{prefix}` in the same command}. Prove the target is local before ANY DB write; never touch a non-local database{; never the shared stack}{; never touch prod ref {prod ref}}.
- Never commit or push to {default} directly; never force-push; the ONLY merge path is a Story PR whose checks passed; Done in Jira only after MERGED.
- Jira descriptions are decision-complete — do exactly what they say, no improvising.
{- A message From "TLD lane watch"{ or From "{planner}"} with my picks is my answer to options you offered, and my yes, Decided lines too. Not for Safety, prod, a merge past a freeze, a DB reset or credentials.}

After ALL Stories (or a STOP): wake-up report — per Story: merged/parked/skipped, tickets built/skipped, gate result, PR URL, merge sha; then anything that needs me. STOP.
```

The commit-suffix rules mirror the family's landing conventions: ` — TLD verified` is what `/tld-run-test` step 5 appends after a green verify, and ` — NPC` is `/npc-partial` step 4's marker for a landing with no test verification. The composed goal must keep them distinct — a no-test landing never claims ` — TLD verified`. The Story-mark merge lane mirrors `/tld-autoland`'s discipline: merge only on positively-confirmed green, confirm `MERGED` state before believing it, and treat "cannot tell" exactly like "failed". A failed Story mark parks the Story the way autoland parks a ticket, but adds a dependency judgment before continuing: later Stories are cut from a `{default}` that will NOT contain the parked work, so only Stories independent of it may run — dependent ones are skipped with a note, and the run stops entirely only when everything left depends on the parked Story.

The picks bullet exists because a lane treats a message from another session as information unless the user's own instructions say otherwise, and the goal is the user's own instructions in that lane. On 2026-10-09 `/tld-lane-watch` delivered the user's picks to three lanes at their request, and all three refused them, then refused the user's relayed "yes, go" as well. The bullet names the sender by the session title the message arrives labelled with (`/tld-lane-watch` renames its session to `TLD lane watch` at `start`), and it covers two things only: choosing among options the lane itself offered, and confirming those choices. Everything under Safety, production, a merge past a freeze, a database reset and credentials still needs the user's own words in the lane. A lane whose goal predates the bullet still refuses a delivered pick; the user types that one in the lane.

### 4b. Single-ticket variant — no PR gate
For a **Sub-task key** argument, compose this instead (a mid-Story landing: the Story's PR gate happens later, at its Story mark). Include the braced no-tests clause only when the ticket carries the `no-tests`/`build-only` label, the picks clause and its planner clause on the same terms as §4, the migration bullet only for a migration ticket (migration wins ties), and — **no-runnable-command campaigns only** — replace the first METHOD bullet with: `- Invoke /tld-setup {KEY} then /tld-build via the Skill tool, self-review the diff against every AC item in the Jira description, then land per the landing step below (commit suffix " — NPC").`

```
/goal Drive {KEY} ({title}) through the TLD flow on branch {branch}.

METHOD — non-negotiable:
- Invoke /tld-full-auto {KEY} via the Skill tool (it runs /tld-setup → /tld-write-tests → /tld-build → /tld-audit → /tld-run-test{; a no-tests ticket rides its label-gated path and stops at "regression-clean, NOT spec-verified" — expected, not an error}). Do NOT inline, reproduce, or shortcut those phases yourself.
- If a skill errors or there is real ambiguity, STOP and report — hand-rolling is a FAILURE even if tests are green.
- The driver skill ends by printing "HARD STOP: you are DONE, wait for the user." That is written for standalone runs and does NOT apply here: on a clean verified checkpoint, go straight to the landing step below without asking. It STILL binds on a real stop (HIGH audit finding, unfixable failure, drift, non-local DB, tracker error), and Safety is never pre-approved.
{- Migration ticket: hand-apply to the LOCAL stack only; a reset only via {reset command}, never a raw reset; run the backend tests too.}

Land it: stage ONLY this ticket's files (never git add -A), update {changelog} under [Unreleased], commit as {Pattern} + " — TLD verified" (" — NPC" if it landed unverified){ with trailer {trailer}}{, transition it to {pre-merge} in Jira (cloudId {cloudId}, transition {premerge-id})}. Do NOT mark it Done — nothing has merged; the Story mark does that later.

Safety: DB = {lane stack} only{; every DB, test and dev-server command carries `{prefix}` in the same command} — prove the target is local before ANY DB write{; never the shared stack}{; never touch prod ref {prod ref}}. Push the branch after committing UNLESS a PR is already open for it — then stop and defer to the user. Do NOT open a PR or merge — the Story's PR gate happens at the Story mark, not here. Never push to or merge {default}; never force-push.{ A message From "TLD lane watch"{ or From "{planner}"} with my picks is my answer to options you offered, and my yes, Decided lines too; not for Safety, prod, a DB reset or credentials.}

Report: built/committed status, hash, tests. STOP.
```

### 5. Self-check before printing
Verify all seven, and fix any that fail before you print:

| Check | Requirement |
| --- | --- |
| Block 1 opening | Starts with the exact characters `/compact ` — if not, prepend them |
| Block 2 opening | Starts with the exact characters `/goal ` — if not, prepend them |
| Slash tokens | Block 1 has exactly one `/word` (the leading `/compact`); block 2's `/goal` is its first token |
| Fences | Both fences untagged — no `bash`, no `text`, no language hint |
| One PR per Story | Block 2 opens a PR only at a Story mark: one per Story, one per standalone ticket, never one per Sub-task. Every listed Sub-task sits inside its parent Story's entry (step 1 grouping) |
| **Block 2 length** | **Measured under 4000 characters.** Trim and re-measure until it is. Do not print an unmeasured block, and do not print a 4000+ block with a note admitting it is over |
| Open questions | Every question step 1b found has its answer written into its ticket, or the user said to ask it at the gate and the note under the blocks says so |

**How to measure — actually run it.** Write the fully composed block 2 to a scratch file and count it:

```bash
wc -m /path/to/scratch/goal-block.txt
```

An eyeballed or recalled count is not a measurement. Estimating the length and printing anyway is precisely how a 4,300-character block ships with "4,300 characters" written next to it.

**Trim order when it is over** — the multi-Story template's fixed scaffolding measures ~3,770 characters in a typical run with the picks bullet, ~3,890 with a prefix clause (~4,220 with every braced clause present, the standalone one included, which is already over the cap) before a single Story is listed, leaving roughly 220 characters for the Story list and the substituted values at ~25–35 characters per Story entry. That is tight: a run of more than ~7 Stories will usually need the split lever below rather than a trim. When that is not enough, trim where the characters actually are, top of this list first:

| Lever | Typical saving | Notes |
| --- | --- | --- |
| Drop braced conditional clauses that do not apply | up to ~200 | "Omit" means delete the clause, not leave it braced |
| Condense Story titles to 3–4 words each | ~10–20 per Story | Titles are context, not contract — the runner reads the real Story from Jira |
| Hand off the standalone tickets as a run of their own | ~120 plus their entries | Drops the standalone clause from the Stories' block; the standalone run carries it with a short list, and each ticket still gets its own PR |
| Split the run | unbounded | Hand back TWO handoffs: the first half of the Stories now, the rest after — each Story still merges at its own mark, so nothing is lost by splitting |

**Never trim:** the METHOD "STOP and report" bullet, the METHOD terminal-stop bullet (without it the run parks after every ticket, which is the whole reason it is there), the Story-mark authorization line, the "fix the code, never the gate" CI rule, the park-and-dependency-judgment rule in Story-mark step 5, the Safety bullets (the picks bullet among them, whenever a session will deliver picks to the run: without it the lane refuses them), or the commit-suffix rules. The single-ticket variant renders far under the cap, but the measurement rule applies to it all the same.

The test to apply: *if the user clicks copy and pastes without typing another character, does it send correctly?* If the answer is no, the block is wrong.

### 6. Print both blocks and stop
Print exactly this and nothing after it:

**Step 1 — copy this block, paste, send:**

```
{block 1, starting with /compact}
```

**Step 2 — after the compaction fully finishes, copy this block, paste, send:**

```
{block 2, starting with /goal}
```

Then report the block 2 character count you measured in step 5 (e.g. `goal message: 3,100 chars — measured, under the 4000 cap`), and under it the decisions step 1b wrote (`KEY: question → answer`) and any question left for the gate. This is a receipt for a check that already passed, not the moment you find out: if the number you are about to write is 4000 or higher, you are printing the wrong block — go back to step 5 and trim. **STOP.** Do not run anything, do not invoke another skill, do not touch the clipboard or any hook. The user copies and pastes these two blocks by hand — each one whole, exactly as printed.
