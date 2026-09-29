import Link from "next/link";
import { eq } from "drizzle-orm";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { maybe } from "@/lib/i18n";
import {
  DAYS_TO_ACKNOWLEDGE_GRIEVANCE,
  openGrievances,
  possibleAbscondment,
} from "@/lib/conduct";
import { activeProgrammes } from "@/lib/tracker";
import { withTenant } from "@/db/client";
import { userRoles, users } from "@/db/schema";
import { dateInZone } from "@/lib/timezone";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { Grievances } from "./grievances";

/**
 * Grievances and possible abscondment.
 *
 * The two things in the conduct procedures that are worth a page of their own,
 * because both are questions nobody can answer from a file: which grievances
 * are past their acknowledgement deadline, and who has stopped turning up.
 */
export default async function ConductPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("grievance:manage");
  const t = await pageT();

  const today = dateInZone(new Date(), tenant.timezone);
  const grievances = await openGrievances(session);

  // Abscondment is read off the attendance register, per cohort, because that
  // is where the fact lives. Nothing is stored: a corrected mark should change
  // the answer immediately.
  const canReadConduct = session.permissions.includes("conduct:manage");
  const programmes = canReadConduct ? await activeProgrammes(session) : [];

  const absconding = canReadConduct
    ? (
        await Promise.all(
          programmes.map(async (programme) => ({
            cohortId: programme.cohortId,
            cohortName: programme.cohortName,
            learners: await possibleAbscondment(session, programme.cohortId),
          })),
        )
      ).filter((row) => row.learners.length > 0)
    : [];

  const staff = await withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .selectDistinct({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .orderBy(users.lastName);

    return found.map((person) => ({
      id: person.id,
      name: `${person.firstName} ${person.lastName}`,
    }));
  });

  const overdue = grievances.filter(
    (row) => !row.acknowledgedAt && row.acknowledgeBy < today,
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("conductPage.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("conductPage.intro")}</p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card
            title={t("conductPage.overdue", { count: overdue.length })}
            description={t("conductPage.overdueNote", { days: DAYS_TO_ACKNOWLEDGE_GRIEVANCE })}
          >
            <ul className="space-y-1 text-sm">
              {overdue.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/people/${row.learnerId}`}
                    className="font-medium hover:underline"
                  >
                    {row.firstName} {row.lastName}
                  </Link>
                  <span className="ml-2 text-[var(--danger)]">
                    {t("conductPage.due", { date: row.acknowledgeBy })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card title={t("conductPage.grievances")} description={t("conductPage.grievancesNote")}>
        <Grievances
          rows={grievances.map((row) => ({
            id: row.id,
            learnerId: row.learnerId,
            learnerName: `${row.firstName} ${row.lastName}`,
            nature: row.nature,
            lodgedOn: row.lodgedOn,
            acknowledgeBy: row.acknowledgeBy,
            acknowledged: row.acknowledgedAt !== null,
            status: maybe(t, `grievance.status.${row.status}`) ?? row.status,
            rawStatus: row.status,
            decisionDueBy: row.decisionDueBy,
          }))}
          staff={staff}
          today={today}
        />
      </Card>

      {canReadConduct ? (
        <div className="mt-6">
          <Card title={t("conductPage.absconded")} description={t("conductPage.abscondedNote")}>
            {absconding.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("conductPage.nobody")}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {absconding.map((cohort) => (
                  <li key={cohort.cohortId}>
                    <p className="font-medium">{cohort.cohortName}</p>
                    <ul className="mt-1 space-y-1">
                      {cohort.learners.map((learner) => (
                        <li key={learner.userId}>
                          <Link
                            href={`/people/${learner.userId}`}
                            className="hover:underline"
                          >
                            {learner.name}
                          </Link>
                          <span className="ml-2 text-[var(--muted)]">
                            {t("conductPage.consecutive", { count: learner.consecutive, date: learner.since })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-[var(--muted)]">{t("conductPage.actOn")}</p>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
