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

# 3. One table per section, in plan order; then counts by category; then "Next up":
#    the first ticket in the first section that is still in the To Do category.
awk -F'\t' '
  NR == FNR { category[$1] = $2; status[$1] = $3; summary[$1] = $4; next }
  {
    if ($1 != section) {
      section = $1
      printf "\n%s\n\n| Ticket | Status | Summary |\n|---|---|---|\n", section
      if (first_section == "") first_section = section
    }
    cat = ($2 in category) ? category[$2] : "not in tracker"
    printf "| %s | %s | %s |\n", $2, ($2 in status) ? status[$2] : cat, summary[$2]
    if (section == first_section && next_up == "" && cat == "To Do") next_up = $2 " (" status[$2] ")"
    count[cat]++
  }
  END {
    printf "\nCounts: Done %d; In Progress %d; To Do %d", count["Done"], count["In Progress"], count["To Do"]
    if ("not in tracker" in count) printf "; not in tracker %d", count["not in tracker"]
    printf "\nNext up in %s: %s\n", first_section, (next_up == "" ? "nothing, every row is started or done" : next_up)
  }
' "$WORK/tracker.tsv" "$WORK/keys.tsv"
rm -rf "$WORK"
