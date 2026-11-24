# The programme map: linking a folder's documents reliably

Design note for Roland, 24 November 2026. Job sheet D60.

## 1. The problem

Uploading a folder works in three steps: read the curriculum, read how the
provider groups modules into study units, then decide which study unit every
file belongs to and which guide belongs to which paper. The first step is
solid. The second and third are where every upload has gone wrong, and each
fix has taught the platform one more way of writing the same thing:

| Folder | What the platform had not seen before |
|---|---|
| 121151 | Guides named "AG"; papers in versions V1 and V2 |
| SP-260508 | Guides named "Assessor_Guide_Memo_Formative_Workbook_1"; one workbook listed for two units; a second alignment matrix belonging to another programme |
| SP-220320 | Papers lettered "Part A" rather than numbered; a formative guide that never says "workbook"; units named again in the weekly schedule; modules written "242401001-KM-05"; questions written "Task 1.1 [IAC0101] [9 Marks]" |

Each fix was right, and the readers now pass against six real folders. The
pattern will not end there. Every tenant will bring a layout nobody has seen,
and the dangerous failure is not a refusal. It is a paper quietly linked to
the wrong guide or the wrong unit, which nobody notices until a learner is
marked against it.

So the readers cannot remain the last word. Something has to make the links
certain before anything is built.

## 2. The options, honestly

**A. Keep teaching the readers.** No extra work for the user. It never
finishes, and it fails silently, which is the one outcome that matters most.
Worth continuing, as the first draft of everything below, but not on its own.

**B. A compulsory matrix in a fixed format.** Certain, because the platform
only reads one layout. Against it:

- Providers already keep their own alignment document for accreditation. A
  second matrix to keep in step with the first will drift, and the drift is
  the same silent fault in a new place.
- The rule this platform was built on is that a tenant's documents are the
  tenant's: the platform reads theirs rather than prescribing its own, except
  where a regulator prescribes the form.
- People fill in templates wrongly too: a file name mistyped, a unit left
  blank. A template still needs checking.

**C. A form in the platform, filled in before uploading.** Every link chosen
from lists, so nothing can be misspelt. Against it: for 121151 that is fifteen
modules, about fifty topics and about eighty files chosen one by one, which
throws away everything the readers already get right, and turns a ten-minute
upload into an afternoon.

**D. Recommended: the platform drafts the map, a person confirms it once.**
The readers do what they do now, but their result is no longer acted on
directly. It becomes a draft **programme map**, shown on one screen before
anything is built. Each link says where it came from and how sure the
platform is. The person corrects what is wrong by choosing from lists,
accepts the rest, and only then is the qualification built. A standard
spreadsheet, the **default matrix**, is offered as a quicker route for those
who prefer it, never as a requirement.

This keeps the principle you set on 2 October: the platform does what the
documents settle, flags what it was unsure of, and asks for one verification
rather than a chain of steps. What changes is that the verification happens
before the build, at the one point where a wrong link is cheap to correct.

## 3. The programme map

One record per qualification, kept with it and versioned. It says:

1. **The study units**: code, title, Exit Level Outcome, and the modules and
   topics each takes.
2. **Every file in the folder**: what it is (theory guide, slides, workbook,
   summative, guide to a paper, FISA material, programme document, not for
   learners, ignore) and which study unit or units it belongs to.
3. **Every paper and its guide**: each workbook and summative paired with its
   guide, or marked "no guide" deliberately.
4. **Shared items**: a paper or guide listed for more than one unit, done in
   the last of them (as decided on 20 November).

Each link carries its **source**, in this order of authority:

| Source | Example | Trusted |
|---|---|---|
| Confirmed by a person | Heidi chose SU2 | Always |
| The default matrix in the folder | Row: Formative_Workbook_Part_A, SU1 | Always |
| A sub-folder named for the unit | "SU2 / Workbook.docx" | High |
| The alignment document | "Formative Workbook 1 & Assessor Guide" under Study Unit 1 | High |
| The file's name | "CA 121151 SU3 WB1 AG" | High when it names the unit |
| The file's content | The guide answers the paper's question headings | Medium, always shown |
| A fall-back | Placed in the last unit its modules cover | Low, always shown |

Where two sources disagree, the higher one wins and the disagreement is
shown, never hidden.

## 4. The screen: "Check the map"

A new step in the folder upload, between reading the folder and building. It
replaces the present "Where they go" list, which shows the outcome but does
not let anybody change it.

```
SP-220320 Assessment Practitioner                      3 study units · 20 files

[ 2 need you ]  [ 4 worth a look ]  [ 14 settled ]          Accept and build →

SU1  Programme Orientation, Occupational Profile & ELO 6      WM-06
  Formative Workbook Part A     workbook     SU1 ▾   guide: Formative Assessor Guide Part A ▾   from: alignment
  Summative Part A Script       summative    SU1 ▾   guide: Assessor Guide Part A ▾             from: alignment
  Learner Handbook              handbook     SU1, SU2, SU3 ▾                                     from: name
SU2  Assessment Principles, Evidence Collection ...           KM-05
  ...
Not placed
  CA LD_Advisor_Alignment_Matrix.docx   ! maps curriculum 242401002, not this programme's   [ignore ▾]
```

- **Grouped by study unit**, the way the provider thinks about it, with the
  files nobody could place at the foot in red.
- **Three counts at the top**: what needs a decision (red), what is worth a
  look because it was placed by content or fall-back (amber), and what is
  settled. Accept is not offered while anything is red.
- **Every choice is a list**: the unit or units, what the file is, which
  guide. Nothing is typed, so nothing can be misspelt.
- **The reason is shown** beside each link ("from: alignment", "from: name",
  "from: content, 82% of its questions answered").
- **Accept and build** when nothing is red. For a folder that reads cleanly
  this is one click, which is the case the readers already handle.

The same screen opens later from the qualification page as **Programme map**,
so a link can be corrected after the build without removing the
qualification. Building again then follows the corrected map.

## 5. What blocks the build

Nothing is built while any of these is open. Each is shown in red with the
choice that resolves it:

1. A file the platform could not identify (choose what it is, or ignore it).
2. A workbook or summative with no study unit.
3. A workbook or summative with no guide, unless "no guide" was chosen on
   purpose.
4. A guide paired with no paper.
5. Two papers claiming the same guide, or one paper with two guides of the
   same version.
6. A study unit with no modules.
7. A matrix or curriculum that names another programme's curriculum code.

Everything else is a warning only (shown in light red, never green): a paper
placed by content, a document covering several units, a curriculum numbering
slip, a deck that would not convert.

## 6. The default matrix

A spreadsheet in the platform's own format, for providers who would rather
work in Excel, and for Curiosa's material builders to produce with the
programme.

**It is offered, never required.** It is most useful in three cases: a
provider whose own alignment document the platform cannot read well, a
folder too large to check on screen comfortably, and re-uploads, where last
time's confirmed map can simply be used again.

**The platform fills it in first.** "Download the map" on the check screen
gives the draft as a spreadsheet, so nobody starts from an empty grid. It is
edited, saved into the folder, and read first on the next upload.

Three sheets:

| Sheet | One row per | Columns |
|---|---|---|
| Study units | study unit | Code (SU1), Title, Exit Level Outcome, Modules (KM-01; PM-02), Topics (KM-01: KT01, KT04; optional) |
| Files | file in the folder | File name (exactly as in the folder), What it is (a list), Study unit(s) (SU1; SU2), Guide for (the paper's file name, on a guide's row), Version (optional), Learners see it (Yes/No) |
| About | the matrix itself | Qualification or programme code, curriculum code, date, prepared by; a marker the platform reads to know the sheet is its own |

"What it is" and "Learners see it" are drop-down lists in the spreadsheet,
so the spreadsheet cannot hold a value the platform does not know. The
platform checks every file name against the folder and reports any row that
names a file that is not there, and any file with no row.

The provider's own alignment document stays exactly as it is, filed and
read as now. The default matrix only says how the folder's files link up,
which the alignment document was never designed to say precisely.

## 7. A recommended folder layout

Published in the user manual and on the upload screen, as advice rather than
a rule, because it removes most of the guessing before the readers start:

```
<Programme code> <Title>/
  Programme Documents/     curriculum, qualification document, alignment document, schedule
  SU1/                     everything for study unit 1: guides, slides, workbooks, guides to them
  SU2/
  ...
  FISA/                    final integrated assessment material
  Programme map.xlsx       optional: the default matrix
```

A sub-folder named for a unit ("SU2", "Study Unit 2", "Unit 2", "Part B")
is one of the strongest signals a provider can give, and the platform does
not read it yet: today only the file's own name is read for its unit.

## 8. Learning from corrections

When a person corrects the map, the platform notes the shape of the
correction for that provider. Example: "Formative_Assessor_Guide_Part_X
guides Formative_Workbook_Part_X". The next upload from the same provider
starts from what they taught it. This stays within the one provider: one
tenant's habits never shape another's reading.

## 9. Building it

| Stage | What | Time |
|---|---|---|
| 1 | The programme map record, drafted from the readers with a source on every link; the "Check the map" screen with its lists, counts and build gate; the build follows the map | 2 to 3 days |
| 2 | Sub-folders named for a unit read as a signal | Half a day |
| 3 | The default matrix: download the draft, read a filled-in one from the folder first, with its checks | 1 to 1.5 days |
| 4 | "Programme map" from the qualification page, to correct after the build and build again | 1 day |
| 5 | Learning from corrections, per provider | 1 day |

Stage 1 alone removes the silent failure, which is the one that matters. The
others make the step quicker. Each is tested against the six real folders
held (118709, 118710, 118711, 121151, SP-260508, SP-220320), and every new
folder a provider sends becomes another test.

## 10. Decisions for Roland

1. **Approach D**, drafted by the platform and confirmed once before building,
   rather than a compulsory template or a form filled in from scratch.
   Recommended.
2. **The check is compulsory, the matrix is optional.** Nothing is built
   while anything is red; the default matrix is offered, never required.
   Recommended.
3. **The order of the stages** in section 9, starting with stage 1 now.
