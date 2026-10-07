---
name: digest
description: |
  Break a wall of text into a table the user can read in ten seconds and act on: one row per
  option, fact or finding, and every row carries the assistant's own recommendation. One line
  after the table, then numbered options. Use when the user says "digest", "table it",
  "tableize", "make it digestible", "tl;dr this", "too long", "wall of text", or asks for a long
  answer shorter or in a table.
---

# Digest

Take the thing on the table (the long answer just written, a decision being weighed, a status
report, or text the user pasted) and re-present it as a table the user can read in about ten
seconds and go through one row at a time. Digest is the corrective for an answer that came out as
prose, and the shape to reach for whenever a big thing needs breaking into parts.

The user reads a digest to decide fast. A row that says "your call" and stops hands the thinking
back to them. Every row says what the assistant would do.

## Shape

1. **A table, first.** One row per option, fact, finding, ticket or tradeoff. Columns are short.
   The table is the whole body of the answer, not a decoration on top of paragraphs.
2. **Every row ends in a `My recommendation` column.** It says what to do with that row, in
   bold, then why in a few words. This is the rule the rest of the skill serves.
3. **One line after the table, at most:** what to do first and why, in one sentence.
4. **Then the options, then stop.** Numbered choices the user can answer with a single digit.
   End there and wait. Do not continue past the user's decision point.

## The recommendation column

- **Every row gets one, and the cell is never blank.** A row that needs nothing says **None.**
  A row that is awareness only still says what to do if it recurs or matters later.
- **Pick, do not restate the question.** When the material lists choices for a row ("lock it,
  or import without it"; "fix the frontend or the prompt"), the cell names one of them. "Your
  call", "your pick", "your triage call", "needs a decision" and "prioritise when you like" are
  questions, not recommendations; they may appear in a `What it needs` column, never in this one.
- **Recommend even when the material does not settle it.** Make the best call from what is
  known and say so in the cell ("judgment: the report does not say which layer is cheaper").
  The user can overrule a pick in one word; they cannot act on a blank.
- **A grouped row gets a recommendation per item.** Eight backlog tickets in one row hide eight
  calls. Split them into their own table, one row each, and recommend an order or a lane for
  each one.
- **Facts come from the material; recommendations are the assistant's.** Never invent a fact,
  a value or a ticket title. A recommendation is judgment, not a fact, and it is always
  allowed.

## Rows

- **Never drop a row.** If there are many, group them under a category column or split into two
  tables, and say in one line what each group holds. Silently omitting rows is not summarising.
- **Order rows so the user reaches their decisions first.** For options, best first: the
  recommended row leads and carries `(Recommended)`. For a status report, rows that need the
  user come first, the most urgent at the top, then the rows that need nothing.

## Ticket keys

- Every ticket key is a clickable link **and** carries its title:
  `[LAB-72](https://<tracker host>/browse/LAB-72) Add export button`. A bare key tells the
  reader nothing; the title is what they recognise. Resolve the host from the repo's
  `.tld/campaign.md` tracker settings.
- **When the material gives a key without its title, look the title up** (Atlassian MCP or
  `acli`) before writing the row. Never guess a title.
- Keys may stay bare only inside code spans or JQL, where they are copy material.

## Options

- **Option 1 applies the table:** "Apply every recommendation in the table" (or the first
  concrete step of them), marked `(Recommended)`. The rows carry the calls, so one digit should
  be enough to accept them all.
- The other options are real alternatives: a smaller step, or "change some recommendations
  first (tell me which)".
- One option per line. Each option is one short phrase. No ticket or PR references inside the
  option text (they linkify into chips and break the list); name the thing in words.
- An option must never assign the user a manual step the assistant could do itself.

## Language

- Plain language. Define any non-everyday term inline; never bury jargon in a column header.
- Copy-paste material (paths, commands, URLs) goes in fenced code blocks, not inline.
- Em dashes are fine here. A digest is an internal chat answer, not public-facing copy; the em
  dash rule applies to paragraphs a product's users will read.

## Output shape

```
**<one-line framing of the decision or topic>**

| Status or option | Item | Key facts | My recommendation |
|---|---|---|---|
| … | … | … | **<the pick>.** <why, a few words> |
| … | … | … | **None.** |

**Recommendation:** <what to do first>. <one sentence why>.

1. Apply every recommendation in the table (Recommended)
2. <a smaller step>
3. Change some recommendations first (tell me which)
```

## Check before sending

Read down the `My recommendation` column. The digest is not finished if any of these holds:

| Check | Fails when |
|---|---|
| Every row has a pick | A cell is blank, or says "your call", "your pick", "decide", "TBD" or ends in `?` |
| A choice row names one side | The row lists two choices and the cell does not name one |
| Grouped items are split | One row holds several tickets or findings that each need a call |
| Option 1 accepts the table | Option 1 is anything other than applying the row recommendations or their first step |

## If the user answers with a number

When the digest ends with numbered options and the user's next message is a bare number matching
one, treat it as their choice and act on it immediately, without re-confirming. Choosing an option
is the go.
