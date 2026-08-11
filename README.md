# ROFT Learning Management System

The production build of the ROFT Learning Management System: a multi-tenant
learning platform that maps every course and assessment to a named competency,
and carries a QCTO-aligned assessment, moderation and evidence trail that will
stand up to an accreditation audit.

Built to the design set out in `../../Design/ROFT_LMS_Design.docx` and the QCTO
accreditation framework in
`../../Design/Enterprise Learning Management System Architecture and QCTO Accreditation Framework for ROFT Business - GEMINI.docx`.

The Flask proof-of-concept in `../lms_prototype/` proved the core mechanics to a
client. It is a reference for intended behaviour, not a codebase to extend.

## Status

Phase 1 in progress. The foundation is in place: schema, tenant isolation, and
the tests that prove it. Nothing is deployed and nothing is paid for.

## How it is put together

One application, not a fleet of services. The system is a **modular monolith**:
a single Next.js application, internally divided into modules that are switched
on or off per client through `organisations.feature_flags`. An internal
corporate training department sees the course and reporting modules; an
accredited Skills Development Provider sees the same system with the QCTO
portfolio-of-evidence and statutory reporting modules enabled.

That choice is deliberate. The architecture document imagines Kubernetes and
separately deployed microservices, which suits an organisation with engineers on
staff. For a small team, splitting the system that way multiplies the things
that can break without buying anything at this scale. Module boundaries are kept
clean in the code, so the split remains available later if it is ever needed.

| Layer | Choice |
|---|---|
| Web application | Next.js 16 (React 19), TypeScript |
| Styling | Tailwind CSS, with tenant branding injected as CSS custom properties |
| Database | PostgreSQL, accessed through Drizzle |
| Tenant isolation | PostgreSQL row-level security |
| Authentication | Auth.js — email and password for now, SAML and OIDC in Phase 3 |
| File storage | Local disk in development, S3-compatible in deployment |
| Tests | Vitest |

## Tenant isolation

Every table carries `organisation_id`, and every one of them is protected by a
row-level security policy. The application connects as `roft_app`, a database
role that owns nothing and is bound by those policies, so **it can see no rows
at all until a tenant context is set on the transaction**.

The practical effect: a query that forgets to filter by tenant returns nothing,
rather than returning another client's data. The failure mode is a visible bug
instead of a silent breach.

```ts
// Everything that touches tenant data goes through this.
const rows = await withTenant(organisationId, (tx) =>
  tx.select().from(courses),
);
```

Migrations, tenant provisioning and hostname lookup use a separate owner
connection via `withPlatformScope(reason, ...)`, which requires a written
reason that is recorded.

`tests/tenant-isolation.test.ts` proves all of this against a real database:
that a tenant sees its own rows, that an unfiltered query cannot reach another
tenant's, that cross-tenant writes, updates and deletes all fail, that context
does not leak between pooled connections, and that the application role cannot
switch row-level security off.

Two further rules live in the database rather than the application, because an
accreditation reviewer is entitled to ask what enforces them:

- **A moderator cannot moderate their own assessment decision.** A trigger
  rejects it.
- **The audit log cannot be amended.** Update and delete are revoked from the
  application role and blocked by a trigger for every role, including the owner.

## Signing in, roles and permissions

**Which client a request belongs to is decided by the hostname**, before anyone
signs in — the login page has to carry the right client's branding. A tenant is
reached at its subdomain (`acme.roftbusiness.org`) or its own domain
(`learning.acme.com`); the bare platform host is ROFT's own console.

**Sessions live in the database, not in a signed token.** Auth.js was the
obvious choice and does not support this: it cannot combine database sessions
with email-and-password login. That combination matters here, because a token
cannot be withdrawn. Suspending an assessor has to end their access on their
next request, not whenever a token happens to lapse, and an accreditation
reviewer is entitled to ask which sessions were live at a given moment. Auth.js
can still be added in Phase 3 for single sign-on, which is what it is good at.

What that buys, all covered by tests:

- The cookie holds a random token; only its SHA-256 hash is stored, so a copy
  of the sessions table contains no usable credential.
- Sessions have both an absolute lifetime and an idle window.
- Suspending a user, or changing a password, ends every session at once.
- Sign-in and sign-out are written to the audit log.
- Repeated failures lock one account without locking anyone else, and an
  unknown email address takes the same time to reject as a known one, so
  response timing cannot be used to discover who holds an account.

**Permissions live in `lib/rbac.ts`.** Code asks `can(session,
"course:publish")` rather than checking role names, so changing who may publish
a course is a change to one file. Rules that must hold even if that file is
wrong are enforced in the database instead — a moderator cannot moderate their
own decision, and nobody can amend the audit log.

Three properties the tests assert rather than assume:

- No single role holds both `assessment:assess` and `assessment:moderate`.
  Independent moderation is the point of the role.
- The External Verifier holds no permission whose name implies a write. The
  test derives that list from the permission names, so a future write
  permission is caught automatically.
- The Platform Owner can manage tenants but cannot read any tenant's learner
  data. Hosting a client's system is not the same as being entitled to read it.

## Course authoring and the publish gate

A course is built from sections, each holding lessons. It can stand alone, or
be bound to a **curriculum module** of a qualification — one Knowledge,
Practical skill or Workplace experience module, as the QCTO structure requires.

**Publishing is refused, not merely warned about**, while any of these is true:

- the course has no lessons;
- the course is tagged to no competency, so its completions could not be
  reported as capability coverage;
- any Internal Assessment Criterion of its curriculum module has no lesson
  covering it.

The third is the Learning Material Matrix. Accreditation requires a provider to
show that its material covers the official curriculum, and checking that by
hand across a qualification is exactly the kind of task that gets signed off
without really being checked. The course page shows a live readiness panel —
each criterion marked covered or not — and publishing names precisely what is
missing.

A warning would be published past. A refusal cannot be, which is the point: the
gap is found at authoring time rather than by an external verifier a year later.

Coverage counts only this course's own lessons. A lesson in a different course
on the same curriculum module does not make this one look covered — there is a
test for exactly that.

**A published course is fixed.** Learners' records refer to the version they
were assessed against, so editing in place would rewrite history. Changes go
into a new version; the published one is left exactly as it is, and competency
tags carry forward.

## Assessment and moderation

The chain a QCTO Portfolio of Evidence rests on: **learner submits → assessor
decides → moderator reviews independently**, with every step recorded and
nothing editable afterwards.

Four rules live in this layer rather than in the screens, because an
accreditation reviewer is entitled to ask what actually prevents them:

1. **Nobody assesses their own submission.**
2. **No moderator may moderate a decision they made as assessor.** Enforced
   twice — in the application for a clear message, and by a database trigger
   so it holds even if that check is ever removed. Both are tested, the trigger
   by inserting directly and confirming the database refuses.
3. **A signed decision is never edited.** A correction is a new decision that
   supersedes the old one, and both stay readable.
4. **Which decisions get moderated is decided by the system**, not chosen by
   the person being moderated: every summative decision, every decision by a
   newly registered assessor, and a configurable proportion of the rest (the
   QCTO baseline of 25%).

Other things worth knowing:

- **Correct answers never reach the browser.** They are not selected in the
  learner's query at all, which is the only reliable way to be sure they cannot
  be read out of the page source. There is a test that serialises the whole
  learner view and asserts the answer key is absent.
- **No partial credit.** A multiple-response question is correct only when the
  selected set matches exactly, otherwise ticking every box would pass.
- **A summative quiz is not auto-passed.** The automatic score informs the
  assessor's judgement; it does not replace it.
- **Evidence is hashed on upload** with SHA-256, stored beside the file. If a
  stored file is later altered it no longer matches, and the record is flagged.
  A test proves the tampering is detected.
- **`effectiveOutcome()` is the result that stands** — the moderator's revision
  where a decision was overturned, otherwise the assessor's. Reading the
  decision directly would misreport an overridden result.

## Statutory reporting (SAQA NLRD, WSP/ATR)

The point of doing this in software is not the file — anyone can write a CSV.
It is the **validation that runs before submission**. A return rejected by the
NLRD for a mistyped identity number or a missing equity code costs a provider a
full cycle, and those faults are invisible in a spreadsheet until the regulator
finds them.

So `/statutory` shows readiness first, and **the files stay locked while a
blocking problem remains** — enforced in the download route, not just hidden in
the interface, so requesting the file directly returns a 409 rather than a
return destined for rejection.

- **Blocking**: a missing or invalid identity number, a qualification with no
  SAQA ID, a provider with no accreditation number, an assessor with no
  registration number, an enrolment dated after the qualification's
  registration window closed.
- **Warnings**: missing equity or disability codes, a missing ward code, a
  module with no credit value. These do not stop the return but the NLRD flags
  them.

Every problem is reported, not just the first: a provider needs the complete
list of what to fix.

**Identity numbers are validated properly** — Luhn check digit, real calendar
date, valid citizenship digit, and century resolution so a two-digit year never
produces someone born in the future. That catches transcription errors, which
are the usual cause of a rejected return. `lib/south-african-id.ts` is pure and
heavily tested.

Four files are produced (Person 27, Enrolment 28, Achievement 29, Provider 30),
plus the WSP/ATR return grouped by OFO code. An achievement is a live
certificate — a completed, judged and where required moderated outcome — so
nothing weaker reaches the regulator. Internal corporate training that belongs
to no qualification is excluded: real training for the client, but not NLRD
business.

> **Before a live submission:** the field mapping follows the structure in the
> accreditation framework document, and the data is complete and validated. The
> exact Edu.Dex file layout — column order, fixed widths, code lists — must be
> confirmed against the current SAQA specification. That is a formatting step
> on validated data, not a gap in what is gathered.

## Reporting

The design document is explicit that this platform reports on **capability
coverage, not completion counts**. A list of finished courses tells you people
were busy; it does not tell you whether the workforce can do the work.

So the central report answers: which competencies does this workforce actually
hold? Two flags carry most of its value, and both describe workforce
vulnerability rather than performance:

- **No coverage** — nobody in scope holds the competency at all. A competency
  nobody holds still appears in the table; a gap is invisible if the report
  only lists what people already have.
- **Single point of failure** — exactly one person holds it, so a resignation
  or a period of sick leave removes the capability entirely.

**Capability is counted from certificates, not course completions.** A
completion means somebody reached the end of the material. A certificate means
a judgement was made and, where required, independently moderated. Only the
second is evidence, and counting the first would overstate coverage — which is
precisely the number a client would act on. Withdrawing a certificate removes
the capability, and one person holding several certificates for the same
competency counts once.

Alongside it: headline numbers, completion by course, and overdue training,
all filterable by team and site, with CSV export.

**Scope is decided once**, in `scopeFor()`, and every report uses it: an
administrator sees the tenant, a line manager sees their own direct reports and
nobody else, a learner sees themselves. The CSV route calls the same reporting
functions rather than querying separately — a download endpoint with its own
query is the obvious place for that rule to drift.

CSV exports neutralise values beginning `=`, `+`, `-` or `@`. Spreadsheet
software treats those as formulas, so a value taken from a person's own name
could otherwise execute on whoever opened the file.

## Certificates

A certificate is the platform's only outward-facing claim: that a named person
demonstrated named competencies. Issuing one therefore requires **all** of:

- the learner completed every lesson;
- every published summative assessment on the course was judged competent;
- where a judgement went to moderation, that moderation has finished.

A decision that was routed for moderation is *not* final, and neither is one a
moderator overturned — the moderator's revision decides, not the assessor's
original. Each of those is a separate test.

**Certificates issue themselves.** The two moments that can make someone
eligible — finishing the last lesson, and a moderation completing — attempt
issuance automatically. That path is deliberately not permission-checked
against the actor: a learner finishing a lesson holds no authority to issue
certificates and should need none. The platform issues because the rules were
met, which is the whole point. Issuance is also available manually to a tenant
administrator, and refuses with reasons when the rules are not met.

Issuance is idempotent: an enrolment that already holds a live certificate gets
that one back rather than a second.

**Verification is public**, at `/verify`, because the people who most need to
check a certificate — an employer, a SETA, a compliance officer — will never
have an account here. It asks for the printed reference and nothing else, and
returns only what is printed on the certificate.

The reference (`ROFT-XXXXX-XXXXX-XXXXX-XXXXX`) is ~100 bits of randomness, not
a sequence, so certificates cannot be enumerated. It excludes I, L, O, U, 0 and
1 so a handwritten reference cannot be misread, and is accepted however it is
typed — lower case, unspaced, or with the hyphens left out.

**Withdrawing** a certificate keeps the record and marks it revoked rather than
deleting it. Someone holding the paper deserves to be told it was withdrawn and
why; a certificate that simply vanishes from verification looks like a fault in
the system.

## Enrolment and the learner experience

People are assigned individually or in bulk — paste a column of email
addresses straight out of a spreadsheet. Bulk enrolment reports what happened
to **every** address rather than stopping at the first problem: enrolled,
already on the course, or not recognised. Someone pasting forty addresses needs
to know which three were wrong.

**Only a published course can be assigned.** A draft has not passed its publish
gate, so nothing has confirmed its content covers what it claims to.

The learner sees their courses with progress, opens one, works through the
lessons and marks each complete. The player opens on the first unfinished
lesson, so returning resumes rather than restarting. Completion is *derived*
from progress rather than set by hand, so the two cannot drift apart.

Separation between people inside one client is enforced in the data layer, not
the pages:

- A learner cannot open a colleague's enrolment, even with a direct link.
- **Nobody can mark a lesson complete on a learner's behalf** — not even an
  administrator. Progress is evidence; a completion record an administrator
  could fabricate would prove only that somebody clicked a button.
- A lesson must belong to the course the enrolment is for. Without that check a
  crafted request could complete a course the learner never opened.

Administrators and instructors see everyone on a course with their progress and
due dates. Overdue is a stored status computed by one query, so a report and a
reminder email cannot disagree about who is late.

## Getting set up

Requires Node.js 20 or later and PostgreSQL 16 or later.

**Everyday use, once set up:** double-click **`start-lms.bat`**. It checks the
database, applies any schema changes, loads demo data if the database is empty,
starts the server and opens the browser. It never overwrites existing data. To
wipe the demo tenants and start again, run `reset-demo-data.bat`.

The rest of this section is the one-time setup that batch file expects.

**1. Install PostgreSQL** (once, needs administrator rights):

```bash
winget install -e --id PostgreSQL.PostgreSQL.18
```

**2. Create the database:**

```bash
createdb -U postgres roft_lms
```

**3. Configure the environment:**

```bash
cp .env.example .env.local
```

Fill in the two connection strings and `ROFT_APP_DB_PASSWORD`. Generate the
auth secret with `npx auth secret`. `.env.local` is git-ignored and must never
be committed.

**4. Create the tables and apply the security policies:**

```bash
npm run db:push
```

**5. Load the demo data:**

```bash
npm run db:seed
```

**6. Run it:**

```bash
npm run dev
```

Then open **http://acme.localhost:3000** — not `localhost:3000`, which is the
platform console and has no tenant. Any `*.localhost` address resolves to your
own machine without configuring anything.

### Demo accounts

Two tenants, deliberately. A single-tenant demo cannot show you whether
isolation works; with two you can try one client's login at the other and watch
it fail.

| Address | Organisation |
|---|---|
| http://acme.localhost:3000 | Acme Mining Services — navy and gold, QCTO modules on |
| http://harbourtraining.localhost:3000 | Harbour Training Centre — green and orange, QCTO modules off |

Every demo account uses the password `roft-demo-2026`.

| Email | Role |
|---|---|
| admin@acme.test | Administrator |
| instructor@acme.test | Instructor |
| assessor@acme.test | Assessor |
| moderator@acme.test | Moderator |
| manager@acme.test | Line Manager |
| sdf@acme.test | Skills Development Facilitator |
| verifier@acme.test | External Verifier |
| learner@acme.test | Learner |
| both@acme.test | Instructor and Assessor at once |
| admin@harbour.test | Administrator at the second tenant |
| learner@harbour.test | Learner at the second tenant |

Worth trying: sign in as `learner@acme.test` and then as `admin@acme.test` and
compare what each may do; then take Acme's email and password to
`harbourtraining.localhost:3000` and watch them be refused.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on http://localhost:3000 |
| `npm run check` | Typecheck, lint and test — run this before every commit |
| `npm test` | Run the test suite |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:push` | Apply the schema and security policies to the database |
| `npm run db:studio` | Browse the database in a web interface |

### A known rough edge

The tests run against the same database as development. They clean up the
tenants they create, but the audit log is append-only by design, so test
entries accumulate there and cannot be removed. Harmless — the log is scoped
per tenant and those tenants are gone — but the tests should point at their own
database. Worth doing before anyone else works on this.

## The data model

`db/schema/` holds four files:

- **`tenancy.ts`** — organisations, users, the nine roles, the audit log, and
  competency frameworks.
- **`curriculum.ts`** — qualifications and their Knowledge, Practical and
  Workplace modules; internal assessment criteria; courses, sections and
  lessons; and the tables that map content to competencies and criteria.
- **`learning.ts`** — enrolments and progress records.
- **`assessment.ts`** — the item bank, submissions, evidence artifacts with
  SHA-256 integrity hashes, assessor decisions, the moderation queue and
  records, and certificates.

Nine roles rather than the design document's seven: Skills Development
Facilitator and External Verifier are added because the QCTO workflow needs
them.

## Deployment

Nothing is deployed yet, and nothing has been purchased.

Note that `roftbusiness.org` runs on Hostinger Website Builder, which serves
static pages only and cannot host this application. The likely path is a small
VPS — Hostinger has a Johannesburg data centre, which would keep learner data in
South Africa for POPIA and QCTO purposes — with the LMS at a subdomain such as
`lms.roftbusiness.org` and the existing website left untouched.

That gets costed and agreed before anything is bought.
