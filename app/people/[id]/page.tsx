import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  getPerson,
  PeopleError,
  possibleLineManagers,
  proposeMailboxAddress,
  takenMailboxAddresses,
} from "@/lib/people";
import { mailDomainFor } from "@/lib/mail";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { PersonEditor } from "./person-editor";
import { EnrolmentDocuments } from "./documents";
import { Appeals } from "./appeals";
import { Support } from "./support";
import { Missed } from "./missed";
import { learnerMissedAssessments, learnerSupport } from "@/lib/support";
import { dateInZone } from "@/lib/timezone";
import {
  assessmentsForLearner,
  cohortsForLearner,
  learnerAppeals,
} from "@/lib/appeals";
import {
  enrolmentReadiness,
  learnerDocuments,
  type EnrolmentRoute,
} from "@/lib/enrolment-documents";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ route?: string }>;
}) {
  const { id } = await params;
  const { route } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("user:read");

  let detail;
  try {
    detail = await getPerson(session, id);
  } catch (error) {
    if (error instanceof PeopleError && error.code === "not_found") notFound();
    throw error;
  }

  const managers = await possibleLineManagers(session, id);
  const { person } = detail;

  // Documents are only asked of learners. Showing the checklist against an
  // assessor would invent a requirement nobody has.
  const isLearner = detail.roles.some((row) => row.role === "learner");
  const canManageEnrolments = session.permissions.includes("enrolment:manage");

  const chosenRoute = (
    [
      "standard_qualification",
      "skills_programme",
      "learnership",
      "rpl",
      "employment_equity",
    ] as const
  ).includes(route as EnrolmentRoute)
    ? (route as EnrolmentRoute)
    : "standard_qualification";

  const readiness =
    isLearner && canManageEnrolments
      ? await enrolmentReadiness(session, id, chosenRoute)
      : null;
  const held =
    isLearner && canManageEnrolments ? await learnerDocuments(session, id) : [];

  // Appeals are only ever about a learner, and only shown to somebody who can
  // work one. A learner reads their own from their own page, not this one.
  const canManageAppeals =
    isLearner && session.permissions.includes("appeal:manage");

  // Support is shown to anybody who has to act on it, and the detail behind it
  // only to those entitled to read it. The redaction happens in the library,
  // not here, so a page cannot leak it by forgetting.
  const canActOnSupport =
    isLearner && session.permissions.includes("support:act");
  const canReadSupport = session.permissions.includes("support:read");
  const canManageSupport = session.permissions.includes("support:manage");
  const today = dateInZone(new Date(), tenant.timezone);

  // The assessments this learner has sat. Both an appeal against a result and a
  // missed summative date are filed against one, and the two sections are
  // reached by different permissions - so it is loaded for either.
  const satAssessments =
    canManageAppeals || canActOnSupport
      ? await assessmentsForLearner(session, id)
      : [];

  const [supportRecords, missed] = canActOnSupport
    ? await Promise.all([
        learnerSupport(session, id),
        learnerMissedAssessments(session, id),
      ])
    : [[], []];
  const [appealCohorts, lodged] = canManageAppeals
    ? await Promise.all([
        cohortsForLearner(session, id),
        learnerAppeals(session, id),
      ])
    : [[], []];

  // The domain a tenant's mailboxes live on. ROFT's own people sit on the
  // mail domain itself; a client's sit on a subdomain of it, so an address
  // plainly belongs to that client rather than to ROFT.
  const mailDomain = mailDomainFor(tenant.slug);
  const proposedMailbox = proposeMailboxAddress(
    person.firstName,
    person.lastName,
    mailDomain,
    await takenMailboxAddresses(session),
  );
  const isSelf = person.id === session.userId;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/people"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← All people
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {person.firstName} {person.lastName}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {person.email}
              {person.lastLoginAt
                ? ` · last signed in ${person.lastLoginAt.toLocaleDateString("en-ZA")}`
                : " · has not signed in yet"}
            </p>
          </div>
          <StatusBadge status={person.status} />
        </div>

        <p className="mt-3 text-sm text-[var(--muted)]">
          {detail.enrolmentCount}{" "}
          {detail.enrolmentCount === 1 ? "course" : "courses"} ·{" "}
          {detail.certificateCount}{" "}
          {detail.certificateCount === 1 ? "certificate" : "certificates"}
        </p>
      </div>

      {person.status === "anonymised" ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium">This record was anonymised</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            The personal details were erased on{" "}
            {person.anonymisedAt?.toLocaleDateString("en-ZA")} at the person&rsquo;s
            request. Their {detail.certificateCount}{" "}
            {detail.certificateCount === 1 ? "certificate remains" : "certificates remain"}{" "}
            valid and verifiable, because a qualification once earned has to
            stay on the national record.
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Nothing here can be edited.
          </p>
        </section>
      ) : (
        <PersonEditor
          userId={person.id}
          isSelf={isSelf}
          mailboxAddress={person.mailboxAddress}
          proposedMailbox={proposedMailbox}
          status={person.status}
          surname={person.lastName}
          defaults={{
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            jobTitle: person.jobTitle,
            team: person.team,
            site: person.site,
            lineManagerId: person.lineManagerId,
            ofoCode: person.ofoCode,
            nationalId: person.nationalId,
            gender: person.gender,
            equityCode: person.equityCode,
            disabilityCode: person.disabilityCode,
            nationality: person.nationality,
          }}
          roles={detail.roles.map((row) => row.role)}
          registrationNumbers={Object.fromEntries(
            detail.roles.map((row) => [row.role, row.registrationNumber]),
          )}
          managers={managers.map((manager) => ({
            id: manager.id,
            label: `${manager.firstName} ${manager.lastName}`,
          }))}
          canManageRoles={session.permissions.includes("user:manage_roles")}
          canAnonymise={session.permissions.includes("user:anonymise")}
        />
      )}

      {canActOnSupport ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Support
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            What is being done for this learner, and by whom. The reason behind
            an accommodation is health or financial information and is held
            apart from it, because doing the accommodating does not require
            knowing why.
          </p>
          <Support
            learnerId={id}
            records={supportRecords}
            canRead={canReadSupport}
            canManage={canManageSupport}
            today={today}
          />
        </section>
      ) : null}

      {canActOnSupport ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Missed summative dates
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            One additional date, and one only. Where that is also missed on
            medical grounds the learner goes to an oral assessment with an
            observer from the employer.
          </p>
          <Missed
            learnerId={id}
            records={missed}
            assessments={satAssessments}
            canManage={canManageSupport}
            today={today}
          />
        </section>
      ) : null}

      {canManageAppeals ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Appeals
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            Against a result, or against an assessor&rsquo;s conduct. Receipt is
            acknowledged within two hours, and the clock starts when it is
            lodged here.
          </p>
          <Appeals
            learnerId={id}
            zone={tenant.timezone}
            cohorts={appealCohorts}
            assessments={satAssessments}
            existing={lodged.map((appeal) => ({
              id: appeal.id,
              ground: appeal.ground,
              cohortName: appeal.cohortName,
              lodgedAt: appeal.lodgedAt,
              status: appeal.status,
              outcome: appeal.outcome,
            }))}
            canManage
          />
        </section>
      ) : null}

      {readiness ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Enrolment documents
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            Checked as they are collected rather than when a return is being
            assembled. A missing certified copy found months later is far
            harder to get, and the deadline is usually days away by then.
          </p>
          <EnrolmentDocuments
            userId={id}
            readiness={readiness}
            held={held.map((document) => ({
              id: document.id,
              kind: document.kind,
              filename: document.filename,
              certifiedOn: document.certifiedOn,
              verification: document.verification,
              refusedReason: document.refusedReason,
            }))}
            canManage={canManageEnrolments}
          />
        </section>
      ) : null}
    </AppShell>
  );
}
