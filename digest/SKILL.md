---
name: digest
description: |
  Break a wall of text into a table the user can read in ten seconds and act on: one row per
  option, fact or finding, reasoning in the table, one line after it, then numbered options. Use
  when the user says "digest", "table it", "tableize", "make it digestible", "tl;dr this", "too
  long", "wall of text", or asks for a long answer shorter or in a table.
---

# Digest

Take the thing on the table (the long answer just written, a decision being weighed, or text the
user pasted) and re-present it as a table the user can read in about ten seconds and go through
one row at a time. Digest is the corrective for an answer that came out as prose, and the shape
to reach for whenever a big thing needs breaking into parts.

## Shape

1. **A table, first.** One row per option, fact, finding or tradeoff. Columns are short. The
   table is the whole body of the answer, not a decoration on top of paragraphs.
2. **Reasoning lives in the table.** When the rows are options, the table carries a `Why` column,
   or the reasoning sits in the recommended row's cells. Never explain the table underneath it.
3. **One line after the table, at most.** When there is a decision, that line is the
   recommendation: which row, and why, in one sentence. When there is nothing to decide, skip it,
   or state the one thing the user must know before the options.
4. **Then the options, then stop.** Numbered choices the user can answer with a single digit.
   End there and wait. Do not continue past the user's decision point.

## Rows

- **Never invent a row or a value.** Every cell comes from the material being digested. A blank
  cell beats a guessed one.
- **Never drop a row.** If there are many, group them under a category column or split into two
  tables, and say in one line what each group holds. Silently omitting rows is not summarising.
- **Order by recommendation, best first.** The recommended row is first and carries
  `(Recommended)`. The rest follow in descending order of merit, so the user can read top to
  bottom and stop when they have seen enough.
- **When there is no decision,** order by whatever the user will scan for (severity, status,
  time) and make that the first column.

## Ticket keys

- Every ticket key is a clickable link **and** carries its title:
  `[LAB-72](https://<tracker host>/browse/LAB-72) Add export button`. A bare key tells the
  reader nothing; the title is what they recognise. Resolve the host from the repo's
  `.tld/campaign.md` tracker settings.
- Keys may stay bare only inside code spans or JQL, where they are copy material.

## Options

- One option per line, or one table row each. Never run options together on one line with
  separators.
- Each option is one short phrase. No ticket or PR references inside the option text (they
  linkify into chips and break the list); name the thing in words.
- The recommended option is first and marked `(Recommended)`.
- An option must never assign the user a manual step the assistant could do itself.

## Language

- Plain language. Define any non-everyday term inline; never bury jargon in a column header.
- Copy-paste material (paths, commands, URLs) goes in fenced code blocks, not inline.
- Em dashes are fine here. A digest is an internal chat answer, not public-facing copy; the em
  dash rule applies to paragraphs a product's users will read.

## Output shape

```
**<one-line framing of the decision or topic>**

| Option (best first) | Key facts | Why |
|---|---|---|
| … (Recommended) | … | … |
| … | … | … |

**Recommendation:** <row>. <one sentence>.

1. <option> (Recommended)
2. <option>
3. <option>
```

For material with nothing to decide, drop the `Why` column and the recommendation line; the table
and, if needed, one open question are the whole answer.

## If the user answers with a number

When the digest ends with numbered options and the user's next message is a bare number matching
one, treat it as their choice and act on it immediately, without re-confirming. Choosing an option
is the go.
