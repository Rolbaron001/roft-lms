import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { pageLocale, requireSession, requireTenant, said } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { FisaError, getInstrument } from "@/lib/fisa";
import type { ChecklistAnswer } from "@/lib/fisa-checklist";
import { maybe } from "@/lib/i18n/maybe";
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
  const { t, dates } = await pageLocale();

  let view;
  try {
    view = await said(await getInstrument(session, id));
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
            {t("fisa.title")}
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {instrument.title}
          <span className="ml-2 text-base font-normal text-[var(--muted)]">
            {t("fisa.versionN", { version: instrument.version })}
          </span>
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {instrument.programme}
          {instrument.saqaId ? ` · ${instrument.saqaId}` : ""}
          {instrument.nqfLevel ? ` · NQF ${instrument.nqfLevel}` : ""}
          {instrument.credits ? ` · ${t("fisa.credits", { credits: instrument.credits })}` : ""}
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
            {maybe(t, `fisa.gate.${instrument.status}`) ?? instrument.status}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {instrument.approvedAt
              ? t("fisa.approvedOn", {
                  date: instrument.approvedAt.toLocaleDateString(dates, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                })
              : t("fisa.beforeNotAfter")}
          </p>

          <dl className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--muted)]">{t("fisa.duration")}</dt>
              <dd className="text-sm">
                {instrument.durationMinutes
                  ? t("fisa.minutes", { minutes: instrument.durationMinutes })
                  : t("fisa.notSet")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">{t("fisa.totalMarks")}</dt>
              <dd className="text-sm">{instrument.totalMarks ?? t("fisa.notSet")}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">{t("fisa.passMark")}</dt>
              <dd className="text-sm">
                {instrument.passMarkPercent
                  ? instrument.totalMarks
                    ? t("fisa.passOf", {
                        percent: instrument.passMarkPercent,
                        needed: Math.ceil((instrument.passMarkPercent / 100) * instrument.totalMarks),
                        total: instrument.totalMarks,
                      })
                    : `${instrument.passMarkPercent}%`
                  : t("fisa.notSet")}
              </dd>
            </div>
          </dl>

          {instrument.hasPracticalComponent ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {instrument.practicalNote || t("fisa.practical")}
            </p>
          ) : null}

          {instrument.qualityRating ? (
            <p className="mt-3 text-sm">
              {t("fisa.overall", { rating: instrument.qualityRating })}
              {instrument.qualityMotivation ? `: ${instrument.qualityMotivation}` : ""}
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
              title={role === "examiner" ? t("fisa.examiner") : t("fisa.moderator")}
              description={role === "examiner" ? t("fisa.examinerIntro") : t("fisa.moderatorIntro")}
            >
              {appointment ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{appointment.fullName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {[appointment.idNumber, appointment.email, appointment.mobile]
                      .filter(Boolean)
                      .join(" · ") || t("fisa.noContact")}
                  </p>

                  {appointment.confidentialitySignedAt ? (
                    <p className="text-sm" style={{ color: "var(--success)" }}>
                      {t("fisa.signed", {
                        date: appointment.confidentialitySignedAt.toLocaleDateString(dates),
                      })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm" style={{ color: "var(--danger)" }}>
                        {t("fisa.unsigned")}
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
                      {t("fisa.agreement")}
                    </Link>
                  </p>
                </div>
              ) : mayAuthor && !settled ? (
                <AppointForm instrumentId={instrument.id} role={role} staff={staffOptions} />
              ) : (
                <p className="text-sm text-[var(--muted)]">{t("fisa.nobody")}</p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Section 2, which is the part a monitor interrogates. */}
      <div className="mb-6">
        <Card title={t("fisa.outcomes")} description={t("fisa.outcomesIntro")}>
          {outcomes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("fisa.noOutcomes")}</p>
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
                  readOnly={!canWrite("examiner") && !canWrite("moderator")}
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
            title={role === "examiner" ? t("fisa.examinerReport") : t("fisa.moderatorReport")}
            description={
              view.outstanding[role].length === 0
                ? t("fisa.complete")
                : t("fisa.unanswered", { count: view.outstanding[role].length })
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
                {role === "examiner" ? t("fisa.onlyExaminer") : t("fisa.onlyModerator")}
              </p>
            ) : null}
          </Card>
        ))}
      </div>

      {/* What happens next. */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {canWrite("examiner") && instrument.status === "draft" ? (
          <Card title={t("fisa.handOver")} description={t("fisa.handOverIntro")}>
            <SendToModerationForm instrumentId={instrument.id} />
          </Card>
        ) : null}

        {canWrite("moderator") && instrument.status === "in_moderation" ? (
          <Card
            title={t("fisa.final")}
            description={
              view.signOff.ready
                ? t("fisa.allAnswered")
                : (view.signOff.why ?? t("fisa.notReady"))
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
          <Card title={t("fisa.later")} description={t("fisa.laterIntro")}>
            <NewVersionForm instrumentId={instrument.id} />
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
