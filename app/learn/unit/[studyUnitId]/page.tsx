import Link from "next/link";
import { notFound } from "next/navigation";
import { localeFor, requireSession, requireTenant } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { learnerQualifications } from "@/lib/learner-qualification";
import { unitOverview } from "@/lib/learner-unit";
import { AppShell } from "@/components/app-shell";
import { UnitIntro } from "../../[id]/study-unit-view";

/**
 * A study unit of the learner's qualification that they are not yet on: its
 * introduction only (Roland, 5 October 2026). Everything else arrives when
 * they are enrolled on it and their cohort releases it.
 */
export default async function UnitIntroPage({ params }: { params: Promise<{ studyUnitId: string }> }) {
  const { studyUnitId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = translator(localeFor(tenant, session));

  // Only a unit of a qualification the learner is on.
  const qualification = (await learnerQualifications(session)).find((one) => one.units.some((unit) => unit.id === studyUnitId));
  if (!qualification) notFound();
  const enrolled = qualification.units.find((unit) => unit.id === studyUnitId)?.enrolmentId;
  if (enrolled) {
    const { redirect } = await import("next/navigation");
    redirect(`/learn/${enrolled}`);
  }
  const overview = await unitOverview(session, studyUnitId);
  if (!overview) notFound();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href={`/learn/qualification/${qualification.id}`} className="text-sm text-[var(--brand-accent)] underline-offset-2 hover:underline">
          {qualification.title}
        </Link>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t("learnUnit.of", { position: overview.unit.position, total: overview.unit.of })}
        </p>
        <h1 className="text-2xl font-bold">{overview.unit.title}</h1>
      </div>
      <div className="mb-6 rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-5 py-4">
        <p className="font-medium">{t("learnQual.notYetTitle")}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("learnQual.notYetBody")}</p>
      </div>
      <UnitIntro overview={overview} t={t} />
    </AppShell>
  );
}
