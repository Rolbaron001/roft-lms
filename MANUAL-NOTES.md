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
- **Learning material** (videos, diagrams, recordings, slides, documents)
  is added under Learning, Learning material, or from the study unit's own
  page. Each item is kept once and can be added to several study units,
  each time "released with" one of that unit's steps, so it reaches a cohort
  together with that step. Video: MP4 or WebM, up to 500 MB. Learners can
  download everything to use without a signal.
- **Criterion coverage is shown, not enforced** for a study unit. A
  workbook's activities may cover criteria as a whole, and the platform
  takes workbooks as they are.

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

## 7. Adding people from a spreadsheet

- **Needed:** columns for first name, last name and email address at least,
  with headings on the first row (a title above them is tolerated).
- **Without it:** nobody can be created from that sheet; the platform says
  which column it could not find.
