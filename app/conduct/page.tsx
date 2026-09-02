import Link from "next/link";
import { eq } from "drizzle-orm";
import { requirePermission, requireTenant } from "@/lib/request";
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

const STATUS_LABEL: Record<string, string> = {
  lodged: "Lodged",
  acknowledged: "Acknowledged",
  under_investigation: "Under investigation",
  decided: "Decided",
  appealed: "Appealed",
  closed: "Closed",
};

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
        <h1 className="text-xl font-semibold">Conduct</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Grievances raised by learners, and anybody the register says has
          stopped turning up. Disciplinary matters sit on the learner&rsquo;s
          own page, where the rest of their record is.
        </p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${overdue.length} not acknowledged in time`}
            description={`A grievance is acknowledged within ${DAYS_TO_ACKNOWLEDGE_GRIEVANCE} working days. These are past that.`}
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
                    due {row.acknowledgeBy}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card
        title="Grievances"
        description="Raised by a learner about treatment, conditions, or anything else affecting them. Kept apart from appeals, which are about a result and go to the moderator."
      >
        <Grievances
          rows={grievances.map((row) => ({
            id: row.id,
            learnerId: row.learnerId,
            learnerName: `${row.firstName} ${row.lastName}`,
            nature: row.nature,
            lodgedOn: row.lodgedOn,
            acknowledgeBy: row.acknowledgeBy,
            acknowledged: row.acknowledgedAt !== null,
            status: STATUS_LABEL[row.status] ?? row.status,
            rawStatus: row.status,
            decisionDueBy: row.decisionDueBy,
          }))}
          staff={staff}
          today={today}
        />
      </Card>

      {canReadConduct ? (
        <div className="mt-6">
          <Card
            title="Possibly absconded"
            description="Two or more consecutive training days absent with no word. Read off the register rather than stored, so correcting a mark changes the answer at once. An absence recorded as excused is communication, and breaks the run."
          >
            {absconding.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Nobody. Everybody is either turning up or has told somebody why
                not.
              </p>
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
                            {learner.consecutive} consecutive, since{" "}
                            {learner.since}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-[var(--muted)]">
              A list to act on, never a decision. Contacting the learner,
              writing to the sponsor and issuing a notice of intention to
              terminate are all things a person does.
            </p>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
