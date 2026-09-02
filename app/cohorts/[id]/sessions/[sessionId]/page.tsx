import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { sessionRegister, SchedulingError } from "@/lib/scheduling";
import { Card } from "@/components/ui";
import { RegisterForm } from "./register-form";
import { Sitting } from "./sitting";
import { withTenant } from "@/db/client";
import { invigilatedSittings } from "@/db/schema";
import { sittingRegister } from "@/lib/invigilation";
import { eq } from "drizzle-orm";

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
