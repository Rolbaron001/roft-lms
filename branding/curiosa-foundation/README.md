# Curiosa Foundation: kept for when it is registered

On 28 October 2026 the LMS became Curiosa Foundation in full (job sheet D42).
On 29 October 2026 Roland asked for it to go back to Curiosa Academy: the
Foundation's registration as a learning provider is delayed, and new Curiosa
classes have to run before it comes through. Everything that made the change
is kept here, so going back to the Foundation is a set of steps, not a rebuild.

## What is kept

| What | Where |
|---|---|
| The whole application as it was, Foundation and all | git tag `curiosa-foundation-2026-10-29` |
| The Foundation images: book icon, seal, mascot, tree | `public/` in this folder |
| The Curiosa provider's Foundation name, colours and pictures | `provider.sql` |
| The Academy settings restored on 29 October | `academy.sql` |
| The branding guidelines (version 1.1, to the Logo Guide) | `Branding/Curiosa Foundation/` (project folder) |
| The sales pack in Foundation branding (D44) | `Marketing/` (project folder) |

What stays in the LMS either way, because every provider uses it: the page
background colour in each provider's branding settings, and the provider's
logo in the browser tab. Only the Curiosa provider's values change.

## Going back to Curiosa Foundation

1. **Images.** Copy the four files in `public/` here over the ones in the
   application's `public/` (`curiosa-logo.png`, `curiosa-mark.png`,
   `curiosa-peek.png`, `curiosa-tree.png`).
2. **Wording.** Change "Curiosa Academy" to "Curiosa Foundation" in the lines
   the tag changed: `git diff curiosa-foundation-2026-10-29 -- .env.example
   DRIVE-SETUP.md FOR-HEIDI-*.md QUEUE-phase1-complete.md lib/document-fields.ts
   lib/platform.ts scripts/set-operator.mts tests/` lists them. Keep the web
   address `lms.curiosa.academy`.
3. **Check, commit and push** (`npm run check`). Development has it within
   about fifteen minutes.
4. **The provider's settings, on each server.** Run `provider.sql` against
   development's database, then live's, at the release:

   ```
   cd ~/roft-lms-dev && docker compose -f docker-compose.development.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < provider.sql
   cd ~/roft-lms && docker compose -f docker-compose.production.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < provider.sql
   ```

5. **The platform name, on each server.** In `~/roft-lms-dev/.env` and
   `~/roft-lms/.env`, set `PLATFORM_NAME="Curiosa Foundation"`, then recreate
   the application so it reads the file (`docker compose -f <file> up -d
   --no-build app`; a restart keeps the old value).
6. **Job sheet.** Note it under D42, and change the root CLAUDE.md's line on
   the client's name.

Live takes the code at the Friday release, so do steps 4 and 5 on live at the
same time, or the name and colours change before the pictures do.
