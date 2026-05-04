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

Silence is not approval. Questions are not approval. Only a canonical approval keyword advances the flow — see [STANDARDS.md § Approval keyword set](STANDARDS.md#approval-keyword-set) for the full list.

If a skill's output does not end with a hard-stop directive and a "What's next?" options block, something is wrong — either the skill forgot the gate or the user is about to lose a review opportunity.

### The no-drift rule

Several blocks of prose appear verbatim across multiple skills because the same logic has to run in several places (setup, verification, automated pipeline). **The canonical versions of these blocks live in [STANDARDS.md](STANDARDS.md).** If you need to change the wording or logic of a shared block:

1. Edit the block in [STANDARDS.md](STANDARDS.md) first.
2. Then update every SKILL.md that embeds the block to match exactly.
3. A future CI linter will enforce this (deferred to v0.2). Until then, it's on the contributor.

Do NOT edit a block in a single SKILL.md and leave the others stale. Do NOT introduce a local variant with slightly different wording — if a skill needs a context-specific addition, add it as a separate paragraph below the canonical block, not a replacement.

---

## CHANGE_LOG.md scope

`CHANGE_LOG.md` (or whatever path the campaign's `Stack.Changelog path` field points at) is updated by the **TLD code path only**: `/tld-run-test`, `/tld-commit`, and `/tld-auto` each read the configured changelog path and add an entry as part of the commit step.

`/tld-side-quest`, `/npc-partial`, and `/npc-full` deliberately **do not** update the changelog. The reasoning:

- **Side quests** are scope-bounded polish or quick fixes — the squash commit's `side-quest({ticket-id}):` prefix already makes them grep-able, and a changelog entry per side quest would clutter the log with noise.
- **NPC variants** ship content / docs / copy work where the campaign's test command is `skip`. Doc-only commits typically aren't user-visible behavior changes worth a changelog entry.

**If your repo enforces a CI changelog gate that fires on every commit** (regardless of scope), the side-quest and NPC variants will fail CI on push. Two options:

1. **Add the entry by hand before the commit** — both flows are stoppable. For `/tld-side-quest`, type `2` (describe adjustments) at the QA gate, edit the changelog in the worktree, then approve. For `/npc-partial`, edit the changelog while reviewing the diff at the hard stop, then approve. For `/npc-full`, there's no pause — switch to `/npc-partial` instead.
2. **Use `/tld-commit` from the worktree / after the build** — `/tld-commit` is the lightweight commit re-entry skill and DOES run the changelog step, so the gate will pass.

This is intentional and is **not** drift across the commit-emitting skills — the exemption is documented for the same reason the writer/reader matrix below is documented: future changes to the framework should preserve the exemption (or amend this paragraph if the rationale changes).

## Canonical shared blocks

The 14 canonical reusable blocks (6 shared blocks + 8 paste-blocks) have moved to **[STANDARDS.md](STANDARDS.md)**. The rules around editing them (the "no-drift rule" above) still apply — STANDARDS.md is now the source of truth that skill copies must match.

For the canonical set of approval keywords every gate skill accepts, see [STANDARDS.md § Approval keyword set](STANDARDS.md#approval-keyword-set).

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
- Landing: {command to run landing-site tests, if the project has a landing surface}
- Full: {command to run the full regression suite — used by /tld-gate}

## Stack
- Backend directory: {path}
- Frontend directory: {path}
- Landing directory: {path to landing-site code, if the project has one}
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
| **Writes Linear structure** (milestones, tickets, milestone descriptions) | `/campaign-plan`, `/milestone-create`, `/milestone-sync`, `/tld-ticket`, `/tld-cancel` | Linear — creates/modifies milestones and tickets; writes `## Order` sections (`/tld-cancel` rewrites the active milestone's `## Order` to remove the canceled ticket) |
| **Writes Linear ticket status** (state transitions) | `/tld-setup`, `/tld-next`, `/tld-skip`, `/tld-cancel`, `/tld-commit`, `/tld-run-test`, `/tld-side-quest` | Linear — flips ticket status (Todo ↔ In Progress ↔ Done ↔ Canceled, plus side-quest branches). `/tld-cancel` appears here AND in "Writes Linear structure" because it does both. |
| **Read-only** | `/tld-write-tests`, `/tld-build`, `/tld-align`, `/tld-audit`, `/tld-save-point`, `/tld-dashboard`, `/tld-help`, `/tld-gate`, `/campaign-show`, `/campaign-test`, `/campaign-validate` | Nothing — queries Linear and/or the campaign file |
| **Local-git only** (no Linear, no campaign.md) | `/tld-recenter` | Local git — creates a fresh branch off `main`; refuses if working tree is dirty |
| **Aggregator** (writes indirectly, via sub-skills) | `/tld-auto`, `/npc-partial`, `/npc-full` | Whatever sub-skills write; the aggregator itself writes nothing directly. NPC variants chain `/tld-build` → commit → `/tld-next`. |
| **Writes external repo** (PR against the skills repo) | `/tld-experience` | `Jbrawner/tld-skills` — pushes a branch and opens a PR with a new SKILL.md. Does not touch the current repo's Linear or campaign.md. |
| **Writes release artifacts** (CHANGELOG bump + release branch + GitHub Release) | `/tld-release` | This repo — bumps `CHANGELOG.md`, opens a release-branch PR, and after merge runs `gh release create` to publish a tagged GitHub Release. Then watches the marketplace auto-bump workflow that runs in `Jbrawner/claude-skills`. Does not touch Linear or `.tld/campaign.md`. |
| **Deletes only** | `/campaign-remove` | Local file — removes `.tld/campaign.md` |

`/tld-gate` is read-only because ticket statuses are set by `/tld-next` before the gate runs; the gate verifies but does not transition.

`/tld-run-test` appears under "Writes ticket status" because its QA gate optionally marks the current ticket Done on approval. If the user declines at that gate, the skill writes nothing.

`/tld-cancel` is the only skill that crosses two write categories: it flips a ticket to Canceled (status) AND rewrites the milestone's `## Order` to remove the canceled ID (structure). Both transitions happen atomically in the same run.

`/tld-recenter` is the only TLD skill that does NOT embed the canonical "Load project config" block. It operates purely on git state (`git status`, `git checkout`, `git pull --ff-only`, `git checkout -b`) and intentionally does not read `.tld/campaign.md` — there is no project config it needs. Every other skill in this matrix loads the campaign first.

### Error handling: Linear unreachable

There is no offline mode. If a Linear call fails (network error, auth failure, rate limit, 5xx), the skill surfaces the error and exits. Skills must not proceed against stale cached state — the campaign file has no ticket-order or status cache by design, so there is nothing to fall back to.

### Rule: no local state cache

Linear ticket status (Todo / In Progress / Done / Canceled) is the **sole** indicator of runtime position. The campaign file has no `Active.Current`, no `Active.Order`, no per-milestone cache. Resume after `/clear` works by reading the In-Progress ticket from Linear, not from disk.

Adding a local state cache re-introduces drift risk — don't. If a skill thinks it needs one, it is solving the wrong problem.
