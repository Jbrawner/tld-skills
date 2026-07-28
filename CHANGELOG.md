# Changelog

All notable changes to Adventure Skills are recorded here. Versions follow semantic versioning once we leave alpha.

## [Unreleased]

### Added

### Changed

- The canonical "Require current ticket (strict)" block (STANDARDS.md) gains a leading **Case A0 — same-session setup context**: when the session already ran a formal `/tld-setup` whose output carries the active ticket (ID, AC, Files to Create/Modify) and nothing since indicates the ticket changed (no `/tld-next`, `/tld-skip`, `/tld-cancel`, no user statement to the contrary), phase skills use that in-conversation context and skip the redundant tracker query — cutting roughly four tracker round-trips per aggregator-driven ticket. Standalone runs without that context fall through to the existing Case A/B/C untouched. Propagated byte-identically to all ten embedders (`tld-align`, `tld-build`, `tld-commit`, `tld-partial-auto`, `tld-pr`, `tld-run-test`, `tld-skip`, `tld-write-tests`, `npc-full`, `npc-partial`); the cancel variant is deliberately unchanged since canceling may target a ticket other than the session's active one. Generalizes `tld-audit` §1's conversation-context-first pattern. (AS-10)
- `/npc-full` and `/npc-partial` now refuse campaigns with a runnable test suite (new §1a guard): before invoking `/tld-build` they resolve the test command exactly as `tld-build` step 1b does, and if it resolves to a real command (not blank, not the literal `skip`, not an `echo`-style SKIP placeholder) they stop and point to `/tld-run-test`, `/tld-partial-auto`, or a `no-tests`-labeled ticket via `/tld-full-auto`. No override keyword. Skip-style campaigns behave exactly as before. (AS-9)
- `/tld-full-auto` and `/tld-partial-auto` now claim (self-assign) the active ticket right after setup identifies it, mirroring `/tld-orchestrate` §4: unassigned tickets are assigned to the current user (Jira `editJiraIssue`/`assignJiraIssue` with the `atlassianUserInfo` accountId; Linear `save_issue`), tickets already assigned to the current user are left alone, and a ticket assigned to someone else is a STOP (claimed by another person, per docs/JIRA.md § Concurrency). Without the claim, the next phase's "In Progress AND assigned to me" resolution found zero tickets on unassigned Jira sub-tasks and broke the chain mid-run. (AS-8)
- `/tld-goal-handoff` now composes flow-aware goals instead of prescribing `/tld-full-auto` for every ticket: step 2 classifies each ticket (`full-auto` / `no-tests` / `migration`, migration wins ties), step 4's ordered list tags every entry like `AS-12 (title) [no-tests]`, the goal template tells the runner that a `[no-tests]` checkpoint reads "regression-clean, NOT spec-verified" (riding `/tld-full-auto`'s new label-gated path), campaigns with no runnable test command swap in a direct `/tld-setup` → `/tld-build` → AC-self-review method, and the landing step states the commit-suffix rules (` — TLD verified` for test-verified landings, ` — NPC` for no-test landings). Step 1 also gains a tracker guard: non-Jira campaigns stop with "tld-goal-handoff currently supports Jira only" instead of silently proceeding. (AS-7)
- `/tld-full-auto` now takes tickets labeled `no-tests` or `build-only` through a label-gated **no-tests path** instead of dying at stop condition 7: the RED phase (`/tld-write-tests`) is skipped by design (an explicit, reported skip), `/tld-build` green means the implementation is authored with no new-test requirement, and `/tld-run-test` verifies as a REGRESSION gate (existing suite must stay green; absence of new tests is not a failure and not AC-coverage drift) plus the usual file-scope drift check and manual QA plan. Mirrors the existing migration re-check pattern; if a ticket is both migration and labeled, the migration classification wins. Unlabeled tickets behave exactly as before. (AS-6)

### Fixed

- Chore sweep from the 2026-07-28 flow review: `campaign-init` no longer calls Linear "the primary / recommended issue tracker" (Linear and Jira are both supported per LIMITATIONS.md; GitHub Issues / Other remain schema-accepted but unimplemented) and its Test Commands intro now lists all four slots (backend / frontend / landing / full); `tld-setup`'s description and intro are tracker-neutral ("pulls it from the issue tracker"); and step 1b in `tld-build`, `tld-write-tests`, and `tld-run-test` gains an identical **literal-skip guard** — a resolved command that is the literal `skip` or an `echo`-style SKIP placeholder is never executed (a placebo command only fakes a green run), is reported as "no runnable suite", and in `/tld-run-test` routes to the manual-QA-style verify path. (AS-11)

### Removed

## [v0.3.1] — 2026-05-09

### Changed

- `/tld-release` step 11 now reads `marketplace.json` from `Jbrawner/claude-skills` after the auto-bump PR merges and verifies the `tld` plugin's `version` field actually equals the new release. The workflow + PR success path was *necessary but not sufficient* — a green workflow could still leave the file unchanged in some failure modes. The new step 11b prints `marketplace.json verified at {new-version}` on match (or surfaces the actual value on mismatch) so the release report is a confirmed end-to-end success without the user having to spot-check the file by hand.

## [v0.3.0] — 2026-05-09

### Added

- `/campaign-portless` skill — one-shot portless setup so every repo / worktree gets a stable `<name>.localhost:1355` URL. Idempotent across the install / proxy / cert-trust / `/etc/hosts` layers; per-project run picks a name (worktree dir or repo basename), picks a free port, persists it in `.claude/launch.json`, symlinks `.env.local` from the main repo when a worktree is missing one (with a hard stop if the env file points at production), and registers the portless alias.
- `/campaign-init` now offers `/campaign-portless` as option **4** in its "What's next?" block so local-dev URL setup is one click after scaffolding the campaign file.

### Changed

- `/tld-release` now offers to switch to the default branch when run from a feature branch with a clean working tree, instead of refusing outright.

## [v0.2.0] — 2026-05-03

### Added

- `/tld-release` skill — wraps the manual `RELEASING.md` procedure (CHANGELOG bump, release-branch PR, `gh release create`, marketplace auto-bump workflow watch) in one guided flow with hard stops at every destructive moment. Optional argument: `patch`, `minor`, `major`, or an explicit `vX.Y.Z`. Refuses to run when the working tree is dirty or when not on the default branch.
- `/tld-experience` skill — turns a lived conversation moment into a candidate skill on a new branch with the three house-style docs updated and a PR opened against `Jbrawner/tld-skills`. Runs `scripts/verify-block-alignment.py` before committing so embedded canonical blocks (sections that must match `STANDARDS.md` byte-for-byte) cannot drift.
- `/npc-partial` skill — content-ticket loop for skills/docs work with `skip` test commands. Runs `/tld-build` → HARD STOP for manual QA on the uncommitted diff → on approval commits and runs `/tld-next`. Skips `/tld-run-test` (no signal when the test command is `skip`) and lands the QA pause where it actually matters: between build and commit.
- `/npc-full` skill — uninterrupted variant of `/npc-partial` for content/doc tickets where the campaign test command is `skip`. Runs `/tld-build` → commit → `/tld-next` end-to-end with no QA pause between build and commit. Use when you trust the build and want the loop to keep moving; pair with `/npc-partial` when you want the diff-review stop.

### Removed

- `docs/SKILL_REFERENCE.md` — removed as redundant. Its content (skill catalog, Standard Flow, Context Recovery) duplicates README.md and CONTRIBUTING.md. The README's "Standard Flow" section and CONTRIBUTING.md's skill catalog are now the canonical homes. `docs/ADAPTERS.md` stays — it's the only place the tracker-adapter contract lives.

## [v0.1.0] — 2026-04-29

First open-source release. Extracts the TLD (Test-Led Development) skills framework from a single private project ("mAIn Character") and makes it portable to other repositories.

### Added

- `docs/ADAPTERS.md` — issue tracker adapter interface contract documenting all 11 MCP calls the TLD skills make (`list_issues`, `get_issue`, `save_issue`, `list_milestones`, `get_milestone`, `save_milestone`, `list_issue_labels`, `create_issue_label`, `list_issue_statuses`, `list_teams`, `get_project`). Specifies parameters passed, response fields read, and edge cases (auto-linking in milestone descriptions, rate-limiting behavior) so a contributor can implement a Jira or GitHub Issues adapter without asking questions. Tracked in 2ND-207.
- `docs/SKILL_REFERENCE.md` — authoritative reference for all 25 skills in the Adventure Skills repo, covering all TLD ticket-level skills (including `/tld-skip` and `/tld-recenter`), the boundary skill (`/tld-gate`), campaign skills, and planning skills. Includes a Standard Flow diagram and a Context Recovery section. Tracked in 2ND-213.
- TLD skill family: `/tld-setup`, `/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-align`, `/tld-audit`, `/tld-commit`, `/tld-next`, `/tld-skip`, `/tld-gate`, `/tld-auto`, `/tld-side-quest`, `/tld-save-point`, `/tld-dashboard`, `/tld-ticket`, `/tld-help`.
- `/tld-skip` skill — reverts the current In-Progress ticket to Todo (or a "Skipped" state if the Linear team has one) and points the user at the next ticket in the milestone's `## Order` section. The skipped ticket stays in Order and can be resumed any time via `/tld-setup {id}`. Tracked in 2ND-224.
- Campaign skill family for per-repo project configuration: `/campaign-init`, `/campaign-edit`, `/campaign-show`, `/campaign-test`, `/campaign-remove`.
- Milestone-driven architecture — Linear is the sole source of truth for milestones, ticket order (via the `## Order` section in each milestone description), and ticket status. The local `.tld/campaign.md` file holds only static project config.
- `CONTRIBUTING.md` with the test-led philosophy, hard-stop rules, no-drift rule, the Campaign File + Milestone Contract, and a pointer to STANDARDS.md for the canonical text of all 10 shared blocks.
- `STANDARDS.md` with the canonical text of the 10 reusable blocks (6 shared blocks: Numbered shortcut recognition, Milestone completion check, Recommendation hint, Manual-QA classification setup-time, Manual-QA classification verify-time, Approval keyword set; 4 paste-blocks: Load project config, Resolve next ticket discovery, Require current ticket strict, Local DB safety check) so SKILL.md drift can be enforced by `scripts/verify-block-alignment.py`. The split out of CONTRIBUTING.md is tracked in 2ND-276.
- `LIMITATIONS.md` documenting known constraints (Linear-only, Vitest/Jest assumed, Supabase local at 127.0.0.1:54321 assumed, alpha + dogfooding caveats).

### Changed

- Split the 10 canonical reusable blocks out of `CONTRIBUTING.md` into a dedicated `STANDARDS.md`. `CONTRIBUTING.md` retains the test-led philosophy, hard-stop rules, the no-drift rule, and the Campaign File + Milestone Contract. The drift verifier `scripts/verify-block-alignment.py` reads STANDARDS.md as source of truth. Tracked in 2ND-276.
- Generalized skill files to remove hardcoded project-specific identifiers: tld-audit domain examples are now `[your-auth-helper]` / `[your-api-key-helper]` / `[YourFeature].tsx` placeholders, tld-auto / tld-run-test seed filenames and example URLs are now generic, and tld-commit / tld-auto / tld-run-test now read the commit pattern, co-author line, and changelog path from `.tld/campaign.md` at runtime instead of hardcoding them. tld-ticket now reads test commands from `.tld/campaign.md` Test Commands. Tracked in 2ND-212.
- Capped `/tld-build`'s green-phase fix-and-retry loop at a hard 3-attempt maximum, with explicit attempt-tracking and a failure options block (mirroring `/tld-run-test`'s `/tld-align` / manual fix / `/tld-side-quest` triad) when the cap is hit. `/tld-build` is now the source of truth for the cap that `/tld-auto` already references. Tracked in 2ND-218.
- `/tld-ticket` now prompts for Model + Effort via AskUserQuestion before creating a ticket and applies the selections as `model:*` / `effort:*` labels via `save_issue`, defaulting to `sonnet` + `medium` if the user skips. `/campaign-plan` and `/milestone-create` gain label-not-found error handling that points users at `/campaign-init` to restore the required label set. Tracked in 2ND-233.
- `/tld-next` now reads the next ticket's `model:*` / `effort:*` labels and renders a `Recommended: model:X | effort:Y` line alongside the next-step command (defaults to `sonnet` / `medium` when labels are absent). The next-ticket "What's next?" block gains options to cycle the model (`sonnet → opus → haiku → sonnet`), cycle the effort (`low → medium → high → low`), or set a custom pair inline — each override updates the next ticket's Linear labels via `save_issue` and re-renders, looping until the user proceeds. Tracked in 2ND-234.

### Fixed

- `scripts/build-plugin.sh` cross-reference rewriter now also rewrites `/milestone-*` references (e.g., `/milestone-create`, `/milestone-sync`) to the `/tld:milestone-*` namespace. The original two-rule rewriter (`/campaign-` and `/tld-` only) left ~20 in-skill references pointing at unprefixed command names that don't exist once the plugin is installed, breaking error-recovery branches in `/tld-setup`, `/tld-dashboard`, `/tld-auto`, `/tld-next`, `/tld-help`, `/tld-save-point`, `/campaign-init`, `/milestone-create`, and `/milestone-sync`. Caught by `/tld-gate` on the M7 boundary. Tracked in 2ND-215.

### Removed

- `/campaign-switch` skill — obsolete under the per-repo campaign model (one campaign per repo, nothing to switch between). Tracked in 2ND-232.

### Planned (not yet in this release)

- Planning skill family for creating Linear structure: `/campaign-plan`, `/milestone-create`, `/milestone-sync`. Tracked in M4 (2ND-229, 2ND-230, 2ND-228; parent 2ND-225).

### Known limitations

See `LIMITATIONS.md` for the full list. Headlines: Linear-only issue tracker, Vitest/Jest test runner assumption, Supabase local DB assumption, alpha quality.

[v0.3.1]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.3.1
[v0.3.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.3.0
[v0.2.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.1.0
