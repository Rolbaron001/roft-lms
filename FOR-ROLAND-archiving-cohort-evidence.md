# Archiving a cohort's evidence

**For:** Roland Jones; Heidi Edwards on the two points marked for her  
**From:** Claude, for ROFT Strategic Workforce Advisory  
**Date:** 25 September 2026  
**Job sheet:** 4.3

---

## What has been decided

Heidi's decision: once a cohort has received its certificates of competence and
statements of results after its first EISA, that cohort's evidence is archived
and removed from the main server. The records are kept for five years after the
certificate is issued. The model is **archive and keep**, not export and delete.

The job sheet adds two requirements. A provider must be able to run it
themselves, and what comes out must be complete enough to restore from.

## What already exists, and what does not

| | |
|---|---|
| When each learner certificated | Held: the certificate's issue date |
| Five years counted from that date | Held: a per-provider setting, five by default |
| A learner's Portfolio of Evidence, on screen | Held: the assessor's record page |
| A register of what was disposed of, by whom and why | Held |
| Packaging a cohort's evidence into one file | **Not built** |
| Marking a file as archived, and removing it | **Not built** |
| Restoring an archived cohort | **Not built** |

Only three kinds of file belong to a learner rather than to the programme:
their **evidence**, their **enrolment documents** and their **certificate**.
Guides, workbooks, lessons and policies belong to the programme and stay where
they are.

---

## How it would work

1. **Offered, never automatic.** A cohort is offered for archiving once every
   learner in it has a certificate and a statement of results. Nothing moves
   until an administrator chooses to.
2. **One archive per cohort.** For each learner: every piece of evidence, their
   enrolment documents, certificate and statement of results, every assessment
   decision with the criteria it was judged against, and every moderation
   record. With it, a list of every file and a fingerprint of each, so that any
   later change to any file can be detected.
3. **Readable without the platform.** The archive opens in an ordinary browser,
   with an index page per learner. An auditor four years from now needs the file
   and nothing else, even if the platform no longer exists.
4. **Proof before anything is removed.** The provider downloads the archive and
   stores it where their records policy says. Nothing leaves the server until
   the provider gives the archive back to the platform and every fingerprint
   matches. A download that was never saved, or was saved damaged, is caught
   while the originals still exist.
5. **The files leave; the record stays.** The files are removed from the server.
   Every record in the database remains, marked "archived on this date, in this
   archive, held by this provider". The learner's history is still complete on
   screen; only the files are elsewhere.

**Restoring** is the same check in reverse: the archive is uploaded, every
fingerprint is checked, and the files go back.

**At the end of five years** the provider disposes of the archive, and the
disposal is recorded in the register the platform already keeps.

---

## Decisions needed

| # | Question | Recommended | Why |
|---|---|---|---|
| 1 | Who keeps the archive? | **The provider**, and additionally the off-site store once it exists (10.4) | Heidi's words were that the provider takes custody. A second copy off-site costs little once the bucket is there. |
| 2 | Must the archive be given back and checked before files are removed? | **Yes** | It is the only step that proves the archive exists and is intact before the originals go. Without it, one unsaved download loses a cohort's evidence. |
| 3 | Who may archive? | **A provider administrator only** | It removes evidence from the platform. |
| 4 | What format? | **A single file that opens in a browser** | Readable in four years without the platform. |
| 5 | **For Heidi:** a learner who does not pass the first EISA and resits. Does the cohort wait for them? | **No.** The cohort is archived without them, and they follow when their own certificate is issued. | One resit should not keep a whole cohort's evidence on the server for a year. |
| 6 | **For Heidi:** the source of the five-year period | Still open | Needed so the figure can be shown to an auditor as a rule rather than a setting. See 4.3. |

---

**Decided by Roland, 25 September: all five recommendations adopted.** The
provider keeps the archive, with a second copy off-site once 10.4 exists; the
archive is handed back and checked before any file is removed; only a provider
administrator may archive; the archive is a single file that opens in a browser;
and a cohort is archived without anyone resitting, who follow once their own
certificate is issued. Decision 5 was marked for Heidi and she may still
overturn it before any real archive is made. Decision 6, the source of the
five-year period, is still Heidi's to supply and does not hold up the build.

## Cost and effort

**Disk:** the archive is the same size as the evidence it holds, plus a few
kilobytes of records per learner. Moving it off the server frees exactly that
much, and removes it from the nightly backups, which is where the saving
compounds: each gigabyte of evidence costs between 2.2 and 3 gigabytes of disk
while it is on the server, counting the two nightly archives kept from
26 September.

**Effort:** comparable to the development site built this week, a few days of
work. Nothing will be built until the decisions above are made, because the one
thing it must not get wrong is removing evidence.
