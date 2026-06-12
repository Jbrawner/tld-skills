---
name: npc-full
description: |
  NPC ("no preview check") — full uninterrupted flow for content/doc tickets that skip testing entirely. Use this skill whenever the user says "npc-full", "npc full", "build commit next no stop", or wants to run /tld-build → commit → /tld-next end-to-end with no review pause, skipping /tld-run-test. Designed for doc-only or content tickets where the campaign test command is "skip" and you trust the build enough to land it without a manual diff check. No stop gap between commit and /tld-next — only a single hard stop at the very end before the next /tld-setup.
---

# NPC Full

Run the content-ticket loop end-to-end with no review pauses: implement, commit, mark Done, surface the next ticket. Intentionally skips `/tld-run-test` (no signal on `skip`-commanded content tickets) and the `/npc-partial` diff-review pause. Use this when you trust the build and just want the loop to keep moving.

## When to use this

- The active ticket is a doc, guide, content, or markup change where the campaign Test Commands are `skip`
- You've already run `/tld-setup` and exactly one In-Progress ticket is loaded
- You're confident enough in the build to skip the diff-review pause `/npc-partial` provides

Trigger phrases: `npc-full`, `npc full`, `npc full flow`, "full flow", "build commit next no stop".

**Use `/npc-partial` instead** if you want a single hard stop between build and commit so you can eyeball the uncommitted diff before anything lands. `/npc-full` does not pause there.

## Inputs

What the user provides:
- Nothing — the active In-Progress ticket is the implicit input

What you read on your own:
- The In-Progress ticket from the issue tracker (mirroring `/tld-build` and `/tld-next` resolution)
- `.tld/campaign.md` for the commit format (Pattern + Co-author trailer)

## Process

### 1. Verify the active ticket

Resolve "me" via the tracker's current-user call, then query the configured project for issues that are In Progress AND assigned to me (see docs/ADAPTERS.md for Linear, docs/JIRA.md for Jira).

**Case A — exactly one In-Progress ticket assigned to me:** That is the current ticket. Load it for full description / AC / files / milestone.

**Case B — zero In-Progress tickets assigned to me:** Stop and output:
  "No In-Progress ticket found. Run /tld-setup to pick one up."
Do not guess, do not walk milestones — that is /tld-setup's job.

**Case C — two or more In-Progress tickets assigned to me:** Stop and call `AskUserQuestion` with one option per ticket (each option's label = ticket ID + title). Question text: "Multiple tickets are In Progress — pick the one to act on." Do not guess.

If the tracker is unreachable at any step, stop and output:
  "Cannot reach the issue tracker — aborting. No offline mode."
Do not fall back to cached state; there is none.

### 2. Invoke /tld-build

Run the `/tld-build` skill end-to-end. It writes the implementation; it does not commit. If `/tld-build` reports a failure (build error, scope creep flag, retry-cap hit), stop and surface the failure — do NOT commit a broken build, even though `/npc-full` is the no-pause variant. The pause is skipped on green builds; failures still abort.

### 3. Stage and commit

After `/tld-build` completes, stage only the files modified by `/tld-build` (do NOT use `git add -A` or `git add .`). Build the commit subject from the campaign's Commit format `Pattern` field with the active ticket ID and title substituted. Use `feat({prefix}-{N}): {ticket title} — NPC` if the campaign Pattern is the default `feat({prefix}-XXX): title`, otherwise follow the campaign Pattern as-written and append ` — NPC` to the title. The `— NPC` suffix marks the commit as an NPC-flow landing (no test verification was run); do NOT use `— TLD verified` since the verify phase was deliberately skipped. Append the campaign's `Co-author` trailer if one is configured. Never use `--amend`.

`/npc-full` skips the diff-review pause by design — once `/tld-build` reports a green build, the commit lands. There is no in-skill approval gate. If a user types `approve`, `commit`, `lgtm`, `looks good`, `ship it`, `go`, `proceed`, or `1` after build (the canonical approval keyword set — see [STANDARDS.md § Approval keyword set](../STANDARDS.md#approval-keyword-set)) it has no effect here because the commit has already happened. The keyword set still applies if the user types it at the final "What's next?" block to invoke option 1.

Show the user the commit short SHA and subject inline. Proceed directly to step 4 — there is no review pause.

### 4. Invoke /tld-next

Run `/tld-next` immediately after the commit. It marks the ticket Done in the tracker, resolves what's next from the milestone's tracker-defined ticket order (Linear `## Order` or Jira rank — `/tld-next` handles both paths), and surfaces either the next ticket or a milestone-gate command.

### 5. Surface the next setup command

`/tld-next` already prints the next command. Echo it back at the bottom of your output along with a one-line reminder to run `/clear` before the next setup so the new ticket starts on a fresh context.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

## Output

```
## NPC Full — Done

**Ticket:** {prefix}-{N} — {title}
**Commit:** {short-sha} — {subject}
**Next:** /tld-setup {next-id}   (or /tld-gate {milestoneId} if the milestone just completed)

Run `/clear` then paste the command above to start the next ticket.
```

**Never emit the literal text `{milestoneId}` or `{next-id}` to the user** — substitute the actual values BEFORE rendering. If `/tld-next` could not capture the milestone id, fall back to a no-arg `/tld-gate` and warn the user explicitly.

---

**What's next?**

> **1.** Start next ticket with clean context (Recommended)
>    Best for: standard flow — `/clear`, then run the `/tld-setup {next-id}` command shown above (or `/tld-gate {milestoneId}` if the milestone just completed)

> **2.** /npc-partial — slower variant with a diff-review pause
>    Best for: less-confident builds where a diff check is worth a beat

> **3.** /tld-dashboard — review milestone progress first
>    Best for: want a bird's-eye view before continuing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke /tld-setup or any other skill. Wait for the user to pick an option or type a command.**
