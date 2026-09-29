import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant, said } from "@/lib/request";
import { Rich } from "@/components/rich-text";
import { AuthoringError, getCourse } from "@/lib/authoring";
import { listCourseEnrolments, listEnrollableUsers } from "@/lib/enrolment";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { EnrolmentPanel } from "./enrolment-panel";
import { blockedLearners } from "@/lib/spine";

export default async function CourseEnrolmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, dates } = await pageLocale();

  let detail;
  try {
    detail = await getCourse(session, id);
  } catch (error) {
    if (error instanceof AuthoringError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const [enrolled, people, blocked] = await Promise.all([
    listCourseEnrolments(session, id),
    session.permissions.includes("user:read")
      ? listEnrollableUsers(session)
      : Promise.resolve([]),
    blockedLearners(session, id).then(said),
  ]);

  const canManage = session.permissions.includes("enrolment:manage");
  const enrolledIds = new Set(enrolled.map((row) => row.userId));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/courses/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {detail.course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("courseEnrol.title")}</h1>
      </div>

      {detail.course.status !== "published" ? (
        <Card>
          <p className="text-sm">{t("courseEnrol.draft")}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {blocked.length > 0 ? (
            <Card
              title={t("courseEnrol.waiting", { count: blocked.length })}
              description={t("courseEnrol.waitingNote")}
            >
              <ul className="space-y-2">
                {blocked.map((row) => (
                  <li
                    key={row.userId}
                    className="rounded-md border border-[var(--border)] px-4 py-3"
                  >
                    <p className="text-sm font-medium">
                      {row.firstName} {row.lastName}
                      <span className="ml-2 font-normal text-[var(--muted)]">
                        {row.email}
                      </span>
                    </p>
                    <p className="mt-1 text-sm">
                      <Rich text={t("courseEnrol.stuckAt")} parts={{ step: <strong>{row.stepTitle}</strong> }} />
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {row.blockedBy.join(" ")}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title={t("courseEnrol.enrolled", { count: enrolled.length })}>
            {enrolled.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("courseEnrol.nobody")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-lg text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="pb-2 pr-4 font-medium">{t("courseEnrol.name")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("courseEnrol.progress")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("courseEnrol.due")}</th>
                      <th className="pb-2 font-medium">{t("courseEnrol.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrolled.map((row) => (
                      <tr
                        key={row.enrolmentId}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="py-2.5 pr-4">
                          <Link
                            href={`/learn/${row.enrolmentId}`}
                            className="font-medium hover:underline"
                          >
                            {row.firstName} {row.lastName}
                          </Link>
                          <span className="block text-xs text-[var(--muted)]">
                            {row.email}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          {t("courseEnrol.progressOf", { done: row.completedLessons, total: row.totalLessons })}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap text-[var(--muted)]">
                          {row.dueDate
                            ? row.dueDate.toLocaleDateString(dates)
                            : "—"}
                        </td>
                        <td className="py-2.5">
                          <StatusBadge status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {canManage ? (
            <EnrolmentPanel
              courseId={id}
              people={people
                .filter((person) => !enrolledIds.has(person.id))
                .map((person) => ({
                  id: person.id,
                  label: `${person.firstName} ${person.lastName} · ${person.email}`,
                }))}
            />
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
