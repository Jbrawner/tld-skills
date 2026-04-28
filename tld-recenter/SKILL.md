---
name: tld-recenter
description: |
  Reset the working tree to a fresh branch cut from the latest `main`. Use this skill
  whenever the user says "tld-recenter", "recenter", "start clean", "new branch off
  main", or wants to abandon the current branch and start a new one from the latest
  main (typical flow: finished one PR, about to start a new ticket, want a clean base).
  If the user passes a branch name as the argument (e.g., `/tld-recenter feat/new-thing`),
  uses that name directly. If no argument is given, prompts via AskUserQuestion. Refuses
  to run when the working tree has uncommitted changes so nothing is lost.
---

# TLD Recenter

You are resetting the working tree to a fresh branch cut from the latest default branch (typically `main`). This is a one-shot git helper — it runs shell commands, does not touch Linear, and does not read `.tld/campaign.md`. Use it after merging a PR, before starting a new ticket, to make sure the next branch forks from an up-to-date base rather than a stale or orphan one.

## Inputs

- **Optional branch name as argument** (e.g., `/tld-recenter feat/some-branch`). Accepted verbatim — whatever the user typed is the new branch name.
- **No argument** → prompt for one via AskUserQuestion in step 3.

## Process

### 1. Safety check: no uncommitted changes

Run `git status --porcelain`. If the output is non-empty, stop and report:

```
🛑 Refusing to recenter — working tree has uncommitted changes.

{git status --porcelain output}

Commit, stash, or discard before running /tld-recenter. This skill never silently drops work.
```

Do not proceed. Exit the skill.

### 2. Detect the default branch name

Try, in order, until one succeeds:

1. `git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null` — if it returns something like `origin/main`, strip the `origin/` prefix and use what remains.
2. `git rev-parse --verify main 2>/dev/null` — if `main` exists, use `main`.
3. `git rev-parse --verify master 2>/dev/null` — if `master` exists, use `master`.
4. If all three fail, stop and report: "Could not determine the default branch. This repo has no `main` or `master` branch locally, and `origin/HEAD` is not set. Re-run with the default branch set explicitly, or run `git remote set-head origin -a`."

Call the result `{main}` for the rest of the flow. Also capture the current branch name as `{prev-branch}` via `git rev-parse --abbrev-ref HEAD` before the switch.

### 3. Get the new branch name

**If the user passed a branch name as the argument:** use it verbatim as `{branch}`. Skip to step 4.

**If no argument was given:** AskUserQuestion for the new branch name. Provide naming-pattern options as hints, plus the built-in "Other" fallback for free-text custom names:

- `feat/<describe>` — new features
- `fix/<describe>` — bug fixes
- `chore/<describe>` — cleanup, config, non-behavior changes

Take whatever the user enters, including via the "Other" fallback. Basic validation: reject empty strings and names containing whitespace. Re-ask once if invalid; on a second invalid response, abort with a short error.

### 4. Switch and pull

Run, in order, stopping on first failure:

1. `git checkout {main}` — fails if there are unmerged conflicts or the branch does not exist locally. On failure, report the git error verbatim and stop.
2. `git pull --ff-only` — fast-forward only. If the local `{main}` has diverged from `origin/{main}` (shouldn't happen in normal flow, but might if the user committed directly to main), the pull will refuse and you should report: "Local `{main}` has diverged from `origin/{main}`. Resolve manually — this skill does not force or rebase."

Capture the number of new commits pulled by diffing `HEAD` against the previous `{main}` tip (e.g., count commits in `{prev-main-sha}..HEAD`).

### 5. Create the new branch

Run `git checkout -b {branch}`.

**If it fails because the branch already exists**, do not auto-resolve. Present the user with AskUserQuestion:

1. **Check out the existing branch** — runs `git checkout {branch}` on the existing branch.
2. **Pick a different name** — re-prompt for a new name, then re-try step 5.
3. **Abort** — stop the skill. The working tree is on `{main}` with the pull applied; the user can decide what to do next.

### 6. Report

Output a clean summary:

```
## Recentered onto {branch}

- Pulled {N} commit(s) from origin/{main}
- Previous branch: {prev-branch}
- New branch: {branch} (tracking nothing yet)

Note: {prev-branch} still exists locally. Delete with `git branch -d {prev-branch}` if it was merged, or `git branch -D {prev-branch}` to force-delete. This skill leaves it alone so you don't lose work.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 7. Present options

---

**What's next?**

> **1.** /tld-setup — set up the next ticket on this clean branch (Recommended)
>    Best for: standard flow — you recentered specifically to start fresh work

> **2.** /tld-save-point — figure out where the overall project is before picking a ticket
>    Best for: returning after a break, not sure what ticket is next

> **3.** /campaign-show — review project config before diving in
>    Best for: double-check tracker / prefix / test commands look right

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**

## Edge cases

**User is already on `{main}`:** still run `git pull --ff-only`, then create the new branch. `{prev-branch}` will equal `{main}` — that's fine, report it as-is.

**No remote configured:** `git pull` will fail with a clear error. Report it verbatim; do not try to add a remote.

**Detached HEAD:** `{prev-branch}` will be the literal string "HEAD" or similar. Report whatever `git rev-parse --abbrev-ref HEAD` returns; the user will understand.

**Argument is a path-like string (contains `/`):** accept it. Branch names like `feat/foo` and `john/fix-bar` are standard.

**Argument starts with `-`:** reject as invalid to avoid flag injection into `git checkout -b`. Re-prompt.
