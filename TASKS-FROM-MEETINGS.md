# Task list from the RJ & HE meetings

Drawn from the meetings of **8 September** and **9 September 2026**
(`Meetings/RJ & HE - LMS – 2026_09_08 10_55 SAST…docx` and
`Meetings/RJ & HE – 2026_09_09 10_28 SAST…docx`), checked against what the
platform already does rather than taken at face value. Where something already
exists it says so, because "add X" when X is half-built is how the same work
gets done twice.

Ordered by what unblocks the most.

---

## The rule that governs all of it

**`Design/` is reference material — specifications and worked examples of
functionality to build. It is not a data source and it is not a layout to
copy.**

The platform serves many providers. A template in `Design/Templates/` shows
*that* the platform must produce a document and roughly what it must carry; it
does not fix how every tenant's version looks. **Users must be able to create or
upload their own templates, and the platform must use theirs.**

The one exception is a form a regulator mandates. A QCTO submission goes in the
QCTO's format because the QCTO says so — Roland in the 9 September meeting: the
LMS "will store these records and export them in the exact template format when
required for QCTO submissions". That is prescribed from outside and is not the
platform imposing taste on a tenant.

---

## 1. Flexible terminology, per tenant — **done**

A per-tenant vocabulary: ten renameable terms, tenant overrides, one helper
every screen reads its nouns through, and a Settings screen.

Built on the split already in `lib/dictionary.ts`: a term a regulator defines
(`authority`) cannot be renamed, because a tenant who renamed "qualification"
would have changed the wording on their own QCTO submission without anybody
telling them. "Course", "Programme", "Cohort", "Facilitator" are fair game;
"Qualification", "EISA", "NQF", "credit", "Exit Level Outcome" are not.

**Outstanding:** the string sweep. The registry and the screen are done; not
every user-facing sentence reads through the helper yet.

---

## 2. Part qualifications — **done**

`kind` (full · part · skills programme), a parent link, and a module selection
so a part draws a subset of the parent's curriculum rather than copying it.
Readiness, criterion coverage, EISA readiness and every module count run over
the subset. The importer reads the kind, the parent and the module list out of
the SAQA document.

Built against the real Commercial Cleaner documents. See
`PART-QUALIFICATIONS-AND-TEMPLATES.md` for what they settled and what they
corrected.

**Confirmed by Heidi on 9 September:** part qualifications "do not have their
own separate curriculum documents; instead, their modules are specified within
the curriculum document of the full qualification." That is what was built.

**Outstanding:** a screen to change a qualification's kind or parent after
creation. It is set at creation and read from the document on import, which
covers both routes in; correcting a mistake means the form.

---

## 3. Occupational skills programmes — **mostly done**

The `kind` work covers it, including a skills programme that stands alone with
no parent and carries its own curriculum.

**Outstanding: FISA.** A different assessment shape from the EISA the platform
models — provider-set and provider-moderated rather than set by an assessment
quality partner, with its own instrument structure, confidentiality agreements
and pre-moderator reports. Templates are in `Design/Templates/`. Its own body of
work.

---

## 4. Statutory notification, the LEISA export, and late joiners

**Deadlines:** 21 working days for a full or part qualification, 5 for a skills
programme. The clock runs from the **induction date**, which Heidi confirmed on
9 September is the start of training at Curiosa, and which the QCTO checks
against the enrolment form and rollout schedule at a monitoring visit.

**Late joiners — new on 9 September, and they change the shape of this.**
A learner can join after a cohort has started (within 21 days). When they do
they need:

- **their own induction**, separate from the cohort's;
- **their own enrolment form**;
- **their own LEISA spreadsheet**, submitted to the QCTO alongside the main
  cohort's rather than folded into it.

So the induction date is *not* always the cohort's induction session, and the
notification deadline is per learner, not per cohort. That was an open question
from 8 September and is now answered.

**What exists:** `lib/working-days.ts` does the arithmetic. `induction` is
already a cohort session kind. The rollout schedule exists. Required learner
documents are enforced. There is no deadline, no LEISA export, no late-joiner
path and no acknowledgement record.

**What to build:**

- A notification due date **per enrolment**, from that learner's induction date,
  21 or 5 working days according to kind.
- A view of what is approaching and what is overdue. This is the kind of
  deadline only ever noticed late.
- A **LEISA export** in the QCTO's own workbook shape, with the right recipient
  for the kind (`learnerenrolments@` vs `splearnerenrolments@`). Building the
  file is the platform's job; sending it stays a person's.
- A **separate LEISA for a late joiner**, not merged into the cohort's.
- Record that the acknowledgement came back, as the SOP asks.

**The export has awkward mechanics, and Heidi flagged them specifically.** The
QCTO's data-loading specification requires pre-formatted cells, a leading
apostrophe to preserve leading zeros, and strict two-digit codes (`01`, `02`)
for fields like socio-economic status. An export that writes `1` where the
sheet wants `'01` will be rejected. `Design/Templates/data-loading-specification-document.pdf`
and `STATSSA_AreaCodes.xls` are the references.

**Blocked on nothing now** — the templates are in `Design/Templates/`. It needs
the learner fields first (task 7).

**Size:** large.

---

## 5. Check the platform against the enrolment SOP end to end

Reviewing a document is not the same as checking the platform matches it. The
SOP has specifics the platform may or may not enforce — an ID with multiple
certification dates is unacceptable, an illegible one is unacceptable, forms are
QA'd before capture, details go into both the LMS *and* the Tracker.

Confirmed on 9 September: enrolment starts after the client is invoiced and
proof of payment is received, and cohorts run at 5–10 learners minimum to be
cost-effective.

**Size:** small. A read-through against the screens, then a short list of gaps.

---

## 6. CAT and RPL: the three-year rule — **new, 9 September**

Heidi answered the module question, and the answer corrects an assumption in
what was built:

> "Learners only complete modules required for their current enrolment. If a
> learner previously completed an identical module elsewhere, **Credit
> Accumulation and Transfer** is applied for completions within the last three
> years, while **Recognition of Prior Learning** applies for courses completed
> more than three years ago."

So completion does **not** travel silently between enrolments. There is one
module in the curriculum, but a learner's achievement of it is transferred by a
person, on the record, under one of two routes — and a date decides which.

**What exists, and it is most of it.** `recordCreditTransfer` grants a CAT
exemption with a written mapping, an approver and an audit trail; RPL has
application, advisory, judgement and moderation. `creditTransfers.awardedOn`
already records when the source qualification was awarded.

**What is missing:** nothing uses `awardedOn` to decide the route. A coordinator
can record a CAT against a ten-year-old certificate and the platform accepts it.

**What to build:**

- Compare `awardedOn` against the approval date. Within three years, CAT is the
  right route. Beyond it, say so and point at RPL.
- Refuse a CAT beyond three years rather than warn — the distinction is the
  QCTO's, and a transfer recorded under the wrong route is a finding at a
  monitoring visit. RPL is available and is not a harder path, only a different
  one.
- Say which route granted an exemption wherever exemptions are shown, with the
  date the source was awarded. A learner recognised under RPL should not read as
  somebody who skipped work.

**Size:** small. The machinery exists; this is the rule on top of it.

---

## 7. The enrolment form, on the platform — **new, 9 September**

> "The LMS should automate the enrolment form process so learners complete
> fields directly on the platform, inheriting cohort details like induction
> dates automatically."

Settled: the platform holds the form. Not a Word document emailed around and
filed back. This also answers the 8 September question about whether Curiosa
creates it outside.

**What exists:** twelve of the roughly forty-three fields a LEISA needs —
national ID, date of birth, gender, equity code, disability code, names, email,
OFO code.

**Not held, and needed:** middle name, title, nationality code, home language
code, citizen/resident status, socio-economic status, disability rating,
immigrant status, home address (three lines and postcode), postal address
(three lines and postcode), phone, cell, fax, province code, STATSSA area code,
POPIA agreement and its date, expected completion date, assessment centre code,
FLC and its statement number.

**What to build:**

- The fields, with the two code lists imported (`STATSSA_AreaCodes.xls` and the
  data-loading specification's own tables).
- A learner-facing form that inherits everything the cohort already knows —
  induction date, programme, employer — so the learner fills in only what is
  theirs.
- POPIA consent captured with its date, since the LEISA asks for both.
- The completed form as a document the platform can produce and file, because
  Heidi named it as evidence a QCTO monitor asks for.

This is the front half of the LEISA pipeline and task 4 depends on it.

**Size:** large.

---

## 8. Workbooks and assessments onscreen — **new, 9 September**

> "Workbooks and assessments must be rendered onscreen rather than uploaded as
> standalone files."

Heidi asked whether the platform would turn formative and summative workbooks
into interactive onscreen activities. Roland confirmed the direction: learners
work on screen; the platform can also be used to build the online material from
the source documents.

**This contradicts what the platform currently tells users.** The qualification
screen says handbooks, workbooks and marking memoranda "are written in Word and
Excel, and stay that way — they are print artefacts a facilitator annotates and
a moderator marks up." True of handbooks and sign-off sheets; **no longer true
of workbooks and assessments.** That copy needs correcting either way.

**What exists, and it is more than it looks.** Onscreen assessment is real:
quizzes, matching items, true-or-false-with-justification, practical tasks and
workplace logbooks are all content types, and `markResponses` marks them. The
capture path reads an assessment paper into onscreen items with a rule parser
first and an AI extension only where the parser found nothing.

**What is missing:** the same path for a **workbook**. Capture is built around
assessment papers. A formative workbook is a different shape — activities with
model answers and a facilitator's guidance rather than marked questions.

**What to build:**

- Extend capture to read a workbook into onscreen activities.
- A learner-facing workbook view that records what they did, so a facilitator
  and a moderator can see it without a Word file.
- Correct the copy on the qualification screen.

**Size:** large.

---

## 9. Tenant document templates — **new, from Roland, 10 September**

The platform must produce documents, and **a tenant must be able to supply the
template it uses**. The QCTO templates in `Design/Templates/` are examples of
what must be producible, not the layout every provider gets.

**What exists:** nothing. There is no template table, no merge-field mechanism,
and no way for a tenant to substitute their own version of anything.

**Where this already bites.** The Statement of Results was reconciled against
`QCTO SoR Template.docx` on 9 September and the result is a fixed layout in
code. Most of its *content* is right and should stay fixed — the two-year
validity, the "this is not an Occupational Certificate" disclaimer and the
attachments list come from the QCTO, not from taste. But the shape of the
document, its wording and its letterhead are a tenant's, and today a tenant
cannot change any of it.

**What to build:**

- A tenant-owned template library: upload a `.docx`, or start from the
  platform's default and edit it.
- Merge fields the platform fills — learner, qualification, modules and
  results, provider, dates, verification reference — with a visible list of what
  is available, so somebody building a template knows what they can place.
- Documents produced through the tenant's template where one is set, and the
  platform's default where none is.
- **A protected core.** Where a statement carries something a regulator
  requires, the platform still puts it there. A tenant may restyle a Statement
  of Results; they may not quietly drop the sentence saying it is not a
  certificate.
- Regulator-mandated submissions stay outside this: the LEISA workbook is the
  QCTO's format and is not a tenant template.

**Size:** large, and it touches every document the platform issues —
certificates, statements, the enrolment form, workplace agreements, reports.

---

## Not tasks, recorded so they are not mistaken for omissions

- **Design restraint.** Heidi praised the clean layout and colour scheme and
  said she does not want cluttered or gaudy design. Standing constraint.
- **No QCTO or SAQA logo, anywhere, ever.** Heidi raised it on 9 September as a
  regulatory prohibition, pre-emptively rather than because she had seen one.
  Checked: none exists. Naming a regulator in text is a different thing and
  stays — the platform has to be able to say a certificate comes from the QCTO.
- **Folder organisation.** The 9 September meeting agreed to create
  `Design/Part Qualifications/`, move `Skills Programmes/` up, and add
  `Design/Templates/`. Done, by Heidi. Not platform work.
- **The management session.** Value chain and statutory process for skills
  programmes, deferred by agreement to its own meeting.

---

## Carried over, not from these meetings

- **Outbound mail still refuses the login** (`535`). Awaiting Linda's
  confirmation of the current credentials. Testable from Settings → Outbound
  mail.
- **The `tools` container cannot resolve DNS.** Harmless today; breaks off-site
  backups.
- **Off-site storage for backups.** Still outstanding.
- **The Commercial Cleaner curriculum imports thin.** Its modules and topics
  land; the topic content and internal assessment criteria do not. Same shape as
  the `Cr 6` credits gap — one house style the reader does not know. See
  `PART-QUALIFICATIONS-AND-TEMPLATES.md`.

---

## Settled by Heidi, worth keeping

**Enrolment is per programme ID.** "Each full qual and each part-qual and each
skills programme has its own identification number, so the enrolment is per
programme ID number per learner." A part qualification is enrolled onto
directly; the full qualification is not involved.

**The clock starts at induction**, not at enrolment or proof of payment. The
QCTO uses the enrolment form and rollout schedule as evidence of it.

**Codes are assigned, never derived.** "The curriculum codes are mostly derived
from the Organising Framework for Occupations, but if there is not an associated
occupation in the OFO for the skills programme then the QCTO assigns a
curriculum code which will always start with 9." So the platform records what
the official document says and never computes a code. A code beginning with 9 is
a fact worth surfacing, not a rule to enforce.

**A part qualification's modules live in the parent's curriculum document.**
Confirmed 9 September, and it is what the byte-identical files already proved.
