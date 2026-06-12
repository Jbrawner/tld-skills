---
name: campaign-portless
description: |
  Set up portless so this repo (or this worktree) gets a stable `<name>.localhost:1355` URL
  for its dev server. Use this skill whenever the user says "campaign-portless",
  "campaign portless", "set up portless", "give this worktree a URL", "fix my localhost",
  "stable dev URL", or wants every project / worktree to have its own non-conflicting
  localhost URL. Idempotent — first run on a machine installs portless, trusts certs, and
  starts the proxy; subsequent runs in a new repo or worktree just register the alias and
  write `.claude/launch.json`. Works in a regular repo or a git worktree; does not require
  `.tld/campaign.md`.
---

# Campaign Portless

You are wiring up [portless](https://github.com/conradludgate/portless) — the tool that gives every dev server a stable `<name>.localhost:1355` URL through a single local HTTPS proxy — for the current repo or worktree. Goal: the user runs this once per project and never has to think about port numbers, port collisions, or which worktree owns which URL again.

This skill is **idempotent** at every layer. First run on a fresh machine installs portless, trusts the local CA, syncs `/etc/hosts`, and starts the proxy daemon. Every later run skips the parts that are already done and only does the per-project bits (pick a name, pick a port, write `.claude/launch.json`, register the alias). Re-running in the same project is a no-op.

This skill is named `campaign-portless` to live alongside the other campaign-prefix project-setup skills (`/campaign-init`, `/campaign-test`), but it does NOT require `.tld/campaign.md` — portless is useful in any repo, TLD-tracked or not.

## When to use this

- User says any of: "campaign-portless", "campaign portless", "set up portless", "give this worktree a URL", "fix my localhost", "stable dev URL", "I want a URL for this project"
- User is in a new worktree and wants its own URL distinct from sibling worktrees
- User just cloned a repo and wants the dev server reachable at a friendly hostname instead of `localhost:3000`
- The dev server is already running but the user wants the same server also reachable through portless

## Inputs

What the user provides:
- Optional: a custom slug as the skill argument (e.g. `/campaign-portless my-project`). If omitted, the skill derives one — see step 5.

What you read on your own:
- `git rev-parse --is-inside-work-tree` and `git rev-parse --git-common-dir` to detect whether you're in a worktree
- `git branch --show-current` and `git rev-parse --show-toplevel` to derive a default name
- `package.json` (if present) to confirm the project type and pick a port range
- The main repo's `.env.local` (if you're in a worktree and the worktree is missing one) to decide whether a symlink is safe

## Process

### 1. Detect portless

Run `command -v portless`. If it prints nothing:

> Portless is not installed on this machine. I'm about to install it globally with:
>
> ```
> npm install -g portless
> ```
>
> Approve to proceed.

Wait for an approval keyword (see [STANDARDS.md § Approval keyword set](../STANDARDS.md#approval-keyword-set)). On approval, run the install. On any other response, stop and tell the user portless is required.

### 2. Detect the proxy

Run `portless list`. If the command exits non-zero or prints "proxy not running":

```
portless proxy start --https
```

(`--https` enables HTTP/2 + auto-generated certs. The portless docs note this gives faster page loads than plain HTTP.)

If the proxy is already running, skip this step.

### 3. Detect cert trust

Run `portless list` and check that the first line is not a TLS warning. If portless reports the local CA is untrusted (varies by version — also catch a non-zero exit from a probe `curl -sS https://localhost:1355`):

> Portless's local CA is not trusted by your system yet. I'm about to run:
>
> ```
> portless trust
> ```
>
> This will prompt for your sudo password (one time, ever). Approve to proceed.

Wait for an approval keyword. On approval, run the command.

### 4. Sync `/etc/hosts`

Run:

```
portless hosts sync
```

This is required for Safari (which does not honor wildcard `.localhost` resolution). Idempotent — adds entries that aren't already present and skips ones that are.

### 5. Pick a name

| Situation | Default name |
|---|---|
| User passed a slug as the skill argument | Use it verbatim, lowercased and hyphenated |
| Inside a git worktree (detected when `git rev-parse --git-common-dir` ≠ `.git`) | The worktree directory's basename, e.g. `laughing-gauss-57636f` |
| In a regular repo | The toplevel directory's basename, e.g. `footballtactics-ai`, lowercased and hyphenated |
| Nothing usable | Stop and ask for a name via AskUserQuestion |

Sanitize: lowercase, replace any non-`[a-z0-9-]` with `-`, collapse runs of `-`, strip leading/trailing `-`. Reject if empty after sanitization.

If `portless list` already shows an alias for this name pointing at a different port, ask the user whether to overwrite or pick a new name.

### 6. Pick a port

Read `.claude/launch.json` if it exists. If it has a configuration named `next-dev` (or the project's matching server name) with a `port` field, **reuse that port** — this keeps the URL stable across runs.

Otherwise, probe for the first free port starting at 3000 (skip 5000 and 7000 which macOS Control Center sometimes uses):

```
for port in 3000 3001 3002 ... ; do
  lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1 || { echo $port; break; }
done
```

Stop at the first hit. Remember this port — you'll write it to `.claude/launch.json` in step 8 and register it as the alias target in step 9.

### 7. Symlink `.env.local` to the main repo (and reconcile if stale)

Skip if not in a worktree (regular repo — env file lives where it lives).

In a worktree, determine the main repo path via `git rev-parse --git-common-dir`'s parent. If the main repo has no `.env.local`, skip (nothing to symlink to). Otherwise inspect what's in the worktree at `<worktree>/.env.local`:

| State at `<worktree>/.env.local` | Action |
|---|---|
| Already a symlink to `<main>/.env.local` | Skip — done |
| Already a symlink to something else | Surface to the user, ask whether to repoint |
| Missing | Create symlink (after the prod-URL safety check below) |
| Plain file, identical to main's `.env.local` (`diff` exit 0) | Replace with symlink — no data loss |
| Plain file, differs from main's `.env.local` | **HARD STOP.** Show the user the diff via `diff <main> <worktree>` and ask one of: (a) merge unique keys back into main's `.env.local` and then symlink (recommended when the unique keys are standard dev values like local-Supabase service-role JWTs, not per-developer secrets), or (b) leave as plain file (keeps stale-drift bug). Always back up the worktree's existing file to `<worktree>/.env.local.bak.<timestamp>` before any destructive change. |

**Prod-URL safety check** (run before any symlink creation):

Read the main repo's `.env.local` for keys ending in `_URL` or containing `URL`. If any value points at something that looks like production — non-`localhost` / non-`127.0.0.1` host, `.supabase.co` / `.vercel.app` / similar managed-service host — **HARD STOP**:

> The main repo's `.env.local` looks like it might point at production:
>
> ```
> NEXT_PUBLIC_SUPABASE_URL="https://abc123.supabase.co"
> ```
>
> I will NOT symlink this into the worktree. Either:
>   1. Replace the prod URL with a local one (e.g. `http://127.0.0.1:54421`) and re-run me, or
>   2. Create a worktree-specific `.env.local` by hand and re-run me.

Otherwise create the symlink:

```
ln -s {main-repo-path}/.env.local {worktree-path}/.env.local
```

**Why this matters:** `.env.local` is gitignored, so it doesn't update when a worktree pulls / rebases. If each worktree carries its own physical copy, a change in the main repo's `.env.local` (e.g., a new port a downstream tool listens on) silently fails to propagate. Symlinking makes the main repo's file the single source of truth and ends the drift class of bug entirely.

Also symlink `supabase/functions/.env.local` if present in the main repo and missing / stale in the worktree — same logic, same `*.local` gitignore reason.

### 8. Write or update `.claude/launch.json`

If `.claude/launch.json` does not exist, write the minimal version:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "next-dev",
      "runtimeExecutable": "bash",
      "runtimeArgs": [".claude/start-dev.sh"],
      "port": {chosen-port}
    }
  ]
}
```

…and write `.claude/start-dev.sh` (mode `0755`) with:

```bash
#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
exec npx next dev -p ${PORT:-3000}
```

If `.claude/launch.json` exists, parse it and update the `port` field of the matching configuration to the chosen port. Do not change the `name`, `runtimeExecutable`, or `runtimeArgs` — they are user-owned. If no matching configuration exists, append one.

If the project is not a Next.js app (no `next` in `package.json` dependencies), still write the launch.json but use a generic command — and warn the user inline that they may need to edit `.claude/start-dev.sh` for their stack (Vite, Astro, etc.).

### 9. Register the portless alias

Run:

```
portless alias {name} {port}
```

If `portless list` already shows the same `{name} -> {port}` mapping, skip — this command is idempotent in portless but skipping avoids a redundant log line.

### 10. Verify

Run:

```
curl -sS -k -o /dev/null -w "%{http_code}\n" https://{name}.localhost:1355
```

A `200`, `301`, `302`, `307`, `308`, or `404` is fine — it means the proxy answered (404 means the dev server isn't running yet, which is expected since the skill doesn't start it). Anything else (especially `000` / "Couldn't connect") is a failure — re-check the alias with `portless list` and surface the diagnostic.

## Output

```
## Portless wired: https://{name}.localhost:1355

**Name:** `{name}`
**Port:** `{port}` (persisted in `.claude/launch.json`)
**Worktree:** `{worktree-path}` ({"this is a worktree" or "regular repo"})
**Steps run this time:**
- {tick or skip}: install portless
- {tick or skip}: start proxy
- {tick or skip}: trust local CA
- {tick or skip}: sync /etc/hosts
- {tick or skip}: symlink .env.local from main repo
- {tick or skip}: write/update .claude/launch.json
- {tick or skip}: register alias

Start your dev server (e.g. `npm run dev`) and open the URL.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** `/campaign-portless {other-name}` — wire another worktree or project the same way
>    Best for: you have sibling worktrees that also need their own URL

> **2.** `/tld-setup` — start working on the next ticket
>    Best for: portless is set up; ready to ship code

> **3.** Nothing — you're done
>    Best for: setup complete, will start the server later

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
