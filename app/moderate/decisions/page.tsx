import Link from "next/link";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { decisionsToModerate, moderationFilters } from "@/lib/moderation-sample";
import { AppShell, Card } from "@/components/app-shell";
import { AssignedNote } from "@/components/assigned-note";
import { SampleForm } from "./sample-form";

/**
 * Every assessed decision within the programmes a moderator moderates,
 * narrowed by cohort, qualification or assessor, with any of them added to
 * the sample by choice (Heidi's role specifications, job sheet D52 (3)).
 */
export default async function ModerationDecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string; qualification?: string; assessor?: string }>;
}) {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:moderate");
  const t = await pageT();
  const params = await searchParams;
  const filter = { cohortId: params.cohort || undefined, qualificationId: params.qualification || undefined, assessorId: params.assessor || undefined };
  const [rows, options] = await Promise.all([decisionsToModerate(session, filter), moderationFilters(session)]);
  const select = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <AppShell tenant={tenant} session={session}>
      <AssignedNote session={session} />
      <p className="mb-4 text-sm">
        <Link href="/moderate" className="text-[var(--muted)] hover:underline">
          ← {t("sample.back")}
        </Link>
      </p>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("sample.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("sample.intro")}</p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          {t("sample.cohort")}
          <select name="cohort" defaultValue={params.cohort ?? ""} className={`${select} mt-1 block`}>
            <option value="">{t("sample.any")}</option>
            {options.cohorts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          {t("sample.qualification")}
          <select name="qualification" defaultValue={params.qualification ?? ""} className={`${select} mt-1 block`}>
            <option value="">{t("sample.any")}</option>
            {options.qualifications.map((one) => (
              <option key={one.id} value={one.id}>
                {one.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          {t("sample.assessor")}
          <select name="assessor" defaultValue={params.assessor ?? ""} className={`${select} mt-1 block`}>
            <option value="">{t("sample.any")}</option>
            {options.assessors.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium">
          {t("sample.show")}
        </button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("sample.none")}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-[var(--muted)]">
              {t("sample.count", { count: rows.length, sampled: rows.filter((row) => row.sampled).length })}
            </p>
            <SampleForm rows={rows} />
          </>
        )}
      </Card>
    </AppShell>
  );
}
