#!/usr/bin/env bash
#
# Nightly database backup: dump, encrypt, copy off the server, prune.
#
# Runs on the host from cron. The rule it exists to enforce is that a backup
# sitting on the same machine as the database is not a backup — it is a second
# copy of the same disk. Losing the server loses both.
#
# Every step fails loudly. A backup script that quietly does nothing is worse
# than none at all, because you stop worrying about it.
#
#   ./backup-database.sh              dump, encrypt, upload, prune
#   ./backup-database.sh --local-only dump and encrypt, skip the upload
#
# Required environment (see .env.backup):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
#   BACKUP_PASSPHRASE   long random string; without it the backup is unreadable
#   BACKUP_DIR          local staging directory
#   BACKUP_BUCKET       s3://bucket/prefix
#   BACKUP_S3_ENDPOINT  S3-compatible endpoint (Oracle Object Storage, etc.)
#   BACKUP_RETAIN_DAYS  default 30

set -Eeuo pipefail

LOCAL_ONLY="no"
[[ "${1:-}" == "--local-only" ]] && LOCAL_ONLY="yes"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/roft-lms}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/roft-lms-${STAMP}.dump"
ENCRYPTED="${ARCHIVE}.enc"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

fail() {
  log "BACKUP FAILED at line ${1:-?}. Nothing was pruned."
  exit 1
}
trap 'fail $LINENO' ERR

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "Missing required setting: ${name}"
    exit 1
  fi
}

require PGDATABASE
require PGUSER
require BACKUP_PASSPHRASE

# A weak passphrase makes the encryption decorative. Refuse rather than
# pretend the off-site copy is protected.
if (( ${#BACKUP_PASSPHRASE} < 20 )); then
  log "BACKUP_PASSPHRASE is shorter than 20 characters. Refusing."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

log "Dumping ${PGDATABASE}..."
# Custom format: compressed, and restorable table-by-table if ever needed.
pg_dump --format=custom --no-owner --no-privileges --file="$ARCHIVE"

BYTES=$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE")
log "Dump written: $((BYTES / 1024)) KB"

# A dump far smaller than expected usually means it ran against an empty or
# wrong database. Better to stop than to overwrite good backups with an empty
# one and prune the good ones afterwards.
if (( BYTES < 20000 )); then
  log "Dump is suspiciously small (${BYTES} bytes). Refusing to continue."
  exit 1
fi

log "Encrypting..."
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$ARCHIVE" -out "$ENCRYPTED" -pass env:BACKUP_PASSPHRASE
rm -f "$ARCHIVE"

log "Encrypted: ${ENCRYPTED}"

if [[ "$LOCAL_ONLY" == "yes" ]]; then
  log "Local only; skipping upload."
else
  require BACKUP_BUCKET
  require BACKUP_S3_ENDPOINT

  log "Uploading to ${BACKUP_BUCKET}..."
  aws s3 cp "$ENCRYPTED" "${BACKUP_BUCKET}/" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
    --only-show-errors

  # Confirm it arrived. `aws s3 cp` exiting zero is not proof the object is
  # readable, and this is the one moment it can be checked cheaply.
  if ! aws s3 ls "${BACKUP_BUCKET}/$(basename "$ENCRYPTED")" \
      --endpoint-url "$BACKUP_S3_ENDPOINT" >/dev/null; then
    log "Upload could not be confirmed. Keeping local copy, not pruning."
    exit 1
  fi

  log "Upload confirmed."
fi

# Pruning happens last, and only after everything above succeeded.
log "Pruning local copies older than ${BACKUP_RETAIN_DAYS} days..."
find "$BACKUP_DIR" -name 'roft-lms-*.dump.enc' -type f \
  -mtime "+${BACKUP_RETAIN_DAYS}" -print -delete

log "Backup complete."
