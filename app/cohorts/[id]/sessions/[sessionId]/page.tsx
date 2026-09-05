import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { sessionRegister, SchedulingError } from "@/lib/scheduling";
import { Card } from "@/components/ui";
import { RegisterForm } from "./register-form";
import { Sitting } from "./sitting";
import { SetUpSitting, SittingStatus } from "./set-up-sitting";
import { withTenant } from "@/db/client";
import {
  assessments,
  cohorts,
  invigilatedSittings,
  userRoles,
  users,
} from "@/db/schema";
import { sittingRegister } from "@/lib/invigilation";
import { and, eq, ne } from "drizzle-orm";

const KIND_LABEL: Record<string, string> = {
  induction: "Induction",
  lecture: "Lecture",
  revision: "Revision",
  summative: "Summative assessment",
  mock_eisa: "Mock EISA",
  workplace_induction: "Workplace induction",
  walk_in: "Workplace walk-in",
};

/**
 * One session's register.
 *
 * The page a facilitator opens with the cohort in front of them, so it holds
 * one thing and no navigation to get lost in.
 */
export default async function SessionRegisterPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("attendance:record");

  let register;
  try {
    register = await sessionRegister(session, sessionId);
  } catch (error) {
    if (error instanceof SchedulingError) notFound();
    throw error;
  }

  const marked = register.lines.filter((line) => line.status !== null).length;

  // A supervised sitting, if one has been set up at this session. Looked up by
  // the session rather than passed in, so the invigilator reaches the room
  // from the same page as the register and does not have to know it exists.
  const sittingId = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ id: invigilatedSittings.id })
      .from(invigilatedSittings)
      .where(eq(invigilatedSittings.sessionId, sessionId));
    return row?.id ?? null;
  });

  const supervised = sittingId
    ? await sittingRegister(session, sittingId)
    : null;

  // What could be supervised here, and who could supervise it. Read only when
  // there is no sitting yet, because that is the only case that offers the
  // choice - and a session that already has one should not pay for the query.
  // Only where a sitting is actually allowed. The library refuses one on an
  // ordinary lecture - correctly, since a register nobody intended under rules
  // nobody announced is worse than no register - but offering the form on an
  // induction and then refusing it teaches people that the button lies. So the
  // offer follows the same rule as the refusal.
  const supervisable =
    register.session.kind === "summative" ||
    register.session.kind === "mock_eisa";

  const canSetUp =
    session.permissions.includes("session:manage") && supervisable;

  const options =
    supervised || !canSetUp
      ? { assessments: [], invigilators: [] }
      : await withTenant(session.organisationId, async (tx) => {
          const [cohort] = await tx
            .select({ courseId: cohorts.courseId })
            .from(cohorts)
            .where(eq(cohorts.id, id));

          const papers = cohort
            ? await tx
                .select({ id: assessments.id, title: assessments.title })
                .from(assessments)
                .where(
                  and(
                    eq(assessments.courseId, cohort.courseId),
                    eq(assessments.status, "published"),
                  ),
                )
                .orderBy(assessments.title)
            : [];

          // Anybody who could run the room. Not filtered to one role: a
          // facilitator, an assessor or the administrator all invigilate in a
          // small provider, and naming who may is the provider's business.
          const staff = await tx
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .where(
              and(
                eq(users.status, "active"),
                ne(userRoles.role, "learner"),
              ),
            )
            .orderBy(users.lastName);

          const seen = new Set<string>();
          return {
            assessments: papers.map((row) => ({
              id: row.id,
              label: row.title,
            })),
            invigilators: staff
              .filter((row) => !seen.has(row.id) && seen.add(row.id))
              .map((row) => ({
                id: row.id,
                label: `${row.firstName} ${row.lastName}`,
              })),
          };
        });

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href={`/cohorts/${id}`}
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back to the cohort
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {register.session.title ??
          KIND_LABEL[register.session.kind] ??
          "Session"}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {KIND_LABEL[register.session.kind] ?? register.session.kind} ·{" "}
        {register.session.date} · {marked} of {register.lines.length} marked
      </p>

      {supervised ? (
        <div className="mt-6">
          <Card
            title="Supervised sitting"
            description="Who was admitted, what they agreed to, and that their script was received. The meeting itself runs where your lectures do; this is the record of how it was supervised."
          >
            {canSetUp ? (
              <div className="mb-4">
                <SittingStatus
                  cohortId={id}
                  sessionId={sessionId}
                  sittingId={supervised.sitting.id}
                  status={supervised.sitting.status}
                />
              </div>
            ) : null}

            <Sitting
              cohortId={id}
              zone={tenant.timezone}
              sitting={{
                id: supervised.sitting.id,
                status: supervised.sitting.status,
                assessmentTitle: supervised.sitting.assessmentTitle,
                scheduledDate: supervised.sitting.scheduledDate,
                startTime: supervised.sitting.startTime,
                closesAfter: supervised.sitting.closesAfter,
                arriveBeforeMinutes: supervised.sitting.arriveBeforeMinutes,
                cameraRequired: supervised.sitting.cameraRequired,
                permittedMaterials: supervised.sitting.permittedMaterials,
                declarationText: supervised.sitting.declarationText,
                meetingUrl: supervised.sitting.meetingUrl,
                venue: supervised.sitting.venue,
                deliveryMode: supervised.sitting.deliveryMode,
              }}
              lines={supervised.lines}
              incidents={supervised.incidents}
            />
          </Card>
        </div>
      ) : canSetUp ? (
        <div className="mt-6">
          <Card
            title="Supervised sitting"
            description="This is a summative session, so it can be invigilated."
          >
            <SetUpSitting
              cohortId={id}
              sessionId={sessionId}
              assessments={options.assessments}
              invigilators={options.invigilators}
            />
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card
          title="Register"
          description="Who was here. Saved marks can be corrected later, and every change is recorded against whoever made it."
        >
          <RegisterForm
            cohortId={id}
            sessionId={sessionId}
            lines={register.lines}
          />
        </Card>
      </div>
    </main>
  );
}
