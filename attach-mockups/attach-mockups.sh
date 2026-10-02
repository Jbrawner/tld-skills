#!/bin/bash
# Attach mockup images to Jira tickets, one list per feature.
#
#   bash attach-mockups.sh <list.tsv>            attach every file the list names
#   bash attach-mockups.sh <list.tsv> --dry-run  show what would be attached, send nothing
#
# Each line of the list is: TICKET-KEY <tab> /full/path/to/image.png
# build-list.sh writes it. A file already attached to a ticket under the same name is
# skipped, so the script is safe to run twice.
#
# The Jira site comes from JIRA_SITE, for example JIRA_SITE=https://your-team.atlassian.net.
#
# Sign-in: your own Atlassian email (JIRA_EMAIL, or asked) and API token (create one at
# https://id.atlassian.com/manage-profile/security/api-tokens). The token is read from
# JIRA_API_TOKEN if set, otherwise from your macOS Keychain item "jira-attach-mockups",
# otherwise you are asked for it (hidden) and offered a Keychain save for next time.
# The token never leaves this machine except to Jira.

set -u
KEYCHAIN_ITEM="jira-attach-mockups"
REPLY_FILE="$(mktemp)"
trap 'rm -f "$REPLY_FILE"' EXIT

LIST="${1:-}"
DRY_RUN="no"
[ "${2:-}" = "--dry-run" ] && DRY_RUN="yes"

if [ -z "$LIST" ] || [ ! -f "$LIST" ]; then
  echo "Usage: bash attach-mockups.sh <list.tsv> [--dry-run]"
  exit 2
fi

# Check every file exists before sending anything.
missing=0
while IFS=$'\t' read -r key file; do
  [ -z "$key" ] && continue
  if [ ! -f "$file" ]; then
    echo "Missing file for $key: $file"
    missing=$((missing + 1))
  fi
done < "$LIST"
if [ "$missing" -gt 0 ]; then
  echo "$missing file(s) missing. Nothing was sent."
  exit 1
fi

if [ "$DRY_RUN" = "yes" ]; then
  echo "Dry run: $(grep -c . "$LIST") attachment(s) across $(cut -f1 "$LIST" | sort -u | grep -c .) ticket(s)."
  cut -f1 "$LIST" | sort -u | while read -r key; do
    echo "  $key: $(grep "^$key	" "$LIST" | cut -f2 | xargs -I{} basename {} | tr '\n' ' ')"
  done
  exit 0
fi

SITE="${JIRA_SITE:-}"
if [ -z "$SITE" ]; then
  echo "No Jira site given. Nothing was sent."
  echo "Put it in front: JIRA_SITE=https://your-team.atlassian.net bash attach-mockups.sh <list.tsv>"
  exit 1
fi
SITE="https://${SITE#https://}"
SITE="${SITE%/}"
# A token made with "Create API token with scopes" is refused at the site address and works
# only through Atlassian's API gateway, so sign-in tries both and keeps whichever answers.
# The gateway address carries the site's cloud ID, which the site publishes without sign-in.
CLOUD_ID="$(curl -s "$SITE/_edge/tenant_info" | jq -r '.cloudId // empty' 2>/dev/null)"
GATEWAY="${CLOUD_ID:+https://api.atlassian.com/ex/jira/$CLOUD_ID}"

EMAIL="${JIRA_EMAIL:-}"
if [ -z "$EMAIL" ]; then
  printf "Atlassian email: "
  read -r EMAIL
fi
# Run from somewhere that cannot take typed input (the chat's ! prompt), the read above comes
# back empty. Stop here, before the Keychain is touched.
if [ -z "$EMAIL" ]; then
  echo
  echo "No email given. Nothing was sent."
  echo "Run it in a terminal tab, or put the email in front: JIRA_EMAIL=you@example.com bash attach-mockups.sh <list.tsv>"
  exit 1
fi

TOKEN="${JIRA_API_TOKEN:-}"
IN_KEYCHAIN="no"
if [ -z "$TOKEN" ]; then
  TOKEN="$(security find-generic-password -s "$KEYCHAIN_ITEM" -a "$EMAIL" -w 2>/dev/null || true)"
  [ -n "$TOKEN" ] && IN_KEYCHAIN="yes" && echo "Using the token saved in your Keychain."
fi
if [ -z "$TOKEN" ]; then
  printf "Atlassian API token (hidden): "
  read -rs TOKEN
  echo
  # A pasted token sometimes carries a stray space or line break; a real one has neither.
  TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
  # The length says whether the paste landed without showing any of the token.
  echo "Got a ${#TOKEN}-character token."
  if [ "${#TOKEN}" -lt 100 ]; then
    echo "That is too short for an Atlassian API token (they run to about 190 characters), so it did not paste whole. Nothing was sent."
    exit 1
  fi
  printf "Save it in your Keychain for next time? [y/N] "
  read -r save
  if [ "$save" = "y" ] || [ "$save" = "Y" ]; then
    security add-generic-password -U -s "$KEYCHAIN_ITEM" -a "$EMAIL" -w "$TOKEN" && echo "Saved." && IN_KEYCHAIN="yes"
  fi
fi

# One sign-in check before touching any ticket.
BASE=""
reply=""
for base in "$SITE" "$GATEWAY"; do
  [ -n "$base" ] || continue
  code="$(curl -s -o "$REPLY_FILE" -w '%{http_code}' -u "$EMAIL:$TOKEN" "$base/rest/api/3/myself")"
  if [ "$code" = "200" ]; then
    BASE="$base"
    break
  fi
  reply="$code, $(head -c 160 "$REPLY_FILE" | tr '\n' ' ')"
done
if [ -z "$BASE" ]; then
  echo "Jira refused that email and token ($reply). Nothing was sent."
  if [ "$IN_KEYCHAIN" = "yes" ]; then
    security delete-generic-password -s "$KEYCHAIN_ITEM" -a "$EMAIL" >/dev/null 2>&1 \
      && echo "Removed that token from your Keychain, so the next run asks for a new one."
  fi
  echo "Check that $EMAIL is the email you sign in to Jira with, and that the token was copied whole."
  echo "If it was made with 'Create API token with scopes', make one with plain 'Create API token' instead."
  exit 1
fi
who="$(jq -r '.displayName // empty' < "$REPLY_FILE" 2>/dev/null)"
echo "Signed in to Jira as ${who:-$EMAIL}."
[ "$BASE" = "$GATEWAY" ] && echo "(Through Atlassian's API gateway, because the token was made with scopes.)"

attached=0
skipped=0
failed=0
for key in $(cut -f1 "$LIST" | sort -u); do
  have="$(curl -s -u "$EMAIL:$TOKEN" "$BASE/rest/api/3/issue/$key?fields=attachment" | jq -r '.fields.attachment[]?.filename' 2>/dev/null)"
  while IFS= read -r file; do
    name="$(basename "$file")"
    if echo "$have" | grep -qxF "$name"; then
      skipped=$((skipped + 1))
      continue
    fi
    code="$(curl -s -o /dev/null -w '%{http_code}' -u "$EMAIL:$TOKEN" \
      -H "X-Atlassian-Token: no-check" \
      -F "file=@$file;type=image/png" \
      "$BASE/rest/api/3/issue/$key/attachments")"
    if [ "$code" = "200" ]; then
      attached=$((attached + 1))
      echo "  $key  attached  $name"
    else
      failed=$((failed + 1))
      echo "  $key  FAILED ($code)  $name"
    fi
  done < <(grep "^$key	" "$LIST" | cut -f2)
done

echo "Done: $attached attached, $skipped already there, $failed failed."
[ "$failed" -eq 0 ]
