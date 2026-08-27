#!/usr/bin/env bash
#
# Deploy whatever is on the main branch, if it has moved.
#
# Run from cron every couple of minutes. Does nothing at all when the remote
# has not changed, so it is cheap to run often and safe to run repeatedly.
#
#   ./auto-deploy.sh            deploy if origin/main has moved
#   ./auto-deploy.sh --force    deploy even if it has not
#   ./auto-deploy.sh --dry-run  say what it would do, change nothing
#
# Why polling rather than a webhook or a GitHub Action:
#
#   A GitHub Action that deploys has to hold this server's SSH key, which means
#   GitHub — and anyone who compromises the repository — can reach a production
#   machine holding learner records. A webhook needs an inbound endpoint that
#   has to be defended. Polling needs neither: nothing new is exposed, no
#   private key leaves this machine, and the deploy key stays read-only. The
#   cost is a delay of up to one poll interval, which for this application is
#   not a cost at all.
#
# Every step fails loudly, and the log says what happened and when. A deploy
# script that quietly does nothing is worse than none, because you stop
# checking.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
COMPOSE="docker compose -f docker-compose.production.yml"
BRANCH="${DEPLOY_BRANCH:-main}"
LOCKDIR="/tmp/roft-lms-deploy.lock.d"
# Anything older than this is assumed to be a crashed run rather than a live
# one. Twenty minutes is longer than a slow build and shorter than a working
# day, so a genuine crash does not block tonight's deploys.
STALE_MINUTES=20

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
  log "The site is still running whatever was deployed before this attempt."
  exit 1
}

# Two deploys at once would fight over the same working tree and the same
# containers. The second simply steps aside; the next poll picks it up.
#
# `mkdir` rather than flock: it is atomic on every filesystem worth using and
# needs no utility that might not be installed. The cost is that a crashed run
# leaves the directory behind, so a stale one is taken over rather than
# blocking every deploy from then on.
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +$STALE_MINUTES 2>/dev/null)" ]; then
    log "Found a lock older than $STALE_MINUTES minutes. Assuming a crashed run and taking over."
    rm -rf "$LOCKDIR"
    mkdir "$LOCKDIR" || fail "could not take the lock"
  else
    log "Another deploy is running. Standing down."
    exit 0
  fi
fi
trap 'rm -rf "$LOCKDIR"' EXIT

# --- has anything changed? --------------------------------------------------

git -C "$REPO" fetch --quiet origin "$BRANCH" || fail "could not reach GitHub"

LOCAL="$(git -C "$REPO" rev-parse HEAD)"
REMOTE="$(git -C "$REPO" rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" = false ]; then
  # Silent on the ordinary path: this runs every couple of minutes and a log
  # full of "nothing to do" is a log nobody reads.
  [ "$DRY_RUN" = true ] && log "Up to date at ${LOCAL:0:7}. Nothing to deploy."
  exit 0
fi

SUBJECT="$(git -C "$REPO" log -1 --format=%s "origin/$BRANCH")"
log "Deploying ${LOCAL:0:7} -> ${REMOTE:0:7}: $SUBJECT"

if [ "$DRY_RUN" = true ]; then
  log "--dry-run: stopping here."
  git -C "$REPO" --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'
  exit 0
fi

# --- take a copy of the database before touching anything -------------------
#
# Cheap insurance, and the moment it matters is a schema change that turns out
# to be wrong. --local-only keeps it on this machine: this is a rollback point
# for the next ten minutes, not the nightly backup, and waiting on an upload
# would make every deploy slower for no benefit.

if [ -n "${BACKUP_PASSPHRASE:-}" ] || grep -q '^BACKUP_PASSPHRASE=' "$REPO/.env" 2>/dev/null; then
  log "Taking a database copy first."
  $COMPOSE run --rm tools ./scripts/backup.sh --local-only >/dev/null 2>&1 \
    || log "WARNING: the pre-deploy backup failed. Continuing — the nightly backup is unaffected."
else
  log "No BACKUP_PASSPHRASE set, so no pre-deploy copy. Set one."
fi

# --- pull, build, migrate ---------------------------------------------------

git -C "$REPO" pull --ff-only --quiet origin "$BRANCH" \
  || fail "pull was not a fast-forward. Somebody has committed on the server."

# Both images. The tools image copies the source in at build time, so without
# rebuilding it the migration below runs the code as it was at the last build —
# which looks exactly like the change having no effect.
log "Building."
$COMPOSE up -d --build app tools || fail "the build did not finish"

# pre-migrate first, and the order is not cosmetic: it performs column renames
# that drizzle-kit cannot infer. Left to itself, push sees a column vanish and
# another appear, drops the first and creates the second empty — losing every
# value in it, quietly, on a deploy that then reports success.
log "Applying renames, schema and policies."
$COMPOSE run --rm tools sh -c \
  'npx tsx scripts/pre-migrate.ts && npx drizzle-kit push --force && npx tsx scripts/apply-policies.ts' \
  || fail "the schema change did not apply. The new code is running against the old schema — tell whoever made the change."

# --- did it come back? ------------------------------------------------------

DOMAIN="$(grep -E '^LMS_DOMAIN=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"

if [ -z "$DOMAIN" ]; then
  log "No LMS_DOMAIN in .env, so no health check was made."
else
  log "Checking https://$DOMAIN/api/health"
  HEALTHY=false
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    sleep 5
    if curl -fsS --max-time 10 "https://$DOMAIN/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      HEALTHY=true
      break
    fi
  done

  if [ "$HEALTHY" = true ]; then
    log "Healthy."
  else
    # Not treated as a hard failure: the deploy did happen, and saying so is
    # more useful than an exit code nobody reads. What matters is that this
    # line is unmistakable in the log.
    log "*** NOT HEALTHY after 50 seconds. The site may be down. ***"
    log "*** Look at: docker compose -f docker-compose.production.yml logs --tail=50 app ***"
    exit 1
  fi
fi

log "Deployed ${REMOTE:0:7}."
