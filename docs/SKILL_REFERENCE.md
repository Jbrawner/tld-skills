# TLD Skill Reference

This document is the authoritative reference for all skills in the Adventure Skills repo.

**Architecture summary:** One `.tld/campaign.md` file per repo holds static project config (project pointer, test commands, stack paths, commit format). It holds no runtime state. All structure (milestone ordering, ticket sequence) and runtime state (what's In Progress, what's Done) lives in Linear.

---

## Standard Flow

```
/campaign-init (or /campaign-plan for a new project)
        │
        ▼  (if tickets already exist in Linear without Order sections)
/milestone-sync
        │
        ▼
/tld-setup ──────────────────────────────────────────────┐
        │                                                 │
        ▼                                                 │
  ┌── Ticket loop ──────────────────────────────────┐    │
  │  /tld-write-tests                               │    │
  │       ↓                                         │    │
  │  /tld-build                                     │    │
  │       ↓                                         │    │
  │  /tld-run-test                                  │    │
  │       ↓                                         │    │
  │  /tld-next ─── more tickets? ──────────────────┘│    │
  │       │                                          │    │
  │       └── last ticket in milestone               │    │
  └──────────────────────────────────────────────────┘    │
        │                                                 │
        ▼                                                 │
   /tld-gate                                             │
        │                                                 │
        └── next milestone ──────────────────────────────┘
```

---

## Context Recovery

After `/clear`, run `/tld-setup` to resume. It reads the In-Progress ticket from Linear — no local state file is consulted.

- **Exactly one In-Progress ticket:** resumes that ticket automatically.
- **Zero or multiple In-Progress tickets:** run `/tld-save-point` to disambiguate.

`.tld/campaign.md` holds **only static config** (Project, Test Commands, Stack, Commit format). It does not hold runtime state — no Active section, no Milestones section.

---

## Campaign Skills

Per-repo skills that read or write `.tld/campaign.md`.

| Skill | Purpose | When to use | Reads | Writes | Flow position |
|-------|---------|-------------|-------|--------|---------------|
| `/campaign-init` | Scaffold `.tld/campaign.md` in the current repo | Starting a new project in this repo, or when a TLD skill fails because no campaign exists | Nothing | `.tld/campaign.md` (creates) | Before anything else |
| `/campaign-edit` | Edit a single field in `.tld/campaign.md` | Changing test commands, stack paths, commit format, or project pointer | `.tld/campaign.md` | `.tld/campaign.md` | Anytime config needs updating |
| `/campaign-show` | Display the current campaign config | Checking what the campaign currently says; optional Linear snapshot | `.tld/campaign.md` | Nothing | Anytime (read-only) |
| `/campaign-test` | Pre-flight connection check | Verifying the campaign is wired up correctly before starting tickets; diagnosing setup failures | `.tld/campaign.md`, Linear | Nothing (read-only; offers to create missing labels) | Before `/tld-setup` if setup problems are suspected |
| `/campaign-remove` | Delete `.tld/campaign.md` | Removing the campaign config from this repo entirely | `.tld/campaign.md` | Nothing (deletes file) | End of project or repo teardown |

---

## Planning Skills

Skills that create structure in Linear. None write to `.tld/campaign.md`.

| Skill | Purpose | When to use | Reads | Writes | Flow position |
|-------|---------|-------------|-------|--------|---------------|
| `/campaign-plan` | Full planning flow: walk scope → milestones → tickets, create everything in Linear | Starting a new project from scratch with no Linear structure yet | `.tld/campaign.md` | Linear milestones (with `## Order` sections) + Linear tickets | After `/campaign-init`, before `/tld-setup` |
| `/milestone-create` | Create a single Linear milestone with optional tickets and a populated `## Order` section | Adding one more milestone without the full planning flow | `.tld/campaign.md` | Linear milestone (with `## Order`) + Linear tickets | When one new phase needs to be added |
| `/milestone-sync` | Author `## Order` sections on existing Linear milestones that don't have them yet | Existing milestones in Linear are missing the `## Order` section that TLD skills require | `.tld/campaign.md`, existing Linear milestones | Linear milestone descriptions (`## Order` sections only) | Before `/tld-setup` when milestones exist but lack order |

---

## TLD Ticket-Level Skills

Skills that work on individual tickets within the ticket loop. All read the In-Progress ticket from Linear and the test command from `.tld/campaign.md`.

| Skill | Purpose | When to use | Reads | Writes | Flow position |
|-------|---------|-------------|-------|--------|---------------|
| `/tld-setup` | Find the next ticket, mark it In Progress, load full context | Starting any ticket — beginning of the ticket loop | `.tld/campaign.md`, Linear milestones + milestone `## Order`, Linear ticket status | Linear ticket status (→ In Progress) | Entry point for each ticket |
| `/tld-write-tests` | Write failing tests for the active ticket (RED phase) | After `/tld-setup`, before implementing | `.tld/campaign.md` (test command), Linear In-Progress ticket | Test files | After `/tld-setup` |
| `/tld-build` | Implement the code to make failing tests pass (GREEN phase) | After `/tld-write-tests` confirms RED | Test files, Linear In-Progress ticket | Implementation files | After `/tld-write-tests` |
| `/tld-run-test` | Run tests, drift check, manual QA checklist, then commit on approval | After `/tld-build`; verification gate before committing | `.tld/campaign.md`, Linear In-Progress ticket, test files | Commit (on approval) | After `/tld-build` |
| `/tld-commit` | Resume a pending commit after a side-quest detour or interrupted flow | When changes passed verification but weren't committed yet | `.tld/campaign.md`, Linear In-Progress ticket | Commit (on approval) | After `/tld-run-test` if commit was deferred |
| `/tld-align` | Fix implementation to pass failing tests | After `/tld-run-test` reports failures | Failure output, test files, Linear In-Progress ticket | Implementation files | After a `/tld-run-test` failure |
| `/tld-next` | Mark the current ticket Done, find the next ticket, output the `/tld-setup` command | After a successful commit | `.tld/campaign.md`, Linear milestone `## Order`, Linear ticket statuses | Linear ticket status (→ Done) | After `/tld-run-test` commits successfully |
| `/tld-audit` | Security and architecture review of uncommitted changes | Before committing; when suspicious of auth/RLS/validation gaps | Uncommitted diffs, Linear In-Progress ticket | Nothing (read-only) | After `/tld-build`, before `/tld-run-test` |
| `/tld-side-quest` | Run a small fix or polish task in isolation without polluting the main context | When a small unrelated task surfaces before the current ticket is done | Linear (creates/reads a ticket), local files | Local files, a commit | Anytime between phases |
| `/tld-skip` | Skip the current In-Progress ticket without marking it Done | Setting aside a ticket to come back to later | `.tld/campaign.md`, Linear milestone `## Order` | Linear ticket status (→ Todo or Skipped) | When a ticket needs to be deferred |
| `/tld-save-point` | Recover context — find the In-Progress ticket and report where you are | After `/clear` when the next-step command was lost; when multiple tickets are In Progress | `.tld/campaign.md`, Linear ticket statuses, milestone `## Order` | Nothing (read-only) | Anytime context is lost |
| `/tld-ticket` | Create a standardized Linear ticket the TLD pipeline can consume | Filing a new ticket that will flow through TLD | `.tld/campaign.md` | Linear ticket; appends ID to milestone `## Order` | Anytime a ticket needs to be created |
| `/tld-auto` | Full automated pipeline with two review gates (RED → GREEN → verify → commit) | Small, straightforward tickets you're confident about | `.tld/campaign.md`, Linear In-Progress ticket | Test files, implementation files, commit, Linear ticket status | Replaces the manual write-tests → build → run-test sequence |
| `/tld-dashboard` | Bird's-eye view of all milestones and their ticket statuses | Checking overall progress before starting a ticket; orientation after a long break | `.tld/campaign.md`, Linear milestones + `## Order` sections + ticket statuses | Nothing (read-only) | Anytime |
| `/tld-help` | Quick reference for all TLD skills | Needing a reminder of what's available and when to use it | Nothing | Nothing | Anytime |
| `/tld-recenter` | Reset the working tree to a fresh branch cut from the latest `main` | Starting a new ticket after finishing a PR; wanting a clean base | `main` branch | New git branch | Before starting a new ticket after merging |

---

## TLD Boundary Skill

| Skill | Purpose | When to use | Reads | Writes | Flow position |
|-------|---------|-------------|-------|--------|---------------|
| `/tld-gate` | Milestone boundary gate — verify all tickets in the milestone are Done, run full regression, identify the next milestone | After `/tld-next` says "no more tickets in this milestone" | `.tld/campaign.md` (Full test command), Linear milestone `## Order`, Linear ticket statuses | Nothing in Linear | After the last ticket in a milestone completes |

---

## Meta Skills

Skills that operate on the Adventure Skills repo itself rather than on a TLD project.

| Skill | Purpose | When to use | Reads | Writes | Flow position |
|-------|---------|-------------|-------|--------|---------------|
| `/tld-experience` | Turn a lived conversation moment into a candidate skill — drafts a SKILL.md, runs the standards verifier, updates CHANGELOG.md / docs/SKILL_REFERENCE.md / tld-help/SKILL.md, commits, and opens a PR | Right after a workflow with Claude that the user wants captured as a reusable command | Recent conversation, repo conventions in `STANDARDS.md` and `tld-ticket/SKILL.md` | New `~/.claude/skills/{slug}/SKILL.md`, CHANGELOG.md, docs/SKILL_REFERENCE.md, tld-help/SKILL.md, a new branch, a commit, a GitHub PR | Standalone — runs whenever a moment is worth capturing |

---

## Entry Paths

| Scenario | Flow |
|----------|------|
| New project, nothing exists | `/campaign-init` → `/campaign-plan` → `/tld-setup` |
| Have Linear tickets but no milestones | `/campaign-init` → `/milestone-create` → `/tld-setup` |
| Have Linear milestones + tickets but no `## Order` sections | `/campaign-init` → `/milestone-sync` → `/tld-setup` |
| Add one milestone to an existing project | `/milestone-create` → `/tld-setup {first-ticket-id}` |
| Resume after `/clear` (next-step command known) | paste the `/tld-setup {id}` or `/tld-gate` command from the previous session |
| Resume after `/clear` (next-step command lost) | `/tld-setup` (auto-finds In-Progress) or `/tld-save-point` |
