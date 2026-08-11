import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { myEnrolments } from "@/lib/enrolment";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";

const ROLE_LABELS: Record<string, string> = {
  platform_owner: "Platform Owner",
  tenant_admin: "Administrator",
  instructor: "Instructor",
  assessor: "Assessor",
  moderator: "Moderator",
  line_manager: "Line Manager",
  learner: "Learner",
  skills_development_facilitator: "Skills Development Facilitator",
  external_verifier: "External Verifier",
};

function dueLabel(dueDate: Date | null, status: string): string | null {
  if (!dueDate || status === "completed") return null;

  const days = Math.ceil(
    (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (days < 0) {
    return `Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;
  }
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export default async function HomePage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  const enrolments = await myEnrolments(session);

  const outstanding = enrolments.filter((row) => row.status !== "completed");
  const finished = enrolments.filter((row) => row.status === "completed");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {session.firstName} {session.lastName}
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {session.roles.map((role) => (
            <span
              key={role}
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              {ROLE_LABELS[role] ?? role}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <Card title="My learning">
          {enrolments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              You have not been assigned any courses yet.
            </p>
          ) : (
            <div className="space-y-3">
              {[...outstanding, ...finished].map((enrolment) => {
                const percentage =
                  enrolment.totalLessons === 0
                    ? 0
                    : Math.round(
                        (enrolment.completedLessons / enrolment.totalLessons) *
                          100,
                      );
                const due = dueLabel(enrolment.dueDate, enrolment.status);
                const overdue = enrolment.status === "overdue";

                return (
                  <Link
                    key={enrolment.enrolmentId}
                    href={`/learn/${enrolment.enrolmentId}`}
                    className="block rounded-lg border border-[var(--border)] p-4 transition hover:border-[var(--brand-accent)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{enrolment.courseTitle}</p>
                        {due ? (
                          <p
                            className={`mt-0.5 text-xs ${
                              overdue
                                ? "font-medium text-[var(--danger)]"
                                : "text-[var(--muted)]"
                            }`}
                          >
                            {due}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge status={enrolment.status} />
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <div
                        className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
                        role="progressbar"
                        aria-valuenow={percentage}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${enrolment.courseTitle} progress`}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percentage}%`,
                            background:
                              percentage === 100
                                ? "var(--success)"
                                : "var(--brand-accent)",
                          }}
                        />
                      </div>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {enrolment.completedLessons} of {enrolment.totalLessons}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
