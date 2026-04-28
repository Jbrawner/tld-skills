# Adventure Skills

A set of Claude Code skills for test-led development. Drives a project through small tickets with hard stops between phases, drift detection, side quests in isolated worktrees, and step-boundary gate checks.

This is the v0 snapshot. The full philosophy section, install instructions, getting-started walkthrough, compatibility matrix, and worked example land later in the v0.1.0 ticket plan. See [CONTRIBUTING.md](CONTRIBUTING.md) for the test-led development philosophy, hard-stop rules, and canonical shared-block definitions. See [LIMITATIONS.md](LIMITATIONS.md) for known constraints (Linear-only, Vitest/Jest assumed, Supabase local DB assumed, alpha caveats), [docs/ADAPTERS.md](docs/ADAPTERS.md) for the issue tracker adapter interface contract, and [CHANGELOG.md](CHANGELOG.md) for release history.

## Status

Pre-alpha. Currently being open-sourced from a single private project ("mAIn Character"). Not yet portable to other projects. v0.1.0 lands when the campaign system is wired in and the skills no longer hardcode project-specific identifiers.

## License

MIT. See `LICENSE`.

## Worked examples

### Worked example: `.tld/campaign.md`

This is the real campaign file for the Adventure Skills repo itself:

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
