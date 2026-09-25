#!/usr/bin/env bash
#
# Removes application images nothing needs, keeping everything something does.
#
#   ./scripts/prune-images.sh                 remove what is not needed
#   ./scripts/prune-images.sh --dry-run       say what it would remove
#
# Called by both deploy scripts after a successful deploy. Shared, because two
# copies of "which images may go" would drift, and the cost of drift here is a
# live site whose migrations image has been deleted.
#
# WHAT IS KEPT
#
#   - every image a container uses, running or stopped, in either project;
#   - the version pinned in live's .env and in development's .env, which is how
#     the tools image is kept: no container runs it between deploys, but the
#     nightly backup and the hourly notifications do.
#
# Nothing else. Every image is in ghcr.io and re-pulls if a rollback needs it;
# a local copy only saves a download, and this disk cannot afford the saving.
#
# NOT `latest`
#
# The first version kept anything tagged `latest`, as a safety net for jobs
# still run without a pinned version. Once live pinned its version in .env
# (auto-deploy.sh does it after every release) the net had nothing to catch,
# and it did harm instead: on 25 September `latest` still pointed at a version
# nothing ran, and the rule kept it indefinitely while the disk it sat on was
# too full for the development site to take its next update. A `latest` tag
# is now removed like any other that nothing needs.
#
# WHY NOT "THE NEWEST TWO", AS BEFORE
#
# That rule was written for one site. With development running ahead of live,
# the newest two versions can both be development's, and "keep the newest two"
# would then delete the tools image live's backups run in. It also never ran at
# all: its filter looked for "roft-lms" in a line holding only a date and a
# commit hash, matched nothing, and under `set -euo pipefail` stopped the deploy
# script before it removed anything. Found on 24 September at 84% full.
#
# An empty keep-list removes nothing, never everything. If the list cannot be
# worked out, something is wrong with the reading of it, and that is not a
# reason to delete the running site's images.

set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

LIVE_ENV="${LIVE_ENV:-$HOME/roft-lms/.env}"
DEV_ENV="${DEV_ENV:-$HOME/roft-lms-dev/.env}"

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"
}

pinned() {
  # The IMAGE_TAG a .env pins, or nothing. Values are never printed; this one
  # is a commit hash, not a secret, but the file around it holds secrets.
  [ -f "$1" ] || return 0
  grep -E '^IMAGE_TAG=' "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' " || true
}

# Tags in use by any container of either project.
IN_USE=$(docker ps -a --format '{{.Image}}' 2>/dev/null \
  | grep -E 'roft-lms-(app|tools):' \
  | sed 's/.*://' || true)

KEEP=$(printf '%s\n%s\n%s\n' "$IN_USE" "$(pinned "$LIVE_ENV")" "$(pinned "$DEV_ENV")" \
  | grep -v '^$' | sort -u || true)

# An empty list means nothing running was found, which is a reason to stop,
# not a licence to remove everything.
if [ -z "$KEEP" ]; then
  log "Could not tell which images are in use, so none were removed."
  exit 0
fi

log "Keeping: $(printf '%s\n' "$KEEP" | cut -c1-7 | tr '\n' ' ')"

REMOVED=0
while IFS='|' read -r REF TAG; do
  [ -z "$REF" ] && continue
  if printf '%s\n' "$KEEP" | grep -qx "$TAG"; then
    continue
  fi
  if [ "$DRY_RUN" = true ]; then
    log "  would remove $REF"
  else
    # Docker refuses an image a container uses, which is the safety net rather
    # than the plan: anything in use is already in KEEP.
    docker rmi "$REF" >/dev/null 2>&1 && REMOVED=$((REMOVED + 1)) || true
  fi
done < <(docker images --format '{{.Repository}}:{{.Tag}}|{{.Tag}}' 2>/dev/null \
  | grep -E 'roft-lms-(app|tools):' || true)

if [ "$DRY_RUN" = false ]; then
  # Layers left with no tag at all by the removals above.
  docker image prune -f >/dev/null 2>&1 || true
  log "Removed ${REMOVED} image(s). $(df -Pm / | awk 'NR==2 {print $4}')MB free."
fi
