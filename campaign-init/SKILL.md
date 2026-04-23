---
name: campaign-init
description: |
  Scaffold a per-repo `.tld/campaign.md` configuration file for the TLD skills framework.
  Use this skill whenever the user says "campaign-init", "campaign init", "scaffold campaign",
  "set up this repo", "new project config", or when a TLD skill fails because no campaign
  exists in the current repo. Creates the four required sections (Project, Test Commands,
  Stack, Commit format). Linear is the primary / recommended issue tracker; Jira, GitHub
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
- **Jira** — schema accepts it; downstream skills will need adaptation.
- **GitHub Issues** — schema accepts it; downstream skills will need adaptation.

AskUserQuestion automatically provides an "Other" option; accept any free-text value the user supplies there.

If the user picks anything other than `Linear`, immediately print this advisory before moving on:

> **Heads up:** The skills framework was built against Linear MCP. Other trackers are accepted in the schema but downstream TLD skills call Linear tools by name and will need manual adaptation. See LIMITATIONS.md.

**Project name** — free text, non-empty (re-ask if empty). In the prompt, explain that this is both the display name AND the identifier the framework will use to look the project up in the chosen tracker. Examples: for Linear it's the Linear project name (e.g. "Adventure Skills"); for Jira it would be the project key (e.g. "PROJ"); for GitHub Issues it would be the `owner/repo` slug.

**Team** — free text. Label the prompt "Linear team" when tracker=Linear, otherwise "Team / workspace". Blank is allowed.

**Ticket prefix** — free text, non-empty (re-ask if empty). Hint: "The string before the dash in ticket IDs, e.g. `2ND` for tickets like `2ND-199`."

### 3. Collect the Test Commands section

AskUserQuestion for each; all three allow blank (the user may not have a command for every slot):

- **Backend** — e.g. `cd backend && npm run test:run`
- **Frontend** — e.g. `cd frontend-next && npm test`
- **Full** — used by `/tld-gate` for regression; e.g. `cd frontend-next && npm test && cd ../backend && npm run test:run`

### 4. Collect the Stack section

AskUserQuestion for each; all blank-allowed:

- **Backend directory** — e.g. `backend`
- **Frontend directory** — e.g. `frontend-next`
- **Database** — free text, e.g. `Supabase local at 127.0.0.1:54321`
- **Changelog path** — e.g. `CHANGELOG.md` or `backend/CHANGE_LOG.md`

### 5. Collect the Commit format section

- **Pattern** — non-empty (re-ask if empty). Hint: substitute the user's actual prefix into a sample like `feat/({PREFIX}-XXX): title`, so if they entered `2ND` as the prefix, the hint reads `feat/(2ND-XXX): title`.
- **Co-author** — blank-allowed. Example: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

### 6. Bootstrap workspace labels (Linear only)

If tracker ≠ Linear, skip this step entirely. Remember the tracker so you can note the skip in the output.

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

If a `create_issue_label` call fails partway through the six, keep going for the rest — the step is additive and rerunning `/campaign-init` (or re-running this step manually) will complete the missing ones.

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
- Full: {Full test command}

## Stack
- Backend directory: {Backend directory}
- Frontend directory: {Frontend directory}
- Database: {Database}
- Changelog path: {Changelog path}

## Commit format
- Pattern: {Commit pattern}
- Co-author: {Co-author}
```

Do NOT add a `## Milestones` section, an `## Active` section, or any other section beyond these four. Those sections do not exist in the v0.1 schema — Linear is the source of truth for milestone structure and ticket order.

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

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
