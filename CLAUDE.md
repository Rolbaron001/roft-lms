# ROFT Learning Management System - Production Build

This project is the production build of the ROFT Learning Management System. It
follows on from deliverables already produced for this project, in the
`Learning Management System` folder two levels up:

- `Design/ROFT_LMS_Design.docx` - the full platform design: objectives, user
  roles, functional requirements, multi-tenancy model, architecture, data model,
  technology stack, the assessment and moderation workflow, security, deployment
  options, and a phased roadmap. Read this in full before writing code.
- `Design/Enterprise Learning Management System Architecture and QCTO
  Accreditation Framework for ROFT Business - GEMINI.docx` - the South African
  regulatory layer: QCTO tripartite curricula (Knowledge, Practical, Workplace
  modules), the digital Portfolio of Evidence and moderation lifecycle, the EISA
  readiness calculation, SAQA NLRD / Edu.Dex exports, OFO codes, WSP/ATR
  reporting, and POPIA obligations. Roland has confirmed this is in scope from
  Phase 1, not deferred. Read it alongside the design document.
- `Design/What_Is_An_LMS.docx` - a plain-language explainer of LMS concepts,
  useful background if a term in the design document is unclear.
- `App/lms_prototype/` - a working Phase 1 proof-of-concept built in Flask and
  SQLite. It proved the core mechanics (tenant model, role-based logins, course
  authoring, enrolment, a graded quiz, progress tracking) live to a client. It is
  NOT the production codebase and should not be extended in place. Treat it as a
  reference for the intended behaviour, not as a starting point to build from.

## Who you are working with

Roland Jones, the founder of ROFT Strategic Workforce Advisory, is directing this
build. He has an IT background (National Diploma in Information Technology) but
describes his software development skills as dated, and relies on AI-assisted
development rather than writing code himself. Explain technical decisions in
plain terms when they affect what he needs to decide (cost, timeline, hosting,
what he can and cannot change later), but do not over-explain routine
implementation detail he has already delegated.

## How to work on this project

1. Read `Doc2_ROFT_LMS_Design.docx` before doing anything else. If you cannot
   parse `.docx` directly, ask Roland to also drop a plain-text or markdown
   export of it into this folder, or extract it yourself with a short Python
   script (`python-docx` is the library used to build it).
2. Propose an implementation plan before writing code, phased the way Section 12
   of the design document phases it (MVP, then accreditation and multi-tenancy,
   then integration and on-premise, then scale and analytics). Confirm the plan
   with Roland before starting each phase.
3. Follow the technology stack recommended in Section 8 of the design document:
   React (Next.js) frontend, Node.js or Python (FastAPI) backend organised as
   focused services, PostgreSQL, S3-compatible object storage, a dedicated
   xAPI-compliant learning record store, SAML/OAuth authentication, and Docker
   packaging so the same containers can run as a shared cloud tenant, a
   dedicated cloud tenant, or an on-premise deployment (Section 5 and Section 11).
4. Build against the data model in Section 7 (Organisation, User, Role,
   Competency Framework, Competency, Course, Module/Lesson, Learning Path,
   Enrolment, Progress Record, Assessment, Assessment Result, Certificate).
5. Multi-tenancy is not an afterthought. Every table and every query should be
   tenant-scoped from the first commit, not retrofitted later.
6. Keep the workforce-risk framing throughout any user-facing copy: risk means
   workforce capability vulnerability (skills gaps, ineffective management,
   single points of failure), never financial fraud or regulatory compliance.
7. Set up a proper git repository, a README, and automated tests as the codebase
   grows. Do not accumulate untested code the way a quick prototype would.
8. Ask before making an irreversible or costly decision (choosing a paid hosting
   provider, a paid third-party service, a database migration that loses data).

## Decisions already taken

These were agreed with Roland at the start of the build. Do not silently revisit
them; raise it with him if one looks wrong.

- **QCTO-first.** The Phase 1 data model carries the South African
  accreditation structure from the first migration rather than having it
  retrofitted. This means Phase 1 spans what Section 12 splits across Phases 1
  and 2. Country-specific detail stays configuration, so a non-South African
  tenant is unaffected.
- **TypeScript throughout, one application.** Next.js and React, with a
  PostgreSQL database accessed through Drizzle. Not the microservices
  architecture the QCTO document describes: a modular monolith with per-tenant
  feature flags, which is what a small team can actually maintain. Section 8 of
  the design document permits this ("Node.js or Python, organised as a small
  number of focused services").
- **Nine roles, not seven.** The design document's seven, plus Skills
  Development Facilitator and External Verifier, which the QCTO workflow needs.
- **Tenant isolation via PostgreSQL row-level security**, with the application
  connecting as a non-owner role that the policies bind. See the README.
- **Development is local for now.** Roland does not want to pay for hosting
  before there is something to show. `roftbusiness.org` is on Hostinger Website
  Builder and cannot host this application; the likely deployment target is a
  small VPS in Hostinger's Johannesburg region, at a subdomain, costed and
  agreed before anything is bought.
- **Code lives at github.com/Rolbaron001**, in a private repository.

## Working notes

- Run `npm run check` (typecheck, lint, test, build) before every commit. The
  build is in there deliberately: typecheck and tests both pass on code that
  will not bundle. The usual cause is a client component importing from a
  module that reaches into the database, which drags the Postgres driver into
  the browser bundle and fails with "can't resolve 'net'". Keep constants a
  form needs in a file that imports nothing, the way `lib/curriculum-shape.ts`
  does.
- `tests/tenant-isolation.test.ts` is not optional and not to be weakened. If a
  change makes it fail, the change is wrong.
- Roland's account is `Rolbaron001`. Do not create GitHub repositories,
  purchase hosting, or sign up for services on his behalf without asking.
