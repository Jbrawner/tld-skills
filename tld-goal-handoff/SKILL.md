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
3. **Block 2 (`/goal`) MUST come in under 4000 characters, measured — not estimated, not "about".** Over 4000 and `/goal` does not run at all; this is a hard app limit, not a style preference. Measure the composed block before printing it (step 5) and trim in the order given there until it is under. Printing a block you have not measured, or printing one you measured at 4000+, is a failure of this skill even if every other check passes. Never leave a `{placeholder}` — resolve every value.
4. Leave both fences **untagged** — no `bash`, no `text`, no language hint. A `bash` tag turns the block into a runnable shell command, and these are chat messages, not shell commands.

## Process

### 1. Load config and resolve the key
Read `.tld/campaign.md` (repo root). If missing: "No campaign found — run /campaign-init." and stop. Parse Project (Issue tracker, Ticket prefix), Stack (Database, Co-author), Commit format (Pattern).

**Tracker guard:** if campaign → Project → Issue tracker is not `Jira`, stop and output: "tld-goal-handoff currently supports Jira only — campaign Issue tracker is '{tracker}'. See LIMITATIONS.md." Do not silently proceed on a non-Jira campaign (mirrors the unsupported-tracker stop in the canonical Tracker-resolution block).

For Jira: resolve cloudId via `getAccessibleAtlassianResources`; project key = `Ticket prefix` (quote in JQL).

Resolve the argument key:
- **Sub-task key** (e.g. `LAB-398`) → single-ticket handoff: the `/goal` message builds just that ticket.
- **Story key** (e.g. `LAB-397`) → whole-story handoff: the `/goal` message loops its unfinished Sub-tasks in rank order.
- **No argument** → first Story by rank with an unfinished Sub-task, treated as a Story handoff.

### 2. Gather what the `/goal` message needs
- **Tickets:** for a Story, `parent = "<key>" AND issuetype = Sub-task ORDER BY Rank ASC` (unfinished only), each with a one-line AC distillation and its type. For a single ticket, just that one.
- **Flow class per ticket** (recorded while reading each ticket; the tags feed step 4):
  - `full-auto` — the default: a normal code ticket with a runnable test harness.
  - `no-tests` — the ticket is labeled `no-tests` or `build-only`; or the campaign has no runnable test command (every Test Commands field empty or `skip`) and the ticket's scope is docs/content only.
  - `migration` — the existing migration signals: the description mentions migration / schema / column / constraint / CHECK changes or supabase migrations, or its file scope is `*.sql` under the migrations path (same test as `/tld-full-auto` §1's re-check). If both `migration` and `no-tests` apply, `migration` wins.
- **Branch:** `git branch --show-current`.
- **Commit:** the campaign Commit `Pattern`; the `Co-Authored-By` trailer from Stack → Co-author (omit if blank).
- **Jira Done:** `getTransitionsForJiraIssue` on one ticket; pick the transition whose target status category is `done` and is NOT cancel. Capture its **id** and the **cloudId**. Bake real values in.
- **Local DB:** campaign Stack → Database. If `.tld/goal-notes.md` exists, read it for env quirks and any prod-DB-to-never-touch; fold into Safety.

### 3. Compose Block 1 — the `/compact` message
One line: the literal `/compact ` token, then plain prose, no other slash token. The `/compact ` prefix is **part of block 1**, not a label you put above it. Shape:

`/compact Keep the campaign config, the {Story/this ticket}'s scope and its ticket list with a one-line status for each, and the outcome of any ticket already finished. Drop the previous ticket's verbose tool output, diffs, and resolved debugging so the next ticket starts from a clean slate.`

### 4. Compose Block 2 — the `/goal` message
Fill real values. The `/goal ` prefix on the first line is **part of block 2**, not a label you put above it. For a **single ticket**, drop the ordered list and the "one ticket at a time" framing. For a **Story**, keep them.

Render every entry in `{ORDERED-TICKET-LIST}` as `KEY (condensed title) [flow-class]` using the step-2 classification — e.g. `AS-12 (fix stale docs) [no-tests]`, `AS-13 (add rate limit) [full-auto]` — so the runner knows the expected shape of each ticket's checkpoint before it starts.

**No-runnable-command variant:** when the campaign has no runnable test command at all (every Test Commands field empty or `skip`), `/tld-full-auto` cannot deliver any verified checkpoint — replace the first METHOD bullet with the braced direct-method bullet in the template below and tag every ticket `[no-tests]`. Otherwise omit that braced bullet entirely.

```
/goal Drive {KEY} ({title}) through the TLD flow on branch {branch}{, one ticket at a time, in this order: {ORDERED-TICKET-LIST}}.

METHOD — non-negotiable:
- Drive EVERY ticket by invoking /tld-full-auto <ticket> via the Skill tool (it runs /tld-setup → /tld-write-tests → /tld-build → /tld-audit → /tld-run-test; [no-tests] tickets ride its label-gated no-tests path). Do NOT inline, reproduce, or shortcut those phases yourself.
{- No-runnable-command campaigns ONLY (this bullet replaces the one above): for each ticket invoke /tld-setup <KEY> then /tld-build via the Skill tool, self-review the diff against every AC item in the Jira description, then land per the landing step below.}
- Strictly sequential, one ticket at a time. No subagents, no parallelism.
- If a skill errors, there is real ambiguity, or you are tempted to substitute your own faster process, STOP and report — do NOT hand-roll it. Substituting your own process is a FAILURE even if tests are green.

For each ticket:
1. Invoke /tld-full-auto <TICKET> via the Skill tool. It stops at the verified checkpoint and never commits.
2. Land it: stage ONLY that ticket's files (never `git add -A`), update the right CHANGE_LOG.md under [Unreleased], commit as `{Pattern}` — append " — TLD verified" to the title when the ticket landed test-verified, " — NPC" when it landed without test verification ([no-tests] path or the direct method){ with trailer `{trailer}`}, then transition it to Done in Jira (cloudId {cloudId}, transition id {id}).
3. Briefly report the result, then continue to the next ticket.

Ticket-type handling:
- Feature/bug tickets: normal red→green→verify. Each Jira description is decision-complete — do exactly what it says, no improvising.
- [no-tests] tickets: /tld-full-auto's label-gated no-tests path drives them — RED is skipped by design, and the healthy checkpoint reads "regression-clean, NOT spec-verified (no-tests ticket)". Treat that as the expected stop, not an error.
- Migration/schema tickets: hand-apply to the LOCAL stack only; never `supabase db reset` from a worktree; run the backend tests too.

Safety (non-negotiable):
- DB = {local stack} only. Prove the target is local before ANY DB write. Never touch a non-local database{; never touch prod ref {prod ref}}.
- Push the branch after committing so progress is durable — UNLESS a PR is already open for this branch, in which case do NOT push automatically; stop and defer to the user (a push updates the PR and re-triggers CI/reviewers), and the user will say what to do. Do NOT open a PR or merge UNLESS this goal explicitly asks for one — if it does (e.g. "put up a PR", "message X about merging"), that instruction authorizes it, so do it. Otherwise the user handles PRs and merges. Never push to or merge the default branch; never force-push.
- If a single ticket is blocked (env failure, ambiguity, full-auto can't proceed), SKIP it, log why, CONTINUE.

After ALL tickets:
1. Run /tld-gate via the Skill tool. Not good until it passes; if it fails, fix what is safe, else flag it.
2. Only if this goal asks for a PR: run the FULL E2E suite locally to completion BEFORE pushing. Never push a red or unfinished E2E.
3. Wake-up report (per ticket: built/committed/skipped, hash, tests; plus gate and E2E results). STOP.
```

The commit-suffix rules mirror the family's landing conventions: ` — TLD verified` is what `/tld-run-test` step 5 appends after a green verify, and ` — NPC` is `/npc-partial` step 4's marker for a landing with no test verification. The composed goal must keep them distinct — a no-test landing never claims ` — TLD verified`.

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

**Trim order when it is over** — the fixed scaffolding measures ~3,050 characters in a typical run (~3,300 with every braced bullet still present) before a single ticket is listed, leaving roughly 950 characters for the ticket list and the substituted values, so trim where the characters actually are, top of this list first:

| Lever | Typical saving | Notes |
| --- | --- | --- |
| Drop braced optional bullets that do not apply | up to ~300 | "Omit" means delete the bullet, not leave it braced |
| Cut `Ticket-type handling` bullets for classes not in this run | ~150 each | A story with no `[no-tests]` and no migration ticket needs neither bullet |
| Condense ticket titles to 3–5 words each | ~10–20 per ticket | Smallest lever — never the only one that will save you |

**Never trim:** the METHOD "STOP and report, do not hand-roll it" bullet, the Safety push / PR / merge bullet, the commit-suffix rules, or any ticket's flow tag. If the block is still over 4000 after every lever above, say so and hand back a Story split rather than quietly shipping an over-cap block.

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

Then report the block 2 character count you measured in step 5 (e.g. `goal message: 2,900 chars — measured, under the 4000 cap`). This is a receipt for a check that already passed, not the moment you find out: if the number you are about to write is 4000 or higher, you are printing the wrong block — go back to step 5 and trim. **STOP.** Do not run anything, do not invoke another skill, do not touch the clipboard or any hook. The user copies and pastes these two blocks by hand — each one whole, exactly as printed.
