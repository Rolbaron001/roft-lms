import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCourses } from "@/lib/authoring";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical",
  workplace: "Workplace",
  general: "General",
};

export default async function CoursesPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");
  const courses = await listCourses(session);

  const canAuthor = session.permissions.includes("course:author");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Courses</h1>
        {canAuthor ? (
          <Link
            href="/courses/new"
            className="rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            New course
          </Link>
        ) : null}
      </div>

      {courses.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No courses yet.
            {canAuthor
              ? " Create one to get started."
              : " Nothing has been published for you yet."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--brand-accent)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {course.title}
                    {course.version > 1 ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        version {course.version}
                      </span>
                    ) : null}
                  </p>
                  {course.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">
                      {course.description}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={course.status} />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
                <span>
                  {course.lessonCount}{" "}
                  {course.lessonCount === 1 ? "lesson" : "lessons"}
                </span>
                <span>
                  {course.competencyCount}{" "}
                  {course.competencyCount === 1
                    ? "competency"
                    : "competencies"}
                </span>
                {course.curriculumModuleCode ? (
                  <span>
                    {COMPONENT_LABELS[course.curriculumComponent ?? ""] ?? ""}{" "}
                    module {course.curriculumModuleCode}
                  </span>
                ) : (
                  <span>Not part of a qualification</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
