import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { myEnrolments } from "@/lib/enrolment";
import { listMyCertificates } from "@/lib/certificates";
import { listStatementsFor } from "@/lib/statement-of-results";
import { myLearningPaths } from "@/lib/learning-paths";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { feedbackOwedBy } from "@/lib/feedback";
import { learnerBadges } from "@/lib/badges";

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

  // Feedback forms this person still owes. On the front page rather than behind
  // a notification, because a form nobody sees is a response rate nobody has.
  const owed = await feedbackOwedBy(session, session.userId);

  // Badges. On the front page rather than a profile nobody visits, because the
  // whole point is that recognition arrives on the day the work is finished
  // and is seen - formal certification is months away and the client has lost
  // learners in that gap.
  const earned = await learnerBadges(session, session.userId);
  // The Statement of Results is the document a learner is required to carry to
  // the external assessment, so the place they look for it is their own front
  // page. It was reachable only from the readiness screen, which is staff-side:
  // the learner could open their own statement but had no link that led there.
  const [enrolments, certificates, paths, statements] = await Promise.all([
    myEnrolments(session),
    listMyCertificates(session),
    myLearningPaths(session),
    listStatementsFor(session, session.userId),
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
        {owed.length > 0 ? (
          <Card
            title={owed.length === 1 ? "One thing to tell us" : "A few things to tell us"}
            description="Answers are reported together with everybody else's, not one by one. Two minutes each, and it is the only thing that changes how the next cohort is run."
          >
            <ul className="space-y-2 text-sm">
              {owed.map((request) => (
                <li key={request.id}>
                  <Link
                    href={`/feedback/${request.id}`}
                    className="font-medium hover:underline"
                  >
                    {request.assessmentTitle ?? "The programme"}
                  </Link>
                  <span className="ml-2 text-[var(--muted)]">
                    {request.cohortName}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {earned.length > 0 ? (
          <Card
            title="What you have earned"
            description="Recorded on the day you finished, rather than when the certificate eventually arrives. Each carries a reference anybody can check."
          >
            <ul className="flex flex-wrap gap-3">
              {earned.map((badge) => (
                <li
                  key={badge.id}
                  className="rounded-lg border border-[var(--border)] px-4 py-3"
                >
                  <p className="text-sm font-medium">
                    <span className="mr-2" aria-hidden>
                      {badge.glyph}
                    </span>
                    {badge.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {badge.earnedOn} · {badge.reference}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

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

        {statements.length > 0 ? (
          <Card
            title="My Statement of Results"
            description="Take this to the external assessment with your identity document. The centre checks it before you may sit."
          >
            <ul className="space-y-2">
              {statements.map((statement) => (
                <li key={statement.id}>
                  <Link
                    href={`/statements/${statement.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                  >
                    <span className="text-sm">
                      <span className="font-medium">Statement of Results</span>
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {statement.verificationReference}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {statement.revokedAt ? (
                        <span className="font-medium text-[var(--danger)]">
                          Withdrawn
                        </span>
                      ) : (
                        `Issued ${statement.issuedAt.toLocaleDateString("en-ZA")}`
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

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
