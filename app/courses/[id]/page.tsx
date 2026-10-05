import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant, said } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { extensionState } from "@/lib/extensions";
import { FolderPicker } from "@/components/folder-picker";
import { DrivePicker } from "@/components/drive-picker";
import { connectionsFor } from "@/lib/drive";
import {
  AuthoringError,
  coverageReport,
  getCourse,
  listCompetencies,
} from "@/lib/authoring";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { PointHere } from "@/components/progress-map";
import { QualificationNav } from "@/components/qualification-nav";
import { qualificationOfCourse, verificationOf } from "@/lib/qualification-build";
import { BuildForm } from "@/app/qualifications/[id]/verify/verify-forms";
import { CourseEditor } from "./course-editor";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const session = await requirePermission("course:read");
  // Drive and OneDrive are offered wherever a folder is, so a provider
  // who keeps their material there never has to download it first.
  const drives = session.permissions.includes("qualification:manage")
    ? await connectionsFor(session)
    : [];

  const canAuthorHere = session.permissions.includes("course:author");
  const extension = await said(await extensionState(session));
  const mayUseExtension = extension.registered ? extension : null;

  let detail;
  try {
    detail = await getCourse(session, id);
  } catch (error) {
    if (error instanceof AuthoringError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const [report, allCompetencies] = await Promise.all([
    coverageReport(session, id),
    listCompetencies(session),
  ]);

  /*
   * A study unit's course is built by the platform and goes live with its
   * qualification (Roland, 2 October 2026: "Moving to the build page, I have
   * no idea (as a user) what to do. There is no assistant."). So its page says
   * where it came from, what it holds, and the one thing left, rather than
   * offering an empty editor to fill by hand.
   */
  const qualificationId = await qualificationOfCourse(session, id);
  const unit =
    qualificationId && canAuthorHere && session.permissions.includes("assessment:author")
      ? (await said(await verificationOf(session, qualificationId))).units.find((one) => one.courseId === id) ?? null
      : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/courses"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          {t("courseEdit.all", { courses: words.lowerMany("course") })}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{detail.course.title}</h1>
          <div className="flex items-center gap-3">
            {/*
              The order a learner walks it in, which is what turns everything
              held against this course into something anybody meets. Listed
              first because a course with no steps delivers nothing, however
              much material is filed against it.
            */}
            {canAuthorHere ? (
              <Link
                href={`/courses/${id}/steps`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                {t("courseEdit.steps")}
              </Link>
            ) : null}
            {session.permissions.includes("assessment:author") ? (
              <Link
                href={`/courses/${id}/assessments`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                {t("courseEdit.assessments")}
              </Link>
            ) : null}
            {session.permissions.includes("enrolment:read_all") ? (
              <Link
                href={`/courses/${id}/enrolments`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                {t("courseEdit.enrolments")}
              </Link>
            ) : null}
            {detail.course.version > 1 ? (
              <span className="text-xs text-[var(--muted)]">
                {t("courseList.version", { number: detail.course.version })}
              </span>
            ) : null}
            <StatusBadge status={detail.course.status} />
          </div>
        </div>
        {detail.course.description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {detail.course.description}
          </p>
        ) : null}
      </div>

      {qualificationId ? <QualificationNav qualificationId={qualificationId} current={id} /> : null}

      {qualificationId && unit && !unit.live ? (
        <div className="mb-6">
          <Card>
            <p className="text-sm font-medium">{t("unitGuide.title")}</p>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
              {t("unitGuide.holds", {
                steps: unit.steps,
                assessments: unit.assessments.length,
              })}
            </p>
            {unit.blocking.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[var(--danger)]">
                {unit.blocking.slice(0, 5).map((item, index) => (
                  <li key={index}>
                    {item.href ? (
                      <Link href={item.href} className="underline-offset-2 hover:underline">
                        {item.what}
                      </Link>
                    ) : (
                      item.what
                    )}
                    {item.guideHref ? (
                      <a href={item.guideHref} className="ml-2 whitespace-nowrap underline underline-offset-2">
                        {t("verify.openGuide")}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3">
              <PointHere>
                <Link href={`/qualifications/${qualificationId}/verify`} className="underline underline-offset-2">
                  {unit.steps === 0 ? t("unitGuide.build") : t("unitGuide.verify")}
                </Link>
              </PointHere>
            </div>
            {/* Here as well as on the check page, where it was too easily missed
                (Roland, 2 October: "there's no button to select Build again"). */}
            <div className="mb-3">
              <BuildForm qualificationId={qualificationId} again={unit.steps > 0} />
            </div>
            <p className="text-xs text-[var(--muted)]">{t("unitGuide.change")}</p>
          </Card>
        </div>
      ) : null}

      {detail.course.status === "published" ? (
        <Card>
          <p className="text-sm">
            {t("courseEdit.published")}
            {session.permissions.includes("course:author") ? ` ${t("courseEdit.publishedAuthor")}` : ""}
          </p>
        </Card>
      ) : null}

      <div className="mt-6">
        <CourseEditor
          workplaceRecordWord={words.one("workplaceRecord")}
          courseId={id}
          status={detail.course.status}
          sections={detail.sections.map((section) => ({
            id: section.id,
            title: section.title,
            lessons: section.lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              contentType: lesson.contentType,
              mediaFilename: lesson.mediaFilename,
              mediaMimeType: lesson.mediaMimeType,
            })),
          }))}
          taggedCompetencies={detail.competencies.map((row) => ({
            competencyId: row.competencyId,
            code: row.code,
            name: row.name,
          }))}
          availableCompetencies={allCompetencies.map((row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
          }))}
          report={report}
          canAuthor={session.permissions.includes("course:author")}
          canPublish={session.permissions.includes("course:publish")}
        />
      </div>

      {canAuthorHere ? (
        <div className="mb-6">
          <Card
            title={t("courseEdit.folder")}
            description={t("courseEdit.folderNote")}
          >
            <FolderPicker
              courseId={id}
              label={t("courseEdit.folderLabel")}
              extension={
                mayUseExtension
                  ? {
                      on: extension.on,
                      available: extension.availability?.available ?? false,
                        registered: extension.registered,
                      reason: extension.availability?.reason ?? null,
                    }
                  : null
              }
              hint={
                <>
                  {t("courseEdit.folderHint")}
                  <br />
                  {t("courseEdit.folderHint2")}
                </>
              }
            />
          </Card>
        </div>
      ) : null}

      {drives.length > 0 ? (
        <div className="mt-6">
          <Card
            title={t("courseEdit.drive")}
            description={t("courseEdit.driveNote")}
          >
            <DrivePicker
              drives={drives.map((one) => ({
                provider: one.provider,
                label: one.label,
                accountLabel: one.accountLabel,
              }))}
              courseId={id}
            />
          </Card>
        </div>
      ) : null}

    </AppShell>
  );
}
