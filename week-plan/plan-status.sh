#!/usr/bin/env bash
# Print a repo's current week plan with the live status of every ticket in it.
#
# The plan file (docs/plans/<monday>-week.md) holds the ORDER and the REASONS.
# It never holds status, because a status written into a file is stale the
# moment a ticket moves. This script asks the tracker, so what it prints is true now.
#
# Project-agnostic: it reads any tracker key that appears as a link ([ABC-123](...))
# and uses Jira's three status categories (To Do, In Progress, Done), which every
# Jira project has, instead of any project's own status names.
#
# A repo may also plan each week as a Jira release (a fix version). When the
# contract's Project config table names a `Week release`, for example
# `Week of <monday>`, every table gains a Release column and a release check
# follows the counts, so a plan file and its release cannot drift unnoticed.
# Without that key the output is exactly what it was before releases existed.
#
# Usage:  plan-status.sh              the newest *-week.md under docs/plans/ in the current repo
#                                    (any depth, symlinked folders followed: a repo may keep
#                                    the week files in an untracked docs/plans/weeks/)
#         plan-status.sh <file.md>    a specific plan file
# Needs:  acli (signed in) and jq, run from inside the repo.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
PLAN="${1:-$(find -L "$REPO/docs/plans" -name "*-week.md" | sort | tail -n 1)}"
WORK="$(mktemp -d)"
echo "Plan: ${PLAN#"$REPO"/}"

# 1. Every LINKED ticket key in the plan, in the order it first appears, and the
#    "## " section it appears under. Only links count: a bare ABC-123 in a sentence
#    or in the at-a-glance table is a mention, not a row of work. A key belongs to
#    the first section that links it.
awk '
  /^## / { section = substr($0, 4) }
  section != "" {
    line = $0
    while (match(line, /\[[A-Z][A-Z0-9]+-[0-9]+\]\(/)) {
      key = substr(line, RSTART + 1, RLENGTH - 3)
      if (!(key in seen)) { seen[key] = 1; print section "\t" key }
      line = substr(line, RSTART + RLENGTH)
    }
  }
' "$PLAN" > "$WORK/keys.tsv"

KEYS="$(cut -f2 "$WORK/keys.tsv" | paste -sd, -)"
[ -n "$KEYS" ] || { echo "No linked ticket keys found in $PLAN"; exit 1; }

# 2. One tracker query for all of them. The category is what the script reasons
#    with; the status name is printed for the reader.
acli jira workitem search --jql "key in ($KEYS)" --fields key,status,summary --paginate --json \
  | jq -r '.[] | [.key, .fields.status.statusCategory.name, .fields.status.name, .fields.summary[0:70]] | @tsv' \
  > "$WORK/tracker.tsv"

# 2b. Only when the contract names a `Week release`: the release for this plan's
#     Monday, and every ticket that carries it. acli refuses fixVersions in
#     --fields, so a search on the release is the only way to learn membership.
#     A release nobody has created yet is a notice, not a failure; any other
#     tracker error still stops the script.
RELEASE_PATTERN="$(sed -n 's/^| Week release | `\([^`]*\)`.*/\1/p' "$REPO/docs/plans/README.md" 2>/dev/null | head -n 1)"
RELEASE=""
RELEASE_MISSING=""
if [ -n "$RELEASE_PATTERN" ]; then
  RELEASE="${RELEASE_PATTERN//<monday>/$(basename "$PLAN" -week.md)}"
  if acli jira workitem search --jql "fixVersion = \"$RELEASE\"" --fields key,status,summary --paginate --json \
      > "$WORK/release.json" 2> "$WORK/release.err"; then
    jq -r '.[] | [.key, .fields.status.statusCategory.name, .fields.status.name, .fields.summary[0:70]] | @tsv' \
      "$WORK/release.json" > "$WORK/release.tsv"
  elif grep -qi "does not exist for the field 'fixversion'" "$WORK/release.err"; then
    RELEASE_MISSING="$RELEASE"
    RELEASE=""
  else
    cat "$WORK/release.err" >&2
    exit 1
  fi
fi

# 3. One table per section, in plan order; then counts by category; then "Next up":
#    the first ticket in the first section that is still in the To Do category.
#    With a week release: a Release column, then the release check.
awk -F'\t' -v release="$RELEASE" -v release_file="$WORK/release.tsv" '
  BEGIN {
    if (release != "")
      while ((getline row < release_file) > 0) { split(row, f, "\t"); in_release[f[1]] = row; release_order[++released] = f[1] }
  }
  NR == FNR { category[$1] = $2; status[$1] = $3; summary[$1] = $4; next }
  {
    if ($1 != section) {
      section = $1
      if (release == "") printf "\n%s\n\n| Ticket | Status | Summary |\n|---|---|---|\n", section
      else printf "\n%s\n\n| Ticket | Status | Release | Summary |\n|---|---|---|---|\n", section
      if (first_section == "") first_section = section
    }
    cat = ($2 in category) ? category[$2] : "not in tracker"
    if (release == "") printf "| %s | %s | %s |\n", $2, ($2 in status) ? status[$2] : cat, summary[$2]
    else printf "| %s | %s | %s | %s |\n", $2, ($2 in status) ? status[$2] : cat, ($2 in in_release) ? "yes" : "no", summary[$2]
    if (section == first_section && next_up == "" && cat == "To Do") next_up = $2 " (" status[$2] ")"
    count[cat]++
    planned[$2] = 1
    linked++
    if ($2 in in_release) carried++
  }
  END {
    printf "\nCounts: Done %d; In Progress %d; To Do %d", count["Done"], count["In Progress"], count["To Do"]
    if ("not in tracker" in count) printf "; not in tracker %d", count["not in tracker"]
    printf "\nNext up in %s: %s\n", first_section, (next_up == "" ? "nothing, every row is started or done" : next_up)
    if (release == "") exit
    printf "\nRelease check: %s\n\nPlan tickets that carry it: %d of %d\n", release, carried, linked
    for (i = 1; i <= released; i++) {
      key = release_order[i]
      if (key in planned) continue
      if (!extra++) printf "\nIn the release but not linked in the plan:\n\n| Ticket | Status | Summary |\n|---|---|---|\n"
      split(in_release[key], f, "\t")
      printf "| %s | %s | %s |\n", f[1], f[3], f[4]
    }
    if (!extra) printf "\nIn the release but not linked in the plan: none\n"
  }
' "$WORK/tracker.tsv" "$WORK/keys.tsv"
if [ -n "$RELEASE_MISSING" ]; then
  printf '\nRelease check: "%s" does not exist in Jira yet. Create it under Releases, Create version.\n' "$RELEASE_MISSING"
fi
rm -rf "$WORK"
