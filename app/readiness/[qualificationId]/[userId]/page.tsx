import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { qualificationReadiness, type Component } from "@/lib/eisa";
import { listStatementsFor } from "@/lib/statement-of-results";
import { AppShell, Card } from "@/components/app-shell";
import { IssueStatement } from "./issue";

const COMPONENT_LABEL: Record<Component, string> = {
  knowledge: "Knowledge modules",
  practical: "Practical skills modules",
  workplace: "Work experience modules",
};

const WEIGHT_SOURCE_NOTE: Record<string, string> = {
  document: "as stated in the curriculum document",
  credits: "derived from module credits — the document states no percentages",
  equal: "split evenly — the document states no percentages and no credits",
};

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One learner against one qualification, down to the criterion.
 *
 * This is what a moderator or external verifier asks to see, so it shows the
 * criterion codes exactly as the curriculum document numbers them rather than
 * a friendlier paraphrase.
 */
export default async function LearnerReadinessPage({
  params,
}: {
  params: Promise<{ qualificationId: string; userId: string }>;
}) {
  const { qualificationId, userId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  // The permission check lives in the engine: a learner may see their own,
  // anybody else needs enrolment:read_all.
  const readiness = await qualificationReadiness(session, qualificationId, userId);
  const isSelf = readiness.learner.userId === session.userId;

  const statements = await listStatementsFor(session, userId);
  const current = statements.find(
    (statement) =>
      statement.qualificationId === qualificationId && !statement.revokedAt,
  );
  const canIssue = session.permissions.includes("certificate:issue");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        {!isSelf ? (
          <Link
            href="/readiness"
            className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
          >
            ← All learners
          </Link>
        ) : null}
        <h1 className="mt-2 text-xl font-semibold">
          {isSelf
            ? "Your progress towards the EISA"
            : `${readiness.learner.firstName} ${readiness.learner.lastName}`}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {readiness.qualificationTitle}
          {readiness.saqaId ? ` · SAQA ${readiness.saqaId}` : ""}
        </p>
      </div>

      <section
        className="mb-6 rounded-lg border-2 bg-[var(--surface)] p-6"
        style={{
          borderColor: readiness.eisaEligible
            ? "var(--success)"
            : "var(--border)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p
              className="text-lg font-semibold"
              style={{
                color: readiness.eisaEligible ? "var(--success)" : undefined,
              }}
            >
              {readiness.eisaEligible
                ? "Eligible for the EISA"
                : "Not yet eligible for the EISA"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {readiness.achievedCriteria} of {readiness.totalCriteria} internal
              assessment criteria achieved, and work experience proved by signed
              logbook.
              {readiness.eisaEligible
                ? " A Statement of Results can be issued."
                : " Every one of them is required — there is no pass mark."}
            </p>

            {/* Offered whether or not the learner is eligible. The engine
                refuses and names what is missing, which is more useful than a
                button that silently is not there - and it closes the gap
                between the page being rendered and the button being pressed. */}
            {canIssue ? (
              <IssueStatement
                qualificationId={qualificationId}
                userId={userId}
                existing={
                  current
                    ? { id: current.id, reference: current.verificationReference }
                    : null
                }
              />
            ) : null}

            {!canIssue && current ? (
              <p className="mt-3 text-sm">
                <Link
                  href={`/statements/${current.id}`}
                  className="underline underline-offset-2"
                >
                  Your Statement of Results
                </Link>
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">
              {readiness.readinessIndex}%
            </p>
            <p className="text-xs text-[var(--muted)]">weighted progress</p>
          </div>
        </div>
      </section>

      {!readiness.curriculumComplete ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--danger)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
            This curriculum is not fully captured.
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {readiness.modulesWithoutCriteria.join(", ")} carry no assessment
            criteria. Nobody can be declared eligible against this qualification
            until the full curriculum document has been imported — otherwise the
            missing modules would silently count as passed.
          </p>
        </div>
      ) : null}

      <p className="mb-4 text-xs text-[var(--muted)]">
        Components weighted {WEIGHT_SOURCE_NOTE[readiness.weightSource]}.
      </p>

      {readiness.components
        .filter((component) => component.modules.length > 0)
        .map((component) => (
          <section key={component.component} className="mb-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">
                {COMPONENT_LABEL[component.component]}
              </h2>
              <p className="text-sm text-[var(--muted)] tabular-nums">
                {Math.round(component.weight * 100)}% of the qualification ·{" "}
                {component.percent}% done
              </p>
            </div>

            <div className="space-y-3">
              {component.modules.map((module) => (
                <Card key={module.moduleId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium">{module.title}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {module.code}
                        {module.credits ? ` · ${module.credits} credits` : ""}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="tabular-nums">
                        {module.route === "logbook"
                          ? "Logbook"
                          : `${module.achievedCount} / ${module.totalCount} criteria`}
                      </p>
                      {module.complete ? (
                        <p className="text-xs" style={{ color: "var(--success)" }}>
                          Competent · {formatDate(module.competenceAchievedAt)}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--muted)] tabular-nums">
                          {module.percent}%
                        </p>
                      )}
                    </div>
                  </div>

                  {module.route === "logbook" ? (
                    <div className="mt-3 text-sm">
                      <p className="text-[var(--muted)]">
                        Work experience is proved by a logbook signed by the
                        workplace coach and accepted by an assessor, not by
                        assessment criteria. The curriculum defines none for
                        this module.
                      </p>
                      {module.logbook ? (
                        <p className="mt-2">
                          <Link
                            href={`/workplace/${module.logbook.id}`}
                            className="underline underline-offset-2"
                          >
                            Open the logbook
                          </Link>
                          {module.logbook.coachSignedAt
                            ? ` · signed by the coach ${formatDate(module.logbook.coachSignedAt)}`
                            : ""}
                        </p>
                      ) : (
                        <p className="mt-2" style={{ color: "var(--danger)" }}>
                          No logbook has been opened for this module.
                        </p>
                      )}
                    </div>
                  ) : module.totalCount === 0 ? (
                    <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
                      No assessment criteria captured for this module.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {module.topics.map((topic) => (
                        <div key={topic.topicId ?? topic.code}>
                          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                            {topic.code} · {topic.title} ·{" "}
                            {Math.round(topic.weight * 100)}% of the module
                          </p>
                          <ul className="mt-2 space-y-1">
                            {topic.criteria.map((criterion) => (
                              <li
                                key={criterion.criterionId}
                                className="flex gap-2 text-sm"
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    color: criterion.achieved
                                      ? "var(--success)"
                                      : "var(--muted)",
                                  }}
                                >
                                  {criterion.achieved ? "✓" : "○"}
                                </span>
                                <span className="font-mono text-xs text-[var(--muted)]">
                                  {criterion.code}
                                </span>
                                <span
                                  className={
                                    criterion.achieved
                                      ? ""
                                      : "text-[var(--muted)]"
                                  }
                                >
                                  {criterion.description}
                                </span>
                                {criterion.achievedAt ? (
                                  <span className="ml-auto whitespace-nowrap text-xs text-[var(--muted)]">
                                    {formatDate(criterion.achievedAt)}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        ))}
    </AppShell>
  );
}
