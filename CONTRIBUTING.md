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

Several blocks of prose appear verbatim across multiple skills because the same logic has to run in several places (setup, verification, automated pipeline). **The canonical versions of these blocks live in [STANDARDS.md](STANDARDS.md).** If you need to change the wording or logic of a shared block:

1. Edit the block in [STANDARDS.md](STANDARDS.md) first.
2. Then update every SKILL.md that embeds the block to match exactly.
3. A future CI linter will enforce this (deferred to v0.2). Until then, it's on the contributor.

Do NOT edit a block in a single SKILL.md and leave the others stale. Do NOT introduce a local variant with slightly different wording — if a skill needs a context-specific addition, add it as a separate paragraph below the canonical block, not a replacement.

---

## Canonical shared blocks

The 8 canonical reusable blocks have moved to **[STANDARDS.md](STANDARDS.md)**. The rules around editing them (the "no-drift rule" above) still apply — STANDARDS.md is now the source of truth that skill copies must match.

---

## Campaign File + Milestone Contract

Skills no longer parse a playbook. Structure and runtime state live in two places and nowhere else:

1. **Linear** — authoritative for milestone list (sorted by `sortOrder`), per-milestone metadata (purpose, scope, exit criteria), the ordered ticket sequence within each milestone (the `## Order` section of the milestone description), and every ticket's status (Todo / In Progress / Done / Canceled).
2. **`.tld/campaign.md`** — a per-repo file holding only static local config: which issue tracker and project to talk to, what test commands to run, where the stack lives, and how commits should be formatted. No milestone list. No Active section. No ticket-order cache.

The rest of this section defines the exact contract both sides must meet.

### `.tld/campaign.md` schema

Four sections, in this order:

```markdown
# Campaign: {Project name}

## Project
- Issue tracker: {tracker}
- Project name: {Project name}
- Team: {Team}
- Ticket prefix: {PREFIX}

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

### Error handling: Linear unreachable

There is no offline mode. If a Linear call fails (network error, auth failure, rate limit, 5xx), the skill surfaces the error and exits. Skills must not proceed against stale cached state — the campaign file has no ticket-order or status cache by design, so there is nothing to fall back to.

### Rule: no local state cache

Linear ticket status (Todo / In Progress / Done / Canceled) is the **sole** indicator of runtime position. The campaign file has no `Active.Current`, no `Active.Order`, no per-milestone cache. Resume after `/clear` works by reading the In-Progress ticket from Linear, not from disk.

Adding a local state cache re-introduces drift risk — don't. If a skill thinks it needs one, it is solving the wrong problem.
