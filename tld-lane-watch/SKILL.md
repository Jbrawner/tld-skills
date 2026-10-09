---
name: tld-lane-watch
description: |
  Watch several parallel lane sessions (each driving a /goal through /tld-full-auto) on a loop
  until every lane posts its wake-up report or a deadline passes, then stop. Observe and report
  only: each tick reads the bytes each transcript added, checks liveness, blocking questions,
  stacks, PRs, Done-before-merge, method, safety and a merge freeze, and posts one compact
  report with a lane table, new flags and the user's open asks. Use when the user says
  "tld-lane-watch", "watch the lanes", "monitor the lanes", "babysit the lanes overnight",
  "keep an eye on lanes 1 to 4", or starts a /loop over lane sessions.
---

# TLD Lane Watch

You watch a set of lane sessions that run goals in parallel, and you tell the user what each lane is doing, what went wrong and what is waiting on them. You never act in a lane. The skill has two modes: `start` sets the watch up, schedules the loop and runs the first tick; `tick` is one pass, fired by the loop. Everything the loop needs between ticks lives in a state folder in the scratchpad, so a tick after a context compaction picks up where the last one stopped.

## When to use this

- "tld-lane-watch", "watch the lanes", "monitor lanes 1 to 4", "babysit the lanes overnight"
- The user has opened two or more lane sessions with /goal blocks (usually from `/tld-goal-handoff`) and is going away
- `/tld-lane-watch tick` is the prompt the loop fires; the user does not type it

## Inputs

What the user provides at `start` (ask once with AskUserQuestion for anything missing; never guess):

| Input | Example | Default |
|---|---|---|
| Lane title prefix | `Lane` (matches "Lane 1" to "Lane 4") | `Lane` |
| Stop deadline | Sat 9 AM local | none: ask |
| Merge freeze | Fri 11 PM local | none: no freeze check |
| Lanes on hold | Lane 4 | none |
| Nudge a stalled lane | yes / no | no |

What you read on your own:
- `list_sessions` (the session-management MCP) for each lane's session id, title, cwd and isRunning. Find lanes by title, never by folder: worktrees are recycled, so a folder can belong to another lane.
- The newest `.jsonl` under `~/.claude/projects/<cwd with / turned into ->/` for each lane: its transcript.
- The repo's `CLAUDE.md` and `~/.claude/CLAUDE.md` for the production identifiers (project refs, prod hosts) that feed the safety check.
- `.tld/stacks.md` in the main checkout, if present: the stack ledger (which lane holds which local database stack).

## Process

### Mode `start`

1. **Build the lane map.** For each session whose title starts with the prefix: lane number, session id, cwd (worktree), transcript path, current byte size. Print it as a table and confirm it with the user. A lane on hold is listed but is excluded from the stop condition.
2. **Write the state folder** `<scratchpad>/lane-watch/`:
   - `state.json`: lane map, deadline, freeze, held lanes, nudge setting, safety pattern, cron id.
   - `sizes.txt`: `lane path bytes epoch`, one line per lane: the byte offset each tick reads from.
   - `notes.md`: one short entry per tick.
   - `questions.md`: the asks log, one row per ask (`| Q<n> | Lane | Ticket | Ask | Lane's pick | open/answered |`).
   - `scan.py`: the transcript reader below.
3. **Schedule the loop** with CronCreate, recurring, every 30 minutes at an off-minute (`7,37 * * * *`), prompt `/tld-lane-watch tick`. Say that it is session-only, needs the app open on an awake Mac, and expires after 7 days.
4. **Run the first tick** now.

`scan.py` reads only the bytes added since the last tick (transcripts pass 50 MB; never read a whole one):

```python
import sys, json, re
path, offset, pattern = sys.argv[1], int(sys.argv[2]), sys.argv[3]
with open(path, 'rb') as fh:
    fh.seek(offset); raw = fh.read()
lines = raw.split(b'\n')[1:] if offset else raw.split(b'\n')   # drop a partial first line
last_text = last_user = None
for l in lines:
    try: d = json.loads(l)
    except Exception: continue
    ts, msg = d.get('timestamp', ''), d.get('message') or {}
    content = msg.get('content') if isinstance(msg.get('content'), list) else []
    if d.get('type') == 'user' and isinstance(msg.get('content'), str):
        last_user = (ts, msg['content'][:300])
    for x in content:
        if x.get('type') == 'text' and d.get('type') == 'assistant':
            last_text = (ts, x['text'])
        if x.get('type') != 'tool_use': continue
        name, inp = x.get('name', ''), x.get('input', {})
        if name == 'Skill': print('SKILL', ts, inp.get('skill'), inp.get('args', '')[:80])
        flat = json.dumps(inp)
        if name.endswith('transitionJiraIssue') or ('acli' in flat and 'transition' in flat):
            print('TRANSITION', ts, flat[:200])
        if name == 'Bash':
            cmd = inp.get('command', '')
            if re.search(r'git commit', cmd): print('COMMIT', ts, cmd[:120])
            if re.search(r'gh pr (merge|create)', cmd): print('PR', ts, cmd[:160])
            if re.search(pattern, cmd): print('SAFETY', ts, cmd[:300])
print('LAST_TEXT', *(last_text or ('-', '')))
print('LAST_USER', *(last_user or ('-', '')))
```

### Mode `tick`

Read `state.json`. For each lane, run `scan.py <transcript> <offset> <pattern>`, then run the checks:

| # | Check | Flag when | Before flagging |
|---|---|---|---|
| 1 | Alive | STOPPED: `list_sessions` shows `isRunning` false, no suite runs in the lane's worktree, and its last turn is neither a wake-up report nor a question to the user. Nothing will wake it, so flag it at once. STALLED: transcript bytes flat 45+ minutes | `isRunning` false alone is normal: a lane waiting on a background suite has ended its turn and wakes when the suite finishes. Check `ps` for vitest, jest, playwright with the lane's worktree as cwd. For flat bytes, also rule out a sleeping Mac (`pmset -g log`). A slow suite is not a stall. |
| 2 | Blocked | The last turn asks the user something, or the goal re-fires with no new tool calls (it bills every re-fire) | Read the lane's own user turns since the question: the user may already have answered in the lane. |
| 3 | Stacks | Two lanes on one stack, a held lane on a stack, a claimed container down | Read the ledger rows and `docker ps`. |
| 4 | PRs | A lane PR that is CONFLICTING (it runs no CI at all), has a red check, has `ci:run` on with more than 2 check runs, or sits open 3+ hours with no push | `gh pr list --state open --json number,headRefName,mergeable,labels,statusCheckRollup,updatedAt` |
| 5 | Done before merge | A Done transition whose PR is not MERGED, or whose time is before the merge | Closing a ticket as "already fixed by merged PR #N" is not a flag. |
| 6 | Method | A commit with no `/tld-full-auto` Skill call before it in the lane | Check the Skill calls in earlier ticks' notes too. |
| 7 | Safety | A Bash command (tool inputs only) matching the safety pattern | Read the match. Harmless: the word inside a `grep` pattern, `git tag -l`, `--force` removing a scratchpad temp worktree. |
| 8 | Freeze | A lane merge after the freeze time | Compare the PR's `mergedAt`, not the command time. |

The safety pattern always includes `supabase db reset`, `db push`, `supabase migration (list|repair)` without `--local`, `gh variable`, `git push` to the default branch, `--force`, `git tag` and any env file holding a password, plus every production identifier from the CLAUDE.md files.

Then detect the **wake-up report**: the lane's last long assistant text says its goal is finished (all units merged, parked or rolled) and the lane went idle. Read it in full and add every ask it lists to `questions.md` as a new row.

**Stalled-lane nudge** (only if the user turned it on at `start`): one neutral `send_message` saying how long the lane has been quiet and asking it to resume its goal or say what it is waiting on. One per stall; still flat next tick means flag it instead. Never nudge a lane whose last turn asks the user something.

**Stop** when every lane not on hold has posted its wake-up report, or at the deadline: CronDelete the job, one PushNotification with the outcome, then the final report.

Write the tick to `notes.md` and the new sizes to `sizes.txt` last, so a tick that dies part-way is re-read whole next time.

### Rules you hold to

| Rule | Why |
|---|---|
| Never message, steer, stop or restart a lane (the opt-in nudge is the only exception). Never edit files, tickets, PRs or the stack ledger. Never open an env file. | The lanes own their work; a watcher that acts becomes a fifth lane nobody is watching. |
| A pick the user makes goes into the lane as their own words: give them a one-line paste per lane. | Lanes refuse a pick relayed from another session, even with the user's words quoted. A relay can carry information only. |
| Before telling the user to paste something into a lane, read the lane's recent user turns. | They may already have pasted it; telling them twice costs trust. |
| A step the auto-mode classifier blocks inside a lane (a test-file edit, a database reset) is not fixed by a pick. Offer the real workarounds: an allow rule in the lane worktree's settings, or the user runs the command. | A pick does not move the classifier. |
| A flag already reported stays silent until it changes. | Repeating it every 30 minutes trains the user to skip the report. |
| Merged to the default branch means **not deployed**, in those words. | Merging deploys nothing in a tag-released repo. |

## Output

Every tick is one post. It opens with a single horizontal rule and a time heading, and nothing else in the post uses a rule: the line marks where one post ends and the next begins. Sections inside the post get bold labels.

```
---

**HH:MM: lanes**

| Lane | Now | Done this goal | Left | Last activity |
|---|---|---|---|---|
| 1 | Unit 5, PR #N, waiting on CI | 4 of 5 units merged (#a, #b, #c, #d), 25 tickets Done | Unit 5: 4 tickets | 9 min ago |
| 2 | Finished, idle | 3 of 3 units merged | Nothing; 1 ticket parked with you | Wake-up report at HH:MM |
| 4 | On your hold | | | |

{All clear: one line, "HH:MM: N lanes OK", plus anything that landed}

**Flags** (only new or changed ones)

| Lane | Flag | Evidence | What you should do |
|---|---|---|---|

**Asks waiting for you** (one row per ticket, one table per group, only the groups that have rows)

**Close (n)**

| Ticket | Do | Why |
|---|---|---|

**Rule (n)**

| Ticket | Do | Note |
|---|---|---|

**Give input (n)**

| Item | Do | Note |
|---|---|---|

**Triage (n)**

| Ticket | Note |
|---|---|

**Glance (n)**

| Item | Note |
|---|---|

{the What's next block at the end of this file}
```

- The lane table appears in every post, every lane, every time; what changed since the last tick goes in the Now cell.
- Never put several tickets in one cell. Every ticket key is a link that carries its title; fetch titles you do not have rather than printing a bare key.
- A post with a new flag also sends one PushNotification, one line per flag, under 200 characters.
- The post ends with the What's next block below and nothing after it. When the tick has its own step for the user (answer an ask here and get a one-line paste for a lane, look at a flag), put it first as option 1, marked Recommended, and renumber the standard options after it. Every option is one you can carry out yourself.
- `questions.md` rows always have all six cells; an empty cell stays empty rather than being dropped.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** `/tld-lane-watch tick` — run one pass now instead of waiting for the loop
>    Best for: you just came back and want the current state

> **2.** `/tld-goal-handoff` — compose the next goal for a lane that posted its wake-up report
>    Best for: an idle lane that should start its next run

> **3.** Nothing — let the loop keep running
>    Best for: the lanes are healthy and you are stepping away

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
