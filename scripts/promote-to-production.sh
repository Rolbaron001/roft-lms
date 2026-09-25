#!/usr/bin/env bash
#
# Friday night: live takes the version the development site has been running.
#
#   ./scripts/promote-to-production.sh           promote, if development has run it long enough
#   ./scripts/promote-to-production.sh --now     promote whatever development runs, now
#   ./scripts/promote-to-production.sh --dry-run say what it would do
#
# Run from cron on Fridays at 22:00, from the live checkout (~/roft-lms).
# Decided on 24 September 2026, following Linda's recommendation at the costing
# meeting of 23 September: live changes once a week, when nobody is working,
# and only to something that has already been tried.
#
# "Already been tried" is taken literally. The version is read from the
# development site's running container rather than from the newest commit, so
# what live receives is exactly the image people have been using all week, and
# nothing is built or chosen afresh between trying it and releasing it.
#
# Two refusals, each of which leaves live exactly as it was:
#
#   - Development is not healthy. Promoting a site that is failing its own
#     health check would carry the failure across.
#   - Development changed less than MIN_SOAK_HOURS ago. A commit pushed at
#     21:50 on a Friday would otherwise be on live at 22:00, untried. The
#     release waits a week instead, and the log says so. --now overrides this,
#     for the rare release that cannot wait.

set -euo pipefail

cd "$(dirname "$0")/.."
LIVE="$PWD"
DEV_DIR="${DEV_DIR:-$HOME/roft-lms-dev}"
MIN_SOAK_HOURS="${MIN_SOAK_HOURS:-6}"

NOW=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --now) NOW=true ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"
}

stop() {
  log "NOT PROMOTED: $*"
  log "Live is unchanged."
  exit 1
}

# Refuse to run anywhere but the live checkout.
grep -qx 'SITE=development' "$LIVE/.env" 2>/dev/null \
  && stop "this is the development checkout. Run it from ~/roft-lms."

# --- what development runs --------------------------------------------------

DEV_IMAGE="$(docker inspect --format '{{.Config.Image}}' roft-lms-dev-app-1 2>/dev/null || true)"
[ -n "$DEV_IMAGE" ] || stop "the development site is not running, so nothing has been tried."
DEV_TAG="${DEV_IMAGE##*:}"
LIVE_TAG="$(docker inspect --format '{{.Config.Image}}' roft-lms-app-1 2>/dev/null | sed 's/.*://' || true)"

if [ "$DEV_TAG" = "$LIVE_TAG" ]; then
  log "Live already runs ${LIVE_TAG:0:7}, the version on development. Nothing to promote."
  exit 0
fi

# --- has it been tried? -----------------------------------------------------

DEV_DOMAIN="$(grep -E '^LMS_DOMAIN=' "$DEV_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
curl -fsS --max-time 10 "https://$DEV_DOMAIN/api/health" 2>/dev/null | grep -q '"status":"ok"' \
  || stop "the development site is not healthy at https://$DEV_DOMAIN."

STARTED="$(docker inspect --format '{{.State.StartedAt}}' roft-lms-dev-app-1)"
AGE_HOURS=$(( ( $(date +%s) - $(date -d "$STARTED" +%s) ) / 3600 ))

if [ "$AGE_HOURS" -lt "$MIN_SOAK_HOURS" ] && [ "$NOW" = false ]; then
  stop "development changed to ${DEV_TAG:0:7} only ${AGE_HOURS} hour(s) ago, under the ${MIN_SOAK_HOURS} it has to run first. It goes out next Friday, or now with --now."
fi

log "Promoting ${DEV_TAG:0:7} to live, after ${AGE_HOURS} hour(s) on development (live was ${LIVE_TAG:0:7})."

if [ "$DRY_RUN" = true ]; then
  "$LIVE/scripts/auto-deploy.sh" --dry-run --to "$DEV_TAG"
  exit 0
fi

# --- release ----------------------------------------------------------------
#
# The live deploy does the work: backup, images, migrations, start, health
# check, pinning, tidying. Exit 75 means it found the lock held, usually by a
# development deploy waiting on a build, so this waits its turn rather than
# giving up the week's release.

WAITED=0
while true; do
  set +e
  "$LIVE/scripts/auto-deploy.sh" --to "$DEV_TAG"
  STATUS=$?
  set -e
  [ "$STATUS" -ne 75 ] && break
  if [ "$WAITED" -ge 2700 ]; then
    stop "another deploy held the lock for 45 minutes."
  fi
  sleep 60
  WAITED=$((WAITED + 60))
done

# Not stop(): that says live is unchanged, and after a deploy has begun that is
# for the deploy's own log to say, not this one. It reports exactly how far it
# got.
if [ "$STATUS" -ne 0 ]; then
  log "PROMOTION FAILED: the live deploy stopped; its lines above say where and what state live is in."
  exit 1
fi
log "Promoted ${DEV_TAG:0:7} to live."
