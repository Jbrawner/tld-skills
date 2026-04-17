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

---

## Campaign File + Milestone Contract

Skills no longer parse a playbook. Structure and runtime state live in two places and nowhere else:

1. **Linear** — authoritative for milestone list (sorted by `sortOrder`), per-milestone metadata (purpose, scope, exit criteria), the ordered ticket sequence within each milestone (the `## Order` section of the milestone description), and every ticket's status (Todo / In Progress / Done / Canceled).
2. **`.tld/campaign.md`** — a per-repo file holding only static local config: which Linear project to talk to, what test commands to run, where the stack lives, and how commits should be formatted. No milestone list. No Active section. No ticket-order cache.

The rest of this section defines the exact contract both sides must meet.

### `.tld/campaign.md` schema

Four sections, in this order:

```markdown
# Campaign: {Project Name}

## Project
- Name: {human-readable project name}
- Issue tracker: Linear
- Team: {Linear team name}
- Ticket prefix: {PREFIX}
- Linear project: {Linear project name or slug}

## Test Commands
- Backend: {command to run backend tests}
- Frontend: {command to run frontend tests}
- Full: {command to run the full regression suite — used by /tld-gate}

## Stack
- Backend directory: {path}
- Frontend directory: {path}
- Database: {connection hint, e.g. Supabase local at 127.0.0.1:54321}
- Changelog path: {path to repo CHANGELOG, if the project keeps one}

## Commit format
- Pattern: {example, e.g. feat(PREFIX-XXX): title}
- Co-author: {full Co-Authored-By trailer line}
```

That is the whole file. If a skill needs a value that is not in one of these four sections, the value does not exist yet — do not invent a new field inside a skill. File a ticket to extend this contract first.

**Location:** `{repo-root}/.tld/campaign.md`. The directory is gitignored; the file is per-clone.

### Linear milestone description schema

Every milestone created by the planning skills (or by hand) must have a description with these six sections, in this order:

```markdown
## Purpose
{one to three sentences — why this milestone exists}

## Scope
{bullet list or prose — what is in and out}

## Order
1. PREFIX-XXX
2. PREFIX-YYY
3. PREFIX-ZZZ

## Exit Criteria
{bullet list — what must be true before the milestone is Done}

## Dependencies
{milestone names or "None"}

## Risk
{Low / Medium / High with a one-line rationale}
```

The `## Order` section is the authoritative ticket sequence for the milestone. Planning skills write it; progression skills read it.

### Order-section parser (the one non-obvious bit)

When `save_milestone` receives `1. PREFIX-199`, Linear silently rewrites it to a markdown link:

```markdown
1. [PREFIX-199](https://linear.app/.../PREFIX-199)
```

Skills will see both forms in the wild — freshly-written milestones before Linear re-renders, mixed hand-edited + auto-linked lists, and older milestones where every line is already linked. The parser has to handle all of them.

**Use this algorithm:**

1. Find the line matching `^## Order\s*$`.
2. Capture every following line until the next `^## ` header or end-of-description.
3. Within that block, scan line-by-line. For each line, find the first regex match of `(PREFIX-\d+)` (unanchored) — this is the ticket ID for that position.
4. The resulting list, in line order, is the ticket sequence.

**Do NOT** anchor the regex on `^\d+\.\s+` — the literal `[` that Linear inserts before the ticket ID breaks any anchor that assumes the ID immediately follows the list marker.

**Do NOT** split on `, ` or assume one ticket per line without the numbered prefix — the contract is "one ticket per numbered list item" and parsers should enforce that shape.

The `PREFIX` comes from `.tld/campaign.md`'s `## Project` → `Ticket prefix` field. Skills compose the regex from that value; it is not hardcoded.

### Writer/reader matrix

Every TLD and campaign skill falls into exactly one category below. This matrix is the drift canary — if a new skill lands and does not fit cleanly, the contract needs to change, not the skill.

| Category | Skills | Write target |
|---|---|---|
| **Writes `.tld/campaign.md`** | `/campaign-init`, `/campaign-edit` | Local file — creates or edits the four sections |
| **Writes Linear structure** (milestones, tickets, milestone descriptions) | `/campaign-plan`, `/milestone-create`, `/milestone-sync`, `/tld-ticket` | Linear — creates/modifies milestones and tickets; writes `## Order` sections |
| **Writes Linear ticket status** (state transitions) | `/tld-setup`, `/tld-next`, `/tld-skip`, `/tld-commit`, `/tld-run-test`, `/tld-side-quest` | Linear — flips ticket status only (Todo ↔ In Progress ↔ Done, plus side-quest branches) |
| **Read-only** | `/tld-write-tests`, `/tld-build`, `/tld-align`, `/tld-audit`, `/tld-save-point`, `/tld-dashboard`, `/tld-help`, `/tld-gate`, `/campaign-show`, `/campaign-test` | Nothing — queries Linear and/or the campaign file |
| **Aggregator** (writes indirectly, via sub-skills) | `/tld-auto` | Whatever its sub-skills write; /tld-auto itself writes nothing directly |
| **Deletes only** | `/campaign-remove` | Local file — removes `.tld/campaign.md` |

`/tld-gate` is read-only because ticket statuses are set by `/tld-next` before the gate runs; the gate verifies but does not transition.

`/tld-run-test` appears under "Writes ticket status" because its QA gate optionally marks the current ticket Done on approval. If the user declines at that gate, the skill writes nothing.

### Canonical paste-block: Load project config

Every skill that touches project state opens with this block verbatim. It lives here so all copies stay byte-identical.

```
Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run /campaign-init to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Name, Team, Ticket prefix, Linear project) is missing, stop and output:
  "Campaign file is missing required Project field: {field}. Run /campaign-edit to fix."
The Linear team, prefix, and project name from this block are the only ones the skill uses for the rest of this run.
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

### Error handling: Linear unreachable

There is no offline mode. If a Linear call fails (network error, auth failure, rate limit, 5xx), the skill surfaces the error and exits. Skills must not proceed against stale cached state — the campaign file has no ticket-order or status cache by design, so there is nothing to fall back to.

### Rule: no local state cache

Linear ticket status (Todo / In Progress / Done / Canceled) is the **sole** indicator of runtime position. The campaign file has no `Active.Current`, no `Active.Order`, no per-milestone cache. Resume after `/clear` works by reading the In-Progress ticket from Linear, not from disk.

Adding a local state cache re-introduces drift risk — don't. If a skill thinks it needs one, it is solving the wrong problem.

### Worked example: `.tld/campaign.md`

This is the real campaign file for the Adventure Skills repo itself:

```markdown
# Campaign: Adventure Skills

## Project
- Name: Adventure Skills
- Issue tracker: Linear
- Team: 2ndFoundry
- Ticket prefix: 2ND
- Linear project: Adventure Skills

## Test Commands
- Backend: cd backend && npm run test:run
- Frontend: cd frontend-next && npm test
- Full: cd frontend-next && npm test && cd ../backend && npm run test:run

## Stack
- Backend directory: backend
- Frontend directory: frontend-next
- Database: Supabase local at 127.0.0.1:54321
- Changelog path: CHANGELOG.md

## Commit format
- Pattern: feat(2ND-XXX): title
- Co-author: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Worked example: Linear milestone description

This is the real description of **M1: Foundation Docs** in the Adventure Skills project. It shows both the plain and auto-linked forms the Order-section parser has to accept.

**Plain form (what a planning skill writes via `save_milestone`):**

```markdown
## Purpose
Establish the foundational documentation that every later milestone depends on. No skill code changes — this milestone is pure documentation and contracts.

## Scope
CONTRIBUTING.md with shared block definitions (the canonical source for reused SKILL.md text). LIMITATIONS.md and CHANGELOG.md for OSS readiness. The campaign file + Linear milestone contract that defines the .tld/campaign.md schema (4 static sections), the milestone description schema (Purpose / Scope / Order / Exit Criteria / Dependencies / Risk), writer/reader rules, and the canonical paste-blocks every TLD skill will use.

## Order
1. 2ND-199
2. 2ND-200
3. 2ND-202

## Exit Criteria
- CONTRIBUTING.md exists with shared block definitions and the Campaign File + Milestone Contract section
- LIMITATIONS.md and CHANGELOG.md exist at repo root
- Milestone description schema documented (including the Order-section regex)
- Writer/reader matrix lists every TLD and campaign skill
- Canonical "Load project config" and "Resolve next ticket" paste-blocks provided verbatim
- Nothing in skills/ has changed yet

## Dependencies
None. This is the starting milestone.

## Risk
None — documentation only.
```

**Auto-linked form (what the parser actually sees after Linear re-renders):**

```markdown
## Order
1. [2ND-199](https://linear.app/2ndfoundry/issue/2ND-199/foundation-add-contributingmd-with-shared-block-definitions)
2. [2ND-200](https://linear.app/2ndfoundry/issue/2ND-200/foundation-add-limitationsmd-and-changelogmd)
3. [2ND-202](https://linear.app/2ndfoundry/issue/2ND-202/foundation-define-campaign-file-linear-milestone-contract-in)
```

Both forms must yield the same ticket sequence `[2ND-199, 2ND-200, 2ND-202]` under the parser algorithm above. A mixed list (some plain, some auto-linked) should also work — that happens when a user hand-edits one line of a previously-linked list.
