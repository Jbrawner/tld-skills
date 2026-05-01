# Adventure Skills

A set of Claude Code skills for **Test-Led Development (TLD)**. Drives a project through small Linear tickets one at a time, with hard stops between phases, drift detection against the ticket spec, side quests in isolated git worktrees, and milestone-boundary gate checks.

---

## Philosophy

**Test-led, not test-driven.** In TDD, tests are a discipline you follow while writing code. Here, tests *are the specification*. If you can't write a test for an acceptance criterion, the criterion is underspecified — fix the ticket, not the code. The implementation is whatever minimum amount of code makes the tests pass.

**Hard stops between phases.** Each ticket runs the same sequence: **red → review → green → verify → commit**. Every transition is a mandatory stop. After failing tests are written, the framework pauses for you to review the spec before any implementation is written. After verification passes, it pauses again for manual QA approval before committing. Silence is not approval; only an explicit approval keyword advances the flow. This is the central guardrail — it stops the agent from racing ahead and shipping work you haven't actually inspected.

**Side quests in isolated worktrees.** When you notice a small unrelated fix mid-ticket, `/tld-side-quest` spins up a separate git worktree, handles the fix there, and returns you to the original ticket without polluting the main context or leaking unrelated changes into the active commit.

**Drift detection.** Before committing, the framework re-reads the ticket's acceptance criteria and checks the actual diff against them. If the implementation has drifted from the spec — extra files, missing AC items, scope creep — the gate flags it and asks before proceeding.

**Milestone boundaries are real gates.** After every ticket in a milestone is Done, `/tld-gate` runs the full regression suite, verifies every ticket's status, and confirms the milestone's exit criteria are met before the next milestone opens. Tickets are cheap; milestones are commitments.

**Why this exists.** Long agentic runs drift. They invent helpers, refactor neighbours, swallow failing tests with try/except, and confidently report "done" on work that doesn't match what was asked for. TLD constrains the agent to one ticket at a time, gates every phase change behind explicit human approval, and uses tests-as-spec to catch drift before it ships.

---

## Install

Two paths. Pick one.

### Option A — Symlink the repo

```bash
git clone https://github.com/Jbrawner/tld-skills.git ~/code/tld-skills
ln -s ~/code/tld-skills ~/.claude/skills
```

Restart Claude Code. Commands appear without a namespace prefix:
- TLD: `/tld-help`, `/tld-setup`, `/tld-build`, …
- Campaign: `/campaign-init`, `/campaign-show`, …
- Milestone: `/milestone-create`, `/milestone-sync`, …

Run `/tld-help` to confirm.

**Pros:** works immediately, easy to update with `git pull`, easy to read or hack on the skill source files.
**Cons:** no namespace prefix — if another skill on your machine happens to share a name (`setup`, `build`, etc.), the names collide. Updates are manual.

### Option B — Install as a Claude Code plugin

In Claude Code, run:

```
/plugin marketplace add https://github.com/Jbrawner/claude-skills
/plugin install tld@claude-skills
```

Every command is namespaced under `/tld:`:
- TLD: `/tld:help`, `/tld:setup`, `/tld:build`, …
- Campaign: `/tld:campaign-init`, `/tld:campaign-show`, …
- Milestone: `/tld:milestone-create`, `/tld:milestone-sync`, …

The marketplace at [Jbrawner/claude-skills](https://github.com/Jbrawner/claude-skills) auto-tracks each release of this repo, so `/plugin update tld@claude-skills` pulls the latest version when one ships.

**Pros:** clean `/tld:` namespace prevents conflicts with other skills; one-line update via `/plugin update`; no clone or symlink to maintain.
**Cons:** updates land when a new tagged release ships, not on every `main` commit — so you don't get unreleased changes. If you want bleeding edge or want to hack on the source, use Option A.

### Heads-up about command names below

The Getting Started section uses Option A's command form. If you installed via Option B, mentally substitute:

| Option A (symlink) | Option B (plugin) |
|---|---|
| `/tld-x` | `/tld:x` |
| `/campaign-x` | `/tld:campaign-x` |
| `/milestone-x` | `/tld:milestone-x` |

If the slash commands don't appear after restart, check that `~/.claude/skills` resolves to the cloned directory (Option A) and that each skill subdirectory contains a `SKILL.md` file at its root, or that the plugin is enabled in Claude Code's `/plugin` view (Option B).

---

## Getting Started

Each repo gets its own per-repo campaign config. Once the campaign is in place, every TLD command reads it for the project pointer, test commands, stack paths, and commit format. There is no global "active project" — one campaign per repo.

The flow has four steps:

### 1. Scaffold the campaign

```
/campaign-init
```

Creates `.tld/campaign.md` at the repo root with the four required sections (Project, Test Commands, Stack, Commit format) and bootstraps the six required Linear workspace labels (`effort:low`, `effort:medium`, `effort:high`, `model:opus`, `model:sonnet`, `model:haiku`). It will ask you which Linear team and project to point at, what command runs your tests, and where your stack lives.

### 2. Verify Linear connectivity

```
/campaign-test
```

Pre-flight check. Verifies the campaign file is well-formed, that the Linear team and project actually exist, that your ticket prefix matches the Linear team, and that all six required labels are present. Read-mostly; the only write path is creating any missing labels, and only after you say yes.

### 3. Create or sync milestone structure

If your Linear project is empty:

```
/campaign-plan
```

Walks scope → milestones → tickets and creates everything in Linear, including the `## Order` section on each milestone description that the TLD skills read to know which ticket is next.

If you already have milestones and tickets in Linear but the milestones are missing `## Order` sections:

```
/milestone-sync
```

Authors `## Order` sections on existing milestones using their existing ticket lists. Idempotent — re-running skips milestones that already have a valid Order section.

### 4. Pick up the first ticket

```
/tld-setup
```

Walks the project's milestones in `sortOrder`, finds the first ticket whose status isn't Done or Canceled, marks it In Progress, loads its full description and acceptance criteria, and tells you what to run next. From here you're in the standard ticket loop: `/tld-write-tests` → `/tld-build` → `/tld-run-test` → `/tld-next`. Every transition is a hard stop you have to approve.

### Worked example: `.tld/campaign.md`

This is the real campaign file from the Adventure Skills repo itself, showing the four required sections:

```markdown
# Campaign: Adventure Skills

## Project
- Issue tracker: Linear
- Project name: Adventure Skills
- Team: 2ndFoundry
- Ticket prefix: 2ND

## Test Commands
- Backend: cd backend && npm run test:run
- Frontend: cd frontend-next && npm test
- Landing: cd landing && npm test
- Full: cd frontend-next && npm test && cd ../backend && npm run test:run && cd ../landing && npm test

## Stack
- Backend directory: backend
- Frontend directory: frontend-next
- Landing directory: landing
- Database: Supabase local at 127.0.0.1:54321
- Changelog path: CHANGELOG.md

## Commit format
- Pattern: feat(2ND-XXX): title
- Co-author: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

That is the whole schema. If a skill ever appears to need a value not in one of those four sections, it doesn't — please open an issue.

### Worked example: Linear milestone `## Order` section

Planning skills write `## Order` in plain numbered form:

```markdown
## Order
1. 2ND-199
2. 2ND-200
3. 2ND-202
```

Linear silently rewrites this on save into auto-linked form:

```markdown
## Order
1. [2ND-199](https://linear.app/.../2ND-199-foundation-add-contributingmd...)
2. [2ND-200](https://linear.app/.../2ND-200-foundation-add-limitationsmd...)
3. [2ND-202](https://linear.app/.../2ND-202-foundation-define-campaign-file...)
```

Both forms are valid; the parser reads either, plus mixed lists where one line was hand-edited after Linear linked the rest. The full parser algorithm is in [CONTRIBUTING.md](CONTRIBUTING.md#order-section-parser-the-one-non-obvious-bit).

---

## Compatibility

A few hard assumptions are baked in. Plan around them.

| Area | Assumed | Why it matters |
|---|---|---|
| **Issue tracker** | Linear | Every ticket-state skill calls Linear MCP tools by name. `/campaign-init` accepts Jira / GitHub Issues / Other in the schema, but downstream TLD skills will fail until per-tracker adapters land. |
| **Test runner** | Vitest or Jest | The verify phase parses output that looks like Vitest/Jest. Mocha / AVA / `node:test` may technically work; pytest / RSpec / `go test` / `cargo test` are untried. |
| **Local database** | Supabase local at `127.0.0.1:54321` | `/tld-gate`, `/tld-audit`'s RLS checks, and the local-DB safety check all target that endpoint. Other Postgres setups will fail or produce misleading output. |
| **Linear MCP surface** | `save_milestone` does not expose `sortOrder` | Newly-created milestones land at the bottom of the list. Reorder by hand in the Linear UI after `/campaign-plan` or `/milestone-create`. One-time fix per reorder. |

For the full list, see [LIMITATIONS.md](LIMITATIONS.md). For the issue tracker adapter interface contract (every Linear MCP call the TLD skills make, with parameters, response fields, and edge cases), see [docs/ADAPTERS.md](docs/ADAPTERS.md).

---

## Resources

| Document | What's in it |
|---|---|
| [LIMITATIONS.md](LIMITATIONS.md) | Known constraints — Linear-only, Vitest/Jest assumed, Supabase local DB assumed |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Test-led philosophy, hard-stop rules, the no-drift rule, and the full Campaign File + Linear Milestone contract (campaign schema, milestone description schema, the `## Order` parser algorithm, and the writer/reader matrix) |
| [STANDARDS.md](STANDARDS.md) | Canonical text of the 10 reusable shared blocks that appear verbatim across multiple skills (the source of truth for `scripts/verify-block-alignment.py`) |
| [CHANGELOG.md](CHANGELOG.md) | Release history — what's added, changed, and removed |
| [RELEASING.md](RELEASING.md) | How to cut a new release — the 4-step procedure, what the workflow automates, recovery if it fails, and PAT rotation |
| [docs/SKILL_REFERENCE.md](docs/SKILL_REFERENCE.md) | Authoritative reference for every skill — purpose, when to use, what it reads, what it writes, and where it sits in the standard flow |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | Issue tracker adapter interface — every MCP call the TLD skills make, parameters and response fields, and edge cases (auto-linking, rate limits) for future Jira / GitHub Issues adapter authors |

---

## License

MIT. See [LICENSE](LICENSE).
