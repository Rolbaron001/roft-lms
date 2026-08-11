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

## 6. Read-only oversight (1 min)

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
Assessment is the next block: the quiz builder, evidence upload with tamper
detection, and the assessor-then-moderator sign-off chain. After that,
certificates, single sign-on, and the SAQA/NLRD statutory exports.

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

- Assessment, marking and moderation — designed, not yet built.
- Certificates.
- Single sign-on, HRIS, payments.
- Reporting dashboards beyond per-course progress.
- Mobile app and offline use.
