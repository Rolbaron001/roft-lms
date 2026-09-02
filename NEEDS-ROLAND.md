# Things only you can do

Written 2 September 2026, after finishing stages 7 to 10.

Ordered by what it costs to leave undone, not by effort. The first item is the
only one I would call urgent.

---

## 1. A storage bucket. This is the blocker.

**Why it matters more than anything else here.** Every backup is written to the
same server the records are on. Lose the machine and you lose the records and
the backups together, in one event. Until this is fixed, moving Curiosa's
records off a Google Drive that Google replicates and onto one VPS makes them
*less* safe, not more - so the whole of "the platform is the record" is
waiting on it, and I have deliberately not built the parts that would encourage
you to rely on it.

**What is needed.** An S3-compatible bucket and its credentials. Any of these
will do:

- Ask InspireTech - they may offer object storage alongside the VPS, which is
  the tidiest answer and one bill.
- Backblaze B2, which is the cheapest at this size (a few dollars a month).
- AWS S3 or Hetzner Object Storage.

**What happens then.** The S3 driver is already built and tested. It is two
settings in the server's `.env` (`BACKUP_BUCKET` and the credentials) and the
nightly backup starts working. I can do that part.

**Do not skip the second half.** Once the bucket exists, evidence should move
into it too - that is item 9.2. Flipping the switch sends *new* uploads to the
bucket and leaves everything already on disk where it is, which is the worst of
both. I have written `scripts/migrate-storage.mts` for exactly that: it copies
what is already there, verifies every file by hash, and never deletes the local
original. Run it with `--apply` after the switch, then look at the report before
deleting anything.

The server disk has about 11 GB free, and scanned certified copies and video
evidence across years of cohorts will exceed that. The database and the backups
are on the same disk.

---

## 2. Where the AI extension runs. A decision, not a task.

It works. Verified against your own documents: the three PDFs in
`121151 HRM Officer/Qualification Details` produced fifteen modules with their
real QCTO codes, 337 topic elements and 160 assessment criteria, in about seven
minutes. It also found three defects in those source documents, which is in the
commit message and worth reading.

**But it only runs where Claude Code is signed in.** That is your desktop. On
the InspireTech server nobody is signed in and the extension reports itself
unavailable - the platform behaves exactly as it does now.

I did not engineer around that, and I want to be straight about why. Signing
your personal Claude subscription into a multi-tenant production server would
put your usage limits behind every tenant's work, and it is a licensing
question rather than a technical one. It is your call and not mine to make
quietly.

**It is not limited to you.** Each member of staff switches on their own, on
their own account page - the administrator, the facilitators, the assessors, the
moderators and the skills development facilitator. Not learners, not an
employer's workplace coach, and not an external verifier. The only part that
stays with an administrator is the list of folders the platform may read, which
is a security boundary rather than a preference.

**But per-person settings are not per-person subscriptions.** The provider runs
on the machine the platform runs on. On a shared server everybody's work goes
through whichever Claude sign-in is on that server; where somebody runs the
platform themselves, it uses their own. The account page says so plainly rather
than letting anybody assume otherwise.

**So there are two ways to use it, and you should pick one:**

- **Run imports on your own machine.** Point the local copy of the platform at
  a folder, check the proposal, commit it. The qualification then lives in the
  database and syncs like anything else. This needs nothing from anybody and is
  what I would do.
- **Sign in on the server.** One `claude` then `/login` over SSH makes it
  available to every tenant. Ask Anthropic whether your plan permits that before
  doing it.

Either way, two things have to happen once. Each person switches their own on
under **your account** (the link is your name, top right). And an administrator
lists the folders that may be read, in **Settings** - that allow-list is not
optional, because a server process given a free path can read anything it can
reach, including its own configuration.

---

## 3. Numbers I had to guess, and you should confirm

Each of these is one field and a five-minute conversation. I have used a
defensible default and said so in the code rather than pretending to know.

**The RPL and credit transfer limit.** Defaults to 50 per cent of a
qualification per qualification. Fifty is commonly applied and is a default
rather than an authority - the qualification document or the assessment quality
partner is. Where one says otherwise, it is a field on the qualification.

**Public holidays.** Every working-day deadline in the platform - appeals,
grievances, hearings - skips weekends and nothing else. A deadline falling on a
public holiday is therefore a day tighter than the procedure intends. That never
disadvantages a learner, only reports Curiosa as late when they were not. The
fix is a per-tenant holiday calendar, and it belongs next to the time zone in
Settings. Say the word and I will build it.

**The feedback questions.** The set I shipped is reasonable and is not
Curiosa's. Theirs is a Google Form that was not among the documents. Send it and
it replaces the default - no code changes.

**EISA sitting dates.** These come from the assessment quality partner's letter
and have to be typed in once a year. Nothing can derive them. Until they are in,
the countdown that stops a cohort missing a registration deadline cannot run.

---

## 4. Two things to raise with Curiosa

**Their moderation SOP still says 25 per cent.** We corrected the platform and
both assessment documents on 1 September, but their own written procedure still
says a flat 25 per cent and says nothing about cohort size. A provider following
their own SOP on a cohort of eight would moderate two scripts and believe itself
compliant. That is their document to change.

**Their Records Management SOP no longer describes what happens.** It says only
the CEO grants access or creates folders. The platform is role-based with an
audit log, which is a stronger control but a different one. Item 9.6 is a
rewrite rather than a port, and it is worth telling them that rather than
letting them discover it during a monitoring visit.

---

## 5. Waiting on settings you already have in hand

**Outbound mail.** Emailing credentials to a learner on registration is built
and waiting on the relay host, user and password in the server's `.env`. Port
587 is confirmed open. Give me those three and it works.

---

## Housekeeping I did, so you know

I cleared 74 leftover test organisations out of the **local development**
database. They had accumulated from test runs going back weeks and had started
causing false test failures. Nothing on the server was touched, and no real
tenant data was involved - only fixtures with a timestamp in their name.

The older test files do not clean up after themselves, which is why they
accumulate. Worth fixing, low priority, mine to do.

---

## What is on GitHub

Stages 7, 8, 10 complete; stage 9 complete except the two items waiting on the
bucket. Every commit passes typecheck, lint, 946 tests and a production build.
97 tables are tenant-isolated, which the isolation test enforces.

The 16:00 deploy will take all of it. The schema changes apply themselves on the
way in.
