---
name: tld-help
description: |
  Quick reference for all TLD skills. Shows what each skill does, when to use it, and the standard flow.
  Use this skill whenever the user says "tld-help", "tld help", "what are my options", "what can I run",
  "help", or needs a reminder of the available TLD commands.
---

# TLD Help

Print the reference card below, then determine the user's current position in the flow and present context-aware options.

---

## TLD Skills Reference

### Core Flow (run in order)

| # | Skill | What it does | When to use |
|---|-------|-------------|-------------|
| 1 | `/tld-setup` | Loads next ticket from milestone + Linear | Start of every ticket |
| 2 | `/tld-write-tests` | Writes failing tests from the AC | After setup (red phase) |
| 3 | `/tld-build` | Implements code to make tests pass | After tests are written (green phase) |
| 4 | `/tld-audit` | Security + architecture review | After build, before verify (optional) |
| 5 | `/tld-run-test` | Runs tests, drift check, manual QA, commits on approval | After build or audit |
| 6 | `/tld-next` | Marks ticket Done, determines next step · may mutate next-ticket labels via override loop | After successful commit |

### Automation

**Reading the names:** the **prefix** says who lands the commit — `tld-*` = *you* control commit/push/PR (hands-on, code tickets), `npc-*` = the skill commits *for* you (hands-off, content/doc tickets). The **suffix** says how many human stops — `partial` = more stops, `full` = fewest stops the family's safety allows.

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-partial-auto` | Chains the full pipeline with 2 human gates (test-spec review + QA), commits on approval, marks Done | Code tickets you want automated but with review checkpoints |
| `/tld-full-auto` | Runs the pipeline hands-off to a verified checkpoint, then STOPS before commit and preps your manual check; only flags real problems | Code tickets you want driven to ready-to-land unattended, keeping the commit/PR in your hands |
| `/tld-pr` | Lands a verified ticket: commit → push → open PR, then stops before merge | After `/tld-full-auto`'s checkpoint (or any committed ticket) when you're ready to ship |
| `/npc-partial` | Build → STOP for manual QA on uncommitted diff → commit + tld-next on approval | Doc/content tickets where test command is `skip` and you want one QA pause |
| `/npc-full` | Build → commit → tld-next, no review pause | Doc/content tickets where test command is `skip` and you trust the build |

### Recovery + Navigation

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-align` | Fixes implementation after test failures | After `/tld-run-test` fails |
| `/tld-commit` | Commits the current ticket; asks **commit only** (stay In Progress) vs **commit and progress** (mark Done + next). No push/PR. | Per-ticket landing in a multi-ticket story; or finishing a commit after a detour |
| `/tld-pr` | Lands a verified ticket: commit → push → open PR, stops before merge | Story end — one PR for all the story's tickets |
| `/tld-skip` | Reverts to Todo (or Skipped state if Linear team has one) | When a ticket is practically blocked or out of order for today |
| `/tld-cancel` | Marks the current ticket Canceled and removes it from the milestone Order | When a ticket is no longer needed and should not be picked up again |
| `/tld-recenter` | Cuts a fresh branch off the latest default branch (detects via `origin/HEAD` → `main` → `master`); refuses if working tree is dirty | After a PR merges, before starting the next ticket |
| `/tld-save-point` | Recovers your position from milestone + Linear | Start of a new conversation |
| `/tld-dashboard` | Shows progress across all milestones and tickets | When you want the big picture |

### Planning

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/campaign-plan` | Full planning — scope, phases, and tickets, all created in Linear | Starting a new project from scratch |
| `/milestone-create` | Creates a single Linear milestone (with optional tickets + Order) | Adding one phase without the full /campaign-plan flow |
| `/milestone-sync` | Authors `## Order` sections on existing Linear milestones missing them | When /tld-setup fails because Order is missing or malformed |
| `/tld-ticket` | Creates standardized Linear tickets (feature, bug, QA, polish) | When work needs to be tracked |

### Boundaries + Side Channel

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-gate` | Full regression at milestone boundaries | When `/tld-next` says a milestone is complete |
| `/tld-side-quest` | Small fix in an isolated worktree | Polish, minor fix, or config tweak |

### Campaign Config

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/campaign-init` | Scaffolds `.tld/campaign.md` with the four required sections | Setting up TLD in a new repo |
| `/campaign-show` | Displays the campaign's four sections plus an optional Linear snapshot | When you need to see the current project config |
| `/campaign-edit` | Edits a single field in `.tld/campaign.md` | Updating a test command, stack path, or commit pattern |
| `/campaign-validate` | Schema-only check (no Linear calls) | Offline, or right after `/campaign-edit` to confirm the file parses |
| `/campaign-test` | Pre-flight connection check for the campaign (schema + Linear reachability) | Before `/tld-setup`; after `/campaign-init` |
| `/campaign-remove` | Deletes `.tld/campaign.md` (and the `.tld/` dir if empty) | Tearing down TLD config in this repo |
| `/campaign-portless` | Wires portless so this repo or worktree gets a stable `<name>.localhost:1355` URL (installs portless / trusts certs on first run, then per-project: picks a name + free port, writes `.claude/launch.json`, symlinks worktree `.env.local`, registers the alias) | First time on a machine, or first time in a new repo / worktree that needs its own dev URL |

### Meta

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-experience` | Turn a lived conversation moment into a candidate skill — drafts a SKILL.md, updates supporting docs (CHANGELOG, tld-help, README always; STANDARDS / CONTRIBUTING / LIMITATIONS / RELEASING / ADAPTERS when applicable), opens a PR | Right after a workflow you want to be a one-liner next time |
| `/tld-release` | Cut a new tagged release: bumps CHANGELOG, opens a release PR, publishes the GitHub Release after merge, watches the marketplace auto-bump workflow. Optional arg: `patch` / `minor` / `major` / `vX.Y.Z` | When you're ready to ship a new version of the plugin to `/plugin update tld@claude-skills` users |

### Standard Flow

```
/tld-setup → /tld-write-tests → /tld-build ──→ /tld-audit ──→ /tld-run-test → /tld-next ──→ /tld-setup (next ticket)
     |                              │              (optional)         │              │
     │                              ▼                                  │ (fail)       └──→ /tld-gate {milestoneId}
     ├─→ /tld-partial-auto (all-in-one, 2 gates, commits on approval) ▼                    (when milestone is complete)
     └─→ /tld-full-auto (hands-off → verified checkpoint) ─→ your manual check ─→ /tld-commit (per ticket)  ⟶  /tld-pr (PR at story end)
                                                                  /tld-align ──→ retry
```

Two ways to automate a code ticket. `/tld-partial-auto` chains write-tests → build → audit → run-test → next inside one skill with two hard stops (RED review, QA gate) and commits on approval. `/tld-full-auto` runs the same pipeline hands-off, stops only on real problems, and ends at a verified, uncommitted checkpoint — you do your manual check, then land it: in a multi-ticket story, `/tld-commit` each ticket (choose "commit and progress" to mark it Done and advance) and run `/tld-pr` once at the end to open a single PR for the branch; or use `/tld-pr` directly to commit + push + PR a standalone ticket (it stops before merge). The standalone `/tld-audit` step on the manual path is optional but recommended after backend / migration / auth changes.

### Tips
- Type the option number (1–N depending on the block) at any "What's next?" prompt to proceed
- `/tld-save-point` in a new conversation replaces the old /compact paste
- `/tld-side-quest` keeps your main context clean
- `/tld-audit` is automatically marked **(Recommended)** by `/tld-setup` when the ticket touches the backend, has migration/auth/RLS in scope, or names an endpoint — run it then for a security pass before verify
- `/tld-dashboard` for a quick progress check anytime
- `/tld-help` doesn't list itself in the reference card above (it's the card)

---

After printing the reference card, check the conversation context and git state to determine the user's current position, then present context-aware options:

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

**If there's an active ticket with uncommitted changes:**

---

**What's next?**

> **1.** /tld-commit — commit pending changes
>    Best for: resume committing after a detour

> **2.** /tld-dashboard — see overall progress
>    Best for: orient yourself before deciding

> **3.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before committing

Type **1**, **2**, or **3** to proceed.

**If there's an active ticket in progress (no uncommitted changes):**

---

**What's next?**

> **1.** /tld-save-point — pick up where you left off
>    Best for: resume the active ticket

> **2.** /tld-dashboard — see overall progress
>    Best for: want the big picture before diving in

> **3.** /tld-side-quest — handle a quick fix first
>    Best for: noticed polish worth handling before resuming

Type **1**, **2**, or **3** to proceed.

**If no context is available:**

---

**What's next?**

> **1.** /tld-save-point — figure out where you are
>    Best for: starting a fresh conversation, recover context

> **2.** /tld-dashboard — see overall progress
>    Best for: want the big picture first

> **3.** /tld-ticket — plan a new ticket
>    Best for: spotted work to track before diving in

Type **1**, **2**, or **3** to proceed.
