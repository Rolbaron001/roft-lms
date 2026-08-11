import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  AuthoringError,
  coverageReport,
  getCourse,
  listCompetencies,
} from "@/lib/authoring";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { CourseEditor } from "./course-editor";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

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

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/courses"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← All courses
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{detail.course.title}</h1>
          <div className="flex items-center gap-2">
            {detail.course.version > 1 ? (
              <span className="text-xs text-[var(--muted)]">
                version {detail.course.version}
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

      {detail.course.status === "published" ? (
        <Card>
          <p className="text-sm">
            This course is published, so its content is fixed. Learners who
            completed it have records that refer to exactly this version.
            {session.permissions.includes("course:author")
              ? " To change it, open a new version — the published one stays as it is."
              : ""}
          </p>
        </Card>
      ) : null}

      <div className="mt-6">
        <CourseEditor
          courseId={id}
          status={detail.course.status}
          sections={detail.sections.map((section) => ({
            id: section.id,
            title: section.title,
            lessons: section.lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              contentType: lesson.contentType,
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
    </AppShell>
  );
}
