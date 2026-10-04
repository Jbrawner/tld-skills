# Campaign schema (`.tld/campaign.md`)

This is the canonical schema reference for the per-repo `.tld/campaign.md` file. The
`campaign-init`, `campaign-edit`, `campaign-validate`, and `campaign-test` skills all follow
it, and `tld-orchestrate` reads the optional `## Pipelines` section defined here. When any of
those skills and this document disagree, this document is the source of truth.

The file lives at `{repo}/.tld/campaign.md`, one per repo, gitignored. There is no global or
active campaign.

## Versions

| Version | Sections |
|---|---|
| v0.1 | The four required sections: `Project`, `Test Commands`, `Stack`, `Commit format`. |
| v0.2 | v0.1 plus two **optional** sections: `Pipelines`, `Allowed statuses`. |
| v0.3 | v0.2 plus one **optional** field in `Stack`: `Reset command`. |

v0.2 is a strict superset. **A file with only the four v0.1 sections is a valid v0.2 file and
behaves exactly as it did under v0.1** — the two new sections are opt-in, and every consumer
treats their absence as "use the built-in default." There is no version marker line in the
file; a file is v0.2 simply if it uses a v0.2 section. v0.3 adds one optional field the same way,
`Stack.Reset command`: absent means the built-in default, and a file is v0.3 simply if it carries
the field.

## Required sections (v0.1)

These four must be present. Their fields and validation rules are unchanged from v0.1.

```markdown
## Project
- Issue tracker: {Jira | Linear | ...}
- Project name: {display name}
- Team: {team / workspace}
- Ticket prefix: {e.g. DROSS}

## Test Commands
- Backend: {command or blank}
- Frontend: {command or blank}
- Landing: {command or blank}
- Full: {command or blank}

## Stack
- Backend directory: {dir or blank}
- Frontend directory: {dir or blank}
- Landing directory: {dir or blank}
- Database: {the local database(s), e.g. Supabase local at 127.0.0.1:54321; stack 2 at 127.0.0.1:54621}
- Changelog path: {path or blank}

## Commit format
- Pattern: {e.g. feat/(DROSS-XXX): title}
- Co-author: {trailer or blank}
```

Required non-empty fields: `Project name`, `Ticket prefix`, `Commit format.Pattern`.

`Stack.Database` names every local database the project may use, one or more, each by address
and, where two projects can share a port, by container. A lane picks one with the prefix its
test commands carry (`. <file> && <command>`); the local DB safety check refuses any database
the line does not name.

## Optional sections (v0.2)

### `## Pipelines`

Per-type step lists that override the built-in team-standard flow. This section holds a fenced
`yaml` block: a map of pipelines keyed by ticket type. It is **local overrides only** — anything
the project does not override falls back to the team standard (see Cascade below). Its absence
means "use the built-in standard," which is the common case.

```markdown
## Pipelines

```yaml
pipelines:
  default:                 # leaf; anything unlisted inherits this
    - skill: tld-setup
    - skill: tld-write-tests
    - skill: tld-build
    - skill: tld-audit
    - skill: tld-run-test
    - skill: tld-commit
    - skill: tld-writeup
    - skill: tld-next
  bug:     { use: default }
  subtask: { use: default }

  story:                   # container; fires when children are done
    trigger: all_children_done
    steps:
      - skill: tld-gate
      - skill: tld-story-review
      - skill: tld-spot-check
```
```

Per-step keys the runner honors: `skill:` (required), `stop_after:` (default `false`), `on_fail:`
(default `tld-align`), `retries:` (default `2`). **The consumer of record is `tld-orchestrate`;
this section's shape must match what that skill parses.** Do not define a divergent shape here.

### `## Allowed statuses`

The working statuses the pipeline is allowed to move a ticket through. A simple list. Its absence
means "use the built-in defaults" (`In Progress`, `In PR`, `In Release`, `Done`), so a file without
this section behaves exactly as today.

`In PR` in that default list is the **pre-merge status** — where a ticket sits once its work is
finished but its code has not reached the default branch. Every TLD skill that stops before a merge
writes this status rather than `Done`; see [DONE_MEANS_MERGED.md](DONE_MEANS_MERGED.md). A project
whose tracker has no such status is supported: its finished tickets stay `In Progress` until a merge
is confirmed, and no skill substitutes `Done`.

```markdown
## Allowed statuses
- In Progress
- In PR
- In Release
- Done
```

Consumer of record: the workflow status guard (DROSS-26 moves the previously-hardcoded
`SAFE_JIRA_STATUSES` set to read this section, defaulting to the four names above so a default run
is unchanged).

## Optional field (v0.3)

### `Stack.Reset command`

One optional line inside the required `Stack` section, anywhere after `Database`:

```markdown
- Reset command: {command that resets the lane's own local database from empty, e.g. bash .tld/lane-db.sh reset}
```

`/tld-gate` runs it from the repo root to prove the milestone's migrations apply from empty. It
should act on the database the current worktree's lane prefix selects and refuse the shared one,
the first database `Stack.Database` names, as lab-inventory's `.tld/lane-db.sh` does. Blank or
absent: the gate runs the platform's own reset under the lane prefix instead, and only when that
prefix selects a database other than the first one named; a project whose `Database` names a single
database resets it as before.

## Known-section allowlist

The complete set of section headings a valid campaign file may contain:

`Project`, `Test Commands`, `Stack`, `Commit format`, `Pipelines`, `Allowed statuses`.

`campaign-validate` (and `campaign-test`'s schema pass) **reject any section heading outside this
set** as a genuinely unknown section. The four v0.1 headings are always in the set, so a v0.1-only
file validates unchanged; the two v0.2 headings are accepted when present. This is the additive
guarantee: adding v0.2 support does not loosen the schema into "anything goes," and it does not break
a file that carries a `## Pipelines` block.

## The config cascade and the team-standard location

Pipeline resolution has four layers, base to most-specific. Nothing is ever undefined — everything
falls back toward the base:

```
shared team-standard file  →  built-in default (fallback)  →  project override (## Pipelines)  →  type override
```

| Layer | Where it lives | When it applies |
|---|---|---|
| Shared team-standard file | `$WORKFLOW_SHARE_DIR/pipelines/team-standard.yaml`, installed into each agent home by the shared `install.sh` (DROSS-23) | The team-wide base flow, shared by both runtimes so neither copy drifts |
| Built-in default | Hardcoded in `tld-orchestrate` | Fallback used whenever the shared file is not installed — this is today's behavior |
| Project override | `## Pipelines` in this file | Per-project changes to specific ticket-type flows |
| Type override | A specific ticket-type key inside `## Pipelines` | The narrowest, per-type flow |

`WORKFLOW_SHARE_DIR` follows the shared-infrastructure convention (neutral `WORKFLOW_*`, falling back
to `CODEX_*`), so the same file serves the Codex and Claude paths. Until DROSS-23 installs the shared
file, the built-in default in `tld-orchestrate` **is** the team standard, and behavior is exactly as
today.

## Backward compatibility

- A campaign.md with only the four v0.1 sections validates, scaffolds, and edits exactly as it did
  under v0.1.
- A campaign.md without `Stack.Reset command` gates exactly as it did under v0.2: `/tld-gate` uses
  the platform's reset under the lane prefix, and never on a shared stack.
- The `campaign-*` skills are Claude-path skills; the Codex path does not run them, so the stricter
  reject-unknown validation cannot affect a default Codex run.
- Every v0.2 consumer treats an absent section as "use the built-in default," so opting out is the
  default.
