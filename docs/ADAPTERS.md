# Adapter Interface — Issue Tracker Calls

The TLD skills speak in neutral operations (for example "fetch the ticket assigned to me that is in progress" and "get the next-ranked unfinished ticket under this milestone"). This document specifies how those operations resolve on **Linear**, the framework's original tracker. The **Jira** mapping lives in [JIRA.md](JIRA.md); a skill takes the Jira path when `.tld/campaign.md` → Project → `Issue tracker` is `Jira`, and the Linear path otherwise.

Every skill that reads or writes ticket or milestone state calls one of the twelve functions listed here. The contract is defined by what the skills actually pass and what they actually read — not by the full API each tracker exposes.

**Tracker-defined "ordered ticket list."** Several skills ask for "the milestone's tickets in order." On Linear that order is the `## Order` section parsed from the milestone description (see [`get_milestone`](#get_milestone) and [auto-linking](#auto-linking-in-milestone-descriptions)). On Jira there is no text list — order is Jira's native rank. Each tracker's doc says how the ordered list is produced; the skills do not assume a storage format.

## How to use this document

For each function:
- **Parameters the skills pass** — your adapter must accept at least these fields. Extra fields are ignored.
- **Response fields the skills read** — your adapter must return at least these fields. Extra fields are ignored.
- **Edge cases** — behaviors the skills depend on; your adapter must replicate them or the skill will break silently.

Two cross-cutting edge cases apply to several functions and are documented at the end: [auto-linking in milestone descriptions](#auto-linking-in-milestone-descriptions) and [rate-limiting behavior](#rate-limiting-behavior).

---

## Functions

### `list_milestones`

Returns all milestones for a project, sorted by sequence order ascending.

**Used by:** `/tld-setup` (Mode B discovery), `/tld-dashboard`, `/tld-gate`, `/tld-next`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `project` | string | Project name from `.tld/campaign.md` |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable identifier, passed back to `get_milestone` |
| `name` | string | Display name, shown in output |
| `sortOrder` | number | Ascending sort — determines which milestone is "first" |

**Empty array:** treated as "no milestones" — the skill stops with an advisory.

---

### `get_milestone`

Returns one milestone's full record, including its description.

**Used by:** `/tld-setup`, `/tld-auto`, `/tld-dashboard`, `/tld-next`, `/tld-gate`, `/tld-skip`, `/milestone-sync`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Milestone ID returned by `list_milestones` |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | Full markdown text — the skills parse the `## Order` section from this |

**Critical edge case:** see [auto-linking in milestone descriptions](#auto-linking-in-milestone-descriptions).

---

### `save_milestone`

Creates or updates a milestone. If `id` is provided, updates the existing one; otherwise creates a new one.

**Used by:** `/milestone-create`, `/milestone-sync`, `/campaign-plan`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `project` | string | Project name (used when creating) |
| `name` | string | Milestone display name |
| `description` | string | Full markdown text — the six-section template (Purpose / Scope / Order / Exit Criteria / Dependencies / Risk) |
| `targetDate` | string \| omitted | ISO date string (`2026-05-15`), or omitted when no date is set |
| `id` | string \| omitted | Omit when creating; include when updating |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Returned after creation; used to assign tickets to this milestone |

**Not accepted:** `sortOrder`. The Linear MCP connector does not expose a reorder mutation. Milestones land at the bottom of the list when created — users must reorder in the tracker UI. See [LIMITATIONS.md](../LIMITATIONS.md).

---

### `list_issues`

Returns a batch of issues matching a filter. Used to look up statuses for multiple tickets without N separate `get_issue` calls.

**Used by:** `/tld-setup` (Mode B status batch), `/tld-dashboard`, `/tld-auto`, `/tld-next`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `project` | string | Scopes results to the configured project |
| (status or IDs filter) | varies | Skills may filter by status ("In Progress") or by a set of ticket identifiers from a milestone's Order section |
| `assignee` | string \| omitted | When present, scopes results to one user — the value `"me"` / the current user's ID. Used by the "current ticket" resolution so that, on a multi-person team, a skill finds only the ticket assigned to the person running it (see [`get_current_user`](#get_current_user)). Omitted when the skill wants all assignees. |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Internal stable identifier |
| identifier | string | Human-readable ticket ID, e.g. `2ND-207` |
| `status` | string | Status name, e.g. `"Todo"`, `"In Progress"`, `"Done"` |
| `statusType` | string | Normalized status class: `"backlog"`, `"unstarted"`, `"started"`, `"completed"`, `"cancelled"` |
| `title` | string | Display title |

**Consumed as an array.** The skills walk the array looking for a specific status or identifier. Order within the array does not matter — the skills apply their own ordering from the milestone's `## Order` section.

---

### `get_issue`

Returns one issue's full record. The primary call for loading a ticket before implementation.

**Used by:** `/tld-setup`, `/tld-auto`, `/tld-build`, `/tld-run-test`, `/tld-next`, `/tld-commit`, `/tld-save-point`, `/tld-skip`, and any skill that reads ticket detail

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Ticket identifier, e.g. `2ND-207` |
| `includeRelations` | boolean | `true` when the skill needs `blockedBy` / `blocks` (dependency checks); omitted otherwise |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Internal stable identifier |
| `title` | string | Ticket title |
| `description` | string | Full markdown body |
| `status` | string | Status name |
| `statusType` | string | Normalized status class (see `list_issues` table above) |
| `projectMilestone.id` | string | Milestone ID — passed back to `get_milestone` when the skill needs the Order section |
| `projectMilestone.name` | string | Milestone display name, shown in output |
| `labels` | string[] | Label names, e.g. `["effort:medium", "model:sonnet"]` |
| `relations.blockedBy` | object[] | Each element has `id` (ticket ID) and `title`. Present when `includeRelations: true`. |
| `relations.blocks` | object[] | Same shape as `blockedBy`. Present when `includeRelations: true`. |
| `completedAt` | string \| null | ISO timestamp or null — skills check this as an alternative "is Done" signal |
| `canceledAt` | string \| null | ISO timestamp or null — similar use |

**Missing fields:** if `projectMilestone` is null (ticket not assigned to a milestone), skills that need milestone context will fail or skip the milestone walk. Return an empty object `{}` rather than null so field access doesn't throw.

---

### `save_issue`

Creates a new issue or updates an existing one.

**Used by:** `/tld-setup` (mark In Progress), `/tld-auto` (mark Done), `/tld-next` (mark Done), `/tld-skip` (revert to Todo/Skipped), `/milestone-create` (create tickets)

#### Parameters for creating a ticket

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Ticket title |
| `team` | string | Team name from campaign |
| `project` | string | Project name from campaign |
| `description` | string | Full markdown body |
| `milestone` | string | Milestone ID (returned from `save_milestone`) |
| `labels` | string[] | Label names, e.g. `["model:sonnet", "effort:medium"]` |

#### Parameters for updating a ticket

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Ticket identifier, e.g. `2ND-207` |
| `state` | string | Target state name: `"In Progress"`, `"Done"`, `"Todo"`, `"Backlog"`, or a custom "Skipped" state (see `/tld-skip`) |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| identifier | string | Human-readable ticket ID assigned by the tracker, e.g. `2ND-208`. Needed after creation so the skill can populate the milestone's `## Order` section. |

**Label errors:** if a label name is not found in the workspace, the call should fail with a descriptive error. The skills surface this to the user and stop — they do not silently drop labels.

---

### `get_current_user`

Returns the identity of the user the connector is authenticated as. Needed so "the current ticket" resolves to the ticket assigned to *this* person rather than anyone on the team — the multi-person concurrency fix. On a single-developer Linear setup this is the only assignee, so the scoping is behavior-preserving.

**Used by:** the "Require current ticket" and "Resolve next ticket" logic in every state-touching skill (via the canonical blocks), to pass an `assignee` filter to `list_issues` and to decide whether an In-Progress ticket is "mine" or "claimed by someone else."

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| (none) | — | Returns the authenticated user |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable user identifier — passed as the `assignee` filter to `list_issues` |
| `displayName` | string | Human-readable name, shown when disambiguating |

On Linear this is the viewer/`me` lookup; on Jira it is `myself`. See [JIRA.md](JIRA.md#concurrency-multiple-assignees).

---

### `list_issue_labels`

Returns all workspace-level labels (not filtered by team).

**Used by:** `/campaign-init` (bootstrap check), `/campaign-test` (label audit)

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| (none) | — | No filter — returns all labels in the workspace |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Case-sensitive label name, e.g. `"model:sonnet"` |

The skills check for exact name matches against the seven required TLD labels (`model:sonnet`, `model:opus`, `model:haiku`, `effort:low`, `effort:medium`, `effort:high`, `side-quest`).

---

### `create_issue_label`

Creates a workspace-level label.

**Used by:** `/campaign-init` (step 6 bootstrap), `/campaign-test` (step 6b gated write)

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Exact label name, e.g. `"model:sonnet"` |
| `color` | string | Hex color code, e.g. `"#5E6AD2"` |
| `description` | string | Human-readable label description |

#### Response fields the skills read

None — the skills check for success/failure by error status, not by reading the response body.

**Idempotent intent:** the skills call `list_issue_labels` first and only call `create_issue_label` for labels that are not already present. The adapter does not need to handle "label already exists" as an error — the skill prevents duplicate calls. If your tracker returns an error on duplicate creation anyway, treat it as success in the adapter.

---

### `list_issue_statuses`

Returns the available workflow states for a team.

**Used by:** `/tld-skip` (to check whether a custom "Skipped" state exists)

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `team` | string | Team name from campaign |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Display name of the state, e.g. `"Todo"`, `"Skipped"` |
| `type` | string | Normalized class: `"backlog"`, `"unstarted"`, `"started"`, `"completed"`, `"cancelled"` |

`/tld-skip` looks for a state whose `type` is `"unstarted"` or `"backlog"` AND whose `name` (case-insensitive) is `"Skipped"`. If found, it uses that state; otherwise it falls back to `"Todo"`. A minimal adapter can return a single `{ name: "Todo", type: "unstarted" }` entry and the fallback will always apply.

---

### `list_teams`

Returns all teams in the workspace. Used as a reachability probe and to verify that the configured team exists.

**Used by:** `/campaign-test`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| (none) | — | No filter |

#### Response fields the skills read

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Team display name — checked against the `Team` field in `.tld/campaign.md` |
| `key` | string \| omitted | Ticket prefix if the tracker exposes it (e.g. `"2ND"`). If absent, `/campaign-test` skips the prefix-match check rather than failing. |

**Reachability probe:** `/campaign-test` calls `list_teams` first with a retry on failure. If both attempts fail, the skill aborts all remaining Linear checks. Your adapter should fail fast with a clear error message on auth or network failure so the user gets a useful diagnostic.

---

### `get_project`

Returns a project by name. Used only to verify that the configured project exists.

**Used by:** `/campaign-test`

#### Parameters the skills pass

| Field | Type | Notes |
|-------|------|-------|
| `project` | string | Project name from `.tld/campaign.md` |

#### Response fields the skills read

None — the skills check for the presence or absence of a result, not any specific field. Return any non-null object on success; return null or throw on "not found."

---

## Edge Cases

### Auto-linking in milestone descriptions

Linear automatically rewrites plain ticket IDs in milestone descriptions when the description is saved via `save_milestone`. A line written as:

```
1. 2ND-207
```

is returned by `get_milestone` as:

```
1. [2ND-207](https://linear.app/2ndfoundry/issue/2ND-207/...)
```

All TLD skills that parse the `## Order` section use an unanchored regex to extract the ticket ID — they match `({prefix}-\d+)` anywhere on the line, not at a fixed position. This means both the plain form and the auto-linked form produce the same parsed ticket list.

**Adapter requirement:** your adapter must return one consistent form from `get_milestone`. If your tracker rewrites IDs on save (as Linear does), the skills will handle it correctly as long as the ID string (`PREFIX-NNN`) appears somewhere on each Order line. If your tracker does not rewrite IDs, the plain form also works — no special handling needed.

A mixed list (some lines auto-linked, some plain) also parses correctly, because the regex is applied line-by-line with no anchor assumption.

---

### Rate-limiting behavior

The Linear MCP connector returns a rate-limit error as a standard error response. Skills that call `list_teams` or `get_issue` retry once on any failure (including rate-limit errors) before surfacing the error to the user.

**Adapter requirement:** when your tracker rate-limits a request, return a standard error (throw / reject) so the skill's retry logic fires. Do not return an empty result or a partial result — empty results are interpreted as "no data found," not "temporarily unavailable," and will cause the skill to take the wrong branch.

The retry interval is implicit — the skill retries immediately after the first failure. If your tracker requires a backoff delay, implement it inside the adapter before returning the error on the second attempt.

---

## Scope

The 12 functions above are the complete set of tracker calls the framework makes. Implementing all 12 in a new adapter gives full pipeline coverage.

**Jira** is mapped in [JIRA.md](JIRA.md) and selected via the `Issue tracker` field in `.tld/campaign.md`. **GitHub Issues** and other trackers remain unimplemented — the contract here is what an adapter for them would need to satisfy. See [LIMITATIONS.md](../LIMITATIONS.md) for the current constraint summary.
