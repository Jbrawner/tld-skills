# Standards

Reusable text blocks that appear verbatim across multiple SKILL.md files. If you change a block here, run `scripts/verify-block-alignment.py` and update every embed it flags. The verification script reads this file as the source of truth.

For the rules around editing these blocks (the "no-drift rule"), see [CONTRIBUTING.md](CONTRIBUTING.md).

**Variant naming:** When a block has more than one valid version (e.g., a strict and a discovery form), the variant name is part of the heading itself — e.g., `### Resolve next ticket (discovery)` and `### Require current ticket (strict)`. Skill embeds must use the exact heading they intend to follow. The verifier matches embed → canonical by heading text, so a wrong-variant paste shows up as "no canonical block found matching this heading."

---

## Canonical shared blocks

### Numbered shortcut recognition

**When to use:** Any skill that ends with a "What's next?" options block. Skills that map numbers to per-block-type behavior (like `/tld-next`) should use a different heading (e.g., `### Per-option number handling`) so the verifier doesn't mistake them for this canonical.

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### Milestone completion check

**When to use:** End-of-ticket skills (`/tld-run-test`) that need to decide whether the next option block should include a "run the milestone gate" choice. (`/tld-commit` and `/tld-pr` determine "what's next" with their own inline milestone walk rather than embedding this block, because they may mark the ticket Done themselves.)

Before presenting options, check if this was the last ticket in its milestone:
1. Read the current ticket and note its milestone (the tracker's current-ticket + milestone lookup — see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira)
2. Read that milestone's ordered ticket list (Linear: the `## Order` section of the milestone description; Jira: the milestone Story's child tickets by rank)
3. Look up each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the milestone is Done, append the 4th option below. Otherwise present only the first 3.

### Recommendation hint

**When to use:** Setup-style skills (`/tld-setup`) that need to mark one option as **(Recommended)** in the "What's next?" block.

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-partial-auto` as Recommended.

**Flip to `/tld-build`** if ANY of these are true:
- Ticket has a `no-tests` or `build-only` label
- All files in "Files to Create/Modify" fall under the campaign's `Stack.Landing directory`

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `endpoint`, `route`, `RLS`, `policy`, `migration`, `auth`, `permission`, `secret`, `credentials`
- "Files to Create/Modify" lists 5 or more files

Evaluate `/tld-build` first, then `/tld-write-tests`. If no flip rule matches, the default stays `/tld-partial-auto`. Only one option gets the marker. Never mark `/tld-dashboard`, `/tld-side-quest`, `/npc-partial`, or `/npc-full` **in the TLD-ticket options block** — the NPC variants are intentionally listed last there because they skip testing and are rarely the right call for real implementation tickets. (The NPC-ticket options block does intentionally mark `/npc-partial` as Recommended — see "Flow selection (TLD vs NPC)" below; that is not a contradiction with this rule, it is the NPC-ticket case being handled separately.) Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

`/tld-audit` is recommended at build-time (see `/tld-build`'s post-implementation hint), not at setup-time — it only has signal once a diff exists. Do not include it as a setup-time flip target.

### Manual-QA classification (setup-time)

**When to use:** Setup-time skills (`/tld-setup`, `/tld-partial-auto`) that need to classify a ticket before deciding which flow to run. Uses 3 trigger bullets — no git-state check (a fresh ticket has no diff yet).

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

### Manual-QA classification (verify-time)

**When to use:** Verify-time skills (`/tld-run-test`) classifying a ticket *after* implementation, where the absence of uncommitted changes is itself a strong signal. Adds a 4th git-diff bullet to the setup-time form.

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")
- `git diff` and `git diff --cached` show no uncommitted changes

**Code ticket** — everything else (the default).

### Approval keyword set

**When to use:** This is the source-of-truth definition. Skills that gate on user approval (`/tld-partial-auto`, `/tld-run-test`, `/tld-commit`, `/tld-pr`, `/tld-side-quest`, `/npc-partial`, `/npc-full`) reference this section by name in their own prose — they do NOT re-embed the full definition. They cite it inline (e.g., "see STANDARDS.md § Approval keyword set for the full definition") and list the keywords in passing as part of their own gate language.

`/tld-experience` is intentionally **not** on this list. It is a user-invoked authoring tool (the user types `/tld-experience` after a moment they want to capture) and is never auto-suggested in another skill's "What's next?" block. Its internal approval gates exist for the author flow but do not need to advertise the canonical keyword set as a contract surface.

Every gate skill that waits for explicit user approval (`/tld-partial-auto`, `/tld-run-test`, `/tld-commit`, `/tld-pr`, `/tld-side-quest`, `/npc-partial`, `/npc-full`) accepts this canonical set of affirmative responses. Any of these — and only these — advance the gate:

- `approve`
- `commit`
- `lgtm`
- `looks good`
- `ship it`
- `go`
- `proceed`
- `1` (the bare option number for the approve choice in the "What's next?" block)

**Matching rules:**
- Case-insensitive.
- Leading/trailing whitespace ignored.
- Substring does NOT count — the response must match one of these keywords exactly (modulo case and whitespace).
- Synonyms and variants ("approved", "done", "yes", "continue", etc.) are NOT accepted. To add a new keyword, update this canonical block first; do not special-case a single skill.

Silence, questions, partial responses, and off-list words are not approval.

---

## Canonical paste-blocks

### Canonical paste-block: Load project config

**When to use:** Every skill that touches project state opens with this block verbatim. The hard-stop on missing fields is intentional — skills that *display or repair* the campaign file (`/campaign-edit`, `/campaign-show`, `/campaign-test`) handle missing fields differently and embed only the opener (no fingerprint match against this block).

Every skill that touches project state opens with this block verbatim. It lives here so all copies stay byte-identical.

```
Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The tracker, team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.
```

### Canonical paste-block: Tracker resolution

**When to use:** Every skill that reads or writes ticket or milestone state embeds this block verbatim immediately after Load project config. It routes the skill's tracker operations to the right adapter and hard-stops on unsupported trackers. Skills that only touch the local campaign file (`/campaign-validate`, `/campaign-remove`, `/campaign-portless`, `/campaign-edit`, `/tld-recenter`, `/tld-release`) do not embed it.

```
This skill's ticket and milestone operations are written using Linear MCP tool names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Linear** — call the Linear MCP tools directly, as written in this skill. Contract: docs/ADAPTERS.md.
- **Jira** — perform the equivalent operation per docs/JIRA.md instead (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Linear, Jira. See LIMITATIONS.md."
  Do not invent an adapter.
```

### Canonical paste-block: Resolve next ticket (discovery)

**When to use:** Discovery-mode skills (`/tld-setup` Mode B, `/tld-save-point`) that find a ticket by walking milestones when zero are In-Progress. Use the strict form (below) for action skills that should refuse to auto-pick a ticket.

Every skill that needs "the current ticket" via discovery embeds this block verbatim (after Load project config).

```
Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Auto-discover by walking milestones:
1. List the configured project's milestones in order (Linear: by `sortOrder` ascending; Jira: the milestone Stories by rank).
2. If the result is empty, stop and output:
     "No milestones in project '{project name}' — run /campaign-plan or /milestone-create to create one."
3. Walk the milestones in order. For each milestone, read its ordered ticket list:
   - Linear: read the description and parse the `## Order` section with the unanchored regex (find `^## Order\s*$`, capture lines until the next `## ` header, take the first `({prefix}-\d+)` match per line). If the `## Order` section is missing or yields zero ticket IDs, stop and output:
        "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it."
   - Jira: list the milestone Story's child tickets ordered by rank (see docs/JIRA.md).
   Then, for each ticket in the ordered list, look up its status. Return the first ticket whose status is neither Done nor Canceled AND that is not already In Progress for someone other than me (a ticket claimed by another assignee is skipped).
4. If every ticket in every milestone is resolved or claimed by others, stop and output:
     "All tickets in all milestones are resolved. Nothing to do."

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.
```

### Canonical paste-block: Require current ticket (strict)

**When to use:** Action-mode skills (`/tld-align`, `/tld-partial-auto`, `/tld-build`, `/tld-commit`, `/tld-pr`, `/tld-run-test`, `/tld-skip`, `/tld-write-tests`, `/npc-partial`, `/npc-full`) that should refuse to auto-discover. Zero In-Progress = STOP and tell the user to run `/tld-setup`. Use the discovery form (above) for skills that should auto-pick. `/tld-cancel` uses the cancel-variant below — it adds "or pass a specific ticket ID to cancel" to the Case-B output and changes the Case-C question text to "pick the one to cancel."

```
Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.
```

### Canonical paste-block: Require current ticket (strict, cancel variant)

**When to use:** Used only by `/tld-cancel`. Same logic as the plain strict block above, but the Case-B output adds "or pass a specific ticket ID to cancel" because `/tld-cancel` is one of the few action skills that meaningfully accepts an explicit ticket ID, and the Case-C question text changes from "pick the one to act on" to "pick the one to cancel" to match the action being taken. All other case logic is identical.

```
Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up, or pass a specific ticket ID to cancel."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to cancel." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.
```

### Note on Dependencies-section authorship

**When to apply:** Skills that author a milestone description's `## Dependencies` section (`/campaign-plan`, `/milestone-create`, `/milestone-sync`).

By design, these three skills produce different `## Dependencies` content because they have different context at write-time:

| Skill | Context | Dependencies wording |
|---|---|---|
| `/campaign-plan` | Knows the full phase order — can substitute the previous phase's name | `{previous phase name, or "None — this is the starting milestone."}` |
| `/milestone-create` | Knows only the new milestone, not what came before | `_Specify dependent milestones or "None" after creation._` (italic placeholder for the user to fill in) |
| `/milestone-sync` (full template mode) | Authoring placeholders for the user to fill in later | `_Specify dependent milestones or "None"._` (italic placeholder) |

This divergence is intentional and is **not** drift. Do not "harmonize" these strings to a single wording — each skill writes the most-specific Dependencies content it can given what it knows at the time.

### Canonical paste-block: Author Order block

**When to use:** Skills that author or rewrite a milestone's `## Order` section on a tracker that stores order as text (`/campaign-plan`, `/milestone-create`, `/milestone-sync`). All three must build the Order block the same way, otherwise the reader-side parser may end up pointed at a sequence that doesn't match what was written. Embed the block verbatim wherever a textual milestone description is being composed; surrounding Mode-specific logic (placeholder vs. populated, full-template vs. Order-only) stays local to the embedding skill. **On the Jira path this block does not apply** — Jira order is the child tickets' native rank, so the embedding skill skips it and instead creates the tickets in the intended order (see docs/JIRA.md).

````
**Build the Order block:**

```markdown
## Order
1. {first ticket ID}
2. {second ticket ID}
3. ...
```

Write the plain `1. {prefix}-XXX` form. On save, some trackers rewrite each line to a linked form `1. [{prefix}-XXX](url)` — that is expected, and the reader-side Order-section parser handles both forms.
````

### Canonical paste-block: Flow selection (TLD vs NPC)

**When to use:** Setup-style skills (`/tld-setup`, `/tld-save-point`) that classify a ticket into TLD vs NPC and need to decide which option-block variant to render. Embed verbatim. The result determines whether the NPC variants get top-billing in the options block (NPC ticket) or whether they remain optional alternatives (TLD ticket).

```
**Classify the ticket as TLD or NPC before rendering the options block.**

Read `.tld/campaign.md` for `Test Commands.Backend` (the canonical signal).

**NPC ticket** — classify as this if BOTH:
1. `Test Commands.Backend` is the literal string `skip` (case-insensitive).
2. The ticket scope is content/docs only — no files in `Stack.Backend directory`, `Stack.Frontend directory`, or paths matching `migrations/`, `supabase/`, `api/`, `auth/`, `rls/`. "Files to Create/Modify" lists only `.md`, `.mdx`, `.txt`, `.json` content files, README updates, or files under a marketing/landing surface.

**TLD ticket** — everything else (the default).

When the classification is NPC, render the options block with `/npc-partial` and `/npc-full` as positions 1 and 2 (recommended); demote `/tld-partial-auto` and `/tld-build` to lower positions. When the classification is TLD, keep the standard ordering with NPC variants listed last.
```

### Canonical paste-block: Required workspace labels

**When to use:** Skills that read or create the seven required workspace labels (`/campaign-init`'s bootstrap step, `/campaign-test`'s connectivity check). Embed the table verbatim — it is the source of truth for label names, hex colors, and descriptions. The label list is referenced by name elsewhere (recommendation hints, dashboards) so any rename requires updating every reader at the same time. **On the Jira path the color and description columns do not apply** (Jira labels are bare strings) and there is no create step — labels exist implicitly when first used, so the bootstrap is a no-op. See docs/JIRA.md. The seven label *names* are identical on both trackers.

```
| Name | Color | Description |
|---|---|---|
| `model:sonnet` | `#5E6AD2` | Recommended model for this ticket: Claude Sonnet. Default. |
| `model:opus` | `#7B68EE` | Recommended model for this ticket: Claude Opus. Use for high-risk or pattern-setting work. |
| `model:haiku` | `#9B59B6` | Recommended model for this ticket: Claude Haiku. Use for cheap, mechanical work. |
| `effort:low` | `#26B87A` | Recommended reasoning effort: low. Mechanical edits, grep-replace, short additions. |
| `effort:medium` | `#F2994A` | Recommended reasoning effort: medium. Normal skill authoring, structured writing. |
| `effort:high` | `#EB5757` | Recommended reasoning effort: high. Architectural design, pattern-setting work, contracts. |
| `side-quest` | `#14B8A6` | Small polish or quick-fix work handled via `/tld-side-quest` outside the main TLD flow. |
```

### Canonical paste-block: Local DB safety check

**When to use:** Every skill that runs test commands or destructive database operations embeds this block verbatim after Load project config (and, where relevant, after Resolve current ticket / Resolve test command).

Every skill that runs test commands or destructive database operations embeds this block verbatim after Load project config (and, where relevant, after Resolve current ticket / Resolve test command). It aborts the skill if the configured database URL is not a loopback address. The block body must be byte-identical across every embedder — if you change the wording here, update every SKILL.md that embeds it.

````
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
````
