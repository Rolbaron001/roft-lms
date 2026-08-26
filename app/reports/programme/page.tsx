import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listQualifications } from "@/lib/authoring";
import {
  criterionCoverage,
  MINIMUM_ATTEMPTS_TO_JUDGE,
  questionPerformance,
  reportableAssessments,
} from "@/lib/programme-reports";
import { AppShell, Card } from "@/components/app-shell";

/**
 * The two reports about the programme itself rather than about the people on
 * it.
 *
 * Both answer questions that look like they are about learners and are not. A
 * criterion nothing tests produces a readiness figure that will not reach 100%
 * however hard a cohort works. A question nobody can answer produces a cohort
 * that looks weak. In both cases the thing to fix is the material.
 */
export default async function ProgrammeReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ qualification?: string; assessment?: string }>;
}) {
  const { qualification, assessment } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("report:tenant");

  const [qualifications, assessments] = await Promise.all([
    listQualifications(session),
    reportableAssessments(session),
  ]);

  const chosenQualification = qualification ?? qualifications[0]?.id;
  const chosenAssessment = assessment ?? assessments[0]?.id;

  const [coverage, questions] = await Promise.all([
    chosenQualification
      ? criterionCoverage(session, chosenQualification)
      : Promise.resolve([]),
    chosenAssessment
      ? questionPerformance(session, chosenAssessment)
      : Promise.resolve([]),
  ]);

  const untested = coverage.filter((row) => row.nothingTests);
  const misleading = coverage.filter((row) => row.onlyFormative);
  const flagged = questions.filter(
    (row) => row.nobodyGetsIt || row.everybodyGetsIt,
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/reports"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Reports
        </Link>
        <h1 className="mt-2 text-xl font-semibold">The programme itself</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Two questions that look like they are about learners and are not: what
          nothing assesses, and which questions are not working.
        </p>
      </div>

      {/* --- criterion coverage --- */}
      <Card
        title="What nothing tests"
        description="A criterion no summative question assesses cannot be achieved by anybody, however well they do. It holds up every learner on the qualification, and nothing else in the platform says so."
      >
        {qualifications.length > 1 ? (
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
            {chosenAssessment ? (
              <input type="hidden" name="assessment" value={chosenAssessment} />
            ) : null}
            <label className="text-xs text-[var(--muted)]">
              Qualification
              <select
                name="qualification"
                defaultValue={chosenQualification}
                className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                {qualifications.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            >
              Show
            </button>
          </form>
        ) : null}

        {coverage.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            This qualification has no assessment criteria captured yet.
          </p>
        ) : untested.length === 0 ? (
          <p className="text-sm">
            Every one of the {coverage.length} criteria is tested by at least one
            summative question.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              <strong>{untested.length}</strong> of {coverage.length} criteria
              are not tested by any summative question
              {misleading.length > 0 ? (
                <>
                  {" "}
                  — and <strong>{misleading.length}</strong> of those appear in a
                  workbook, which is developmental and evidences nothing
                </>
              ) : null}
              .
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Criterion</th>
                    <th className="pb-2">Module</th>
                    <th className="pb-2">Taught by</th>
                    <th className="pb-2">Tested by</th>
                  </tr>
                </thead>
                <tbody>
                  {untested.map((row) => (
                    <tr
                      key={row.criterionId}
                      className="border-t border-[var(--border)] align-top"
                    >
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{row.code}</span>
                        <span className="ml-2">{row.description}</span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {row.moduleCode}
                      </td>
                      <td className="py-2 pr-3">
                        {row.taughtBy === 0 ? (
                          <span className="text-[var(--danger)]">
                            no lesson
                          </span>
                        ) : (
                          `${row.taughtBy} ${row.taughtBy === 1 ? "lesson" : "lessons"}`
                        )}
                      </td>
                      <td className="py-2">
                        {row.onlyFormative ? (
                          <span className="text-[var(--danger)]">
                            workbook only — evidences nothing
                          </span>
                        ) : (
                          <span className="text-[var(--danger)]">nothing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* --- question performance --- */}
      <div className="mt-6">
        <Card
          title="Which questions are not working"
          description={`First attempts only, because a re-sit measures something else. Nothing is flagged below ${MINIMUM_ATTEMPTS_TO_JUDGE} attempts — a question two people have answered tells you about those two people.`}
        >
          {assessments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No published assessments yet.
            </p>
          ) : (
            <>
              <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
                {chosenQualification ? (
                  <input
                    type="hidden"
                    name="qualification"
                    value={chosenQualification}
                  />
                ) : null}
                <label className="text-xs text-[var(--muted)]">
                  Assessment
                  <select
                    name="assessment"
                    defaultValue={chosenAssessment}
                    className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    {assessments.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title}
                        {row.purpose === "formative" ? " (workbook)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  Show
                </button>
              </form>

              {questions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  That assessment has no questions yet.
                </p>
              ) : (
                <>
                  {flagged.length === 0 ? (
                    <p className="mb-3 text-sm">
                      Nothing stands out across {questions.length} questions.
                    </p>
                  ) : (
                    <p className="mb-3 text-sm">
                      <strong>{flagged.length}</strong> of {questions.length}{" "}
                      questions are worth a look.
                    </p>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                          <th className="pb-2">Question</th>
                          <th className="pb-2">First attempts</th>
                          <th className="pb-2">Mean</th>
                          <th className="pb-2">Full / zero</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.map((row) => (
                          <tr
                            key={row.itemId}
                            className="border-t border-[var(--border)] align-top"
                          >
                            <td className="py-2 pr-3">
                              <span className="text-xs text-[var(--muted)]">
                                {row.paperCode} · {row.sectionTitle}
                              </span>
                              <span className="block">{row.stem}</span>
                              {row.nobodyGetsIt ? (
                                <span className="mt-1 block text-xs text-[var(--danger)]">
                                  Almost nobody can answer this. Either the
                                  question is unclear or what it tests was never
                                  taught.
                                </span>
                              ) : null}
                              {row.everybodyGetsIt ? (
                                <span className="mt-1 block text-xs text-[var(--muted)]">
                                  Everybody gets full marks, so it distinguishes
                                  nothing.
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {row.firstAttempts}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {row.meanPercent === null
                                ? "—"
                                : `${row.meanPercent}%`}
                            </td>
                            <td className="py-2 tabular-nums">
                              {row.fullMarks} / {row.zeroMarks}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
