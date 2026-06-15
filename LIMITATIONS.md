# Limitations

Adventure Skills v0.1.0 is alpha software. It was built by dogfooding the framework on a single private project ("mAIn Character") and then extracted for open-source release. Many assumptions that were invisible during dogfooding are surfaced here so you can decide whether the framework fits your project before you adopt it.

## Issue tracker: Linear and Jira supported; others on your own

The skills support two trackers, selected by the `Issue tracker` field in `.tld/campaign.md`:

- **Linear** — the original tracker, exercised end to end. Contract in [docs/ADAPTERS.md](docs/ADAPTERS.md).
- **Jira** (Cloud, via the Atlassian MCP connector) — supported alongside Linear. Mapping in [docs/JIRA.md](docs/JIRA.md). The state-touching skills branch on the tracker field and follow the Jira path when it is `Jira`.

`/campaign-init` and `/campaign-edit` also accept **GitHub Issues** and **Other**, but those remain unimplemented — the schema accepting a tracker name is not the same thing as the framework supporting it. If you pick one of those, `/campaign-init` writes the file and prints an advisory, but the pipeline has no path for them until an adapter lands. See [docs/ADAPTERS.md](docs/ADAPTERS.md) for the full interface contract every adapter must satisfy.

Jira carries its own caveats that Linear does not — order comes from Jira's native rank rather than a `## Order` text list, labels are free-text with no create step or typo protection, and the five Linear status classes collapse into three Jira status categories. These are detailed in [docs/JIRA.md](docs/JIRA.md). Two instance-specific behaviors (rank ordering through the connector, and how a Story parents its Task/Bug tickets) must be confirmed per Jira project; see the Phase 1 spike notes in that file.

## Linear MCP: milestone order is UI-only

Even on the "supported" Linear tracker, the MCP surface the skills call does not expose every Linear field. `save_milestone` accepts `name`, `description`, and `targetDate` — but not `sortOrder`. Linear's GraphQL has a `projectMilestoneReorder` mutation, but the Linear MCP connector does not surface it.

This matters because `/tld-setup` picks the next ticket by walking milestones in `sortOrder` ascending. When `/campaign-plan` or `/milestone-create` creates a new milestone, Linear assigns it a higher `sortOrder` than any existing milestone, so the new one lands at the bottom of the list. That is rarely what you want if you are inserting a "Phase 2" between existing milestones, or creating a build milestone that should run before an existing docs milestone.

Workaround: after any skill that creates or splits milestones, open Project → Milestones in the Linear UI and drag the milestones into the intended order. The skills cannot do this for you. `/tld-setup`'s pick reflects whatever is in the UI, so the manual fix only needs to happen once per reorder.

Fixing this upstream means wiring `projectMilestoneReorder` into the Linear MCP connector. Deferred until the connector exposes it.

## Linear API unreachable

There is no offline mode. Every skill that calls Linear (`/tld-setup`, `/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-align`, `/tld-audit`, `/tld-commit`, `/tld-next`, `/tld-skip`, `/tld-cancel`, `/tld-gate`, `/tld-partial-auto`, `/tld-side-quest`, `/tld-save-point`, `/tld-dashboard`, `/tld-ticket`, `/campaign-plan`, `/milestone-create`, `/milestone-sync`, `/campaign-test`) aborts on the first network error, auth failure, rate limit, or 5xx — there is no retry, no exponential backoff, no fallback to cached state. Read-only skills like `/tld-write-tests` and `/tld-audit` still abort on Linear errors because they embed the canonical "Require current ticket (strict)" block, which queries Linear at step 1.

This is intentional. The campaign file has no ticket-order or status cache by design, so there is nothing to fall back to. Running half a pipeline against stale local data and reporting "partial success" would mask drift that the user cannot see; failing fast keeps the agent honest.

The practical workaround when Linear is genuinely down: note the operation you tried, finish whatever local work you can (write tests, edit code, run the test command), and retry the Linear write manually in the Linear UI once connectivity returns. For a state transition the skill never made (e.g., flipping In Progress → Done), set the status by hand in Linear, then re-enter the pipeline at the next skill.

A "stash and retry" pattern — queue the failed write locally and replay it on the next successful call — is not on the roadmap. It re-introduces the cache the framework deliberately avoids.

## Test runner: Vitest or Jest assumed

The verification phase (`/tld-run-test`) shells out to test commands stored in `.tld/campaign.md`. The skills assume those commands produce output that looks like Vitest or Jest output — pass/fail counts, file paths, and error messages in a roughly compatible format.

Other JavaScript test runners (Mocha, AVA, node:test) may technically work if their output is parseable, but they are not exercised in development. Test runners for other languages (pytest, RSpec, go test, cargo test) have not been tried at all.

Test framework adapters are deferred.

## Local database: Supabase at 127.0.0.1:54321 assumed

Skills that touch the database (`/tld-gate`, `/tld-audit`'s RLS checks, the local DB safety check) assume a local Supabase instance reachable at `127.0.0.1:54321`. Migration commands, RLS policy reads, and seed-data inspections all target that endpoint.

If your project uses a different Postgres setup (raw Postgres, RDS proxy, a different port, no local DB at all), those skills will either fail outright or produce misleading output.

Replacing the Supabase assumption with a generic database adapter is not on the roadmap for v0.1.

## Alpha status and dogfooding caveat

v0.1.0 is the first cut where the framework is portable enough to install in a second repo. Up through this release everything was built and tested against one project, which means:

- Edge cases that did not happen in mAIn Character probably are not handled yet.
- Error messages assume context that only the original project had.
- The phrasing of skill prompts, options, and recommendations was tuned to one team's taste.
- Documentation reflects what worked for one project, not necessarily best practices.

Expect rough edges. File issues when you hit them — the framework will only get better with use outside its birthplace.
