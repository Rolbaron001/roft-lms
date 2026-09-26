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
# "Already been tried" is taken literally. The version is one the development
# site actually ran, read from its deploy log, rather than the newest commit, so
# what live receives is exactly an image people have used, and nothing is built
# or chosen afresh between trying it and releasing it.
#
# WHICH VERSION
#
# The newest one development ran for MIN_SOAK_HOURS, worked out by
# scripts/soaked-version.sh. Until 26 September (job sheet B2) this took only
# what development was running at 22:00 and refused if that had run under six
# hours, so a commit pushed at 17:00 on a Friday held back the whole week,
# including versions development had already run for days. Now the week's
# tried work goes out and the late commit waits for the next Friday.
#
# Refusals, each of which leaves live exactly as it was:
#
#   - Nothing development has run has had MIN_SOAK_HOURS yet.
#   - The version is the one development runs now, and development is not
#     healthy. Promoting a site that is failing its own health check would
#     carry the failure across. An earlier version is not held back by a
#     newer one failing: it passed its own health check and then ran for hours.
#
# --now releases whatever development runs now, however briefly, for the rare
# release that cannot wait. It still needs development to be healthy.

set -euo pipefail

cd "$(dirname "$0")/.."
LIVE="$PWD"
DEV_DIR="${DEV_DIR:-$HOME/roft-lms-dev}"
DEV_LOG="${DEV_LOG:-$HOME/logs/development-deploy.log}"
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

# --- which version has been tried? ------------------------------------------

if [ "$NOW" = true ]; then
  TAG="$DEV_TAG"
  STARTED="$(docker inspect --format '{{.State.StartedAt}}' roft-lms-dev-app-1)"
  HOURS=$(( ( $(date +%s) - $(date -d "$STARTED" +%s) ) / 3600 ))
else
  SOAKED="$("$LIVE/scripts/soaked-version.sh" "$DEV_LOG" "$MIN_SOAK_HOURS")" \
    || stop "nothing development has run has had the ${MIN_SOAK_HOURS} hours it needs first. It goes out next Friday, or now with --now."
  HOURS="${SOAKED#* }"
  # The log gives seven characters; images are tagged with the whole commit.
  TAG="$(git -C "$DEV_DIR" rev-parse --verify --quiet "${SOAKED%% *}^{commit}")" \
    || stop "the development log names ${SOAKED%% *}, which the development checkout does not know."
fi

if [ "$TAG" = "$LIVE_TAG" ]; then
  log "Live already runs ${LIVE_TAG:0:7}, the newest version tried on development. Nothing to promote."
  exit 0
fi

# Never backwards. After a --now release, live can be ahead of anything that
# has finished its hours on development.
if [ -n "$LIVE_TAG" ] && git -C "$DEV_DIR" merge-base --is-ancestor "$TAG" "$LIVE_TAG" 2>/dev/null; then
  log "Live runs ${LIVE_TAG:0:7}, which already includes ${TAG:0:7}. Nothing to promote."
  exit 0
fi

if [ "$TAG" = "$DEV_TAG" ]; then
  DEV_DOMAIN="$(grep -E '^LMS_DOMAIN=' "$DEV_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
  curl -fsS --max-time 10 "https://$DEV_DOMAIN/api/health" 2>/dev/null | grep -q '"status":"ok"' \
    || stop "the development site is not healthy at https://$DEV_DOMAIN."
  log "Promoting ${TAG:0:7} to live, after ${HOURS} hour(s) on development (live was ${LIVE_TAG:0:7})."
else
  log "Promoting ${TAG:0:7} to live, which ran ${HOURS} hour(s) on development (live was ${LIVE_TAG:0:7}). Development has since moved to ${DEV_TAG:0:7}, which has not had its ${MIN_SOAK_HOURS} hours yet and waits for next Friday."
fi

if [ "$DRY_RUN" = true ]; then
  "$LIVE/scripts/auto-deploy.sh" --dry-run --to "$TAG"
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
  "$LIVE/scripts/auto-deploy.sh" --to "$TAG"
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
log "Promoted ${TAG:0:7} to live."
