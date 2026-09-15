import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession, requireTenant } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { FisaError, getInstrument } from "@/lib/fisa";
import type { ChecklistAnswer } from "@/lib/fisa-checklist";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import {
  AppointForm,
  ChecklistForm,
  CoverageForm,
  NewVersionForm,
  SendToModerationForm,
  SignConfidentialityForm,
  SignOffForm,
} from "../fisa-forms";

/**
 * One FISA: who is appointed, the two reports, and the sign-off that decides
 * whether anybody may sit it.
 *
 * Both reports are shown to everyone who can read a FISA, because a moderator
 * needs to see what the examiner said and a coordinator needs to see both. Only
 * the person appointed to a report can change it, which the library enforces
 * and this screen reflects by disabling what somebody may not touch.
 */
export default async function FisaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  if (
    !canAny(session, [
      "assessment:author",
      "assessment:moderate",
      "assessment:assess",
    ])
  ) {
    redirect("/not-permitted");
  }

  let view;
  try {
    view = await getInstrument(session, id);
  } catch (error) {
    if (error instanceof FisaError) notFound();
    throw error;
  }

  const { instrument, appointments, responses, outcomes, coverage } = view;

  const examiner = appointments.find((a) => a.role === "examiner");
  const moderator = appointments.find((a) => a.role === "moderator");

  const mayAuthor = session.permissions.includes("assessment:author");
  const settled =
    instrument.status === "approved" || instrument.status === "retired";

  /** Whether this person may write on a given report, as the library decides. */
  const canWrite = (role: "examiner" | "moderator") => {
    const appointment = role === "examiner" ? examiner : moderator;
    return (
      !settled &&
      Boolean(appointment) &&
      appointment!.userId === session.userId &&
      Boolean(appointment!.confidentialitySignedAt)
    );
  };

  const answersFor = (role: "examiner" | "moderator") =>
    Object.fromEntries(
      responses
        .filter((r) => r.role === role)
        .map((r) => [r.itemCode, r.answer as ChecklistAnswer]),
    );

  const recommendationsFor = (role: "examiner" | "moderator") =>
    Object.fromEntries(
      responses
        .filter((r) => r.role === role)
        .map((r) => [r.itemCode, r.recommendation]),
    );

  // Staff who could be appointed. Anyone with an account may be named; only
  // somebody with one can fill in their own report.
  const staff = mayAuthor
    ? await withTenant(session.organisationId, (tx) =>
        tx
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(eq(users.status, "active")),
      )
    : [];

  const staffOptions = staff.map((person) => ({
    id: person.id,
    name: `${person.firstName} ${person.lastName}`,
  }));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <p className="text-sm text-[var(--muted)]">
          <Link href="/fisa" className="underline underline-offset-2">
            Final integrated summative assessment
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {instrument.title}
          <span className="ml-2 text-base font-normal text-[var(--muted)]">
            version {instrument.version}
          </span>
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {instrument.programme}
          {instrument.saqaId ? ` · ${instrument.saqaId}` : ""}
          {instrument.nqfLevel ? ` · NQF ${instrument.nqfLevel}` : ""}
          {instrument.credits ? ` · ${instrument.credits} credits` : ""}
        </p>
      </div>

      {/* The gate, stated first because it is what a reader is here to learn. */}
      <div className="mb-6">
        <div
          className="rounded-lg border-2 p-5"
          style={{
            borderColor:
              instrument.status === "approved"
                ? "var(--success)"
                : "var(--border)",
          }}
        >
          <p className="text-sm font-semibold">
            {instrument.status === "approved"
              ? "Signed off as fit for purpose — candidates may sit this paper"
              : instrument.status === "retired"
                ? "Withdrawn"
                : instrument.status === "in_moderation"
                  ? "With the moderator — nobody may sit it yet"
                  : "Being written — nobody may sit it yet"}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {instrument.approvedAt
              ? `Moderated and approved on ${instrument.approvedAt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.`
              : "A FISA is moderated before it is sat, not after. That is what makes it defensible at a monitoring visit."}
          </p>

          <dl className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--muted)]">Duration</dt>
              <dd className="text-sm">
                {instrument.durationMinutes
                  ? `${instrument.durationMinutes} minutes`
                  : "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Total marks</dt>
              <dd className="text-sm">{instrument.totalMarks ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Pass mark</dt>
              <dd className="text-sm">
                {instrument.passMarkPercent
                  ? `${instrument.passMarkPercent}%${
                      instrument.totalMarks
                        ? ` (${Math.ceil((instrument.passMarkPercent / 100) * instrument.totalMarks)} of ${instrument.totalMarks})`
                        : ""
                    }`
                  : "Not set"}
              </dd>
            </div>
          </dl>

          {instrument.hasPracticalComponent ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {instrument.practicalNote ||
                "Also has a practical component, judged competent or not yet competent."}
            </p>
          ) : null}

          {instrument.qualityRating ? (
            <p className="mt-3 text-sm">
              Moderator&rsquo;s overall judgement:{" "}
              <span className="font-medium">{instrument.qualityRating}</span>
              {instrument.qualityMotivation
                ? ` — ${instrument.qualityMotivation}`
                : ""}
            </p>
          ) : null}
        </div>
      </div>

      {/* Appointments, and the confidentiality that makes them real. */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {(["examiner", "moderator"] as const).map((role) => {
          const appointment = role === "examiner" ? examiner : moderator;

          return (
            <Card
              key={role}
              title={role === "examiner" ? "Examiner / developer" : "Moderator"}
              description={
                role === "examiner"
                  ? "Writes the paper."
                  : "Checks it is fit for purpose, before anybody sits it."
              }
            >
              {appointment ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{appointment.fullName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {[
                      appointment.idNumber,
                      appointment.email,
                      appointment.mobile,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No contact details recorded"}
                  </p>

                  {appointment.confidentialitySignedAt ? (
                    <p className="text-sm" style={{ color: "var(--success)" }}>
                      Confidentiality agreement signed{" "}
                      {appointment.confidentialitySignedAt.toLocaleDateString(
                        "en-ZA",
                      )}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm" style={{ color: "var(--danger)" }}>
                        No confidentiality agreement yet. They may not see or
                        judge the paper until it is signed.
                      </p>
                      {appointment.userId === session.userId || mayAuthor ? (
                        <SignConfidentialityForm
                          instrumentId={instrument.id}
                          appointmentId={appointment.id}
                        />
                      ) : null}
                    </div>
                  )}

                  <p className="pt-1">
                    <Link
                      href={`/fisa/${instrument.id}/agreement/${role}`}
                      className="text-sm underline underline-offset-2"
                    >
                      The agreement
                    </Link>
                  </p>
                </div>
              ) : mayAuthor && !settled ? (
                <AppointForm
                  instrumentId={instrument.id}
                  role={role}
                  staff={staffOptions}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Nobody appointed yet.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Section 2, which is the part a monitor interrogates. */}
      <div className="mb-6">
        <Card
          title="Exit level outcomes, and where the paper assesses them"
          description="Section 2 of both reports. The only place that shows the paper covers the qualification rather than merely looking like an exam."
        >
          {outcomes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              This programme has no exit level outcomes recorded, so there is
              nothing to map the paper against. Import the curriculum first.
            </p>
          ) : (
            <div>
              {outcomes.map((outcome) => (
                <CoverageForm
                  key={outcome.id}
                  instrumentId={instrument.id}
                  role={canWrite("moderator") ? "moderator" : "examiner"}
                  outcome={outcome}
                  existing={
                    coverage.find(
                      (c) =>
                        c.exitLevelOutcomeId === outcome.id &&
                        c.role ===
                          (canWrite("moderator") ? "moderator" : "examiner"),
                    ) ?? null
                  }
                  readOnly={
                    !canWrite("examiner") && !canWrite("moderator")
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* The two reports. */}
      <div className="mb-6 space-y-6">
        {(["examiner", "moderator"] as const).map((role) => (
          <Card
            key={role}
            title={
              role === "examiner"
                ? "Examiner / developer report"
                : "Pre-moderator report"
            }
            description={
              view.outstanding[role].length === 0
                ? "Complete."
                : `${view.outstanding[role].length} still unanswered.`
            }
          >
            <ChecklistForm
              instrumentId={instrument.id}
              role={role}
              answers={answersFor(role)}
              recommendations={recommendationsFor(role)}
              readOnly={!canWrite(role)}
            />

            {!canWrite(role) && !settled ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Only the appointed {role}, once their confidentiality agreement
                is signed, can answer these.
              </p>
            ) : null}
          </Card>
        ))}
      </div>

      {/* What happens next. */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {canWrite("examiner") && instrument.status === "draft" ? (
          <Card
            title="Hand it to the moderator"
            description="Once your own report is complete."
          >
            <SendToModerationForm instrumentId={instrument.id} />
          </Card>
        ) : null}

        {canWrite("moderator") && instrument.status === "in_moderation" ? (
          <Card
            title="Final moderation"
            description={
              view.signOff.ready
                ? "Everything is answered."
                : (view.signOff.why ?? "Not ready yet.")
            }
          >
            {view.signOff.ready ? (
              <SignOffForm instrumentId={instrument.id} />
            ) : (
              <p className="text-sm text-[var(--muted)]">{view.signOff.why}</p>
            )}
          </Card>
        ) : null}

        {mayAuthor && instrument.status === "approved" ? (
          <Card
            title="A later version"
            description="This one stays exactly as it is, because candidates may have sat it. A new version needs its own moderation."
          >
            <NewVersionForm instrumentId={instrument.id} />
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
