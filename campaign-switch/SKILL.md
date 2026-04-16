---
name: campaign-switch
description: |
  Change which campaign is currently active. Use this skill whenever the user says "campaign-switch",
  "campaign switch", "switch campaign", "change campaign", "change active campaign", "swap project",
  or wants to change which project the TLD skills operate on. Only updates the `active.md` pointer;
  does not edit campaign contents.
---

# Campaign Switch

You are changing which campaign is active. This updates the `active.md` pointer only. No campaign content is modified.

## Process

### 1. Check for campaigns directory

Check if `~/.claude/skills/campaigns/` exists. If not, tell the user:

> No campaigns exist yet. Run `/campaign-define` to create your first one.

Stop.

### 2. List all campaigns

Find all `*.md` files in `~/.claude/skills/campaigns/` excluding `active.md`. Extract the filename minus `.md` as the campaign name.

### 3. Handle edge cases

- **No campaigns found:** Tell the user there are no campaigns and direct them to `/campaign-define`. Stop.
- **Only one campaign exists:** Tell the user there is only one campaign (`{name}`), nothing to switch to. Suggest `/campaign-define` to add another. Stop.

### 4. Show the current active campaign

Read `~/.claude/skills/campaigns/active.md` to determine the current active campaign. Display it alongside the list so the user has context.

If `active.md` is empty or missing, that's okay for this skill. Display "(none)" as the current active and continue.

### 5. Ask the user to pick a new active

Use AskUserQuestion to present the list of campaigns as options. Each option's label is the campaign name. Each description is a one-line preview (e.g., "ticket prefix: ACME" if you read the file, or just "from ~/.claude/skills/campaigns/{name}.md").

If the user has more than 4 campaigns, present the first 4 with a trailing note that more exist and ask them to re-run if they want a different one. (Edge case — typical users have 1-3 campaigns.)

If the user picks the currently active campaign, tell them it's already active and stop without making changes.

### 6. Update the active pointer

Write the chosen campaign name (plain text, no extension, no newline-sensitive content) to `~/.claude/skills/campaigns/active.md`, overwriting any existing content.

### 7. Confirm

Report: "Active campaign switched from `{old}` to `{new}`." If there was no previous active, say: "Active campaign set to `{new}`."

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 8. Present options

---

**What's next?**

> **1.** /campaign-show — display the newly active campaign
>    Best for: confirm the switch worked and review the fields

> **2.** /campaign-edit — edit the newly active campaign
>    Best for: tweak a field now that you've switched

> **3.** /campaign-switch — switch to a different campaign
>    Best for: changed your mind

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
