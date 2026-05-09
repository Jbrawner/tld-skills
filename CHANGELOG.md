# Changelog

All notable changes to Adventure Skills are recorded here. Versions follow semantic versioning once we leave alpha.

## [Unreleased]

### Added

### Changed

- `/tld-release` step 11 now reads `marketplace.json` from `Jbrawner/claude-skills` after the auto-bump PR merges and verifies the `tld` plugin's `version` field actually equals the new release. The workflow + PR success path was *necessary but not sufficient* — a green workflow could still leave the file unchanged in some failure modes. The new step 11b prints `marketplace.json verified at {new-version}` on match (or surfaces the actual value on mismatch) so the release report is a confirmed end-to-end success without the user having to spot-check the file by hand.

### Fixed

### Removed

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

[v0.3.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.3.0
[v0.2.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Jbrawner/tld-skills/releases/tag/v0.1.0
