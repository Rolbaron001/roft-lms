#!/usr/bin/env bash
#
# Nightly backup: the database AND the evidence files, encrypted, copied off
# the server, pruned.
#
# Both halves, or it is not a backup. The database holds the assessment
# decision; the evidence files hold what the decision was made on. Restoring
# one without the other gives you a Portfolio of Evidence full of references to
# files that no longer exist — which, in front of an accreditation body, is
# worse than having no record at all, because the record says evidence existed
# and cannot produce it.
#
# A backup sitting on the same machine as the data is not a backup either. It
# is a second copy of the same disk, and losing the server loses both.
#
# Every step fails loudly. A backup script that quietly does nothing is worse
# than none at all, because you stop worrying about it.
#
#   ./backup.sh              dump, archive, encrypt, upload, prune
#   ./backup.sh --local-only skip the upload, leave both files in BACKUP_DIR
#
# Required environment:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
#   BACKUP_PASSPHRASE   long random string; without it the backup is unreadable
#   BACKUP_DIR          local staging directory
#   STORAGE_LOCAL_ROOT  where evidence files live (default /app/storage)
#   BACKUP_BUCKET       s3://bucket/prefix
#   BACKUP_S3_ENDPOINT  S3-compatible endpoint (Oracle Object Storage, etc.)
#   BACKUP_RETAIN_DAYS  default 30

set -Eeuo pipefail

LOCAL_ONLY="no"
[[ "${1:-}" == "--local-only" ]] && LOCAL_ONLY="yes"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/roft-lms}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
STORAGE_ROOT="${STORAGE_LOCAL_ROOT:-/app/storage}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

ARCHIVE="${BACKUP_DIR}/roft-lms-${STAMP}.dump"
ENCRYPTED="${ARCHIVE}.enc"
EVIDENCE_TAR="${BACKUP_DIR}/roft-lms-${STAMP}.evidence.tar.gz"
EVIDENCE_ENC="${EVIDENCE_TAR}.enc"

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

# ------------------------------------------------------------------ database
#
# The database goes FIRST, and the ordering is not arbitrary.
#
# A file uploaded while this script runs ends up either in both halves, or in
# the evidence archive but not the database. The second case is an orphaned
# file: harmless, invisible, cleaned up whenever you like. Reverse the order
# and the same upload lands in the database but not the archive — a row
# pointing at evidence that was never captured. One costs disk space; the other
# costs a piece of somebody's portfolio.

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

log "Encrypting database dump..."
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$ARCHIVE" -out "$ENCRYPTED" -pass env:BACKUP_PASSPHRASE
rm -f "$ARCHIVE"

log "Encrypted: ${ENCRYPTED}"

# ------------------------------------------------------------------ evidence
#
# Everything under the storage root: uploaded evidence, lesson media, generated
# certificates. Stored as one archive per night rather than a chain of
# incrementals, because a chain is only as good as its weakest link and
# restoring one means having every file since the last full copy. A single
# archive can be restored by one person under pressure, which is the only
# condition under which it will ever actually be restored.

if [[ ! -d "$STORAGE_ROOT" ]]; then
  log "Storage root ${STORAGE_ROOT} does not exist. Refusing: evidence would be silently skipped."
  exit 1
fi

log "Archiving evidence from ${STORAGE_ROOT}..."
FILE_COUNT=$(find "$STORAGE_ROOT" -type f | wc -l | tr -d ' ')

# `tar -C` so the archive holds paths relative to the storage root, which are
# exactly the storage keys recorded in the database. That is what lets the
# restore check compare the two directly.
tar -czf "$EVIDENCE_TAR" -C "$STORAGE_ROOT" .

EV_BYTES=$(stat -c%s "$EVIDENCE_TAR" 2>/dev/null || stat -f%z "$EVIDENCE_TAR")
log "Evidence archived: ${FILE_COUNT} files, $((EV_BYTES / 1024)) KB"

log "Encrypting evidence archive..."
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$EVIDENCE_TAR" -out "$EVIDENCE_ENC" -pass env:BACKUP_PASSPHRASE
rm -f "$EVIDENCE_TAR"

log "Encrypted: ${EVIDENCE_ENC}"

# A full archive every night is right while the evidence is small and wrong
# once it is large — video evidence makes that turn quickly. Say so before it
# becomes a three-hour nightly job nobody noticed growing.
if (( EV_BYTES > 2000000000 )); then
  log ""
  log "NOTE: the evidence archive has passed 2 GB."
  log "A full copy every night is no longer the right shape. Move evidence to"
  log "object storage and sync it per-file instead. See DEPLOY.md."
  log ""
fi

# -------------------------------------------------------------------- upload
if [[ "$LOCAL_ONLY" == "yes" ]]; then
  log "Local only; skipping upload."
  log "Both files stay in ${BACKUP_DIR} — on this server, which is not a backup."
else
  require BACKUP_BUCKET
  require BACKUP_S3_ENDPOINT

  for FILE in "$ENCRYPTED" "$EVIDENCE_ENC"; do
    log "Uploading $(basename "$FILE")..."
    aws s3 cp "$FILE" "${BACKUP_BUCKET}/" \
      --endpoint-url "$BACKUP_S3_ENDPOINT" \
      --only-show-errors

    # Confirm it arrived. `aws s3 cp` exiting zero is not proof the object is
    # readable, and this is the one moment it can be checked cheaply.
    if ! aws s3 ls "${BACKUP_BUCKET}/$(basename "$FILE")" \
        --endpoint-url "$BACKUP_S3_ENDPOINT" >/dev/null; then
      log "Upload of $(basename "$FILE") could not be confirmed. Not pruning."
      exit 1
    fi
  done

  log "Both uploads confirmed."
fi

# --------------------------------------------------------------------- prune
#
# Last, and only after everything above succeeded. Both halves are pruned on
# the same schedule so a surviving dump never outlives its evidence: a database
# restored against missing files is the failure this script exists to prevent.

log "Pruning local copies older than ${BACKUP_RETAIN_DAYS} days..."
find "$BACKUP_DIR" \( -name 'roft-lms-*.dump.enc' -o -name 'roft-lms-*.evidence.tar.gz.enc' \) \
  -type f -mtime "+${BACKUP_RETAIN_DAYS}" -print -delete

log "Backup complete: database and ${FILE_COUNT} evidence files."
