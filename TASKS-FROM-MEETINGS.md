# What the LMS must do, and what is left — full review, 10 September 2026

A review of the whole picture, asked for by Roland on 10 September before more
is built: the design document, all eleven meeting records from 10 August to
9 September, the consolidated requirements register of 31 August, the fourteen
Standard Operating Procedures, and the running platform checked module by
module.

Supersedes the earlier task list. Where something exists it says so, and where
something exists **but cannot be reached from a screen** it says that too,
because those are not the same thing and only one of them is a feature.

---

## First, a correction: workbooks are built

Roland flagged this and he was right to. In the previous version of this list I
said a formative workbook "is a different shape and does not have that path".
**That was wrong.** Checked properly:

| Asked for | State |
|---|---|
| Workbooks completed in the platform, not emailed | **Built.** `parseWorkbook` reads a Word workbook into an onscreen paper; a person confirms what was read before anything is committed. |
| Multiple choice, matching, true/false, true/false with justification, short answer, essay, scenario, oral | **All built.** `item_type` carries eleven types; `paper_mode` carries `oral`. |
| Rubrics attached to assessments | **Built.** `rubricId` on an item, chosen levels recorded per dimension. |
| More than one version of a summative held at once | **Built.** `attempt_policy` of `fixed`, `rotate` or `random`, so a re-sit draws V2. |
| Uploaded documents parsed into questions | **Built,** with an AI extension only as fallback where the rule parser found nothing. |
| Learner does it on screen | **Built.** `/learn/[id]/assessment/[id]` and `/learn/[id]/paper/[id]`. |

So the decision minuted on 17 and 28 August has been honoured. Two things are
genuinely wrong, and both are small — see W1 and W2 below.

**Why I got it wrong:** I read the copy on the qualification screen, which says
workbooks "are written in Word and Excel, and stay that way", and treated it as
a statement of how the platform works. It is stale text I wrote before the
capture path existed. A sentence on a screen is not evidence of what the code
does, and I should have checked the code.

---

## The five decisions outstanding on 31 August — all now built

The register of 31 August listed five things minuted as decisions and not yet
built. Every one is now in:

| Decision | Meeting | State today |
|---|---|---|
| Statements of Results per study unit | 27 Aug | Built, with tests. |
| Accreditation number per qualification | 27 Aug | Built, falling back to the provider's and saying which was used. |
| Project tracker inside the platform | 27 Aug | Built. `/tracker`, with the cohort grid. |
| Workbooks become platform activities | 17, 28 Aug | Built. See above. |
| Digital competency badges | 28 Aug | Built. Design, assignment, issue and public verification. |

---

## Gaps found by this review

Ordered by how wrong they make the platform, not by size.

### W1 · Per-section facilitator comments — **done, 10 September**

The register asked for "per-section facilitator commenting, so feedback is
developmental and attached to the work it refers to" (28 August, Expected).
`commentOnSection` and `sectionComments` existed in `lib/marking.ts`, audited,
and were referenced from no screen at all.

**What the fix turned up is larger than the gap reported.** Wiring the write
side showed that the read side had nowhere to go either: a learner's assessment
screen showed "Scored 12 of 20" and nothing else, while the overall comment, the
criteria of concern and every section comment sat unread in the database.
Feedback that is written and never delivered is worse than none, because the
facilitator believes the learner has it.

Now:

- The marking screen groups questions under their section, with a comment box
  beneath the questions it refers to. Saved on its own, as each question is,
  because a facilitator writes these while reading.
- The learner's screen shows what came back: the marks, the overall comment,
  each section's comment under its own heading, and the criteria worth going
  back over, said as developmental rather than as a verdict.
- `sectionComments` is guarded the way `getFeedback` beside it always was. It
  had no ownership check, so any signed-in person could read any learner's
  feedback given a submission id. Being inside the tenant is not an access rule:
  every other learner in the cohort is inside the tenant too.

### W2 · The qualification screen's copy — **done, 10 September**

It said workbooks and marking memoranda "are written in Word and Excel, and stay
that way". True of handbooks and sign-off sheets, false of workbooks and
assessments, and contradicting a decision minuted twice. It now says what is
actually true: a workbook filed there is a record, and the one a learner works
on is read in under Capture and presented on screen.

### W3 · Tracker statuses — **done, 10 September**

Three of the client's own statuses had no counterpart:

- **Redo**, now distinct from Remediation. Remediation fixes what was wrong with
  the work in hand; a redo replaces it, and is derived from an authorised
  reassessment.
- **Transferred**, now distinct from Left. `cohortMembers` recorded only a date,
  so a learner who moved to another cohort and one who left the programme were
  the same row. A `departureReason` column tells them apart, which matters
  because the QCTO is told something different about each.
- **Absent first attempt**, which is the distinction the client actually
  records. An absence with no submission behind it is a missed first sitting;
  that is rescheduled, where a later absence is a pattern.

### W4 · "Logbook" is still the word on screen

The client's term is **workplace experience sign-off**, not logbook (27 August).

The *process* is right and better than the wording suggests: the learner logs,
the coach signs, the assessor verifies, and a database trigger stops a learner
being their own coach. Only the word is wrong, and it appears on the course
editor, the module form and the learner's evidence screen.

Worth doing properly rather than by find-and-replace: the terminology feature
built for task 1 is the right home for it, and "logbook" is not in the
renameable registry. Another tenant may well call it a logbook.

**Size:** small. **Do it with the task 1 string sweep.**

### W5 · Learner demographics are incomplete — blocks the LEISA

Twelve of roughly forty-three fields the statutory return needs. Covered in
full as task 7 below.

### W6 · Non-credit-bearing certificates have no route

Raised in the SOP: they follow a separate route, currently prepared externally
on three days' notice. Nothing in the platform distinguishes them.

**Size:** small. **Priority:** confirm it is still wanted before building.

### W7 · Course versioning is built but its promise is not kept

`createNewVersion` exists and is reachable. The design document says publishing
a new version "does flag anyone still mid-course, or anyone whose role requires
refresher training, to move to the current version". Nothing does that flagging.

**Size:** small. **Priority:** low until a tenant is running long enough to
re-version a course.

---

## Design-document items — decided 10 September 2026

Eight items sat in `Design/ROFT_LMS_Design.docx` that had never come up in
eleven meetings with Curiosa and had never been explicitly dropped. Roland
decided them on 10 September. **Recorded so they are not re-litigated every time
somebody reads the design document.** Heidi to flag any she disagrees with.

| Item | Decision | Reasoning |
|---|---|---|
| Single sign-on (SAML / OAuth) | **Out for now** | For corporate tenants with an IT department. Curiosa's learners are individuals, not one company's staff. It is an authentication adapter and can be added later without disturbing anything. |
| HRIS connection for automatic enrolment | **Out** | Built for internal training departments. Curiosa sells training to clients. |
| Metrics API for a client's own BI tooling | **Out for now** | Spreadsheet and PDF exports already exist. Revisit if a corporate tenant asks. |
| SCORM / cmi5 import | **Out, but keep visible** | Curiosa authors its own material. Most likely of these to come up in a sales conversation with a tenant that already holds a content library — so it should be quoted for, not assumed. |
| Course-level discussion threads | **Out** | Curiosa's model is facilitator-led live sessions; discussion happens there. |
| O\*NET / ESCO benchmarking | **Out** | Reads as ROFT advisory work rather than LMS work. The design already calls it optional configuration. |
| **Offline use for field learners** | **IN — and urgent** | See task 10. The ranger programme client was the catalyst for building the LMS now, and ROFT cannot respond to them until the platform can serve them. |
| Interface in Zulu and other local languages | **Deferred, not dropped** | A genuine differentiator in this market. The terminology work makes the mechanism cheaper, though this is every sentence rather than only the nouns. |

**Also closed:** the design's open question of *course against programme*. The
client uses "programme" for everything and found the distinction artificial.
Configurable labels were named as the smaller change, and that is what task 1
built.

## The rule that governs how all of this gets built

**`Design/` is reference material — specifications and worked examples of
functionality to build. It is not a data source and it is not a layout to
copy.**

The platform serves many providers. A template in `Design/Templates/` shows
*that* the platform must produce a document and roughly what it must carry; it
does not fix how every tenant's version looks. **Users must be able to create or
upload their own templates, and the platform must use theirs.**

The one exception is a form a regulator mandates. A QCTO submission goes in the
QCTO's format because the QCTO says so — Roland, 9 September: the LMS "will
store these records and export them in the exact template format when required
for QCTO submissions". That is prescribed from outside, not the platform
imposing taste on a tenant.

---

## Tasks

### 1 · Flexible terminology, per tenant — **done**

Ten renameable terms, tenant overrides, one helper every screen reads its nouns
through, a Settings screen. Built on the split in `lib/dictionary.ts`: a term a
regulator defines cannot be renamed, because a tenant who renamed
"qualification" would have changed the wording on their own QCTO submission.

**Outstanding:** the string sweep — not every sentence reads through the helper
yet. Add "workplace experience sign-off" to the registry while doing it (W4).

### 2 · Part qualifications — **done**

`kind`, a parent link, and a module selection so a part draws a subset of the
parent's curriculum rather than copying it. Readiness, criterion coverage, EISA
readiness and every module count run over the subset. The importer reads kind,
parent and module list out of the SAQA document.

Confirmed by Heidi on 9 September: parts "do not have their own separate
curriculum documents; instead, their modules are specified within the curriculum
document of the full qualification."

**Outstanding:** a screen to change a qualification's kind or parent after
creation.

### 3 · Occupational skills programmes — **mostly done**

Covered by the `kind` work, including one that stands alone with no parent.

**Outstanding: FISA.** Provider-set and provider-moderated rather than set by an
assessment quality partner, with its own instrument structure, confidentiality
agreements and pre-moderator reports. Templates are in `Design/Templates/`. Its
own body of work.

### 4 · Statutory notification, the LEISA export, and late joiners

The clock runs from the **induction date** — Heidi, 9 September. 21 working days
for a full or part qualification, 5 for a skills programme.

**Late joiners, new on 9 September.** A learner joining after the cohort starts
needs their own induction, their own enrolment form, and their **own LEISA**
submitted alongside the cohort's. So the induction date is not always the
cohort's session and the deadline is per learner.

**What exists:** working-day arithmetic; `induction` as a session kind; the
rollout schedule; enforced enrolment documents. No deadline, no export, no
late-joiner path, no acknowledgement record.

**To build:** a due date per enrolment from that learner's induction; a view of
what is approaching and overdue; a LEISA export in the QCTO's workbook shape
with the right recipient for the kind; a separate LEISA for a late joiner;
record the acknowledgement.

**The export has awkward mechanics Heidi flagged specifically:** pre-formatted
cells, a leading apostrophe to preserve leading zeros, strict two-digit codes
(`01`, `02`). An export writing `1` where the sheet wants `'01` is rejected.
References: `Design/Templates/data-loading-specification-document.pdf` and
`STATSSA_AreaCodes.xls`.

**Depends on task 7. Size:** large.

### 5 · Check the platform against the enrolment SOP end to end

Reviewing a document is not the same as checking the platform matches it. The
SOP has specifics the platform may or may not enforce — an ID with multiple
certification dates is unacceptable, an illegible one is unacceptable, forms are
QA'd before capture, details go into both the LMS *and* the Tracker.

Confirmed 9 September: enrolment starts after invoicing and proof of payment;
cohorts run at 5–10 learners minimum.

**Size:** small.

### 6 · CAT and RPL: the three-year rule — **done, 10 September**

Heidi's answer corrects an assumption already built on:

> "Learners only complete modules required for their current enrolment. If a
> learner previously completed an identical module elsewhere, **Credit
> Accumulation and Transfer** is applied for completions within the last three
> years, while **Recognition of Prior Learning** applies for courses completed
> more than three years ago."

Completion does not travel silently between enrolments. There is one module in
the curriculum, but a learner's achievement of it is transferred by a person, on
the record, and a date decides the route.

**What exists:** both routes, well built. `recordCreditTransfer` grants a CAT
exemption with a written mapping, an approver and an audit trail; RPL has
application, advisory, judgement and moderation. `creditTransfers.awardedOn`
records when the source was awarded.

**What was missing, and is now in:** `withinCreditTransferWindow` compares the
date the source was awarded against the date the transfer is approved, not
against today, so a decision made in March is judged as it stood in March
however long afterwards it is read back. A transfer of anything older is
**refused**, not warned about: a warning leaves the wrong route recorded and the
exemption granted, and nobody reads a warning twice. The refusal names RPL and
says what it is, so nobody is left stuck.

`learnerExemptions` now carries the date the source was awarded, so a moderator
can see the arithmetic rather than trust it.

### 7 · The enrolment form, on the platform — **new, 9 September**

> "The LMS should automate the enrolment form process so learners complete
> fields directly on the platform, inheriting cohort details like induction
> dates automatically."

**Held today:** national ID, date of birth, gender, equity code, disability
code, names, email, OFO code.

**Not held, and needed:** middle name, title, nationality code, home language
code, citizen/resident status, socio-economic status, disability rating,
immigrant status, home address (three lines and postcode), postal address (three
lines and postcode), phone, cell, fax, province code, STATSSA area code, POPIA
agreement and its date, expected completion date, assessment centre code, FLC
and its statement number.

**To build:** the fields and their two code lists; a learner-facing form that
inherits everything the cohort already knows; POPIA consent with its date; and
the completed form as a document the platform produces and files, since Heidi
named it as evidence a QCTO monitor asks for.

**Size:** large. Task 4 depends on it.

### 8 · Workbook and assessment finishing — **done, 10 September**

Not the rebuild the previous version of this list implied. W1, W2 and W3 above
are all in, and W1 turned out to be twice the size reported: the learner had no
screen for reading a marked workbook back at all.

### 9 · Tenant document templates — **done, 10 September**

The platform must produce documents, and a tenant must be able to supply the
template it uses. Roland: "the templates cannot be prescriptive of exactly how a
document must look."

**The design, and it is the whole of it.** A document has two halves. The
**template** is the tenant's: their letterhead, their wording, the fields they
place and the order they place them in. The **statutory block** is the
platform's: rendered after the template from `STATUTORY_BLOCKS`, and never
handed to a tenant to edit. A provider may restyle a Statement of Results; they
cannot drop the sentence saying it is not an Occupational Certificate, because
that sentence is the QCTO's and the person it protects is a learner standing at
an assessment centre.

Not editable-but-guarded. **Not editable at all**, because a tenant cannot
delete what they were never given.

**Built:**

- `document_templates`, versioned. A new version supersedes rather than
  overwrites, because a document already issued was rendered from the template
  as it stood and somebody asking a year later needs that version. One active
  per kind per tenant, enforced by a partial unique index so drafts and old
  versions can accumulate without deleting anything.
- `lib/document-fields.ts` — pure, no database, so the browser form can import
  the field list without dragging the Postgres driver into the bundle. Every
  field carries a real example, because "what does `qualification.nqfLevel`
  actually look like" is the first question anybody has.
- `lib/document-templates.ts` — save, activate, revert, resolve, fill. An
  unknown placeholder is **refused on save**: it would render as nothing, and a
  blank space on a learner's certificate is not a failure anybody notices until
  it is in their hand.
- Settings → Your own documents. Shows the fields that can be placed **and the
  sentences the platform adds anyway**, so a provider does not write their own
  copy of them and end up saying everything twice.
- The Statement of Results renders through it. With a template the platform's
  layout, its confirmation wording and its signature block all step aside; two
  signature blocks on one page is worse than none.

Verified in a browser end to end: platform layout → save a template → the
statement changes to the provider's layout with fields merged and no
placeholders left → the statutory sentence still there → revert → platform
layout back.

**All three documents now read through it.** The Statement of Results, the
certificate and the Statement of Work Experience. Each keeps what is not the
provider's: the statement keeps its statutory block and its verification
reference, the certificate keeps the sentence saying it is not a national
qualification, and the workplace statement keeps the attestation and the
signature hash that makes the coach's sign-off checkable.

**Starter templates.** A provider with no template of their own opens the
platform's own wording, already laid out, rather than an empty box. An empty
textarea beside a list of forty field names is a worse invitation than it looks:
the first thing anybody does is guess at a layout, and the second is discover
they left out the reference. Tested so that every starter saves without
complaint, carries the reference, and does not repeat the statutory sentences -
a starter that did would teach every provider to duplicate them.

**A correction found while wiring the other two.** The field list offered
`qualification.saqaId`, `curriculumCode` and a credit total on a *certificate*,
and a certificate holds none of those - it is the provider's own award, and a
qualification certificate comes from the QCTO. That was exactly the fault the
platform refuses a tenant for: a field that renders blank on a printed document
and is noticed by the person holding it. Each document now offers only what it
actually carries.

**The letterhead, which was the real reason to want Word.** A template is plain
text and cannot hold an image, so the certificate renders the tenant's own logo
above it from their branding. The provider's legal name, address and
accreditation number are fields, read from the organisation rather than from the
cached tenant identity - that cache carries what a browser needs, and a legal
address is not it.

**Decided 10 September: no `.docx` upload.** Writing the template in the
platform is the answer, and it is the stronger one. Filling a Word file needs a
templating library, and a `.docx` has no dependable "after the end" to put the
statutory block into - so the protected core would weaken from "a tenant never
touches it" to "your file must contain this text, checked on save", which a
determined person defeats and which fails in a way nobody sees until a document
is issued.

The pressure for Word will come from a tenant wanting **their letterhead**
rather than from needing Word itself, and that is better answered by letting
them place their own logo and address on the document than by handing over the
whole file.

### 10 · Offline use for field learners — **new, decided 10 September, urgent**

The ranger programme client was the catalyst for building the LMS now, and ROFT
cannot respond to them until the platform can serve them. This is the one item
on the list with a client waiting behind it.

**The constraint Roland set, and it shapes everything below:** the platform
works as it is and must not change. Offline is *additional functionality for
tenants that need it* — off by default, invisible to every tenant that does not
turn it on, and adding nothing to the path an online learner already takes.

#### Answered by Heidi, 10 September

| Question | Answer | What it changes |
|---|---|---|
| Android or Apple? | **Android** | Removes the biggest risk. Chrome on Android does not evict an installed site's storage the way iOS Safari does, and storage can be marked persistent. **No native app is needed.** |
| How long between connections? | **A fortnight** | Sizes the problem: a fortnight of material held, and a fortnight of evidence queued. |
| QCTO-accredited? | **Not yet, but they want it to be. Cater for both.** | The one that changes the design. See below. |
| Reading or evidence capture? | **Both** | Photographs are what fill a phone. Compression on the device before it is stored, and a visible size budget. |

#### What works offline depends on whether the programme is accredited

"Cater for both" is not a request for two builds. It is a request for the scope
to be a **property of the programme**, because the same platform has to serve a
ranger programme that is not accredited today and the same programme once it is.

| | Not accredited | Accredited |
|---|---|---|
| Reading study material | Yes | Yes |
| The rollout schedule and what is due | Yes | Yes |
| Workbook answers, formative | Yes | Yes |
| Workplace evidence: photographs, notes, sign-off entries | Yes | Yes |
| **Summative assessment** | **Provider's own rules, so yes if they want it** | **No.** Facilitator-led sessions are compulsory and summatives are invigilated. One taken unsupervised on a phone over a fortnight is not defensible at a monitoring visit. |
| Marking, moderation, anything needing a second person | No | No |

Three things follow, and the third is the one that will bite:

1. **The strict shape is the default.** A programme is treated as accredited
   unless somebody says otherwise. Getting that the wrong way round means the
   permissive setting arrives by accident.
2. **Relaxing it is a deliberate, recorded act**, with the same audit trail as
   any other decision that would be asked about later.
3. **Accreditation arrives partway through.** A programme that allows offline
   summatives today may be accredited next year, and work already done under the
   looser rule does not retrospectively become defensible. When the switch is
   flipped, the platform should say plainly what was captured under the old rule
   and how much of it there is - so somebody can decide what to do about it
   rather than discover it at a visit. Whether that work needs re-assessing is
   Heidi's call, not the platform's, but the platform must be able to show her
   the list.

#### How I would build it

**Decided 10 September: an installable web app, switched on per tenant.** Not a
separate mobile app. Roland approved the approach; the work itself is still
queued behind task 7.

- **No app store, no second codebase.** The learner opens the same site and
  installs it to their home screen. A separate React Native app would double the
  code and the maintenance for a capability one tenant needs.
- **Gated by a tenant flag.** The service worker is registered only for a tenant
  with offline enabled. Nothing is cached, nothing is queued, and no behaviour
  differs for anybody else — which is the constraint Roland set.
- **A deliberate download, not a silent cache.** Before going out, the learner
  taps "make this available offline" for their current study unit. They can see
  what is held and how much room it takes. Silent caching of everything is how a
  phone fills up and a learner loses trust in it.
- **Work queues locally and uploads on reconnect.** Answers and evidence sit in
  the browser's own database until there is a signal.

#### The three things that will actually go wrong

1. **The device clock cannot be trusted.** Evidence captured offline claims a
   date, and a phone's clock can be wrong or set deliberately. So the server
   records **both** — when the device says it was captured and when the server
   received it — and shows both wherever the date matters. Never one silently
   standing in for the other.
2. **The same learner on two devices, or a change made while they were away.**
   Last-write-wins is wrong for assessment evidence: it discards somebody's work
   without telling anyone. An offline submission arriving for something already
   submitted is **held for a person to resolve**, not merged.
3. **Storage, which is now a sizing problem rather than a survival one.**
   Android was the answer, so the fortnight-long eviction risk that could have
   forced a native app is off the table: an installed site can ask for
   persistent storage and keep it. What remains is capacity. Heidi says the work
   is both reading and evidence capture, and photographs are what fill a phone -
   so images are compressed on the device before they are stored, the learner
   can see what is held and how much room it takes, and the platform refuses to
   start a download it cannot finish rather than filling the phone and failing
   halfway.

#### Still open

**Answered 10 September: Curiosa does not want offline summatives on the
unaccredited ranger programme.** Roland: "It is (might be) purely a Tenant
client need." So the permissive setting exists for a tenant that asks for it and
is never turned on for Curiosa - which is the right way round, and is what the
default already does. Nothing changes in the design; the case is now known to be
hypothetical rather than imminent, so it should cost nothing extra to carry.
- **The spike is on hold at Roland's request** (10 September) while he
  considers the offline question further. **Nothing here has been started, and
  no offline code exists.**

**Size:** large, and it should be scoped and priced on its own rather than
absorbed. But it is additive, and none of it touches what is already working.

---

## Not tasks, recorded so they are not mistaken for omissions

- **Design restraint.** Heidi praised the clean layout and colour scheme and
  said she does not want cluttered or gaudy design. Standing constraint.
- **No QCTO or SAQA logo, anywhere, ever.** Heidi, 9 September, raised
  pre-emptively as a regulatory prohibition. Checked: none exists. Naming a
  regulator in text is different and stays — the platform has to be able to say
  a certificate comes from the QCTO.
- **Folder organisation.** Agreed 9 September and done by Heidi. Not platform
  work.
- **The management session.** Value chain and statutory process for skills
  programmes, deferred by agreement to its own meeting.
- **Badges are a retention measure, not decoration.** Certification delays have
  measurably hurt learner retention; that is why they were agreed.

---

## Carried over

- **Outbound mail refuses the login** (`535`). Awaiting Linda.
- **The `tools` container cannot resolve DNS.** Harmless today; breaks off-site
  backups.
- **Off-site storage for backups.** Outstanding.
- **The Commercial Cleaner curriculum imports thin.** Modules and topics land;
  topic content and internal assessment criteria do not. Same shape as the
  `Cr 6` credits gap — one house style the reader does not know.

---

## Settled, worth keeping in view

**Enrolment is per programme ID.** Each full qualification, part qualification
and skills programme has its own number, and enrolment is per programme ID per
learner. A part is enrolled onto directly; the full qualification is not
involved.

**The clock starts at induction**, not at enrolment or proof of payment. The
QCTO uses the enrolment form and rollout schedule as evidence of it.

**Codes are assigned, never derived.** Mostly from the OFO; where no occupation
matches, the QCTO assigns one beginning with 9. The platform records what the
document says and never computes a code.

**The provider issues Statements of Results only.** Qualification certificates
come from the QCTO and the platform must not imply otherwise.

**Facilitator-led sessions are compulsory** for credit-bearing programmes. The
platform must not imply self-study alone is sufficient.
