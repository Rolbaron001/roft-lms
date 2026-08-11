import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { myEnrolments } from "@/lib/enrolment";
import { listMyCertificates } from "@/lib/certificates";
import { myLearningPaths } from "@/lib/learning-paths";
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
  const [enrolments, certificates, paths] = await Promise.all([
    myEnrolments(session),
    listMyCertificates(session),
    myLearningPaths(session),
  ]);

  // Courses reached through a programme are shown inside it, so they are not
  // listed twice under "My learning".
  const inAPath = new Set(
    paths.flatMap((path) => path.steps.map((step) => step.courseId)),
  );

  const standalone = enrolments.filter((row) => !inAPath.has(row.courseId));
  const outstanding = standalone.filter((row) => row.status !== "completed");
  const finished = standalone.filter((row) => row.status === "completed");

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
        {paths.map((path) => (
          <Card key={path.enrolmentId} title={path.title}>
            {path.description ? (
              <p className="mb-4 text-sm text-[var(--muted)]">
                {path.description}
              </p>
            ) : null}

            <p className="mb-4 text-sm">
              <span className="font-medium">
                {path.completedSteps} of {path.totalSteps}
              </span>{" "}
              <span className="text-[var(--muted)]">
                courses finished
                {path.status === "completed" ? " — programme complete" : ""}
              </span>
            </p>

            <ol className="space-y-2">
              {path.steps.map((step, index) => {
                const locked = step.state === "locked";
                const done = step.state === "completed";

                const inner = (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        style={
                          done
                            ? { background: "var(--success)", color: "white" }
                            : locked
                              ? {
                                  background: "var(--border)",
                                  color: "var(--muted)",
                                }
                              : {
                                  background: "var(--brand-primary)",
                                  color: "white",
                                }
                        }
                      >
                        {done ? "✓" : index + 1}
                      </span>
                      <span className={locked ? "text-[var(--muted)]" : ""}>
                        {step.title}
                      </span>
                    </span>

                    <span className="text-xs text-[var(--muted)]">
                      {done
                        ? "Finished"
                        : locked
                          ? index === 0
                            ? "Not started"
                            : "Opens when you finish the step before"
                          : step.state === "in_progress"
                            ? "In progress"
                            : "Ready to start"}
                    </span>
                  </div>
                );

                return (
                  <li key={step.courseId}>
                    {step.enrolmentId ? (
                      <Link
                        href={`/learn/${step.enrolmentId}`}
                        className="block rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-3">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}

        <Card title="My learning">
          {standalone.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {paths.length > 0
                ? "Nothing outside your programmes."
                : "You have not been assigned any courses yet."}
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

        {certificates.length > 0 ? (
          <Card title="My certificates">
            <ul className="space-y-2">
              {certificates.map((certificate) => (
                <li key={certificate.id}>
                  <Link
                    href={`/certificates/${certificate.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{certificate.title}</span>
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {certificate.reference}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {certificate.revokedAt ? (
                        <span className="font-medium text-[var(--danger)]">
                          Withdrawn
                        </span>
                      ) : (
                        `Issued ${certificate.issuedAt.toLocaleDateString("en-ZA")}`
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
