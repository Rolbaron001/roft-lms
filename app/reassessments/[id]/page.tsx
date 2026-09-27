import Link from "next/link";
import { notFound } from "next/navigation";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import {
  criteriaForAssessment,
  oralAssessmentFor,
  ReassessmentError,
} from "@/lib/reassessment";
import { AppShell, Card } from "@/components/app-shell";
import { OralRecord } from "./oral-record";

/**
 * Conducting the oral third attempt.
 *
 * The screen is the record, not the assessment: the assessment is a
 * conversation happening in a room. What this has to do is make writing it
 * down as it happens easier than reconstructing it afterwards, because
 * reconstructed evidence is the kind that falls over at verification.
 *
 * The outcome is not recorded here. It goes through the ordinary marking
 * screen, against the ordinary criteria, so it reaches the criterion ledger by
 * the same route as the two written attempts before it.
 */
export default async function OralAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const t = await pageT();

  let detail;
  try {
    detail = await oralAssessmentFor(session, id);
  } catch (error) {
    if (error instanceof ReassessmentError) notFound();
    throw error;
  }

  const criteria = await criteriaForAssessment(
    session,
    detail.authorisation.assessmentId,
  );

  const canAssess = session.permissions.includes("assessment:assess");
  const review = detail.authorisation;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/reassessments" className="text-sm text-[var(--muted)] hover:underline">
          {t("oral.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {t("oral.title", {
            learner: `${detail.learner?.firstName ?? ""} ${detail.learner?.lastName ?? ""}`.trim(),
          })}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {detail.assessmentTitle} · {t("common.attempt", { number: detail.submission.attemptNumber })}
        </p>
      </div>

      <Card title={t("oral.reviewDecided")} description={t("oral.reviewDecidedIntro")}>
        <p className="text-sm">{review.rationale}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {review.employerConsulted
            ? t("oral.employerConsulted", { name: review.employerRepresentative ?? "" })
            : t("oral.employerNotConsulted")}
          {review.employerComments ? `: “${review.employerComments}”` : ""}
        </p>
      </Card>

      <div className="mt-6">
        <Card title={t("oral.record")} description={t("oral.recordIntro")}>
          {canAssess ? (
            <OralRecord
              submissionId={id}
              criteria={criteria}
              existing={detail.record?.exchanges ?? []}
              medium={detail.record?.medium ?? null}
              witnessName={detail.record?.witnessName ?? null}
            />
          ) : detail.record ? (
            <ul className="space-y-3 text-sm">
              {detail.record.exchanges.map((exchange, index) => (
                <li key={index}>
                  <p className="font-medium">{exchange.question}</p>
                  <p className="mt-0.5">{exchange.response}</p>
                  {exchange.note ? (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{exchange.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t("oral.nothingYet")}</p>
          )}
        </Card>
      </div>

      {canAssess && detail.record ? (
        <div className="mt-6">
          <Card title={t("oral.outcome")} description={t("oral.outcomeIntro")}>
            <Link
              href={`/assess/${id}`}
              className="inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              {t("oral.goMark")}
            </Link>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
