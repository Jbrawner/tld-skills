---
name: campaign-show
description: |
  Display this repo's `.tld/campaign.md` configuration — all four sections (Project, Test Commands, Stack,
  Commit format) — plus an optional Linear snapshot showing milestone names and progress. Use this skill
  whenever the user says "campaign-show", "campaign show", "show campaign", "what campaign am I on",
  "view campaign", "current project", or wants to see the per-repo project configuration. Read-only;
  does not modify any files.
---

# Campaign Show

You are displaying the per-repo campaign configuration at `{cwd}/.tld/campaign.md`. This skill is **read-only**. No files are modified.

## Process

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run `/campaign-init` to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.

### 2. Display the four sections

Print the parsed values in this format. Render any blank field as `(blank)`:

```
## Campaign: {Project name}

### Project
- Issue tracker: {tracker}
- Project name: {Project name}
- Team: {Team}
- Ticket prefix: {prefix}

### Test Commands
- Backend: {backend}
- Frontend: {frontend}
- Landing: {landing}
- Full: {full}

### Stack
- Backend directory: {backend dir}
- Frontend directory: {frontend dir}
- Landing directory: {landing dir}
- Database: {database}
- Changelog path: {changelog}

### Commit format
- Pattern: {pattern}
- Co-author: {co-author}
```

### 3. Linear snapshot (optional, best-effort)

If **Issue tracker** is not `Linear`, skip this step silently. Do not print a snapshot block, do not print a "skipped" note.

If **Issue tracker** is `Linear`, call `list_milestones` with `project: {Project name}` (from the Project section you just parsed).

- On success, print a `### Linear snapshot` block listing `{milestone name} — {progress}%` for each milestone, one per line. If `list_milestones` returns zero milestones, print `(no milestones yet)` under the heading.
- On any failure (Linear unreachable, project not found, auth error, etc.), do NOT hard-fail the skill. Print `### Linear snapshot` followed by a single line: `Linear snapshot unavailable: {short reason}`. Move on.

The snapshot is read-through from Linear; nothing is cached locally and nothing is written back to the file.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 4. Present options

---

**What's next?**

> **1.** /campaign-edit — edit a field in the campaign
>    Best for: update a value that's out of date

> **2.** /tld-setup — jump into the next ticket
>    Best for: config looks right, back to work

> **3.** /campaign-init — scaffold a campaign in another repo
>    Best for: setting up a different project

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
