---
name: campaign-remove
description: |
  Delete this repo's `.tld/campaign.md` configuration file. Use this skill whenever the user says
  "campaign-remove", "campaign remove", "remove campaign", "delete campaign", "kill campaign", or wants
  to remove the per-repo campaign config. Deletes the file (and the `.tld/` directory if it becomes empty).
  Requires explicit confirmation. Does NOT affect Linear tickets or milestones — only the local config file.
---

# Campaign Remove

You are deleting the per-repo campaign file at `{cwd}/.tld/campaign.md`. This is a destructive local operation. Linear tickets, milestones, and workspace labels are unaffected — only the local config file is removed. Every deletion requires explicit confirmation.

## Process

### 1. Check for the campaign file

Check whether `{cwd}/.tld/campaign.md` exists.

If it does not exist, stop and output:

> No campaign in this repo — nothing to remove.

This is a soft exit, not an error. Do not proceed past this point. Do not present the "What's next?" options.

### 2. Require explicit confirmation

Use AskUserQuestion:

> This will permanently delete `{absolute path to .tld/campaign.md}`. Continue?

Show the **absolute** path (e.g., `/Users/johnbrawner/my-repo/.tld/campaign.md`), not the relative one, so the user can see exactly which file is going away.

Options, in this order (default is No):

- **No, cancel** — do not delete
- **Yes, delete** — proceed with deletion

If the user picks "No, cancel", stop without deleting. Report: "Cancelled. No campaign was removed."

### 3. Delete the file and clean up the directory

Only after the user explicitly picks "Yes, delete":

1. Delete `{cwd}/.tld/campaign.md`.
2. Check whether `{cwd}/.tld/` is now empty. If empty, remove the directory. If the directory still contains other files or subdirectories, leave it in place — do not touch other contents.

### 4. Confirm

Report:

> Deleted `{absolute path}`. Linear tickets and milestones are unaffected — this only removed the local config file.

If `.tld/` was also removed because it became empty, add one line:

> Also removed the now-empty `.tld/` directory.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 5. Present options

---

**What's next?**

> **1.** /campaign-init — scaffold a fresh campaign in this repo
>    Best for: replacing the deleted one with a new config

> **2.** /tld-setup — work on a different repo that already has a campaign
>    Best for: moving on after removing this repo's config

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
