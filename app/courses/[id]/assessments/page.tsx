import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { AuthoringError, getCourse } from "@/lib/authoring";
import {
  listCourseAssessments,
  listCourseCriteria,
  listCourseQuestions,
} from "@/lib/assessment";
import { AppShell } from "@/components/app-shell";
import { AssessmentManager } from "./assessment-manager";

export default async function CourseAssessmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const session = await requirePermission("assessment:author");

  let detail;
  try {
    detail = await getCourse(session, id);
  } catch (error) {
    if (error instanceof AuthoringError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const [assessments, criteria, questions] = await Promise.all([
    listCourseAssessments(session, id),
    listCourseCriteria(session, id),
    listCourseQuestions(session, id),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/courses/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {detail.course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("courseAssess.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("courseAssess.intro")}</p>
      </div>

      <AssessmentManager
        workplaceRecordWord={words.one("workplaceRecord")}
        courseId={id}
        criteria={criteria}
        questions={questions}
        assessments={assessments.map((row) => ({
          id: row.id,
          title: row.title,
          type: row.type,
          purpose: row.purpose,
          status: row.status,
          passMark: row.passMark,
          moderationSampleRate: Number(row.moderationSampleRate),
          itemCount: row.itemCount,
        }))}
      />
    </AppShell>
  );
}
