# Jira Adapter — Issue Tracker Mapping

This document is the Jira counterpart to [ADAPTERS.md](ADAPTERS.md). The TLD skills are written against neutral operations ("fetch the ticket assigned to me that is in progress", "get the next-ranked unfinished ticket under this milestone"). This file says how each neutral operation resolves to Jira, what Jira concept each Linear concept maps to, and where Jira genuinely cannot mirror Linear.

A skill takes the Jira path when `.tld/campaign.md` → Project → `Issue tracker` is `Jira`. On Linear it follows [ADAPTERS.md](ADAPTERS.md) instead.

**Access:** Jira Cloud via the Atlassian MCP connector. It must be authenticated in the session before any Jira skill runs (`mcp__…__authenticate` → user authorizes → tools appear). Every Jira tool takes a **`cloudId`**. Resolve it once per session: `getAccessibleAtlassianResources` returns the site `id` (the cloudId) and `url`. For the 2ndfoundry workspace the cloudId is `9305636a-dd20-44bb-bd49-88c4c540b0a7` (site `2ndfoundry.atlassian.net`), but always resolve it live rather than hard-coding — a different workspace will differ.

---

## Concept mapping (Linear → Jira)

| Linear concept | Jira (Cloud) mapping | Notes |
|---|---|---|
| Project (`Project name`) | Jira **project**, display name | `Project name` is a human label and may differ from the key (e.g. `AM.AI`). The **Jira project key comes from `Ticket prefix`**, not this field. |
| Team | The Jira **project** | Jira's company-managed model has no separate sub-project team object; reuse the project. |
| Milestone | **Story** | A milestone is a Story (issue type, hierarchy level 0) that groups one phase of work. |
| Ticket | **Sub-task** under the Story | Each unit of work is a Sub-task (hierarchy level -1) whose `parent` is the milestone Story. |
| Order of tickets | **Jira native rank** of the sub-tasks | `ORDER BY Rank ASC`. No hand-kept `## Order` list. |
| Ticket prefix | **Jira project key** (e.g. `AMAI`, `LAB`, `AS`) | The key used for `acli --project`, JQL `project = <KEY>`, board URLs, and branch names. Issue keys are `PREFIX-NNN`, same shape as Linear, so the `({prefix}-\d+)` parser is unchanged. |
| Status: Todo / In Progress / Done / Canceled | Jira **status category** (`To Do` / `In Progress` / `Done`) | "Canceled" is a Done-category status matched by name (see [statuses](#statuses)). |
| `model:*` / `effort:*` / `side-quest` labels | Plain Jira **labels** | Free text, no color, no description (see [labels](#labels)). |
| "Me" (current user) | `atlassianUserInfo` → `account_id`, or JQL `currentUser()` | Needed for the multi-person concurrency fix. |

**Why Story + Sub-task and not Epic.** This workspace uses the standard Jira hierarchy: Epic (level 1) → Story/Task/Bug (level 0) → Sub-task (level -1). A Story cannot parent a Task or Bug — those are siblings. The chosen model is **milestone = Story, ticket = Sub-task**, because a Story *can* parent Sub-tasks, which gives the "container with ordered tickets inside it" shape. (An Epic-as-milestone model is also viable but was not chosen.)

---

## Milestone and ordering: how "next ticket" works on Jira

On Linear the order is a `## Order` text list inside the milestone description, walked top to bottom. **On Jira there is no text list** — order is the sub-tasks' native rank.

Resolve "the next ticket" on Jira:

1. Identify the active milestone Story.
2. List that Story's Sub-tasks, ordered by rank ascending:
   `parent = "<storyKey>" AND issuetype = Sub-task ORDER BY Rank ASC`
3. Pick the first sub-task that is **not** Done/Canceled, **not** already In Progress by someone other than the current user (see [concurrency](#concurrency-multiple-assignees)), **and** whose blockers are all resolved (every `is blocked by` link points at a Done/Canceled issue). A still-blocked sub-task is **skipped**: take the next ready sub-task by rank. If every remaining unfinished sub-task in the Story is blocked, this Story has no ready ticket: surface the outstanding blockers (the blocker likely lives in another milestone Story) and let the caller's Story walk continue to the next Story by rank, rather than returning a blocked ticket.

"Are all tickets in this milestone resolved?" (milestone completion check) = every Sub-task of the Story is in the Done status category.

**Authoring (`/campaign-plan`, `/milestone-create`):** create the milestone Story, then create the child Sub-tasks in the intended order (pass `parent` = the Story key; newly created sub-tasks rank at the bottom by default, so create them in sequence). There is no Order text to write. Humans reorder by dragging in the backlog; the drag-rank is authoritative.

**`/milestone-sync` is essentially retired on the Jira path.** Its entire job on Linear was authoring or repairing the `## Order` text. With no text list to repair, the Jira branch is a no-op aside from an optional check that the Story has child sub-tasks and they are ranked.

### Confirmed against the live instance

- **Rank ordering works.** `searchJiraIssuesUsingJql` with `ORDER BY Rank ASC` returns issues in board order. (No fallback to issue-key order is needed.)
- **Parent / grouping.** Sub-tasks carry a `parent` field (`fields.parent.key`). Query a Story's tickets with `parent = "<storyKey>"`. Verify a returned ticket's `issuetype.name == "Sub-task"` when you need to exclude other child types.
- **Sub-task ranking caveat.** Sub-tasks participate in rank, but a project that has never reordered sub-tasks may return them in creation order — which is the intended order anyway. If a team needs to resequence, they drag in the backlog/board.

### JQL gotchas

- **Reserved words must be quoted.** Some project keys are JQL reserved words — e.g. `AS`. Always quote the project key: `project = "AS"`, not `project = AS`.
- **Large results.** `searchJiraIssuesUsingJql` returns full issue bodies; always pass a tight `fields` list (e.g. `["summary","status","issuetype","parent","assignee","labels"]`) and a small `maxResults` to avoid oversized responses.

---

## Statuses

Linear exposes a five-value `statusType` (`backlog` / `unstarted` / `started` / `completed` / `cancelled`). Jira exposes a three-value **status category** on every status: `fields.status.statusCategory.key` is one of `new` (To Do) / `indeterminate` (In Progress) / `done` (Done), and `.name` is the human label. Map on category:

| Neutral status the skills need | Jira resolution |
|---|---|
| "not started" (Todo/Backlog) | `statusCategory.key == "new"` |
| "in progress" / "started" | `statusCategory.key == "indeterminate"` |
| "done" | `statusCategory.key == "done"` and the status name is **not** the cancel status |
| "canceled" | `statusCategory.key == "done"` and the status name matches the cancel status |

Because Jira folds five Linear classes into three categories, "Done" and "Canceled" share the `done` category and are told apart by **status name**. This workspace's projects expose `Backlog` (→ `new` category) among others; confirm the exact cancel and skip status names per project from `getTransitionsForJiraIssue` / the project workflow. _Cancel status name:_ confirm per project (no dedicated "Canceled" seen yet — may be "Done" only). _Skip status name:_ falls back to a `new`-category status such as `Backlog`.

**Transitions are not direct field writes.** Jira changes status via a workflow transition, not by setting a status field. To move a ticket: call `getTransitionsForJiraIssue` to find the transition whose target status is in the desired category, then `transitionJiraIssue` with that transition id.

---

## Hierarchy rollup (closing out parents on gate PASS)

Jira is hierarchical: **Epic (level 1) → Story (level 0, = milestone) → Sub-task (level -1, = ticket)**. The TLD pipeline transitions **Sub-tasks** (tickets) as work proceeds, but nothing transitions the parent Story or the Epic above it — left alone they sit `In Progress` forever even after every child is `done`. `/tld-gate` runs at the milestone (Story) boundary, so it is where parent completion rolls **up** the hierarchy. **Rollup happens only on a PASS verdict** (every Sub-task resolved, tests green, no consistency issues, no drift); a FAIL transitions nothing.

Close out from the gated Story upward:

1. **Close the milestone Story.** Once every Sub-task of the Story is in the `done` category, transition the **Story** itself to a `done`-category status (the real Done status, not the cancel status). `getTransitionsForJiraIssue` on the Story key → pick the transition whose target status category is `done` → `transitionJiraIssue`. If the Story is already `done`, skip.
2. **Close the parent Epic when its last Story finishes.** Read the gated Story's parent via `getJiraIssue` `fields.parent` (only when the parent is an Epic — `fields.parent.fields.issuetype.name == "Epic"`). List that Epic's child Stories with `searchJiraIssuesUsingJql`: `parent = "<epicKey>" AND issuetype = Story` (tight `fields` list, e.g. `["status","issuetype"]`). If **every** child Story is now in the `done` category, transition the **Epic** to `done` the same way. If any child Story is still unresolved, leave the Epic as-is.

Guard rails:

- **Only ascend; never touch siblings' open work.** Transition only the gated Story and, conditionally, its Epic. Never transition a sibling Story, the Sub-tasks under another Story, or any issue that still has unresolved children.
- **No parent → stop cleanly.** If the Story has no parent Epic (`fields.parent` absent, or the milestone is a bare Story), do the Story close and skip the Epic step. Projects with no Story/Epic parentage yet (e.g. the imported `AS` flat-`Task` layout in the data note below) have nothing above to roll into — the rollup is then a no-op above the level that exists.
- **Cancel ≠ done as a target.** A Sub-task or Story sitting in a cancel-named `done`-category status still counts as resolved when deciding "are all children finished," but a parent you transition should land in the real Done status, never the cancel status.
- **Idempotent.** Re-running the gate after a successful rollup finds the parents already `done` and transitions nothing.

---

## Labels

The seven required TLD labels (`model:sonnet`, `model:opus`, `model:haiku`, `effort:low`, `effort:medium`, `effort:high`, `side-quest`) map to plain Jira labels — the same strings. Jira labels differ from Linear labels:

- **No color, no description.** The color/description columns from the canonical labels table do not apply on the Jira path; only the seven names matter.
- **No create step.** Any string becomes a valid label the moment it is first applied. There is no label registry to bootstrap, so `/campaign-init`'s "create the seven labels" step is a **no-op** on Jira.
- **Weaker safety net.** A mistyped label (`modle:opus`) does not error the way a missing Linear label does. `/campaign-test`'s label audit can only report which of the seven are currently in use, not which are "defined."

---

## Concurrency (multiple assignees)

Jira is multi-person, so "the one ticket that is In Progress" is project-wide ambiguous. Every neutral "current ticket" operation scopes to **the current user**:

- Resolve "me" via `atlassianUserInfo` (returns `account_id`), or use JQL `currentUser()` directly.
- "My current ticket" = the issue that is In-Progress-category **and** assigned to me:
  `project = "<key>" AND statusCategory = "In Progress" AND assignee = currentUser()`.
  Exactly one is the normal case; zero means "run /tld-setup"; two or more means ask which one.
- Discovery (`/tld-setup`) skips sub-tasks that are In Progress and assigned to **someone else** — they are claimed.

This same scoping is applied on the Linear path too (you were always the only assignee there), so it lives in the neutral canonical blocks rather than as a Jira-only branch.

---

## Tool-name map

Concrete Atlassian MCP tools for each neutral operation (this workspace's connector). All take `cloudId`.

| Neutral operation | Linear call (ADAPTERS.md) | Jira (Atlassian MCP) |
|---|---|---|
| Get current user | viewer/`me` | `atlassianUserInfo` |
| Resolve cloudId / verify project exists | `get_project` | `getAccessibleAtlassianResources`, `getVisibleJiraProjects` (filter by `key`) |
| List my in-progress ticket | `list_issues` + assignee filter | `searchJiraIssuesUsingJql`: `project = "<key>" AND statusCategory = "In Progress" AND assignee = currentUser()` |
| List a milestone's tickets in order | `list_milestones` + `get_milestone` + `## Order` | `searchJiraIssuesUsingJql`: `parent = "<storyKey>" ORDER BY Rank ASC` |
| Get one ticket | `get_issue` | `getJiraIssue` |
| Create a ticket | `save_issue` (create) | `createJiraIssue` (issuetype `Sub-task`, `parent` = Story key) |
| Transition a ticket's status | `save_issue` (state) | `getTransitionsForJiraIssue` → `transitionJiraIssue` |
| Edit a ticket (labels, assignee, fields) | `save_issue` | `editJiraIssue` |
| Post or update a ticket comment | comment-create / comment-update | `addCommentToJiraIssue` (pass `commentId` to update in place) |
| Create the milestone Story | `save_milestone` | `createJiraIssue` (issuetype `Story`) |
| List issue types / hierarchy | (n/a) | `getJiraProjectIssueTypesMetadata` |
| Resolve a username → account id | (n/a) | `lookupJiraAccountId` |
| List labels in use | `list_issue_labels` | `searchJiraIssuesUsingJql` with `labels in (...)` and read each issue's `labels` |
| Reachability probe | `list_teams` (with retry) | `atlassianUserInfo` or `getVisibleJiraProjects` (with one retry) |

`create_issue_label` from the Linear contract has **no Jira equivalent** — labels are not created, only used (see [labels](#labels)).

---

## Completion comment + handoff (tld-writeup)

`tld-writeup` posts the standardized completion comment and writes the machine-readable handoff. On Jira:

- **Post/update the comment idempotently.** Use `addCommentToJiraIssue` with `contentFormat: markdown`. The
  comment's first line is the marker `# <KEY> complete — <title>` and its Handoff block carries
  `Run: <session id>`. To avoid duplicates, read existing comments first (`getJiraIssue` with the `comment`
  field), find the one bearing this ticket's marker **and** the same `Run:` id, and if present pass its
  `commentId` to update in place; otherwise add a new comment. Exactly one completion comment per ticket +
  run.
- **Write the handoff into the shared checklist.** The Handoff field names are the existing checklist keys
  (`handoff_state`, `handoff_validation_summary`, `handoff_changed_files_summary`, `handoff_token_usage`,
  `handoff_blocker`) written via `agent-checklist set --field <name> --value <value>`, then
  `agent-checklist check --key handoff_state_recorded`. This is tracker-independent — the same keys are used
  on Linear — but it is the signal the orchestrator reads to know the ticket is done, so it must be written
  even though the comment already carries the same block in prose.

## What Jira cannot mirror (residual risks)

| Linear behavior | Jira reality | Consequence |
|---|---|---|
| `## Order` text list as source of truth | Order is drag-rank; no canonical text | Declare Jira rank authoritative. A future reconcile is out of scope. |
| Label create + "fail on unknown label" | Free-text labels, no registry | Typo labels do not error; bootstrap is a no-op. |
| Five status classes | Three status categories | Done vs Canceled told apart by name, not category. |
| Direct status field write | Status changes go through workflow transitions | Use `getTransitionsForJiraIssue` → `transitionJiraIssue`, not a field set. |
| Flat Milestone → Ticket model | Story → Sub-task here | Tickets are Sub-tasks; only a Story's sub-tasks are TLD tickets. Sibling Tasks/Bugs/Stories are not picked up by the pipeline unless modeled as the milestone Story itself. |
| Milestone `sortOrder` | Story rank / backlog order | Milestone order = Story rank; reorder by dragging in the backlog. |

> **Data note:** the existing `AS` (Adventure Skills) project tickets were imported from Linear as flat **Task** issues with no parent Story. To use the Story/Sub-task model, those need to be reorganized into milestone Stories with Sub-task children (a one-time data migration, separate from the skill changes).
