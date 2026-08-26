# Build queue

Everything outstanding on the LMS apart from network infrastructure, which is
waiting on InspireTec and is not mine to unblock.

Worked top to bottom. Each item says what "done" means, so there is no argument
about whether it is finished. Ticked as it lands, with the commit.

---

## 1. The Curiosa conversion — visible identity

**Done when:** `lms.roftbusiness.org/login` shows the Curiosa Academy logo and
name, the palette is Curiosa's throughout, and the graphics from
`Branding/Curiosa Branding/Graphics/` set a consistent tone across sign-in,
the learner's home and the empty states.

- [x] 1.1 Logo into the platform, served from the App rather than linked
- [x] 1.2 Curiosa palette applied as the operator's own
- [x] 1.3 Sign-in page given a real identity, not a bare form
- [x] 1.4 Graphics used where they help and nowhere they do not
- [ ] 1.5 Deployed to the live server *(needs Roland to run the deploy)*

**Note.** I cannot reach the server from here. The last step is three commands
Roland runs over SSH; they will be written out when the rest is done.

---

## 2. Curriculum editor

The single biggest gap. Topics, elements and criteria can only arrive through a
JSON file I write by hand — for 121150 I transcribed 85 pages myself. Curiosa
cannot add a qualification without me, which also makes the readiness gate
partly theoretical: "import the curriculum" is not something they can do.

**Done when:** somebody holding `qualification:manage` can create a
qualification, add modules, topics, topic elements and assessment criteria, and
edit them, entirely in the App — and the readiness gate goes green as a result.

- [x] 2.1 Module, topic, element and criterion authoring — `lib/curriculum-editor.ts`
- [x] 2.2 Guards: codes unique within scope, percentages that must total 100,
      a work experience module that must not carry criteria
- [x] 2.3 Screens at `/qualifications/[id]/edit`
- [x] 2.4 Tests, including that a hand-built curriculum satisfies the gate

**Done.** A qualification can now be built line by line in the App, and the
readiness gate goes green off the result. Deleting is guarded rather than
cascading: a criterion a question already evidences, a lesson already teaches,
or an assessor has already judged against will not delete, and the refusal says
which of the three it is.

---

## 3. PDF text extraction

The three Qualification Detail documents are PDFs. They upload, they are
hashed, they are held against the qualification — and the App cannot see a word
inside them. So the gate can check a file exists but cannot help populate the
curriculum from it.

**Done when:** an uploaded PDF has its text extracted the way a .docx does, and
the curriculum editor can start from the real document rather than a blank
form.

- [x] 3.1 PDF text extraction in `lib/office.ts`, on Mozilla's pdf.js
- [x] 3.2 Wired into programme document upload, stored in `extractedText` —
      and a scan is reported to whoever uploaded it rather than filed silently
- [x] 3.3 `lib/curriculum-parse.ts` reads the document into a proposal, and
      `/qualifications/[id]/edit/from-document` offers it a module at a time
- [x] 3.4 Tests against the real 121150 and 121151 documents

**Done.** 121150 reads to all 13 modules and 121151 to all 15, despite the two
using different code conventions and disagreeing about what a PS code means.
Nothing is written until somebody accepts a module, and every line goes in
through the same guards as the hand editor.

Two faults in the 121150 document itself surfaced on the way, and are reported
before anything is accepted: KM02 restarts its criteria at IAC0101 in a second
topic, and WM01 numbers five different work activities WA0201. Only the first
of each can be stored, so those lines need renumbering in the document.

---

## 4. Cohort creation screen

The library is complete and tested; a cohort can only be created from code.

**Done when:** a facilitator can create a cohort, add and remove members, write
the rollout schedule and move the start date, without anybody touching a
terminal.

- [x] 4.1 Create and reschedule
- [x] 4.2 Add and remove members
- [x] 4.3 Edit the schedule as days from the start
- [x] 4.4 Tests

**Done.** A cohort is created against a published course from `/cohorts`, and
everything else is on the cohort's own screen: move the start, edit the
rollout, add and remove learners.

One thing had to be fixed underneath. `setSchedule` replaces a cohort's whole
schedule rather than merging into it, but `getCohort` did not return
`closesAfterDays` — so the editor would have read a schedule, saved it back,
and silently dropped every closing time. It is returned now, and a test saves
a schedule back unchanged and checks it survives.

---

## 5. The oral third attempt

Designed in Phase 2 and not built. `paperMode` exists; the authorisation record
and the oral flow do not. It matters the first time somebody fails V2.

**Done when:** after a second not-yet-competent result the step is *held rather
than failed*, a programme review records the employer consultation and its
outcome, and an authorised oral attempt can be conducted and marked — reaching
the ledger exactly as a written attempt does.

- [ ] 5.1 `reassessment_authorisations` and `oral_assessment_records`
- [ ] 5.2 The held state, and the authorisation that lifts it
- [ ] 5.3 The assessor's oral screen
- [ ] 5.4 Tests, including that an oral pass moves readiness

---

## 6. Reports

Deliberately narrow. Not a dashboard project: the things a provider actually
acts on.

**Done when:** a facilitator can see, per cohort — who is where on the spine,
which criteria are not yet evidenced anywhere, and first-attempt pass rates per
question.

- [ ] 6.1 Criterion coverage: what nothing tests
- [ ] 6.2 First-attempt pass rate per question, which finds badly written items
- [ ] 6.3 Time on each step
- [ ] 6.4 Tests

---

## 7. Summative template convergence

Least urgent — the parse is clean now. Revisit only if Curiosa's summative
format changes or a new provider's material parses badly.

- [ ] 7.1 Reviewed against any new material

---

## Not in this queue

Network infrastructure, all of it waiting on InspireTec: the mail relay
credentials, the off-server backup bucket, and the server migration itself.
