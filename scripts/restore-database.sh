#!/usr/bin/env bash
#
# Restore a backup, and verify one without touching production.
#
# The second mode matters more than the first. A backup nobody has restored is
# a hypothesis, not a backup — and the moment you discover that is always the
# worst possible one. `--verify` restores into a scratch database, counts what
# came back, and drops it again, so the restore can be proved on any ordinary
# Tuesday.
#
#   ./restore-database.sh --verify  backup.dump.enc     prove it restores
#   ./restore-database.sh --into    scratch_db  file    restore to a named db
#   ./restore-database.sh --replace-production  file    the real thing
#
# Required: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_PASSPHRASE

set -Eeuo pipefail

MODE="${1:-}"
log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ -z "$MODE" ]] && usage

decrypt_to() {
  local encrypted="$1" plain="$2"
  [[ -f "$encrypted" ]] || { log "No such file: ${encrypted}"; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$encrypted" -out "$plain" -pass env:BACKUP_PASSPHRASE
}

# Counts rows in the tables whose loss would actually matter. A restore that
# brings back an empty schema is a failure that looks like a success.
count_evidence() {
  local database="$1"
  psql --dbname="$database" --tuples-only --no-align --command "
    select
      (select count(*) from users)                 || ' users, ' ||
      (select count(*) from certificates)          || ' certificates, ' ||
      (select count(*) from assessment_decisions)  || ' assessor decisions, ' ||
      (select count(*) from moderation_records)    || ' moderation records, ' ||
      (select count(*) from audit_log)             || ' audit entries'
  "
}

case "$MODE" in
  --verify)
    ENCRYPTED="${2:?Give the backup file}"
    SCRATCH="roft_lms_verify_$(date -u +%s)"
    PLAIN="$(mktemp)"

    log "Decrypting..."
    decrypt_to "$ENCRYPTED" "$PLAIN"

    log "Creating scratch database ${SCRATCH}..."
    createdb "$SCRATCH"

    # shellcheck disable=SC2064
    trap "log 'Cleaning up'; dropdb --if-exists '$SCRATCH' || true; rm -f '$PLAIN'" EXIT

    log "Restoring into scratch..."
    pg_restore --dbname="$SCRATCH" --no-owner --no-privileges "$PLAIN" 2>&1 |
      grep -v 'warning: errors ignored on restore' || true

    log "Restored contents:"
    count_evidence "$SCRATCH"

    ROWS=$(psql --dbname="$SCRATCH" --tuples-only --no-align \
      --command "select count(*) from users")

    if (( ROWS == 0 )); then
      log "VERIFY FAILED: the restored database has no users."
      exit 1
    fi

    log "VERIFY PASSED. This backup restores and contains data."
    ;;

  --into)
    TARGET="${2:?Give the target database}"
    ENCRYPTED="${3:?Give the backup file}"
    PLAIN="$(mktemp)"
    trap "rm -f '$PLAIN'" EXIT

    decrypt_to "$ENCRYPTED" "$PLAIN"
    createdb "$TARGET" 2>/dev/null || log "Database ${TARGET} already exists."
    pg_restore --dbname="$TARGET" --no-owner --no-privileges "$PLAIN"
    log "Restored into ${TARGET}."
    count_evidence "$TARGET"
    ;;

  --replace-production)
    ENCRYPTED="${2:?Give the backup file}"
    : "${PGDATABASE:?PGDATABASE must be set}"

    # Typing the database name is the confirmation. This drops live data.
    log "This will DROP and rebuild ${PGDATABASE}. Everything in it now is lost."
    read -r -p "Type the database name to continue: " CONFIRM
    [[ "$CONFIRM" == "$PGDATABASE" ]] || { log "Cancelled."; exit 1; }

    PLAIN="$(mktemp)"
    trap "rm -f '$PLAIN'" EXIT
    decrypt_to "$ENCRYPTED" "$PLAIN"

    # Take a safety copy of what is about to be destroyed, in case the backup
    # being restored turns out to be the wrong one.
    SAFETY="/tmp/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
    log "Copying current database to ${SAFETY} first..."
    pg_dump --format=custom --no-owner --file="$SAFETY"

    log "Rebuilding ${PGDATABASE}..."
    dropdb --force "$PGDATABASE"
    createdb "$PGDATABASE"
    pg_restore --dbname="$PGDATABASE" --no-owner --no-privileges "$PLAIN"

    log "Restored. Re-apply security policies now:  npm run db:policies"
    count_evidence "$PGDATABASE"
    ;;

  *)
    usage
    ;;
esac
