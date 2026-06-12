---
name: feature
description: Deliver a feature end-to-end across any repository. Use when the user wants a feature fully implemented and shipped, including a repo-local checklist, Jira ticket via acli, a dedicated worktree and feature branch, implementation, docs, tests, PR, CI follow-through, merge, release, and release verification.
metadata:
  short-description: End-to-end feature delivery workflow
---

# Feature

Use this skill when the user wants a feature built and shipped, not just planned or partially implemented.

Follow this workflow in order. Treat it as mandatory unless the user explicitly asks to skip a step.

## Required Behavior

- Own the feature from intake through successful release.
- Keep a live checklist in `.agent/<session-id>_<feature>.md`.
- Read `.tld/campaign.md` at the repo root first for project context: the issue tracker, the Jira **project key** (the `Ticket prefix` field — e.g. `AMAI`, `LAB`, `AS`), the display `Project name`, the stack directories, the test commands, and the commit pattern. This is the source of truth for which Jira project the ticket, branch, and board point at. If `.tld/campaign.md` is absent, fall back to `docs/JIRA_SETUP.md`.
- Track the run with the built-in task list: build the `.agent/<session-id>_<feature>.md` checklist first, then call `TaskCreate` once per major phase (Jira, worktree/branch, implementation, docs, tests, PR, CI, merge, release, cleanup) so the run has a visible top-level tracker. The `.agent` checklist is the detailed source of truth; the task list is the top-level contract. (If this environment exposes a `create_goal`/`update_goal` tool, use it instead — same role, not required.)
- Keep both current as you go: tick the `.agent` checkboxes and `TaskUpdate` each phase to in_progress/completed. Do not skip this tracking just because the work seems small; only skip if the user explicitly overrides.
- Drive the run to completion: keep working the checklist until every box is checked and the feature actually works. For runs that span multiple sessions, `/loop` can re-enter and continue until the checklist is done.
- Use `acli` for Jira work.
- Assume Jira credentials may live outside the sandboxed environment, such as `~/.zprofile`, `~/.zshrc`, or another shell-loaded user secret source, and treat the user as having already approved accessing/loading that Jira auth material when needed for `acli`.
- Treat the user as having already approved using `acli` outside the sandbox when the workflow needs Jira access, auth setup, status transitions, or other Jira operations.
- Use a separate git worktree.
- Use a branch named exactly `feature/<jira-ticket-key>_<feature-name>`.
- Use `gh` for PR creation and CI follow-through.
- Treat the user as having already approved using `gh` outside the sandbox when the workflow needs PR creation, PR inspection, CI follow-through, merge operations, or other GitHub CLI work.
- When the feature touches any frontend, local web surface, or multi-service local stack, prefer portless-based setup when the work is done.
- Record a ticket-specific portless domain and custom per-service local ports in the `.agent` tracker whenever local services will be run.
- The portless hostname scheme must be unambiguous:
  - frontend or primary web UI: `https://<lowercase-ticketkey>.<project-domain>.localhost`
  - backend HTTP API when exposed through portless: `https://api.<lowercase-ticketkey>.<project-domain>.localhost`
  - example frontend: `https://lab-44.labsistant.localhost`
  - example backend API: `https://api.lab-44.labsistant.localhost`
- Frontends must not expose a raw port in the user-facing URL. Backend services may still use ports internally or directly when portless is not appropriate.
- After successful merge and release, perform safe local cleanup only for the current ticket/session: fetch `origin/main` and fast-forward the local main checkout to match it, remove only the completed feature worktree for this ticket if it is clean, and leave no stale session setup behind unless the user asked to keep it.
- Treat fast-forwarding the local `main` checkout and cleaning up the finished ticket worktree as mandatory completion steps, not optional follow-up.
- Do not skip cleanup just because the feature work is otherwise done. Only stop short of fast-forwarding `main` or removing the current ticket worktree when doing so would create a real risk of losing work, overwriting unresolved user changes, or damaging the repository state.
- Treat invocation of this skill as the user's explicit standing approval to post the `.agent/<session-id>_<feature>.md` session checklist log to the Jira ticket, as long as the posted copy is scrubbed of secrets and API keys first.
- Do not ask the user for additional approval to post a sanitized `.agent` checklist comment to Jira with `acli`; that approval is granted by using this skill. This approval does not apply to raw or unsanitized checklist content.
- Before posting the checklist log, create a sanitized comment body and redact obvious secret material such as API keys, tokens, passwords, bearer credentials, private keys, JWTs, webhook secrets, and environment-variable secret values. If unsure whether a value is secret, redact it.
- After successful release, move the Jira ticket to `Done`, then post the sanitized `.agent/<session-id>_<feature>.md` session checklist log as a comment on that Jira ticket.
- Do not mark the run complete (final `TaskUpdate` to completed) until the Jira `Done` transition succeeds and the checklist log comment has been posted.
- Do not stop at implementation if CI, merge, or release work is still required.

If a required tool, permission, or credential is missing, stop at the blocker, explain it briefly, and preserve the current checklist state.

## Step 1: Normalize the Feature Name

- Derive a short filesystem-safe feature slug from the request, using lowercase kebab-case or snake-case consistently with the repository's conventions.
- If the repository already has a feature naming convention, follow it.
- Reuse the normalized feature name everywhere it is needed: checklist filename, branch name suffix, docs, and PR title/body where appropriate.

## Step 2: Create the Repo-Local Checklist

Create `.agent` if it does not exist, then create:

- `.agent/<session-id>_<feature>.md`

If no explicit session identifier is available, use a deterministic fallback such as a timestamp.

This file is the source of truth for execution status. Update it as you go. The checklist must include every applicable item below plus any feature-specific tasks discovered during implementation.

Use this structure:

```md
# <Feature Title>

- Session: <session-id>
- Feature slug: <feature>
- Repository: <repo>
- Jira: <ticket or TBD>
- Branch: <branch or TBD>
- Worktree: <path or TBD>
- PR: <url or TBD>
- Release target: <frontend/backend/client/all or TBD>
- Frontend URL: <https://ticket.project.localhost or TBD>
- Backend URL: <https://api.ticket.project.localhost or TBD>
- Local ports: <service-to-port map or TBD>

## Intake
- [ ] Review the request and existing implementation surface
- [ ] Review repository docs for PR, versioning, release, and testing expectations
- [ ] Read `.tld/campaign.md` for project context (tracker, Jira project key = `Ticket prefix`, display name = `Project name`, stack, test commands, commit pattern)
- [ ] Confirm the campaign's Issue tracker is `Jira` (this acli flow targets Jira); if Linear or other, stop and flag
- [ ] If `.tld/campaign.md` is missing, fall back to `docs/JIRA_SETUP.md`; if neither exists, ask the user to create one before continuing Jira work
- [ ] Identify affected apps/packages/services
- [ ] Identify which local services will need dedicated ports during development
- [ ] Choose the frontend URL in the exact form `https://ticket.project.localhost` if any frontend or local web surface is involved
- [ ] Choose the backend HTTP URL in the exact form `https://api.ticket.project.localhost` when an HTTP backend will be exposed through portless
- [ ] Choose custom local ports for every service that will run for this ticket
- [ ] Record the chosen domain and ports in this file

## Jira
- [ ] Create Jira ticket with `acli`
- [ ] Record the ticket key in this file
- [ ] Move the ticket to `In Progress`

## Worktree And Branch
- [ ] Create a separate git worktree
- [ ] Create and switch to branch `feature/<jira-ticket-key>_<feature-name>`
- [ ] Verify work will happen only in the worktree

## Implementation
- [ ] Add the feature-specific implementation checklist items
- [ ] Implement the feature
- [ ] Update or add any config, schema, migrations, assets, or backend/frontend glue that the feature requires
- [ ] Update local dev scripts/config to use the chosen custom ports if applicable
- [ ] Ensure frontend or local web setup prefers portless if applicable
- [ ] Ensure frontend docs never present a raw port as the primary way to open the app

## Docs
- [ ] Update `PRD.md` if applicable
- [ ] Update `feature_summary.md` if applicable
- [ ] Update or create `features/<feature>.md`
- [ ] Ensure `features/<feature>.md` contains the feature spec
- [ ] Ensure `features/<feature>.md` contains the feature implementation checklist
- [ ] Update any other affected docs under `docs/`
- [ ] Make running/setup docs prefer `https://ticket.project.localhost` for frontends and `https://api.ticket.project.localhost` for HTTP backends when applicable
- [ ] Keep raw ports acceptable for backend services, but not as the preferred frontend URL

## Tests
- [ ] Add unit tests if applicable
- [ ] Add integration tests if applicable
- [ ] Add e2e tests if applicable
- [ ] Run the relevant local test suites
- [ ] Verify the preferred portless local flow works when applicable

## PR
- [ ] Commit the changes
- [ ] Push the feature branch
- [ ] Open a PR with `gh`
- [ ] Add any required labels, including `ci:run` when the repository expects it
- [ ] Move the Jira ticket to `In PR`

## CI
- [ ] Watch PR checks until completion
- [ ] Fix any failing checks and rerun CI
- [ ] Confirm all required checks passed

## Merge
- [ ] Merge the PR to `main`
- [ ] Move the Jira ticket to `In Release`

## Release
- [ ] Determine which components need release work
- [ ] Follow repository release/versioning docs
- [ ] Create the required release commit, version bump, or tag
- [ ] Trigger the release workflow if needed
- [ ] Watch release CI and poll for status
- [ ] Fix release blockers if they appear
- [ ] Confirm the release completed successfully

## Cleanup
- [ ] Fetch `origin/main` and fast-forward the local main checkout to match it
- [ ] Remove only this ticket's completed feature worktree if it is clean and no longer needed
- [ ] Clean up any session-specific local ports, portless mappings, or temporary dev notes that should not persist
- [ ] Keep any worktree or local artifacts only if the user explicitly asked to preserve them

## Done
- [ ] Move the Jira ticket to `Done` after release
- [ ] Post the sanitized `.agent/<session-id>_<feature>.md` session checklist log as a comment on the Jira ticket after it is `Done`
- [ ] Summarize what shipped, including Jira, PR, release identifier, and any follow-up work
```

## Step 3: Gather Project Context

Before editing code:

- Inspect the code paths the feature touches.
- Read the repository instructions that govern testing, PRs, versioning, and release flow.
- Read `.tld/campaign.md` at the repo root before attempting Jira work. From its **Project** section take the issue tracker, the **Jira project key** (the `Ticket prefix` field — e.g. `AMAI`, `LAB`, `AS`), and the display `Project name`; from **Stack** the directories; from **Test Commands** the commands; from **Commit format** the pattern.
- The Jira project key (ticket prefix) is what the ticket is created in and what the board and branch point at — e.g. prefix `AS` → board `https://2ndfoundry.atlassian.net/jira/software/c/projects/AS/boards/69`. Note `Project name` may be a friendly label (e.g. `AM.AI`) and is not always the key — always use the ticket prefix as the key.
- If the campaign's Issue tracker is not `Jira`, stop and flag: this acli-based flow targets Jira.
- If `.tld/campaign.md` is absent, fall back to `docs/JIRA_SETUP.md`; if neither exists, stop and ask the user to create one.
- Look for existing docs such as `PRD.md`, `feature_summary.md`, `features/`, `docs/`, `docs/VERSIONING.md`, `docs/RELEASE*.md`, or `PR_INSTRUCTIONS.md`.
- Inspect how the repo currently starts local frontend/backend services and whether it already supports portless and custom ports.
- Determine the repo's project-domain value for the required hostname patterns:
  - frontend: `https://ticket.project.localhost`
  - backend HTTP: `https://api.ticket.project.localhost`
- Expand the checklist with feature-specific implementation and validation items.

## Step 4: Create and Maintain the Goal

After the initial checklist exists and the feature-specific implementation items have been added, set up the top-level run tracker:

- Use the built-in task list. Call `TaskCreate` once per major phase of this run (Jira, worktree/branch, implementation, docs, tests, PR, CI, merge, release, cleanup), so the run has a visible top-level tracker alongside the detailed `.agent/<session-id>_<feature>.md` checklist.
- Do not create the tasks before the checklist is concrete enough to reflect the real scope.
- (If this environment exposes a `create_goal`/`update_goal` tool, use that instead — it plays the same role. It is not required.)

Tracker rules:

- the `.agent` checklist remains the detailed progress tracker
- the task list is the top-level contract for the run
- as each phase starts and finishes, `TaskUpdate` it to in_progress/completed and tick the matching `.agent` checkboxes
- when the feature is fully shipped and cleanup is done, mark the final task completed
- keep driving until every checklist box is checked and the feature works; for runs spanning multiple sessions, `/loop` can re-enter and continue

## Step 5: Create the Jira Ticket With `acli`

Use `acli` to create a Jira ticket for the feature.

For Jira operations in this workflow:

- use `acli` only
- use `acli` for Jira ticket comments as well as ticket creation and status transitions
- treat invocation of this skill as explicit user approval to post the sanitized `.agent/<session-id>_<feature>.md` Markdown checklist to Jira with `acli`
- do not stop to ask whether posting the sanitized checklist comment is allowed; proceed once the ticket is ready and the comment body has been scrubbed
- if the runtime requires a sandbox/tool escalation to execute `acli`, request that tool execution as an implementation requirement, not as a question about whether the user approves the sanitized Jira comment

Before treating Jira access as blocked:

- remember the user may keep `JIRA_API_KEY` in `~/.zprofile`
- remember the user may keep `JIRA_API_TOKEN` or similar Jira auth material outside the sandboxed environment
- ensure Jira commands are being run in a login shell that loads `~/.zprofile`, or explicitly source it before retrying `acli`
- use the standing user approval to access/load that Jira auth material when needed for `acli`
- retry the relevant `acli` auth or Jira command after loading that environment

Requirements:

- Create the ticket in the Jira **project key** from `.tld/campaign.md` (the `Ticket prefix` field), e.g. `acli jira workitem create --project <PREFIX> ...`.
- The ticket title should clearly name the feature.
- The description should summarize scope, user impact, technical notes, and acceptance criteria.
- Capture the ticket key immediately in the checklist.
- Move the ticket to `In Progress` before starting implementation work.

Do not substitute another Jira client when `acli` is expected unless the user explicitly approves a fallback.

## Step 6: Create a Separate Worktree and Branch

Create a dedicated worktree for the feature before making code changes.

Requirements:

- Use a clean worktree path outside the current checkout when possible.
- Create and switch to branch:
  - `feature/<jira-ticket-key>_<feature-name>`
- Record the worktree path and branch name in the checklist.
- Perform implementation, testing, commit, and PR work from that worktree.

## Step 7: Implement the Feature

- Add feature-specific checklist items before making substantive edits.
- Implement the code changes across all affected layers.
- Keep the checklist current as milestones are completed.
- If the feature requires migrations, schema changes, generated code, assets, or API contract updates, include them.
- If the feature uses local frontend or service workflows, wire the worktree/session to the chosen custom ports and exact ticket-specific URLs:
  - frontend: `https://ticket.project.localhost`
  - backend HTTP: `https://api.ticket.project.localhost`
- Do not rely on default shared ports when the repo supports isolated per-ticket setup.

## Step 8: Update Documentation

Update existing docs or create them when missing.

Always evaluate and update, when applicable:

- `PRD.md`
- `feature_summary.md`
- `features/<feature>.md`
- relevant docs under `docs/`

When the feature affects local run flows:

- update setup and running docs to prefer portless over raw localhost ports
- document the preferred frontend hostname without a port in the exact form `https://ticket.project.localhost`
- document the preferred backend HTTP hostname, when applicable, in the exact form `https://api.ticket.project.localhost`
- keep raw localhost/port instructions only as fallback or low-level debugging paths
- it is acceptable to keep raw ports for backend services; it is not acceptable to make a raw port the preferred frontend URL

`features/<feature>.md` must include:

- the feature spec
- implementation notes if they matter for maintenance
- the feature's own implementation checklist

## Step 9: Add and Run Tests

Add all relevant tests for the change:

- unit tests
- integration tests
- e2e tests

Then run the relevant local verification before opening the PR. If some suites are too expensive or unavailable, run the best available coverage and note the gap in the checklist and final summary.

When a frontend or local web flow exists:

- verify the preferred portless development flow, not just the raw fallback server command

## Step 10: Commit, Push, Open PR, and Move Jira to `In PR`

After local implementation and validation:

- commit the changes with a clear message
- push the feature branch
- open the PR with `gh`
- add labels required by the repository
- add `ci:run` if the repository requires that label for CI to start
- move the Jira ticket to `In PR`

The PR description should summarize:

- feature scope
- major code/doc/test changes
- local validation performed
- release impact

PR body requirements:

- Always use a real multiline Markdown body, never a single escaped string with literal `\n` sequences.
- Use this default section structure unless the repository has a stronger documented PR template:
  - `## Summary`
  - `## Changes`
  - `## Testing`
- Write the PR body as actual paragraphs and bullets, not JSON-style escaped text.
- Validate all interpolated values before creating the PR.
- Never open the PR if any placeholder or required value is blank, malformed, or obviously unresolved.
- In particular, verify that:
  - the Jira ticket key is present when applicable
  - the project-domain value is present when hostname examples are included
  - ticket-scoped frontend/backend hostnames are fully formed when referenced
- If a value is still unknown, fill it first or omit that detail instead of leaving a broken placeholder.

Use this default PR body template:

```md
## Summary
<1-3 sentences describing the user-facing outcome and scope>

## Changes
- <most important code/config/doc change>
- <second important change>
- <additional notable change if needed>

## Testing
- <tests run, or `Not run; <reason>`>
```

## Step 11: Watch CI and Fix Failures

Do not consider the feature complete when the PR is merely open.

- Poll PR checks until all required checks complete.
- If checks fail, inspect the failures, fix them in the same branch, rerun validation, push, and continue watching.
- Repeat until required PR checks pass.

## Step 12: Merge and Move Jira to `In Release`

Once PR checks pass:

- merge the PR to `main`
- move the Jira ticket to `In Release`

Follow repository conventions for merge strategy if documented.

## Step 13: Release and Verify the Release

Determine which deliverables changed, such as:

- frontend
- backend
- client
- shared packages or multiple components

Then:

- read the repository's versioning and release docs
- apply the required version bumps, changelog updates, or tags
- trigger or observe the release workflow
- poll until the release succeeds

If release checks fail:

- diagnose the problem
- implement the fix
- repeat the validation, PR, merge, and release steps as needed

Success means the release completed successfully, not merely that the code merged.

## Step 14: Mark Jira Done, Post Checklist Log, and Clean Up

After merge and release are successful:

- move the Jira ticket to `Done`
- after the ticket is `Done`, create a sanitized copy of `.agent/<session-id>_<feature>.md` with secrets and API keys redacted, then post that sanitized checklist as a comment on the Jira ticket with `acli`
- fetch `origin/main` and fast-forward the local main checkout to match it
- clean up any session-specific local run state that should not persist, such as temporary notes or ticket-specific local port bookkeeping
- remove only the dedicated feature worktree for the current ticket/session when it is clean and no longer needed
- record the `Done` transition and checklist comment outcome in the checklist
- after cleanup, Jira `Done`, and the checklist comment are complete, mark the final task completed (`TaskUpdate`) to close out the run

Cleanup rules:

- fast-forwarding the local `main` checkout and cleaning up the finished ticket worktree are required for completion whenever they are safe
- prefer a fast-forward-only update for the local main checkout; if that cannot be done safely, record the blocker instead of forcing history changes
- never remove another agent's worktree or any worktree not recorded for the current ticket/session in the `.agent` tracker
- only remove the worktree after this ticket is actually finished, meaning merge and required release work both succeeded unless the user explicitly says to stop earlier
- do not remove a worktree that still has uncommitted or otherwise unresolved state
- do not delete anything the user explicitly asked to keep
- if cleanup cannot be completed safely, record the concrete danger in the checklist and report the remaining manual follow-up; do not quietly skip it

## Final Output Expectations

When reporting completion:

- include the Jira ticket key
- include the branch name
- include the PR URL
- include the release identifier, tag, or workflow result
- include the chosen frontend URL, backend URL when applicable, and custom local ports when they were part of the work
- include whether the main checkout was updated and whether the feature worktree was removed
- include whether the Jira ticket was moved to `Done` and whether the sanitized checklist log was posted as a ticket comment
- include whether the run tracker (task list) was created and marked complete
- if either cleanup step was not completed, explicitly explain the danger that prevented it
- mention any known follow-up items

If blocked, report the blocker succinctly, state whether the run tracker remains active or was marked blocked, and point to the checklist file for current state.
