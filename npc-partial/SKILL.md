---
name: npc-partial
description: |
  NPC ("no preview check") — partial flow for content/doc tickets that skip testing entirely. Use this skill whenever the user says "npc-partial", "npc partial", "build then pause then commit", or wants to run /tld-build → STOP for manual QA on the uncommitted diff → commit + /tld-next in one shot, skipping /tld-run-test. Designed for doc-only or content tickets where the campaign test command is "skip" and the only verification is a manual eye on the diff. The hard stop sits between build and commit so you can review (and amend / discard) before anything lands.
---

# NPC Partial

Run the content-ticket loop as a near-one-liner: implement the ticket, pause for a manual diff review on the *uncommitted* changes, then on approval commit and immediately mark the ticket Done. Intentionally skips `/tld-run-test` because test commands on content/doc tickets are `skip` — the gate adds no signal. The single hard stop sits at the moment that matters: between build and commit.

## When to use this

- The active ticket is a doc, guide, content, or markup change where the campaign Test Commands are `skip`
- You've already run `/tld-setup` and exactly one In-Progress ticket is loaded
- You want the build → review → commit → next loop without per-step prompting, but with a single QA pause on the uncommitted diff before anything lands

Trigger phrases: `npc-partial`, `npc partial`, `npc partial flow`, "partial flow", "build pause commit next", "build then qa then commit".

**Use `/npc-full` instead** if you trust the build enough to skip the diff-review pause and want the loop to keep moving from build straight through commit and `/tld-next` with no stops.

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

Run the `/tld-build` skill end-to-end. It writes the implementation; it does not commit. If `/tld-build` reports a failure (build error, scope creep flag, retry-cap hit), stop and surface the failure — do not proceed to step 3.

When `/tld-build` finishes cleanly, the working tree has the new changes uncommitted and ready for review.

### 3. HARD STOP for manual QA on the uncommitted diff

Pause and tell the user:

> Build complete. The diff is uncommitted — review it now (`git diff`, browser preview, your eyes) before I commit and mark the ticket Done.
>
> Type `approve`, `commit`, `lgtm`, `looks good`, `ship it`, `go`, `proceed`, or `1` to commit and run /tld-next. Anything else stops here so you can amend the working tree manually.

Wait for an approval keyword (see `STANDARDS.md § Approval keyword set` for the canonical list — `approve`, `commit`, `lgtm`, `looks good`, `ship it`, `go`, `proceed`, or the bare `1`). Silence is not approval. Questions are not approval. If the user asks for changes, abort the npc flow — they edit the working tree manually, then run `/tld-commit` + `/tld-next` (or `/npc-full` again, depending on what they did) themselves.

### 4. Stage and commit

After approval, stage only the files modified by `/tld-build` (do NOT use `git add -A` or `git add .`). Build the commit subject from the campaign's Commit format `Pattern` field with the active ticket ID and title substituted. Use `feat({prefix}-{N}): {ticket title} — NPC` if the campaign Pattern is the default `feat({prefix}-XXX): title`, otherwise follow the campaign Pattern as-written and append ` — NPC` to the title. The `— NPC` suffix marks the commit as an NPC-flow landing (no test verification was run); do NOT use `— TLD verified` since the verify phase was deliberately skipped. Append the campaign's `Co-author` trailer if one is configured. Never use `--amend`.

Show the user the commit short SHA and subject before continuing.

### 5. Invoke /tld-next

Immediately after the commit, run `/tld-next`. It marks the ticket Done in the tracker, resolves what's next from the milestone's tracker-defined ticket order (Linear `## Order` or Jira rank — `/tld-next` handles both paths), and surfaces either the next ticket or a milestone-gate command.

### 6. Surface the next setup command

`/tld-next` already prints the next command. Echo it back at the bottom of your output along with a one-line reminder to run `/clear` before the next setup so the new ticket starts on a fresh context.

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

## Output

```
## NPC Partial — Done

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

> **2.** /npc-full — same loop without the QA pause
>    Best for: confident in the next build, want to skip the diff-review stop

> **3.** /tld-dashboard — review milestone progress first
>    Best for: want a bird's-eye view before continuing

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke /tld-setup or any other skill. Wait for the user to pick an option or type a command.**
