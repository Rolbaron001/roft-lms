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
- **No QCTO or SAQA logo, anywhere, ever.** Heidi raised it on 9 September as a
  regulatory prohibition, pre-emptively rather than because she had seen one.
  Checked: none exists. The only images the platform ships are the tenant's own
  logo, ROFT's, and unused Next.js template files. Naming a regulator in text is
  a different thing and stays - the platform has to be able to say that a
  certificate comes from the QCTO.
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

## Heidi's answers, 9 September

### 1 · A part qualification is a thing in its own right — settled

> "Each full qual and each part-qual and each skills programme has its own
> identification number, so the enrolment is per programme ID number per
> learner."

So a part qualification is enrolled onto directly, not awarded out of the full
one. Whoever buys a place on a part qualification is enrolled for **that**, and
the full qualification is not involved. Same for a skills programme.

**What this settles:** `kind` on a qualification, each row enrolable in its own
right, and the parent link records where a part came from rather than being the
route a learner travels.

### 2 · Not yet answered — my question was the problem

I asked whether a derived programme "shares the parent's modules or holds its
own copies", which is an implementation question wearing a business suit. Heidi
reasonably said she did not understand it. Re-asked in the section below.

**What we can infer meanwhile**, from the meeting notes rather than guessing: a
part qualification sits "under the same curriculum code" as its parent and
"does not generate a separate curriculum document". Both point at one shared
curriculum with the part selecting a subset of its modules, rather than a copy.
Worth confirming before building on it, because it is the difference between
one criterion ledger and two.

### 3 · The clock starts at induction — settled, and better than expected

> "From the induction date, which at Curiosa is the start of training… The QCTO
> uses the enrolment form and rollout schedule as evidence for the induction
> when it conducts monitoring and evaluation visits."

Not the enrolment date and not proof of payment. **The induction date.**

**What already exists, which makes this cheaper than it looked:**

- `induction` is already a cohort session kind — "the opening session, dated and
  attended, but outside the lecture count". So the induction date is not a new
  field to invent; it is the date of that session.
- The **rollout schedule** already exists: `lib/cohorts.ts` writes which step
  opens in which week.
- The folder import already recognises documents named "rollout" and
  "induction" as their own kinds.

**What is missing:** the deadline itself, and the enrolment form. Heidi names
both the enrolment form and the rollout schedule as the evidence a QCTO monitor
asks for, and the platform holds no enrolment form at all.

### 4 · Codes are assigned elsewhere, never derived — settled

> "The curriculum codes are mostly derived from the Organising Framework for
> Occupations (OFO), but if there is not an associated occupation in the OFO for
> the skills programme then the QCTO assigns a curriculum code which will always
> start with 9."

So the platform must never compute a code. It records what the official
document says. `ofoCode` already exists on a qualification alongside
`curriculumCode`.

One thing worth using: a curriculum code beginning with 9 means the QCTO
assigned it because no OFO occupation matched — which is a fact about the
qualification worth surfacing rather than a rule to enforce.

---

## Still to ask Heidi

### The module question, asked properly this time

Ignore the previous wording. What I need to know is this:

> A learner completes a part qualification — say 118710, which contains some of
> the Commercial Cleaner modules. Later they enrol for the full qualification,
> 118709, which contains those same modules.
>
> **Do they have to do those modules again, or does the work already count?**

If it counts, the platform holds one set of modules and a part qualification
selects from it — one criterion ledger, one place a module is ever marked
complete. If they must repeat it, they are genuinely separate modules that
happen to share a name.

Everything in the notes points at "it counts", but it decides the shape of the
data and is cheaper asked than rebuilt.

### And two that follow from her answer about induction

- **Is the induction date always the cohort's induction session**, or can a
  learner be inducted separately from their cohort — a late joiner, say?
- **Does the platform need to produce the enrolment form**, or does Curiosa
  create it outside and file the completed one? The SOP says the provider
  creates a form per client and sends it to each learner; the platform
  currently has no such artefact either way.

---

## What I explained back to Heidi

**"Entered as given"** meant: does somebody type the code in from the official
document, or does the platform work it out? Her answer settles it — typed in,
because only the QCTO or the OFO can say what it is.

