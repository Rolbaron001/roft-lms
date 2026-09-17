# Connecting Google Drive and OneDrive

**17 September 2026.** The platform can read a folder straight from Google
Drive or OneDrive instead of somebody downloading eighty files and uploading
them again. Curiosa keep all their learning material on Google Drive, which is
what prompted it.

**Two things have to be created before it appears at all, and they are yours to
create rather than mine.** Registering an application means agreeing to
somebody's terms on ROFT's behalf, and the consent screen carries ROFT's name —
that is not a decision to take by proxy. Neither costs anything.

Until they exist the option is absent from the screen rather than present and
failing, and a folder is chosen from a computer as it is today.

---

## Google Drive

1. At `console.cloud.google.com`, create a project — call it something like
   "ROFT LMS".
2. Enable the **Google Drive API** for it.
3. Configure the **OAuth consent screen**:
   - User type **External**, unless every user is on a Google Workspace domain
     you control, in which case **Internal** is simpler and needs no review.
   - App name: whatever your people should see when they are asked to consent.
     This is the name on the screen, so "Curiosa Academy LMS" reads better to
     Heidi than "ROFT LMS".
   - Scope: **`.../auth/drive.readonly`** and nothing else. The platform cannot
     create, change or delete anything, and asking for more would be asking for
     what it does not use.
4. Create an **OAuth client ID**, type **Web application**, with this
   authorised redirect URI:

       https://lms.curiosa.academy/api/drive/google_drive/callback

   Add one per hostname the platform is served on. The address is built from
   the host the request arrived on, because the platform is multi-tenant by
   hostname and a fixed address would send every tenant's consent back to one
   of them.

5. Put the client id and secret in the server's `.env`:

       GOOGLE_DRIVE_CLIENT_ID=...
       GOOGLE_DRIVE_CLIENT_SECRET=...

**On External and verification.** While the app is unverified, Google shows an
"unverified app" warning and limits it to test users you list. For a handful of
Curiosa staff that is workable — add them as test users and they will see the
warning once. Verification is only worth pursuing if this goes to many tenants.

---

## OneDrive

1. At `entra.microsoft.com`, under **App registrations**, create one.
2. Redirect URI, type **Web**:

       https://lms.curiosa.academy/api/drive/one_drive/callback

3. Under **API permissions**, add delegated Microsoft Graph permissions:
   **`Files.Read.All`**, **`offline_access`**, **`User.Read`**. Delegated, not
   application: the platform acts as the person who consented and sees only
   what they can already see.
4. Create a **client secret** and note it — Microsoft shows it once.
5. Put both in the server's `.env`:

       ONE_DRIVE_CLIENT_ID=...
       ONE_DRIVE_CLIENT_SECRET=...

---

## What a person then does

Settings → **Your file stores** → Connect. They are sent to Google or
Microsoft, asked to consent, and sent back. After that, every screen that takes
a folder — a qualification, a part qualification, a course, a programme — also
offers the drive.

**It is theirs, not the tenant's.** Every member of staff connects their own,
for the same reason each brings their own AI extension: the token reads that
person's drive, and a shared one would let a colleague reach files they were
never given. A tenant with four administrators has four connections or none.

---

## Google's own documents are read

Docs, Sheets and Slides are exported on the way in — to Word, Excel and
PowerPoint, which are the formats this platform already reads and the same ones
Google picks when you download a folder as a zip. A Drawing comes across as
PDF. The file arrives with the extension it now has, because everything
downstream reads it: a theory guide called "CA 121151 SU1 Theory Guide" with
nothing after it would otherwise be a document of unknown kind and unknown
format.

This matters more for Curiosa than for most: they work in Google throughout, so
their guides and workbooks are Docs rather than uploaded Word files. Without
the export the feature would have been useless to them — a folder of Docs would
have read as empty, and the only way in would have been to download the folder
as a zip and upload it again, which works *because Google exports the documents
on the way into the zip*. The export was always happening. It was only
happening on the other side of a manual round trip.

Google refuses to export a very large document — the documented limit is around
10 MB of exported content. One that hits it is named, with the suggestion to
download that document on its own; the rest of the folder reads normally.

A Form, a Map or a shortcut is skipped: Google-native things with no document
inside them to export.

## What the platform holds, and what it cannot do

A sealed refresh token per person per provider. It can be exchanged for
read access to that person's drive until they disconnect it here or withdraw it
from the provider's own account page — and both are worth doing if somebody
wants it gone completely, because the platform can stop holding a token but
cannot revoke one at Google on somebody's behalf.

It is never displayed, never returned to the browser, and never written to a
log. Errors from either provider have the client secret stripped out before
anything reads them, because both quote it back in some messages.

The scope is read-only at the provider, not merely by convention here: Google
and Microsoft will refuse a write, whatever the platform asks.

---

## What it will not do yet, and why

**Five hundred files, or about 750 MB, in one go.** A qualification folder is
eighty files; a personal drive root is not. Refused with the number said,
rather than reading part of it — a partial import that looks complete is the
failure this platform keeps having to design against.
