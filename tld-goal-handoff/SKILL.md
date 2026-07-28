---
name: tld-goal-handoff
description: |
  Generate the two copy-paste prompts for a manual TLD build handoff: a /compact message and a /goal message. Use this skill whenever the user says "tld-goal-handoff", "goal handoff", "prep the handoff", "give me the compact and goal", "handoff prompt", or wants ready-to-paste /compact + /goal text for a ticket or Story. Reads the ticket(s) from Jira, resolves branch + commit format + Jira Done transition + local DB, then PRINTS two fenced blocks for the user to paste by hand — first /compact, then /goal after compaction finishes. Each block INCLUDES its own leading slash command, so one click on the copy button yields a message the user can paste and send without typing anything. There is NO hook, NO auto-fire, NO clipboard, and NO keystroke automation: this skill only composes and prints text. Optional argument: a ticket or Story key (e.g. /tld-goal-handoff LAB-398).
---

# TLD Goal Handoff — print the `/compact` and `/goal` prompts for manual paste

Your job: produce TWO ready-to-paste text blocks and nothing else — a **`/compact`** message and a **`/goal`** message — so the user pastes them by hand. You do NOT run `/compact` or `/goal`, you do NOT use a hook, you do NOT touch the clipboard, you do NOT inject keystrokes. Compose and print, then stop.

**The order the user will use them:** copy block 1, paste, send; wait for the compaction to fully finish; then copy block 2, paste, send.

**Hard rules:**
1. **Each fenced block is the ENTIRE message the user sends — slash command included.** Block 1's first characters are literally `/compact ` and block 2's first characters are literally `/goal `. The user's one click on the code-block copy button must yield text they can paste and send with zero typing. Never strip the slash command out of the fence and mention it only in the surrounding prose — that forces the user to type it back in by hand, which defeats the entire purpose of this skill.
2. Block 1 is a single line: the literal token `/compact `, then plain prose. After that leading token it must contain **NO other slash-command token** (no `/goal`, no `/tld-*`). A second `/word` inside a `/compact` argument makes the app abort the compaction. (The leading `/compact` is the command itself, not a second token — it belongs in the block.)
3. Keep block 2 (`/goal`) under ~4000 characters. Never leave a `{placeholder}` — resolve every value.
4. Leave both fences **untagged** — no `bash`, no `text`, no language hint. A `bash` tag turns the block into a runnable shell command, and these are chat messages, not shell commands.

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
One line: the literal `/compact ` token, then plain prose, no other slash token. The `/compact ` prefix is **part of block 1**, not a label you put above it. Shape:

`/compact Keep the campaign config, the {Story/this ticket}'s scope and its ticket list with a one-line status for each, and the outcome of any ticket already finished. Drop the previous ticket's verbose tool output, diffs, and resolved debugging so the next ticket starts from a clean slate.`

### 4. Compose Block 2 — the `/goal` message
Fill real values. The `/goal ` prefix on the first line is **part of block 2**, not a label you put above it. For a **single ticket**, drop the ordered list and the "one ticket at a time" framing. For a **Story**, keep them.

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
- Push the branch after committing so progress is durable — UNLESS a PR is already open for this branch, in which case do NOT push automatically; stop and defer to the user (a push updates the PR and re-triggers CI/reviewers), and the user will say what to do. Do NOT open a PR or merge UNLESS this goal explicitly asks for one — if it does (e.g. "put up a PR", "message X about merging"), that instruction authorizes it, so do it. Otherwise the user handles PRs and merges. Never push to or merge the default branch; never force-push.
- If a single ticket is blocked (env failure, ambiguity, full-auto can't proceed), SKIP it, log why, CONTINUE.

At the end: write a wake-up report (per ticket: built/committed/skipped, commit hash, test results, anything flagged) and STOP.
```

### 5. Self-check before printing
Verify all four, and fix any that fail before you print:

| Check | Requirement |
| --- | --- |
| Block 1 opening | Starts with the exact characters `/compact ` — if not, prepend them |
| Block 2 opening | Starts with the exact characters `/goal ` — if not, prepend them |
| Slash tokens | Block 1 has exactly one `/word` (the leading `/compact`); block 2's `/goal` is its first token |
| Fences | Both fences untagged — no `bash`, no `text`, no language hint |

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

Then note the character count of block 2 (e.g. `goal message: 2,900 chars`). **STOP.** Do not run anything, do not invoke another skill, do not touch the clipboard or any hook. The user copies and pastes these two blocks by hand — each one whole, exactly as printed.
