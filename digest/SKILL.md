---
name: digest
description: |
  Collapse a wall of text into a scannable table + one recommendation + short reasoning, then stop and
  wait for the user's answer. Use this skill whenever the user says "digest", "digest this", "table it",
  "tableize", "put it in a table", "make it digestible", "give me a table", "distill this", "tl;dr this",
  "too long", "wall of text", or reacts to a long prose answer by asking for it shorter / in a table.
  Also trigger proactively is NOT this skill's job — but when invoked, always produce the table-first shape below.
---

# Digest

The user does not want walls of text. When this skill fires, take the thing on the table — the long answer
just written, a decision being weighed, or text the user pasted — and re-present it in a shape they can read
in about ten seconds and answer.

Replace prose with these four parts, in this order:

1. **A table, first.** One row per option, fact, or tradeoff being compared. Columns are short. This is the
   body of the answer, not a decoration on top of paragraphs.
2. **One recommendation.** Pick a single option and say it in one sentence. Mark it clearly.
3. **Short reasoning.** One to three lines on why. No paragraphs, no re-explaining the table.
4. **Stop.** End with the choice or question and wait. Do not continue past the user's decision point.

## What to digest

- Invoked right after a long answer → digest **that** answer.
- The user pasted or pointed at some text → digest that text.
- A decision was being made in prose → lay the options out as the table rows.

## Rules

- **Table first, every time.** (Matches the standing "lead with a table for anything structured" preference.)
- **Plain language.** Define any non-everyday word inline; never bury jargon in a column header.
- **Tight.** Aim for a ten-second read. If there are more than ~8 rows, group them or show the top ones and
  say in one line what was left out — never silently drop rows.
- **Recommendation is mandatory.** Put the recommended option first and label it `(Recommended)`.
- **Do not re-expand.** After the table + recommendation + reasoning, do not add prose paragraphs restating
  it. That shape *is* the whole answer.
- **No em dashes in the prose lines** (standing preference): use periods or commas.
- Copy-paste-able things (paths, commands, URLs) go in fenced code blocks, not inline.

## Output shape

```
**<one-line framing of the decision or topic>**

| Option / Item | Key facts | Tradeoff |
|---|---|---|
| … (Recommended) | … | … |
| … | … | … |

**Recommendation:** <the pick> — <one sentence>.
**Why:** <1–3 short lines>.

**Your call?** <numbered options, or the open question>
```

## If the user answers with a number

When the digest ends with numbered options and the user's next message is a bare number matching one, treat
it as if they chose that option and act on it immediately, without re-confirming.
