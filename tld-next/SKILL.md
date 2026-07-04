---
name: tld-next
description: |
  Transition to the next TLD ticket after a successful commit. Use this skill whenever the user says "tld-next", "tld next", "next ticket", or wants to mark the current ticket done and prepare for the next one. Marks the ticket Done in Linear, determines what's next (another ticket or a milestone gate), and outputs the /compact prompt for context reset. Always use after /tld-run-test commits successfully.
---

# TLD Next

You are transitioning from a completed ticket to the next one. Your job is to close out the current ticket, figure out what's next in its milestone Order, and give the user the exact command to run after a context reset.

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

### 2. Identify the current ticket

Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That's the current ticket. Load via `get_issue` for `projectMilestone` and full context.

**Case B — zero In-Progress tickets:** Suggest a candidate but **always confirm with the user before proceeding** — fall-back inference can pick the wrong ticket and `/tld-next` writes Done to Linear.
1. Check the most recent conversation history for a `/tld-setup` output or ticket reference. Capture the candidate ticket ID.
2. If conversation has no candidate, check the most recent git commit message for a ticket ID (format: `feat({prefix}-XXX): ...`). Capture that as the candidate.
3. **Confirm via `AskUserQuestion`** — present the candidate ID + title (loaded via `get_issue`) as the default option, plus an "It's a different ticket" escape and a "Cancel — let me run /tld-setup first" escape. Default = the inferred candidate but require an explicit selection. Do NOT auto-proceed on silence. Question text: "No In-Progress ticket found. I think you just committed `{candidate ID}` — `{title}`. Confirm before I mark it Done?"
4. If the user picks the escape ("different ticket"), call `AskUserQuestion` again with the most recent five Done-or-Todo tickets in this project as options + free-text fallback.
5. If the user picks "Cancel", stop and output: "No ticket marked Done. Run `/tld-setup` to pick one up first."

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion`. One option per In-Progress ticket; each option's label is the ticket ID + title. Question text: "Multiple tickets are In Progress — pick the one you just completed."

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."

### 3. Verify commit exists

Check that the most recent git commit references the current ticket ID (e.g., `git log --oneline -5 | grep {ticket-id}`). This confirms `/tld-run-test` actually committed.

If no commit found for this ticket, stop and tell the user: "No commit found for {ticket ID}. Run `/tld-run-test` first."

### 4. Mark ticket Done in Linear

Use `save_issue` to set the ticket's state to "Done".
Never write to `.tld/campaign.md`.

> **Jira path:** status changes go through a workflow transition, not a field write — call `getTransitionsForJiraIssue` for the sub-task and `transitionJiraIssue` to the Done-category status (see docs/JIRA.md § Statuses). For step 5, "what's next" is the next-ranked unfinished **Sub-task** under the same milestone Story (`parent = "<storyKey>" ORDER BY Rank ASC`, skip Done/Canceled, sub-tasks In Progress for someone else, and sub-tasks whose blockers are not all resolved; i.e. take the next-ranked sub-task whose `is blocked by` links all point at Done/Canceled issues), not an `## Order` walk; read its labels via `getJiraIssue` and apply label overrides (step 7) via `editJiraIssue`. Run the milestone gate (below) only when every sub-task of the Story is Done/Canceled. If the Story's only remaining sub-tasks are blocked (none ready, none done), do not gate: emit `/tld-setup` with no id, which walks the remaining Stories by rank for the next ready sub-task and returns the blocked one once its blocker clears.

### 5. Determine what's next

1. Read the current ticket's milestone via `get_milestone` using the `projectMilestone.id` captured in step 2.
2. Parse the `## Order` section using the unanchored regex algorithm:
   - Find the `^## Order\s*$` line.
   - Capture following lines until the next `^## ` header or end-of-description.
   - For each line, take the first regex match of `({prefix}-\d+)` — that's the ticket ID for that position. Do NOT anchor on `^\d+\.\s+` (Linear's auto-link rewrite breaks that).
3. Locate the current ticket's position in the parsed Order.
4. Walk forward from there. For each remaining ticket ID, look up its status. Return the first one whose status is **Todo** or **Backlog** — skip Done, Canceled, AND In Progress (another agent may have claimed it).

**If a next ticket is found:** set `next_action` = `/tld-setup {next-ticket-ID}`. Then call `get_issue` on the next ticket to read its `labels` array. Parse:
- **Recommended model:** the value after `model:` in any `model:*` label. If no `model:*` label is present, default to `sonnet` and mark the source as "default" (not a label).
- **Recommended effort:** the value after `effort:` in any `effort:*` label. If no `effort:*` label is present, default to `medium` and mark the source as "default" (not a label).

These values drive the recommendation line and the override cycles in step 7.

**If no Todo ticket remains in this milestone's Order:** set `next_action` = `/tld-gate {milestoneId}` — substitute the just-completed ticket's `projectMilestone.id` so `/tld-gate` runs against the correct milestone (its no-arg fallback can pick the wrong one in Linear histories with re-opened tickets or parallel work). **Never emit the literal text `{milestoneId}` to the user** — substitute the actual id BEFORE rendering. If you cannot capture the id, fall back to a no-arg `/tld-gate` and warn the user explicitly. Note the milestone name — it just completed. No label read is needed in this case.

**Edge — malformed Order:** If the Order section is missing or yields zero tickets, stop and output:
  "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it. Ticket {ID} was marked Done successfully."

### Per-option number handling

When the user responds to a "What's next?" block with a bare number, map it based on which block was presented:

**Next-ticket case (4-option block):**
- `1` → end the skill. The user runs `/compact` + the printed `/tld-setup {id}` command manually. Do NOT invoke `/tld-setup` yourself.
- `2` → apply the Change-model cycle, update labels via `save_issue`, re-render the block. Wait again.
- `3` → apply the Change-effort cycle, update labels via `save_issue`, re-render the block. Wait again.
- `4` → prompt the user inline for model + effort values, update labels via `save_issue`, re-render the block. Wait again.

**Milestone-gate case (3-option block):**
- `1` → end the skill. The user runs `/compact` + the printed `/tld-gate {milestoneId}` command manually. Do NOT invoke `/tld-gate` yourself.
- `2` → invoke `/tld-dashboard`.
- `3` → invoke `/tld-side-quest`.

### 6. Output

Report:
- Ticket {ID} marked Done in Linear
- Milestone progress (e.g., "3 of 5 tickets resolved in M3: Core TLD Wiring")
- What's next (next ticket ID or milestone gate)
- If next action is another ticket, a recommendation line in the form `Recommended: model:{X} | effort:{Y}`, using the values parsed in step 5. When a label source is "default" (no `model:*` or `effort:*` label on the next ticket), render that side as `{value} (default)` — e.g., `Recommended: model: sonnet (default) | effort: medium (default)`.

Context is saved in Linear. The recommended flow is to compact this conversation's stale context and start the next action fresh.

### 7. Present options

**If next action is another ticket:**

---

```
Next: /tld-setup {next-ticket-ID}
Recommended: model:{X} | effort:{Y}
```

(When the next ticket has no `model:*` label, render that side as `model: sonnet (default)`. When it has no `effort:*` label, render it as `effort: medium (default)`.)

**What's next?**

> **1.** Proceed as recommended (Recommended)
>    Best for: labels look right, ready to start the next ticket
>    Step 1: type `/compact` · Step 2: run the command below

```
/tld-setup {next-ticket-ID}
```

> **2.** Change model — cycle `sonnet → opus → haiku → sonnet`
>    Best for: turned out to be a different complexity than labeled

> **3.** Change effort — cycle `low → medium → high → low`
>    Best for: re-scoping the effort up or down

> **4.** Proceed with custom model+effort — collect values inline
>    Best for: want to set both to specific values in one shot

Type **2**, **3**, or **4** to adjust the recommendation and re-display. For option 1, run `/compact` then paste the command above.

#### Handling overrides (options 2, 3, 4)

Each of these updates the **next** ticket's Linear labels (not the just-completed ticket) via `save_issue`, then re-renders the "What's next?" block with the updated values. Never write to `.tld/campaign.md`.

**Option 2 — Change model:** advance the current model value one step in the cycle `sonnet → opus → haiku → sonnet`. If the next ticket has no `model:*` label, the starting point is `sonnet`, so the new value becomes `opus`. Effort stays unchanged.

**Option 3 — Change effort:** advance the current effort value one step in the cycle `low → medium → high → low`. If the next ticket has no `effort:*` label, the starting point is `medium`, so the new value becomes `high`. Model stays unchanged.

**Option 4 — Custom model+effort:** ask the user inline for both values. Accept only the canonical sets — `opus`/`sonnet`/`haiku` for model, `low`/`medium`/`high` for effort. Reject anything else and re-ask.

**Label mutation (all three options):**

1. Start from the next ticket's current `labels` array.
2. Remove every existing `model:*` label if model is changing; remove every existing `effort:*` label if effort is changing. Non-`model:`/`effort:` labels are preserved untouched.
3. Append the new `model:{X}` and/or `effort:{Y}` label(s).
4. Call `save_issue({id: next-ticket-ID, labels: new-array})`.

After the update succeeds, re-render the "What's next?" block above with the refreshed `Recommended: …` line. The loop continues until the user picks option 1.

**HARD STOP: Options 2, 3, 4 loop in-skill — apply the override, re-render, wait. Option 1 ends the skill: do NOT invoke `/tld-setup` or any other skill. The user runs `/compact` then pastes the printed `/tld-setup {id}` command manually.**

**If next action is milestone gate:**

---

**What's next?**

> **1.** Run milestone-boundary gate with clean context (Recommended)
>    Best for: standard flow, ready to validate the completed milestone
>    Step 1: type `/compact` · Step 2: run the command below

```
/tld-gate {milestoneId}
```

> **2.** /tld-dashboard — review progress first
>    Best for: want to see milestone status before gating

> **3.** /tld-side-quest — handle a quick fix before the gate
>    Best for: noticed polish to handle before validation

Type **2** or **3** to invoke those options. For option 1, run `/compact` then paste the command above.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-gate` or any other skill. Wait for the user to pick an option or type a command.**
