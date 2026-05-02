---
name: campaign-edit
description: |
  Edit a field in this repo's `.tld/campaign.md` configuration file. Use this skill whenever the user says
  "campaign-edit", "campaign edit", "edit campaign", "update campaign", "change field", "update project config",
  or wants to modify a setting in the per-repo campaign file. Edits fields across all four sections: Project,
  Test Commands, Stack, and Commit format. There is at most one campaign per repo, so no picker — the file is
  at `{cwd}/.tld/campaign.md`.
---

# Campaign Edit

You are editing a field in the per-repo campaign file at `{cwd}/.tld/campaign.md`. There is exactly one campaign per repo; no switching, no picker, no active pointer. Milestones and ticket order live in Linear (or whichever tracker is configured) — this skill does not touch them.

## Process

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run `/campaign-init` to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.
If any required field in Project (Issue tracker, Project name, Team, Ticket prefix) is missing, flag the missing field in the output below — but continue the edit flow; the user may be running `/campaign-edit` specifically to fill it in.

### 2. Display current fields

Print every current value in a single table grouped by section so the user can see what's there before picking a field:

```
## Campaign: {Project name}

### Project
| Field | Current value |
|---|---|
| Issue tracker | {value} |
| Project name | {value} |
| Team | {value} |
| Ticket prefix | {value} |

### Test Commands
| Field | Current value |
|---|---|
| Backend | {value or "(blank)"} |
| Frontend | {value or "(blank)"} |
| Landing | {value or "(blank)"} |
| Full | {value or "(blank)"} |

### Stack
| Field | Current value |
|---|---|
| Backend directory | {value or "(blank)"} |
| Frontend directory | {value or "(blank)"} |
| Landing directory | {value or "(blank)"} |
| Database | {value or "(blank)"} |
| Changelog path | {value or "(blank)"} |

### Commit format
| Field | Current value |
|---|---|
| Pattern | {value} |
| Co-author | {value or "(blank)"} |
```

### 3. Pick a category

Use AskUserQuestion: "Which category do you want to edit?" with these four options:

- **Project** — Issue tracker, Project name, Team, Ticket prefix
- **Test Commands** — Backend, Frontend, Landing, Full
- **Stack** — Backend directory, Frontend directory, Landing directory, Database, Changelog path
- **Commit format** — Pattern, Co-author

### 4. Pick a field within the category

Use AskUserQuestion again with the fields in the chosen category as options. Include the current value in each option's description so the user sees at a glance what they're editing.

### 5. Collect the new value

For the **Issue tracker** field, present the same enum `/campaign-init` uses, in this order (AskUserQuestion automatically adds "Other" for free-text):

- **Linear (Recommended)** — the framework was built against Linear MCP and ships with wired tooling.
- **Jira** — schema accepts it; downstream skills will need adaptation.
- **GitHub Issues** — schema accepts it; downstream skills will need adaptation.

If the user picks anything other than `Linear`, print this advisory verbatim and then use AskUserQuestion to confirm before writing:

> **Heads up:** The skills framework was built against Linear MCP and only Linear has been exercised end to end. Other trackers (Jira, GitHub Issues, anything else) are accepted in the schema but **untested** — the TLD pipeline calls Linear MCP tools by name and will need some massaging while you use it (manual ticket-status flips, manual `## Order` updates, hand-rolled label workflow, etc.). It's still worth the try if you're already invested in another tracker — most of the framework's value (hard-stop discipline, drift checks, side-quest isolation, the campaign file itself) works regardless of where tickets live. See LIMITATIONS.md and docs/ADAPTERS.md for the full surface a future adapter would need to cover.

Do not block the edit. If the user confirms, proceed to step 6. If they decline, abort the edit and return to step 3 so they can pick a different field (or stop).

For every other field, present an open-ended AskUserQuestion. Show the current value in the question text so the user has context.

### 6. Validate

- **Project name:** must be non-empty. Reject and re-ask if empty.
- **Ticket prefix:** must be non-empty. Reject and re-ask if empty.
- **Commit pattern:** must be non-empty. Reject and re-ask if empty.
- All other fields: accept any value including empty (which becomes the new blank value, written as `- Field: ` with nothing after the colon).

### 7. Write the updated file back

Rewrite `{cwd}/.tld/campaign.md` preserving all four sections and every other field byte-for-byte except the one line you are changing. Keep the section headers and bullet labels exactly as they are in the schema.

If the user changed **Project name**, also update the `# Campaign: {Project name}` title line at the top of the file.

Do NOT introduce new sections, re-order sections, or add fields that are not in the schema.

### 8. Confirm

Report: "Updated **{field}** in `.tld/campaign.md` from `{old}` to `{new}`."

If the old or new value was blank, render it as `(blank)` in the confirmation.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Present options

---

**What's next?**

> **1.** /campaign-edit — edit another field
>    Best for: more changes to make

> **2.** /campaign-show — review the updated campaign
>    Best for: confirm the edit saved correctly

> **3.** /tld-setup — jump into the next ticket
>    Best for: done configuring, back to work

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
