---
name: campaign-test
description: |
  Pre-flight connection check for this repo's `.tld/campaign.md`. Validates the 4-section schema on every
  run, and when tracker = Linear also verifies Linear reachability, team / project existence, ticket-prefix
  match, and the seven required workspace labels. Read-mostly: the only write path is creating missing
  workspace labels, and only after an explicit user Yes via AskUserQuestion (default No). Use this skill
  whenever the user says "campaign-test", "campaign test", "test connections", "verify setup", or wants to
  diagnose a misconfigured campaign before `/tld-setup` fails.
---

# Campaign Test

You are running a pre-flight check against this repo's campaign configuration at `{cwd}/.tld/campaign.md`. Reports pass / fail for each check with remediation hints so the user can fix problems with `/campaign-edit` before `/tld-setup` runs against a broken config.

**This skill is read-mostly.** The only write path is creating missing workspace labels, and only after an explicit user Yes via AskUserQuestion (default No). Every other Linear call is read-only.

## Process

### 1. Load project config

Read `.tld/campaign.md` from the current repo root.
If the file does not exist, stop and output:
  "No campaign found in this repo. Run `/campaign-init` to scaffold one."
  Do not proceed. Do not attempt to resolve project config from any other source.
Parse the four sections: Project, Test Commands, Stack, Commit format.

### 2. Validate the 4-section schema (every run, regardless of tracker)

These checks run for every tracker. Each is an independent pass / fail reported in the `### Schema` section of the final output.

- All four sections present: `Project`, `Test Commands`, `Stack`, `Commit format`.
- `Project name` is non-empty.
- `Ticket prefix` is non-empty.
- Commit `Pattern` is non-empty.

Do not abort on schema failures — continue through the remaining checks so the user sees a full picture on a single run.

### 3. Tracker branch

Branch on `Issue tracker`:

- **Linear** — continue to step 4.
- **Jira** — run the Jira connectivity checks below, then skip to step 7 (optional local checks).
- **Anything else** — print the unsupported advisory below, then skip to step 7.

**Jira connectivity checks** (Atlassian MCP, Jira Cloud — see [docs/JIRA.md](../docs/JIRA.md)):

1. **Connector authenticated + reachable:** call `atlassianUserInfo`. On failure, retry once; on a second failure print `❌ Atlassian MCP unreachable / not authenticated — authenticate the connector and re-run /campaign-test.` and HARD STOP (skip steps 4–8). On success, hold the `account_id`.
2. **Resolve cloudId:** call `getAccessibleAtlassianResources` and pick the site whose `url` matches your workspace. If none → ❌ `No accessible Atlassian site — check the connector's authorized scopes.`
3. **Project exists:** call `getVisibleJiraProjects` and look for a project whose `key` equals the configured `Project name` (the Jira project key). If not found → ❌ `Jira project '{Project name}' not found — check the key with /campaign-edit.` ✅ otherwise.
4. **Labels in use (advisory only):** Jira labels have no registry, so "missing" cannot be proven. Run `searchJiraIssuesUsingJql` with `project = "{key}" AND labels in ("model:sonnet", "model:opus", "model:haiku", "effort:low", "effort:medium", "effort:high", "side-quest")` and report which of the seven appear in use as ✅; report the rest as ⏭ `(not yet used — Jira creates labels on first apply)`. Informational only: do not fail on unused labels and do not offer to create them (there is no create step on Jira).

Then skip to step 7.

**Unsupported-tracker advisory** (tracker is neither Linear nor Jira) — print verbatim, then skip to step 7:

> ⚠️ **Tracker is `{Issue tracker}`, not Linear or Jira.**
>
> The TLD skills resolve tracker calls for Linear ([docs/ADAPTERS.md](../docs/ADAPTERS.md)) and Jira ([docs/JIRA.md](../docs/JIRA.md)) only. Under any other tracker the following skills will hard-abort on every invocation until a per-tracker adapter ships:
>
> - **TLD pipeline (state-touching):** `/tld-setup`, `/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-align`, `/tld-audit`, `/tld-commit`, `/tld-next`, `/tld-skip`, `/tld-cancel`, `/tld-gate`, `/tld-auto`, `/tld-side-quest`, `/tld-save-point`, `/tld-dashboard`, `/tld-ticket`
> - **Planning:** `/campaign-plan`, `/milestone-create`, `/milestone-sync`
>
> **Manual workaround:** mirror the equivalent state changes in your tracker by hand (status transitions, ordered ticket list per phase). See [docs/ADAPTERS.md](../docs/ADAPTERS.md) for the full tracker-call surface a future adapter must implement.

If `Issue tracker` = `Linear`, continue to step 4.

### 4. Linear reachability (fail-fast with one retry, then bail)

Call `list_teams` to confirm Linear MCP is reachable.

- On success (first or second attempt): continue to step 5 and hold the response for the team-exists check.
- On first failure (network error, auth error, rate limit, 5xx, or any MCP error): print `Linear unreachable on first attempt — retrying once.` and call `list_teams` a second time.
- On second failure: **bail entirely**. Do NOT continue with team / project / label / optional checks. The rest of the diagnostic is doomed without Linear, and running local checks in isolation gives a misleading "partial pass" signal.

When bailing, print:

```
❌ Linear unreachable after 2 attempts ({short reason from last failure}).

Fix the connection (check MCP server status, auth, network) and re-run `/campaign-test`.
Until Linear is reachable, `/tld-setup` and the rest of the pipeline cannot proceed.
```

Then emit the "What's next?" block with `/campaign-edit` marked **(Recommended)** and HARD STOP — skip steps 5 through 8.

### 5. Team / project / prefix checks (Linear only)

Each check runs independently; continue through all three even if an earlier one fails.

- **Team exists:** search the `list_teams` response from step 4 for a team whose name (or key, if exposed) matches the configured `Team` field. If not found → ❌ with hint: `Team '{Team}' not found — check spelling with /campaign-edit.`
- **Project exists:** call `get_project` with `project: {Project name}`. If the call fails or returns nothing → ❌ with hint: `Project '{Project name}' not found — check spelling with /campaign-edit.`
- **Ticket prefix matches the team's prefix:** if the team record from step 4 exposes a prefix or key and it differs (case-insensitive) from the configured `Ticket prefix`, ❌ with hint: `Ticket prefix '{prefix}' does not match team's prefix '{team prefix}' — update with /campaign-edit.` If the team record does not expose a prefix, report ⏭ `(team prefix not exposed by Linear — cannot verify)` rather than a fail.

### 6. Workspace labels (Linear only)

Call `list_issue_labels` with no team filter to get workspace-level labels.

For each of these seven required labels, check case-sensitive name match:

- `model:sonnet`
- `model:opus`
- `model:haiku`
- `effort:low`
- `effort:medium`
- `effort:high`
- `side-quest`

Report each as ✅ present or ❌ missing. Collect the set of missing label names for step 6b.

### 6b. Missing-label flow (gated write — Linear only)

If the missing-label set is empty, skip this step.

Otherwise, use AskUserQuestion to gate the write. The default answer is **No** — do not treat silence, ambiguity, or a free-text "Other" response as consent to create labels.

- Question: `Create the {N} missing workspace label(s)? Missing: {comma-separated names}.`
- Header: `Create labels`
- Options (in this order):
  1. **Yes, create them now** — calls `create_issue_label` for each missing label using the exact name, color, and description from the table below. This is the only write this skill makes.
  2. **No, skip (default)** — does not create anything. Re-running `/campaign-init` creates missing labels idempotently.

On **No** (or "Other" / any non-Yes response): print `Skipped label creation. Re-run /campaign-init to create the missing labels (label bootstrap is idempotent — it only creates ones that don't exist).` Continue to step 7.

On **Yes**: for each label in the missing set, call `create_issue_label` with the exact name, color, and description below. Report each call inline as ✅ `created: {name}` or ❌ `create failed: {name} ({short reason})`. Keep going through all missing labels even if one call fails — partial success is valid and the user can re-run to finish the rest. Continue to step 7.

**Label table** (source of truth: `/campaign-init` Step 6). Keep this table byte-identical to the one in `/campaign-init`; if you change one, change both in the same commit:

| Name | Color | Description |
|---|---|---|
| `model:sonnet` | `#5E6AD2` | Recommended model for this ticket: Claude Sonnet. Default. |
| `model:opus` | `#7B68EE` | Recommended model for this ticket: Claude Opus. Use for high-risk or pattern-setting work. |
| `model:haiku` | `#9B59B6` | Recommended model for this ticket: Claude Haiku. Use for cheap, mechanical work. |
| `effort:low` | `#26B87A` | Recommended reasoning effort: low. Mechanical edits, grep-replace, short additions. |
| `effort:medium` | `#F2994A` | Recommended reasoning effort: medium. Normal skill authoring, structured writing. |
| `effort:high` | `#EB5757` | Recommended reasoning effort: high. Architectural design, pattern-setting work, contracts. |
| `side-quest` | `#14B8A6` | Small polish or quick-fix work handled via `/tld-side-quest` outside the main TLD flow. |

Do not invent new labels. Do not create labels that weren't reported missing in step 6.

### 7. Optional checks (every tracker)

These run for every tracker — they are local checks with no Linear dependency. Each check is skipped cleanly when its source field is blank (no row printed, not counted as fail).

- **Backend test command runnable:** if the Backend field is set, extract the first whitespace-separated token of the command. Run `bash -c 'command -v <token>'`. Exit 0 → ✅; non-zero → ❌ `Backend test command '<token>' not runnable — check /campaign-edit.`
- **Frontend test command runnable:** same pattern with the Frontend command.
- **Landing test command runnable:** same pattern with the Landing command.
- **Full test command runnable:** same pattern with the Full command.
- **Backend directory exists:** if the Backend directory field is set, check `{cwd}/{Backend directory}` exists as a directory. If not → ❌ `Backend directory '{path}' not found — check /campaign-edit.`
- **Frontend directory exists:** same pattern for the Frontend directory.
- **Landing directory exists:** same pattern for the Landing directory.

The `command -v` check only verifies the first token resolves to something executable; it does NOT run the test suite (that's `/tld-run-test`'s job).

### 8. Output the pass / fail report

Print a grouped report using these glyphs:

- ✅ pass
- ❌ fail (include the inline remediation hint)
- ⏭ skipped or not applicable

Group headings, in this order:

- `### Schema` — always present.
- `### Linear` — Linear only.
- `### Workspace labels` — Linear only. Omit entirely for non-Linear.
- `### Optional checks` — only include rows for fields that were actually set. Do not print "skipped — blank" rows.

At the bottom, print a tally line: `Total: {pass} passed, {fail} failed, {skip} skipped.`

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 9. Present options

Decide which option is **(Recommended)** before rendering the block:

- If **any check failed**, mark `/campaign-edit` as **(Recommended)**.
- If **all checks passed**, mark `/tld-setup` as **(Recommended)**.
- Never mark more than one option as Recommended.

---

**What's next?**

> **1.** /campaign-edit — fix a failing field
>    Best for: any check above failed

> **2.** /tld-setup — jump into the next ticket
>    Best for: all checks passed, ready to work

> **3.** /campaign-show — review the full config
>    Best for: want to eyeball everything before acting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
