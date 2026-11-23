import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { assessmentPapers, courses, studyUnits } from "@/db/schema";
import { localeFor, requireSession, requireTenant } from "@/lib/request";
import { guestMayOpenQualification } from "@/lib/guest";
import { translator } from "@/lib/i18n";
import { stepsForPreview } from "@/lib/spine";
import { AppShell } from "@/components/app-shell";
import { QualificationNav } from "@/components/qualification-nav";
import { StudyUnitView } from "@/app/learn/[id]/study-unit-view";

/**
 * One study unit as a learner sees it, everything open, for an administrator
 * checking it (Roland, 5 October 2026). The learner's own page, drawn in
 * preview: no cohort is needed, nothing is recorded, and each workbook opens
 * in the paper preview where nothing can be handed in.
 */
export default async function UnitPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; unitId: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { id, unitId } = await params;
  const { doc } = await searchParams;
  const tenant = await requireTenant();
  const session = await requireSession();
  // Staff who build it, or a Guest where it is open to guests (D51).
  const guest = !session.permissions.includes("course:author");
  if (guest && !(await guestMayOpenQualification(session, id))) redirect("/not-permitted");
  const locale = localeFor(tenant, session);
  const t = translator(locale);

  const course = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ id: courses.id })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(and(eq(studyUnits.id, unitId), eq(studyUnits.qualificationId, id)));
    return row ?? null;
  });
  const steps = course ? await stepsForPreview(session, course.id) : [];

  // The paper each workbook or assessment opens to, published or not: an
  // administrator checking before going live needs to see the drafts too.
  const assessmentIds = steps.filter((step) => step.kind === "assessment").map((step) => step.targetId);
  const papers = new Map<string, string>();
  if (assessmentIds.length) {
    const rows = await withTenant(session.organisationId, (tx) =>
      tx
        .select({ id: assessmentPapers.id, assessmentId: assessmentPapers.assessmentId })
        .from(assessmentPapers)
        .where(inArray(assessmentPapers.assessmentId, assessmentIds))
        .orderBy(asc(assessmentPapers.sortOrder)),
    );
    for (const row of rows) if (!papers.has(row.assessmentId)) papers.set(row.assessmentId, row.id);
  }

  const view = await StudyUnitView({
    session,
    enrolmentId: "",
    studyUnitId: unitId,
    steps,
    isOwn: false,
    t,
    dateLocale: locale,
    preview: { qualificationId: id, papers },
    chosenDoc: doc ?? null,
    basePath: `/qualifications/${id}/learner/${unitId}`,
  });
  if (!view) notFound();

  return (
    <AppShell tenant={tenant} session={session}>
      {guest ? null : <QualificationNav qualificationId={id} current={course?.id ?? "preview"} />}
      {view}
      {!course && !guest ? (
        <p className="mt-6 text-sm text-[var(--muted)]">
          {t("learnPreview.notBuilt")}{" "}
          <Link href={`/qualifications/${id}/verify`} className="underline underline-offset-2">
            {t("learnPreview.build")}
          </Link>
        </p>
      ) : null}
    </AppShell>
  );
}
