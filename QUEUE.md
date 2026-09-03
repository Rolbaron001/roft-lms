# Build queue — Phase 2

Driven by two assessments made on 31 August 2026, after the client tested the
platform against how they actually work:

- **Requirements register**, from eight recorded meetings, 10 to 28 August.
- **Coverage assessment**, against Curiosa's fourteen written procedures and
  their two operational workbooks.

Both live in the project folder outside this repository. Phase 1 is closed and
kept in [QUEUE-phase1-complete.md](QUEUE-phase1-complete.md).

Worked top to bottom. Each item says what *done* means, so there is no argument
about whether it is finished. Ticked as it lands, with the commit.

---

## Everything here is built for every tenant

**Standing constraint, set by Roland on 1 September 2026.** Nothing in this
queue is built for Curiosa alone. The register is drawn from Curiosa's
practice because they are the tenant testing it, but every item lands as a
capability of the platform.

That has two halves, and they are different problems.

**Isolation** is structural rather than a matter of discipline. Every table
carries `organisation_id`; `db/policies.sql` finds those tables by that column
and applies row-level security to each; the application connects as a role that
cannot bypass it. `tests/tenant-isolation.test.ts` fails if any table exists
with a tenant column and no policy, so a new table cannot be added carelessly
and quietly go unprotected. Adding sessions, session workbooks and attendance
took the count from 63 tables to 66 with no policy written by hand.

**Neutrality** is a matter of judgement and needs watching. Where Curiosa's way
of working is one option among several, it belongs in configuration rather than
in the code: the naming convention already works this way. Where their practice
follows from the regulator rather than from preference - a Statement of Results
per study unit, a facilitator-led session, an accreditation number per
qualification - it is the platform's behaviour and applies to everyone.

The test of any item here is that a second tenant with different habits could
adopt it without a fork.

---

## Why this order

Three things decide it, and none of them is preference.

**Some of these were already agreed.** Five decisions were minuted in meetings
and not actioned. Four are absent and one was built at the wrong level. They go
first because they are settled, they are small, and until they land the reports
the client shows a regulator are *wrong* rather than merely incomplete.

**Sessions are the foundation.** The platform has no concept of a lecture, a
sitting, or a register. Attendance, the roll-out schedule, the tracker, the
feedback cycle and invigilation all stand on that one absence. Anything built
before it gets built twice.

**One deadline comes from outside.** Curiosa intends to end its external
invigilation licence in March. That is the only date in this queue the project
did not set for itself.

---

## 1. The decisions already taken

**Done when:** every report the client puts in front of a regulator carries the
accreditation number for the qualification it concerns, and a Statement of
Results can be issued for a single study unit rather than only for a whole
qualification.

- [x] 1.1 Accreditation number held on the qualification, not only the provider
- [x] 1.2 It appears on the moderation pack and the Statement of Results
- [x] 1.3 Statements of Results issued per study unit
- [x] 1.4 Existing statements keep working, and still verify

**Landed.** Both columns were added rather than altered, so nothing already
issued changed: a statement with no study unit is still the whole-qualification
statement it always was, and still verifies.

The scoping is the part that needed care. A study-unit statement narrows every
check to the modules that unit delivers, so Study Unit 1 can be issued while the
rest of the qualification is outstanding. Get that narrowing wrong in the other
direction and the statement confirms modules nobody assessed, which is why four
of the new tests are about the boundary rather than the feature: one unit's
statement naming only its own modules, a unit refused while its own modules are
outstanding, the unit and qualification statements not colliding with each
other, and a unit from another qualification refused outright.

`describeAccreditation` returns the source alongside the number, so a report
falling back to the provider's says "(provider accreditation)" rather than
implying the qualification has one.

**Why it is not cosmetic.** The provider already has an accreditation number,
so a report *looks* correct today. But Curiosa's accreditation letters group
several qualifications under one number, and a report showing the provider's
number against the wrong qualification is worse than one showing none: it is
confidently wrong in front of the body that issued it.

**The structural half.** `statements_of_results` references a qualification and
nothing smaller. Issuing per study unit means the table has to carry one, which
makes this a migration rather than a form change.

---

## 2. Sessions, attendance and the roll-out schedule

**Done when:** a cohort has a dated schedule of lectures, each tied to the
curriculum module it covers, a facilitator can take a register against one, and
the platform can state a learner's attendance overall and to date.

- [x] 2.1 A session exists: date, time, cohort, facilitator, module, delivery mode
- [x] 2.2 Roll-out schedule per cohort, with workbook handout, submission and feedback against each lecture
- [x] 2.3 Register per session: present or absent per learner, taken by the facilitator
- [x] 2.4 Attendance percentages, overall and to date, per learner and per cohort
- [x] 2.5 Cohort naming from programme and induction date
- [ ] 2.6 Live session link on the session, and in the notification that announces it *(link done; the notification waits on the mail relay)*

**Landed.** Three tables, a library, a roll-out view on the cohort, and a
register a facilitator takes with the room in front of them.

The arithmetic is checked against the client's own workbook rather than against
a number I chose. One of their learners reads 0.4571428571 overall and
0.8421052632 to date; those are 16 present of 35 lectures, and 16 of the 19
held. The test reproduces both from the same shape of data, so the two
percentages mean what they mean to the client.

Two exclusions carry as much weight as the totals, and both are tested. A
cancelled lecture never happened, so counting it would mark a learner down for
the provider's decision. A walk-in is voluntary, so absence from it is not a
fact about the learner. Either one quietly dropped in a later rewrite would
produce a plausible wrong number rather than a visible failure.

Excused is held apart from absent because the learner support procedure turns
on the difference, and a register that cannot tell them apart cannot evidence
that the procedure was followed.

Cancelling requires a reason, because an unexplained gap in a schedule is
precisely what a monitoring visit asks about.

**The regulatory point.** Credit-bearing programmes require facilitator-led
delivery; self-study alone is not permitted. Until the platform knows what a
session is, it cannot evidence that the delivery happened at all, which is
precisely what a monitoring visit asks for.

**Scale to build for.** Roughly 35 dated lectures per cohort, per the
consolidated workbook the client supplied.

---

## 3. Workbooks as platform activities

**Done when:** a learner completes a workbook inside the platform rather than
receiving a Word document by email, and a facilitator comments on a section of
their work where the work is.

- [x] 3.1 Question types: multiple choice, matching columns, true/false with and without justification, short answer, essay, scenario
- [x] 3.2 Answers captured and saved as the learner works, not only on submit
- [x] 3.3 Per-section facilitator commenting, developmental and attached to the section
- [x] 3.4 Rubrics attached to an assessment, and more than one version of an instrument held at once *(already built; verified rather than rebuilt)*
- [x] 3.5 Video by external link on a lesson *(already built; verified rather than rebuilt)*

**Landed.** Less was missing than the assessment implied, and checking first
saved rebuilding two of the five. Rubrics already attach to an item, papers
already hold V1 and V2, and a lesson already carries an external link that the
course player renders. Six of the eight question types existed.

What was genuinely absent: matching columns, true-or-false-with-justification,
draft saving, and per-section feedback. Also, though the assessment did not say
so, the learner's form had no way to type at all: written answers had a type and
a marking path but no textarea, so an essay question could be authored and never
answered.

Two marking rules are the part worth guarding. A matching item is all or
nothing, the same way a multiple-response item already was, because partial
credit on one type only would be a second marking philosophy hiding inside the
first. And a justified true-or-false is never auto-awarded even though half of
it could be: the box is exactly the half a guess gets right, so awarding on it
would hand full marks to a guess and file it as evidence of competence.

The trap in draft saving was the attempt count. A draft is the attempt already
begun, so submitting finishes it; without that a learner who saved once would
have silently spent two of the attempts they were allowed and found out at the
worst moment.

**The most repeated request in the meetings**, and the one that changes what a
workbook *is* rather than adding a screen. Oral assessment already exists and is
not rebuilt here.

**Not in this item.** Parsing an uploaded document into questions automatically.
It was raised once, as a direction. Build the activities first and see whether
the parsing is still wanted once authoring is no longer a Word document.

---

## 4. The tracker and consolidated reporting

*Raised in priority by the client on 31 August: this is the substance of "as
much as possible done by the LMS". It stays behind item 2 only because it
cannot be built before sessions exist, not because it matters less.*

**Done when:** the client can stop maintaining the project tracker and the
per-cohort consolidated workbook by hand, because the platform holds what they
hold.

- [x] 4.1 Active programmes across cohorts, with training, EISA registration and assessment dates
- [x] 4.2 The assessment grid: every learner against every workbook and summative, by date
- [x] 4.3 The client's own statuses, derived rather than stored
- [x] 4.4 Workplace modules as submitted, then quality assured *(already built; verified rather than rebuilt)*
- [x] 4.5 Per-cohort task list with percentage complete
- [x] 4.6 Monitoring visit status against a cohort

**Landed.** A tracker across every cohort, and an assessment grid within one.

Nothing in it stores a status that could be worked out. The grid reads from
submissions, decisions and registers rather than keeping its own copy, because
a second place to say the same thing is a second place to disagree - and a
spreadsheet maintained by hand is wrong from the moment something happens until
somebody remembers to type it in, with no way to tell by looking which state it
is in.

Absent is the case that shows why. A learner who missed the sitting has no
submission for an absence to be recorded on, so it is read from the register of
the session the work was written at. That only became possible once sessions
existed, which is why this stage sat behind stage 2.

Workplace modules already moved through submitted, coach-signed and
accepted-by-assessor, so 4.4 was verified rather than rebuilt.

One rule worth guarding, and tested: a cancelled task leaves both halves of the
percentage rather than counting as done. Otherwise a cohort reaches a hundred
per cent by abandoning everything outstanding, and the number a coordinator
trusts rises fastest exactly when a programme is falling apart.

**Depends on 2.** Attendance and the schedule are half of what these sheets
hold. Building this first would mean building it twice.

---

## 5. Enrolment as the procedure actually runs

**Done when:** a learner cannot be registered without the documents their route
requires, and the platform asks for the right ones.

- [x] 5.1 Document checklist: certified ID with a current certification date, certified copy of highest qualification, current CV
- [x] 5.2 Documents quality assured as they are collected, not at reporting time
- [x] 5.3 Requirements vary by route: learnership, standard qualification, RPL, employment equity points
- [x] 5.4 Route drives which documents are asked for
- [x] 5.5 POPIA consent captured with its date *(already built; verified rather than rebuilt)*
- [ ] 5.6 Credentials emailed on registration *(needs the relay credentials in .env; outbound 587 is confirmed open)*

**Landed.** Documents are held against the person rather than the enrolment,
because a certified identity document is a fact about the learner and asking
for it again on their second qualification would be theatre.

Two rules carry this, and both are tested. The route decides the list: an RPL
candidate is claiming competence gained outside a formal programme, so asking
them for a certified copy of a qualification asks them to prove the opposite of
their case. And a certified copy expires, so a requirement satisfied in March is
not satisfied in July without anybody having touched it - with an undated copy
treated as expired rather than acceptable, because that is precisely how one
reaches a statutory return.

`consentGivenAt` and `consentVersion` were already on the user, so 5.5 was
verified rather than rebuilt. That is the fifth item across four stages where
checking first saved the work.

5.6 is the only thing in this stage waiting on anything, and it is now waiting
on configuration rather than on the network: outbound 587 is confirmed open, so
it needs the relay host, user and password in the server's .env.

**Waits on the mail relay** for 5.6 only. The rest is independent of it.

---

## 6. Invigilated assessment

**Done when:** a summative sitting can be run and evidenced inside the
platform, well enough to replace the external invigilation licence.

- [x] 6.1 A sitting: date, time, cohort, invigilator, permitted materials
- [x] 6.2 Admission and the cut-off after which nobody is admitted
- [x] 6.3 Attendance register whose signature is also the learner's declaration
- [x] 6.4 Scripts received and acknowledged per learner
- [x] 6.5 Incident report, filed the same day
- [x] 6.6 Runs virtually: the meeting link, cameras confirmed, and drop-outs

**Landed.** A supervised sitting hangs off the session it happens at rather
than being a second dated thing, because the schedule already holds when and
where a cohort meets and two records of one event drift apart.

**On running it in the platform.** The sitting carries the meeting link the
same way a lecture does, and the meeting itself stays on whatever platform the
provider already uses. The platform does not become a video service: what an
invigilation licence actually buys is not a room but a record - who was
admitted and who was turned away, what each candidate agreed to, that their
script was received, and what went wrong - and that is the part worth holding
here. A camera cannot be verified from outside the meeting, so what is recorded
is the invigilator confirming they saw it, which is what an appeal asks for
anyway.

Two rules refuse rather than warn, and both are tested against a fixed clock.
Admission closes a set number of minutes after the start; a candidate admitted
late has had longer with the paper than everybody else. And a candidate who
drops out cannot be readmitted, because somebody unsupervised for ten minutes
cannot be put back in the room on the strength of nobody remembering when they
left.

The refusal quotes the provider's own clock. An invigilator told "admission
closed at 03:19" while their watch says 07:19 will reasonably conclude the
platform is broken.

- [x] 6.7 The provider's clock is a tenant setting, and every time is labelled

**Closed, and corrected on the way.** The clock moved from the environment onto
the tenant record, where a provider sets it themselves in Settings and where it
is chosen when a tenant is set up. What is stored is a zone name rather than a
number of minutes: an offset of +120 is right for South Africa forever, and
right for London for half of each year, so a stored offset would refuse
admission to candidates arriving on time every winter.

The reader's clock was also a fault, not just a gap. A register rendered times
in whatever zone the browser happened to be in, so a moderator abroad and the
invigilator who ran the sitting saw different admission times for the same
event. Recorded times are now the provider's everywhere, labelled, and a reader
elsewhere is shown their own local equivalent alongside - as a courtesy, never
as the recorded value.

**The deadline.** The client intends to end the external licence in March. Much
of the procedure will always be the invigilator's job; what the platform holds
is the record that the sitting was run properly.

---

## 7. The absent procedures

Each is small on its own: a record, a few states, a report. They look daunting
as a list and are not.

- [x] 7.1 Appeals, acknowledged within two hours and logged per cohort

**Landed.** Filed per cohort, which is how the client files them and which is
also the only way "three appeals against one assessor on one cohort" is ever a
visible fact.

Two rules refuse. A result appeal cannot be resolved until the internal
moderator has been named - that is the step the procedure turns on and the one
a coordinator under end-of-term pressure would skip. A conduct appeal has no
such requirement, because there is no judgement for a moderator to re-examine
and demanding one would only teach people to name somebody who did nothing.

The two-hour acknowledgement is a recorded act rather than an email, so the
platform can be asked which are overdue while there is still time to act. It
cannot be re-stamped: the first one is the evidence.

**A late appeal is not refused.** Turning one away would push the whole matter
back into an inbox where nobody can audit it, which is worse than a late
appeal. What is refused is accepting one silently - somebody says why, and the
reason is part of the file.

**Working days are counted properly.** A result handed back on a Friday and one
handed back on a Monday now give the learner the same two days. Public holidays
are passed in rather than known, and nothing passes any in yet, so a deadline
falling on one is a day tighter than intended - the safe direction, and noted
below.
- [x] 7.2 Learner support and special needs, with the extra assessment date and the oral alternative

**Landed, and the POPIA question answered structurally rather than by policy.**
The record is split. The accommodation - allow breaks, seat near the door,
provide printed materials - goes to whoever has to do it. The need behind it -
the diagnosis, the symptoms, the financial circumstances - is restricted to the
coordinating roles.

That split comes straight out of the procedure, which says the coordinator
"must inform the Facilitator / Assessor of learner requirements" and does not
say tell them why. A platform that satisfies that by showing a facilitator
somebody's diagnosis has done more than it was asked and more than it should.
An assessor who can only act is told that detail exists and is withheld, so
they can tell "nothing more to know" from "not mine to see" and go and ask if
it matters.

Recording a need refuses without the learner's own consent, held per record
rather than per learner: somebody may disclose a mobility need and not a
psychological one, and treating one consent as covering both is the failure the
Act is about. The sensitive half is optional and the form says so - a record
that says only what to do serves the learner just as well.

**The one additional date is enforced.** Nobody grants a fourth deliberately;
they grant a second one twice, months apart, because the first was arranged in a
conversation nobody wrote down. The refusal names the date already granted. The
oral route opens only on a recorded medical ground, because "missed it again"
is otherwise an unlimited supply of further chances wearing a different name.

The oral assessment itself was already built, for the third attempt after two
not-yet-competent results. This records the authorisation that opens it by the
other route.
- [x] 7.3 Programme feedback within 48 hours of a summative, consolidated

**Landed, and two steps of the procedure disappeared rather than being
digitised.** Nobody acknowledges receipt, because receipt is a row; nobody
transcribes anything into a consolidated spreadsheet, because the report is a
query. What is gained is the two questions a folder of returned forms could
never answer: which cohorts were never asked, and which learners have not
answered while there is still time to ask again.

Names are recorded and never displayed. The facilitator has to know who still
owes a form in order to chase them, so a response carries a learner; the report
shows answers together and unattributed, and the comments are shuffled so their
order cannot be lined up against the outstanding list. That is a display
decision rather than anonymity - the link is in the table - and what learners
are told says only that answers are reported together, which is true.

A late response is recorded, not refused. The deadline exists to say whether
the provider asked in time, not to punish a learner for answering on the third
day. Asking the same cohort twice about the same summative is refused: it would
restart a deadline that has run and split one set of answers across two
reports.

**Needs the client.** The questions are held as versioned data, and the set
shipped is a defensible default rather than Curiosa's own - theirs lives in a
Google Form that was not among the documents handed over. When it arrives it
replaces the default and no code changes to let it.
- [x] 7.4 Digital competency badges on completion

**Landed.** Awarded from the same reading of the criterion ledger that decides
readiness, never typed in, so a badge cannot claim something the assessment
record does not. It carries the day the work was finished rather than the day
the row was written.

Said plainly on the verification page: this is a provider's own record, not a
national qualification, no credits, no quality council. That sentence is the
most important thing on the page - a badge that reads like a certificate to an
employer is the one way this becomes a liability.
- [x] 7.5 Learner discipline: offences graded, warnings with a validity period, hearings
- [x] 7.6 Grievances, which run the opposite way and were not in the original brief
- [x] 7.7 Abscondment, derived from the attendance register

**Landed.** Three rules refuse, and each is a procedural defect that would cost
the provider the case whatever the learner did.

A hearing needs 48 hours' notice, checked against the clock. A notice that does
not state the allegations, or does not tell the learner they may be assisted and
may call witnesses, is refused. And ending somebody's programme needs a hearing
that was actually held with its findings recorded.

Warnings expire, and only live ones count towards escalation. Treating a warning
from two years ago as live is the commonest way a disciplinary decision is
overturned, and a folder cannot tell the difference.

**Grievances are kept apart from appeals** deliberately. An appeal is about a
result and goes to the moderator; a grievance is about treatment and goes to an
impartial investigator on a different clock. Appointing an investigator the
grievance names is refused - "a designated impartial person" is the procedure's
own promise, and a short-staffed week is exactly when it gets broken.

**Abscondment is derived from the register**, never stored, so correcting a mark
changes the answer at once. An absence recorded as excused is communication and
breaks the run. It produces a list to act on and never a decision.

---

## Corrected after the fact

**Moderation sampling.** Both assessments said the sample was 25 per cent,
taken from the client's own written procedure. QCTO policy says otherwise: a
cohort of ten or fewer is moderated in full, one of twenty or fewer at half.
The platform sampled at a flat rate, which met the policy only above twenty and
fell short on every smaller cohort - which is most of them.

Corrected in both documents and in the platform on 1 September 2026. The
configured rate is now a floor rather than the whole rule, and cohort size
raises it.

Worth raising with the client: their own procedure still states 25 per cent and
says nothing about cohort size, so a provider following it on a cohort of eight
would moderate two scripts and believe itself compliant.

**Public holidays are not yet a tenant's to keep.** Every working-day deadline
in this stage skips weekends and nothing else. A deadline that falls on a
public holiday is therefore a day tighter than the procedure intends, which
never disadvantages a learner but does misreport the provider as late. A
per-tenant holiday calendar is the fix, and it belongs next to the time zone in
Settings.

**7.2 carries health and disability information.** It needs deliberate handling
under POPIA and must be visible only to those who have to act on it.

**7.4 is a retention measure, not decoration.** Formal certification delays have
measurably cost the client learners; a badge is the recognition that arrives on
time.

---

## 8. RPL, CAT and EISA registration

- [x] 8.1 RPL: application, advisory, portfolio, judgement, moderation
- [x] 8.2 CAT: mapping against the previous qualification's outcomes
- [x] 8.3 Module exemption, so an RPL candidate does not read as a learner who skipped work
- [x] 8.4 The transfer limit enforced, so a provider cannot breach it without noticing
- [x] 8.5 EISA registration export
- [x] 8.6 EISA timing visible in advance

**Landed.** Three rules refuse.

A candidate cannot be judged before the advisory session has been recorded,
with what was actually advised rather than that a meeting happened. Skipping it
is how a candidate is failed for assembling the wrong kind of evidence, and the
platform is the only thing in a position to notice it never took place.

Every RPL judgement is moderated, not sampled - the cohort-size rule exists
because ordinary assessment has a paper trail of taught sessions behind it, and
RPL has none. The judgement grants nothing; the exemption follows moderation, so
a moderator who disagrees has nothing to unwind.

The transfer limit is checked at the single point an exemption comes into
existence, so neither route can breach it and neither has to remember to look.
By credits rather than module count, because a learner exempted from every small
module has not been exempted from half the qualification.

**Readiness now counts an exempt module as met and says so.** That is 8.3: an
RPL candidate must never read as a learner who skipped work, and a monitoring
visit sees recognition where recognition happened.

**Needs the client.** The exemption limit defaults to 50 per cent per
qualification and that figure is a default rather than an authority. The
qualification document or the assessment quality partner is; where one says
otherwise it is one field on the qualification.

**Needs the client.** EISA sitting dates come from the assessment quality
partner's letter and have to be typed in once a year. Nothing can derive them.

---

## Needs a decision before it can be built

**Course against programme.** The client uses *programme* for everything and
finds the distinction an unnecessary duplication; the platform separates them
because other tenants will need a programme made of several distinct courses.
The meeting closed without agreement. Configurable labels per tenant is the
smaller change and would let both be right.

**Records management.** *Settled by the client: the platform becomes the record,
not a working copy.* Confirmed again on 1 September. This is no longer an open
question but a piece of work, so it has moved into the queue as item 9.

**Offline capability.** Raised for field rangers with no cellular coverage. It
would change the shape of the platform rather than extend it: local storage,
conflict resolution, and an answer for evidence captured on a device unseen for
a fortnight. Scope it on its own before promising it.

---

## 9. The platform as the record

**Done when:** Curiosa can retire the Google Drive as their system of record
without losing anything their own procedure requires them to keep.

- [ ] 9.1 Off-server backups: an object storage bucket, and the nightly backup actually uploading to it
- [ ] 9.2 Evidence in object storage rather than on the server's disk
- [x] 9.3 A general document library: policies, accreditation letters, contracts, the PAIA manual
- [x] 9.4 Retention and archiving, driven from the dates the platform already holds
- [x] 9.5 Controlled deletion, so a record cannot quietly disappear

**Landed.** The library versions by supersession rather than by overwriting,
and naming what a document replaces marks the old one superseded in the same
act - so there is never a moment where two documents both claim to be current.
The superseded one is kept, because the policy that governed in March is what
an audit of March asks about.

Retention is derived from the certification date the platform already holds,
over the tenant's own period. Nothing is archived or destroyed by looking at
it: the platform says what is due and a person decides.

Destruction and deliberate retention both need a reason; archiving needs none.
Destroying is irreversible and somebody will one day ask why a record a
verifier wanted is not there. Keeping something past its date is a position a
provider takes deliberately rather than an oversight. Archiving destroys
nothing, and demanding a paragraph for it would make people stop doing it.

**Still to do inside 9.5:** the decision is recorded, and acting on it against
object storage is a separate deliberate step. That is on purpose while 9.1 is
outstanding - there is nowhere safe to act.
- [ ] 9.6 Their Records Management procedure rewritten to describe the platform rather than a Drive

**Why the platform is the better record, and not merely a different one.** A
Drive holds folders. The platform holds a document attached to the learner, the
enrolment and the assessment decision it belongs to, with an audit trail saying
who filed it and who checked it. A monitoring visit asks "show me the evidence
behind this decision", and that is one link here and a folder convention
somebody has to remember there.

**9.1 is the blocker and nothing else should start before it.** Verified on
1 September by running the backup: it stops at "Missing required setting:
BACKUP_BUCKET". Every backup is written to the same server the records are on,
so losing the machine loses the records and the backups together. Until that is
fixed, moving the record off a Drive that Google replicates and onto a single
VPS makes the records *less* safe, not more. The S3 driver is already built and
tested; this needs a bucket and two settings.

**9.2 follows from it.** Evidence currently sits on the server's disk, which has
11 GB free. Scanned certified copies, workbooks and video evidence across years
of cohorts will exceed that, and the disk is also where the database and the
backups live.

**9.3 is a genuine gap in scope.** The platform holds learner documents and
programme documents. Curiosa's procedure also covers general business documents
- policies, accreditation letters, contracts - and there is nowhere for those
to live.

**9.4 is in their procedure and nowhere in the platform.** "Archive learner
documentation within one month after certification." The platform holds the
certification date, so it can drive that; it does not yet.

**On access control.** Their procedure says only the CEO grants access or
creates folders. The platform is role-based with an audit log, which is a
stronger control but a different one, so 9.6 is a rewrite rather than a port.
Worth saying plainly to the client rather than letting them discover that their
SOP no longer describes what happens.

---

## 10. The AI extension

**Done when:** somebody can point the platform at a folder of qualification
documents and get a proposal they can check and commit, without an API key and
without the platform ever holding a credential.

- [x] 10.1 An extension framework: providers, availability, and an audit of every call
- [x] 10.2 A subscription-backed provider driving Claude Code, with no API key
- [x] 10.3 Switched on per tenant, off by default, with an allow-list of readable folders
- [x] 10.4 Folder to proposal: PDFs and Word documents converted, read, and reported
- [x] 10.5 Plan to curriculum and documents, in one act, through the ordinary authoring guards
- [x] 10.6 The AI offered where the work is, not on a page of its own
- [x] 10.7 Structured folders read directly, with the model as the fallback
- [x] 10.9 Folder import is ordinary functionality; the extension adds one thing

**Corrected again, and this one mattered more.** The first two versions gated
the whole folder import behind the AI extension. That was wrong: reading
`_control/blueprint.json` and filing documents by rule is deterministic file
handling, and putting it behind a model sign-in made ordinary functionality
unavailable to anybody who had not registered one - and unavailable on the
server, where nobody is signed in and nobody will be.

Folder import is now available to every user who can manage a qualification, on
any machine. The extension adds exactly one thing: reading the structure out of
the documents when a folder has no blueprint to read. The form says so in place,
so somebody without an extension can see what they would gain rather than find
the feature missing, and somebody with one can see that most of this never
touches it.

Verified with the extension switched off: the HRM Officer folder imported in
full - 15 modules, 267 elements, 160 criteria, 26 documents, nothing refused. A
folder without a blueprint refuses with a message naming the one thing that is
missing and why.
- [x] 10.8 The same rule applied at: uploading material, capturing an assessment, bulk learner registration

**All three built, and the split fell differently at each - which is the point
of asking the question separately every time rather than assuming.**

*Uploading material* uses no model at all. Sorting a folder of workbooks and
theory guides is the same job as sorting the documents in a qualification
folder, so it is the same code with the curriculum half switched off. The form
says so, because somebody who has read about the extension elsewhere would
reasonably wonder.

*Bulk learner registration* is rules for the headings people actually write -
Surname, Van, Voornaam, SA ID No - and no extension is needed. What one adds is
headings the rules miss, and it is sent the column titles and never a row. A
roster carries identity numbers and there is no reason for any of them to leave
the machine to answer a question about column names.

*Capturing an assessment* keeps the house-style parser as the first and usual
reading. The extension gets a second attempt only where that found nothing -
a paper the parser read twenty questions out of is one it understood. Anything
the model proposes is marked for an assessor without exception, and it is never
asked which answer is correct: that comes from the memorandum.

**Corrected after the fact.** The first build put the AI on a page you navigate
to, imported only the curriculum, and asked for approval one module at a time.
All three were wrong, and Roland said so.

It is now an affordance that appears inside the work - on Create a qualification
first - and renders nothing at all for somebody without an extension registered.
It cascades: point it at a qualification folder and it takes the curriculum, the
study units, the theory guides, the policies and the learner agreement, filing
each against whatever it belongs to. And it commits in one act, with anything
the guards turn away reported rather than swallowed.

**The structured path is the default and the model is the fallback.** The
client's own programme development system writes `_control/blueprint.json` and
`_control/register.csv`. Where those exist the structure is a file, read
directly: free, instant, and incapable of inventing an assessment criterion. The
model reads documents only where they are absent.

Measured on the real HRM Officer folder: **0.0 seconds** to read and 2.5 seconds
to commit 15 modules, 52 topics, 267 elements, 160 criteria, 2 study units and
26 documents, with nothing refused. The model path on the same qualification
took seven minutes.

**Feasible, and built.** Verified against the client's own documents: the three
PDFs in `121151 HRM Officer/Qualification Details` produced fifteen modules
across all three components with their real QCTO codes, 337 topic elements and
160 assessment criteria, in about seven minutes.

More useful than the structure were the thirty-one notes it returned. It found
that the Assessment Specification gives PM-01 as 10 credits where the
Qualification and Curriculum Documents both say 8, and worked out that only 8
makes the stated total of 134. It found that KM0107 has no topic elements and no
assessment criteria anywhere in the curriculum, and said so rather than
inventing them. It found the topic weightings sum to 100 per cent in one section
and 85 in another. Those are accreditation problems in the source documents, and
they were found in seven minutes.

**Where it runs.** Wherever Claude Code is installed and signed in - which is a
desktop, not the hosted server. On the server nobody is signed in, the provider
reports itself unavailable, and the platform behaves exactly as it does now.
That is the honest shape rather than a limitation to engineer around: see the
handover note.

**What it may not do.** It proposes. A person commits, a module at a time,
through the same authoring functions the hand editor uses - so every guard that
protects a hand-built curriculum protects this one. That is not caution for its
own sake: a model will produce something plausible from a document that says
nothing of the kind, and the review is the only place that gets caught.

---

## Deliberately not in this queue

**Video production.** Curiosa's procedure describes making a video in an
external tool and saving a file. Nothing about it belongs in a learning
platform. Linking to the finished video does, and that is item 3.5.

**Interface in local languages.** Wanted, Zulu first. It is a project rather
than a feature and should not be attached to a stage above.

**Non-credit-bearing certificate production**, currently prepared externally on
three days' notice. Worth revisiting once the rest lands.
