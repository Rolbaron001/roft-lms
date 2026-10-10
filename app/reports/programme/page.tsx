import Link from "next/link";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { Rich } from "@/components/rich-text";
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
  const t = await pageT();

  const [qualifications, assessments] = await Promise.all([
    listQualifications(session),
    reportableAssessments(session),
  ]);

  // Only from the lists, which hold what this person may see (lib/staff-scope.ts).
  const chosenQualification = qualifications.find((row) => row.id === qualification)?.id ?? qualifications[0]?.id;
  const chosenAssessment = assessments.find((row) => row.id === assessment)?.id ?? assessments[0]?.id;

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
          {t("progReport.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("progReport.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("progReport.intro")}</p>
      </div>

      {/* --- criterion coverage --- */}
      <Card title={t("progReport.untested")} description={t("progReport.untestedNote")}>
        {qualifications.length > 1 ? (
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
            {chosenAssessment ? (
              <input type="hidden" name="assessment" value={chosenAssessment} />
            ) : null}
            <label className="text-xs text-[var(--muted)]">
              {t("progReport.qualification")}
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
              {t("progReport.show")}
            </button>
          </form>
        ) : null}

        {coverage.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("progReport.noCriteria")}</p>
        ) : untested.length === 0 ? (
          <p className="text-sm">{t("progReport.allTested", { count: coverage.length })}</p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              <Rich
                text={t("progReport.someUntested", { count: coverage.length })}
                parts={{ untested: <strong>{untested.length}</strong> }}
              />
              {misleading.length > 0 ? (
                <>
                  {" "}
                  <Rich
                    text={t("progReport.misleading")}
                    parts={{ count: <strong>{misleading.length}</strong> }}
                  />
                </>
              ) : null}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">{t("progReport.criterion")}</th>
                    <th className="pb-2">{t("progReport.module")}</th>
                    <th className="pb-2">{t("progReport.taughtBy")}</th>
                    <th className="pb-2">{t("progReport.testedBy")}</th>
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
                            {t("progReport.noLesson")}
                          </span>
                        ) : row.taughtBy === 1 ? (
                          t("progReport.lessonOne")
                        ) : (
                          t("progReport.lessons", { count: row.taughtBy })
                        )}
                      </td>
                      <td className="py-2">
                        {row.onlyFormative ? (
                          <span className="text-[var(--danger)]">
                            {t("progReport.workbookOnly")}
                          </span>
                        ) : (
                          <span className="text-[var(--danger)]">{t("progReport.nothing")}</span>
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
          title={t("progReport.questions")}
          description={t("progReport.questionsNote", { minimum: MINIMUM_ATTEMPTS_TO_JUDGE })}
        >
          {assessments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("progReport.noAssessments")}</p>
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
                  {t("progReport.assessment")}
                  <select
                    name="assessment"
                    defaultValue={chosenAssessment}
                    className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    {assessments.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title}
                        {row.purpose === "formative" ? ` ${t("progReport.workbook")}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  {t("progReport.show")}
                </button>
              </form>

              {questions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t("progReport.noQuestions")}</p>
              ) : (
                <>
                  {flagged.length === 0 ? (
                    <p className="mb-3 text-sm">{t("progReport.nothingStands", { count: questions.length })}</p>
                  ) : (
                    <p className="mb-3 text-sm">
                      <Rich
                        text={t("progReport.worthLook", { count: questions.length })}
                        parts={{ flagged: <strong>{flagged.length}</strong> }}
                      />
                    </p>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                          <th className="pb-2">{t("progReport.question")}</th>
                          <th className="pb-2">{t("progReport.firstAttempts")}</th>
                          <th className="pb-2">{t("progReport.mean")}</th>
                          <th className="pb-2">{t("progReport.fullZero")}</th>
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
                                  {t("progReport.nobody")}
                                </span>
                              ) : null}
                              {row.everybodyGetsIt ? (
                                <span className="mt-1 block text-xs text-[var(--muted)]">
                                  {t("progReport.everybody")}
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
