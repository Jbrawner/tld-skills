---
name: tld-goal-handoff
description: |
  Generate the two copy-paste prompts for a manual TLD build handoff: a /compact message and a /goal message. Use this skill whenever the user says "tld-goal-handoff", "goal handoff", "prep the handoff", "give me the compact and goal", "handoff prompt", or wants ready-to-paste /compact + /goal text. By DEFAULT the composed goal drives EVERY remaining Story, one at a time, and lands each one through its own PR gate at the Story mark: /tld-gate → full local suite → push → open PR → watch CI (bounded fix rounds) → squash-merge → next Story cut from the updated default branch — the goal text itself carries the explicit push/PR/merge authorization. Arguments narrow the scope: one or more Story keys (e.g. /tld-goal-handoff LAB-397 LAB-410) hand off just those Stories; a Sub-task key (e.g. /tld-goal-handoff LAB-398) composes the single-ticket goal with NO PR gate (a mid-Story landing). Reads the tracker from Jira, resolves branch policy + commit format + Jira Done transitions + local DB, verifies gh can actually merge (auth, squash allowed, write permission), then PRINTS two fenced blocks for the user to paste by hand — first /compact, then /goal after compaction finishes. Each block INCLUDES its own leading slash command, so one click on the copy button yields a message the user can paste and send without typing anything. There is NO hook, NO auto-fire, NO clipboard, and NO keystroke automation: this skill only composes and prints text.
---

# TLD Goal Handoff — print the `/compact` and `/goal` prompts for manual paste

Your job: produce TWO ready-to-paste text blocks and nothing else — a **`/compact`** message and a **`/goal`** message — so the user pastes them by hand. You do NOT run `/compact` or `/goal`, you do NOT use a hook, you do NOT touch the clipboard, you do NOT inject keystrokes. Compose and print, then stop.

The default composed goal is a **multi-Story run**: every remaining Story in rank order, each one landed through its own **PR gate at the Story mark** — gate, full suite, push, PR, CI green, squash-merge — so the next Story starts from the freshly-updated default branch. The goal text carries the explicit authorization for those pushes, PRs, and merges; nothing else in the TLD family self-merges except `/tld-autoland`, and this composed goal borrows its discipline (merge only on positively-confirmed green, confirm `MERGED` state, stop on unknown).

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
- **One or more Story keys** (space- or comma-separated, e.g. `LAB-397 LAB-410`) → multi-Story handoff over exactly those Stories, in the order given. A listed Story with no unfinished Sub-task is dropped with a note.
- **A Sub-task key** (e.g. `LAB-398`) → **single-ticket handoff**: the §4b goal builds just that ticket, with no PR gate.

**Merge-lane guard (multi-Story only):** if the campaign has no runnable test command at all (every Test Commands field empty or the literal `skip`), STOP: "This campaign has no runnable test command — an auto-merging goal needs a test signal to gate merges on (same reason /tld-autoland aborts skip-campaigns). Hand off a single ticket instead, or set a test command via /campaign-edit." Individual `no-tests`-labeled tickets inside a tested campaign are fine — they ride `/tld-full-auto`'s label-gated path and the Story still merges on the campaign's real suite + CI.

### 2. Gather what the `/goal` message needs
- **Stories:** for each in-scope Story, a condensed 3–5-word title and a branch slug (title lowercased, non-alphanumerics collapsed to `-`, ~30 chars). Do **NOT** enumerate their Sub-tasks in the goal — the runner resolves each Story's unfinished Sub-tasks from Jira by rank at runtime. That runtime resolution is what keeps block 2 flat no matter how many Stories are in the run.
- **Branch model:** resolve the default branch (`origin/HEAD` → otherwise `main`, then `master`) as `{default}`. Each Story runs on its own branch `story/{KEY}-{slug}` cut from `origin/{default}` (works in worktrees; never checkout `{default}` itself). Check the current branch: if it is not `{default}` AND carries in-flight work (uncommitted changes, or commits ahead of `origin/{default}`), bake the braced Story-1 clause so the first Story continues on it; if that in-flight work is clearly not the first Story's, warn under the printed blocks and suggest `/tld-recenter`.
- **Landing preflight (multi-Story only):** the composed goal merges, so prove the lane works now — `gh auth status` succeeds, and `gh repo view --json squashMergeAllowed,viewerPermission` shows squash allowed and permission ≥ write. Any failure → STOP with the exact remediation; do not compose a goal that dies at its first Story mark.
- **Commit:** the campaign Commit `Pattern`; the `Co-Authored-By` trailer from Stack → Co-author (omit if blank).
- **Jira Done:** `getTransitionsForJiraIssue` on one unfinished Sub-task → the transition whose target status category is `done` and is NOT cancel; capture its **id** and the **cloudId**. Then the same call on one in-scope Story — Story workflows can differ, so capture the Story's done-transition **id** separately. Bake real values in.
- **Local DB:** campaign Stack → Database. If `.tld/goal-notes.md` exists, read it for env quirks and any prod-DB-to-never-touch; fold into Safety.

### 3. Compose Block 1 — the `/compact` message
One line: the literal `/compact ` token, then plain prose, no other slash token. The `/compact ` prefix is **part of block 1**, not a label you put above it. Shape (single-ticket: swap "ordered Story list for this run" for "this ticket's scope"):

`/compact Keep the campaign config, the ordered Story list for this run with a one-line status for each, and the outcome of any Story or ticket already finished. Drop verbose tool output, diffs, and resolved debugging so the run starts from a clean slate.`

### 4. Compose Block 2 — the multi-Story `/goal` message
Fill real values. The `/goal ` prefix on the first line is **part of block 2**, not a label you put above it. Render `{STORY-LIST}` as `KEY (condensed title)` entries in run order — e.g. `AS-30 (autoland hardening), AS-40 (dashboard filters)`. Braces below mark conditional clauses: include the Story-1 clause only when step 2 detected in-flight work, the trailer clause only when Co-author is non-blank, the prod-ref clause only when goal-notes names one. "Omit" means delete the clause, not leave it braced.

```
/goal Drive the remaining Stories through the TLD flow, one at a time, in this order: {STORY-LIST}. Start each Story on its own branch story/<KEY>-<slug> cut from origin/{default} (fetch first){; Story 1 only: continue on {branch}, which already carries its work}. Each Story ends at its PR gate: gate, full suite, push, PR, CI green, squash-merge — so the next Story starts from the updated {default}.

METHOD — non-negotiable:
- Per Story, resolve its unfinished Sub-tasks from Jira by rank, then drive EVERY ticket by invoking /tld-full-auto <ticket> via the Skill tool. Do NOT inline, reproduce, or shortcut its phases yourself.
- Strictly sequential — one Story, one ticket at a time. No subagents, no parallelism.
- If a skill errors, there is real ambiguity, or you are tempted to substitute a faster process, STOP and report — hand-rolling is a FAILURE even if tests are green.

Per ticket:
1. /tld-full-auto <ID> via the Skill tool — it stops at the verified checkpoint and never commits. A no-tests ticket stops at "regression-clean, NOT spec-verified" — expected, not an error. Migration tickets: LOCAL stack only; never supabase db reset from a worktree.
2. Land: stage ONLY that ticket's files (never git add -A), update {changelog} under [Unreleased], commit as {Pattern} + " — TLD verified" (" — NPC" if it landed unverified){ with trailer {trailer}}, transition it to Done in Jira (cloudId {cloudId}, transition {subtask-id}), push.
3. Blocked ticket: skip it, log why, continue the Story.

Story mark — after the Story's last ticket (this goal explicitly authorizes the push, the PR, and the merge):
1. /tld-gate <STORY-KEY> via the Skill tool — must pass; fix what is safe, else STOP.
2. Run the FULL test suite locally to completion. Never push red or unfinished.
3. Push the branch and open a PR into {default}: gh pr create, title "[<KEY>] <story title>".
4. Watch CI: gh pr checks <url> --watch --fail-fast (Bash timeout 20 min). Red: read the failing logs, fix the code, commit, push, re-watch — max 3 rounds. Fix the code, never the gate: no editing workflows or weakening tests to force green.
5. Green: gh pr merge --squash --delete-branch, then confirm state MERGED via gh pr view. Mark the Story Done in Jira (transition {story-id}) only when every Sub-task is Done. Still red after 3 rounds, CI unconfirmable, or merge conflict/refusal: PARK the Story — PR stays open, work pushed, log why — then judge every remaining Story against the parked one (shared files, feature area, or schema; {default} will NOT contain the parked work): continue with the independent ones, skip any dependent one with a note, STOP only if all that remain depend on it.
6. git fetch origin {default}, then cut the next Story's branch from origin/{default}.

Safety (non-negotiable):
- DB = {local stack} only. Prove the target is local before ANY DB write; never touch a non-local database{; never touch prod ref {prod ref}}.
- Never commit or push to {default} directly; never force-push; the ONLY merge path is a Story PR whose checks passed.
- Jira descriptions are decision-complete — do exactly what they say, no improvising.

After ALL Stories (or a STOP): wake-up report — per Story: merged/parked/skipped, tickets built/skipped, gate result, PR URL, merge sha; then anything that needs me. STOP.
```

The commit-suffix rules mirror the family's landing conventions: ` — TLD verified` is what `/tld-run-test` step 5 appends after a green verify, and ` — NPC` is `/npc-partial` step 4's marker for a landing with no test verification. The composed goal must keep them distinct — a no-test landing never claims ` — TLD verified`. The Story-mark merge lane mirrors `/tld-autoland`'s discipline: merge only on positively-confirmed green, confirm `MERGED` state before believing it, and treat "cannot tell" exactly like "failed". A failed Story mark parks the Story the way autoland parks a ticket, but adds a dependency judgment before continuing: later Stories are cut from a `{default}` that will NOT contain the parked work, so only Stories independent of it may run — dependent ones are skipped with a note, and the run stops entirely only when everything left depends on the parked Story.

### 4b. Single-ticket variant — no PR gate
For a **Sub-task key** argument, compose this instead (a mid-Story landing: the Story's PR gate happens later, at its Story mark). Include the braced no-tests clause only when the ticket carries the `no-tests`/`build-only` label, the migration bullet only for a migration ticket (migration wins ties), and — **no-runnable-command campaigns only** — replace the first METHOD bullet with: `- Invoke /tld-setup {KEY} then /tld-build via the Skill tool, self-review the diff against every AC item in the Jira description, then land per the landing step below (commit suffix " — NPC").`

```
/goal Drive {KEY} ({title}) through the TLD flow on branch {branch}.

METHOD — non-negotiable:
- Invoke /tld-full-auto {KEY} via the Skill tool (it runs /tld-setup → /tld-write-tests → /tld-build → /tld-audit → /tld-run-test{; a no-tests ticket rides its label-gated path and stops at "regression-clean, NOT spec-verified" — expected, not an error}). Do NOT inline, reproduce, or shortcut those phases yourself.
- If a skill errors or there is real ambiguity, STOP and report — hand-rolling is a FAILURE even if tests are green.
{- Migration ticket: hand-apply to the LOCAL stack only; never supabase db reset from a worktree; run the backend tests too.}

Land it: stage ONLY this ticket's files (never git add -A), update {changelog} under [Unreleased], commit as {Pattern} + " — TLD verified" (" — NPC" if it landed unverified){ with trailer {trailer}}, transition it to Done in Jira (cloudId {cloudId}, transition {subtask-id}).

Safety: DB = {local stack} only — prove the target is local before ANY DB write{; never touch prod ref {prod ref}}. Push the branch after committing UNLESS a PR is already open for it — then stop and defer to the user. Do NOT open a PR or merge — the Story's PR gate happens at the Story mark, not here. Never push to or merge {default}; never force-push.

Report: built/committed status, hash, tests. STOP.
```

### 5. Self-check before printing
Verify all five, and fix any that fail before you print:

| Check | Requirement |
| --- | --- |
| Block 1 opening | Starts with the exact characters `/compact ` — if not, prepend them |
| Block 2 opening | Starts with the exact characters `/goal ` — if not, prepend them |
| Slash tokens | Block 1 has exactly one `/word` (the leading `/compact`); block 2's `/goal` is its first token |
| Fences | Both fences untagged — no `bash`, no `text`, no language hint |
| **Block 2 length** | **Measured under 4000 characters.** Trim and re-measure until it is. Do not print an unmeasured block, and do not print a 4000+ block with a note admitting it is over |

**How to measure — actually run it.** Write the fully composed block 2 to a scratch file and count it:

```bash
wc -m /path/to/scratch/goal-block.txt
```

An eyeballed or recalled count is not a measurement. Estimating the length and printing anyway is precisely how a 4,300-character block ships with "4,300 characters" written next to it.

**Trim order when it is over** — the multi-Story template's fixed scaffolding measures ~3,210 characters in a typical run (~3,420 with every braced clause present) before a single Story is listed, leaving roughly 780 characters for the Story list and the substituted values at ~25–35 characters per Story entry. When that is not enough, trim where the characters actually are, top of this list first:

| Lever | Typical saving | Notes |
| --- | --- | --- |
| Drop braced conditional clauses that do not apply | up to ~200 | "Omit" means delete the clause, not leave it braced |
| Condense Story titles to 3–4 words each | ~10–20 per Story | Titles are context, not contract — the runner reads the real Story from Jira |
| Split the run | unbounded | Hand back TWO handoffs: the first half of the Stories now, the rest after — each Story still merges at its own mark, so nothing is lost by splitting |

**Never trim:** the METHOD "STOP and report" bullet, the Story-mark authorization line, the "fix the code, never the gate" CI rule, the park-and-dependency-judgment rule in Story-mark step 5, the Safety bullets, or the commit-suffix rules. The single-ticket variant renders far under the cap, but the measurement rule applies to it all the same.

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

Then report the block 2 character count you measured in step 5 (e.g. `goal message: 3,100 chars — measured, under the 4000 cap`). This is a receipt for a check that already passed, not the moment you find out: if the number you are about to write is 4000 or higher, you are printing the wrong block — go back to step 5 and trim. **STOP.** Do not run anything, do not invoke another skill, do not touch the clipboard or any hook. The user copies and pastes these two blocks by hand — each one whole, exactly as printed.
