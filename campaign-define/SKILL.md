---
name: campaign-define
description: |
  Create a new campaign configuration file for project-level settings. Use this skill whenever the user says
  "campaign-define", "campaign define", "create campaign", "new campaign", "define campaign", "new project config",
  "set up a new project", or wants to create a fresh campaign config with project name, team, playbook path,
  ticket prefix, stack, and commit format. Use on first install when no campaign exists, or whenever the user
  wants to add another campaign to their configuration.
---

# Campaign Define

You are creating a new campaign configuration file. A campaign captures all project-specific settings (project name, team slug, ticket prefix, playbook path, stack directories, commit format) so the other skills can operate on the right project without hardcoding values.

Campaigns live at `~/.claude/skills/campaigns/`. Each campaign is one markdown file named `{kebab-case-name}.md`. An `active.md` file in the same directory holds the name of the currently active campaign.

## Process

### 1. Ensure the campaigns directory exists

Check if `~/.claude/skills/campaigns/` exists. If not, create it along with an empty `active.md` placeholder file.

### 2. Collect the campaign name

Use AskUserQuestion to ask for the project name. The value must be non-empty. Reject and re-ask if the user provides an empty name.

Compute the kebab-case filename from the project name:
- Lowercase everything
- Replace spaces with dashes
- Strip any character that is not a letter, digit, or dash
- Collapse multiple dashes into one

### 3. Check for collision

Check if `~/.claude/skills/campaigns/{kebab-name}.md` already exists. If it does, stop and tell the user:

> A campaign with that name already exists. Run `/campaign-edit` to modify it, or pick a different name by running `/campaign-define` again.

Do NOT overwrite.

### 4. Collect the remaining fields

Walk through the schema fields in order. Use AskUserQuestion for each one. Enum fields get multi-choice options. Free-text fields get open-ended AskUserQuestion prompts.

**Required (must be non-empty, re-ask if empty):**
- Ticket prefix (e.g., `ACME`, `PROJ`, `XYZ`)

**Enum:**
- Issue tracker: options are `Linear`, `Jira`, `GitHub Issues`, `Other`

**Free-text (blank allowed for optional ones):**
- Team slug (e.g., `acme-engineering`)
- Playbook path (e.g., `docs/EXECUTION_PLAYBOOK.md`)
- Backend directory (e.g., `backend`)
- Frontend directory (e.g., `frontend`)
- Database description (e.g., `Supabase local at 127.0.0.1:54322`)
- Changelog path (e.g., `backend/CHANGE_LOG.md`)
- Commit pattern (e.g., `feat(ACME-XXX): title`)
- Co-author line (optional, can be blank)

### 5. Write the campaign file

Write the file to `~/.claude/skills/campaigns/{kebab-name}.md` using this exact schema:

```markdown
# Campaign: {project name}

## Project
- Name: {project name}
- Issue tracker: {tracker}
- Team slug: {team slug}
- Ticket prefix: {prefix}

## Playbook
- Path: {playbook path}
- Format: markdown with steps to tickets structure

## Stack
- Backend directory: {backend}
- Frontend directory: {frontend}
- Database: {database}
- Changelog path: {changelog}

## Commit format
- Pattern: {pattern}
- Co-author: {co-author or blank}
```

### 6. Ask if this should be the active campaign

Use AskUserQuestion: "Set '{project name}' as the active campaign now?" with options:
- **Yes** — make this the active campaign
- **No** — leave the current active campaign in place

If yes: write the kebab-name (plain text, no extension, no newline at end if possible) to `~/.claude/skills/campaigns/active.md`, overwriting any existing content.

### 7. Output

Report:
- The file path created
- Whether it was set as active
- A short summary of the fields captured (project name, ticket prefix, playbook path)

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 8. Present options

---

**What's next?**

> **1.** /campaign-show — display the new campaign's fields
>    Best for: confirm everything saved correctly

> **2.** /campaign-edit — edit a field in the new campaign
>    Best for: you spotted something to tweak immediately

> **3.** /campaign-define — create another campaign
>    Best for: setting up multiple projects in one sitting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
