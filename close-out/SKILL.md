---
name: close-out
description: |
  Ask this session "can I archive you, or is anything lingering?" and act on the answer. Checks
  for work archiving would lose (uncommitted files, unpushed commits), stop (background work,
  dev servers, side sessions still running) or leave hanging (an open PR, an unanswered
  question, an unfinished step, a ticket left In Progress, a follow-up with no ticket). Nothing
  lingering: it archives the session at once. Something lingering: one table of what lingers
  and what clears it, then numbered options. Use when the user says "close-out", "close out",
  "can I archive you", "anything lingering", "are we done here", "archive this session".
  The archive step needs the Claude desktop app.
---

# Close Out

The user runs this in a session they think is finished, usually while going down the sidebar closing sessions one at a time. Answer one question, "can I archive you, or is anything lingering?", from evidence rather than memory, and act on the answer.

Running `/close-out` is the user's agreement to archive this session when every check is clear. On the clean path, archive without asking again.

## When to use this

- "close-out", "close out this session", "can I archive you?", "anything lingering?", "are we done here?"
- The user is clearing finished sessions out of the sidebar.

This skill closes the session it runs in, and only that one.

## Step 1: Where this session stands

Call `get_session` with `self` for the working directory, worktree path, branch, source branch and whether the session is pinned. The repos to check are the working directory's repo plus every other repo this session changed files in, taken from the conversation. A folder that is not a git repo gets `n/a` in rows 1 to 3 and 7.

## Step 2: Run the checks

Read every row from evidence: a command, a tool result, or this conversation. Run the commands and tool reads in parallel. Each row comes out **Clear** or **Lingers**.

| # | Check | How to read it | Lingers when |
|---|---|---|---|
| 1 | Uncommitted files | `git -C <repo> status --porcelain` | Any line this session made. In a worktree, archiving removes the folder, or keeps it on disk where nothing points at it |
| 2 | Commits not pushed | `git -C <repo> log --oneline @{u}..HEAD`; with no upstream, `git -C <repo> log --oneline origin/<source branch>..HEAD` | Any line |
| 3 | Stashes this session made | `git stash list`, matched to the tags this session used | An entry this session pushed and never restored |
| 4 | Background work | This conversation's background commands and monitors that never reported an end; `CronList`; a /loop wakeup this session scheduled | Anything still running or scheduled |
| 5 | Dev servers | `preview_list` | A server this session started; archiving stops it |
| 6 | Side sessions | `list_sessions` with `linked: true` | A session this one started that is still running. Archiving takes the side sessions that share this worktree with it |
| 7 | Pull request | `gh pr list --head <branch> --state all --json number,title,state,url`, then `gh pr checks <number>` for an open one | A PR that is open. Merged, closed, or no PR with nothing to push is clear |
| 8 | Questions waiting on the user | This conversation | A question or a set of numbered options the user has not answered |
| 9 | Unfinished or unverified steps | The task list and this conversation | A step the user asked for that is not done, or was reported skipped or not verified, and no ticket carries it |
| 10 | Tickets and claims left mid-way | This conversation; `.tld/stacks.md` when the repo has one | A ticket this session moved to In Progress and never moved on, or a stack or lane this session claimed and never released |
| 11 | Follow-ups not captured | This conversation | Work this session called a follow-up, "for later" or a separate PR, with no ticket key and no session card |

How to read them:

- **Only this session's own work lingers.** Uncommitted files in a plain checkout that this session never touched belong to someone else: the row says so and stays clear.
- **Rows 8 to 11 come from the whole conversation**, back to the first user message (or the summary, when the context was compacted). The State cell quotes the question, names the step or gives the ticket key; "none found" from a skim does not count.
- **A command that fails is not clear.** Its error goes in the State cell and the row lingers until it is read.

## Step 3: Report

One table, every row:

| # | Check | State | Lingers? | What clears it |
|---|---|---|---|---|

- **State** is the evidence in a few words: "3 files in close-out/", "PR 99 open, checks green", "none".
- **What clears it** is one concrete action per lingering row, and `—` on a clear row. Examples: "commit and push the 3 files", "your answer: which lane takes the alerts work?", "file ticket: *Sweep mode for /close-out*". A ticket this would file is shown here by title; that title is its draft.
- **Unfinished work in rows 1 and 2** clears by parking it: commit it to this branch as work in progress, push the branch, and file a ticket naming the branch and what is left. Finished work clears by a plain commit and push. A commit follows the repo's own commit format and hooks.
- **Tickets go to the campaign's tracker** (`.tld/campaign.md`). With no campaign file, the action reads "say where the ticket goes".

### Nothing lingers

Print the table, then one line: `Nothing lingering. Archiving this session.` Then call `archive_session` with `session_id: "self"` and `reason: "close-out: nothing lingering"`. The conversation ends with that call, so write nothing after it.

A pinned session is not archived by the app. When `get_session` says pinned, skip the call and offer:

1. Unpin it and archive (Recommended)
2. Keep it

On 1, call `set_pinned` with `self` and `false`, then archive as above.

When the archive call comes back refused (the approval card was declined, the app keeps sessions that are open on screen, or work is still running), print the reason the call gave in one line. For work still running: wait for it, then run `/close-out` again. Otherwise the user archives it from the sidebar. In a client with no `archive_session` tool, print the table and say the user ends the session themselves.

### Something lingers

Print the table, one line saying what archiving now would lose or stop, then these options:

1. **Clear it, then archive.** Do every action in the What clears it column, run Step 2 again, and archive if it comes back clear. The option's text names the actions: "Commit and push the 3 files, stop the dev server, file the 1 ticket, then archive."
2. **Archive anyway.** Archive now; name what is lost or stopped in the option's text.
3. **Keep it open.** Change nothing.

Offer option 1 only when the session can do every action itself. A question only the user can answer (row 8) or a PR that needs a merge (row 7) keeps option 1 off the list.

Mark one option Recommended:

| What lingers | Recommended |
|---|---|
| Option 1 is on the list | 1 |
| A question waiting on the user | 3, and repeat the question under the options so the user can answer it there |
| Rows 1 to 3 (work that lives only on this machine) and option 1 is off the list | 3 |
| Only an open PR: the branch is pushed, its checks are green or still running, no Auto-fix watch | 2: the PR carries the work |
| Anything else | 3 |

When only an open PR lingers, read `get_settings`: with `auto_archive_on_pr_close` off, add one line under the options saying that with it on (Settings → Claude Code), the app archives sessions like this one when their PR merges.

Picking option 1 is the go for every action it names, the commit and push included. When the branch has an open PR, the option's text says the push updates that PR, so the pick covers that push too. The ticket titles in the table are the drafts the pick approves.

## Step 4: After the pick

- **1:** do the actions in table order, then run Step 2 again. All clear: archive as on the clean path, with `reason: "close-out: cleared, then archived"`. Anything still lingering: print the new table and stop, without archiving.
- **2:** call `archive_session` with `self` and `reason: "close-out: archived with <n> rows lingering"`.
- **3:** stop.

## Boundaries

- **This session only.** Never archive another session.
- **Keep the work.** A row clears by saving work: a commit, a push, a ticket. Every file, stash and branch stays where it is.
- **Stop at the push.** Merging stays with the user and the landing skills. The push goes to this session's own branch with the repo's hooks running; a hook that fails stops option 1 and is reported.
- **Ask nothing on the clean path.** The user's `/close-out` was the agreement.
