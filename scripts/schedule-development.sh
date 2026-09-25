#!/usr/bin/env bash
#
# Puts the development-site schedule into cron, and nothing else.
#
#   ./scripts/schedule-development.sh             install it
#   ./scripts/schedule-development.sh --dry-run   show the result, change nothing
#
# Replaces the daily 16:00 live release with a Friday 22:00 promotion, and adds
# a fifteen-minute check that keeps the development site on the newest build.
# Every other job, backups and notifications included, is kept exactly as it
# was, and that is checked before anything is installed.
#
# Separate from setup-development.sh so it can be run, or dry-run, on its own:
# cron is what keeps live's backups running, and changing it deserves a look
# at the result first.

set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"
}

BEFORE="$(mktemp)"
AFTER="$(mktemp)"
trap 'rm -f "$BEFORE" "$AFTER"' EXIT

crontab -l > "$BEFORE" 2>/dev/null || true

# Built as a file and checked before it is installed, never piped straight into
# `crontab -`. A pipe that failed part-way would install whatever had arrived,
# possibly nothing, and live's backups would stop without a word.
#
# What goes: the daily release job together with the paragraph of comments
# directly above it, which explains that job and would otherwise sit in the
# crontab describing a schedule that no longer exists; and any block this
# script wrote before, between its markers, so running it twice gives one.
#
# Removing only lines that mention the script was the first version of this.
# A dry run against the server's real crontab showed it leaving "To deploy
# sooner, run it by hand:" with nothing after it.
awk '
  /^# >>> roft-lms-dev/      { managed = 1; next }
  /^# <<< roft-lms-dev/      { managed = 0; next }
  managed                    { next }
  /^#/                       { comments = comments $0 "\n"; next }
  /scripts\/auto-deploy\.sh/ { comments = ""; next }
                             { printf "%s", comments; comments = ""; print }
  END                        { printf "%s", comments }
' "$BEFORE" > "$AFTER"

cat >> "$AFTER" <<'CRON'
# >>> roft-lms-dev (written by scripts/schedule-development.sh; run it again to rewrite)
#
# Releases, since 24 September 2026. Every change lands on the development
# site (https://lms.roftbusiness.org) as soon as GitHub Actions has built it,
# so it can be seen the same day. Live takes the version development ran, on
# Friday at 22:00, following Linda's recommendation of 23 September. It
# replaces the daily 16:00 release of 1 September.
#
# To release to live sooner, by hand:
#   cd ~/roft-lms && ./scripts/promote-to-production.sh --now
*/15 * * * * cd $HOME/roft-lms-dev && ./scripts/deploy-development.sh >> $HOME/logs/development-deploy.log 2>&1
0 22 * * 5 cd $HOME/roft-lms && ./scripts/promote-to-production.sh >> $HOME/logs/roft-deploy.log 2>&1
# <<< roft-lms-dev
CRON

# Every job that was there and is meant to stay must still be there.
KEPT=0
MANAGED=0
while IFS= read -r line; do
  case "$line" in
    '# >>> roft-lms-dev'*) MANAGED=1; continue ;;
    '# <<< roft-lms-dev'*) MANAGED=0; continue ;;
  esac
  [ "$MANAGED" -eq 1 ] && continue
  case "$line" in
    ''|'#'*|*scripts/auto-deploy.sh*) continue ;;
  esac
  if ! grep -qxF "$line" "$AFTER"; then
    log "REFUSED: the new schedule would have lost this job, so nothing was installed:"
    log "  $line"
    exit 1
  fi
  KEPT=$((KEPT + 1))
done < "$BEFORE"

# Jobs, not lines: the paragraph above the old job mentions the script too.
REMOVED="$(grep -v '^#' "$BEFORE" | grep -c 'scripts/auto-deploy.sh' || true)"

if [ "$DRY_RUN" = true ]; then
  log "Dry run. ${KEPT} existing job(s) kept, ${REMOVED} daily release job(s) removed. The change, as a diff:"
  diff "$BEFORE" "$AFTER" | sed 's/^/    /' || true
  exit 0
fi

mkdir -p "$HOME/logs"
crontab "$AFTER"
log "Schedule installed: ${KEPT} existing job(s) kept, the daily 16:00 live release replaced by Friday 22:00, development checked every fifteen minutes."
