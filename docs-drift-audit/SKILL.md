---
name: docs-drift-audit
description: |
  Recurring documentation-versus-code drift check for any project. Sweeps a configured set of
  documents, which may live outside the repository, and reports where they disagree with the code:
  file paths and links that no longer resolve, stated counts and version numbers that the code
  contradicts, retired routes and product names still being told to readers, and docs whose subject
  matter has moved on without them. Separates NEW deviations from ones already tracked by a ticket,
  and files a tracker ticket per confirmed new finding. Use whenever the user says "docs-drift-audit",
  "docs drift", "doc audit", "check the docs", "are the docs still true", "audit the documentation",
  or wants the recurring documentation-accuracy sweep. Complements /tld-audit rather than repeating
  it: tld-audit reads the current diff, this reads what the documentation claims. Read-only on code,
  data, and the documents themselves; the only writes are tracker tickets and this audit's own baseline.
---

# Docs Drift Audit

A recurring check that the documentation still describes the software that exists.

**Why this exists as a recurring check.** Documentation does not break the day it is written. It
breaks silently, months later, when a route is renamed, a file is deleted, a count grows, or a
feature moves tiers, and nothing in that change looks like a documentation problem to the person
making it. There is no test that fails and no diff anywhere that looks wrong. The reader who
believes a stale doc pays the cost, and by the time anyone notices, nobody remembers which claim
went wrong or when. `/tld-audit` reads the change; this reads what the docs claim and asks the code
whether it is still true. Run both.

**Read-only.** Do NOT edit the documents, edit application code, write or apply a migration, run any
database write, commit, push, open a PR, or move a ticket to Done. Fixing a drifted doc is a
deliberate act with its own review; this skill's job is to find the drift and get it tracked, and a
sweep that quietly rewrites prose is a sweep nobody can trust to run unattended. The only writes are
(a) tracker tickets for confirmed new findings and (b) this audit's own baseline bookkeeping.

## Layout

| File | Where | What |
| --- | --- | --- |
| `docs-drift-audit.py` | next to this skill | the engine, identical for every project |
| `docs-drift-baseline.toml` | in the audited repo | that project's doc set, checks, accepted exceptions, and known-open findings |
| `baseline.example.toml` | next to this skill | template to copy when a repo has no baseline yet |

The engine is deliberately narrow. It checks the claims a machine can settle without judgment, and
it is honest about the rest: anything it could not evaluate is reported as SKIPPED rather than
counted as clean. Step 3b is where you check what no engine can.

## Step 1 — Resolve the project, its documents, and its baseline

Work from the current repo root. That repository is the source of truth; the documents are the thing
under test, wherever they happen to live.

1. Find the baseline, taking the first that exists: `.tld/docs-drift-baseline.toml`,
   `.claude/docs-drift-baseline.toml`, then `docs-drift-baseline.toml` at the repo root. Prefer
   `.tld/` when writing a new one, but check whether the repo gitignores `.tld/` first: an
   uncommitted baseline forgets every reviewed exception between runs, so in that case put it in
   `.claude/` instead, or wherever the repo actually commits local tooling config.

   If none exists, say so plainly and continue: the sweep still runs against conventional defaults,
   but with no baseline there are no anchors, no retired terms and no watches, so it degrades to a
   path-and-link check and **every** finding reports as NEW. Treat a first run as establishing a
   baseline rather than as a list of emergencies. Offer to write one from `baseline.example.toml` at
   the end.

2. Confirm every documentation root in the baseline actually resolves. A root that does not resolve
   is a **skipped run for those documents**, never a clean pass for them. The engine reports it and
   exits PARTIAL; say so in the report rather than letting an unmounted drive read as "no findings".

3. Note which documents cannot be read as text. Word files, PDFs, slide decks and spreadsheets are
   listed every run under "not machine-checked" precisely so their silence is never mistaken for a
   pass. If one of them carries claims that matter, that is an argument for an anchor on a text
   sibling, or for reading it by hand at Step 3b, not for ignoring it.

## Step 2 — Run the sweep

```bash
python3 <path to this skill>/docs-drift-audit.py \
  --repo <repo root> \
  --baseline <the baseline resolved in Step 1>
```

Omit `--baseline` when the repo has no baseline. Add `--format json` when you want to process the
rows rather than read them.

The exit code describes whether the sweep RAN, never whether it found anything:

| exit | RUN STATUS | meaning |
| --- | --- | --- |
| `0` | `COMPLETE` | every configured check executed |
| `1` | `PARTIAL` | at least one check could not execute. Findings are still valid; coverage is not complete |
| `2` | `NOT-RUN` | fatal. No documentation root resolved, or the baseline could not be parsed |

**Zero findings is a clean pass only when RUN STATUS is COMPLETE.** Each row is
`SEVERITY | CHECK | OBJECT | STATUS | DETAIL`, and `OBJECT` is the finding's stable identity:
`<doc key> :: <affected thing>`.

| status | meaning | action |
| --- | --- | --- |
| `NEW` | on no list | triage in Step 3. Treat as real drift until proven otherwise |
| `KNOWN-OPEN <KEY>` | already tracked by that ticket | do not re-file. Note it is still open |
| `SKIPPED` | the check could not run | not a finding and not a pass. Name it in the report |

| check | severity | what it catches |
| --- | --- | --- |
| `doc-missing` | HIGH | the baseline names a document that is no longer in the swept set, so a configured check has gone inert |
| `anchor-not-found` | HIGH | a doc was reworded and its anchor no longer matches, so that claim silently stopped being checked |
| `anchor-mismatch` | HIGH | a doc states a value the code contradicts |
| `broken-repo-path` | MEDIUM | a doc names a file or directory in the repository that does not exist |
| `retired-term` | MEDIUM | a doc still uses a route, flag or product name the project retired |
| `stale-vs-code` | LOW | the code a doc describes moved on well after the doc last changed |

`anchor-not-found` is the most important row in that table and the least obvious. A check that
quietly stops matching does not fail, it just stops protecting anything, and it will report green
forever. That failure mode is the whole reason this skill treats an inert check as a HIGH finding
rather than as silence.

## Step 3 — Triage every NEW row

The path and staleness checks deliberately over-flag. A false positive costs a minute; a missed one
means a reader is sent to a file that is not there. Confirm each row by opening the document and the
code, never by pattern-matching on the check name.

**Benign patterns that trip `broken-repo-path`.** Each of these is a real thing docs do, and each
belongs on the baseline allowlist with its reason once confirmed:

1. **Illustrative placeholder.** A path inside an example, a template, or a "your file goes here"
   block. Never existed, never will.
2. **Path relative to a subdirectory.** The doc writes the path as its own subtree sees it while the
   engine resolves from the repo root. Confirm the file exists at the deeper path before accepting.
3. **Path in a different repository.** Common in docs that describe how two services fit together.
   Confirm the other repo really owns it.
4. **Generated or ignored artifact.** A build output or generated type file that exists at runtime
   but not in a clean checkout. Confirm it is genuinely generated, not deleted.

Anything else — a path the project used to have and no longer does, or one that was never right —
is a **real finding**. Go to Step 4.

Pattern 2 is the one that produces most of the volume, and it is the one to fix at the config level
rather than row by row. When a document writes a whole family of paths from inside a subtree, add
that subtree to `path_search_roots` once instead of accepting fifty objects. On a first run, expect
the raw count to drop by most of itself as soon as the search roots match how the project's authors
actually write paths — that drop is the config catching up, not findings being hidden.

**Benign patterns that trip `stale-vs-code`.** A doc can be perfectly accurate and simply older than
the code. Read it before deciding: a conceptual overview survives a refactor untouched, and a
decision record is supposed to be frozen. Accept those on the allowlist with the reason. What is not
benign is a doc that describes behaviour the watched code changed.

**`retired-term` has two benign shapes**, and both belong in the term's `allow_docs` rather than the
accepted list, so the exemption travels with the term instead of accruing one row per document:

1. **The doc is quoting history.** A changelog, a migration note, a point-in-time audit that cites
   the line numbers it read, a "this used to be called" line.
2. **The doc names the retired thing in order to say it is retired.** A schema table with a
   *Deprecated* row, a note reading "X is unused in production". Flagging these asks someone to
   delete the one sentence that stops the next reader from using it.

A term that trips on ordinary prose is a bad pattern, not a finding to accept. `/intake\b` also
matches inside "receive-into-intake"; the fix is to tighten the pattern (a look-behind for a word
boundary before the slash), not to allowlist the document, because an allowlist would also hide a
genuine future occurrence in that same file.

For `anchor-mismatch`, `anchor-not-found` and `doc-missing`, a NEW row is almost always genuine.
Check which side is wrong before filing: when the code is wrong and the doc is right, that is a code
bug and the ticket says so.

**Adding a row to the accepted list is a sign-off.** Only do it after opening both the doc and the
code and confirming the doc is correct as written, and always leave the reason. It is never a way to
quiet a noisy check. If the same shape keeps appearing, fix the shape — extend the term's
`allow_docs`, correct a doc root, or narrow a watch — rather than accepting objects one at a time.

## Step 3b — The claims no engine can check

The engine settles claims that reduce to a path, a pattern, or a number. Most documentation drift is
not that shape. After triaging the machine rows, read the documents the baseline's watches point at
and check the claims that need judgment. This is where the real yield is, and it is the reason this
is a skill and not a cron job running a script.

| Claim shape | How to settle it | Why the engine cannot |
| --- | --- | --- |
| An enumerated list ("the four X", "each of the five Y") | Count the real thing in the code and compare | The doc rarely states a number next to the list |
| A capability assigned to a plan, role, or permission level | Read the authoritative config and compare entry by entry | Which file is authoritative is a project fact |
| A status claim ("not yet built", "planned", an unticked checklist box) | Look for the thing. Shipped work described as pending is common and always wrong | Requires knowing what shipped |
| A described flow or sequence of screens | Walk the routes and confirm the steps still exist in that order | Prose has no machine-readable shape |
| A named default, threshold, or unit | Read the constant | The doc states it in prose, not as a value the engine can bind |

Two rules for this pass. **Never rewrite strategy, positioning, pricing rationale, market sizing, or
forward-looking plans** — a claim about the world is not drift against the code, and the person who
wrote it is the one who gets to change it. Flag those separately and leave them alone. And **only
report what you actually verified**: an unchecked claim is reported as unchecked, never folded into
the accurate pile because the doc read plausibly.

## Step 4 — File a ticket for every confirmed finding

**Filing is the default, not an offer.** This skill is built to run unattended on a schedule, and a
finding that exists only in a transcript nobody read is a finding nobody found. Stopping to confirm
would mean a weekend run sits on a wrong doc until someone happens to look.

The judgment is in Steps 3 and 3b, not here. Only file what you confirmed by reading the document
and the code. Never file a row you have not triaged, never file a `SKIPPED` row as though it were a
finding, and never file a `KNOWN-OPEN` row.

**Never cap how many tickets get filed.** No "top N", no "the most severe few", no sampling, no
quietly stopping once the list feels long. Every confirmed finding is filed. When the volume is
genuinely large, fold findings that share ONE root cause into a single ticket covering all of them:
that is consolidation and it loses nothing, unlike truncation, which loses precisely the findings
nobody will ever see. A capped report is worse than a long one because it is indistinguishable from
a complete one, so the gap is invisible and the work silently never happens. If anything is left out
for any reason at all, including a tracker error partway through, Step 5 must name it and say why.

### 4a — Resolve the tracker

Read `Project → Issue tracker` from `.tld/campaign.md` if the repo has one, and follow the canonical
Tracker resolution block below for it.

**Tracker resolution:**

This skill's ticket and milestone operations are written using neutral adapter names (`get_issue`, `save_issue`, `list_milestones`, and so on). Resolve every such operation against the tracker named in `.tld/campaign.md` → Project → Issue tracker:

- **Jira** (default) — perform each operation per docs/JIRA.md (milestone = Story, ticket = Sub-task, order = rank, status by category, status changes via workflow transitions). docs/JIRA.md § Tool-name map is the 1:1 lookup.
- **Linear** — call the Linear MCP tools directly; they match the adapter names used in this skill. Contract: docs/ADAPTERS.md.
- **Any other tracker** — stop and output:
    "Issue tracker '{tracker}' is not supported by the TLD skills. Supported: Jira, Linear. See LIMITATIONS.md."
  Do not invent an adapter.

If the repo has no campaign file, read the tracker keys from the baseline's `[config]` table:
`tracker`, `tracker_cloud_id`, `tracker_project`, `ticket_labels`, then apply the same routing. These
configure this audit only; they are not a second source of general project config, and
`.tld/campaign.md` wins wherever it exists.

If neither is present, do not guess. Report the findings in full, state that no tracker is
configured, and show exactly which baseline keys would enable filing.

### 4b — De-dup before creating anything

A recurring sweep re-detects an unfixed finding every single run. Filing it every run is worse than
never filing it, because it teaches everyone to ignore the label. Search the tracker first for open
tickets carrying the stable `docs-drift` label, and compare on the **affected object identity** — the
document plus the path, anchor, term, or watch named in the OBJECT column — not on the ticket title.
The same drift re-detected next week will word itself differently, and a title match will miss it.

**Search the stable `docs-drift` label only. Never put a dated label in the de-dup query.** A query
naming a specific month goes stale the moment the month turns, and it fails silently: the search
returns nothing, every finding looks new, and the sweep files a duplicate of every open ticket.
Dated labels exist to group a run's output for reading, never to find it again.

Findings tracked by an older ticket that predates this skill will not carry the `docs-drift` label at
all. Those belong in the baseline's `known_open` instead, which is why they never reach this step.

| situation | action |
| --- | --- |
| an open ticket already names this object | do not file. Comment only if something genuinely changed. Report it as "still open, KEY" |
| the object appears only on a **closed** ticket | file, and flag it as a **regression** of that key. A doc that was corrected and drifted back names a process problem, not just a typo |
| nothing names it | file it |

### 4c — Create the ticket

- Type: bug for a doc that states something untrue; task for a verify item or a product decision.
- Labels: **exactly the list in the baseline's `ticket_labels`, and nothing else.** That key is the
  project's decision about its own taxonomy and it overrides any example in this file. Never add a
  label because this engine is called the docs-drift audit, because a previous run used one, or
  because a label seems descriptive: a project whose tracker already carries that fact in a field
  will have deleted it, and re-creating it is a regression. If the project's task wrapper names
  additional labels, those apply too, and the wrapper wins over this file.
- **No label carries a date**, not even if `ticket_labels` names one: that is a stale baseline, and
  the right move is to report it, not obey it. Not a year, not a month, not a week, in any position
  or format. This check runs weekly, so a month in a label is stamped by four or five different runs
  and identifies none of them, while a day makes a fresh unsearchable label every week. The
  provenance block in the ticket body already records which run filed it, and any run document the
  project's wrapper asks for carries the full date in its filename, which is where a date belongs.
- Fold findings sharing one root cause into one ticket; separate causes get separate tickets. One
  rename that broke six documents is one ticket naming all six, not six tickets.
- Body: the document and the exact passage, what it claims, what the code actually does with the
  file and line that proves it, and the correction. Then a **regression guard** — the anchor,
  retired term, or watch to add to the baseline so the same claim is machine-checked from the next
  run onward. Doc drift recurs, so a fix without a guard will come back; if a finding genuinely
  cannot be expressed as a baseline entry, say so in the ticket and say why.

### 4d — Record it in the baseline

Add each filed object to `known_open` with its new ticket key, so the next run reports it as tracked
instead of re-triaging it from scratch. Where the ticket named a regression guard, add that anchor,
term or watch at the same time. Leave the edit uncommitted and say so. The tracker search in 4b is
the real de-dup guard, so a dirty file is never a reason to skip filing.

## Step 5 — Report

Lead with a table: RUN STATUS, total rows, NEW versus KNOWN-OPEN versus SKIPPED, and **every**
confirmed finding with its severity and ticket key (new, already open, or regression-of). If nothing
is new, say so in one line: "documentation unchanged against the code, N items still tracked under
KEY". Name the project and the documentation roots that were swept, so a result is never mistaken
for a different repo.

Then state anything that did not make it: a row left untriaged, a ticket that failed to create, a
check that could not run, a document nobody could read, a claim from Step 3b you did not get to.
List each one and why. "Here are the findings" must never quietly mean "here are some of the
findings", and a report that omits something silently is the one failure this whole skill is built to
prevent.

Keep the strategy and market claims from Step 3b in their own short list, clearly marked as flagged
rather than filed, so nobody reads them as defects.

## Running on a schedule

Scheduled runs behave exactly like interactive ones and file tickets without asking, because nobody
is there to ask. Three failure modes a scheduled run must handle:

- **A documentation root is not available.** A synced folder that has not mounted, a path that moved,
  a permissions failure. That is a skipped run for those documents, not a clean pass. Report "could
  not run, documentation root not reachable". Never report accurate documentation from a sweep that
  did not read it. A missed week costs nothing; a false all-clear costs everything this check is for.
- **A verification command fails.** Every anchor whose command errors is reported SKIPPED with its
  exit status. An anchor that cannot compute the truth has not confirmed the doc.
- **It runs in whatever checkout the schedule names**, so resolve every path from that repo root, and
  name the project in the report.

A schedule's prompt is written once and then runs for years, so nothing in it may be time-bound: no
month, no year, no "current" ticket keys, no expected finding counts that a landed fix will
invalidate. Anything dated is derived at run time from the actual date. A stale constant in a
recurring prompt does not raise an error, it just quietly stops matching, which is the same failure
mode `anchor-not-found` exists to catch inside the documents themselves.

## Baseline maintenance

- `known_open` pairs an object with the ticket that will fix it. When the fix lands the finding stops
  matching anyway, so prune the row then.
- `accepted` holds reviewed exceptions. Grow it only via Step 3, always with the reason.
- `anchors` are the audit's precision. Every ticket filed should leave one behind where it can, which
  is how the sweep gets sharper over time instead of just longer.
- Both `accepted` and `known_open` match on the exact OBJECT string, so renaming a document or an
  anchor id detaches every row that referenced it. Rename deliberately, and re-point the rows in the
  same edit.
- Anchor commands are shell commands committed to the repo. Keep them read-only and keep them
  boring. The engine refuses anything that looks like it writes, but that is a backstop against a
  mistake, not a sandbox — the review of the baseline is the real control.

## Canonical blocks this skill does not embed

Recorded so a later reader does not mistake an omission for drift:

- **Load project config** — does not apply. That block hard-stops when `.tld/campaign.md` is missing,
  and this skill must run in repos that have no campaign file, configuring itself from its own
  baseline instead.
- **Local DB safety check** — does not apply. This skill never touches a database.
- **Approval keyword set** — does not apply. There is no approval gate: filing is the default, by
  design, because the skill is built to run with nobody watching.
- **Milestone completion check**, **Recommendation hint**, both **Manual-QA classification** variants,
  **Resolve next ticket (discovery)**, both **Require current ticket** variants, **Author Order
  block**, **Flow selection**, and **Required workspace labels** — none apply. Those govern the
  per-ticket build flow; this skill does not pick up, advance, or complete a ticket.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** Write or extend the baseline — turn this run's confirmed findings into anchors, retired terms, and watches
>    Best for: the sweep found real drift and you want it machine-checked from the next run onward

> **2.** Nothing — the report and the tickets are the output
>    Best for: a scheduled run, or an interactive run that came back clean

> **3.** `/rls-audit` — run the database security posture sweep as well
>    Best for: you are doing a periodic health pass and want both recurring checks in one sitting

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
