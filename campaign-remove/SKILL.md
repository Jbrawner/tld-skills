---
name: campaign-remove
description: |
  Delete a campaign configuration file. Use this skill whenever the user says "campaign-remove",
  "campaign remove", "remove campaign", "delete campaign", "kill campaign", or wants to remove an old
  project config they no longer need. Refuses to delete the currently active campaign (user must
  switch away first). Requires explicit confirmation before deletion.
---

# Campaign Remove

You are deleting a campaign configuration file. This is a destructive operation. The currently active campaign cannot be deleted by this skill until the user switches to a different one first. Every deletion requires explicit confirmation.

## Process

### 1. Check for campaigns directory

Check if `~/.claude/skills/campaigns/` exists. If not, tell the user there are no campaigns to remove and stop.

### 2. List all campaigns

Find all `*.md` files in `~/.claude/skills/campaigns/` excluding `active.md`. Extract the filename minus `.md`.

### 3. Handle edge cases

- **No campaigns found:** Tell the user there are no campaigns to remove. Stop.

### 4. Identify the active campaign

Read `~/.claude/skills/campaigns/active.md` to know which campaign is active. This one is NOT deletable in this skill invocation.

### 5. Ask the user to pick one to remove

Use AskUserQuestion with the campaign names as options. In each option's description, note the key fields (e.g., "ticket prefix: ACME" or "project name: Main Character"). For the active campaign, include "(currently active)" in its description so the user knows it can't be removed from here without switching first.

### 6. Refuse deletion of the active campaign

If the user picks the currently active campaign, refuse and tell them:

> Cannot delete the active campaign `{name}`. Run `/campaign-switch` first to switch to a different campaign, then run `/campaign-remove` again.

Stop without deleting anything.

### 7. Require explicit confirmation

Use AskUserQuestion with a yes/no confirmation:

> Permanently delete the campaign `{name}`? This cannot be undone.

Options:
- **Yes, delete** — proceed with deletion
- **No, cancel** — do not delete

If the user picks "No, cancel", stop without deleting. Report: "Cancelled. No campaign was removed."

### 8. Delete the file

Only after the user explicitly confirms with "Yes, delete": delete the file at `~/.claude/skills/campaigns/{name}.md`.

### 9. Confirm

Report: "Deleted campaign `{name}`."

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 10. Present options

---

**What's next?**

> **1.** /campaign-show — review what's left
>    Best for: confirm the deletion and see remaining campaigns

> **2.** /campaign-remove — delete another campaign
>    Best for: cleaning up multiple old configs

> **3.** /campaign-define — create a new campaign
>    Best for: replacing the deleted one with a fresh config

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
