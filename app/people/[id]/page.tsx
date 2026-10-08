import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { maybe } from "@/lib/i18n/maybe";
import { HOURS_TO_ACKNOWLEDGE } from "@/lib/appeals";
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
import { PageNav } from "@/components/page-nav";
import { mayViewAs } from "@/lib/view-as";
import { startViewAsAction } from "../view-as-actions";
import { EnrolmentDocuments } from "./documents";
import { Appeals } from "./appeals";
import { Support } from "./support";
import { Missed } from "./missed";
import { Conduct } from "./conduct";
import { HEARING_NOTICE_HOURS, learnerCases } from "@/lib/conduct";
import { externalRecordsFor } from "@/lib/xapi";
import { awardsFor } from "@/lib/qualification-awards";
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
  const { t, day } = await pageLocale();

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

  // Discipline is held by the coordinating roles only. A facilitator who could
  // issue a final written warning to somebody who annoyed them this morning is
  // a provider with a dispute it will lose.
  const canManageConduct =
    isLearner && session.permissions.includes("conduct:manage");
  const conductCases = canManageConduct ? await learnerCases(session, id) : [];

  // Learning recorded by another system and imported here (job sheet A10).
  const elsewhere =
    isLearner && session.permissions.includes("enrolment:read_all")
      ? await externalRecordsFor(session, id)
      : [];

  // The qualification certificates the learner has received (job sheet D2).
  const awards =
    isLearner && session.permissions.includes("enrolment:read_all")
      ? await awardsFor(session, id)
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
          {t("personPage.all")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {person.firstName} {person.lastName}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {person.email}
              {person.lastLoginAt
                ? t("personPage.lastSignedIn", { date: day(person.lastLoginAt) })
                : t("personPage.neverSignedIn")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* "View as" (lib/view-as.ts): the platform exactly as this person
                sees it, read-only, for an administrator checking it works. */}
            {mayViewAs(session) && person.id !== session.userId && person.status === "active" ? (
              <form action={startViewAsAction}>
                <input type="hidden" name="userId" value={person.id} />
                <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-accent)]/10">
                  {t("viewAs.start", { person: person.firstName })}
                </button>
              </form>
            ) : null}
            <StatusBadge
              status={person.status}
              label={maybe(t, `userStatus.${person.status}`) ?? undefined}
            />
          </div>
        </div>

        <p className="mt-3 text-sm text-[var(--muted)]">
          {detail.enrolmentCount === 1
            ? t("personPage.oneCourse")
            : t("personPage.courses", { count: detail.enrolmentCount })}{" "}
          ·{" "}
          {detail.certificateCount === 1
            ? t("personPage.oneCertificate")
            : t("personPage.certificates", { count: detail.certificateCount })}
        </p>
      </div>

      <PageNav />

      {person.status === "anonymised" ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium">{t("personPage.anonymised")}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {detail.certificateCount === 1
              ? t("personPage.anonymisedOne", {
                  date: day(person.anonymisedAt),
                })
              : t("personPage.anonymisedMany", {
                  date: day(person.anonymisedAt),
                  count: detail.certificateCount,
                })}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("personPage.noEdit")}</p>
        </section>
      ) : (
        <div id="details" data-page-section={t("personPage.detailsSection")} className="scroll-mt-28">
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
        </div>
      )}

      {canManageConduct ? (
        <section id="conduct" data-page-section={t("personPage.conduct")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.conduct")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("personPage.conductIntro")}</p>
          <Conduct
            learnerId={id}
            zone={tenant.timezone}
            cases={conductCases}
            today={today}
            noticeHours={HEARING_NOTICE_HOURS}
          />
        </section>
      ) : null}

      {canActOnSupport ? (
        <section id="support" data-page-section={t("personPage.support")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.support")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("personPage.supportIntro")}</p>
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
        <section id="missed" data-page-section={t("personPage.missed")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.missed")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("personPage.missedIntro")}</p>
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
        <section id="appeals" data-page-section={t("personPage.appeals")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.appeals")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            {t("personPage.appealsIntro", { hours: HOURS_TO_ACKNOWLEDGE })}
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
        <section id="documents" data-page-section={t("personPage.documents")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.documents")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("personPage.documentsIntro")}</p>
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

      {awards.length > 0 ? (
        <section id="awarded" data-page-section={t("personPage.awarded")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.awarded")}
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {awards.map((award) => (
              <li key={award.id}>
                <Link
                  href={`/readiness/${award.qualificationId}/${id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {award.qualificationTitle}
                </Link>{" "}
                <span className="text-[var(--muted)]">
                  {t("personPage.award", {
                    number: award.certificateNumber,
                    by: award.awardedBy,
                    date: day(award.awardedOn),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {elsewhere.length > 0 ? (
        <section id="elsewhere" data-page-section={t("personPage.elsewhere")} className="mt-6 scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("personPage.elsewhere")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("personPage.elsewhereIntro")}</p>
          <ul className="space-y-1 text-sm">
            {elsewhere.map((row) => (
              <li key={row.id}>
                <span className="font-medium">{row.verb}</span>{" "}
                {row.objectName ?? row.objectId}
                {row.success === true
                  ? t("personPage.passed")
                  : row.success === false
                    ? t("personPage.notPassed")
                    : ""}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {row.occurredAt ? day(row.occurredAt) : t("personPage.noDate")} ·{" "}
                  {row.source}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AppShell>
  );
}
