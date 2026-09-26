#!/usr/bin/env bash
#
# The newest version the development site has run for long enough to release.
#
#   ./scripts/soaked-version.sh <development-deploy.log> <hours>
#
# Prints "<short commit> <hours it ran>" and exits 0, or prints nothing and
# exits 1 when no version has run that long. NOW_EPOCH replaces the clock, for
# the tests.
#
# Called by scripts/promote-to-production.sh. Job sheet B2, 26 September 2026:
# the first Friday rule looked only at what development was running at 22:00,
# so a push late on a Friday held back the whole week, including versions
# development had already run for days.
#
# HOW A RUN IS READ FROM THE LOG
#
# A version starts running at its "Development healthy at ... on <commit>."
# line. It stops at the next "Development <old> -> <new>:" line, which is where
# the next deploy begins, or it is still running now.
#
# Every deploy writes that line twice: once before it pulls, and again as
# "<new> -> <new>" once it has reloaded itself from what it pulled (seen in the
# server's log of 26 September). The second says nothing has changed, so a line
# whose two commits are the same ends nothing.
#
# A run is ended at the start of the next deploy, not when the old container
# stops a few minutes later, and a deploy that fails before starting its new
# version still ends the old one's run here. Both under-count, never over-count:
# the error is always towards waiting longer.

set -euo pipefail

LOG="${1:?the development deploy log}"
MIN_HOURS="${2:?the hours a version must run}"
NOW="${NOW_EPOCH:-$(date +%s)}"

[ -f "$LOG" ] || exit 1

CURRENT=""
STARTED=0
BEST=""
BEST_HOURS=0

# A run from $2 to $3 of version $1. Runs arrive oldest first, so the last one
# long enough is the newest.
ran() {
  local hours=$(( ($3 - $2) / 3600 ))
  if [ "$hours" -ge "$MIN_HOURS" ]; then
    BEST="$1"
    BEST_HOURS="$hours"
  fi
}

while IFS= read -r line; do
  stamp="${line#\[}"
  stamp="${stamp%%\]*}"
  at="$(date -u -d "$stamp" +%s 2>/dev/null)" || continue
  # A clock set back, or NOW_EPOCH in a test: nothing after now has happened.
  [ "$at" -gt "$NOW" ] && break

  case "$line" in
    *"] Development healthy at "*" on "*)
      tag="${line##* on }"
      tag="${tag%.}"
      if [ "$tag" != "$CURRENT" ]; then
        [ -n "$CURRENT" ] && ran "$CURRENT" "$STARTED" "$at"
        CURRENT="$tag"
        STARTED="$at"
      fi
      ;;
    *"] Development "*" -> "*": "*)
      change="${line#*\] Development }"
      old="${change%% -> *}"
      new="${change#* -> }"
      new="${new%%:*}"
      if [ "$old" != "$new" ] && [ -n "$CURRENT" ]; then
        ran "$CURRENT" "$STARTED" "$at"
        CURRENT=""
      fi
      ;;
  esac
done < <(grep -E '^\[[^]]+\] Development (healthy at |[0-9a-f]+ -> [0-9a-f]+: )' "$LOG" || true)

[ -n "$CURRENT" ] && ran "$CURRENT" "$STARTED" "$NOW"

[ -n "$BEST" ] || exit 1
echo "$BEST $BEST_HOURS"
