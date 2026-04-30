---
name: tld-experience
description: |
  Turn a lived conversation moment into a candidate skill in this repo. Use this skill whenever the user says
  "tld-experience", "I just experienced", "make this a skill", "turn this into a skill", "save this as a skill",
  or describes a workflow they just walked through with Claude and wants to capture as a reusable command.
  Reads the surrounding conversation context, generalizes the experience into a SKILL.md, gates on approval,
  then commits and opens a PR against `Jbrawner/tld-skills`. Single-file skills only — no `scripts/` or
  `assets/` subdirectories.
---

# TLD Experience

You are turning a lived conversation moment into a reusable skill. The user has just walked through something with Claude they want to be a one-liner next time. Your job is to read what they describe, read the recent conversation for context, draft a generalized SKILL.md that follows the patterns already in this repo, gate on the user's approval, then land it as a PR on `Jbrawner/tld-skills`.

**This skill creates new skills.** It does not edit existing ones. For edits, point the user at `/skill-creator` from the `anthropic-skills` plugin.

## When to use this

- User says any of: "tld-experience", "I just experienced", "make this a skill", "turn this into a skill", "save this as a skill", "save this dance"
- User describes a workflow they just did with Claude and wants captured
- User points at a chunk of recent conversation and asks "can we make this a skill?"

## Inputs

What the user provides:
- A free-text paragraph describing the experience — what they did, what they want next time
- Optional: a suggested slug or skill name

What you read on your own:
- Recent conversation context (the last few exchanges) so the generalized skill matches what the user actually did, not just what they remembered to type
- The repo conventions in [tld-ticket/SKILL.md](../tld-ticket/SKILL.md), [STANDARDS.md](../STANDARDS.md), and [CONTRIBUTING.md](../CONTRIBUTING.md) so the new skill fits the house style

## Process

### 1. Capture the experience

Read the user's experience paragraph in full. Then scroll back through the recent conversation and note:
- What concrete steps the user took with Claude
- What they want to be different next time (faster, fewer prompts, automatic)
- Any specifics that should NOT be generalized (a particular file, a particular project) versus what should generalize (the *pattern* of "scan-then-rewrite", "summarize-then-decide", etc.)

If the experience paragraph is too thin to draft from, ask one clarifying AskUserQuestion call before proceeding. Do not guess.

### 2. Generalize into a candidate skill

Draft three things from the experience:

**Slug** — lowercase, hyphenated, derived from the verb-object of the experience. Examples: "review pr screenshots" → `review-pr-screenshots`, "scan my prompt for jargon" → `scan-prompt-jargon`. If a directory at `~/.claude/skills/{slug}/` already exists, stop and ask the user for a different slug. Do NOT overwrite.

**Description line** — the YAML `description:` field that the harness uses to decide when to surface the skill. Lead with the action, then list concrete trigger phrases the user is likely to type. Mirror the shape of every existing skill's frontmatter — see [tld-ticket/SKILL.md:1-9](../tld-ticket/SKILL.md) for the canonical example. Description must be specific enough that the harness will surface this skill on the right input and skip it on unrelated input.

**Body** — full SKILL.md prose with these sections in this order:

1. YAML frontmatter (`name:` matches the slug; multi-line `description:`)
2. `# {Title Case Slug}` H1 + 1-paragraph statement of purpose
3. `## When to use this` — bullet list of trigger phrases and scenarios
4. `## Inputs` — what the user provides, what you read on your own
5. `## Process` — numbered steps of what the skill does
6. `## Output` — confirmation format
7. `## Numbered shortcut recognition` — the canonical block from [STANDARDS.md](../STANDARDS.md), embedded verbatim (the verifier will check this)
8. `## What's next?` — options block ending with the HARD STOP directive

**Generalization rules:**

| Rule | Why |
|---|---|
| Strip user-specific names (project names, file paths, ticket IDs) — replace with placeholders or remove | The skill must work for the user's other repos and other moments, not just the one that triggered it |
| Keep trigger phrases broad (multiple synonyms, common variants) | The harness picks skills by description match — narrow descriptions never fire |
| Define jargon inline on first use (per repo convention: "embed", "canonical", "drift" all need a parenthetical the first time they appear) | The user is not an engineer |
| Lead with a table when comparing 3+ items | House style — see how `tld-ticket` and `tld-help` use tables |
| Include one HARD STOP at the destructive moment (write, commit, push) | TLD philosophy — silence is not approval |

### 3. Propose for review

Output the **complete** drafted SKILL.md. Show the user:

```
## Proposed skill: /{slug}

**Description line (controls when the harness surfaces it):**
> {description}

**Full SKILL.md:**

---
{full file content, fenced}
---
```

Below the draft, list the docs that will be updated in step 7 so the user knows the full blast radius:
- `~/.claude/skills/{slug}/SKILL.md` — new file
- `CHANGELOG.md` — bullet under `### Added` in `[Unreleased]`
- `docs/SKILL_REFERENCE.md` — entry in the matching section
- `tld-help/SKILL.md` — row in the matching table

**HARD STOP.** Wait for an approval keyword from the user (see [STANDARDS.md § Approval keyword set](../STANDARDS.md#approval-keyword-set) for the full list — `approve`, `commit`, `lgtm`, `looks good`, `ship it`, `go`, `proceed`, or the bare `1` from the options block). Silence is not approval. Questions are not approval. If the user asks for changes, redraft and re-present.

### 4. Cut the branch

After approval at step 3:

1. Run `git status --porcelain`. If the working tree has any uncommitted changes, stop and tell the user:
   > Working tree is not clean. Commit or stash your changes before running `/tld-experience` so the new skill lands on its own branch.
2. Run `git checkout main && git pull origin main`.
3. Run `git checkout -b skill/{slug}`.

This mirrors `/tld-recenter`'s safety rule — refuse rather than risk losing work.

### 5. Write the SKILL.md

Create the directory `~/.claude/skills/{slug}/` and write the approved SKILL.md to `~/.claude/skills/{slug}/SKILL.md`. Use the file content shown to the user at step 3 verbatim — do not redraft.

### 6. Run the standards verifier

From the repo root, run:

```
python scripts/verify-block-alignment.py
```

If exit code is non-zero, the embedded `## Numbered shortcut recognition` block (or any other canonical embed the user added during redraft) does not match [STANDARDS.md](../STANDARDS.md) byte-for-byte. Stop, surface the verifier output, point the user at the mismatched heading, and ask whether they want to edit the SKILL.md or pull the canonical block from STANDARDS.md. Do not auto-fix.

### 7. Update the four docs

Edit each file in place. Do not add new tables or sections — find the matching group and append a row or bullet.

**`CHANGELOG.md`:**
- If a `## [Unreleased]` section does not exist, add one above the topmost released version (e.g., above `## [v0.1.1]`).
- Under `### Added` inside `[Unreleased]`, append: `- /{slug} skill — {one-sentence purpose}.`

**`docs/SKILL_REFERENCE.md`:**
- Pick the section whose role best matches the new skill: `## Campaign Skills`, `## Planning Skills`, `## TLD Ticket-Level Skills`, `## TLD Boundary Skill`. If none fit, add a new `## Meta Skills` section directly above `## Entry Paths`.
- Append a row to that section's table, columns: Skill, Purpose, When to use, Reads, Writes, Flow position. Match the existing prose style — terse, factual.

**`tld-help/SKILL.md`:**
- Pick the table whose role best matches: Core Flow, Automation, Recovery + Navigation, or Planning. If none fit, add a new `### Meta` table directly below the last existing table.
- Append a row, columns: Skill (with leading slash, code-fenced), What it does, When to use.

**`README.md`:**
- Only edit this file if the new skill belongs to a new family — not `/tld-`, `/campaign-`, or `/milestone-`. If the new family did not exist before, append a row to the "Heads-up about command names" mapping table (Option A → Option B).
- Otherwise, leave README.md alone.

If any required edit cannot be applied (file shape changed, target heading missing), stop and report which doc needs manual handling. Do not commit a partial set.

### 8. Re-run the standards verifier

Run `python scripts/verify-block-alignment.py` again. The doc edits should not affect canonical embeds, but a stray paste during step 7 can introduce drift. If exit code is non-zero, report and stop.

### 9. Commit

Stage the new SKILL.md plus every doc updated in step 7:

```
git add ~/.claude/skills/{slug}/SKILL.md CHANGELOG.md docs/SKILL_REFERENCE.md tld-help/SKILL.md
```

(Add `README.md` to the list only if it was edited in step 7.)

Commit with message `feat(skill): add /{slug}` and no co-author trailer. Personal repo — co-author is unnecessary.

### 10. Push and open the PR

Show the user:
- The commit hash and one-line subject
- The intended PR title (`Add /{slug} skill`) and body (purpose paragraph + the four docs touched)
- The branch name (`skill/{slug}`)

**HARD STOP.** Wait for an approval keyword (see [STANDARDS.md § Approval keyword set](../STANDARDS.md#approval-keyword-set)). On approval:

```
git push -u origin skill/{slug}
gh pr create --title "Add /{slug} skill" --body "{body}"
```

The remote is `Jbrawner/tld-skills` (per memory `project_github_owner.md` — never `2ndfoundry`).

If `gh pr create` fails (auth, rate limit, network), surface the error and stop. The branch is already pushed — the user can open the PR by hand.

### 11. Output the result

```
## Skill Created: /{slug}

**Branch:** `skill/{slug}`
**Commit:** `{short-sha}` — feat(skill): add /{slug}
**PR:** {pr-url}
**Files touched:**
- `~/.claude/skills/{slug}/SKILL.md` (new)
- `CHANGELOG.md`
- `docs/SKILL_REFERENCE.md`
- `tld-help/SKILL.md`
```

Then present the "What's next?" options block.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

---

**What's next?**

> **1.** Use the skill — type `/{slug}` to try it now
>    Best for: confirm the new skill triggers and behaves as drafted

> **2.** `/tld-experience` — capture another moment as a skill
>    Best for: you have more workflow moments worth saving

> **3.** Nothing — return to whatever you were doing
>    Best for: skill is created, PR is open, no immediate next step needed

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke any other skill. Wait for the user to pick an option or type a command.**
