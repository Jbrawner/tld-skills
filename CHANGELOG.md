# Changelog

All notable changes to Adventure Skills are recorded here. Versions follow semantic versioning once we leave alpha.

## [v0.1.0-alpha] — Unreleased

First open-source release. Extracts the TLD (Test-Led Development) skills framework from a single private project ("mAIn Character") and makes it portable to other repositories.

### Added

- TLD skill family: `/tld-setup`, `/tld-write-tests`, `/tld-build`, `/tld-run-test`, `/tld-align`, `/tld-audit`, `/tld-commit`, `/tld-next`, `/tld-gate`, `/tld-auto`, `/tld-side-quest`, `/tld-save-point`, `/tld-dashboard`, `/tld-ticket`, `/tld-help`.
- Campaign skill family for per-repo project configuration: `/campaign-init`, `/campaign-edit`, `/campaign-show`, `/campaign-test`, `/campaign-remove`.
- Milestone-driven architecture — Linear is the sole source of truth for milestones, ticket order (via the `## Order` section in each milestone description), and ticket status. The local `.tld/campaign.md` file holds only static project config.
- `CONTRIBUTING.md` with the canonical text of the four shared blocks (Numbered shortcut recognition, Milestone completion check, Recommendation hint, Manual-QA classification) plus the Campaign File + Milestone Contract, Local DB Safety Check, and Canonical Approval Keyword set.
- `LIMITATIONS.md` documenting known constraints (Linear-only, Vitest/Jest assumed, Supabase local at 127.0.0.1:54321 assumed, alpha + dogfooding caveats).

### Changed

- Generalized skill files to remove hardcoded project-specific identifiers: tld-audit domain examples are now `[your-auth-helper]` / `[your-api-key-helper]` / `[YourFeature].tsx` placeholders, tld-auto / tld-run-test seed filenames and example URLs are now generic, and tld-commit / tld-auto / tld-run-test now read the commit pattern, co-author line, and changelog path from `.tld/campaign.md` at runtime instead of hardcoding them. tld-ticket now reads test commands from `.tld/campaign.md` Test Commands. Tracked in 2ND-212.

### Removed

- `/campaign-switch` skill — obsolete under the per-repo campaign model (one campaign per repo, nothing to switch between). Tracked in 2ND-232.

### Planned (not yet in this release)

- Planning skill family for creating Linear structure: `/campaign-plan`, `/milestone-create`, `/milestone-sync`. Tracked in M4 (2ND-229, 2ND-230, 2ND-228; parent 2ND-225).

### Known limitations

See `LIMITATIONS.md` for the full list. Headlines: Linear-only issue tracker, Vitest/Jest test runner assumption, Supabase local DB assumption, alpha quality.

[v0.1.0-alpha]: https://github.com/2ndfoundry/adventure-skills/releases/tag/v0.1.0-alpha
