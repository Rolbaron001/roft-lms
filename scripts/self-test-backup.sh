#!/usr/bin/env bash
#
# Proves the backup's evidence check actually catches a missing file.
#
#   ./self-test-backup.sh
#
# The check in restore.sh only earns trust if it has been seen to fail. A
# verification that passes on a healthy system tells you nothing: so does one
# that always passes. This builds a small synthetic backup pair, confirms it
# verifies, then removes a file the database refers to and confirms the same
# command now refuses it.
#
# Touches nothing real. Its own scratch database, its own directory, both
# removed on the way out. Safe to run against a live server, which is the point
# — a self-test you dare not run is not a self-test.

set -Eeuo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
DB="roft_lms_selftest_$(date -u +%s)"
STAMP="selftest"
DUMP="${WORK}/roft-lms-${STAMP}.dump"
DUMP_ENC="${DUMP}.enc"
EV_TAR="${WORK}/roft-lms-${STAMP}.evidence.tar.gz"
EV_ENC="${EV_TAR}.enc"
STORE="${WORK}/storage"
KEY="acme-org/evidence/sub-1/portfolio-item.txt"

log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
pass() { printf '    \033[32mPASS\033[0m  %s\n' "$*"; }
bad()  { printf '    \033[31mFAIL\033[0m  %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

FAILURES=0

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE must be set}"

log "Building a synthetic backup in ${WORK}"

# A miniature of the real schema: the tables restore.sh reads, and nothing
# else. Building it directly rather than restoring production keeps the test
# independent of whatever the live database happens to contain.
createdb "$DB"
psql --dbname="$DB" --quiet --command "
  create table users               (id serial primary key);
  create table certificates        (id serial primary key, storage_key text);
  create table assessment_decisions(id serial primary key);
  create table moderation_records  (id serial primary key);
  create table evidence_artifacts  (id serial primary key, storage_key text);
  create table lessons             (id serial primary key, storage_key text);
  create table audit_log           (id serial primary key);
  insert into users default values;
  insert into evidence_artifacts (storage_key) values ('${KEY}');
"

pg_dump --dbname="$DB" --format=custom --no-owner --no-privileges --file="$DUMP"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$DUMP" -out "$DUMP_ENC" -pass env:BACKUP_PASSPHRASE

mkdir -p "$(dirname "${STORE}/${KEY}")"
printf 'evidence of competence\n' > "${STORE}/${KEY}"

archive_current_storage() {
  tar -czf "$EV_TAR" -C "$STORE" .
  rm -f "$EV_ENC"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$EV_TAR" -out "$EV_ENC" -pass env:BACKUP_PASSPHRASE
  rm -f "$EV_TAR"
}

# ------------------------------------------------------------------ case one
log "1. A complete backup should verify"
archive_current_storage

if "${HERE}/restore.sh" --verify "$DUMP_ENC" >"${WORK}/out1.txt" 2>&1; then
  pass "complete backup verified"
else
  bad "a complete backup was rejected. Output:"
  sed 's/^/          /' "${WORK}/out1.txt"
fi

# ------------------------------------------------------------------ case two
log "2. A backup missing one referenced file should be refused"
rm -f "${STORE}/${KEY}"
archive_current_storage

if "${HERE}/restore.sh" --verify "$DUMP_ENC" >"${WORK}/out2.txt" 2>&1; then
  bad "a backup with a missing evidence file was accepted. This is the"
  bad "failure the check exists to prevent."
else
  if grep -q "$KEY" "${WORK}/out2.txt"; then
    pass "missing file detected, and named in the output"
  else
    bad "rejected, but did not say which file was missing"
    sed 's/^/          /' "${WORK}/out2.txt"
  fi
fi

# ---------------------------------------------------------------- case three
log "3. A dump with no evidence archive beside it should be refused"
rm -f "$EV_ENC"

if "${HERE}/restore.sh" --verify "$DUMP_ENC" >"${WORK}/out3.txt" 2>&1; then
  bad "a dump with no evidence archive at all was accepted"
else
  pass "absent evidence archive detected"
fi

# ---------------------------------------------------------------------- done
echo
if (( FAILURES == 0 )); then
  log "SELF-TEST PASSED. The evidence check catches what it is there to catch."
else
  log "SELF-TEST FAILED: ${FAILURES} problem(s) above. Do not trust the backups."
  exit 1
fi
