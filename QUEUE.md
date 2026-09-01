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

- [ ] 3.1 Question types: multiple choice, matching columns, true/false with and without justification, short answer, essay, scenario
- [ ] 3.2 Answers captured and saved as the learner works, not only on submit
- [ ] 3.3 Per-section facilitator commenting, developmental and attached to the section
- [ ] 3.4 Rubrics attached to an assessment, and more than one version of an instrument held at once
- [ ] 3.5 Video by external link on a lesson

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

- [ ] 4.1 Active programmes across cohorts, with training, EISA registration and assessment dates
- [ ] 4.2 The assessment grid: every learner against every workbook and summative, by date
- [ ] 4.3 The client's own statuses: Submitted, Competent, Not Yet Competent, Remediation, Redo, Absent first attempt, Transferred, Left the programme
- [ ] 4.4 Workplace modules as submitted, then quality assured
- [ ] 4.5 Per-cohort task list with percentage complete
- [ ] 4.6 Monitoring visit status against a cohort

**Depends on 2.** Attendance and the schedule are half of what these sheets
hold. Building this first would mean building it twice.

---

## 5. Enrolment as the procedure actually runs

**Done when:** a learner cannot be registered without the documents their route
requires, and the platform asks for the right ones.

- [ ] 5.1 Document checklist: certified ID with a current certification date, certified copy of highest qualification, current CV
- [ ] 5.2 Documents quality assured as they are collected, not at reporting time
- [ ] 5.3 Requirements vary by route: learnership, standard qualification, RPL, employment equity points
- [ ] 5.4 Programme type drives which documents are asked for
- [ ] 5.5 POPIA consent captured with its date
- [ ] 5.6 Credentials emailed on registration, with password reset instructions

**Waits on the mail relay** for 5.6 only. The rest is independent of it.

---

## 6. Invigilated assessment

**Done when:** a summative sitting can be run and evidenced inside the
platform, well enough to replace the external invigilation licence.

- [ ] 6.1 A sitting: date, time, cohort, invigilator, permitted materials
- [ ] 6.2 Admission and the cut-off after which nobody is admitted
- [ ] 6.3 Attendance register whose signature is also the learner's declaration
- [ ] 6.4 Scripts received and acknowledged per learner
- [ ] 6.5 Incident report, filed the same day

**The deadline.** The client intends to end the external licence in March. Much
of the procedure will always be the invigilator's job; what the platform holds
is the record that the sitting was run properly.

---

## 7. The absent procedures

Each is small on its own: a record, a few states, a report. They look daunting
as a list and are not.

- [ ] 7.1 Appeals, acknowledged within two hours and logged per cohort
- [ ] 7.2 Learner support and special needs, with the extra assessment date and the oral alternative
- [ ] 7.3 Programme feedback within 48 hours of a summative, consolidated
- [ ] 7.4 Digital competency badges on completion
- [ ] 7.5 Learner discipline: offences graded, warnings with a validity period, hearings

**7.2 carries health and disability information.** It needs deliberate handling
under POPIA and must be visible only to those who have to act on it.

**7.4 is a retention measure, not decoration.** Formal certification delays have
measurably cost the client learners; a badge is the recognition that arrives on
time.

---

## 8. RPL, CAT and EISA registration

- [ ] 8.1 RPL: application, advisory, portfolio, judgement, moderation
- [ ] 8.2 CAT: mapping against the previous qualification's outcomes
- [ ] 8.3 Module exemption, so an RPL candidate does not read as a learner who skipped work
- [ ] 8.4 The transfer limit enforced, so a provider cannot breach it without noticing
- [ ] 8.5 EISA registration export, and the SETA registration alongside it
- [ ] 8.6 EISA timing visible in advance: three dates a year, registration three months ahead

---

## Needs a decision before it can be built

**Course against programme.** The client uses *programme* for everything and
finds the distinction an unnecessary duplication; the platform separates them
because other tenants will need a programme made of several distinct courses.
The meeting closed without agreement. Configurable labels per tenant is the
smaller change and would let both be right.

**Records management.** *Largely settled by the client on 31 August: Curiosa
wants to move away from keeping records in separate filing systems, and as much
as possible done in the platform.* That points at the platform becoming the
record rather than a working copy. What still needs deciding is the migration
and what happens to the Drive: whether it is retired, kept as an archive, or
kept as the statutory store for documents the platform will not hold. The
platform's audit log already records who did what, and retention can be driven
from the certification date it already holds.

**Offline capability.** Raised for field rangers with no cellular coverage. It
would change the shape of the platform rather than extend it: local storage,
conflict resolution, and an answer for evidence captured on a device unseen for
a fortnight. Scope it on its own before promising it.

---

## Deliberately not in this queue

**Video production.** Curiosa's procedure describes making a video in an
external tool and saving a file. Nothing about it belongs in a learning
platform. Linking to the finished video does, and that is item 3.5.

**Interface in local languages.** Wanted, Zulu first. It is a project rather
than a feature and should not be attached to a stage above.

**Non-credit-bearing certificate production**, currently prepared externally on
three days' notice. Worth revisiting once the rest lands.
