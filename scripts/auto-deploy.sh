#!/usr/bin/env bash
#
# Deploy whatever is on the main branch, if it has moved.
#
# Run from cron every couple of minutes. Does nothing at all when the remote
# has not changed, so it is cheap to run often and safe to run repeatedly.
#
#   ./auto-deploy.sh             deploy if origin/main has moved
#   ./auto-deploy.sh --force     deploy even if it has not
#   ./auto-deploy.sh --dry-run   say what it would do, change nothing
#   ./auto-deploy.sh --to <sha>  deploy that commit rather than the newest
#
# Since 24 September 2026 this is not run on a schedule of its own on Curiosa's
# server. Changes land on the development site first (scripts/deploy-
# development.sh), and live takes the version that ran there on Friday night,
# through scripts/promote-to-production.sh, which calls this with --to.
#
# Exits 75 when another deploy holds the lock, so that a caller wanting this
# deploy to happen can tell "stood down" from "done" and try again.
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
# Shared with scripts/deploy-development.sh, so the two sites never pull,
# migrate or tidy images at the same time: one tidying while the other has just
# pulled could remove the image that is about to start.
LOCKDIR="/tmp/roft-lms-deploy.lock.d"
# Anything older than this is assumed to be a crashed run rather than a live
# one. It was twenty minutes, while a deploy may wait thirty for its images:
# a slow but healthy run could have its lock taken from under it. Forty-five is
# longer than the longest wait and shorter than a working day.
STALE_MINUTES=45

FORCE=false
DRY_RUN=false
TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    --to)
      shift
      TO="${1:-}"
      [ -n "$TO" ] || { echo "--to needs a commit" >&2; exit 2; }
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
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
    exit 75
  fi
fi
trap 'rm -rf "$LOCKDIR"' EXIT

# --- has anything changed? --------------------------------------------------

git -C "$REPO" fetch --quiet origin "$BRANCH" || fail "could not reach GitHub"

LOCAL="$(git -C "$REPO" rev-parse HEAD)"

if [ -n "$TO" ]; then
  # A particular commit: the one the development site has been running.
  #
  # Only one already on the branch. Anything else is either a typing mistake
  # or a commit that never went through the build, and this is live.
  REMOTE="$(git -C "$REPO" rev-parse --verify --quiet "${TO}^{commit}")" \
    || fail "there is no commit ${TO} here. Nothing has been changed."
  git -C "$REPO" merge-base --is-ancestor "$REMOTE" "origin/$BRANCH" \
    || fail "${TO:0:7} is not on ${BRANCH}. Nothing has been changed."
else
  REMOTE="$(git -C "$REPO" rev-parse "origin/$BRANCH")"
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" = false ]; then
  # Silent on the ordinary path: this runs every couple of minutes and a log
  # full of "nothing to do" is a log nobody reads.
  [ "$DRY_RUN" = true ] && log "Up to date at ${LOCAL:0:7}. Nothing to deploy."
  exit 0
fi

SUBJECT="$(git -C "$REPO" log -1 --format=%s "$REMOTE")"
log "Deploying ${LOCAL:0:7} -> ${REMOTE:0:7}: $SUBJECT"

if [ "$DRY_RUN" = true ]; then
  log "--dry-run: stopping here."
  git -C "$REPO" --no-pager log --oneline "HEAD..$REMOTE" | sed 's/^/    /'
  exit 0
fi

# --- pull the code, fetch the images, migrate ---------------------------------------------------

# Forward only, in both cases: the same refusal protects anything committed on
# the server by hand, whichever commit is being deployed.
if [ -n "$TO" ]; then
  git -C "$REPO" merge --ff-only --quiet "$REMOTE" \
    || fail "moving to ${REMOTE:0:7} was not a fast-forward. Either somebody has committed on the server, or ${REMOTE:0:7} is older than what live runs."
else
  git -C "$REPO" pull --ff-only --quiet origin "$BRANCH" \
    || fail "pull was not a fast-forward. Somebody has committed on the server."
fi

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
  # --to is carried across, or the reloaded script would deploy the newest
  # commit instead of the one it was asked for.
  if [ -n "$TO" ]; then
    exec "$REPO/scripts/auto-deploy.sh" --force --to "$REMOTE"
  fi
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

# Room to pull into, before waiting half an hour to find out there is none.
#
# On 15 September 2026 this server sat at 100% full and every pull failed with
# "no space left on device". The wait loop below hid that behind a message
# about images that had never appeared - they had, all of them, and the sign-in
# was fine. Six days of deploys were lost to a disk check that took one line.
FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "${FREE_MB:-0}" -lt 3000 ]; then
  # Not `docker image prune -af`, which this message used to recommend. That
  # removes every image without a running container, and between deploys the
  # tools image has none, so it would take the image live's nightly backup runs
  # in. prune-images.sh keeps what is running or pinned.
  fail "only ${FREE_MB}MB free on this server and a pull needs a few gigabytes. Reclaim space first with './scripts/prune-images.sh --dry-run' to see what would go, then './scripts/prune-images.sh'. Nothing has been changed. Both run on the server, over SSH."
fi
log "${FREE_MB}MB free before pulling."

WAITED=0
# stderr is kept rather than sent to /dev/null. Silencing it is exactly how a
# full disk spent six days masquerading as a missing image.
PULL_LOG=$(mktemp)
until $COMPOSE pull --quiet app tools mail >"$PULL_LOG" 2>&1; do
  # A pull can fail because the image is not published yet, which is worth
  # waiting for, or because something is actually wrong, which is not. Anything
  # that is plainly not "not found" stops the deploy now with the real reason.
  if grep -qiE "no space left|permission denied|unauthorized|denied:|invalid" "$PULL_LOG"; then
    fail "the pull failed for a reason that waiting will not fix: $(tail -2 "$PULL_LOG" | tr '
' ' ')"
  fi

  if [ "$WAITED" -ge 1800 ]; then
    fail "the images for ${IMAGE_TAG:0:7} did not appear within 30 minutes. Last words from the pull: $(tail -2 "$PULL_LOG" | tr '
' ' '). Either the build failed, the build is unusually slow, or the registry sign-in on this server has expired. Check the Actions tab first: if the build succeeded, re-run this script by hand and it will pull them."
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
  # --database-only, and the reason is disk.
  #
  # The evidence half of a backup is a full copy of every uploaded file. Once
  # the first qualification's material was in, that was ~1 GB a time, and this
  # runs before EVERY deploy: on 19 September eleven of them put 4 GB onto a
  # 19 GB disk that was already 93% full.
  #
  # What actually changes between two deploys ten minutes apart is the
  # database, and that dump is under 1.5 MB. The evidence is still archived in
  # full every night, by the same script without this flag.
  $COMPOSE run --rm tools ./scripts/backup.sh --local-only --database-only >/dev/null 2>&1 \
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
# Renames, then the push, then the index reshapes, then the policies. The
# order is load-bearing and was wrong until 15 September 2026: reshapes ran
# before the push, an index referenced a column the push had not created yet,
# and the `&&` meant the push never ran. Six days of deploys failed the same
# way, because the only thing that could unblock it was the step it blocked.
log "Applying renames, schema, indexes and policies."
$COMPOSE run --rm tools sh -c \
  'npx tsx scripts/pre-migrate.ts --phase renames \
     && npx drizzle-kit push --force \
     && npx tsx scripts/pre-migrate.ts --phase reshapes \
     && npx tsx scripts/apply-policies.ts' \
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
# --remove-orphans stops containers for services no longer in this file.
#
# Worth knowing what it does NOT cover: a service that is still defined but
# gated behind a profile is not an orphan, because compose can still see it.
# Moving the inbound mail receiver behind a profile left its container running
# from the previous deploy with port 25 still bound, and this flag did not
# touch it - it had to be removed by hand with
# `compose --profile inbound-mail rm -sf mail`.
#
# So: taking a service out of the file is handled here; putting one behind a
# profile needs that one-off removal as well. Everything in this stack is
# managed by compose, so there is nothing here for it to remove that we did
# not mean to remove.
$COMPOSE up -d --no-build --remove-orphans || fail "the application did not start"

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

# --- pin the scheduled jobs to what was just deployed ------------------------
#
# The nightly backup, the monthly restore test and the hourly notifications
# all run in the tools image, and none of them is told which version to use.
# Compose fills the gap from .env, and without an IMAGE_TAG there it falls
# back to `latest`.
#
# That was harmless while live was the only site. It stopped being harmless on
# 24 September: CI publishes `latest` on every build, and with a development
# site running ahead of live, `latest` in the registry is development's newest,
# untried code. A backup pulling it would run tomorrow's backup script against
# today's live data. So the version is written down, and every compose command
# in this directory, scheduled or by hand, uses what live actually runs.

if grep -q '^IMAGE_TAG=' "$REPO/.env" 2>/dev/null; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" "$REPO/.env"
else
  printf '\nIMAGE_TAG=%s\n' "$IMAGE_TAG" >> "$REPO/.env"
fi
log "Scheduled jobs now use ${IMAGE_TAG:0:7}."

# --- tidy up after a successful deploy --------------------------------------
#
# Shared with the development deploy, so the two cannot disagree about which
# images may go. What it keeps and why is written there.

"$REPO/scripts/prune-images.sh" || log "WARNING: tidying images failed. The deploy itself succeeded."
docker builder prune -af >/dev/null 2>&1 || true

log "Deployed ${REMOTE:0:7}."
