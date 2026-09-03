# Things only you can do

Written 2 September 2026, after finishing stages 7 to 10.

Ordered by what it costs to leave undone, not by effort. The first item is the
only one I would call urgent.

---

## 1. A storage bucket. Less urgent than I said - correction below.

**I overstated this on 2 September and want to correct it.** I wrote that losing
the machine would lose the records and the backups together. Linda's mail of
2 September says InspireTech takes a daily snapshot of the whole server, managed
from the VPS console rather than on the server itself. So the catastrophic case
is already covered, and my sentence was wrong. I had run the backup script, seen
it stop at `BACKUP_BUCKET`, and concluded there was nothing off the machine at
all. There is.

**What is still missing, which is real but not an emergency.**

- *Granular restore.* A whole-server snapshot restores the machine to a point in
  time. It cannot give you one learner's evidence file, or the database as it
  was on Tuesday without also rolling back everything else. For a monitoring
  visit asking for a specific record, that is the difference between minutes and
  a rebuild.
- *A copy that is not InspireTech's.* Snapshots live in their console, on their
  account. That is one provider holding the server, the snapshot and the
  restore. It is a good deal better than one disk, and it is not two providers.
- *Disk headroom.* Unrelated to backups and still true: the server has about
  11 GB free, shared by the database, the backups and every uploaded document.
  Scanned certified copies and video evidence across years of cohorts will
  exceed that, and a full disk stops the application rather than degrading it.

**So the bucket is worth having, and it can wait for a sensible answer rather
than a fast one.** The enquiry I drafted still stands. If InspireTech offer
object storage, take it; if not, Backblaze B2 is a few dollars a month.

**Three questions for Linda, which cost nothing to ask:**

- How many days of snapshots are retained, and how far back can we restore?
- Is the snapshot stored in a different facility from the server itself?
- Is the midnight backup she mentions our own database dump, or InspireTech's?
  I could not tell from the wording, and the answer changes whether we have one
  layer or two.

**When a bucket does exist,** the S3 driver is already built and tested: two
settings in the server's `.env` and the nightly dump starts going off the
machine. Then run `scripts/migrate-storage.mts --apply` to move the documents
already on disk - it copies, verifies every file by hash, and never deletes the
original.

---

## 2. The AI extension: parked, not deleted, and I was wrong about why

You asked me to park it. It is parked. It is switched off by one setting
(`LMS_AI_EXTENSION`), and while it is off the platform behaves exactly as it
did before it existed - no buttons that do not work, no notices offering
something unavailable. Nothing was deleted. Turning it back on is that one
setting and a deploy.

**I owe you a correction.** I told you Claude Code holds one sign-in per
machine, and that per-person or per-tenant use would need the server split up.
That was wrong, and I should have tested it before telling you. It holds one
sign-in **per configuration directory**, and which directory it uses is a
variable you can set per run. I have since tested exactly that. So your
instinct - that this ought to be solvable the way switching profiles on your
laptop is solvable - was right and my answer was not.

The code now reflects it: each tenant gets its own profile directory, so
Curiosa signing in on the server does not sign anybody else in and does not
share Curiosa's limits with another provider.

**What is still genuinely unsolved.** Per-*tenant* works. Per-*person* uses the
same mechanism but needs somebody to complete an interactive `claude /login`
through a web page, and driving an interactive terminal login through a browser
form is fragile in a way I would not want under a production feature. So the
honest position is: one sign-in per tenant is available now; one per person is
not.

**What that means in practice, if you unpark it.** One person signs Curiosa in
once, over SSH. Everyone at Curiosa with the extension switched on then draws
on that subscription and shares its limits. Nobody at another provider touches
it. That is a licensing question for Anthropic rather than a technical one, and
still your call - but it is a much smaller question than the one I put to you
before.

**None of this affects folder import.** Reading a folder, working out what is
in it and filing it is ordinary platform code and always was. The extension
only adds one thing: working out the structure of a folder that does not carry
a summary of itself. Every folder that does carry one imports at full speed
with the extension off, which is how your own qualification folders import
today.

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

## 5. Outbound mail - settings received, and a password to change

Linda sent the server mail settings on 2 September. Two corrections to what I
wrote before.

**It is port 465, not 587.** I had noted 587 as confirmed. Linda's own advice is
that 587 and 25 work but are "not secure and not recommended", and that some
servers block them. 465 is TLS from the first byte; 587 opens in the clear and
upgrades. Use 465.

**No code change is needed.** `lib/mail.ts` already switches on the port number:
`secure` on 465, STARTTLS otherwise. Getting that the wrong way round is the
usual reason a correct username and password still will not connect, and it was
handled when the mail layer was written.

**What goes in the server's `.env`:**

```
MAIL_HOST=mail.curiosa.academy
MAIL_PORT=465
MAIL_USER=server@curiosa.academy
MAIL_PASSWORD=<the password Linda sent>
MAIL_FROM=server@curiosa.academy
```

**Put the password in yourself.** I have not written it into any file, command
or commit, and I will not. That is a standing rule and not a comment on this
particular password.

**Then change it.** It arrived in plain text in an email, to two mailboxes, and
now sits in a PDF in the project folder. That is three copies outside anybody's
control. The PDF is not in the git repository - I checked - so nothing has been
published, but the mailbox password for the server should be rotated once it is
in the `.env`, and the new one should not travel by email.

**Four of the five are now set.** I put `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`,
`MAIL_FROM` and `MAIL_DOMAIN` into the server's `.env` on 3 September, having
first copied the file to `.env.backup-20260903-133125` in case any of it needed
putting back. `MAIL_PASSWORD` already had a value, so I left it exactly as it
was and did not read it.

So the one thing outstanding is a test: after the next deploy restarts the
application, register a learner and see whether the credentials mail arrives. If
it does not, the password is the first thing to check, and rotating it (above)
is a good moment to confirm it.

Anything bounced lands in the mailbox at `webmail.curiosa.academy`.

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
bucket. Every commit passes typecheck, lint, 961 tests and a production build.
96 tables are tenant-isolated, which the isolation test enforces.

Of the seven problems from your scan: 1, 2, 4, 6 and 7 are done, 3 is done bar
the test above, and 5 - folder import on courses and programmes - went in on
3 September. A course or programme folder files and indexes its documents
against the thing you opened it from; it does not invent structure, because a
course's shape is decided by you in the editor rather than by its documents.
A qualification folder still builds structure, because a curriculum document
says what the structure is.

The 16:00 deploy will take all of it. The schema changes apply themselves on the
way in - I applied the same two columns to the development database by hand,
because `drizzle-kit push` wants an interactive terminal it does not have in my
environment and failed quietly enough that I nearly missed it. The deploy script
runs it with `--force` and re-applies the security policies straight afterwards,
which is why the server does not have that problem.
