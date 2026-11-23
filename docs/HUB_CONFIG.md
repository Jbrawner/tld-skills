# Hub config (`.tld/hub.md`)

The canonical reference for the per-repo `.tld/hub.md` file that `/tld-hub` reads. Everything project-specific about running a hub lives here, so the skill itself names no product. When the skill and this document disagree, this document is the source of truth.

The file lives at `{main checkout}/.tld/hub.md`, one per repo, gitignored like `.tld/campaign.md`. A hub running in a worktree reads it from the main checkout (the first entry of `git worktree list`).

## Shape

One `## Hub` section of `- Key: value` bullets, the same style as `.tld/campaign.md`. Keys are matched case-insensitively; a value runs to the end of its line.

```markdown
# Hub: {Project name}

## Hub
- Lane prefix: {how every lane's session title starts: plain text, or a regex between slashes}
- Stack ledger: {path from the main checkout, or "none: <how lanes split the local stacks>"}
- Required checks: {check names main requires, comma-separated}
- Merge command: {command with <n> for the PR number}
- Auto-merge: {on | off}
- Production pattern: {regex of this project's production identifiers}
- Paid-call budget: {0 | a number | no ceiling: <where spending is allowed>}
- Notify rule: {built-in only | built-in, plus: <events>}

## Optional
- Hub title: {the hub session's title; default TLD hub}
- CI label: {label that switches PR checks on, e.g. ci:run; default none}
- Stall minutes: {minutes of no activity before a lane is looked into; default 20}
```

## Required settings

All eight must be present and filled. A missing file, a missing key or a blank value stops `/tld-hub` before it does anything, and the stop names each missing setting. A blank never gets a guessed value: a made-up merge command or production pattern looks legitimate and is worse than a stop.

| Setting | What it holds | How the hub uses it |
|---|---|---|
| Lane prefix | How every lane session's title starts. Plain text matches the start of the title: `Lane` matches "Lane 1" to "Lane 4". A regex between slashes is for lanes named by subject: `/^[^:]*\blane\b[^:]*:/` matches "Web lane: upload fixes" and "Pre-tag lane 2: tag order" | `start` builds the lane map from the sessions whose title matches. The hub title must not match it. |
| Stack ledger | The path, from the main checkout, of the file that says which worktree holds which local database stack, e.g. `.tld/stacks.md`. A repo without one writes `none:` and one line on how lanes share the stacks. | The stacks check reads its rows each tick. `close` relies on `/close-out` freeing a finished lane's row. |
| Required checks | The exact check names the default branch requires, comma-separated: the union of the ruleset's (`gh api repos/<owner>/<repo>/rules/branches/main`) and classic branch protection's (`gh api repos/<owner>/<repo>/branches/main/protection/required_status_checks`), since a repo can have both | `land` calls a PR green only when every one of these reads SUCCESS on the head commit. A check missing from the PR is not green. |
| Merge command | The command that merges a green PR, with `<n>` for its number, e.g. `gh pr merge <n> --squash --delete-branch` | `land` runs it when auto-merge is off, or when the PR is already green. |
| Auto-merge | `on` when the repository allows auto-merge and the user wants it used, else `off` | `on`: `land` sets auto-merge (squash) on the PR as soon as it is the open one in the queue. `off`: the hub merges on its own tick. |
| Production pattern | An extended regex of every production identifier: project refs, hosts, environment names, prod tag formats | Added to the built-in safety pattern for the safety check. Copy it from the repo's `CLAUDE.md` and `~/.claude/CLAUDE.md`. |
| Paid-call budget | `0` (lanes ask before any paid model call), a number (that many calls per hub run, then ask), or `no ceiling:` plus where spending is allowed | `refill` puts the rule in every brief; each tick reports the count the lanes report. |
| Notify rule | `built-in only`, or `built-in, plus:` and the extra events | The built-in events always notify (see below); this adds to them, never removes. |

The built-in notify events, which every hub sends as a push notification in the same turn it sees them:

| Event | Why it cannot wait for the next report |
|---|---|
| A green PR cannot merge | Nothing behind it lands until someone says the unblocking words. |
| The app paused messages between sessions | The lanes stop hearing from the hub. |
| A lane stalled past `Stall minutes` and the hub could not wake it | A stuck lane is silent, and silence looks like work. |
| The hub stops (all lanes done, deadline, or `close`) | The user is waiting for the outcome. |

## Optional settings

| Setting | Default | Notes |
|---|---|---|
| Hub title | `TLD hub` | The title `start` gives the hub session. A lane sees the hub's messages labelled `From "<Hub title>"`, and `/tld-goal-handoff` names this title in the picks bullet, so set it before composing the lanes' goals. A wave whose goals name the older `TLD lane watch` sets this to `TLD lane watch`. |
| CI label | none | When set, a lane's PR needs it for checks to run. `land` checks it is on the open PR and off any PR waiting in the queue. |
| Stall minutes | `20` | Minutes of flat transcript bytes, while the lane's task is unfinished, before the hub looks into it. |

## Examples

Two repos, as they stood on 2026-11-23. Each is that repo's whole `.tld/hub.md`.

### footballtactics-ai

```markdown
# Hub: Assman.AI

## Hub
- Lane prefix: /^[^:]*\blane\b[^:]*:/
- Stack ledger: none: the builder stack is 54421/54422; one more lane runs on lane 2 (54021/54022) with `. /Users/johnbrawner/Code/footballtactics-ai/.tld/lane-2-env.sh &&` in front of every DB, test and dev-server command
- Required checks: unit tests, e2e tests, deno tests, eslint, enforce changelog, build
- Merge command: gh pr merge <n> --squash --delete-branch
- Auto-merge: on
- Production pattern: tyvqtjqhwkobfmkzyope|web-prod|supabase-prod|web-v[0-9.]+-prod
- Paid-call budget: no ceiling: only where the diff changes what is sent to or read from a model; UI, copy, docs and test-only work is proved with stubs; report the count per provider after each run
- Notify rule: built-in only

## Optional
- Hub title: TLD hub
- Stall minutes: 20
```

Lanes here are named by subject ("Web lane: upload, Pro and walk-bug fixes", "Pre-tag lane 1: 988 fallback"), so the prefix is a regex; it does not match the hub's own title. The required checks are the ruleset's `unit tests` plus the five that classic branch protection adds. No `CI label`: every workflow runs on every pull request to main, and the repo has no `ci:run` label.

### lab-inventory

```markdown
# Hub: Labsistant

## Hub
- Lane prefix: Lane
- Stack ledger: .tld/stacks.md
- Required checks: enforce, check-order, Migration Carry-Forward Guard
- Merge command: gh pr merge <n> --squash --delete-branch
- Auto-merge: off
- Production pattern: pooeyppuyzvwgcbqctzm|labsistant\.com|demo\.labsistant\.com|sk_live_
- Paid-call budget: 0
- Notify rule: built-in, plus: a merge after 11 PM local on a release week

## Optional
- Hub title: TLD hub
- CI label: ci:run
- Stall minutes: 20
```

Auto-merge is off because the repository does not allow it (`allow_auto_merge` is false). The required checks come from the ruleset alone; main has no classic branch protection. Read them again before a wave, because a gate merged since this example applies to every PR.
