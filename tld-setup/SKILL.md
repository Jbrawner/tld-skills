---
name: tld-setup
description: |
  Set up the next TLD (Test-Led Development) ticket for implementation. Use this skill whenever the user says "tld-setup", "tld setup", "set up next ticket", or wants to start working on the next ticket. This skill finds the next ticket, pulls it from Linear, marks it In Progress, loads relevant files, and outputs the full context needed before writing tests. Always use this before starting any new ticket work.
---

# TLD Setup

You are preparing the next ticket for test-led development. Your job is to identify the right ticket, pull its full context from Linear, and give the user everything they need to review before running `/tld-write-tests` or `/tld-auto`.

## Inputs

The user may provide:
- A specific ticket ID (e.g., `2ND-149`) — Mode A: use that ticket directly
- Nothing — Mode B: find the next ticket automatically from Linear milestones

Structure and order come from Linear. Local project config comes from `.tld/campaign.md`.

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

### 2. Determine the target ticket

**Mode A — explicit ticket ID provided:**

Validate the ID matches the `{prefix}-\d+` pattern from the campaign. If not, stop and ask the user to re-run with a valid ID.

Call `get_issue` on the ID with `includeRelations: true`. If In Progress, proceed (the user is resuming). Capture `projectMilestone` for context.

If the ticket is already Done or Canceled, use AskUserQuestion:

> Ticket {TICKET-ID} is already {Done|Canceled}. Proceed with setup anyway?

Options, in this order (default is Cancel):

- **Cancel** — abort cleanly. Do not modify the ticket's Linear state. Report: "Cancelled. {TICKET-ID} is {Done|Canceled} and was left untouched. Run `/tld-setup` with no argument to find the next ticket."
- **Proceed anyway** — continue with the existing Mode A flow.

If the user's response is ambiguous, default to **Cancel** (default-No pattern). Only proceed when the user explicitly picks "Proceed anyway".

Skip to step 4.

**Mode B — no ticket ID:**

> **Jira path:** there is no `## Order` text to parse. Walk the milestone **Stories** by rank; for each, list its child **Sub-tasks** ordered by rank (`parent = "<storyKey>" ORDER BY Rank ASC`) and return the first sub-task that is not Done/Canceled **and** not already In Progress for someone other than you (a sub-task claimed by another assignee is skipped — the multi-person rule). Resolve "me" via `atlassianUserInfo`. See docs/JIRA.md § Milestone and ordering. The Linear `## Order` walk below does not apply.

1. Call `list_milestones` for the configured Linear project, sorted by `sortOrder` ascending.
2. If the result is empty, stop and output:
     "No milestones in project '{project name}' — run /campaign-plan or /milestone-create to create one."
3. Walk the milestones in order. For each milestone:
   a. Call `get_milestone` to read its description.
   b. Parse the `## Order` section using the algorithm in step 3.
   c. If the `## Order` section is missing or yields zero ticket IDs, stop and output:
        "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it."
   d. For each ticket ID in the parsed Order, look up its status (batched `list_issues` or per-ticket `get_issue`).
   e. Return the first ticket whose status is **neither Done NOR Canceled**. Both statuses count as "already resolved" — skip both.

   _Note: Mode B intentionally accepts In-Progress tickets — this is how `/tld-setup` recovers an orphaned ticket from a prior session. `/tld-next` does the opposite (walks Order skipping In-Progress) because, in `/tld-next`'s frame, the In-Progress ticket is the one that just got marked Done. The divergence is deliberate._
4. If every ticket in every milestone is Done or Canceled, stop and output:
     "All tickets in all milestones are resolved. Nothing to do."

### 3. Parse the `## Order` section

Use this algorithm on the milestone description:

1. Find the line matching `^## Order\s*$`.
2. Capture every following line until the next `^## ` header or end-of-description.
3. Within that block, scan line-by-line. For each line, take the first regex match of `({prefix}-\d+)` (unanchored — do NOT anchor on `^\d+\.\s+` because Linear rewrites `1. PREFIX-XXX` to `1. [PREFIX-XXX](url)`, breaking any anchor that assumes the ID immediately follows the list marker).
4. The resulting list, in line order, is the ticket sequence.

The `{prefix}` comes from the Ticket prefix field of the campaign file — it is not hardcoded.

### 4. Pull ticket details

Use `get_issue` with `includeRelations: true` on the target ticket. Extract:
- Title
- Full description
- Acceptance criteria
- Dependencies (`blockedBy` relations)
- Milestone (`projectMilestone`)
- Labels (the `labels` array, e.g. `["effort:low","model:sonnet"]`)
- Any test commands or file references mentioned in the description

### 5. Check dependencies

For each blocker in `blockedBy`:
- Check its status.
- If any blocker is NOT Done or Canceled, stop and report:
    "Blocked — {blocker-id} is {status}. Resolve it first."

### 6. Mark In Progress

If the ticket's current status is Todo or Backlog, call `save_issue` to set `state` to "In Progress".
If it is already In Progress, leave it alone (user is resuming).
Never write to `.tld/campaign.md` at any point — this skill does not touch the campaign file.

### 7. Load pattern references

Read any files explicitly referenced in the ticket description (pattern refs, existing tests, source files being ported). Use the Test Commands and Stack sections of the campaign file for test-command hints — these values come from campaign, not the ticket.

### 8. Manual-QA classification (setup-time)

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

Record the classification. Use it in step 10 to pick the right options block.

### 9. Recommendation hint (CODE tickets only)

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-auto` as Recommended.

**Flip to `/tld-build`** if ANY of these are true:
- Ticket has a `no-tests` or `build-only` label
- All files in "Files to Create/Modify" fall under the campaign's `Stack.Landing directory`

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `endpoint`, `route`, `RLS`, `policy`, `migration`, `auth`, `permission`, `secret`, `credentials`
- "Files to Create/Modify" lists 5 or more files

Evaluate `/tld-build` first, then `/tld-write-tests`. If no flip rule matches, the default stays `/tld-auto`. Only one option gets the marker. Never mark `/tld-dashboard`, `/tld-side-quest`, `/npc-partial`, or `/npc-full` **in the TLD-ticket options block** — the NPC variants are intentionally listed last there because they skip testing and are rarely the right call for real implementation tickets. (The NPC-ticket options block does intentionally mark `/npc-partial` as Recommended — see "Flow selection (TLD vs NPC)" below; that is not a contradiction with this rule, it is the NPC-ticket case being handled separately.) Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

`/tld-audit` is recommended at build-time (see `/tld-build`'s post-implementation hint), not at setup-time — it only has signal once a diff exists. Do not include it as a setup-time flip target.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 10. Output

Present the full ticket context directly in the conversation. Structure your output as:

```
## Active Ticket: {TICKET-ID}

**Title:** {ticket title}
**Milestone:** {milestone name}
**Labels:** {comma-separated backticked labels, e.g. `effort:low`, `model:sonnet` — or `_none_` if the ticket has no labels}

### Description
{full ticket description from Linear}

### Acceptance Criteria
{extracted AC items as a checklist}

### Test Command
{from campaign.md Test Commands section, matched to the ticket's stack/scope}

### Files to Create/Modify
{extracted from ticket description}

### Pattern References
{files loaded as context, with brief note on why each matters}

### Dependencies
{list with status — all should be Done or Canceled}

### Notes
{any gotchas or special instructions from the ticket description}
```

Then tell the user:
- Which ticket was selected and why (position in milestone Order, or "you specified it" for Mode A)
- Summary of what it involves
- Dependencies confirmed clear
- Render a compact recommendation block from the ticket's `labels` array. Extract the value after `model:` from any `model:*` label (expected: `opus`, `sonnet`, `haiku`) and the value after `effort:` from any `effort:*` label (expected: `low`, `medium`, `high`). Then:
  - Output a single line in the form **Recommended:** model `{model}` · effort `{effort}` — using `·` as the separator. Omit the `model `{model}`` portion if there is no `model:*` label; omit the `effort `{effort}`` portion if there is no `effort:*` label; if neither label is present, omit the entire line (and the warning line below) — do NOT render a placeholder.
  - Directly below that line, ONLY if a `model:*` label is present AND the currently running Claude Code model's family does not match the recommendation, add a warning line in the form: ⚠️ Current model is `{current}` — run `/model {recommended}` to match. Determine the current family by reading the environment preamble (which names the model like "Opus 4.7", "Sonnet 4.6", or "Haiku 4.5") and mapping that family to `opus` / `sonnet` / `haiku` (lowercase) for comparison. If the current family matches the `model:*` value, omit the warning line entirely. If there is no `model:*` label, omit the warning line entirely (never compare effort — effort is display-only and has no Claude Code runtime setting).
  - Directly below the recommendation line (and the warning line, if shown), add a **tailored hint line** that nudges the user toward manual stepping or `/tld-auto` based on the model+effort combination. The line starts with `Consider:` and is a single sentence. Use this mapping, evaluated in order — the first matching rule wins:
    1. `model:haiku` (any effort) → `Consider: Haiku-scoped work is mechanical — /tld-auto is fine.`
    2. `model:opus` + `effort:high` → `Consider: Opus + high suggests pattern-setting / architectural work — manual stepping may give more control than /tld-auto.`
    3. `model:sonnet` + `effort:high` → `Consider: Sonnet + high is meaningful design — either manual stepping or /tld-auto with careful review works.`
    4. `effort:high` (any other model, e.g. model label missing) → `Consider: effort:high — lean toward manual stepping.`
    5. `model:sonnet` + `effort:low` → `Consider: Sonnet + low is mechanical — /tld-auto is fine.`
    6. `model:sonnet` + `effort:medium` → omit the hint line entirely (this is the default case, no nudge needed).
    7. Any other combination (including a ticket with only one of the two labels that doesn't match a rule above) → omit the hint line entirely.
    Skip the hint line entirely if neither label is present (the recommendation line itself is already omitted in that case).

### Canonical paste-block: Flow selection (TLD vs NPC)

**Classify the ticket as TLD or NPC before rendering the options block.**

Read `.tld/campaign.md` for `Test Commands.Backend` (the canonical signal).

**NPC ticket** — classify as this if BOTH:
1. `Test Commands.Backend` is the literal string `skip` (case-insensitive).
2. The ticket scope is content/docs only — no files in `Stack.Backend directory`, `Stack.Frontend directory`, or paths matching `migrations/`, `supabase/`, `api/`, `auth/`, `rls/`. "Files to Create/Modify" lists only `.md`, `.mdx`, `.txt`, `.json` content files, README updates, or files under a marketing/landing surface.

**TLD ticket** — everything else (the default).

When the classification is NPC, render the options block with `/npc-partial` and `/npc-full` as positions 1 and 2 (recommended); demote `/tld-auto` and `/tld-build` to lower positions. When the classification is TLD, keep the standard ordering with NPC variants listed last.

Then present the options block based on the ticket type classification from step 8 AND the TLD/NPC flow-selection above.

**If ticket is a CODE ticket AND classification is TLD, present:** (apply the `(Recommended)` marker from step 9 to exactly one of options 1, 2, or 3 — never more than one)

---

**What's next?**

> **1.** /tld-write-tests — step-by-step flow
>    Best for: complex tickets, new patterns, unfamiliar territory
>    Flow: write-tests → build → (audit) → run-test → next

> **2.** /tld-auto — automated pipeline
>    Best for: small, straightforward tickets you're confident about
>    Gates: 2 stops (test review, QA approval)

> **3.** /tld-build — skip tests, build directly
>    Best for: landing pages, marketing UI, frontend-only work where tests add no value
>    Flow: build → run-test (manual QA only) → next

> **4.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting this ticket

> **5.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something else before starting this ticket

> **6.** /npc-partial — build → diff-review pause → commit → next, skipping tests
>    Best for: Small text change, things that have no functionality impact
>    Rarely the right call for real implementation tickets — prefer 1, 2, or 3.

> **7.** /npc-full — build → commit → next, no pauses, skipping tests
>    Best for: Small text change, things that have no functionality impact
>    Rarely the right call for real implementation tickets — prefer 1, 2, or 3.

Type **1**, **2**, **3**, **4**, **5**, **6**, or **7** to proceed.

**If ticket is a CODE ticket AND classification is NPC, present:**

---

**What's next?**

> **1.** /npc-partial — build → diff-review pause → commit → next, skipping tests (Recommended)
>    Best for: Small text change, things that have no functionality impact

> **2.** /npc-full — build → commit → next, no pauses, skipping tests
>    Best for: Small text change, things that have no functionality impact, you trust the build

> **3.** /tld-build — build directly, then verify manually
>    Best for: NPC scope but you want a closer look before committing

> **4.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting this ticket

> **5.** /tld-side-quest — handle a quick fix first
>    Best for: noticed something else before starting this ticket

Type **1**, **2**, **3**, **4**, or **5** to proceed.

**If ticket is a MANUAL-QA ticket, present:**

---

**What's next?**

> **1.** /tld-run-test — step-by-step manual walkthrough
>    Best for: first-time QA, tickets with many verification steps
>    Flow: checklist → approve each → mark Done

> **2.** /tld-auto — QA gate in one pass
>    Best for: quick re-verification or simple QA tickets
>    Trade-off: approve everything or nothing

> **3.** /tld-dashboard — review progress before diving in
>    Best for: want the big picture before starting manual QA

> **4.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before starting the walkthrough

> **5.** /npc-partial — build → diff-review pause → commit → next, skipping tests
>    Best for: Small text change, things that have no functionality impact
>    Rarely the right call for manual-QA tickets — prefer 1 or 2.

> **6.** /npc-full — build → commit → next, no pauses, skipping tests
>    Best for: Small text change, things that have no functionality impact
>    Rarely the right call for manual-QA tickets — prefer 1 or 2.

Type **1**, **2**, **3**, **4**, **5**, or **6** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT write tests, do NOT write implementation code, do NOT invoke any other TLD skill. Wait for the user to pick an option or type a command. Your only job was setup.**
