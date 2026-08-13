#!/usr/bin/env bash
#
# Restore a backup, and verify one without touching production.
#
# The second mode matters more than the first. A backup nobody has restored is
# a hypothesis, not a backup — and the moment you discover that is always the
# worst possible one. `--verify` restores into a scratch database, checks that
# every piece of evidence the database refers to is actually present in the
# evidence archive, and drops it again, so the restore can be proved on any
# ordinary Tuesday.
#
# That cross-check is the point. Counting rows only proves the database came
# back. A Portfolio of Evidence whose files are missing still counts rows
# perfectly, and fails at the only moment it is ever examined.
#
#   ./restore.sh --verify  backup.dump.enc     prove it restores, files and all
#   ./restore.sh --into    scratch_db  file    restore to a named db
#   ./restore.sh --replace-production  file    the real thing, database + files
#
# Give the .dump.enc file. The matching evidence archive is found beside it.
#
# Required: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_PASSPHRASE

set -Eeuo pipefail

MODE="${1:-}"
STORAGE_ROOT="${STORAGE_LOCAL_ROOT:-/app/storage}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ -z "$MODE" ]] && usage

decrypt_to() {
  local encrypted="$1" plain="$2"
  [[ -f "$encrypted" ]] || { log "No such file: ${encrypted}"; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$encrypted" -out "$plain" -pass env:BACKUP_PASSPHRASE
}

# The two halves are written together and named from the same timestamp.
evidence_archive_for() {
  local dump="$1"
  printf '%s' "${dump%.dump.enc}.evidence.tar.gz.enc"
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
      (select count(*) from evidence_artifacts)    || ' evidence files, ' ||
      (select count(*) from audit_log)             || ' audit entries'
  "
}

# Every storage key the restored database expects to find on disk.
storage_keys_in() {
  local database="$1"
  psql --dbname="$database" --tuples-only --no-align --command "
    select storage_key from evidence_artifacts where storage_key is not null
    union
    select storage_key from certificates       where storage_key is not null
    union
    select storage_key from lessons            where storage_key is not null
  "
}

# Compares what the database expects against what the archive holds.
#
# Returns non-zero if anything is missing. Extra files in the archive are fine
# and expected: the database is dumped first, so a file uploaded mid-backup is
# captured without a row pointing at it yet.
check_evidence_against() {
  local database="$1" archive="$2" workdir="$3"

  if [[ ! -f "$archive" ]]; then
    log ""
    log "VERIFY FAILED: no evidence archive beside this dump."
    log "  expected: ${archive}"
    log ""
    log "The database would restore, and every file it refers to would be gone."
    return 1
  fi

  log "Checking evidence files against the restored database..."

  local plain="${workdir}/evidence.tar.gz"
  decrypt_to "$archive" "$plain"

  # Paths in the archive are relative to the storage root, so they are the
  # storage keys themselves once the leading ./ is removed.
  tar -tzf "$plain" \
    | sed 's|^\./||' \
    | grep -v '/$' \
    | LC_ALL=C sort -u > "${workdir}/in-archive.txt"

  storage_keys_in "$database" \
    | grep -v '^$' \
    | LC_ALL=C sort -u > "${workdir}/expected.txt"

  local expected archived missing
  expected=$(wc -l < "${workdir}/expected.txt" | tr -d ' ')
  archived=$(wc -l < "${workdir}/in-archive.txt" | tr -d ' ')

  LC_ALL=C comm -23 "${workdir}/expected.txt" "${workdir}/in-archive.txt" \
    > "${workdir}/missing.txt"
  missing=$(wc -l < "${workdir}/missing.txt" | tr -d ' ')

  log "  ${expected} files referenced by the database, ${archived} in the archive."

  if (( missing > 0 )); then
    log ""
    log "VERIFY FAILED: ${missing} referenced file(s) are not in the archive."
    head -5 "${workdir}/missing.txt" | while read -r key; do
      log "    missing: ${key}"
    done
    (( missing > 5 )) && log "    ...and $((missing - 5)) more"
    return 1
  fi

  log "  Every file the database refers to is present."
  return 0
}

case "$MODE" in
  --verify)
    ENCRYPTED="${2:?Give the backup file}"
    SCRATCH="roft_lms_verify_$(date -u +%s)"
    WORK="$(mktemp -d)"
    PLAIN="${WORK}/database.dump"

    # shellcheck disable=SC2064
    trap "log 'Cleaning up'; dropdb --if-exists '$SCRATCH' || true; rm -rf '$WORK'" EXIT

    log "Decrypting..."
    decrypt_to "$ENCRYPTED" "$PLAIN"

    log "Creating scratch database ${SCRATCH}..."
    createdb "$SCRATCH"

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

    check_evidence_against "$SCRATCH" "$(evidence_archive_for "$ENCRYPTED")" "$WORK" || exit 1

    log "VERIFY PASSED. Database and evidence both restore, and they agree."
    ;;

  --into)
    TARGET="${2:?Give the target database}"
    ENCRYPTED="${3:?Give the backup file}"
    WORK="$(mktemp -d)"
    PLAIN="${WORK}/database.dump"
    # shellcheck disable=SC2064
    trap "rm -rf '$WORK'" EXIT

    decrypt_to "$ENCRYPTED" "$PLAIN"
    createdb "$TARGET" 2>/dev/null || log "Database ${TARGET} already exists."
    pg_restore --dbname="$TARGET" --no-owner --no-privileges "$PLAIN"
    log "Restored into ${TARGET}."
    count_evidence "$TARGET"
    log "Evidence files were not written: --into restores the database only."
    ;;

  --replace-production)
    ENCRYPTED="${2:?Give the backup file}"
    : "${PGDATABASE:?PGDATABASE must be set}"
    EVIDENCE_ENC="$(evidence_archive_for "$ENCRYPTED")"

    # Refuse before destroying anything, not half way through. A restore that
    # rebuilds the database and then discovers the evidence is unavailable has
    # already thrown away the only copy that had both.
    if [[ ! -f "$EVIDENCE_ENC" ]]; then
      log "No evidence archive beside this dump: ${EVIDENCE_ENC}"
      log "Refusing. Fetch it from object storage first, then run this again."
      exit 1
    fi

    # Typing the database name is the confirmation. This drops live data.
    log "This will DROP and rebuild ${PGDATABASE} and replace ${STORAGE_ROOT}."
    log "Everything in them now is lost."
    read -r -p "Type the database name to continue: " CONFIRM
    [[ "$CONFIRM" == "$PGDATABASE" ]] || { log "Cancelled."; exit 1; }

    WORK="$(mktemp -d)"
    PLAIN="${WORK}/database.dump"
    # shellcheck disable=SC2064
    trap "rm -rf '$WORK'" EXIT

    decrypt_to "$ENCRYPTED" "$PLAIN"
    decrypt_to "$EVIDENCE_ENC" "${WORK}/evidence.tar.gz"

    # Take a safety copy of what is about to be destroyed, in case the backup
    # being restored turns out to be the wrong one. Both halves, for the same
    # reason the backup takes both.
    SAFETY="/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    log "Copying current database and evidence to ${SAFETY}.* first..."
    pg_dump --format=custom --no-owner --file="${SAFETY}.dump"
    tar -czf "${SAFETY}.evidence.tar.gz" -C "$STORAGE_ROOT" . 2>/dev/null || true

    log "Rebuilding ${PGDATABASE}..."
    dropdb --force "$PGDATABASE"
    createdb "$PGDATABASE"
    pg_restore --dbname="$PGDATABASE" --no-owner --no-privileges "$PLAIN"

    # Files are added, not swapped in, so anything uploaded since the backup
    # survives. Evidence is write-once and content-hashed: there is nothing to
    # gain from deleting files the restored database has not heard of, and a
    # recent upload is exactly what you would not want to throw away.
    log "Restoring evidence files into ${STORAGE_ROOT}..."
    mkdir -p "$STORAGE_ROOT"
    tar -xzf "${WORK}/evidence.tar.gz" -C "$STORAGE_ROOT"

    log "Restored. Re-apply security policies now:  npm run db:policies"
    count_evidence "$PGDATABASE"
    ;;

  *)
    usage
    ;;
esac
