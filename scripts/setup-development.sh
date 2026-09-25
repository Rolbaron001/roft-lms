#!/usr/bin/env bash
#
# Sets up the development site beside live, on the same server.
#
#   ./scripts/setup-development.sh <address>              set it up
#   ./scripts/setup-development.sh <address> --refresh    copy live's data again
#   ./scripts/setup-development.sh <address> --no-schedule  leave cron alone
#
# Run from the live checkout (~/roft-lms), after live has been deployed with
# this script in it, because live's proxy needs the caddy-sites folder mounted.
# Safe to run again: every step looks at what is already there and says so.
#
# Decided on 23 and 24 September 2026. Roland chose the address
# (lms.roftbusiness.org, already pointing here), a straight copy of live's data,
# and Friday-night releases. See docker-compose.development.yml for what the site
# is and why each part of it is separate from live.
#
# WHAT IT CHANGES ON LIVE, AND ONLY THIS
#
#   - Writes caddy-sites/development.caddy and reloads the proxy. Validated
#     first; a reload with a broken configuration is refused by Caddy and the
#     running one kept, which was tested on this server's Caddy version before
#     this script was written. Live's own site block is not touched.
#   - Replaces the daily 16:00 release in cron with a Friday 22:00 promotion,
#     and adds the fifteen-minute development deploy. Every other cron line is
#     left exactly as it was.
#
# Live's database is only ever read, by pg_dump. Live's files are only ever
# read, through a read-only mount.
#
# WHAT IT NEVER DOES
#
# Print a secret. The development database passwords and session secret are
# generated here, written to the development .env with permissions 600, and
# not echoed, logged or passed on a command line.

set -euo pipefail

cd "$(dirname "$0")/.."
LIVE="$PWD"
DEV="${DEV_DIR:-$HOME/roft-lms-dev}"

DOMAIN=""
REFRESH=false
SCHEDULE=true
for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=true ;;
    --no-schedule) SCHEDULE=false ;;
    --*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) DOMAIN="$arg" ;;
  esac
done
[ -n "$DOMAIN" ] || { echo "Give the development address, e.g. lms.roftbusiness.org" >&2; exit 2; }

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"
}

fail() {
  log "FAILED: $*"
  exit 1
}

live() { (cd "$LIVE" && docker compose -f docker-compose.production.yml "$@"); }
dev() { (cd "$DEV" && docker compose -f docker-compose.development.yml "$@"); }

value_in() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'"
}

healthy() {
  curl -fsS --max-time 10 "https://$1/api/health" 2>/dev/null | grep -q '"status":"ok"'
}

# 64 hexadecimal characters. Hex rather than base64 because these go into
# database URLs, where a "/" or "+" would need escaping and silently breaks the
# connection when it is not.
secret() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# --- 0. before anything -----------------------------------------------------

log "Setting up the development site at $DOMAIN, beside live."

grep -qx 'SITE=development' "$LIVE/.env" 2>/dev/null \
  && fail "run this from the live checkout (~/roft-lms), not the development one."

LIVE_DOMAIN="$(value_in "$LIVE/.env" LMS_DOMAIN)"
[ -n "$LIVE_DOMAIN" ] || fail "live's .env has no LMS_DOMAIN."
[ "$DOMAIN" != "$LIVE_DOMAIN" ] || fail "$DOMAIN is live's own address."

healthy "$LIVE_DOMAIN" || fail "live is not healthy at https://$LIVE_DOMAIN. Nothing has been changed."
log "Live is healthy at https://$LIVE_DOMAIN."

# The address has to reach this server, or the proxy cannot obtain a
# certificate for it. Compared with live's own address rather than with an
# outside service, so the check needs nothing beyond this machine.
DEV_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')"
LIVE_IP="$(getent ahostsv4 "$LIVE_DOMAIN" | awk 'NR==1 {print $1}')"
[ -n "$DEV_IP" ] && [ "$DEV_IP" = "$LIVE_IP" ] \
  || fail "$DOMAIN resolves to '${DEV_IP:-nothing}', not to this server (${LIVE_IP}). Point its DNS here first."
log "$DOMAIN points at this server ($DEV_IP)."

docker inspect --format '{{range .Mounts}}{{.Destination}} {{end}}' roft-lms-caddy-1 2>/dev/null \
  | grep -q '/etc/caddy/sites' \
  || fail "live's proxy has no caddy-sites folder mounted. Deploy live with this version first: ./scripts/auto-deploy.sh --force"

LIVE_TAG="$(docker inspect --format '{{.Config.Image}}' roft-lms-app-1 | sed 's/.*://')"
LIVE_SHA="$(git -C "$LIVE" rev-parse HEAD)"
[ "$LIVE_TAG" = "$LIVE_SHA" ] \
  || fail "live runs ${LIVE_TAG:0:7} but its checkout is at ${LIVE_SHA:0:7}. Deploy live first so the two agree."

FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$FREE_MB" -ge 4000 ] || fail "only ${FREE_MB}MB free. The copy needs about 1.5 GB and live keeps 3 GB spare."
log "${FREE_MB}MB free."

# --- 1. the development checkout --------------------------------------------
#
# A second clone rather than a second branch of the first: live's checkout
# moves only on Friday, and this one moves on every push, so the compose file,
# the proxy file and the scripts live runs cannot change in the middle of a
# week because development pulled.

if [ -d "$DEV/.git" ]; then
  log "Development checkout already at $DEV ($(git -C "$DEV" rev-parse --short HEAD))."
else
  ORIGIN="$(git -C "$LIVE" remote get-url origin)"
  SSH_COMMAND="$(git -C "$LIVE" config core.sshCommand || true)"
  log "Cloning into $DEV."
  if [ -n "$SSH_COMMAND" ]; then
    git -c core.sshCommand="$SSH_COMMAND" clone --quiet "$ORIGIN" "$DEV"
    git -C "$DEV" config core.sshCommand "$SSH_COMMAND"
  else
    git clone --quiet "$ORIGIN" "$DEV"
  fi
  # Start where live is, so the first development site is live's own version
  # and its images are already on this machine: nothing to pull on day one.
  git -C "$DEV" reset --quiet --hard "$LIVE_SHA"
  log "Development checkout at ${LIVE_SHA:0:7}, the version live runs."
fi

# --- 2. its settings --------------------------------------------------------

if [ -f "$DEV/.env" ]; then
  grep -qx 'SITE=development' "$DEV/.env" || fail "$DEV/.env exists but is not marked SITE=development. Look at it before going further."
  [ "$(value_in "$DEV/.env" LMS_DOMAIN)" = "$DOMAIN" ] || fail "$DEV/.env is set up for a different address."
  log "Development settings already in place."
else
  log "Writing development settings, with new secrets that are not displayed."
  (
    umask 077
    {
      echo "# The development site. Written by scripts/setup-development.sh on $(date -u '+%Y-%m-%d')."
      echo "# Its own secrets: none of these is shared with live."
      echo "SITE=development"
      echo "LMS_DOMAIN=$DOMAIN"
      echo "IMAGE_TAG=$LIVE_SHA"
      echo "POSTGRES_PASSWORD=$(secret)"
      echo "ROFT_APP_DB_PASSWORD=$(secret)"
      echo "AUTH_SECRET=$(secret)"
      # Copied as they are: who operates the platform, and the database's
      # name. Nothing secret, and nothing that would let this site reach live.
      grep -E '^(POSTGRES_USER|POSTGRES_DB|PLATFORM_ORG_SLUG|PLATFORM_NAME|PLATFORM_REFERENCE_PREFIX|PLATFORM_ILLUSTRATION|LMS_TLS_EMAIL)=' "$LIVE/.env" || true
    } > "$DEV/.env"
  )
  chmod 600 "$DEV/.env"
fi

DB_NAME="$(value_in "$DEV/.env" POSTGRES_DB)"; DB_NAME="${DB_NAME:-roft_lms}"
DB_USER="$(value_in "$DEV/.env" POSTGRES_USER)"; DB_USER="${DB_USER:-postgres}"
LIVE_DB_NAME="$(value_in "$LIVE/.env" POSTGRES_DB)"; LIVE_DB_NAME="${LIVE_DB_NAME:-roft_lms}"
LIVE_DB_USER="$(value_in "$LIVE/.env" POSTGRES_USER)"; LIVE_DB_USER="${LIVE_DB_USER:-postgres}"

# --- 3. its database, with live's data --------------------------------------

log "Starting the development database."
dev up -d db >/dev/null
for attempt in $(seq 1 30); do
  dev exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && break
  sleep 2
  [ "$attempt" -eq 30 ] && fail "the development database did not become ready."
done

TABLES="$(dev exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")"

if [ "$TABLES" -gt 0 ] && [ "$REFRESH" = false ]; then
  log "The development database already holds data ($TABLES tables). Use --refresh to copy live again."
else
  if [ "$TABLES" -gt 0 ]; then
    log "Refreshing: the development site stops and its database is emptied."
    dev rm -sf app >/dev/null 2>&1 || true
    dev exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -c \
      "drop schema public cascade; create schema public;"
  fi

  # Straight across, as decided. --no-owner and --no-privileges because the
  # roles and grants are this site's own: apply-policies creates them below
  # with this site's password. Read from live, written only here.
  log "Copying live's database."
  RESTORE_LOG="$(mktemp)"
  live exec -T db pg_dump -U "$LIVE_DB_USER" -Fc "$LIVE_DB_NAME" \
    | dev exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
    2>"$RESTORE_LOG" || true
  if [ -s "$RESTORE_LOG" ]; then
    log "The restore reported $(grep -c 'error' "$RESTORE_LOG" || true) error line(s); the counts below say whether they mattered."
  fi

  # A copy of the data, not of the people's live access. Sign-ins made on live
  # stay on live; each person's AI token and drive connection were sealed
  # under live's secret and could not be opened here anyway, and a test site
  # is not where anybody's access to their own files should sit.
  dev exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -c \
    "delete from sessions; update ai_user_settings set token_sealed = null, token_hint = null; delete from drive_connections;"
  log "Cleared copied sign-ins, AI tokens and drive connections."

  # Checked, not assumed: the same rows on both sides.
  for table in organisations users qualifications curriculum_modules library_documents assessments; do
    L="$(live exec -T db psql -U "$LIVE_DB_USER" -d "$LIVE_DB_NAME" -tAc "select count(*) from $table")"
    D="$(dev exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from $table")"
    [ "$L" = "$D" ] || fail "$table: live has $L rows and development $D. The copy is incomplete."
    log "  $table: $D on both."
  done

  # The files, through a read-only mount of live's volume. The Postgres image
  # is already on this machine, so nothing is downloaded to do it.
  log "Copying live's files."
  dev up --no-start app >/dev/null 2>&1
  docker run --rm \
    -v roft-lms_evidence:/from:ro \
    -v roft-lms-dev_evidence:/to \
    --entrypoint sh postgres:18-alpine -c 'rm -rf /to/* /to/.[!.]* 2>/dev/null; cp -a /from/. /to/'
  log "  $(docker run --rm -v roft-lms-dev_evidence:/to:ro --entrypoint sh postgres:18-alpine -c 'du -sh /to | cut -f1') copied."
fi

# --- 4. its schema and its own roles ----------------------------------------

log "Applying schema and policies with the development site's own roles."
MIGRATE_LOG="$(mktemp)"
if ! dev run --rm tools sh -c \
  'npx tsx scripts/pre-migrate.ts --phase renames \
     && npx drizzle-kit push --force \
     && npx tsx scripts/pre-migrate.ts --phase reshapes \
     && npx tsx scripts/apply-policies.ts' >"$MIGRATE_LOG" 2>&1; then
  tail -15 "$MIGRATE_LOG" | sed 's/^/    /'
  fail "the schema did not apply to the development database; its last lines are above."
fi
log "  $(grep -o 'Policies applied.*' "$MIGRATE_LOG" | tail -1)"

# --- 5. start it, and check the caps took ----------------------------------

dev up -d --no-build app >/dev/null
LIMITS="$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' roft-lms-dev-app-1)"
MEM_MB=$(( ${LIMITS% *} / 1024 / 1024 ))
CPUS="$(awk -v n="${LIMITS#* }" 'BEGIN { printf "%.1f", n / 1000000000 }')"
if [ "$MEM_MB" -le 0 ]; then
  # Stopped rather than left running: uncapped, it competes with live for the
  # one processor, which is the thing the cap exists to prevent.
  dev rm -sf app >/dev/null 2>&1 || true
  fail "the development application started without its memory limit, so it was stopped again."
fi
log "Development application started, capped at ${MEM_MB}MB and ${CPUS} of a processor."

# --- 6. the proxy -----------------------------------------------------------

SITE_FILE="$LIVE/caddy-sites/development.caddy"
mkdir -p "$LIVE/caddy-sites"
printf '# Written by scripts/setup-development.sh on %s. The development site.\n%s {\n\timport lms app-dev:3000\n}\n' \
  "$(date -u '+%Y-%m-%d')" "$DOMAIN" > "$SITE_FILE"

if ! live exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  rm -f "$SITE_FILE"
  fail "the proxy configuration did not validate with the development site in it. The file was removed and live was not reloaded."
fi
if ! live exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  rm -f "$SITE_FILE"
  fail "the proxy refused the reload. Caddy keeps its running configuration when it does, so live is as it was."
fi
log "Proxy reloaded: $DOMAIN now goes to the development site."

# --- 7. are both up? --------------------------------------------------------

for attempt in $(seq 1 24); do
  healthy "$DOMAIN" && break
  sleep 5
  [ "$attempt" -eq 24 ] && fail "the development site is not answering at https://$DOMAIN after two minutes."
done
log "Development is healthy at https://$DOMAIN."

healthy "$LIVE_DOMAIN" || fail "*** LIVE IS NOT ANSWERING at https://$LIVE_DOMAIN. Remove $SITE_FILE and reload the proxy. ***"
log "Live is still healthy at https://$LIVE_DOMAIN."

# --- 8. the schedule --------------------------------------------------------

if [ "$SCHEDULE" = true ]; then
  "$LIVE/scripts/schedule-development.sh" || fail "the schedule was not changed; see the line above."
else
  log "Schedule left as it was (--no-schedule). Install it later with ./scripts/schedule-development.sh"
fi

log "Done. Development: https://$DOMAIN   Live: https://$LIVE_DOMAIN"
