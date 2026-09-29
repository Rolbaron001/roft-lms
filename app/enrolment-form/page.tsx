import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant, said } from "@/lib/request";
import {
  EnrolmentFormError,
  getEnrolmentForm,
  identityDisagreements,
  inheritedFor,
} from "@/lib/enrolment-form";
import { labelFor } from "@/lib/learner-codes";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { EnrolmentForm } from "./enrolment-form";

/**
 * The learner's enrolment form.
 *
 * One route for two readers, because it is the same document seen from two
 * sides: a learner completing their own, and a coordinator completing one on
 * somebody's behalf. `?learner=<id>` is the second case, and the library
 * refuses it to anybody who may not.
 *
 * Heidi named this form, with the rollout schedule, as the evidence a QCTO
 * monitor asks for on a visit. That is why it records who confirmed it and
 * when, rather than only holding the answers.
 */
export default async function EnrolmentFormPage({
  searchParams,
}: {
  searchParams: Promise<{ learner?: string }>;
}) {
  const { learner: requested } = await searchParams;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, dates } = await pageLocale();
  const longDate = (value: Date) =>
    value.toLocaleDateString(dates, { day: "numeric", month: "long", year: "numeric" });

  const learnerId = requested || session.userId;

  let view;
  try {
    view = await said(await getEnrolmentForm(session, learnerId));
  } catch (error) {
    if (error instanceof EnrolmentFormError) {
      if (error.reason === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const inherited = await inheritedFor(session, learnerId);
  const disagreements = identityDisagreements(view.learner);

  const onSomebodyElsesBehalf = learnerId !== session.userId;

  const notRecorded = t("enrolForm.notRecorded");
  const known: [string, string][] = [
    [t("enrolForm.name"), `${view.learner.firstName} ${view.learner.lastName}`],
    [t("enrolForm.idNumber"), view.learner.nationalId ?? notRecorded],
    [t("enrolForm.birth"), view.learner.dateOfBirth ? longDate(view.learner.dateOfBirth) : notRecorded],
    [t("enrolForm.email"), view.learner.email],
    [
      t("enrolForm.population"),
      view.learner.equityCode ? labelFor("equityCode", view.learner.equityCode) : notRecorded,
    ],
    [
      t("enrolForm.disability"),
      view.learner.disabilityCode
        ? labelFor("disabilityStatusCode", view.learner.disabilityCode)
        : notRecorded,
    ],
  ];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {onSomebodyElsesBehalf
            ? t("enrolForm.titleOther", { name: `${view.learner.firstName} ${view.learner.lastName}` })
            : t("enrolForm.titleOwn")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("enrolForm.intro", { provider: tenant.displayName })}
        </p>
      </div>

      {/*
        Shown as fact rather than as empty fields. Roland's instruction was that
        the learner inherits cohort details automatically, and asking somebody
        for a date the platform already holds is how a form loses its reader.
      */}
      <div className="mb-6">
        <Card title={t("enrolForm.onRecord")} description={t("enrolForm.onRecordNote")}>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {known.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-sm text-[var(--muted)]">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>

          {inherited.length > 0 ? (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              {inherited.map((row) => (
                <p key={row.cohortId} className="text-sm">
                  <span className="font-medium">{row.programme}</span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.cohortName}
                    {" · "}
                    {row.inductionOn
                      ? t("enrolForm.induction", { date: row.inductionOn })
                      : t("enrolForm.noInduction")}
                  </span>
                </p>
              ))}
            </div>
          ) : null}

          {disagreements.length > 0 ? (
            <div className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2">
              <p className="text-sm font-medium text-[var(--danger)]">
                {t("enrolForm.doesNotAdd")}
              </p>
              <ul className="mt-1 space-y-1">
                {disagreements.map((problem) => (
                  <li key={problem} className="text-sm text-[var(--danger)]">
                    {problem}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--muted)]">{t("enrolForm.idNote")}</p>
            </div>
          ) : null}
        </Card>
      </div>

      {view.outstanding.length > 0 ? (
        <div className="mb-6">
          <Card
            title={t("enrolForm.stillToAnswer", { count: view.outstanding.length })}
            description={t("enrolForm.stillNote")}
          >
            <ul className="space-y-1.5">
              {view.outstanding.map((item) => (
                <li key={item.field} className="text-sm">
                  <span className="font-medium">{item.field}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {item.why}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="mb-6">
          <Card title={t("enrolForm.complete")} description={t("enrolForm.completeNote")}>
            <p className="text-sm text-[var(--muted)]">
              {t("enrolForm.confirmed", {
                date: view.profile.confirmedAt ? longDate(view.profile.confirmedAt) : t("enrolForm.recently"),
              })}
            </p>
          </Card>
        </div>
      )}

      {/*
        The printable copy. Heidi named the enrolment form as evidence a QCTO
        monitor asks for, and a screen is not what a monitor is handed.
      */}
      <p className="mb-6">
        <Link
          href={`/enrolment-form/document${onSomebodyElsesBehalf ? `?learner=${learnerId}` : ""}`}
          className="text-sm underline underline-offset-2"
        >
          {t("enrolForm.print")}
        </Link>
        <span className="ml-2 text-sm text-[var(--muted)]">{t("enrolForm.printNote")}</span>
      </p>

      <EnrolmentForm
        learnerId={learnerId}
        profile={view.profile}
        disabilityCode={view.learner.disabilityCode}
        popiaAgreedAt={view.learner.consentGivenAt}
        readOnlyReason={null}
      />
    </AppShell>
  );
}
