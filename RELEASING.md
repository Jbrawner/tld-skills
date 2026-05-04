# Releasing tld-skills

How to cut a new version of the `tld` plugin.

**Quick path:** run `/tld-release` (optional arg: `patch` / `minor` / `major` / `vX.Y.Z`) to do all of this with hard stops at every destructive moment — CHANGELOG diff review, branch + PR, post-merge release publish, and an automatic watch on the marketplace auto-bump workflow. The detailed manual procedure below is the fallback if `/tld-release` fails or you want to do it by hand.

## Quick procedure

1. **Bump CHANGELOG.md.** Change `## [vX.Y.Z-alpha] — Unreleased` to `## [vX.Y.Z] — YYYY-MM-DD` (today's date), then update the bottom link target to point at `Jbrawner/tld-skills/releases/tag/vX.Y.Z`.
2. **PR the bump into main.** Branch, commit, open PR, merge once it's clean.
3. **(Optional) Build the tarball** if you want a manual-install artifact attached to the release:
   ```bash
   bash scripts/build-plugin.sh
   tar -czf dist/tld-plugin-vX.Y.Z.tar.gz -C dist tld-plugin
   ```
   Skip this if a marketplace install is the only path you support — the marketplace doesn't use the tarball.
4. **Publish the release:**
   ```bash
   gh release create vX.Y.Z --target main \
     --title "vX.Y.Z — short summary" \
     --notes "Release notes here, or paste the matching CHANGELOG section."
   ```
   Add `dist/tld-plugin-vX.Y.Z.tar.gz` as a positional argument if you built the tarball in step 3.

## What happens automatically

The `release: published` event fires `.github/workflows/update-marketplace.yml`. It:

1. Checks out `Jbrawner/claude-skills` using the `MARKETPLACE_PAT` secret.
2. `jq`-patches `.claude-plugin/marketplace.json` so the `tld` plugin entry's `version` becomes `X.Y.Z` and `source.ref` becomes `vX.Y.Z`.
3. Opens a PR titled "Bump tld to vX.Y.Z" against `claude-skills`.
4. Squash-merges the PR.

End-to-end completes in roughly 30-60 seconds. Users running `/plugin update tld@claude-skills` next time will get the new version.

## Versioning

Follows semver. Pre-1.0 we're loose:

| Bump | When |
|---|---|
| Patch (`0.1.X`) | Bug fix, doc fix, minor improvement, no behavior change for users |
| Minor (`0.X.0`) | New skill, new feature, deprecation, behavior change users will notice |
| Major (`X.0.0`) | Reserved for 1.0 (out of alpha) and breaking changes after that |

## If the workflow fails

The bump PR may exist but not be merged, or marketplace.json may not be updated. Recovery:

1. Check the workflow run: `gh run list --repo Jbrawner/tld-skills --workflow=update-marketplace.yml --limit 1`
2. Read the failed step: `gh run view <run-id> --repo Jbrawner/tld-skills --log-failed`
3. If the PR opened but didn't merge, merge it manually:
   ```bash
   gh pr merge <pr-number> --repo Jbrawner/claude-skills --squash --delete-branch
   ```
4. If the PR didn't open (e.g., PAT expired, jq-patch errored), edit `.claude-plugin/marketplace.json` on `claude-skills` directly — bump the `tld` entry's `version` and `source.ref`, commit, push.
5. Fix the underlying workflow problem before the next release.

## PAT rotation

The `MARKETPLACE_PAT` secret in `Jbrawner/tld-skills` is a fine-grained PAT scoped to `Jbrawner/claude-skills` only. Permissions: `Contents: Write`, `Pull requests: Write`. Default 1-year expiration.

When it expires:

1. Generate a new fine-grained PAT at https://github.com/settings/personal-access-tokens with the same scope and permissions.
2. `gh secret set MARKETPLACE_PAT --repo Jbrawner/tld-skills` and paste the new token.

GitHub emails a warning ~7 days before expiration. Calendar reminder for ~1 year out doesn't hurt.
