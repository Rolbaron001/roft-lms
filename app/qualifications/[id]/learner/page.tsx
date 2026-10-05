import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { courses, exitLevelOutcomes, qualifications, studyUnits } from "@/db/schema";
import { localeFor, requirePermission, requireTenant } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { QualificationNav } from "@/components/qualification-nav";

/**
 * The qualification as a learner sees it, for an administrator checking that
 * everything is in place (Roland, 5 October 2026: "When opening a
 * qualification and I select 'See it as a learner' I want to view the
 * qualification from a Learner's perspective"). The same page a learner gets,
 * every study unit open, nothing recorded.
 */
export default async function LearnerPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const t = translator(localeFor(tenant, session));

  const data = await withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({ id: qualifications.id, title: qualifications.title, description: qualifications.description, saqaId: qualifications.saqaId, nqfLevel: qualifications.nqfLevel, totalCredits: qualifications.totalCredits })
      .from(qualifications)
      .where(eq(qualifications.id, id));
    if (!qualification) return null;
    const units = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title, outcome: exitLevelOutcomes.description, courseId: courses.id, status: courses.status })
      .from(studyUnits)
      .leftJoin(exitLevelOutcomes, eq(exitLevelOutcomes.id, studyUnits.exitLevelOutcomeId))
      .leftJoin(courses, eq(courses.studyUnitId, studyUnits.id))
      .where(eq(studyUnits.qualificationId, id))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    return { qualification, units };
  });
  if (!data) notFound();
  const { qualification, units } = data;
  const facts = [
    qualification.saqaId ? t("learnQual.saqa", { id: qualification.saqaId }) : null,
    qualification.nqfLevel ? t("learnQual.nqf", { level: qualification.nqfLevel }) : null,
    qualification.totalCredits ? t("learnQual.credits", { credits: qualification.totalCredits }) : null,
  ].filter(Boolean);

  return (
    <AppShell tenant={tenant} session={session}>
      <QualificationNav qualificationId={id} current="preview" />
      <div className="mb-4 rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3 text-sm">{t("learnPreview.banner")}</div>
      <section className="mb-6 grid gap-6 rounded-2xl p-7 text-white md:grid-cols-3" style={{ background: "var(--brand-primary)" }}>
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{t("learnUnit.qualification")}</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{qualification.title}</h1>
          {facts.length > 0 ? <p className="mt-2 text-sm opacity-90">{facts.join(" · ")}</p> : null}
          {qualification.description ? <p className="mt-3 leading-relaxed opacity-95">{qualification.description}</p> : null}
        </div>
        <div className="rounded-xl bg-white/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{t("learnQual.cohort")}</p>
          <p className="mt-2 text-lg font-semibold">{t("learnPreview.cohort")}</p>
          <p className="mt-2 text-sm opacity-90">{t("learnQual.unitsDone", { done: 0, total: units.length })}</p>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("learnQual.units")}</h2>
        <span className="text-sm text-[var(--muted)]">{t("learnQual.unitsHint")}</span>
      </div>
      <ol className="space-y-3">
        {units.map((unit) => (
          <li key={unit.id}>
            <Link
              href={`/qualifications/${id}/learner/${unit.id}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 transition hover:border-[var(--brand-accent)]"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: "var(--brand-primary)" }}>
                  {unit.code}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{unit.title}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {!unit.courseId ? t("learnPreview.notBuilt") : unit.status === "published" ? t("learnPreview.live") : t("learnPreview.draft")}
                  </p>
                </div>
              </div>
              <span className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--brand-primary)" }}>
                {t("learnPreview.open")}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm">
        <Link href={`/qualifications/${id}/preview`} className="underline underline-offset-2">
          {t("learnPreview.checklist")}
        </Link>
      </p>
    </AppShell>
  );
}
