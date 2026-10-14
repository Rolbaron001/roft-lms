import Link from "next/link";
import { notFound } from "next/navigation";
import { pageDates, requireSession, requireTenant, said } from "@/lib/request";
import { getEnrolmentForDelivery, EnrolmentError } from "@/lib/enrolment";
import {
  closeExpiredAttempt,
  getSitting,
  PaperError,
  startAttempt,
} from "@/lib/papers";
import { stepsForLearner } from "@/lib/spine";
import { learnerMaterial } from "@/lib/learner-unit";
import { AppShell, Card } from "@/components/app-shell";
import { PaperForm } from "./paper-form";
import { startAgainAction } from "./actions";
import { translator } from "@/lib/i18n";
import { localeFor } from "@/lib/i18n/locales";

/**
 * Sitting a paper.
 *
 * Opening the page opens the attempt — or resumes the one already in progress,
 * which is what a learner coming back the next morning expects. The gate is
 * checked inside `startAttempt`, so arriving here by typing the address is
 * refused exactly as clicking a locked step would be.
 */
export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id, assessmentId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = translator(localeFor(tenant, session));

  let delivery;
  try {
    delivery = await getEnrolmentForDelivery(session, id);
  } catch (error) {
    if (error instanceof EnrolmentError) notFound();
    throw error;
  }

  let sitting;
  let refusal: string | null = null;

  // Opening a paper starts an attempt, which is a change: not while an
  // administrator is viewing as the learner (lib/view-as.ts).
  if (session.viewAs) {
    refusal = t("viewAs.noAttempt");
  } else {
    try {
      sitting = await startAttempt(session, assessmentId, { enrolmentId: id });
    } catch (error) {
      if (error instanceof PaperError) {
        refusal = error.message;
      } else {
        throw error;
      }
    }
  }

  // An attempt whose clock ran out while the learner was away is handed in with
  // whatever was saved, rather than left open or thrown away. The comparison
  // happens inside `closeExpiredAttempt`, against the server clock — this page
  // must not decide it from the render-time clock, which is neither the
  // authority nor stable across a re-render.
  if (sitting?.closesAt && sitting.status === "draft") {
    const closed = await closeExpiredAttempt(session, sitting.submissionId);
    if (closed) sitting = { ...(await getSitting(session, sitting.submissionId)), canStartAgain: false };
  }

  // The step this paper is on: when it is due, what the facilitator says about
  // it, and the material of its study unit to keep open beside it.
  const steps = await said(await stepsForLearner(session, delivery.course.id, delivery.enrolment.userId));
  const step = steps.find((one) => one.targetId === assessmentId) ?? null;
  const guide = steps.find((one) => one.category === "theory_guide" && one.open) ?? null;
  const material = delivery.course.studyUnitId
    ? (await learnerMaterial(session, delivery.course.studyUnitId, steps)).filter((item) => item.open)
    : [];
  const otherDocuments = steps.filter((one) => one.category === "material" && one.open && one.document);
  const dates = await pageDates();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/learn/${id}#a-${assessmentId}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {delivery.course.title}
        </Link>

        {sitting ? (
          <>
            <h1 className="mt-2 text-xl font-semibold">
              {sitting.assessmentTitle}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {sitting.purpose === "summative"
                ? t("paper.summative")
                : t("paper.formative")}{" "}
              {t("paper.marks", { marks: sitting.totalMarks })}
              {sitting.attemptNumber > 1
                ? ` · ${t("paper.attempt", { number: sitting.attemptNumber })}`
                : ""}
              {step?.dueAt && sitting.status === "draft"
                ? ` · ${t("paper.due", { date: dates.day(step.dueAt) })}`
                : ""}
            </p>
            {sitting.instructions || step?.guidance ? (
              <div className="mt-3 max-w-3xl rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("paper.instructions")}</p>
                {sitting.instructions ? <p className="mt-1 whitespace-pre-wrap">{sitting.instructions}</p> : null}
                {step?.guidance ? <p className="mt-1 whitespace-pre-wrap">{step.guidance}</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <h1 className="mt-2 text-xl font-semibold">{t("paper.notOpen")}</h1>
        )}
      </div>

      {refusal ? (
        <Card>
          <p className="text-sm">{refusal}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("paper.goBack")}
          </p>
        </Card>
      ) : sitting ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0 space-y-6">
            <PaperForm sitting={sitting} enrolmentId={id} />
            {sitting.canStartAgain ? (
              <form action={startAgainAction} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                <input type="hidden" name="enrolmentId" value={id} />
                <input type="hidden" name="assessmentId" value={assessmentId} />
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {t("paper.startAgain")}
                </button>
                <p className="mt-2 text-xs text-[var(--muted)]">{t("paper.startAgainHint")}</p>
              </form>
            ) : null}
          </div>

          {/* Study material beside the questions, each opening in a new tab so
              the paper stays open (Curiosa's evaluation checklist, 14 October
              2026). */}
          {guide || material.length > 0 || otherDocuments.length > 0 ? (
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="text-sm font-semibold">{t("paper.material")}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("paper.materialHint")}</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {guide ? (
                    <li>
                      <a href={`/api/learn/${id}/documents/${guide.targetId}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                        {t("paper.materialGuide")}
                      </a>
                    </li>
                  ) : null}
                  {otherDocuments.map((one) => (
                    <li key={one.id}>
                      <a href={`/api/learn/${id}/documents/${one.targetId}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                        {one.title}
                      </a>
                    </li>
                  ))}
                  {material.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.mimeType === "application/pdf" ? `/learn/${id}/material/${item.id}` : `/api/learn/${id}/material/${item.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
                <a href={`/learn/${id}#material`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-[var(--brand-accent)] underline underline-offset-2">
                  {t("paper.materialUnit")}
                </a>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}
