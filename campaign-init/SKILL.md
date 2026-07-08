---
name: campaign-init
description: |
  Scaffold a per-repo `.tld/campaign.md` configuration file for the TLD skills framework.
  Use this skill whenever the user says "campaign-init", "campaign init", "scaffold campaign",
  "set up this repo", "new project config", or when a TLD skill fails because no campaign
  exists in the current repo. Creates the four required sections (Project, Test Commands,
  Stack, Commit format) and can optionally scaffold the v0.2 sections (Pipelines, Allowed
  statuses); omitting them yields today's fixed default flow. Canonical schema:
  docs/CAMPAIGN_SCHEMA.md. Linear is the primary / recommended issue tracker; Jira, GitHub
  Issues, and Other are accepted in the schema but downstream TLD skills are Linear-wired
  and will need manual adaptation for non-Linear configs.
---

# Campaign Init

You are scaffolding the per-repo `.tld/campaign.md` file that the TLD skills framework reads for project-specific configuration. The file lives at `{cwd}/.tld/campaign.md` — one per repo, gitignored. Each repo gets its own file; there is no global active campaign to switch between.

The file captures four sections: Project (tracker + name + team + prefix), Test Commands (backend / frontend / full), Stack (directories and database), and Commit format. Structure and ticket order live in the issue tracker, not here — this file has no Milestones or Active section.

## Process

### 1. Check the target path

Check whether `{cwd}/.tld/campaign.md` already exists. If it does, stop and tell the user:

> A campaign already exists at `.tld/campaign.md` in this repo. Run `/campaign-edit` to modify it, or delete the file manually if you want to start over.

Do NOT overwrite.

If `{cwd}/.tld/` does not exist yet, note that — you'll create it in step 7.

### 2. Collect the Project section

Walk the four fields in order using AskUserQuestion.

**Issue tracker** — enum. Options in this order:
- **Linear (Recommended)** — the framework was built against Linear MCP and ships with wired tooling.
- **Jira** — supported via the Atlassian MCP connector (Jira Cloud). See docs/JIRA.md.
- **GitHub Issues** — schema accepts it; downstream skills will need adaptation.

AskUserQuestion automatically provides an "Other" option; accept any free-text value the user supplies there.

If the user picks `Jira`, print this note before moving on:

> **Jira selected.** The TLD skills branch on the tracker field and follow the Jira mapping in docs/JIRA.md (Jira Cloud via the Atlassian MCP connector). Milestone = Story, ticket = Sub-task, order = Jira rank, status by category. The Atlassian connector must be authenticated in the session before the ticket-touching skills run. A couple of Jira behaviors differ from Linear (free-text labels with no create step, status changes via workflow transitions) — see docs/JIRA.md.

If the user picks `GitHub Issues` or a free-text `Other` value (anything other than `Linear` or `Jira`), immediately print this advisory before moving on:

> **Heads up:** Only Linear and Jira are wired end to end. Other trackers (GitHub Issues, anything else) are accepted in the schema but **unimplemented** — the TLD pipeline resolves tracker calls for Linear (docs/ADAPTERS.md) and Jira (docs/JIRA.md) only, and will need adapter work for anything else (manual ticket-status flips, hand-rolled label workflow, etc.). It's still worth the try if you're already invested in another tracker — most of the framework's value (hard-stop discipline, drift checks, side-quest isolation, the campaign file itself) works regardless of where tickets live. See LIMITATIONS.md and docs/ADAPTERS.md for the full surface a future adapter would need to cover.

**Project name** — free text, non-empty (re-ask if empty). In the prompt, explain that this is both the display name AND the identifier the framework will use to look the project up in the chosen tracker. Examples: for Linear it's the Linear project name (e.g. "Adventure Skills"); for Jira it's the display project name (the Jira project key is taken from the Ticket prefix field below, e.g. prefix "PROJ" for tickets like "PROJ-123"); for GitHub Issues it would be the `owner/repo` slug.

**Team** — free text. Label the prompt "Linear team" when tracker=Linear, otherwise "Team / workspace". Blank is technically allowed, but if the user leaves it blank print this warning before moving on:

> ⚠️ **Heads up:** Leaving Team blank will fail `/campaign-validate` (which requires a non-empty Team) and Linear team-existence checks in `/campaign-test`. Recommend filling it in now to avoid an error in the next setup steps.

**Ticket prefix** — free text, non-empty (re-ask if empty). Hint: "The string before the dash in ticket IDs, e.g. `2ND` for tickets like `2ND-199`."

### 3. Collect the Test Commands section

AskUserQuestion for each; all four allow blank (the user may not have a command for every slot):

- **Backend** — e.g. `cd backend && npm run test:run`
- **Frontend** — e.g. `cd frontend-next && npm test`
- **Landing** — the marketing / SEO site's test command, if distinct from Frontend; e.g. `cd landing && npm test`
- **Full** — used by `/tld-gate` for regression; e.g. `cd frontend-next && npm test && cd ../backend && npm run test:run`

### 4. Collect the Stack section

AskUserQuestion for each; all blank-allowed:

- **Backend directory** — e.g. `backend`
- **Frontend directory** — e.g. `frontend-next`
- **Landing directory** — the marketing / SEO site's directory, if distinct from Frontend; e.g. `landing` or `marketing-site`
- **Database** — free text, e.g. `Supabase local at 127.0.0.1:54321`
- **Changelog path** — e.g. `CHANGELOG.md` or `backend/CHANGE_LOG.md`

### 5. Collect the Commit format section

- **Pattern** — non-empty (re-ask if empty). Hint: substitute the user's actual prefix into a sample like `feat/({PREFIX}-XXX): title`, so if they entered `2ND` as the prefix, the hint reads `feat/(2ND-XXX): title`.
- **Co-author** — blank-allowed. Example: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### 5b. Optional v0.2 sections (Pipelines, Allowed statuses)

These two sections are **optional**. Omitting them is the default and yields today's fixed flow — the
written file is byte-identical to a v0.1 scaffold. Only scaffold them if the user asks. Canonical shapes:
docs/CAMPAIGN_SCHEMA.md.

Use AskUserQuestion: "Scaffold the optional v0.2 pipeline/status config? (Default: no — use the built-in
standard flow.)" with options:

- **No, use defaults (Recommended)** — write only the four required sections. This is the common case.
- **Yes, scaffold `## Pipelines`** — include a starter Pipelines block (the built-in leaf `default` pipeline, commented as editable).
- **Yes, scaffold `## Allowed statuses`** — include the default status list (`In Progress`, `In PR`, `In Release`, `Done`).

The user may pick both "Yes" options. Record which sections to append; step 7 writes them after the four
required sections. If the user takes the default, append nothing.

### 6. Bootstrap workspace labels

**If tracker = Jira:** skip label creation. Jira labels are free-text and exist implicitly the moment they are first applied to an issue — there is no label registry to bootstrap and no `create_issue_label` equivalent (see docs/JIRA.md). The seven label *names* below are still what the pipeline applies; they just need no setup. Note the skip in the output.

**If tracker is any other non-Linear value:** skip this step entirely. Remember the tracker so you can note the skip in the output.

If tracker = Linear, the TLD framework needs seven workspace-level labels. They may already exist from a previous `/campaign-init` run; this step is idempotent.

Call `list_issue_labels` with no team filter to get workspace labels. Build the set of existing label names (case-sensitive).

For each of the seven required labels below that is NOT in the existing set, call `create_issue_label` with the exact name, color, and description:

| Name | Color | Description |
|---|---|---|
| `model:sonnet` | `#5E6AD2` | Recommended model for this ticket: Claude Sonnet. Default. |
| `model:opus` | `#7B68EE` | Recommended model for this ticket: Claude Opus. Use for high-risk or pattern-setting work. |
| `model:haiku` | `#9B59B6` | Recommended model for this ticket: Claude Haiku. Use for cheap, mechanical work. |
| `effort:low` | `#26B87A` | Recommended reasoning effort: low. Mechanical edits, grep-replace, short additions. |
| `effort:medium` | `#F2994A` | Recommended reasoning effort: medium. Normal skill authoring, structured writing. |
| `effort:high` | `#EB5757` | Recommended reasoning effort: high. Architectural design, pattern-setting work, contracts. |
| `side-quest` | `#14B8A6` | Small polish or quick-fix work handled via `/tld-side-quest` outside the main TLD flow. |

Track how many you created vs. how many already existed. You'll report the counts in step 8.

If a `create_issue_label` call fails partway through the seven, keep going for the rest — the step is additive and rerunning `/campaign-init` (or re-running this step manually) will complete the missing ones.

### 7. Write the file

Create `.tld/` in the current working directory if it does not exist.

Write `{cwd}/.tld/campaign.md` with this exact content. Substitute each `{field}` with the collected value. Leave a blank for any optional field the user left blank (e.g., `- Backend: ` with nothing after the colon is fine).

```markdown
# Campaign: {Project name}

## Project
- Issue tracker: {tracker}
- Project name: {Project name}
- Team: {Team}
- Ticket prefix: {prefix}

## Test Commands
- Backend: {Backend test command}
- Frontend: {Frontend test command}
- Landing: {Landing test command}
- Full: {Full test command}

## Stack
- Backend directory: {Backend directory}
- Frontend directory: {Frontend directory}
- Landing directory: {Landing directory}
- Database: {Database}
- Changelog path: {Changelog path}

## Commit format
- Pattern: {Commit pattern}
- Co-author: {Co-author}
```

**Then append any optional v0.2 sections the user opted into in step 5b**, after `## Commit format`, using the exact shapes in docs/CAMPAIGN_SCHEMA.md:

```markdown
## Pipelines

```yaml
pipelines:
  default:
    - skill: tld-setup
    - skill: tld-write-tests
    - skill: tld-build
    - skill: tld-audit
    - skill: tld-run-test
    - skill: tld-commit
    - skill: tld-writeup
    - skill: tld-next
```

## Allowed statuses
- In Progress
- In PR
- In Release
- Done
```

The allowed section headings are exactly the six in the v0.2 schema: `Project`, `Test Commands`, `Stack`, `Commit format`, `Pipelines`, `Allowed statuses`. Do NOT add a `## Milestones` section, an `## Active` section, or any other section outside that set — the tracker is the source of truth for milestone structure and ticket order. If the user did not opt into the optional sections in step 5b, write only the four required sections (byte-identical to the v0.1 scaffold).

**Ensure `.tld/` is gitignored.** The campaign file is per-repo local config and should never be committed. After writing it, update the repo's ignore list:

1. Check if `{cwd}/.git/` exists. If not, skip this sub-step silently — not a git repo, nothing to ignore.
2. Read `{cwd}/.gitignore` if present.
3. Decide the action:
   - **No `.gitignore`:** create it with the block below.
   - **`.gitignore` exists and already contains a line matching `^\s*\.tld/?\s*$` (and not commented out):** skip — already ignored.
   - **`.gitignore` exists but `.tld/` is not listed:** append the block below, separated from existing content by a blank line if the file is non-empty.

   Block to write or append:

   ```
   # TLD skill config (per-repo, local only)
   .tld/
   ```

4. Record the outcome (`created`, `appended`, `already-ignored`, or `skipped — not a git repo`) so you can report it in step 8.

This step is idempotent. Rerunning `/campaign-init` after the skill matures will find `.tld/` already ignored and skip.

### 8. Output

Report to the user:

- **Path:** the absolute or repo-relative path written (e.g., `.tld/campaign.md`).
- **Tracker:** which tracker was picked. If non-Linear, repeat the hand-holding advisory from step 2.
- **Gitignore:** outcome from step 7, one of: "Added `.tld/` to `.gitignore`", "Created `.gitignore` with `.tld/`", "`.tld/` already gitignored — skipped", or "Not a git repo — gitignore step skipped".
- **Label bootstrap:** either "Created N workspace labels; M already existed" (Linear) or "Label bootstrap skipped — tracker is {X}, not Linear" (non-Linear).
- **Summary:** one line echoing project name, ticket prefix, and tracker, so the user can spot a typo immediately.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Present options

Pick the recommendation based on what the user has told you during the flow:

- If the user indicated they already have milestones + tickets in the tracker (e.g., mentioned an existing project, said "I just need to set up the file"), mark `/tld-setup` as **(Recommended)**.
- Otherwise, mark `/campaign-plan` as **(Recommended)** — starting from scratch needs structure first.

Never mark more than one option as Recommended.

---

**What's next?**

> **1.** /campaign-plan — plan out milestones and tickets from scratch in the tracker
>    Best for: no structure exists yet; you're setting up a new project end to end

> **2.** /milestone-create — add a single milestone with its tickets
>    Best for: you already have some structure and just need to add one more milestone

> **3.** /tld-setup — jump into the first ticket
>    Best for: the tracker already has milestones + tickets ready to work

> **4.** /campaign-portless — give this repo a stable `<name>.localhost:1355` URL for its dev server
>    Best for: finish local-dev setup so port collisions and worktree-URL confusion don't bite later

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
