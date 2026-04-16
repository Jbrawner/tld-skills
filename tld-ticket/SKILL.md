---
name: tld-ticket
description: |
  Create standardized Linear tickets that the TLD pipeline can consume cleanly. Supports feature, bug, QA, and
  polish ticket types. Each type has a template with the exact fields the TLD skills need (AC, files, pattern refs,
  test command). Use this skill whenever the user says "tld-ticket", "create a ticket", "new ticket", "file a bug",
  "add a ticket for", or wants to create a Linear ticket that will flow through the TLD pipeline. Also use when
  the user describes work that should be tracked but hasn't been ticketed yet.
---

# TLD Ticket

You are creating a standardized Linear ticket that the TLD pipeline can consume cleanly. Every ticket you create must have the fields that `/tld-setup`, `/tld-write-tests`, and `/tld-build` expect. No vague descriptions, no missing AC, no ambiguous scope.

## When to use this

- User describes work that needs a ticket ("we need to add X", "there's a bug in Y")
- User wants to plan upcoming work as tickets
- User says "create a ticket for this"
- During `/tld-side-quest` when only a description is provided (side-quest should reference this template internally)

## Inputs

The user provides one of:
- A description of what needs to be done
- A bug report or error they encountered
- A feature request
- A QA or polish task

You determine the ticket type from context and apply the right template.

## Process

### 1. Determine ticket type

Based on the user's description, classify as one of:

| Type | When to use | Prefix |
|------|-------------|--------|
| **Feature** | New functionality, new endpoint, new component, new table | `feat` |
| **Bug** | Something is broken, wrong behavior, error in production/local | `fix` |
| **QA** | Testing gaps, missing coverage, test infrastructure | `test` |
| **Polish** | UI tweaks, copy changes, performance, cleanup, config | `chore` |

### 2. Gather context

Before creating the ticket, understand the scope:

1. **Read the playbook** (`docs/EXECUTION_PLAYBOOK.md`) to see if this work fits into an existing step or is standalone
2. **Check existing tickets** in Linear to avoid duplicates (use `list_issues` with a keyword search)
3. **Identify affected files** by reading the codebase. Use grep/glob to find the files that would need to change
4. **Identify pattern references** by finding existing files that follow the same patterns (same type of component, similar endpoint, etc.)
5. **Determine the test command** from the playbook step, or use the standard: `cd backend && npm run test:run` for backend, `cd frontend-next && npm test` for frontend

### 3. Draft the ticket

Apply the template for the ticket type. Fill in every field. If you can't determine a field, ask the user rather than leaving it blank.

### 4. Present for review

Show the user the full ticket before creating it. Format it exactly as it will appear in Linear so they can review.

### 5. Create in Linear

After user approval, use `save_issue` to create the ticket in the mAIn Character project (team: 2ndFoundry).

---

## Templates

### Feature Ticket

```markdown
## Description
[1-2 sentences: what this adds and why it matters]

## Acceptance Criteria
- [ ] [Specific, testable condition — one per line]
- [ ] [Each AC item maps to at least one test case]
- [ ] [Include happy path AND error/edge cases]
- [ ] [Be precise: "returns 200 with {field: value}" not "works correctly"]

## Files to Create/Modify
- `path/to/new-file.ts` — [what this file does]
- `path/to/existing-file.ts` — [what changes]
- `path/to/test-file.test.ts` — [test coverage for this ticket]

## Pattern References
- `path/to/similar-existing.ts` — [why: same type of component/endpoint/migration]
- `path/to/similar-test.test.ts` — [why: test structure to follow]

## Test Command
`[exact command from playbook step, or standard for this area]`

## Notes
[Any gotchas, decisions, or context that isn't obvious from the AC]
```

### Bug Ticket

```markdown
## Description
**Bug:** [What's wrong — the actual behavior]
**Expected:** [What should happen instead]
**Repro:** [Steps to reproduce, or "see test case below"]

## Acceptance Criteria
- [ ] [The bug condition no longer occurs]
- [ ] [The correct behavior is verified by test]
- [ ] [No regression in related functionality]
- [ ] [Edge case that triggered the bug is covered]

## Files to Create/Modify
- `path/to/buggy-file.ts` — [what needs fixing]
- `path/to/test-file.test.ts` — [test that reproduces the bug, then verifies the fix]

## Pattern References
- `path/to/similar-fix.ts` — [if a similar bug was fixed before]

## Test Command
`[exact command]`

## Notes
[Root cause if known, related issues, severity context]
```

### QA Ticket

```markdown
## Description
[What testing gap this fills or what needs verification]

## Acceptance Criteria
- [ ] [Test file created/updated at specified path]
- [ ] [N test cases covering: list the scenarios]
- [ ] [All tests pass against current implementation]
- [ ] [No existing tests broken]

## Files to Create/Modify
- `path/to/test-file.test.ts` — [what's being tested]
- `path/to/test-helpers.ts` — [if new fixtures/utilities needed]

## Pattern References
- `path/to/existing-test.test.ts` — [test style to match]

## Test Command
`[exact command]`

## Notes
[Why this coverage matters, what risk it mitigates]
```

### Polish Ticket

```markdown
## Description
[What's being improved and why — UI tweak, performance, cleanup, config]

## Acceptance Criteria
- [ ] [Specific observable change — "button padding is 12px" not "button looks better"]
- [ ] [Before/after if visual change]
- [ ] [No regression in existing behavior]

## Files to Create/Modify
- `path/to/file.ts` — [what changes]

## Pattern References
- `path/to/similar.ts` — [style/pattern to match]

## Test Command
`[exact command, or "manual verification only" if no automated tests apply]`

## Notes
[Design context, screenshot reference, or user feedback that prompted this]
```

---

## Template Rules

These apply to ALL ticket types:

1. **Every AC item must be testable.** If you can't write a test for it, rewrite it until you can. "Looks good" is not an AC item. "Button has 12px padding and #2563EB background" is.

2. **Files to Create/Modify is mandatory.** The TLD pipeline uses this for scope control and drift checking. If you're not sure what files are involved, investigate before creating the ticket.

3. **Pattern References are mandatory.** There is always an existing file that does something similar. Find it. This is how the pipeline maintains code consistency.

4. **Test Command must be exact.** Not "run the tests" but `cd backend && npm run test:run`. Copy it from the playbook step.

5. **One ticket = one thing.** If the description has "and" connecting two distinct pieces of work, split into two tickets. The TLD pipeline works best with small, focused tickets.

6. **Dependencies must be explicit.** If this ticket can't be done until another is finished, set the blockedBy relation when creating the ticket.

---

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### Output

After creating the ticket, confirm:

```
## Ticket Created: [TICKET-ID]

**Type:** [Feature / Bug / QA / Polish]
**Title:** [title]
**Priority:** [priority]
```

Then present options:

---

**What's next?**

> **1.** /tld-setup [TICKET-ID] — start working on it now
>    Best for: ready to begin the ticket immediately

> **2.** Create another ticket
>    Best for: planning more work before starting any of it

> **3.** /tld-dashboard — see where this ticket fits in the plan
>    Best for: want to sequence the new ticket against existing work

> **4.** /tld-save-point — resume the work you were doing before
>    Best for: you created this ticket as a follow-up and want to return to your current work

Type **1**, **2**, **3**, or **4** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-setup` or any other skill. Wait for the user to pick an option or type a command.**
