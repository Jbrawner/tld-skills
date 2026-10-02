#!/usr/bin/env bash
# Build the attach list for one feature: which mockup picture goes on which Jira ticket.
#
#   build-list.sh <EPIC-KEY> <mockup-folder> [<list.tsv>]
#
# The list defaults to <mockup-folder>/jira-attachments.tsv. Each line is
# TICKET-KEY <tab> /full/path/to/picture.png, the shape attach-mockups.sh reads.
#
# The rules:
#   - The tickets are the Epic, its Stories and their Sub-tasks.
#   - A ticket gets exactly the pictures its description names (any word ending in .png).
#   - An Epic whose description names no picture gets the folder's 01 picture, the overview.
#   - A ticket that names no picture gets nothing.
#   - A named picture with no file in the folder is reported as missing and left out of the list.
#   - A picture in the folder that lands on no ticket is reported as unused.
#
# Prints the table to show the user, the totals, and the command that does the real upload.
# Sends nothing to Jira. Needs: acli (signed in) and jq.
set -euo pipefail

EPIC="${1:-}"
FOLDER_ARG="${2:-}"
if ! [[ "$EPIC" =~ ^[A-Z][A-Z0-9]+-[0-9]+$ ]] || [ ! -d "$FOLDER_ARG" ]; then
  echo "Usage: build-list.sh <EPIC-KEY> <mockup-folder> [<list.tsv>]"
  exit 2
fi
FOLDER="$(cd "$FOLDER_ARG" && pwd)"
LIST="${3:-$FOLDER/jira-attachments.tsv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Who is signed in to acli, and on which site. The upload command needs both.
if ! acli jira auth status > "$WORK/auth.txt" 2>&1; then
  echo "acli is not signed in to Jira. Run: acli jira auth login"
  exit 1
fi
SITE="$(sed -n 's/^ *Site: *//p' "$WORK/auth.txt" | head -n 1)"
EMAIL="$(sed -n 's/^ *Email: *//p' "$WORK/auth.txt" | head -n 1)"
SITE="https://${SITE#https://}"

# 2. The whole tree in one search. parentEpic returns the Epic itself, its children and their
#    sub-tasks; --paginate matters, because without it acli stops at the first page and says nothing.
acli jira workitem search --jql "parentEpic = $EPIC" \
  --fields key,issuetype,summary,description --paginate --json > "$WORK/tree.json"

TYPE="$(jq -r --arg e "$EPIC" '.[] | select(.key == $e) | .fields.issuetype.name' "$WORK/tree.json")"
if [ "$TYPE" != "Epic" ]; then
  echo "$EPIC is ${TYPE:-not in Jira}, not an Epic. Give the Epic the feature's tickets sit under."
  exit 1
fi
if [ "$(jq length "$WORK/tree.json")" -lt 2 ]; then
  echo "$EPIC has no tickets under it yet. Create the tickets first, then attach the pictures."
  exit 1
fi

# 3. One row per ticket, the Epic first and the rest in key order:
#    key, type, title, then the picture names its description gives, each once, in name order.
jq -r --arg e "$EPIC" '
  sort_by(if .key == $e then 0 else 1 end, (.key | split("-")[1] | tonumber))[]
  | [ .key, .fields.issuetype.name, (.fields.summary | gsub("[\t\n]"; " ")),
      ((.fields.description // {}) | [.. | objects | .text? // empty] | join(" ")
        | [scan("[A-Za-z0-9._-]+\\.png")]
        | unique | join(" ")) ]
  | @tsv' "$WORK/tree.json" > "$WORK/tickets.tsv"

# 4. The Epic's fallback: no picture named, so the folder's 01 picture, the overview board.
EPIC_NOTE=""
EPIC_NAMES="$(awk -F'\t' -v e="$EPIC" '$1 == e { print $4 }' "$WORK/tickets.tsv")"
if [ -z "$EPIC_NAMES" ]; then
  OVERVIEW="$(cd "$FOLDER" && ls 01-*.png 2>/dev/null | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$OVERVIEW" ]; then
    awk -F'\t' -v OFS='\t' -v e="$EPIC" -v o="$OVERVIEW" '$1 == e { $4 = o } { print }' \
      "$WORK/tickets.tsv" > "$WORK/t" && mv "$WORK/t" "$WORK/tickets.tsv"
    EPIC_NOTE="The Epic's description names no picture, so it gets the folder's 01 picture: $OVERVIEW"
  else
    EPIC_NOTE="The Epic's description names no picture and the folder has no 01 picture, so the Epic gets nothing."
  fi
fi

# 5. The list, and every named picture that has no file.
: > "$LIST"
: > "$WORK/missing.txt"
while IFS=$'\t' read -r key _type _title names; do
  for name in $names; do
    if [ -f "$FOLDER/$name" ]; then
      printf '%s\t%s\n' "$key" "$FOLDER/$name" >> "$LIST"
    else
      echo "$key names $name" >> "$WORK/missing.txt"
    fi
  done
done < "$WORK/tickets.tsv"

# 6. Every picture in the folder that lands on no ticket.
cut -f2 "$LIST" | sort -u > "$WORK/used.txt"
for file in "$FOLDER"/*.png; do [ -e "$file" ] && echo "$file"; done | sort > "$WORK/all.txt"
comm -23 "$WORK/all.txt" "$WORK/used.txt" | sed 's|.*/||' > "$WORK/unused.txt"

# 7. The report.
title() { awk -F'\t' -v k="$1" '$1 == k { print $3 }' "$WORK/tickets.tsv"; }
link() { printf '[%s](%s/browse/%s) %s' "$1" "$SITE" "$1" "$(title "$1")"; }

echo "Epic: $(link "$EPIC")"
echo "Folder: $FOLDER"
echo "List: $LIST"
echo
echo "| Ticket | Pictures | Count |"
echo "|---|---|---|"
for key in $(cut -f1 "$LIST" | awk '!seen[$0]++'); do
  pictures="$(awk -F'\t' -v k="$key" '$1 == k' "$LIST" | cut -f2 | sed 's|.*/||' | paste -sd, - | sed 's/,/, /g')"
  echo "| $(link "$key" | sed 's/|/\\|/g') | $pictures | $(awk -F'\t' -v k="$key" '$1 == k' "$LIST" | grep -c .) |"
done
echo
by_type() { awk -F'\t' -v t="$1" '$2 == t' "$WORK/tickets.tsv" | cut -f1 | grep -cxF -f <(cut -f1 "$LIST" | sort -u) || true; }
echo "Totals: $(grep -c . "$LIST" || true) attachments on $(cut -f1 "$LIST" | sort -u | grep -c . || true) tickets" \
  "($(by_type Epic) Epic, $(by_type Story) Stories, $(by_type Sub-task) Sub-tasks);" \
  "$(grep -c . "$WORK/unused.txt" || true) unused pictures; $(grep -c . "$WORK/missing.txt" || true) missing files."
[ -n "$EPIC_NOTE" ] && echo "$EPIC_NOTE"
echo
echo "Names no picture, so gets nothing:"
awk -F'\t' '$4 == ""' "$WORK/tickets.tsv" | cut -f1 | while read -r key; do echo "  $(link "$key")"; done | grep . || echo "  none"
echo "Missing (named in a description, no file in the folder):"
sed 's/^/  /' "$WORK/missing.txt" | grep . || echo "  none"
echo "Unused (in the folder, on no ticket):"
sed 's/^/  /' "$WORK/unused.txt" | grep . || echo "  none"
echo
echo "Real upload, for the user to run in a terminal tab:"
echo "JIRA_SITE=$SITE JIRA_EMAIL=$EMAIL bash \"$HERE/attach-mockups.sh\" \"$LIST\""
