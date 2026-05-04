---
name: tld-release
description: |
  Cut a new tagged release of the tld-skills plugin. Use this skill whenever the user
  says "tld-release", "release", "cut a release", "ship a release", "publish a version",
  or wants to wrap the manual procedure in RELEASING.md (bump CHANGELOG, PR the bump,
  merge, then `gh release create`) into one guided flow with stops at each destructive
  moment. Optional argument: `patch`, `minor`, `major`, or an explicit version like
  `v0.2.0`. Refuses to run when the working tree has uncommitted changes or when not on
  the default branch. Watches the marketplace auto-bump workflow and reports the result.
---

# TLD Release

You are cutting a new tagged release of the `tld-skills` plugin. This wraps the manual procedure in [RELEASING.md](../RELEASING.md) into one guided flow with stops at every destructive moment: CHANGELOG diff, branch + PR, release publish. After publish, you watch the marketplace auto-bump workflow (the action that runs in `Jbrawner/claude-skills` and updates `marketplace.json` so `/plugin update tld@claude-skills` users get the new version) and report whether it succeeded.

This is a local-git + `gh` (the GitHub CLI) skill. It does not touch Linear, does not read `.tld/campaign.md`, and writes only to this repo plus GitHub Releases.

## Inputs

- **Optional argument** — one of `patch`, `minor`, `major`, or an explicit version like `v0.2.0` / `0.2.0` (leading `v` is added if missing).
- **No argument** → suggest a bump in step 3 based on what's in the `[Unreleased]` CHANGELOG section, then confirm via AskUserQuestion.

You read on your own:
- `CHANGELOG.md` — to find the previous version, classify the bump, and rewrite the `[Unreleased]` section.
- `git status --porcelain` and `git rev-parse --abbrev-ref HEAD` — for safety checks.
- `gh auth status` — to confirm `gh` can talk to GitHub.

## Process

### 1. Safety checks

Run all of these in order. Stop on the first failure — refuse loudly rather than do something irreversible.

a. **Working tree is clean.** `git status --porcelain` must be empty. If not:

```
🛑 Refusing to release — working tree has uncommitted changes.

{git status --porcelain output}

Commit, stash, or discard before running /tld-release. This skill never silently drops work.
```

b. **On the default branch.** `git rev-parse --abbrev-ref HEAD` must equal `main` (or `master` if the repo has no `main`). If not:

```
🛑 Refusing to release — not on the default branch.

Currently on: {branch}
Default branch: {main}

Releases must be cut from {main}. Switch with `git checkout {main}` and re-run /tld-release.
```

c. **`gh` is authenticated.** Run `gh auth status`. On non-zero exit:

```
🛑 `gh` is not authenticated — required for opening the release PR and creating the GitHub Release.

Run `gh auth login` and re-run /tld-release.
```

d. **Local main is up to date.** Run `git pull --ff-only`. If it fails (diverged), report the git error verbatim and stop. Do not force or rebase.

### 2. Read the previous version

Open `CHANGELOG.md` and find the topmost line matching `^## \[v(\d+)\.(\d+)\.(\d+)\]` — the most recently released version. Capture as `{prev-version}` (e.g., `v0.1.0`).

If no such line exists, this is the first release. Use `v0.0.0` as `{prev-version}` for bump-type calculation purposes only.

### 3. Determine the new version

Three paths:

**a. User passed `patch`, `minor`, or `major`:** apply the bump.

| Bump | Effect on `vX.Y.Z` |
|---|---|
| `patch` | `Z` increments by 1 |
| `minor` | `Y` increments by 1, `Z` resets to 0 |
| `major` | `X` increments by 1, `Y` and `Z` reset to 0 |

**b. User passed an explicit version (e.g., `v0.2.0` or `0.2.0`):** validate it parses as `vX.Y.Z`, prepend `v` if missing, and confirm it is strictly greater than `{prev-version}` (semver compare). If not, stop and report.

**c. No argument:** classify what's in `[Unreleased]` and suggest a bump:

- If `### Added` has any entries → suggest **minor** (selected by default)
- Else if `### Removed` or `### Changed` has entries hinting behavior change (loose check: contains `breaking`, `removed`, `renamed`) → suggest **minor**
- Else if only `### Fixed` has entries → suggest **patch**
- If `[Unreleased]` is empty under all four headers → stop:
  ```
  🛑 [Unreleased] section in CHANGELOG.md is empty — nothing to release.
  Add entries under ### Added / ### Changed / ### Fixed first, then re-run /tld-release.
  ```

Then call `AskUserQuestion` with three options (`patch`, `minor`, `major`) ordered with the suggested option first and labeled `(Suggested)`. The "Other" fallback accepts an explicit `vX.Y.Z` string.

Capture the result as `{new-version}` (always in `vX.Y.Z` form, no `-alpha` suffix).

### 4. Draft the CHANGELOG edit

Compute `{today}` as today's date in `YYYY-MM-DD`.

The edit:

1. Rename the line `## [Unreleased]` → `## [{new-version}] — {today}`.
2. Insert a fresh empty `[Unreleased]` block immediately above it so the next release has a landing area:
   ```markdown
   ## [Unreleased]

   ### Added

   ### Changed

   ### Fixed

   ### Removed

   ## [{new-version}] — {today}
   ```
3. At the bottom of the file (the version-link footer), insert above the existing `[{prev-version}]: ...` line:
   ```
   [{new-version}]: https://github.com/Jbrawner/tld-skills/releases/tag/{new-version}
   ```

Build the diff in memory; do not write yet.

### 5. Compose release notes

Build the release notes for `gh release create` from the new version's CHANGELOG section (everything between `## [{new-version}] — {today}` and the next `## ` header). Trim empty `### Added / ### Changed / ### Fixed / ### Removed` subsections — only include subsections that have entries.

### 6. Present everything for review (HARD STOP)

Show the user:

```
## Proposed release: {new-version}

**Previous version:** {prev-version}
**New version:** {new-version}
**Date:** {today}
**Build tarball?** {yes if user passed --with-tarball, else no — confirm in step 9 if not specified}

### CHANGELOG.md edit (preview):

{the unified diff of the proposed CHANGELOG edit}

### Release notes (used by `gh release create`):

{composed release notes from step 5}

### What happens after approval:

1. Cut branch `release/{new-version}`
2. Commit CHANGELOG bump
3. Push and open PR titled "Release {new-version}"
4. STOP and wait for you to merge the PR (so you can watch CI)
5. After merge confirmation: pull main, (optionally build tarball), `gh release create {new-version}`
6. Watch the marketplace auto-bump workflow and report the result
```

**HARD STOP.** Wait for an approval keyword (see [STANDARDS.md § Approval keyword set](../STANDARDS.md#approval-keyword-set) for the full list — `approve`, `commit`, `lgtm`, `looks good`, `ship it`, `go`, `proceed`, or the bare `1` from the options block). Silence is not approval.

### 7. Cut the release branch + commit + PR

After approval:

1. `git checkout -b release/{new-version}`
2. Apply the CHANGELOG.md edit from step 4.
3. `git add CHANGELOG.md`
4. `git commit -m "chore(release): {new-version}"` (no co-author trailer — personal repo)
5. `git push -u origin release/{new-version}`
6. `gh pr create --title "Release {new-version}" --body "{release notes from step 5}"`

Capture the PR URL.

### 8. Wait for the user to merge the PR (HARD STOP)

Output:

```
## PR opened: {pr-url}

Merge it when CI is green. Reply with an approval keyword when merged, or `cancel` to stop.
```

**HARD STOP.** Wait for an approval keyword OR `cancel`. On `cancel`, stop and leave the PR open.

On approval:
1. `git checkout {main}`
2. `git pull --ff-only` — confirms the merge landed.
3. Verify `git log -1 --pretty=%s` includes `chore(release): {new-version}` (the squash-merge subject). If not, warn and ask whether to continue.

### 9. (Optional) Build the tarball

Skip if the user explicitly declined at step 6. Otherwise ask via AskUserQuestion: build a tarball? (Default **No** — the marketplace install path doesn't need it.)

If yes:

```bash
bash scripts/build-plugin.sh
tar -czf dist/tld-plugin-{new-version}.tar.gz -C dist tld-plugin
```

If the script fails, report the error and stop. The release branch is merged but no GitHub Release exists yet — re-run `/tld-release` to retry the publish step, or publish by hand per [RELEASING.md](../RELEASING.md).

### 10. Publish the release

Run:

```bash
gh release create {new-version} --target main \
  --title "{new-version} — {short summary derived from the first ### Added bullet, truncated to 60 chars}" \
  --notes "{release notes from step 5}"
```

Append `dist/tld-plugin-{new-version}.tar.gz` as a positional argument if step 9 ran.

Capture the release URL.

### 11. Watch the marketplace auto-bump workflow

Poll `gh run list --repo Jbrawner/tld-skills --workflow=update-marketplace.yml --limit 1 --json status,conclusion,databaseId,url` every 10 seconds. Stop polling when `status` is `completed` or after 5 minutes (30 polls), whichever comes first.

- **Success** (`conclusion: success`): get the auto-PR URL via `gh pr list --repo Jbrawner/claude-skills --state merged --search "Bump tld to {new-version}" --json url --limit 1` and include it in the report.
- **Failure** (`conclusion: failure` or other non-success): include the run URL and point at [RELEASING.md § If the workflow fails](../RELEASING.md#if-the-workflow-fails) for recovery steps.
- **Timeout** (still in_progress after 5 min): include the run URL and tell the user to check on it manually.

### 12. Report

```
## Released {new-version}

**Release:** {release-url}
**Release branch PR:** {pr-url} (merged)
**Marketplace auto-bump:** {success: linked PR / failure: workflow URL + recovery hint / timeout: workflow URL}
**Files touched:**
- `CHANGELOG.md`
{if tarball built: - `dist/tld-plugin-{new-version}.tar.gz`}

Users running `/plugin update tld@claude-skills` will get {new-version}.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 13. Present options

---

**What's next?**

> **1.** /tld-recenter — cut a new branch off main to start the next thing
>    Best for: standard flow — release is out, time to move on

> **2.** /tld-dashboard — see project status before picking next work
>    Best for: orient before starting a new ticket

> **3.** Nothing — leave it here
>    Best for: the release was the goal; come back later

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

## Edge cases

**No `[Unreleased]` section in CHANGELOG.md:** stop and report. Don't try to create one — that suggests something is off about the file shape that the user should look at.

**Version-link footer is missing or out of order:** add the new entry at the very bottom and report it (don't try to re-sort the whole footer).

**`gh release create` fails after PR merged:** the bump is in main but no Release exists. Surface the gh error verbatim. Recovery: run `gh release create {new-version} --target main --title "..." --notes "..."` manually — re-running `/tld-release` will refuse because [Unreleased] is now empty.

**Marketplace workflow PAT expired:** the workflow will fail. Per [RELEASING.md § PAT rotation](../RELEASING.md#pat-rotation), the user needs to rotate `MARKETPLACE_PAT`. Surface this as the recovery hint in step 11.
