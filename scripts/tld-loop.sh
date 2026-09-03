#!/usr/bin/env bash
# =============================================================================
# tld-loop — Ralph-style per-ticket autonomous TLD loop (reusable, any repo).
#
# A FRESH `claude -p` per ticket (clean context every time — no compaction),
# each driven through /tld-full-auto, committed, then moved to the PRE-MERGE
# status in Jira. By default it never pushes, PRs, or merges — it drafts a PR
# for you to fire yourself. Two flags extend the ending, and only the flags:
# --pr pushes the branch and opens the PR; --merge does that and then merges,
# ONLY on positively-confirmed green CI, and marks the merged tickets Done.
# The INNER Claude runs are always hard-denied `git push` and `gh` regardless
# of flags: every outward git action is deterministic bash in THIS wrapper,
# run because you passed the flag, never a model's decision.
#
# DONE IS WRITTEN ONLY AFTER A CONFIRMED MERGE. The inner Claude runs have
# `git push` and `gh` denied by design — they cannot see the remote, so they
# can never confirm that a commit reached the default branch, and a ticket
# marked Done on a commit is a claim nobody checked; that is exactly how 26
# tickets once read Done on branches nobody ever opened a PR for. Committed
# work lands in $PREMERGE_STATUS ("work complete, awaiting merge"). Without
# --merge, Done is left to whatever confirms the merge later (/tld-gate). With
# --merge, this wrapper becomes the confirmer: it merges on green CI, re-reads
# the PR state, and marks tickets Done ONLY once that re-read says MERGED.
# Unconfirmable is treated as failed. See docs/DONE_MEANS_MERGED.md.
#
# WHERE THIS LIVES. Source of truth: scripts/tld-loop.sh in the tld-skills repo.
# It is installed for use as ~/.claude/tld-loop.sh. Keep the installed copy a
# symlink so the two cannot drift:
#     ln -sf ~/.claude/skills/scripts/tld-loop.sh ~/.claude/tld-loop.sh
#
# NOTHING INVOKES THIS SCRIPT. It is a terminal entry point you run by hand, not
# a skill. The dependency runs one way: this script shells out to `claude -p`,
# which invokes /tld-full-auto per ticket. /tld-full-auto knows nothing about
# this file and never calls it. Living in the repo buys review and history, not
# reachability.
#
# Reusable: pass a Story key; the loop pulls that Story's Sub-tasks from Jira
# (via acli, rank order) and reads per-repo settings from ./.tld/. Nothing is
# hardcoded to one project.
#
# USAGE (run from the repo root; the repo must have .tld/campaign.md):
#   tld-loop LAB-397 --only LAB-398   # test ONE ticket end to end (do this first)
#   tld-loop LAB-397 --dry            # print the plan, run nothing
#   tld-loop LAB-397                  # run the whole Story, stop at the pre-merge banner
#   tld-loop LAB-397 --from LAB-400   # resume from a ticket
#   tld-loop LAB-397 --pr             # …then push the branch and open the PR (no merge)
#   tld-loop LAB-397 --merge          # …then squash-merge, ONLY on positively-confirmed
#                                     #   green CI, and mark the merged tickets Done.
#                                     #   Passing the flag IS the permission for that run;
#                                     #   there is no second prompt.
#
# Optional per-repo file ./.tld/loop.conf (sourced) to set safety/limits:
#   PROD_DB_REF="tyvqtjqhwkobfmkzyope"   # prod DB id to HARD-BLOCK (strongly recommended)
#   LOCAL_DB_HINT="127.0.0.1:54321"
#   DONE_STATUS="Done"                    # Jira status name for done (verify yours)
#   PREMERGE_STATUS="In PR"               # where committed-but-unmerged tickets land
#   CI_WATCH_SECS=1200                    # --merge only: how long to watch CI before giving up
#   MAX_BUDGET_USD=""                     # OPTIONAL per-ticket $ cap; empty = no cap (default)
# =============================================================================
set -uo pipefail

# ---- args -------------------------------------------------------------------
STORY="${1:-}"
case "$STORY" in ""|--*) echo "usage: tld-loop <STORY-KEY> [--only KEY] [--from KEY] [--dry] [--pr|--merge]"; exit 2;; esac
shift
ONLY=""; DRY=0; FROM=""; PR=0; MERGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only)  ONLY="$2"; shift 2;;
    --from)  FROM="$2"; shift 2;;
    --dry)   DRY=1; shift;;
    --pr)    PR=1; shift;;
    --merge) MERGE=1; PR=1; shift;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done
if [ -n "$ONLY" ] && [ "$PR" = "1" ]; then
  echo "--only is a single-ticket smoke test and never lands; drop --only or drop --pr/--merge."
  exit 2
fi

# ---- preflight --------------------------------------------------------------
BRANCH="$(git branch --show-current 2>/dev/null)"
[ -n "$BRANCH" ] || { echo "Not in a git repo."; exit 1; }
case "$BRANCH" in main|master) echo "Refusing to run on '$BRANCH'. Switch to a feature branch."; exit 1;; esac
[ -f ".tld/campaign.md" ] || { echo "No ./.tld/campaign.md — run this from the project root."; exit 1; }
command -v acli   >/dev/null || { echo "acli not found."; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found."; exit 1; }
grep -qiE 'Issue tracker:\s*Jira' .tld/campaign.md || { echo "This loop is Jira-only for now; campaign tracker is not Jira."; exit 1; }

# ---- landing preflight (only when --pr / --merge was passed) ----------------
# Prove the landing lane works BEFORE burning a single ticket. Discovering a
# dead merge lane after an hour of burns is its own incident.
PR_URL=""; DEFAULT_BRANCH=""
if [ "$PR" = "1" ]; then
  command -v gh >/dev/null || { echo "--pr/--merge need the gh CLI."; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated — run: gh auth login"; exit 1; }
  DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)"
  [ -n "$DEFAULT_BRANCH" ] || { echo "Cannot resolve the default branch via gh."; exit 1; }
  [ "$BRANCH" != "$DEFAULT_BRANCH" ] || { echo "Refusing: '$BRANCH' IS the default branch."; exit 1; }
  if [ "$MERGE" = "1" ]; then
    sq="$(gh repo view --json squashMergeAllowed -q .squashMergeAllowed 2>/dev/null)"
    perm="$(gh repo view --json viewerPermission -q .viewerPermission 2>/dev/null)"
    [ "$sq" = "true" ] || { echo "--merge preflight failed: squash merges are not allowed on this repo."; exit 1; }
    case "$perm" in WRITE|MAINTAIN|ADMIN) :;; *) echo "--merge preflight failed: need write permission (got: ${perm:-none})."; exit 1;; esac
  fi
fi

# ---- per-repo config (optional) --------------------------------------------
PROD_DB_REF=""; LOCAL_DB_HINT="the local stack named in .tld/campaign.md"; DONE_STATUS="Done"; MAX_BUDGET_USD=""
PREMERGE_STATUS="In PR"; CI_WATCH_SECS=1200
# shellcheck disable=SC1091
[ -f ".tld/loop.conf" ] && source ".tld/loop.conf"
PROD_DB_REF="${PROD_DB_REF:-${TLD_PROD_DB_REF:-}}"

# ---- guardrails: what each unattended Claude may / may NOT do ---------------
PERM_MODE="acceptEdits"
ALLOW_TOOLS="Read Edit Write Grep Glob Bash Skill TodoWrite"
DENY_TOOLS=(
  "Bash(git push:*)" "Bash(git push *)"
  "Bash(gh:*)" "Bash(gh *)"
  "Bash(git remote *)"
  "Bash(*db reset*)" "Bash(supabase db reset*)"
  "Bash(supabase link*)"
)
[ -n "$PROD_DB_REF" ] && DENY_TOOLS+=("Bash(*${PROD_DB_REF}*)")

SAFETY_PROMPT="HARD SAFETY RULES (non-negotiable): Operate ONLY against the LOCAL database (${LOCAL_DB_HINT}); prove the target is local before ANY DB write.$([ -n "$PROD_DB_REF" ] && echo " NEVER touch the production ref ${PROD_DB_REF}.") NEVER push, open a PR, merge, or run 'supabase db reset'. Commit to the current branch only, following the repo's commit format from .tld/campaign.md. If you cannot proceed safely, STOP and explain — never improvise around a safety rule."

LOG_DIR=".tld/loop-logs"; mkdir -p "$LOG_DIR"
PROGRESS="$LOG_DIR/progress-${STORY}.md"
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }

# ---- Jira helpers -----------------------------------------------------------
jira_status() { acli jira workitem view "$1" --json -f status 2>/dev/null | python3 -c 'import sys,json
try:
    s=json.load(sys.stdin)["fields"]["status"]; print(s["name"] if isinstance(s,dict) else s)
except Exception: print("?")' 2>/dev/null; }

# Move a ticket to the pre-merge status. Deliberately NOT a mark-Done helper:
# this loop cannot push, PR, or merge, so it can never confirm the code reached
# the default branch, and a status it cannot verify is a status it must not
# write. Returns non-zero if the transition did not take, so the caller can say
# so out loud instead of silently reporting success.
jira_premerge() {
  [ -n "$PREMERGE_STATUS" ] || return 1
  acli jira workitem transition -k "$1" -s "$PREMERGE_STATUS" -y >/dev/null 2>&1
}

# Done — callable from exactly one place: the --merge landing phase, AFTER a
# `gh pr view` re-read has returned MERGED. That confirmation is what the
# doctrine (docs/DONE_MEANS_MERGED.md) requires before a done-category write.
# Never call this from run_ticket or any pre-merge path.
jira_done() { acli jira workitem transition -k "$1" -s "$DONE_STATUS" -y >/dev/null 2>&1; }

# ---- derive ticket list from Jira (rank order) ------------------------------
TICKETS=(); STATUSES=()
while IFS=' ' read -r k s; do [ -n "$k" ] && { TICKETS+=("$k"); STATUSES+=("$s"); }; done < <(
  acli jira workitem search -j "parent = ${STORY} AND issuetype = Sub-task ORDER BY Rank ASC" --json -f key,status 2>/dev/null | python3 -c '
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get("values") or d.get("issues") or d.get("workItems") or []
for it in items:
    f=it.get("fields",it); st=f.get("status"); st=st.get("name") if isinstance(st,dict) else st
    print(it.get("key"), (st or "?"))
')
[ "${#TICKETS[@]}" -gt 0 ] || { echo "No Sub-tasks found under $STORY (is it a Story with Sub-tasks?)."; exit 1; }

# ---- run one ticket ---------------------------------------------------------
run_ticket() {
  local key="$1"
  local st; st="$(jira_status "$key")"
  say "── $key  (Jira: $st) ──"
  case "$st" in
    "$DONE_STATUS")     note "already Done — skipping."; return 0;;
    "$PREMERGE_STATUS") note "already $PREMERGE_STATUS (committed, awaiting merge) — skipping."; return 0;;
  esac
  if [ "$DRY" = "1" ]; then note "[dry] would run /tld-full-auto $key, commit, then move it to $PREMERGE_STATUS (never Done)."; return 0; fi

  local head_before; head_before="$(git rev-parse HEAD)"
  local tlog="$LOG_DIR/${key}.log"
  local prompt="Take ONLY ticket ${key} through the full TLD flow by invoking /tld-full-auto ${key} via the Skill tool (let it run /tld-setup, /tld-write-tests, /tld-build, /tld-audit, /tld-run-test — do not reproduce those phases yourself). When it stops at the verified checkpoint, LAND this ticket: stage ONLY ${key}'s files (never 'git add -A'), update the right CHANGE_LOG.md under [Unreleased], and commit following the commit format in .tld/campaign.md so the message references ${key} (include the co-author trailer if the campaign sets one). Do NOT push, open a PR, merge, or change Jira — the wrapper handles Jira. Migration/schema tickets: hand-apply to the LOCAL stack only and run the backend tests too. If you cannot land it, STOP and say why. End with one line: TLD_RESULT=DONE or TLD_RESULT=BLOCKED <short reason>."

  local budget_arg=()
  [ -n "$MAX_BUDGET_USD" ] && budget_arg=(--max-budget-usd "$MAX_BUDGET_USD")
  note "running fresh claude$([ -n "$MAX_BUDGET_USD" ] && echo " (budget cap \$$MAX_BUDGET_USD)")…  log: $tlog"
  claude -p "$prompt" \
    --permission-mode "$PERM_MODE" \
    --allowedTools $ALLOW_TOOLS \
    --disallowedTools "${DENY_TOOLS[@]}" \
    --append-system-prompt "$SAFETY_PROMPT" \
    ${budget_arg[@]+"${budget_arg[@]}"} \
    --output-format text >"$tlog" 2>&1

  local head_after; head_after="$(git rev-parse HEAD)"
  if [ "$head_after" != "$head_before" ] && git log "$head_before"..HEAD --oneline | grep -q "$key"; then
    local hash; hash="$(git rev-parse --short HEAD)"
    LANDED=$((LANDED + 1)); LANDED_KEYS+=("$key")
    if jira_premerge "$key"; then
      printf -- '- %s  ✅ committed %s  → Jira: %s  (NOT merged)\n' "$key" "$hash" "$(jira_status "$key")" >>"$PROGRESS"
    elif [ -z "$PREMERGE_STATUS" ]; then
      printf -- '- %s  ✅ committed %s  → Jira left as %s (PREMERGE_STATUS unset)  (NOT merged)\n' \
        "$key" "$hash" "$(jira_status "$key")" >>"$PROGRESS"
    else
      printf -- '- %s  ✅ committed %s  ⚠️  Jira NOT updated — still %s (transition to "%s" failed)\n' \
        "$key" "$hash" "$(jira_status "$key")" "$PREMERGE_STATUS" >>"$PROGRESS"
      note "WARNING: could not move $key to \"$PREMERGE_STATUS\" — left as $(jira_status "$key"). Check the status name in .tld/loop.conf."
    fi
    note "COMMITTED $key @ $hash  (on this branch only — nothing pushed, nothing merged)"
    return 0
  else
    local reason; reason="$(grep -oE 'TLD_RESULT=BLOCKED.*' "$tlog" | head -1)"
    printf -- '- %s  ⛔ NOT landed (no commit). %s  (see %s)\n' "$key" "${reason:-no result line}" "$tlog" >>"$PROGRESS"
    note "NOT LANDED $key — no new commit. Left as-is. Continuing."
    return 1
  fi
}

# ---- main -------------------------------------------------------------------
say "TLD loop — Story $STORY on branch $BRANCH"
note "tickets (rank order): ${TICKETS[*]}"
[ -n "$PROD_DB_REF" ] || note "WARNING: no PROD_DB_REF set in .tld/loop.conf — prod-DB name guard is OFF (push/PR/reset still blocked)."
[ "$MERGE" = "1" ] && note "--merge armed: on positively-green CI this run will push, open the PR, squash-merge into ${DEFAULT_BRANCH}, and mark tickets Done — no further prompt."
[ "$MERGE" = "0" ] && [ "$PR" = "1" ] && note "--pr armed: after the burn this run will push and open the PR (no merge)."
printf '# TLD loop — %s (%s)\n\n' "$STORY" "$BRANCH" >>"$PROGRESS"
printf '> Nothing here is merged. Every ticket below is committed on `%s` and nowhere else.\n' "$BRANCH" >>"$PROGRESS"
printf '> Jira shows them as "%s". They become Done only after this branch merges.\n\n' "$PREMERGE_STATUS" >>"$PROGRESS"
LANDED=0; LANDED_KEYS=()

started=0
for t in "${TICKETS[@]}"; do
  [ -n "$ONLY" ] && [ "$t" != "$ONLY" ] && continue
  if [ -n "$FROM" ] && [ "$started" = "0" ]; then
    [ "$t" = "$FROM" ] && started=1 || continue
  fi
  run_ticket "$t"
done

if [ -z "$ONLY" ] && [ "$DRY" = "0" ] && [ "$LANDED" -gt 0 ]; then
  say "All tickets processed. Drafting PR (no push, no open)…"
  claude -p "All tickets for Story ${STORY} are committed on this branch. Write a pull-request DRAFT to PR_DRAFT.md: a title and a body summarizing each committed ticket (key + one line) and any follow-ups. Do NOT push, open, or merge anything. Use the git log for facts." \
    --permission-mode "$PERM_MODE" --allowedTools Read Write "Bash(git log:*)" "Bash(git diff:*)" \
    --disallowedTools "${DENY_TOOLS[@]}" --output-format text >"$LOG_DIR/pr-draft.log" 2>&1
  note "PR draft → PR_DRAFT.md (review, then run /tld-pr yourself)."
fi

# ---- optional landing: push → PR → (merge on confirmed green) ---------------
# Deterministic bash only. The inner Claude runs never had push/gh; this phase
# runs because you passed --pr/--merge, and --merge merges without asking
# again — the flag was the permission.
END_STATE="burned"
if [ "$PR" = "1" ] && [ "$DRY" = "0" ]; then
  git fetch origin "$DEFAULT_BRANCH" >/dev/null 2>&1
  AHEAD="$(git rev-list --count "origin/${DEFAULT_BRANCH}..HEAD" 2>/dev/null || echo 0)"
  if [ "$AHEAD" -eq 0 ]; then
    note "Branch has no commits ahead of origin/${DEFAULT_BRANCH} — nothing to land."
  elif ! git push -u origin "$BRANCH"; then
    END_STATE="push_failed"
    printf -- '⛔ push failed — branch %s is local-only. Nothing opened, nothing merged.\n' "$BRANCH" >>"$PROGRESS"
  else
    PR_URL="$(gh pr list --head "$BRANCH" --state open --json url -q '.[0].url' 2>/dev/null)"
    if [ -n "$PR_URL" ]; then
      note "PR already open: $PR_URL"
      END_STATE="pr_open"
    else
      if [ -f PR_DRAFT.md ]; then
        PR_URL="$(gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" --title "[$STORY] TLD loop: ${AHEAD} commit(s)" --body-file PR_DRAFT.md 2>/dev/null | tail -1)"
      else
        PR_URL="$(gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" --fill 2>/dev/null | tail -1)"
      fi
      case "$PR_URL" in
        https://*) END_STATE="pr_open";;
        *) END_STATE="pr_failed"; PR_URL="";;
      esac
    fi
    if [ "$END_STATE" = "pr_open" ]; then
      printf -- '🔗 PR: %s\n' "$PR_URL" >>"$PROGRESS"
    else
      printf -- '⛔ pushed, but PR creation failed — open it by hand: gh pr create --base %s --head %s\n' "$DEFAULT_BRANCH" "$BRANCH" >>"$PROGRESS"
    fi
  fi

  if [ "$MERGE" = "1" ] && [ "$END_STATE" = "pr_open" ]; then
    say "Watching CI on $PR_URL (ceiling: $((CI_WATCH_SECS / 60)) min)…"
    # Verdicts: green (all checks passed) | none (no checks configured) |
    # red (a check failed) | unknown (ceiling hit / cannot tell).
    # Every ambiguity resolves AWAY from merging — false-red is safe,
    # false-green is the incident.
    ci_verdict="unknown"
    deadline=$(( $(date +%s) + CI_WATCH_SECS ))
    while :; do
      checks_out="$(gh pr checks "$PR_URL" 2>&1)"; rc=$?
      if [ "$rc" -eq 0 ]; then ci_verdict="green"; break; fi
      case "$checks_out" in *"no checks reported"*|*"No checks reported"*) ci_verdict="none"; break;; esac
      if [ "$rc" -ne 8 ] && printf '%s' "$checks_out" | grep -qiE '(^|[^a-z])fail(ing|ed)?([^a-z]|$)'; then
        ci_verdict="red"; break
      fi
      if [ "$(date +%s)" -ge "$deadline" ]; then ci_verdict="unknown"; break; fi
      sleep 30
    done

    if [ "$ci_verdict" = "green" ] || [ "$ci_verdict" = "none" ]; then
      [ "$ci_verdict" = "none" ] && note "No CI checks reported — merging on the tickets' local test runs only."
      gh pr merge "$PR_URL" --squash >/dev/null 2>&1
      pr_state="$(gh pr view "$PR_URL" --json state -q .state 2>/dev/null)"
      if [ "$pr_state" = "MERGED" ]; then
        END_STATE="merged"
        printf -- '✅ squash-merged; PR state re-read confirmed MERGED%s.\n' "$([ "$ci_verdict" = "none" ] && echo ' (no CI checks — local tests only)')" >>"$PROGRESS"
        # The re-read above is the confirmation the doctrine requires. Only now:
        for k in ${LANDED_KEYS[@]+"${LANDED_KEYS[@]}"}; do
          if jira_done "$k"; then
            printf -- '- %s  → Jira: Done (merge confirmed)\n' "$k" >>"$PROGRESS"
          else
            printf -- '- %s  ⚠️ merge confirmed but the Done transition FAILED — still %s. Transition it by hand or run /tld-gate.\n' "$k" "$(jira_status "$k")" >>"$PROGRESS"
          fi
        done
      else
        END_STATE="merge_unconfirmed"
        printf -- '⚠️ merge command ran but the PR state reads %s, not MERGED — treated as NOT merged; no ticket marked Done.\n' "${pr_state:-unknown}" >>"$PROGRESS"
      fi
    else
      END_STATE="merge_refused"
      printf -- '⛔ CI verdict: %s — NOT merged. PR left open; tickets stay "%s".\n' "$ci_verdict" "$PREMERGE_STATUS" >>"$PROGRESS"
    fi
  fi
fi

say "Loop finished. Progress report: $PROGRESS"; cat "$PROGRESS"

# ---- the handoff you cannot miss -------------------------------------------
# The failure this block exists to prevent: a run ends, the terminal scrolls
# away, and the only record that a branch still owes a pull request is a draft
# file in a gitignored directory. Nothing in Jira, nothing on the forge, nothing
# in any other worktree. Weeks later the branch is hundreds of commits behind and
# no longer mergeable. Say it loudly, here, while somebody is still looking.
if [ "$PR" = "0" ] && [ "$LANDED" -gt 0 ] && [ "$DRY" = "0" ]; then
  printf '\n\033[1;33m%s\033[0m\n' "════════════════════════════════════════════════════════════════"
  printf '\033[1;33m  ⚠  NOTHING HAS MERGED.\033[0m\n'
  printf '\033[1;33m%s\033[0m\n' "════════════════════════════════════════════════════════════════"
  cat <<EOF
  $LANDED ticket(s) are committed on '$BRANCH' and exist ONLY there.
  No push. No pull request. No merge. Jira reads "$PREMERGE_STATUS" for them,
  which is the truth: work complete, not shipped. They are NOT done.

  To actually ship them:
      git push -u origin $BRANCH
      gh pr create --fill
  …then merge the PR, and run /tld-gate to mark the tickets Done once the
  merge is confirmed.

  Draft PR body: $PWD/PR_DRAFT.md
  Progress log:  $PWD/$PROGRESS
EOF
  printf '\033[1;33m%s\033[0m\n\n' "════════════════════════════════════════════════════════════════"
fi

# ---- endings for the --pr / --merge lanes -----------------------------------
# Same principle as the banner above: the run's true state, said loudly, while
# somebody is still looking. One banner per outcome; only one fires.
hr()      { printf '\n\033[1;%sm%s\033[0m\n' "$1" "════════════════════════════════════════════════════════════════"; }
hr_line() { printf '\033[1;%sm  %s\033[0m\n' "$1" "$2"; }

case "$END_STATE" in
  pr_open)
    if [ "$MERGE" = "1" ]; then :; else
      hr 33; hr_line 33 "⚠  PR OPEN — NOT MERGED."
      hr 33
      cat <<EOF
  $PR_URL

  Jira reads "$PREMERGE_STATUS" for this run's tickets, which is the truth:
  work complete, not shipped. Merge the PR yourself, then run /tld-gate —
  it confirms the merge and marks the tickets Done.
EOF
      hr 33; echo
    fi
    ;;
  merged)
    hr 32; hr_line 32 "✅ MERGED — squash-merge confirmed by PR state re-read."
    hr 32
    cat <<EOF
  $PR_URL

  This run's tickets are marked Done in Jira (any transition failure is
  called out in the progress log above). Tickets landed by EARLIER runs on
  this branch were already "$PREMERGE_STATUS" and were skipped — run
  /tld-gate to close them out and roll the Story up.

  The branch was not deleted; clean it up when you're ready.
EOF
    hr 32; echo
    ;;
  merge_refused|merge_unconfirmed)
    hr 31; hr_line 31 "⛔ NOT MERGED — the merge could not be positively confirmed."
    hr 31
    cat <<EOF
  ${PR_URL:-<no PR URL captured>}

  Reason: see the progress log above (CI red, ceiling hit, or the PR state
  never re-read as MERGED — all treated identically to "it failed").
  Nothing was marked Done. The PR is open and the work is pushed; fix and
  merge it yourself, then run /tld-gate to close the tickets out.
EOF
    hr 31; echo
    ;;
  pr_failed)
    hr 33; hr_line 33 "⚠  PUSHED, BUT NO PR — creation failed."
    hr 33
    cat <<EOF
  The branch '$BRANCH' is on origin, so the work is durable, but no pull
  request exists. Open it by hand:

      gh pr create --base $DEFAULT_BRANCH --head $BRANCH

  …then merge it, and run /tld-gate to mark the tickets Done.
EOF
    hr 33; echo
    ;;
  push_failed)
    hr 31; hr_line 31 "⛔ PUSH FAILED — the work exists ONLY on this machine."
    hr 31
    cat <<EOF
  Branch '$BRANCH' could not be pushed. Until it is, this run's commits
  live in one local checkout and nowhere else — the exact stranding this
  script's banners exist to prevent. Fix the push (auth? remote? protected
  branch?), then:

      git push -u origin $BRANCH
      gh pr create --base $DEFAULT_BRANCH --head $BRANCH
EOF
    hr 31; echo
    ;;
esac
