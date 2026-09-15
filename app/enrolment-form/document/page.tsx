import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import {
  documentValuesFor,
  EnrolmentFormError,
  getEnrolmentForm,
  inheritedFor,
} from "@/lib/enrolment-form";
import {
  activeTemplate,
  fillTemplate,
  providerDetails,
  statutoryBlocksFor,
} from "@/lib/document-templates";
import { STARTER_TEMPLATES } from "@/lib/document-fields";
import { AppShell } from "@/components/app-shell";

/**
 * The completed enrolment form, as a document.
 *
 * Heidi named this on 9 September as evidence a QCTO monitor asks for on a
 * visit, alongside the rollout schedule. The form existed as a screen somebody
 * filled in; a screen is not what a monitor is handed.
 *
 * Printable rather than downloadable, because the point of the paper copy is
 * the signature at the foot of it. A PDF the platform generated and nobody
 * signed would be a worse artefact than the screen it came from.
 *
 * Laid out from the provider's own template where they have made one, and from
 * the platform's starting point where they have not - the same machinery as
 * the Statement of Results, so a provider who has already laid one out will
 * find this works the way that one does.
 */
export default async function EnrolmentFormDocumentPage({
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
  const provider = await providerDetails(session);
  const template = await activeTemplate(session, "enrolment_form");

  const values = {
    ...documentValuesFor({
      learner: view.learner,
      profile: view.profile,
      // The first programme they are on. A learner on two would need two
      // forms, which is the QCTO's own position: one enrolment, one form.
      inherited: {
        programme: inherited[0]?.programme ?? null,
        cohortName: inherited[0]?.cohortName ?? null,
        inductionOn: inherited[0]?.inductionOn ?? null,
      },
    }),
    "provider.name": provider.legalName,
    "provider.address": provider.address.join(", "),
    "provider.accreditationNumber": provider.accreditationNumber ?? "",
    "document.issuedOn": new Date().toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    /**
     * Not a verification reference: nothing here is verifiable by a third
     * party the way a certificate is. It identifies which learner's form this
     * is, so a printed copy found loose on a desk can be put back.
     */
    "document.reference": `ENROL-${learnerId.slice(0, 8).toUpperCase()}`,
  };

  const body = fillTemplate(
    template?.body ?? STARTER_TEMPLATES.enrolment_form,
    values,
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <style>{`
        @media print {
          header, nav, aside, .no-print { display: none !important; }
          main { padding: 0 !important; }
          .document { border: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          {view.outstanding.length > 0 ? (
            <span style={{ color: "var(--danger)" }}>
              {view.outstanding.length} answers are still missing, so this form
              will print with blanks. They are listed on the form itself.
            </span>
          ) : (
            "Complete. Print it, have the learner sign it, and file it."
          )}
        </p>
        <Link
          href={`/enrolment-form${requested ? `?learner=${requested}` : ""}`}
          className="text-sm underline underline-offset-2"
        >
          Back to the form
        </Link>
      </div>

      <article className="document mx-auto max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8">
        {/*
          Rendered as preformatted text because the template is laid out in
          columns with spaces, the way the provider wrote it. Reflowing it into
          paragraphs would throw away the alignment they chose.
        */}
        <pre className="whitespace-pre-wrap font-[inherit] text-sm leading-relaxed">
          {body}
        </pre>

        <div className="mt-8 space-y-3 border-t border-[var(--border)] pt-4">
          {statutoryBlocksFor("enrolment_form").map((block) => (
            <p key={block} className="text-xs text-[var(--muted)]">
              {block}
            </p>
          ))}
        </div>
      </article>

      {view.outstanding.length > 0 ? (
        <div className="no-print mx-auto mt-4 max-w-3xl">
          <p className="text-sm font-medium">Still unanswered</p>
          <ul className="mt-1 space-y-0.5">
            {view.outstanding.map((item) => (
              <li key={item.field} className="text-sm text-[var(--muted)]">
                {item.field} — {item.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AppShell>
  );
}
