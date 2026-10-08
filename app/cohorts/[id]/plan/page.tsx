import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { cohortPlan } from "@/lib/cohort-plan";
import { CohortError } from "@/lib/cohorts";
import { AppShell } from "@/components/app-shell";
import { CohortNav } from "@/components/cohort-nav";
import { Planner } from "./planner";

/**
 * Planning a cohort inside the platform (Roland, 7 October 2026), as designed
 * on the canvas that day: the plan week by week, each item editable where it
 * sits, and what learners see on any day beside it.
 */
export default async function CohortPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, dates } = await pageLocale();

  let plan;
  try {
    plan = await cohortPlan(session, id);
  } catch (error) {
    if (error instanceof CohortError) notFound();
    throw error;
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-5">
        <Link href={`/cohorts/${id}`} className="text-sm text-[var(--muted)] hover:underline">
          {t("planner.back", { cohort: plan.cohort.name })}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{t("planner.title", { cohort: plan.cohort.name })}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("planner.starts", { date: plan.cohort.startDate })} · {plan.cohort.releaseMode === "open" ? t("planner.modeOpen") : t("planner.modeScheduled")}
        </p>
      </div>
      <CohortNav cohortId={id} current="plan" />
      <Planner plan={plan} canManage={session.permissions.includes("enrolment:manage")} dateLocale={dates} />
    </AppShell>
  );
}
