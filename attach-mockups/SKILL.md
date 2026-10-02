---
name: attach-mockups
description: |
  Attach a feature's mockup pictures to its Jira tickets: each ticket gets the PNGs its description
  names. Run it right after the tickets are created, in the same session; it reads the Epic and the
  mockup folder from the conversation. Builds the list and dry-runs it; the user runs the real upload.
  Jira only. Use when the user says "attach the mockups", "add the pictures to the tickets".
---

# Attach mockups

A feature designed on a canvas ends with a folder of mockup PNGs and a set of Jira tickets
whose descriptions name the PNGs each one needs. This skill puts the pictures on the tickets.
The Atlassian MCP cannot upload attachments, so the upload is a bundled script that signs in
with the user's own API token, and the user runs it in their own terminal.

The skill is built to run in the session that just created the tickets: that conversation
already holds the Epic and the folder, so the user types `/attach-mockups` and nothing else.

## Rules

- **You build the list and run the dry run. The user runs the real upload.** Run
  `attach-mockups.sh` only with `--dry-run`. Never read, ask for or handle the API token.
- **A ticket gets exactly the pictures its description names.** A ticket that names none gets
  nothing. One exception: an Epic whose description names no picture gets the folder's 01
  picture, the overview board. Never pick a picture for a ticket by judgment.
- **Report a missing file or an unused picture; never invent a match.**

## 1. Find the Epic and the folder

Take each value from the first place that has it:

1. **Arguments:** `/attach-mockups <EPIC-KEY> <folder>`, either or both.
2. **This conversation:** the Epic created for the feature, and the folder its mockup PNGs were
   exported to (the folder the tickets' Attach lines point at).
3. **Neither:** ask for whichever is missing with AskUserQuestion. Never guess from the newest
   folder or the newest Epic.

If `.tld/campaign.md` exists and names a tracker other than Jira, stop and output:
"`/attach-mockups` is Jira only. See LIMITATIONS.md."

## 2. Build the list

```bash
bash ~/.claude/skills/attach-mockups/build-list.sh <EPIC-KEY> "<folder>"
```

It reads the Epic, its Stories and their Sub-tasks from Jira through `acli` in one paginated
search, writes `<folder>/jira-attachments.tsv`, and prints the report. It sends nothing. When it
stops (acli not signed in, the key is not an Epic, the Epic has no tickets yet), relay its message
and end.

## 3. Dry run

```bash
bash ~/.claude/skills/attach-mockups/attach-mockups.sh "<folder>/jira-attachments.tsv" --dry-run
```

Its first line must give the same attachment and ticket counts as the report's Totals line.
If they differ, stop and say so.

## 4. Report and stop

Print, in this order:

1. The report's `Epic:` and `Folder:` lines, so a wrong pick shows first.
2. The report's table (Ticket | Pictures | Count), as printed.
3. The Totals line, then the three lists under it (gets nothing, missing, unused), each as printed.
4. The report's real-upload command in a fenced `bash` block.
5. One line: run it in a terminal tab; it skips anything already attached, so it is safe to run
   again. A `FAILED (500)` line is a temporary error on Jira's side: run the same command again.
   If Jira refuses the sign-in, the script deletes the saved token and asks for a new one, made at
   https://id.atlassian.com/manage-profile/security/api-tokens with plain "Create API token",
   not "Create API token with scopes".

Then stop and wait for the user to say the run finished.

## 5. Check three tickets

When the user says the run finished (or pastes its `Done:` line), check three tickets from the
list: the Epic, the ticket with the most pictures, and the last ticket in the list. Read each
one's attachments:

```bash
acli jira workitem view <KEY> --fields attachment --json | jq -r '.fields.attachment[]?.filename'
```

Compare against that ticket's lines in the list: every listed picture present, none attached
twice. Report once, as a table:

| Ticket | In the list | On the ticket | Match |
|---|---|---|---|

A mismatch names the missing or doubled file. Then stop.
