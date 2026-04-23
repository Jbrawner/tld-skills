# Standards

Reusable text blocks that appear verbatim across multiple SKILL.md files. If you change a block here, run `scripts/verify-block-alignment.py` and update every embed it flags. The verification script reads this file as the source of truth.

For the rules around editing these blocks (the "no-drift rule"), see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Canonical shared blocks

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### Milestone completion check

Before presenting options, check if this was the last ticket in its milestone:
1. Read the current ticket via `get_issue` and note its `projectMilestone`
2. Read that milestone's description via `get_milestone` and parse the `## Order` section for the ticket sequence
3. Use `list_issues` to query Linear for each ticket's status
4. Treat the ticket just committed as Done (it's about to be marked Done by /tld-next)
5. If every ticket in the milestone is Done, append the 4th option below. Otherwise present only the first 3.

### Recommendation hint

Skip for manual-QA tickets. For code tickets, pick which option to mark **(Recommended)** in the output block.

**Default:** mark `/tld-auto` as Recommended.

**Flip to `/tld-write-tests`** if ANY of these are true:
- Ticket description or AC mentions any of: `auth`, `RLS`, `migration`, `payment`, `credentials`, `security`
- "Files to Create/Modify" lists 5 or more files

Only one option gets the marker. Never mark `/tld-side-quest`. Do not add a "Why recommended" line. The existing "Best for:" lines already explain the tradeoff.

### Manual-QA classification

**Manual-QA ticket** — classify as this if ANY of:
- Ticket description or notes contain "manual QA", "no code changes", "walk through", "validate end-to-end", "manual verification"
- "Files to Create/Modify" is "None", empty, or missing from the ticket
- All AC items describe user actions (e.g., "Navigate to...", "Click...", "Verify that...", "Run seed then check...")

**Code ticket** — everything else (the default).

### Approval keyword set

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

### Canonical paste-block: Resolve next ticket

Every skill that needs "the current ticket" opens with this block verbatim (after Load project config).

```
Query Linear for issues in the configured project with status = "In Progress".
Case A — exactly one In-Progress ticket:
  That is the current ticket. Load it via get_issue for full description / AC / files.
Case B — zero In-Progress tickets:
  List milestones in the configured project, ordered by sortOrder ascending.
  Walk the list; for each milestone, read its description via get_milestone and parse the ## Order section.
  For each ticket ID in Order, check its status. Return the first ticket whose status is neither Done nor Canceled.
  If no such ticket exists in any milestone, stop and output:
    "No incomplete tickets found in any milestone. Nothing to do."
Case C — two or more In-Progress tickets:
  Stop and output the list with AskUserQuestion: "Multiple tickets are In Progress — pick the one to act on."
  Do not guess.
If Linear is unreachable at any step, stop and output:
  "Cannot reach Linear — aborting. No offline mode."
  Do not fall back to cached state; there is none.
```

### Canonical paste-block: Local DB safety check

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
