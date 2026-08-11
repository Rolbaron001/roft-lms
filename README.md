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

## Getting set up

Requires Node.js 20 or later and PostgreSQL 16 or later.

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

**5. Run it:**

```bash
npm run dev
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on http://localhost:3000 |
| `npm run check` | Typecheck, lint and test — run this before every commit |
| `npm test` | Run the test suite |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:push` | Apply the schema and security policies to the database |
| `npm run db:studio` | Browse the database in a web interface |

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
