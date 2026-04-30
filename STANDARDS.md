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

**When to use:** End-of-ticket skills (`/tld-commit`, `/tld-run-test`) that need to decide whether the next option block should include a "run the milestone gate" choice.

Before presenting options, check if this was the last ticket in its milestone:
1. Read the current ticket via `get_issue` and note its `projectMilestone`
2. Read that milestone's description via `get_milestone` and parse the `## Order` section for the ticket sequence
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the milestone is Done, append the 4th option below. Otherwise present only the first 3.

### Recommendation hint

**When to use:** Setup-style skills (`/tld-setup`) that need to mark one option as **(Recommended)** in the "What's next?" block.

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-auto` as Recommended.

**Flip to `/tld-build`** if ANY of these are true:
- Ticket has a `no-tests` or `build-only` label
- All files in "Files to Create/Modify" fall under the campaign's `Stack.Landing directory`

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `auth`, `RLS`, `migration`, `payment`, `credentials`, `security`
- "Files to Create/Modify" lists 5 or more files

Evaluate the `/tld-build` flip first. If neither flip rule matches, the default stays `/tld-auto`. Only one option gets the marker. Never mark `/tld-dashboard` or `/tld-side-quest`. Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

### Manual-QA classification (setup-time)

**When to use:** Setup-time skills (`/tld-setup`, `/tld-auto`) that need to classify a ticket before deciding which flow to run. Uses 3 trigger bullets — no git-state check (a fresh ticket has no diff yet).

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

**When to use:** This is the source-of-truth definition. Skills that gate on user approval (`/tld-auto`, `/tld-run-test`, `/tld-commit`, `/tld-side-quest`) reference this section by name in their own prose — they do NOT re-embed the full definition. They cite it inline (e.g., "see STANDARDS.md § Approval keyword set for the full definition") and list the keywords in passing as part of their own gate language.

Every gate skill that waits for explicit user approval (`/tld-auto`, `/tld-run-test`, `/tld-commit`, `/tld-side-quest`) accepts this canonical set of affirmative responses. Any of these — and only these — advance the gate:

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

### Canonical paste-block: Resolve next ticket (discovery)

**When to use:** Discovery-mode skills (`/tld-setup` Mode B, `/tld-save-point`) that find a ticket by walking milestones when zero are In-Progress. Use the strict form (below) for action skills that should refuse to auto-pick a ticket.

Every skill that needs "the current ticket" via discovery embeds this block verbatim (after Load project config).

```
Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Auto-discover by walking milestones:
1. Call `list_milestones` for the configured project, sorted by `sortOrder` ascending.
2. If the result is empty, stop and output:
     "No milestones in project '{project name}' — run /campaign-plan or /milestone-create to create one."
3. Walk the milestones in order. For each milestone:
   a. Call `get_milestone` to read its description.
   b. Parse the `## Order` section using the unanchored regex algorithm (find `^## Order\s*$`, capture lines until the next `## ` header, take the first `({prefix}-\d+)` match per line).
   c. If the `## Order` section is missing or yields zero ticket IDs, stop and output:
        "Milestone '{name}' has a malformed or missing `## Order` section. Run /milestone-sync to repair it."
   d. For each ticket ID in the parsed Order, look up its status. Return the first ticket whose status is neither Done nor Canceled.
4. If every ticket in every milestone is Done or Canceled, stop and output:
     "All tickets in all milestones are resolved. Nothing to do."

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.
```

### Canonical paste-block: Require current ticket (strict)

**When to use:** Action-mode skills (`/tld-align`, `/tld-auto`, `/tld-build`, `/tld-commit`, `/tld-run-test`, `/tld-skip`, `/tld-write-tests`) that should refuse to auto-discover. Zero In-Progress = STOP and tell the user to run `/tld-setup`. Use the discovery form (above) for skills that should auto-pick.

```
Query Linear for issues in the configured project with status = "In Progress".

**Case A — exactly one In-Progress ticket:** That is the current ticket. Load it via `get_issue` for full description / AC / files / `projectMilestone`.

**Case B — zero In-Progress tickets:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
Do not fall back to cached state; there is none.
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
