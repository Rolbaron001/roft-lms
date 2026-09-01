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
#
# A reloaded run already holds the lock — it is the same process, having
# exec'd itself after pulling a new copy of this script. Without this branch
# it queues behind itself, stands down, and the deploy never happens.
if [ -n "${DEPLOY_RELOADED:-}" ]; then
  log "Continuing under the lock already held."
elif ! mkdir "$LOCKDIR" 2>/dev/null; then
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

# --- pull the code, fetch the images, migrate ---------------------------------------------------

git -C "$REPO" pull --ff-only --quiet origin "$BRANCH" \
  || fail "pull was not a fast-forward. Somebody has committed on the server."

# The pull may have just replaced this script while bash is part-way through
# reading it. Until this re-exec existed, a change to the deploy process took
# effect one deploy late: the run that delivered it still ran the old script.
# That is not a theoretical problem — it shipped a release whose code expected
# a renamed column alongside a script that never ran the rename, so the schema
# push stopped on an interactive prompt while the health check still passed,
# because the site was serving the previous build.
#
# So hand over to the version just pulled. DEPLOY_RELOADED guards the obvious
# hazard: without it a script that re-execs every run never reaches the deploy.

if [ -z "${DEPLOY_RELOADED:-}" ]; then
  export DEPLOY_RELOADED=1
  log "Reloading the deploy script at $(git -C "$REPO" rev-parse --short HEAD)."
  exec "$REPO/scripts/auto-deploy.sh" --force
fi

# --- fetch the images, rather than building them -----------------------------
#
# This server does not compile the application. `next build` wants around 2 GB
# of working memory and this machine has under 1 GB: building here does not
# fail, it exhausts memory and then grinds at a load average of ten without
# finishing, which is a worse outcome than an error because nothing reports it
# and the running site is starved alongside it.
#
# GitHub Actions builds both images on every push to main and publishes them
# tagged with the commit. The deploy's job is to fetch the pair matching the
# commit it just pulled and start them.
#
# Pinning to the commit rather than to "latest" is what makes the two halves
# agree. The tools image carries the migration scripts and the app image the
# code that expects the migrated schema, so a deploy that took "latest" twice
# could pair a fresh app with a stale set of migrations if a build were still
# in flight -- which is precisely the pairing that applies the wrong schema.

export IMAGE_TAG
IMAGE_TAG="$(git -C "$REPO" rev-parse HEAD)"

# The images are published by a workflow that starts when the commit is pushed,
# so on a fast deploy this can arrive before the build has finished. Waiting is
# correct; guessing is not. Roughly fifteen minutes, which is comfortably longer
# than the build takes and short enough to fail the same working day.
log "Waiting for the images for ${IMAGE_TAG:0:7} to be published."

WAITED=0
until $COMPOSE pull --quiet app tools mail 2>/dev/null; do
  if [ "$WAITED" -ge 900 ]; then
    fail "the images for ${IMAGE_TAG:0:7} never appeared. Check the Actions tab: the build may have failed, or the registry sign-in on this server may have expired."
  fi
  sleep 30
  WAITED=$((WAITED + 30))
done

log "Images fetched after ${WAITED}s."

# --- take a copy of the database before changing it -------------------------
#
# Cheap insurance, and the moment it matters is a schema change that turns out
# to be wrong. --local-only keeps it on this machine: this is a rollback point
# for the next ten minutes, not the nightly backup, and waiting on an upload
# would make every deploy slower for no benefit.
#
# This sits after the image fetch rather than before it, because the backup
# runs *in* the tools image. Taken any earlier it would be asking for an
# image that has not been fetched yet, and compose would answer by building
# it, which is the one thing this server must never do.

if [ -n "${BACKUP_PASSPHRASE:-}" ] || grep -q '^BACKUP_PASSPHRASE=' "$REPO/.env" 2>/dev/null; then
  log "Taking a database copy first."
  $COMPOSE run --rm tools ./scripts/backup.sh --local-only >/dev/null 2>&1 \
    || log "WARNING: the pre-deploy backup failed. Continuing — the nightly backup is unaffected."
else
  log "No BACKUP_PASSPHRASE set, so no pre-deploy copy. Set one."
fi

# --- migrate, then start ----------------------------------------------------
#
# The schema goes first and the application second, which is the opposite of
# what this script used to do. Starting the app first meant a migration that
# failed for any reason left the new code running against the old schema, with
# the site up and the health check green: the worst of both, because nothing
# looked wrong. Migrating first means a failure here leaves the *previous*
# release running against the schema it was built for, which is a safe place
# to stop.
#
# The tools container needs only the database, which is already up, so nothing
# here depends on the new application image having started.

# pre-migrate first, and the order is not cosmetic: it performs column renames
# that drizzle-kit cannot infer. Left to itself, push sees a column vanish and
# another appear, drops the first and creates the second empty — losing every
# value in it, quietly, on a deploy that then reports success.
log "Applying renames, schema and policies."
$COMPOSE run --rm tools sh -c \
  'npx tsx scripts/pre-migrate.ts && npx drizzle-kit push --force && npx tsx scripts/apply-policies.ts' \
  || fail "the schema change did not apply. The previous release is still running against the schema it was built for — tell whoever made the change."

log "Starting."
# --no-build is not belt and braces: without it, a missing image sends compose
# straight into the local build this whole arrangement exists to avoid.
#
# It belongs on `up` and only on `up`. `docker compose run` rejects it as an
# unknown flag, which is not a warning: it fails the command outright. Putting
# it on the tools invocations took out both the pre-deploy backup and the
# schema migration on the first deploy that used them, and left the new code
# running against the old schema. The tools runs are safe without it because
# the pull above has already fetched the image they need, and fails the deploy
# if it could not.
$COMPOSE up -d --no-build || fail "the application did not start"

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

# --- can it still read a PDF? -----------------------------------------------
#
# A health check answers "is the site up", which is not the same question as
# "does the site work". Reading the three qualification documents is the way a
# qualification gets built, and it depends on a package that Next's file
# tracing does not copy into the production image — so it can break with every
# test passing, every build clean, and the health check green. It did.
#
# Checked here, on the image that is actually serving, because that is the
# only place the answer is worth having.

if $COMPOSE exec -T app node scripts/smoke-pdf.mjs >/dev/null 2>&1; then
  log "PDF reading works."
else
  log "*** PDF READING IS BROKEN on this deploy. Qualification documents ***"
  log "*** cannot be read. The site is otherwise up, so this will not    ***"
  log "*** show anywhere else. Run: docker compose -f                    ***"
  log "*** docker-compose.production.yml exec app node scripts/smoke-pdf.mjs ***"
fi

log "Deployed ${REMOTE:0:7}."
