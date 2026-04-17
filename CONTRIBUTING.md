# Contributing to Adventure Skills

Thanks for taking a look. This document covers how the skills framework is designed to behave, the rules that keep it from breaking, and the canonical text of shared blocks that appear across multiple skills.

## How to contribute

### Test-led philosophy

Adventure Skills drives work through **Test-Led Development (TLD)**: tests are written before any implementation, and the tests ARE the specification. If you can't write a test for an acceptance criterion, the criterion is underspecified.

Write the minimum implementation to make tests pass. No speculative features, no "while I'm in here" refactors, no abstractions beyond what the tests require.

Tests are not a checkpoint. They are the definition of done.

### Hard stops

Skills run a strict phase sequence: **red → review → green → verify → commit**.

- **red** — write failing tests that encode the acceptance criteria
- **review** — present the tests and STOP; wait for the user to approve the spec before any implementation code is written
- **green** — write the minimum implementation to make tests pass
- **verify** — run the full test command and a drift check against the ticket spec
- **commit** — present a manual-QA checklist, STOP, and only commit after explicit user approval

Every transition between phases is a **mandatory hard stop**. A skill that finishes its phase must not invoke another skill, write implementation code after writing tests, or commit before manual-QA approval.

Silence is not approval. Questions are not approval. Only an explicit affirmative ("go", "approve", "lgtm", "commit", "ship it", a bare option number, or equivalent) advances the flow.

If a skill's output does not end with a hard-stop directive and a "What's next?" options block, something is wrong — either the skill forgot the gate or the user is about to lose a review opportunity.

### The no-drift rule

Four blocks of prose appear verbatim across multiple skills because the same logic has to run in several places (setup, verification, automated pipeline). **The canonical versions of these blocks live in this file.** If you need to change the wording or logic of a shared block:

1. Edit the block in this file first.
2. Then update every SKILL.md that embeds the block to match exactly.
3. A future CI linter will enforce this (deferred to v0.2). Until then, it's on the contributor.

Do NOT edit a block in a single SKILL.md and leave the others stale. Do NOT introduce a local variant with slightly different wording — if a skill needs a context-specific addition, add it as a separate paragraph below the canonical block, not a replacement.

---

## Canonical shared blocks

The four blocks below are the authoritative sources. Skills embed them verbatim.

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
