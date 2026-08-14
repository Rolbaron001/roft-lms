#!/usr/bin/env bash
#
# Sets the outbound mail settings, without editing a file by hand.
#
#   cd ~/roft-lms && ./scripts/set-mail-settings.sh
#
# Asks for each setting, hides the password as you type it, writes them into
# .env leaving everything else alone, and then checks the relay actually
# accepts the login.
#
# Exists because "open .env in a text editor and add five lines" is a fair
# amount to ask of somebody who only wants to turn email on, and because a
# password typed into a prompt does not end up in your shell history the way
# one typed into a command does.

set -Eeuo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  printf '\nNo .env found in %s. Are you in the right directory?\n\n' "$(pwd)" >&2
  exit 1
fi

say "Outbound mail settings"
note "Press Enter to keep what is already set, shown in brackets."
note ""

current() {
  # Reads a value out of .env without sourcing the file, which would run
  # anything in it and export every other secret into this shell.
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

ask() {
  local key="$1" prompt="$2" fallback="$3" existing answer
  existing="$(current "$key")"
  local shown="${existing:-$fallback}"

  read -r -p "  ${prompt} [${shown}]: " answer
  printf '%s' "${answer:-$shown}"
}

MAIL_HOST_VALUE="$(ask MAIL_HOST 'SMTP server' 'smtp.hostinger.com')"
MAIL_PORT_VALUE="$(ask MAIL_PORT 'Port' '587')"
MAIL_USER_VALUE="$(ask MAIL_USER 'Username (the full email address)' '')"

# -s hides it. The prompt is reprinted because -s also swallows the newline.
printf '  Password (nothing appears as you type): '
read -rs MAIL_PASSWORD_VALUE
printf '\n'

if [[ -z "$MAIL_PASSWORD_VALUE" ]]; then
  MAIL_PASSWORD_VALUE="$(current MAIL_PASSWORD)"
  [[ -n "$MAIL_PASSWORD_VALUE" ]] && note "Keeping the password already set."
fi

MAIL_FROM_VALUE="$(ask MAIL_FROM 'From address' "ROFT Learning <${MAIL_USER_VALUE}>")"
MAIL_REPLY_TO_VALUE="$(ask MAIL_REPLY_TO 'Reply-to (blank for none)' '')"

set_value() {
  local key="$1" value="$2"

  # Rewritten in place rather than appended, so running this twice does not
  # leave two MAIL_HOST lines with the second silently winning.
  if grep -q "^${key}=" "$ENV_FILE"; then
    # A password can contain & and \, which sed would treat as replacement
    # syntax. Building the line with awk avoids quoting it at all.
    awk -v key="$key" -v value="$value" \
      'BEGIN { FS="=" } $1 == key { print key "=" value; next } { print }' \
      "$ENV_FILE" > "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

set_value MAIL_HOST "$MAIL_HOST_VALUE"
set_value MAIL_PORT "$MAIL_PORT_VALUE"
set_value MAIL_USER "$MAIL_USER_VALUE"
set_value MAIL_PASSWORD "$MAIL_PASSWORD_VALUE"
set_value MAIL_FROM "$MAIL_FROM_VALUE"
set_value MAIL_REPLY_TO "$MAIL_REPLY_TO_VALUE"

chmod 600 "$ENV_FILE"

say "Saved. Checking the relay accepts the login..."

DC="docker compose -f docker-compose.production.yml"
if $DC run --rm tools npx tsx scripts/notify.mts check 2>&1 | grep -q "accepted the credentials"; then
  printf '\n\033[32m  The relay accepted the login. Queued email will go out on the next run.\033[0m\n\n'
  note "To send what is waiting right now:"
  note "  $DC run --rm tools npx tsx scripts/notify.mts send"
  printf '\n'
else
  printf '\n\033[31m  The relay refused the login.\033[0m\n\n'
  note "Run this to see exactly what it said:"
  note "  $DC run --rm tools npx tsx scripts/notify.mts check"
  note ""
  note "The usual causes, in order of likelihood:"
  note "  - the username must be the full email address, not just the part before the @"
  note "  - the password is the mailbox password, not your Hostinger account password"
  note "  - port 465 needs to be 465, and 587 needs to be 587; they are not interchangeable"
  printf '\n'
  exit 1
fi
