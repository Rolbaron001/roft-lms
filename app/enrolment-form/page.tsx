import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
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

  const learnerId = requested || session.userId;

  let view;
  try {
    view = await getEnrolmentForm(session, learnerId);
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

  const known: [string, string][] = [
    ["Name", `${view.learner.firstName} ${view.learner.lastName}`],
    ["Identity number", view.learner.nationalId ?? "Not recorded"],
    [
      "Date of birth",
      view.learner.dateOfBirth
        ? view.learner.dateOfBirth.toLocaleDateString("en-ZA", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "Not recorded",
    ],
    ["Email", view.learner.email],
    [
      "Population group",
      view.learner.equityCode
        ? labelFor("equityCode", view.learner.equityCode)
        : "Not recorded",
    ],
    [
      "Disability",
      view.learner.disabilityCode
        ? labelFor("disabilityStatusCode", view.learner.disabilityCode)
        : "Not recorded",
    ],
  ];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {onSomebodyElsesBehalf
            ? `Enrolment form: ${view.learner.firstName} ${view.learner.lastName}`
            : "Your enrolment form"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {tenant.displayName} has to send these details to the Quality Council
          for Trades and Occupations when you are enrolled. Most of it is
          already known and shown below; the rest is what nobody can answer
          except you. You can save as you go and come back to it.
        </p>
      </div>

      {/*
        Shown as fact rather than as empty fields. Roland's instruction was that
        the learner inherits cohort details automatically, and asking somebody
        for a date the platform already holds is how a form loses its reader.
      */}
      <div className="mb-6">
        <Card
          title="What is already on record"
          description="Tell your coordinator if any of this is wrong; it is not yours to change here."
        >
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
                    {row.inductionOn
                      ? ` · induction ${row.inductionOn}`
                      : " · induction not yet dated"}
                  </span>
                </p>
              ))}
            </div>
          ) : null}

          {disagreements.length > 0 ? (
            <div className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2">
              <p className="text-sm font-medium text-[var(--danger)]">
                Something here does not add up
              </p>
              <ul className="mt-1 space-y-1">
                {disagreements.map((problem) => (
                  <li key={problem} className="text-sm text-[var(--danger)]">
                    {problem}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--muted)]">
                A South African identity number carries the date of birth and
                the gender inside it, and the QCTO checks that they agree. It is
                usually a mistyped digit. Your coordinator can correct it.
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      {view.outstanding.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${view.outstanding.length} still to answer`}
            description="Nothing is lost if you stop partway. This is what would be missing from the submission as it stands."
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
          <Card
            title="Complete"
            description="Everything the submission needs is here."
          >
            <p className="text-sm text-[var(--muted)]">
              Confirmed{" "}
              {view.profile.confirmedAt
                ? view.profile.confirmedAt.toLocaleDateString("en-ZA", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "recently"}
              .
            </p>
          </Card>
        </div>
      )}

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
