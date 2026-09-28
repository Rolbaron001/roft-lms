import Link from "next/link";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { listCourses } from "@/lib/authoring";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { vocabulary } from "@/lib/terms";
import { maybe } from "@/lib/i18n";

export default async function CoursesPage() {
  const tenant = await requireTenant();
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const session = await requirePermission("course:read");
  const courses = await listCourses(session);

  const canAuthor = session.permissions.includes("course:author");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{words.many("course")}</h1>
        {canAuthor ? (
          <Link
            href="/courses/new"
            className="rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            {t("courseList.new", { course: words.lowerOne("course") })}
          </Link>
        ) : null}
      </div>

      {courses.length === 0 ? (
        /*
          Said with a way out of it.

          "Create one to get started" is a direction with nothing to press, the
          same fault Roland raised on the qualification screens on 19
          September. The button is the one thing to do here, so it is a button.
        */
        <EmptyState
          title={t("courseList.none", { courses: words.lowerMany("course") })}
          action={
            canAuthor ? (
              <Link
                href="/courses/new"
                className="rounded-md px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "var(--brand-primary)" }}
              >
                {t("courseList.new", { course: words.lowerOne("course") })} &rarr;
              </Link>
            ) : null
          }
        >
          {canAuthor ? <p>{t("courseList.noneAuthor")}</p> : <p>{t("courseList.noneReader")}</p>}
        </EmptyState>
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
                        {t("courseList.version", { number: course.version })}
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
                  {course.lessonCount === 1
                    ? t("courseList.lessonsOne")
                    : t("courseList.lessons", { count: course.lessonCount })}
                </span>
                <span>
                  {course.competencyCount === 1
                    ? t("courseList.competenciesOne")
                    : t("courseList.competencies", { count: course.competencyCount })}
                </span>
                {course.curriculumModuleCode ? (
                  <span>
                    {t("courseList.module", {
                      component: maybe(t, `courseList.component.${course.curriculumComponent ?? ""}`) ?? "",
                      code: course.curriculumModuleCode,
                    })}
                  </span>
                ) : (
                  <span>{t("courseList.noQualification")}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
