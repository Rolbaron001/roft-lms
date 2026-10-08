# Notes for the user manual

**Roland, 2 October 2026:** "As you are building, there are things that have
to be in place for the LMS to function correctly, for example file naming
conventions, clearly labelling document content, etc. I want you to record
these so that you can build a comprehensive manual once the LMS is complete."

This is that record. It is added to whenever something is built that depends
on how a provider prepares their material, names their files or sets up the
platform. It is written for a provider, not for a developer: what to do, and
what happens if it is not done. When the LMS is complete, the manual is
written from this.

Each entry says **what is needed**, **why the platform needs it**, and **what
happens without it**. Where a provider can change a rule, it says where.

---

## 1. Loading a qualification from a folder

### 1.1 What the folder should contain

- **Needed:** the qualification's own three documents: the SAQA qualification
  document, the QCTO curriculum document and the assessment specification.
  Then the provider's material: an alignment document naming the study units,
  the alignment matrix, theory guides, workbooks, summative assessments and
  their answer guides, and workplace documents.
- **Why:** the curriculum document is the authority for every module, topic
  and assessment criterion; the qualification document gives the exit level
  outcomes; the assessment specification says how the external assessment
  is run. Everything else is checked against these.
- **Without it:** a folder with no curriculum document cannot build a
  qualification. Missing documents are listed on the qualification page.

### 1.2 A folder that describes itself (optional, fastest)

- **Needed:** a file `_control/blueprint.json` in the folder, as a programme
  development system writes it.
- **Why:** it states the structure exactly, so nothing is worked out from the
  documents.
- **Without it:** the structure is read from the documents. For a folder
  that does not include one, working out the structure needs the person's
  AI extension switched on.

### 1.3 Documents the platform can read

- **Needed:** Word files as `.docx` and Excel files as `.xlsx` (not the older
  `.doc` or `.xls`); PDFs that are digital, not scans; nothing
  password-protected.
- **Without it:** the file is stored and can be downloaded, but nothing is
  read from it. A scan is reported as a scan; an old Word file is reported
  with how to resave it.

### 1.4 The alignment document

- **Needed:** each study unit named with its code (`SU1`, `SU2`), its exit
  level outcome, and the curriculum modules it covers listed by code
  (`KM-01`, `PM-03`, or the curriculum's full identifier).
- **Why:** this is what places each module under its study unit.
- **Uploading it again** is safe: study units are updated, not duplicated,
  and modules already placed are reported as already there.
- **Without module codes:** the study units are created with nothing under
  them, and the platform says the document names no module codes.

## 2. Naming files

### 2.1 The naming convention

- **Needed:** every workbook, summative assessment, answer guide and
  workplace document named to one pattern. The default is
  `{provider} {qualification} {studyUnit} {artefact}{number} [{memo}]`, for
  example `CA 121151 SU1 WB1.docx` and its answer guide
  `CA 121151 SU1 WB1 AG.docx`.
- **Artefact codes (default):** `WB` workbook, `SA` summative assessment,
  `WEM` workplace sign-off. **Answer guide marker (default):** `AG`.
- **Where to change it:** Settings, Naming convention. A provider can set its
  own pattern, codes and marker; the settings page shows how a filename would
  be read.
- **Why:** the filename is how the platform knows which study unit a document
  belongs to, what it is, which number it is, and which answer guide goes
  with which paper.
- **Without it:** documents can still be filed by hand, but a paper is not
  paired with its guide and is not captured automatically.

### 2.2 Versions

- **Needed:** alternative versions of the same paper marked `V1`, `V2` in the
  filename, with each guide carrying the same version:
  `CA 121151 SU5 SA5 V2.docx` with `CA 121151 SU5 SA5 V2 AG.docx`. A guide
  with no version serves every version of that paper.
- **Why:** versions of one summative become papers of one assessment, used in
  turn for re-sits; each must be marked against its own guide.
- **Without it:** a version can be read against another version's guide.

### 2.3 The guide must be the guide

- **Needed:** the paper and its guide not given each other's names, and the
  learner's paper not carrying the memorandum at the end.
- **Without it:** the platform says so when it reads them (a paper that reads
  like a guide, or a learner's copy that contains the answers), and a learner
  given such a file has the answers.

## 3. Labelling the content of workbooks and assessments

These are what let a paper be captured and linked to the curriculum without a
person going through it question by question.

### 3.1 Section headings

- **Needed:** each part of a paper headed on its own line in one of these
  forms: `Activity 1.1: ...`, `SECTION A: ...`, `SECTION 1: ...`,
  `PART A: ...`, `PART A1: ...`.
- **Without it:** no sections are recognised and the paper cannot be
  captured until a person adds them.

### 3.2 Which module or topic a part covers

- **Needed:** the module or topic named in the heading or instruction of each
  part, for example `Activity 2.1: Multiple Choice Questions (KM0103 &
  KM0104)`, `SECTION 1: KNOWLEDGE MODULE 05 (KM-05)`, or
  `Practical Skill: PM0501`.
- **Why:** a criterion code such as `IAC0301` exists in more than one module
  of the same study unit. The heading says which module is meant
  (added 2 October 2026, lib/criterion-resolve.ts).
- **Without it:** where a code could mean more than one criterion, the
  question is linked to none, and the verification checklist says so.

### 3.3 Assessment criterion codes

- **Needed:** each question, or its row in the guide, naming the criteria it
  assesses, written as `IAC` plus the topic number and the criterion's place
  in that topic: `IAC0301` is topic 03, criterion 1. The curriculum's own
  full codes are also understood.
- **Why:** the link from question to criterion is what proves every criterion
  is assessed, what the assessor judges, and what a moderator samples.
- **Without it:** the study unit cannot be published, because criteria show
  as not assessed.

### 3.4 Questions and options

- **Needed:** questions numbered `1.`, `2.` (or `Q1.`), and the options of a
  multiple-choice question lettered with capitals on their own lines: `A. ...`
  or `A) ...` (a tick box in front is fine). True-or-false statements end in
  `[True / False]`.
- **Without it:** a multiple-choice question is read as a written answer,
  with no options for the learner to pick from.

### 3.5 Marks and answers

- **Needed:** marks printed on each question, task or section (for example
  `[5 Marks]`, or "Each question carries 1 mark" in the instruction), and the
  guide giving the correct option for every multiple-choice and true-or-false
  question, in a table of question numbers.
- **Without it:** a paper whose marks do not add up is captured but cannot be
  answered by learners until fixed; a multiple-choice question with no
  correct answer stops that paper being captured automatically, and it waits
  for a person.

## 4. Verifying and making a qualification live

- **What happens:** once a folder is read, the platform builds each study
  unit itself: its course, its captured papers and its steps, in order (theory
  guides; each workbook after the previous is handed in; the summative after
  every workbook is marked; workplace modules throughout). Everything stays
  in draft.
- **What the provider does:** opens the qualification's verification page,
  looks at anything listed to check, and presses **Verified, make it live**
  once. That is refused while any regulatory check fails, and the page says
  what is missing and links to it.
- **Build again** is on the qualification page, on each study unit's page
  and on the check page. It fills anything missing, and reads afresh any
  paper that is still a draft, has not been worked on by hand, has not been
  sat by anybody, and fails a check or has a question linked to no
  criterion. A paper somebody has sat or edited is never replaced.
- **Answer guides:** each written question or task should be headed in the
  guide as it is on the paper, `Question 1.3.1: … (10 Marks) [IAC0101]` or
  `Task A: … [IAC0304]`, with its model answer underneath. The model answer
  becomes the assessor's marking guidance and the bracketed codes link the
  question to its criteria. A written question with no model answer cannot
  be opened to learners.
- **Every study unit with knowledge or practical modules needs its papers in
  the folder.** The alignment matrix saying a criterion is assessed is not
  enough on its own: a unit with no workbook or assessment is held back, so
  that nobody can finish it without being assessed. A unit made only of
  workplace modules is signed off at work and needs no papers.

## 4a. What a learner sees, and when (5 October 2026)

- **The study unit page** shows what the unit is about (its exit level
  outcome), what the learner will learn (the topics of its knowledge
  modules) and its modules, all taken from the curriculum the platform
  already holds. Then the theory guide, read in the page and downloadable;
  then the unit's learning material; then its workbooks and assessments.
- **The theory guide** is filed against the study unit with the kind
  "Theory guide". A PDF is shown a page at a time. A Word guide is shown a
  section at a time, split at its own headings, so it needs proper Word
  heading styles (Heading 1 for chapters, Heading 2 and 3 for modules and
  topics). A guide typed in plain bold text has no sections to jump to.
- **Workbook front page:** every workbook must state on its front page the
  study unit it belongs to and the topics it covers (for example "SU1 WB2:
  KM0103 and KM0104"). Heidi, 5 October 2026.
- **Release through the cohort.** On a study unit whose course has
  cohorts, a learner not yet in a cohort sees the introduction and an
  outline only. In a cohort, each item opens on its date in the cohort's
  schedule, or when the facilitator presses **Release now** on the cohort's
  page, and not before. A row left empty in the schedule is not released.
  A course that nobody walks in a cohort is not held back.
- **Two kinds of cohort, two ways of releasing** (Roland, 5 October 2026).
  A cohort works through either one course or study unit, or a **whole
  qualification**: every study unit on one schedule, its members enrolled
  on each study unit that is live and on each one as it is made live. Each
  cohort releases either **on the schedule** (dates, or Release now) or
  **everything open**, for learners who study independently; they still
  take the steps in order (a workbook after the one before is handed in).
- **Learning material** (videos, diagrams, recordings, slides, documents)
  is added under Learning, Learning material, or from the study unit's own
  page. Each item is kept once and can be added to several study units,
  each time "released with" one of that unit's steps, so it reaches a cohort
  together with that step. Video: MP4 or WebM, up to 500 MB. Learners can
  download everything to use without a signal.
- **Criterion coverage is shown, not enforced** for a study unit. A
  workbook's activities may cover criteria as a whole, and the platform
  takes workbooks as they are.

## 4b. Checking what each person sees (5 October 2026)

- **See it as a learner** (on a qualification) shows the learner's own
  pages for every study unit, with everything unlocked and nothing recorded,
  so an administrator can check the guide, the material and the workbooks
  are all in place before going live.
- **See the platform as a person** (on any person's page under People) is
  for the provider's administrator: the whole platform exactly as that
  learner, assessor, facilitator or moderator sees it, with their menu,
  home page, queues and records. A banner says whose view it is. Nothing
  can be changed while viewing; press **Stop viewing** to return. Each use
  is recorded in the audit log. To check a role, choose one person who
  holds it.

## 5. Languages

- English is the platform's main language. The other languages are machine
  translations, offered to help people who find English difficult, and have
  not been checked by a translator. Where the meaning matters, the English is
  what counts. This is said wherever a language is chosen.
- A provider's own names for things (Settings, Terminology) are kept as they
  wrote them in every language.

## 6. Course packages from authoring tools

- **Needed:** a SCORM 1.2 or SCORM 2004 package, exported as a `.zip` with
  `imsmanifest.xml` at its root, from a source the provider trusts (its
  scripts run with the learner's access).
- **Not accepted:** cmi5 packages.
- **Pass mark and completion:** where a SCORM 2004 package sets a pass mark or
  completion threshold in its manifest, the platform decides passed and
  complete from what the package reports.

## 6a. Reading a cohort's roll-out schedule (7 October 2026)

- **Needed:** an Excel sheet with a header row holding **Dates**, and **WB
  Handout** and **WB Submission** columns (other headings are found by
  their words: Lectures, Alignment With Curriculum Modules, WB Feedback,
  Moderation). A row per lecture date.
- **How things are named:** workbooks as `SU1 WB2` in the hand-out and
  submission columns; a study unit's start as `Study Unit 2` in the
  alignment column; a summative as `SU 2 Supervised Summative Assessment`
  in the alignment column, with its sitting written as `SA2 assessment 10
  Feb - 12 Feb` in the moderation column. Times as `09:00 to 15:00`.
- **What happens:** on the cohort's page, Read the roll-out schedule, check
  what was read, then save. Each workbook opens on its hand-out date and is
  due on its submission date; the theory guide and workplace module open on
  the unit's start; the summative opens and is due on its sitting days; a
  second version of a summative (the re-sit) is left to be released by hand.
  Every dated row becomes a class session. Feedback dates are read but not
  yet used.

## 6b. Planning a cohort on the platform (7 October 2026)

- **Where:** a cohort's page, Plan the cohort. The plan shows week by week
  under each study unit; beside it, what learners see on any chosen day.
- **Plan it for me** drafts a plan from the qualification itself. Each study
  unit starts on a lecture day; its theory guide, material and workplace
  module open then; one workbook a week is handed out and handed in the
  week after; the summative is sat the week after the last workbook is in
  and closes two days later; the next study unit starts the week after.
  Lecture days are the cohort's class sessions where it has them,
  otherwise the cohort's start weekday. A re-sit paper is never dated.
  Running it again replaces the dates; anything released by hand stays
  released.
- **What it depends on:** workbooks recognised as `WB1`, `WB2` and so on in
  their titles, so their order is the hand-out order; a second version of a
  summative marked `V2` in its title, so it is treated as the re-sit.
- **Changing one thing:** click any item to change its dates or release it
  now. The change shows in its new week at once. Clearing both dates puts
  it back to waiting for a hand release.

## 6d. How dates are written (8 October 2026)

- **Where:** Settings, Dates. An administrator chooses one style for the
  whole provider: day, month in words, year (8 October 2026, the
  default); day/month/year (08/10/2026); year-month-day (2026-10-08); or
  each person's own computer settings.
- **"Own computer settings"** uses the regional setting each person's
  browser reports, which normally follows their Windows or Mac settings, so
  two people may see the same date written differently.
- **Not affected:** documents whose form a regulator prescribes (the
  Statement of Results, the Statement of Work Experience, the FISA
  agreement, the enrolment form document) and certificates, which are
  written in the holder's language. Messages the platform writes in English
  and translates afterwards use the default style.
- **Times** are always the 24-hour clock, on the provider's own clock
  (Settings, Clock).

## 6e. Typing dates (8 October 2026)

- Every date box takes the date in the provider's order: 28/10/2026,
  28-10-2026, 28 October 2026 or 28 Oct 2026, never year first unless the
  provider's style is year-month-day. The stored form (2026-10-28) is always
  understood. A calendar button beside each box picks a date instead.
- Under "each person's own computer settings", a reader whose computer writes
  dates month first types them month first.

## 6f. Class sessions date the workbooks (8 October 2026)

- Each class session can name its study unit, the workbook handed out and
  the workbook handed in (or, for a summative sitting, the summative sat).
- Saving the session dates those items for the cohort: a workbook handed out
  opens on the session's date, one handed in is due on it, and a summative
  opens on the day it is sat. The planner and the release list show the same
  dates; nothing needs to be dated twice.
- The meeting link is taken as pasted, with or without https://.
- Lectures are numbered in order, and the next number is suggested.

## 6g. The LEISA on the cohort (8 October 2026)

- On the cohort page, for staff who make statutory returns. It lists, per
  learner, what the QCTO's LEISA workbook still lacks, each name linking to
  that learner's enrolment form, and counts the deadline from the induction
  session: 21 working days for a full or part qualification, 5 for a skills
  programme.
- **What it depends on:** the induction scheduled as a class session of the
  kind Induction; each learner's enrolment form completed; the provider's
  accreditation number in Settings; the qualification's SAQA ID.
- Drafting there covers every learner not yet notified. The workbook is then
  downloaded, uploaded to the QCTO and recorded as sent on the enrolment
  notification page.
- **Your own target:** Settings, "LEISA target", takes a number of hours after
  the induction (Curiosa use 48). Each cohort's LEISA then shows that date
  above the regulator's limit, in red once it has passed. Left empty, only the
  limit is shown.

## 6h. The cohort file (8 October 2026)

- **Where:** "Cohort file" at the top of each cohort page. One section per
  folder of a provider's cohort file, in this order: Qualification Docs,
  Learning Material, LEISA, Induction, Learner Docs, Attendance Records,
  Facilitation Plans, Learner Evidence, Assessor Reports, Programme Feedback
  Forms, WEM, M&E. Each says what the platform holds, what is missing, and
  links to where the work is done. Nothing is stored twice.
- **Download the cohort file** produces a zip laid out in those folders, for a
  monitor or an auditor: Learner Docs and Learner Evidence have one folder per
  learner, evidence arranged by study unit then learner.
- **Filing a document** that the platform does not produce itself: facilitation
  plans, the induction pack, a meeting's attendance export, an assessor's own
  report, programme feedback forms, monitoring reports, and correspondence
  with the QCTO. Choose the kind and, where it applies, the class session or
  study unit; the kind decides the folder.
- **Learner documents** now also take a signed code of conduct, proof of
  employment, a signed workplace agreement and correspondence (for example a
  letter about non-attendance), filed on the learner's enrolment documents.
- **Attendance from the meeting:** on a class session's register, "Read the
  attendance export from the meeting" takes the CSV or Excel file from Google
  Meet or its attendance add-on; another service's export is read if it has a
  name column (or first and last name columns). Learners are matched by email,
  or by every part of their name in any order. Those found are marked present,
  with the time each was in the call as the note, and everyone else absent;
  anybody in the file not matched is listed. Nothing is saved until the
  register is. **What it depends on:** the
  learners' names on the platform as they appear in the meeting, or their
  email addresses; a participant who joins under a nickname is listed as not
  matched.
- **Assessor reports** are produced, not typed: one per study unit, from the
  Assessor Reports section. Programme, SAQA ID, level and credits; the study
  unit, cohort and modules; the summative and its date; the assessor; each
  learner's workbooks returned, first and second summative results,
  attendance and the assessor's comments. Print it or save it as PDF.
  **What it depends on:** the summative set as a step of the study unit's
  course, and the assessor's comments written with the decision.
- **Work experience:** the cohort page shows each learner against each
  workplace module of the qualification, with the logbook's stage (being
  kept, with the coach, signed by the coach, accepted) and the hours recorded.
  It is read from the logbooks, so it needs the workplace modules loaded with
  the qualification and each learner's logbook opened under Workplace.
- **Archiving:** a cohort's archive carries the documents filed against the
  cohort, in a "Cohort file" folder. They leave the server only with the
  archive that takes the cohort's last learners; until then each archive holds
  a copy and the originals stay. Once archived, a filed document cannot be
  removed from the cohort file, since its record is what a restore puts it
  back against.

## 6i. The administrator's dashboard (8 October 2026)

- **Where:** the home page, for anyone who holds the administrator role. Their
  own learning, if they have any, follows beneath it.
- **Needs you today** counts what is waiting and opens where it is done:
  learners to notify on the LEISA, appeals to acknowledge, submissions to
  assess, class sessions held with no register, logbooks with workplace
  coaches, and decisions sampled for moderation. A tile appears only when there
  is something to do.
- **What it depends on:** a cohort's end date, for the week count and the bar
  showing how far through it is; the induction scheduled as a class session,
  for the LEISA dates; the LEISA target in Settings, for the provider's own
  date; registers taken at each session, for attendance and for spotting a
  learner absent twice running; the facilitator named on each class session.
- **Cohorts being set up** lists cohorts that have not started, with the next
  of the seven steps as a button. A cohort that has started with a step still
  missing (most often the payment) says so on its card under the running
  cohorts instead.

## 6j. Every role's dashboard (8 October 2026)

- **Everyone opens on a dashboard** built for what they do. A person with
  several roles sees one page: every role's counts in one row across the top,
  most urgent first, then each role's sections. An administrator's own
  dashboard comes first, with their other roles beneath it.
- **Everything is a link to the item itself**: a tile opens the one item when
  there is one, otherwise the list of them; each row opens the session, the
  submission, the logbook, the cohort or the learner it names. Where a role
  may not open the working page (a facilitator who does not assess, for
  instance), the link goes to where the work shows instead.
- **Facilitator:** sessions today and this week, registers not taken, their
  cohorts with attendance, workbooks waiting for feedback, learners held up or
  absent twice running, sittings and inductions coming up. **What it depends
  on:** the facilitator named on each class session; without that, every
  running cohort is shown.
- **Assessor:** summatives and workbooks waiting, oldest first; decisions a
  moderator referred back; reassessments; sittings in the next six weeks.
- **Moderator:** the moderation sample, FISA papers being written or with
  them, appeals on results, moderation packs ready to compile.
- **Learner:** to do now (a class today, work due within a week, feedback to
  read, forms to fill in, enrolment documents still needed), what is open now
  and when it is due, the next classes with the meeting link, results and
  feedback. Their qualification and courses follow beneath, as before.
- **Workplace coach:** logbooks waiting for their signature, the learners they
  supervise, logbooks signed recently, their workplace agreements.
- **Line manager:** the team's progress, capabilities resting on one person or
  no one, overdue courses. **What it depends on:** each team member's line
  manager recorded on their person record.
- **Skills development facilitator:** the LEISA per cohort (the provider's own
  target or the QCTO's limit), learners missing statutory details, learners
  with no induction date, the WSP and ATR, this year's numbers.
- **External verifier:** read only; the cohort files and each cohort's
  readiness for the external assessment, the qualifications offered, and the
  policies and documents library.
- **Platform owner:** every client organisation with its usage, any without an
  administrator, and totals across the platform.

## 6c. The steps of a cohort, and finding your way (8 October 2026)

- **The bar at the top of every cohort page** names the steps in order: Set
  up, Payment, Learners, Dates, Class sessions, Running it, Archive. Each is
  ticked from what the platform holds, never by hand, and the line beneath
  says what to do next, with a link to where it is done.
- **When a step counts as done:** Payment, when the cohort's payment is
  recorded, or when every learner on it has an accepted proof of payment of
  their own; Learners, when anybody is on it; Dates, when anything is dated
  or released (or the cohort has everything open); Class sessions, when any
  is scheduled; Running it and Archive, when the cohort's evidence archive
  has been checked.
- **How this works:** under most headings, a folded list of the steps that
  part of the page involves.
- **On this page:** long pages (a cohort, a person, a FISA instrument,
  readiness, records, enrolment notifications, a qualification) list their
  sections in a bar that stays at the top while scrolling.

## 7. Adding people from a spreadsheet

- **Needed:** columns for first name, last name and email address at least,
  with headings on the first row (a title above them is tolerated). The
  learners may be on any sheet of the workbook; the sheet whose headings
  name people is used. An identity number column may be headed `ID #`.
- **Email is required.** Everybody signs in with their email address, so a
  list without an Email column cannot create anyone; the platform says so.
- **Without it:** nobody can be created from that sheet; the platform says
  which column it could not find.
