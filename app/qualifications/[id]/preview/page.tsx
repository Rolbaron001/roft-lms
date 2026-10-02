import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant, said } from "@/lib/request";
import { maybe } from "@/lib/i18n";
import { previewQualification, PreviewError } from "@/lib/qualification-preview";
import { vocabulary } from "@/lib/terms";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { StartUnit } from "./start-unit";
import { QualificationNav } from "@/components/qualification-nav";

/**
 * A qualification walked as a learner will meet it.
 *
 * Job sheet 2.1. /papers/[id]/preview covers one paper; this covers the whole
 * programme in the order somebody enrolled on it walks it, and says what they
 * would not find.
 *
 * Nothing here writes. No enrolment, no attempt, no step recorded as opened.
 */

export default async function QualificationPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const { t, locale } = await pageLocale();

  let preview;
  try {
    preview = await said(await previewQualification(session, id));
  } catch (error) {
    if (error instanceof PreviewError) notFound();
    throw error;
  }

  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const { qualification, counts } = preview;

  return (
    <AppShell tenant={tenant} session={session}>
      <QualificationNav qualificationId={id} current="preview" />
      <div className="mb-6">
        <Link
          href={`/qualifications/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          &larr; {qualification.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("qualPreview.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("qualPreview.intro", { programme: words.lowerOne("programme") })}
        </p>
        <p className="mt-2 text-sm">
          {counts.units === 1 ? t("qualPreview.unitsOne") : t("qualPreview.units", { count: counts.units })},{" "}
          {counts.steps === 1 ? t("qualPreview.stepsOne") : t("qualPreview.steps", { count: counts.steps })},{" "}
          <span
            className={
              counts.ready === counts.steps
                ? "font-medium"
                : "font-medium text-[var(--danger)]"
            }
          >
            {t("qualPreview.ready", { ready: counts.ready, steps: counts.steps })}
          </span>
          .
        </p>
      </div>

      {/*
        What is missing, first and in full.

        The authoring screens show what exists. The point of this one is what
        is reachable, so the holes go at the top rather than being left for
        somebody to notice by scrolling.
      */}
      {preview.gaps.length > 0 ? (
        <div className="mb-6">
          <Card title={t("qualPreview.gaps")}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {preview.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="mb-6">
          <Card title={t("qualPreview.allReady")}>
            <p className="text-sm">{t("qualPreview.allReadyNote", { programme: words.lowerOne("programme") })}</p>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {preview.units.map((unit) => (
          <Card key={unit.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">
                {unit.code} {unit.title}
              </span>
              {unit.credits !== null ? (
                <span className="text-xs text-[var(--muted)]">
                  {t("qualPreview.credits", { count: unit.credits })}
                </span>
              ) : null}
              {unit.steps.length > 0 ? (
                <span className="text-xs text-[var(--muted)]">
                  {unit.steps.length === 1
                    ? t("qualPreview.stepsOne")
                    : t("qualPreview.steps", { count: unit.steps.length })}
                </span>
              ) : null}
            </div>

            {unit.outcome ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{unit.outcome}</p>
            ) : null}

            {unit.steps.length === 0 ? (
              <>
                <p className="mt-3 text-sm text-[var(--danger)]">
                  {unit.gaps[0]}
                </p>
                {/*
                  Naming a gap and offering no way to close it is half a
                  screen, so each one ends with the next thing to do.
                */}
                {unit.courseId ? (
                  <Link
                    href={`/courses/${unit.courseId}/steps`}
                    className="mt-2 inline-block text-sm underline underline-offset-2"
                  >
                    {t("qualPreview.build")}
                  </Link>
                ) : (
                  <StartUnit qualificationId={id} studyUnitId={unit.id} />
                )}
              </>
            ) : (
              <ol className="mt-3 space-y-2">
                {unit.steps.map((step, index) => (
                  <li
                    key={step.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[var(--border)] pt-2 text-sm first:border-0 first:pt-0"
                  >
                    <span className="text-xs text-[var(--muted)]">
                      {index + 1}.
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {maybe(t, `qualPreview.kind.${step.kind}`) ?? step.kind}
                    </span>
                    <span className={step.ready ? "" : "text-[var(--danger)]"}>
                      {step.title}
                    </span>
                    {step.optional ? (
                      <span className="text-xs text-[var(--muted)]">
                        {t("qualPreview.optional")}
                      </span>
                    ) : null}
                    {step.note ? (
                      <span className="text-xs text-[var(--danger)]">
                        {step.note}
                      </span>
                    ) : null}
                    {step.href ? (
                      <Link
                        href={step.href}
                        className="text-xs underline underline-offset-2"
                      >
                        {t("qualPreview.open")}
                      </Link>
                    ) : null}
                    {step.guidance ? (
                      <span className="block w-full text-xs text-[var(--muted)]">
                        {step.guidance}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {unit.courseId && unit.steps.length > 0 ? (
              <Link
                href={`/courses/${unit.courseId}/steps`}
                className="mt-3 inline-block text-xs underline underline-offset-2"
              >
                {t("qualPreview.change")}
              </Link>
            ) : null}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
