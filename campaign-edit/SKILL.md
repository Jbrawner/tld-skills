---
name: campaign-edit
description: |
  Edit a field in the currently active campaign's configuration file. Use this skill whenever the user says
  "campaign-edit", "campaign edit", "edit campaign", "update campaign", "change field", "update project config",
  or wants to modify a setting in the active campaign. Only edits existing fields in the active campaign.
  For switching which campaign is active, use `/campaign-switch` instead.
---

# Campaign Edit

You are editing a field in the active campaign configuration. Only the currently active campaign can be edited by this skill. To edit a different campaign, the user must first switch to it with `/campaign-switch`.

## Process

### 1. Find the active campaign

Read `~/.claude/skills/campaigns/active.md`. If the file is missing or empty, tell the user:

> No active campaign is set. Run `/campaign-define` to create one, or `/campaign-switch` to pick an existing one.

Stop.

### 2. Load the active campaign file

Read `~/.claude/skills/campaigns/{active-name}.md`. If the file does not exist, flag the inconsistency and direct the user to `/campaign-switch` or `/campaign-define`. Stop.

Parse the schema fields from the file.

### 3. Display current fields

Show the user every current value so they can see what's there before picking a field:

```
## Active Campaign: {project name}

| Field | Current value |
|---|---|
| Project name | {value} |
| Issue tracker | {value} |
| Team slug | {value} |
| Ticket prefix | {value} |
| Playbook path | {value} |
| Backend directory | {value} |
| Frontend directory | {value} |
| Database | {value} |
| Changelog path | {value} |
| Commit pattern | {value} |
| Co-author | {value or "(none)"} |
```

### 4. Pick a field to edit

Use AskUserQuestion with the field names as options. Include the current value in each option's description so the user can see at a glance what they're about to edit.

If there are more than 4 fields (there are 11), present them in two AskUserQuestion batches or group by category (Project / Playbook / Stack / Commit). Pick a grouping that keeps each AskUserQuestion at 2-4 options.

**Recommended grouping:**
1. First AskUserQuestion: "Which category of field?" with options:
   - Project (name, tracker, team slug, ticket prefix)
   - Playbook (path)
   - Stack (backend, frontend, database, changelog)
   - Commit format (pattern, co-author)
2. Second AskUserQuestion: present the specific fields in the chosen category as options.

### 5. Collect the new value

Use AskUserQuestion for the new value:
- For free-text fields: present an open-ended question.
- For the **Issue tracker** field specifically, present the same enum `/campaign-init` uses, in this order (AskUserQuestion automatically adds "Other" for free-text):
  - **Linear (Recommended)** — the framework was built against Linear MCP and ships with wired tooling.
  - **Jira** — schema accepts it; downstream skills will need adaptation.
  - **GitHub Issues** — schema accepts it; downstream skills will need adaptation.

  If the user picks anything other than `Linear`, print this advisory verbatim and then use AskUserQuestion to confirm before writing:

  > **Heads up:** The skills framework was built against Linear MCP. Other trackers are accepted in the schema but downstream TLD skills call Linear tools by name and will need manual adaptation. See LIMITATIONS.md.

  Do not block the edit. If the user confirms, proceed to write. If they decline, abort the edit and return to step 4 so they can pick a different field (or stop).

Show the current value in the question text so the user has context.

### 6. Validate

- **Project name:** must be non-empty. Reject and re-ask if empty.
- **Ticket prefix:** must be non-empty. Reject and re-ask if empty.
- All other fields: accept any value including empty (which becomes the new value).

### 7. Write the updated file back

Rewrite the campaign file with the new value replacing the old one. Preserve all other fields exactly as they were. Keep the same filename even if the project name changed (a filename rename would orphan the `active.md` pointer; renaming files is a separate operation not handled by this skill).

If the user changed the project name, note in the output that the filename was NOT changed and tell them the filename is the kebab-case of the original project name.

### 8. Confirm

Report: "Updated **{field}** in `{active campaign name}` from `{old}` to `{new}`."

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Present options

---

**What's next?**

> **1.** /campaign-edit — edit another field
>    Best for: more changes to make in this campaign

> **2.** /campaign-show — review the updated campaign
>    Best for: confirm the edit saved correctly

> **3.** /campaign-switch — change which campaign is active
>    Best for: done editing this one, move to another

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
