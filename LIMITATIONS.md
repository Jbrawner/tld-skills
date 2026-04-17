# Limitations

Adventure Skills v0.1.0 is alpha software. It was built by dogfooding the framework on a single private project ("mAIn Character") and then extracted for open-source release. Many assumptions that were invisible during dogfooding are surfaced here so you can decide whether the framework fits your project before you adopt it.

## Issue tracker: Linear-only

Every TLD skill reads from and writes to Linear directly via MCP. Tickets, milestones, statuses, and the `## Order` section that drives ticket sequencing all live in Linear.

There is no abstraction layer. Skills call `get_issue`, `save_issue`, `get_milestone`, `list_issues`, etc. by name. If your team uses GitHub Issues, Jira, Linear, Shortcut, or any other tracker, the skills will not work as written.

Multi-tracker support is deferred to v0.2.

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
