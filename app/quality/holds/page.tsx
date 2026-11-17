import { pageDates, pageT, requirePermission, requireTenant } from "@/lib/request";
import { AppShell, Card } from "@/components/app-shell";
import { holdTargets, listHolds } from "@/lib/quality";
import { LiftHold, PlaceHold } from "./hold-forms";

/**
 * Compliance holds (Heidi, 13 November 2026; job sheet D51). A Quality
 * Assurer places one on a qualification or cohort where a quality
 * irregularity is found; while it stands, no assessment decision is
 * recorded and no certificate or Statement of Results is issued for it.
 */
export default async function HoldsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("audit:read");
  const t = await pageT();
  const dates = await pageDates();
  const mayHold = session.permissions.includes("quality:hold");
  const [holds, targets] = await Promise.all([listHolds(session), mayHold ? holdTargets(session) : null]);
  const standing = holds.filter((hold) => !hold.liftedAt);
  const lifted = holds.filter((hold) => hold.liftedAt);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("holds.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("holds.intro")}</p>
      </div>

      {targets ? (
        <div className="mb-6">
          <Card title={t("holds.placeTitle")}>
            <PlaceHold qualifications={targets.qualifications} cohorts={targets.cohorts} />
          </Card>
        </div>
      ) : null}

      <Card title={t("holds.standing")}>
        {standing.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("holds.noneStanding")}</p>
        ) : (
          <ul className="space-y-4">
            {standing.map((hold) => (
              <li key={hold.id} className="rounded-md border border-[var(--danger)]/30 p-3">
                <p className="text-sm font-medium">
                  {t(hold.on === "qualification" ? "holds.onQualification" : "holds.onCohort")}: {hold.name}
                </p>
                <p className="mt-1 text-sm">{hold.reason}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("holds.placedBy", { who: hold.placedBy ?? "—", when: dates.when(hold.placedAt) })}</p>
                {mayHold ? <LiftHold holdId={hold.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {lifted.length ? (
        <div className="mt-6">
          <Card title={t("holds.lifted")}>
            <ul className="space-y-3 text-sm">
              {lifted.map((hold) => (
                <li key={hold.id}>
                  <p className="font-medium">
                    {t(hold.on === "qualification" ? "holds.onQualification" : "holds.onCohort")}: {hold.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {hold.reason} · {t("holds.liftedBy", { who: hold.liftedBy ?? "—", when: dates.when(hold.liftedAt) })} · {hold.liftNote}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
