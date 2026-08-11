# Demonstration script

A ten-minute walkthrough of what is built. Everything below works today.

## Before the meeting

1. Double-click **`start-lms.bat`**. Wait for the browser to open at
   `http://acme.localhost:3000`. Leave that black window open — closing it
   stops the system.
2. Use **Chrome or Edge**. Any `*.localhost` address resolves to your own
   machine automatically in those browsers.
3. If anything looks wrong, close the window, run **`reset-demo-data.bat`**,
   type `YES`, then start again. That restores exactly the state described
   here, so it is safe to do five minutes before you present.

Every account below uses the password **`roft-demo-2026`**.

Have two browser tabs ready:

- `http://acme.localhost:3000` — Acme Mining Services
- `http://harbourtraining.localhost:3000` — Harbour Training Centre

---

## 1. One platform, two clients (1 min)

Sign in at **acme.localhost:3000** as `admin@acme.test`.

Then open the second tab, **harbourtraining.localhost:3000**.

> Same system, same code, same database. Different client. Acme's people see
> Acme's name and colours; Harbour sees theirs. Nothing was rebuilt or
> duplicated to do that.

Now the point worth making. In the Harbour tab, try to sign in with Acme's
details — `admin@acme.test` / `roft-demo-2026`.

**It is refused.** A valid login at one client is worthless at another.

> Separation is enforced by the database itself, not by the screens. If a piece
> of code ever forgets to filter by client, it gets back nothing at all rather
> than somebody else's records. There are automated tests that try to break
> that, deliberately, every time the code changes.

Sign in to Harbour as `admin@harbour.test` if you want to show it works.

---

## 2. An accredited qualification, not just courses (2 min)

Back in the Acme tab, as `admin@acme.test`, open **Qualifications**.

Show *Occupational Certificate: Mine Plant Operator* — QCTO code, SAQA ID,
NQF level 4, 120 credits, and beneath it two modules:

- **KM-01** Plant safety principles and legislation — Knowledge, 12 credits
- **PM-01** Safe start-up and shut-down of plant — Practical, 18 credits

> QCTO qualifications are delivered across three kinds of module: Knowledge,
> Practical, and Workplace Experience. That distinction is built into the
> system's foundations, not bolted on. Each module carries its own assessment
> criteria — the specific things a learner has to demonstrate.

---

## 3. The part that is genuinely different (3 min)

**This is the strongest thing to show. Give it time.**

Open **Courses**, then *Equipment Fault Diagnosis (in development)*.

Look at the **Readiness** panel on the right: *1 of 2 assessment criteria
covered*. IAC-01 is green. IAC-02 is red — "No lesson covers this".

Press **Publish course**.

**It refuses**, and names exactly what is wrong.

> The system will not let an incomplete course go out. It has checked every
> assessment criterion in the official curriculum against the actual lesson
> content, and it found one with nothing behind it.
>
> Note that this is a refusal, not a warning. A warning gets clicked past —
> that is what warnings are for. This is the difference between finding the gap
> while you are building the course, and an external verifier finding it a year
> later, after a whole cohort has been assessed against material that never
> covered the standard.

Then open *Plant Safety Fundamentals* to contrast: **2 of 2 covered**,
published, and now locked — the editing controls are replaced by "Start a new
version".

> Once learners have completed a course, their records refer to that exact
> version. Editing it afterwards would rewrite what they were assessed against,
> so the system will not allow it. Changes go into a new version and the old one
> stays intact.

---

## 4. Assigning people and tracking them (2 min)

From *Plant Safety Fundamentals*, click **Who is on this course**.

Two people, with live progress: Sam Mokoena 1 of 2, Fatima Patel 0 of 2, both
due in two weeks.

Show the bulk panel — paste a column of email addresses straight from a
spreadsheet.

> It tells you what happened to every address: who was enrolled, who was
> already on the course, and which ones it did not recognise. If you paste forty
> addresses and three are misspelt, you need to know which three.

---

## 5. The learner's view (2 min)

Sign out. Sign in as `learner@acme.test`.

> Same system, completely different experience. Sam sees his own learning and
> nothing else — no admin screens, no other people's records.

Open *Plant Safety Fundamentals*. It opens on the lesson he has not finished —
it resumes rather than restarting. Read a little of the content, press **Mark
as complete**, and the course completes.

Then, if you want the sharpest moment of the demo: go to the address bar and
paste a link to a colleague's record. **Refused.**

> A learner cannot open a colleague's record even with a direct link. And worth
> saying: an administrator cannot mark a lesson complete on a learner's behalf
> either. Progress is evidence. A completion record that an administrator could
> create would prove nothing at an audit.

---

## 6. The assessment chain (3 min)

The demo data includes a **summative** quiz on *Plant Safety Fundamentals*.
Summative means it counts towards the qualification, so it is judged by a
person and every decision is moderated.

As `learner@acme.test`, open the course and press **Start** on *Plant safety
knowledge check*. Answer both questions and submit.

> Note what it does not say. It does not say "passed". It says an assessor will
> review it. An automatic score informs a qualification decision; it does not
> make one.

Sign in as `assessor@acme.test` and open **To assess**. Sam's submission is
waiting. Open it: the answers are shown beside the official assessment
criteria, and the assessor records a judgement against each one.

Record the decision, then sign in as `moderator@acme.test` and open **To
moderate**. The decision is already there, marked *"Summative — every decision
is moderated"*.

> Nobody chose to send this for review. The system routed it, because the rules
> say a summative decision is always moderated, and a newly registered
> assessor's work is always moderated in full whatever the sampling rate.
>
> And the assessor cannot moderate their own decision. That is enforced by the
> database itself, not by hiding a button — we test it by trying to write the
> record directly, and the database refuses.

## 7. The certificate issues itself (2 min)

Once the moderator has endorsed the decision, sign back in as
`learner@acme.test`. A **My certificates** section has appeared. Open it.

> Nobody issued this. The system did, the moment the last rule was satisfied.
> And note what had to be true first: every lesson finished, the summative
> assessment judged competent, and that judgement independently moderated. Sam
> finished the lessons some time ago — the certificate did not appear then,
> because the assessment had not been through the chain yet.

Read out the reference at the bottom, then open a **private browsing window**
— to prove no account is involved — and go to:

`http://acme.localhost:3000/verify`

Type the reference in. It confirms who holds it, what for, who issued it, and
which competencies it attests to.

> This is the part a client's HR department or a SETA verifier actually uses.
> No login, no phone call. And the reference is random, not sequential, so
> nobody can guess their way through your certificates.

If asked what happens to a certificate issued in error: it is withdrawn, not
deleted. Verification then reports it as withdrawn and gives the reason,
because someone holding the printed copy deserves to be told.

## 8. Capability, not completions (2 min)

As `admin@acme.test`, open **Reports**.

Headline numbers first — people, courses assigned, completion rate, overdue.
Then the section that matters: **Capability coverage**.

> Every other system on the market reports completions. This reports capability.
> The difference is the whole reason we built rather than bought.
>
> Two flags. **No coverage** means nobody in this workforce holds that
> competency at all. **Single point of failure** means exactly one person does
> — so if they resign, or break an arm, that capability leaves the business
> with them. That is a workforce risk you cannot see from a completion report,
> and it is exactly what ROFT's advisory work is about.

Point out the note under the heading: capability is counted from certificates,
not completions. Somebody finishing a video is not evidence; a moderated
judgement is.

Then **Export CSV** — this is what a client's HR lead takes into a board pack.

Finally, sign in as `manager@acme.test` and open Reports again.

> Same screen, one person. A line manager sees their own team and nobody else
> — including in the export, which runs the same rules rather than its own.

## 9. The SETA and SAQA return (2 min)

Sign in as `sdf@acme.test` — the Skills Development Facilitator, the person who
actually files these — and open **Statutory**.

It says **Ready to submit**, with the four NLRD files available: Person Record
27, Enrolment Record 28, Achievement Record 29, Provider Record 30.

> The files are not the clever part. Anyone can write a spreadsheet. The clever
> part is that it checked everything first.
>
> Identity numbers are verified against their check digit, so a transcription
> error is caught here rather than by SAQA six weeks later. A qualification
> without a SAQA ID, an assessor without a registration number, a learner
> enrolled after the qualification's registration window closed — all blocked
> before submission.
>
> A rejected return costs a full cycle for every learner in the file. This is
> the difference between filing and re-filing.

Point at **Worth fixing** underneath: Pieter van Wyk has no equity code, and
the organisation has no ward code recorded. Those do not block the return, but
the NLRD flags them and a SETA may query them.

Then scroll to the **WSP/ATR** table — training activity grouped by OFO code,
which is exactly how the annual SETA return is organised.

> This is the return that decides mandatory grant recovery and B-BBEE skills
> development points. It is being produced from the training records
> themselves, not reassembled from spreadsheets at year end.

If someone asks whether it can be submitted tomorrow: the data is complete and
validated; the exact file layout must be checked against the current SAQA
specification first. Be straight about that — it is a formatting step, not a
gap.

## 10. Managing people (1 min)

As `admin@acme.test`, open **People**.

Everyone in the organisation, their roles, and a column showing whether their
record is complete enough for a statutory return.

> Notice this connects to the previous screen. If somebody is missing an
> identity number or an equity code, it shows here, in the list — so it gets
> fixed as people are added, not discovered the night before a SETA
> submission. And an identity number is checked against its check digit as you
> type it, while the person holding the document is still in front of you.

Open your own record and point at the Roles section.

> It will not let me change my own roles or suspend my own account. Nor will
> it let anyone remove the last remaining administrator. Locking yourself out
> of your own system is the one mistake that needs somebody with database
> access to undo, so the system simply refuses.

If POPIA comes up, scroll to **Erase personal information**:

> A data subject can require their personal details be erased. SAQA requires
> achievement records to be kept. Both are satisfied because the two are
> separate: erasing removes the name, contact details and demographics, and
> the certificates stay valid and publicly verifiable. The qualification stays
> on the record; it is just no longer attached to a named individual.

## 11. Read-only oversight (1 min)

Sign out, sign in as `verifier@acme.test` — the External Verifier, the role a
SETA or QCTO auditor would hold.

Show what they can do: read courses, enrolments, evidence, certificates, and
the audit log. Then note what is missing from the menu — no authoring, no
assessing, no administration.

> That role holds no permission that writes anything, anywhere. It is checked
> by a test that works through every write permission in the system, so a new
> one added next year cannot quietly leak into it.

---

## If someone asks

**"Is this live? Can we use it?"**
Not yet. It runs on Roland's machine. Hosting is a small monthly cost and a
decision to make — likely a South African data centre so learner data stays in
the country for POPIA.

**"What is still to build?"**
Single sign-on, HRIS integration, payments for learning centres selling course
access, and the mobile app for offline use. The full chain — enrol, learn,
assess, moderate, certify, verify — is built and working, with capability
reporting and the statutory returns on top of it.

**"How long?"**
Better answered after the assessment block, when the shape of the remaining
work is clearer. Resist being pinned to a date in the room.

**"Who built it?"**
AI-assisted development, directed by Roland. Worth saying plainly — it is the
reason a platform of this scope exists at this stage.

**"Is our data safe?"**
Client separation is enforced by the database engine, every administrative
action is written to a log that nobody can edit afterwards, and no assessor can
moderate their own decisions. Those are properties the system is tested for on
every change, not promises.

---

## What is deliberately not in the demo

Say so if it comes up, rather than being caught out:

- Printable or PDF certificates (the certificate is a web page for now).
- Single sign-on, HRIS, payments.
- Mobile app and offline use.
