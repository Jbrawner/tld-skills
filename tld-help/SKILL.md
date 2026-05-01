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
| 6 | `/tld-next` | Marks ticket Done, determines next step | After successful commit |

### Automation

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-auto` | Chains the full pipeline with 2 gates (red review, QA) | When tickets are small and straightforward |
| `/npc-partial` | Build → STOP for manual QA on uncommitted diff → commit + tld-next on approval | Doc/content tickets where test command is `skip` and you want one QA pause |
| `/npc-full` | Build → commit → tld-next, no review pause | Doc/content tickets where test command is `skip` and you trust the build |

### Recovery + Navigation

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-align` | Fixes implementation after test failures | After `/tld-run-test` fails |
| `/tld-commit` | Picks up a pending commit after a detour | After a side quest when changes are uncommitted |
| `/tld-skip` | Reverts the current ticket to Todo and finds the next one | When a ticket is practically blocked or out of order for today |
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
| `/campaign-test` | Pre-flight connection check for the campaign | Before `/tld-setup`; after `/campaign-init` |

### Meta

| Skill | What it does | When to use |
|-------|-------------|-------------|
| `/tld-experience` | Turn a lived conversation moment into a candidate skill — drafts a SKILL.md, updates the four house-style docs, opens a PR | Right after a workflow you want to be a one-liner next time |

### Standard Flow

```
/tld-setup → /tld-write-tests → /tld-build → /tld-run-test → /tld-next
     |                                 |              |
     +--→ /tld-auto (all-in-one) ------+    (fail) → /tld-align → retry
                                        |
                                   /tld-audit (optional)
```

### Tips
- Type just **1**, **2**, **3**, or **4** at any "What's next?" prompt to proceed
- `/tld-save-point` in a new conversation replaces the old /compact paste
- `/tld-side-quest` keeps your main context clean
- `/tld-audit` is optional but recommended for new endpoints or tables
- `/tld-dashboard` for a quick progress check anytime

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
