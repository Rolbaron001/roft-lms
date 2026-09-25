#!/usr/bin/env bash
#
# Keeps the development site on the newest commit.
#
#   ./scripts/deploy-development.sh             deploy if main has moved
#   ./scripts/deploy-development.sh --force     deploy even if it has not
#   ./scripts/deploy-development.sh --dry-run   say what it would do
#
# Run from cron every fifteen minutes, in the development checkout
# (~/roft-lms-dev), which scripts/setup-development.sh creates. Silent when
# nothing has changed.
#
# Every change reaches this site as soon as GitHub Actions has built it, so
# Heidi can see it the same day. Live takes the version that ran here on Friday
# night, through scripts/promote-to-production.sh. Nothing here ever touches
# live's containers, database or files: everything is addressed through this
# directory's compose project, roft-lms-dev.
#
# It follows scripts/auto-deploy.sh step for step, and differs where a
# development site should: no backup before migrating, because this database
# is a copy of live that can be taken again; and room for the new images is
# made by removing this site's own previous version first, because the disk
# is shared with live and cannot hold three versions.

set -euo pipefail

cd "$(dirname "$0")/.."
DEV="$PWD"
COMPOSE="docker compose -f docker-compose.development.yml"
BRANCH="${DEPLOY_BRANCH:-main}"
# The same lock as live's deploy. See the note there.
LOCKDIR="/tmp/roft-lms-deploy.lock.d"
STALE_MINUTES=45
# What a pull needs, plus the floor live's deploy keeps.
PULL_MB=2500
FLOOR_MB=3000

FORCE=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"
}

fail() {
  log "FAILED: $*"
  log "Live is untouched. The development site is running whatever it ran before, unless this says otherwise."
  exit 1
}

# This script must never run against live. The development checkout's .env
# says which site it is, and live's never does.
grep -qx 'SITE=development' .env 2>/dev/null \
  || fail "this is not the development checkout (.env has no SITE=development). Run it from ~/roft-lms-dev."

env_value() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d "\"'"
}

if [ -n "${DEPLOY_RELOADED:-}" ]; then
  log "Continuing under the lock already held."
elif ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +$STALE_MINUTES 2>/dev/null)" ]; then
    log "Found a lock older than $STALE_MINUTES minutes. Taking over."
    rm -rf "$LOCKDIR"
    mkdir "$LOCKDIR" || fail "could not take the lock"
  else
    # Ordinary: live may be deploying, or the last run is still waiting on a
    # build. The next run in fifteen minutes picks it up.
    exit 0
  fi
fi
trap 'rm -rf "$LOCKDIR"' EXIT

# --- has anything changed? --------------------------------------------------

git fetch --quiet origin "$BRANCH" || fail "could not reach GitHub"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" = false ]; then
  [ "$DRY_RUN" = true ] && log "Up to date at ${LOCAL:0:7}."
  exit 0
fi

log "Development ${LOCAL:0:7} -> ${REMOTE:0:7}: $(git log -1 --format=%s "$REMOTE")"

if [ "$DRY_RUN" = true ]; then
  git --no-pager log --oneline "HEAD..$REMOTE" | sed 's/^/    /'
  exit 0
fi

git pull --ff-only --quiet origin "$BRANCH" \
  || fail "pull was not a fast-forward. Somebody has committed in the development checkout."

# Hand over to the version just pulled, as live's deploy does, for the same
# reason: a change to this script should apply to the run that delivers it.
if [ -z "${DEPLOY_RELOADED:-}" ]; then
  export DEPLOY_RELOADED=1
  exec "$DEV/scripts/deploy-development.sh" --force
fi

export IMAGE_TAG
IMAGE_TAG="$(git rev-parse HEAD)"
PREVIOUS="$(env_value IMAGE_TAG)"
LIVE_TAG="$(docker inspect --format '{{.Config.Image}}' roft-lms-app-1 2>/dev/null | sed 's/.*://' || true)"

have_images() {
  docker image inspect "ghcr.io/rolbaron001/roft-lms-app:$1" "ghcr.io/rolbaron001/roft-lms-tools:$1" >/dev/null 2>&1
}

# --- make room, if the pull needs it ------------------------------------------
#
# The disk holds live's version and this site's version and not a third. So
# when there is not room to pull, this site's previous version is removed
# first, which takes the development site down until the new one starts. That
# is the right way round: the alternative is a pull that fills the disk live
# runs on. Never done when live runs the same version, since then there is
# nothing of this site's own to remove.

if ! have_images "$IMAGE_TAG"; then
  FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
  if [ "$FREE_MB" -lt $((FLOOR_MB + PULL_MB)) ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$LIVE_TAG" ]; then
    log "${FREE_MB}MB free. Removing this site's previous version (${PREVIOUS:0:7}) to make room; the development site is down until the new one starts."
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env
    $COMPOSE rm -sf app >/dev/null 2>&1 || true
    "$DEV/scripts/prune-images.sh" >/dev/null || true
  fi

  FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
  if [ "$FREE_MB" -lt $((FLOOR_MB + PULL_MB)) ]; then
    fail "only ${FREE_MB}MB free, and a pull needs about ${PULL_MB}MB above the ${FLOOR_MB}MB kept for live. Nothing was pulled."
  fi

  log "Waiting for the images for ${IMAGE_TAG:0:7} to be published."
  WAITED=0
  PULL_LOG=$(mktemp)
  until $COMPOSE pull --quiet app tools >"$PULL_LOG" 2>&1; do
    if grep -qiE "no space left|permission denied|unauthorized|denied:|invalid" "$PULL_LOG"; then
      fail "the pull failed for a reason waiting will not fix: $(tail -2 "$PULL_LOG" | tr '\n' ' ')"
    fi
    if [ "$WAITED" -ge 1800 ]; then
      fail "the images for ${IMAGE_TAG:0:7} did not appear within 30 minutes. Check the Actions tab."
    fi
    sleep 30
    WAITED=$((WAITED + 30))
  done
  log "Images fetched after ${WAITED}s."
else
  log "Images for ${IMAGE_TAG:0:7} are already here."
fi

# --- migrate, then start ----------------------------------------------------
#
# The same four steps as live, in the same order, for the same reasons. Here
# they run against this site's own database, which is the point of having one:
# a migration that goes wrong goes wrong here first.

log "Applying renames, schema, indexes and policies to the development database."
$COMPOSE run --rm tools sh -c \
  'npx tsx scripts/pre-migrate.ts --phase renames \
     && npx drizzle-kit push --force \
     && npx tsx scripts/pre-migrate.ts --phase reshapes \
     && npx tsx scripts/apply-policies.ts' \
  || fail "the schema change did not apply to the development database. That is what this site is for: fix it before Friday."

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env
$COMPOSE up -d --no-build app || fail "the development application did not start"

# --- did it come back? ------------------------------------------------------

DOMAIN="$(env_value LMS_DOMAIN)"
HEALTHY=false
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    HEALTHY=true
    break
  fi
done

if [ "$HEALTHY" = true ]; then
  log "Development healthy at https://$DOMAIN on ${IMAGE_TAG:0:7}."
else
  log "*** Development NOT HEALTHY after a minute. Live is unaffected. ***"
  log "*** Look at: docker compose -f docker-compose.development.yml logs --tail=50 app ***"
  exit 1
fi

"$DEV/scripts/prune-images.sh" || log "WARNING: tidying images failed."
log "Development deployed ${IMAGE_TAG:0:7}."
