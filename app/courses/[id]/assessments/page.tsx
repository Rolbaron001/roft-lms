import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { AuthoringError, getCourse } from "@/lib/authoring";
import { listCourseAssessments } from "@/lib/assessment";
import { AppShell } from "@/components/app-shell";
import { AssessmentManager } from "./assessment-manager";

export default async function CourseAssessmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
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

  const assessments = await listCourseAssessments(session, id);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/courses/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {detail.course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Assessments</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A formative quiz is marked automatically. A summative assessment is
          always judged by a person and always moderated independently, because
          it is the one that counts towards a qualification.
        </p>
      </div>

      <AssessmentManager
        courseId={id}
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
