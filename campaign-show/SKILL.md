---
name: campaign-show
description: |
  Display the currently active campaign's fields and list all other campaigns. Use this skill whenever the user
  says "campaign-show", "campaign show", "show campaign", "what campaign am I on", "list campaigns",
  "view campaign", "current project", or wants to see the active project configuration. This is a read-only
  view and does not modify any files.
---

# Campaign Show

You are displaying the current campaign configuration. This skill is **read-only**. No files are modified.

## Process

### 1. Check for campaigns directory

Check if `~/.claude/skills/campaigns/` exists. If not, tell the user:

> No campaigns exist yet. Run `/campaign-define` to create your first one.

Stop.

### 2. Read the active pointer

Read `~/.claude/skills/campaigns/active.md`. If the file is missing or empty (no campaign name), tell the user:

> No active campaign is set. Run `/campaign-define` to create one, or `/campaign-switch` if campaigns already exist.

Stop.

### 3. Load the active campaign file

Load `~/.claude/skills/campaigns/{active-name}.md`. If the file does not exist but `active.md` points at it, flag the inconsistency:

> The active pointer references `{name}` but no file exists at `~/.claude/skills/campaigns/{name}.md`. Run `/campaign-switch` to pick a valid campaign or `/campaign-define` to recreate it.

Stop.

Parse the schema fields from the file (project name, issue tracker, team slug, ticket prefix, playbook path, backend directory, frontend directory, database, changelog path, commit pattern, co-author).

### 4. List other campaigns

List all other `*.md` files in `~/.claude/skills/campaigns/` excluding `active.md` and the currently active campaign's file. Use the filename minus `.md` as the display name for each.

### 5. Output

Present the information in a clear format:

```
## Active Campaign: {project name}

### Project
- Name: {name}
- Issue tracker: {tracker}
- Team slug: {slug}
- Ticket prefix: {prefix}

### Playbook
- Path: {path}

### Stack
- Backend directory: {backend}
- Frontend directory: {frontend}
- Database: {database}
- Changelog path: {changelog}

### Commit format
- Pattern: {pattern}
- Co-author: {co-author or "(none)"}

## Other Campaigns
- {name-1}
- {name-2}
```

If there are no other campaigns, say `(no other campaigns)` under the **Other Campaigns** heading.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 6. Present options

---

**What's next?**

> **1.** /campaign-edit — edit a field in the active campaign
>    Best for: update a value that's out of date

> **2.** /campaign-switch — change which campaign is active
>    Best for: switch to a different project

> **3.** /campaign-define — create a new campaign
>    Best for: setting up an additional project config

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
