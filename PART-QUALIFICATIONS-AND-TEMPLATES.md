# Part qualifications and the QCTO templates

From `Design/Part Qualifications/` and `Design/Templates/`, read 10 September
2026. Everything below was checked against the documents and against the
codebase, not inferred from the meeting notes.

---

## What the documents settle

### Part qualifications share one curriculum. Proved, not assumed.

The curriculum document and the external assessment specification in `118709/`,
`118710/` and `118711/` are **byte-identical** — same MD5. Only the SAQA
document differs.

That answers the question Heidi could not parse when I asked it badly. There is
one curriculum for Commercial Cleaner. A part qualification does not copy it and
does not get one of its own; it **selects a subset of its modules**.

### A part declares its own subset, in its own SAQA document

`SAQA 118710.pdf` carries a `QUALIFICATION RULES` section naming exactly the
modules it takes, each carrying the *parent's* curriculum prefix:

```
Knowledge Modules
811201-000-00-KM-01  Introduction to the World of Work, Level 1, 6 Credits.
811201-000-00-KM-04  Commercial Cleaning Equipment, Chemicals and Consumables, 5 Credits.
811201-000-00-KM-05  Basics of Cleaning Commercial Kitchenette, 5 Credits.
Total number of credits for Knowledge Modules: 16
… Practical 14 … Work Experience 17
```

16 + 14 + 17 = **47**, which is exactly the `MINIMUM CREDITS` the same document
states. The arithmetic closes, so the subset can be read and checked rather than
trusted.

### The kind is a field, not an inference

The SAQA document states it outright:

| | 118709 | 118710 |
|---|---|---|
| `QUALIFICATION TYPE` | Occupational Certificate | **Part-Qualification** |
| `MINIMUM CREDITS` | 120 | 47 |
| Title | Occupational Certificate: Commercial Cleaner | Occupational Certificate: Commercial Kitchenette Cleaner |

So the importer can read the kind rather than being told it. A part has its own
SAQA ID, its own title and its own credit total — it is a thing in its own
right, which is what Heidi said about enrolment.

### How a part is attached to its parent — corrected

I first assumed a part repeats its parent's curriculum code. **It does not**,
and running the parser over the real files is what caught it:

| | states its curriculum code as | writes its module codes as |
|---|---|---|
| 118709 | `811201-000-00` | `811201-000-00-KM-01` |
| 118710 | `811201-000-01` | `811201-000-00-KM-01` |

The headers differ — Heidi's "numeric suffix" — but every module a part lists
carries the **parent's** prefix, because they are the parent's modules. So the
link is read from the module codes, not from the header. Matching on the header
would have found nothing, every time.

**Source messiness to tolerate,** all of it found by running the parser over the
published PDFs rather than imagined:

- 118710 writes `811201-000-00--WM-01`, with a doubled hyphen, twice.
- 118711 writes `811201-000-00-KM-0 1Introduction…`, with a space inside the
  number and the title welded onto it.
- The SAQA document writes `811201-000-00-KM-01`; the curriculum document, which
  is where the platform's modules come from, writes `KM01`. The two are matched
  on component and number, which is all they have in common.
- The curriculum document writes credits as `Cr 6`, not `Credits 6`. The
  platform did not recognise that, so a 120-credit qualification imported with
  credits recorded on one module out of twenty-two. Fixed; it now reads 120,
  and the nine modules 118710 lists come to exactly 47.
- That same document restates the three component credit totals for itself
  **and for each of its four parts** — fifteen such lines. Adding them all up
  made the qualification 308 credits. Only the first of each is its own.

---

## The templates, and what each one means for the platform

### The two QCTO submissions are different workbooks

The SOP said full and part qualifications go to one address and skills
programmes to another. The templates show they are also different *forms*:

| | Qualifications (full and part) | Skills programmes |
|---|---|---|
| Template | `LEISAyyyymmdd-SDPorAC Name.xlsx` | `Learner Enrolments.xlsx` |
| Sheets | Instructions · Learner Enrolment and EISA | Instructions · Implementation Plan · Learner Data & Achievement |
| Goes to | `learnerenrolments@qcto.org.za` | `splearnerenrolments@qcto.org.za` |

The skills programme workbook additionally wants an **Implementation Plan** —
provider details, cohort sizes, start and expected end of training, and the
expected FISA date. The platform holds most of that on the cohort already.

### The enrolment form and the LEISA are two ends of one pipeline

`TEMPLATE - Programme Enrolment Form V3.docx` collects: full name as per ID,
title, ID or passport, work/asylum permit, citizenship, gender, equity,
employer, disability status, province of work, home address, home language,
work and cell phone, email, highest school certificate, highest post-school
qualification.

The LEISA asks for the same data back. **The platform should be the middle of
that pipeline** and is currently not: it holds twelve of the forty-three
columns.

**Held today:** national ID, date of birth, gender, equity code, disability
code, first and last name, email, OFO code.

**Not held, and needed for a valid LEISA:** middle name, title, nationality
code, home language code, citizen/resident status, socioeconomic status,
disability rating, immigrant status, home address (three lines + postcode),
postal address (three lines + postcode), phone, cell, fax, province code,
STATSSA area code, POPIA agreement and its date, expected training completion
date, assessment centre code, FLC and its statement number.

Two supporting files exist for the coded columns: `STATSSA_AreaCodes.xls` for
column 33, and `data-loading-specification-document.pdf` for the rest.

### The document templates

| Template | Bearing on the platform |
|---|---|
| `QCTO SoR Template.docx` | **Done, 9 September.** Reconciled — see below. |
| `TEMPLATE - Programme Enrolment Form V3.docx` | The artefact a QCTO monitor asks for. The platform holds none. |
| `FISA INSTRUMENT STRUCTURE.docx` | Skills programmes end in a FISA, set and moderated by the provider — not the external EISA the platform models. |
| `FISA Pre-Moderator Report.docx`, `Examiner Developer Report.docx` | Moderation artefacts for a FISA. The platform has moderation but not these reports. |
| `FISA Confidentiality Agreement` ×2 | Signed by the developer/examiner and by the moderator. Nothing in the platform records them. |
| `EXAMPLE Workplace Agreement - Curiosa Template.docx` | The platform already has workplace agreements; worth reconciling against this. |

---

## What is built — 9 September

All five, with tests, and the import path reads the whole thing from the
documents themselves.

1. **`kind` on a qualification** — full · part · skills programme — read from
   the SAQA document's `QUALIFICATION TYPE`, and settable on the form.
2. **A parent link and a module selection.** A part draws a subset of the
   parent's curriculum; nothing is copied. `qualification_modules` records the
   subset, and the database refuses a module the parent does not have.
3. **Every module count runs over the subset.** `listCurriculumModules` is
   part-aware, so every screen that asks a qualification for its modules gets
   the right answer without each having been changed one at a time.
4. **Readiness uses the parent's documents.** A part has no curriculum document
   of its own, so demanding one was not a strict rule but an impossible one —
   no part could ever have passed the gate.
5. **The credit total is checked against the subset,** reported rather than
   enforced. The module-selection screen shows the running total against the
   document's claim as it is ticked.

Proved end to end against the published PDFs (`tests/part-qualification-import.test.ts`):
importing 118709 and then 118710 attaches the part to its parent, selects its
nine modules, creates no second copy of the curriculum, comes to 47 credits
against the 47 the document states, and leaves the part ready for material.

**Not yet:** a screen to change a qualification's kind or parent after it is
created. It is set at creation and read from the document on import, which
covers both routes in; correcting a mistake means the form, for now.

---

## The Statement of Results, reconciled — 9 September

Read the template beside what the platform prints. Most of it matched. Seven
things did not, and all seven are now on the document:

- **Valid until.** "This SoR is valid for a period of two years from date of
  issue." The platform said nothing about it, so an assessment centre checking a
  three-year-old reference was told it was valid. Verification now separates
  *expired* from *withdrawn* — a learner whose document ran out has not had
  anything taken away from them, and should not be told they have.
- **Admission to the EISA**, as a yes/no with the date of the next sitting,
  taken from the calendar and frozen at issue.
- **The attachments checklist**: the learner's ID always; at NQF 3 and 4, proof
  of Maths and English.
- **A named signature block** — Principal or Academic Manager, and a
  designation — plus a space for the institution's stamp.
- **The two disclaimers**: that this is not an Occupational Certificate, and
  that only the QCTO issues one.
- **The provider's address**, which the template's letterhead calls for.
- **C/NYC** stated rather than left to be inferred from "Competent".

Found while doing it, and worth knowing separately: the public verification page
showed **nothing at all** for a Statement of Results reference. The result box
was gated on a certificate being found, so somebody at an assessment centre
typing a valid reference off a learner's document saw the page sit there as
though they had not pressed the button. Badges were in the same position. Fixed.

---

## Worth a look: the Commercial Cleaner curriculum imports thin

Not part of the part-qualification work, but it surfaced while testing it.
Importing 118709's curriculum document reads all 22 modules and all their
topics, and then reports, for nearly every topic:

```
KM01 / KM-01-KT01: nothing to teach was read.
KM01 / KM-01-KT01: no assessment criteria were read.
```

So the modules and topics land, and the **content of each topic and its internal
assessment criteria do not**. That matters: readiness, the alignment matrix and
the Statement of Results are all computed over criteria, and a qualification
whose criteria did not import cannot have anybody declared ready against it —
the platform already refuses, correctly, with "9 of 9 modules have no criteria
yet".

The 121151 document reads fully, so this is a difference in how the Commercial
Cleaner document is laid out rather than a general fault. It is the same shape
of problem as the `Cr 6` credits gap fixed today — one house style the reader
does not know — and it wants the same treatment: read the real file, find the
pattern, add it. **Not started; flagged rather than begun, because it is its own
piece of work.**

---

## What I am not building yet, and why

Not because it is unclear — the templates settle most of it — but because each
is its own body of work and they are cheaper to review one at a time.

- **The learner fields the LEISA needs.** ~22 columns, plus two code lists to
  import. Wants a decision on whether the platform collects them through its own
  screen or ingests the completed enrolment form.
- **The two QCTO exports.** Straightforward once the fields exist.
- **The enrolment form**, as an artefact the platform produces and files.
- **FISA.** A different assessment shape from EISA: provider-set,
  provider-moderated, with its own instrument, confidentiality agreements and
  moderator reports.
- **Reconciling the Statement of Results** against the QCTO template.
