# Task list from the RJ & HE meeting, 8 September 2026

Drawn from `Meetings/RJ & HE - LMS – 2026_09_08 10_55 SAST – Notes by Gemini.docx`,
checked against what the platform already does rather than taken at face value.
Where something already exists it says so, because "add X" when X is half-built
is how the same work gets done twice.

Ordered by what unblocks the most. The two agreed decisions are 1 and 2.

---

## 1. Flexible terminology, per tenant

**From the notes:** the one thing both of you explicitly agreed. "Develop the
LMS engine to allow for flexible naming of learning components… customize
terminology like courses or programs to better fit regional requirements."
Heidi agreed for global usability; UK and US usage were the examples.

**What exists:** the menu can already be rearranged and its headings renamed
per tenant. That covers the navigation bar only — the words inside the pages
are fixed.

**What to build:** a per-tenant vocabulary. A term registry, tenant overrides,
one helper every screen reads its nouns through, and a Settings screen to edit
them.

**The constraint that makes this safe, and it is already in the platform.**
`lib/dictionary.ts` classifies every term by `definedBy`:

| `definedBy` | Meaning | Renameable? |
|---|---|---|
| `authority` | A body defines it. Changing the meaning risks a submission or an accreditation. | **No** |
| `platform` | The platform chose the word. "Ours to change; no regulator is watching." | **Yes** |
| `practice` | Widely used, no single owner. | Yes, with a note |

So "Course", "Programme", "Cohort", "Facilitator" are fair game; "Qualification",
"EISA", "NQF", "credit", "Exit Level Outcome" are not. A tenant who renames an
`authority` term has quietly broken their own QCTO submission, and the platform
should refuse rather than let them. Build the feature on that split.

**Size:** large. The registry and the Settings screen are small; sweeping every
user-facing string is the work.

---

## 2. Part qualifications

**From the notes:** Heidi set out the sub-framework — full qualification, part
qualification, occupational skills programme. Roland: the LMS "should still
incorporate part qualifications for testing purposes, even if they are not
currently marketed."

**What exists:** nothing. `qualifications` has `saqaId`, `curriculumCode`,
`nqfLevel`, `totalCredits` and no notion of kind or of a parent. The only place
the distinction appears is `lib/enrolment-document-shape.ts`, which already
separates `standard_qualification` from `skills_programme` for the purpose of
which documents a learner must supply.

**What to build:**

- `kind` on a qualification: full · part · occupational skills programme.
- A parent link, so a part qualification points at the full one it comes from.
  Per Heidi they share a curriculum code with a numeric suffix.
- A part qualification carries a **subset** of the parent's knowledge,
  practical and workplace modules — not its own copies.
- Documents differ, and the platform should stop asking for what does not
  exist: a full qualification produces three (SAQA qualification document,
  curriculum document, assessment specification); **a part qualification has no
  curriculum document of its own.** Programme readiness currently demands one.
- Readiness, the Statement of Results and every completion count must run over
  the part's own module subset, not the parent's whole curriculum.

**Test data named in the meeting:** Commercial Cleaner, SAQA 118709, with parts
118710, 118711 and 118712. Not yet in the project — Heidi is assembling the
folder. Best built against those real documents rather than invented ones.

**Size:** large, and it reaches the readiness calculation, which is the most
load-bearing arithmetic in the platform.

---

## 3. Occupational skills programmes

**From the notes:** freestanding, or derived from a full qualification. Produce
a skills programme document and sometimes a skills programme curriculum
document. Examples given: assistant handy person, assessment practitioner.

**What exists:** `enrolment-document-shape.ts` knows `skills_programme` as a
programme type for deciding required learner documents. Nothing else.

**What to build:** the same `kind` work as task 2 covers most of it. What is
specific here is that a skills programme may stand alone with no parent at all,
and that its document set differs again.

**Size:** medium, mostly shared with task 2.

---

## 4. Statutory enrolment notification, and the LEISA submission

**From the notes:** 21 working days for a full qualification, 5 working days
for a skills programme. Heidi's reasons: compliance, monitoring, funding and
drop-out tracking. You both agreed to take the wider management discussion to a
separate session — but the deadlines themselves are concrete enough to build.

**Also from the SOP** (`Design/Processes/Standard Operating Procedures/CA -
Learner Enrolment Process.docx`), which is more specific than the meeting notes
and worth reading alongside them:

- The process starts once the client is invoiced and **proof of payment
  received** — which is where the PayFast work eventually joins up.
- A LEISA is completed and submitted, with an acknowledgement requested.
- Full and part qualifications go to `learnerenrolments@qcto.org.za`.
- Skills programmes go to `splearnerenrolments@qcto.org.za`, **and** two FISA
  instruments plus documentation go to the QCTO for approval.

**What exists:** `lib/working-days.ts` does the arithmetic. The required learner
documents are enforced, including a certification-expiry rule on the certified
ID. There is no notification deadline, no LEISA export and no FISA tracking.

**What to build:**

- A notification due date per enrolment, counted in working days from the
  enrolment date, 21 or 5 according to kind.
- Somewhere that shows what is approaching and what is overdue — this is the
  kind of deadline that is only ever noticed late.
- A LEISA export from the cohort, in the QCTO's own spreadsheet shape, with the
  right recipient shown for the kind. Building the file is the platform's job;
  sending it stays a person's.
- Record that the acknowledgement came back, since the SOP asks for one.

**Size:** medium. Needs the QCTO LEISA spreadsheet and the data-loading
specification document, both named in the SOP as supporting documents.

**Blocked on:** sight of the actual LEISA template.

---

## 5. Check the platform against the enrolment SOP end to end

**From the notes:** Heidi confirmed the SOPs are integrated and located the
enrolment process document; Roland noted all SOPs have been reviewed.

**Why it is still a task:** reviewing a document is not the same as checking the
platform matches it. The SOP has specifics the platform may or may not enforce
— an ID with multiple certification dates is unacceptable, an illegible one is
unacceptable, forms are QA'd before capture, details go into both the LMS *and*
the Tracker.

**Size:** small. A read-through against the screens, then a short list of gaps.

---

## Not tasks, recorded so they are not mistaken for omissions

- **Design restraint.** Heidi praised the clean layout and colour scheme and
  said she does not want cluttered or gaudy design. Treat that as a standing
  constraint on everything above.
- **The management session.** Value chain and statutory process for skills
  programmes, deferred by agreement to its own meeting.
- Power supply, folder organisation and scheduling — not platform work.

---

## Carried over, not from this meeting

- **Outbound mail still refuses the login** (`535`). Awaiting Linda's
  confirmation of the current credentials. Testable from Settings → Outbound
  mail.
- **Re-print `Design/Server/LMS External Communication — A4.pdf`.** The HTML is
  now six pages and the port-25 row asks a better question.
- **The `tools` container cannot resolve DNS.** Harmless today; breaks
  off-site backups.
- **Off-site storage for backups.** Still outstanding.

---

## Questions for Heidi before starting 2 and 3

Each of these changes the data model, so they are worth asking before building
rather than after.

1. **Is a learner enrolled on a part qualification, or on the full one and
   awarded a part?** This decides whether a part qualification is a thing you
   enrol onto or a view over the parent.
2. **Does a skills programme derived from a full qualification share the
   parent's modules, or hold its own copies?** Sharing keeps one criterion
   ledger; copying allows them to drift apart deliberately.
3. **Do the 21 and 5 working days run from the enrolment date or from proof of
   payment?** The SOP starts the process at payment; the notes describe the
   window as statutory.
4. **Should the platform derive part qualification codes** from the parent's
   curriculum code and a numeric suffix, or are they always entered as given?
