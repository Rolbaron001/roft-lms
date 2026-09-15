import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { confidentialityDetails, FisaError } from "@/lib/fisa";
import { AppShell } from "@/components/app-shell";

/**
 * The confidentiality agreement, as the template lays it out.
 *
 * Printable rather than downloadable, because this is a document somebody signs
 * by hand: the template ends in a signature line and a date. A PDF the platform
 * generated and nobody signed would be worse than no document.
 *
 * The wording is the template's own, from
 * `Design/Templates/FISA Confidentiality Agreement - Moderator.docx` and its
 * examiner counterpart. The two differ only in the role named and in one
 * spelling - "unauthorised" against "unauthorized" - which is reconciled to the
 * South African spelling here.
 *
 * No QCTO or SAQA logo appears on it. Heidi raised that on 9 September as a
 * regulatory prohibition; naming the QCTO in text is a different matter and
 * stays, because the agreement is about a QCTO qualification.
 */
export default async function AgreementPage({
  params,
}: {
  params: Promise<{ id: string; role: string }>;
}) {
  const { id, role } = await params;

  if (role !== "examiner" && role !== "moderator") notFound();

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

  let details;
  try {
    details = await confidentialityDetails(session, id, role);
  } catch (error) {
    if (error instanceof FisaError) notFound();
    throw error;
  }

  const title = role === "examiner" ? "Examiner / Developer" : "Moderator";

  const rows: [string, string][] = [
    [`Name of ${role}`, details.fullName],
    ["Identity number", details.idNumber ?? ""],
    ["Email address", details.email ?? ""],
    ["Contact number", details.mobile ?? ""],
    ["Name of SDP", tenant.displayName],
    ["Title of qualification", details.programme],
    ["SP ID", details.saqaId ?? ""],
    ["Credits", details.credits ? String(details.credits) : ""],
    ["NQF level", details.nqfLevel ? String(details.nqfLevel) : ""],
  ];

  return (
    <AppShell tenant={tenant} session={session}>
      {/* Print styles, so the page that comes out of the printer is the
          agreement and not the application around it. */}
      <style>{`
        @media print {
          header, nav, aside, .no-print { display: none !important; }
          main { padding: 0 !important; }
          .agreement { border: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          Print this, have it signed, and record the signature on the FISA.
        </p>
      </div>

      <article className="agreement mx-auto max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8">
        <h1 className="text-center text-lg font-semibold uppercase tracking-wide">
          FISA Confidentiality Agreement
        </h1>
        <p className="mt-1 text-center text-sm text-[var(--muted)]">{title}</p>

        <p className="mt-6 text-sm leading-relaxed">
          This serves to confirm that the {title} agrees not to release or
          distribute any information regarding the contents of the Final
          Integrated Summative Assessment for this qualification to any
          unauthorised party when developing or moderating assessments,
          reviewing assessments, or with regard to the releasing of results for
          the following qualification:
        </p>

        <dl className="mt-6 divide-y divide-[var(--border)]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[14rem_1fr] gap-4 py-2">
              <dt className="text-sm uppercase tracking-wide text-[var(--muted)]">
                {label}
              </dt>
              <dd className="text-sm">
                {value || (
                  <span className="text-[var(--muted)]">
                    ________________________
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 grid grid-cols-2 gap-8">
          <div>
            <div className="border-b border-[var(--text)]" />
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--muted)]">
              Signature
            </p>
          </div>
          <div>
            <div className="border-b border-[var(--text)]" />
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--muted)]">
              Date
            </p>
          </div>
        </div>

        {details.signedAt ? (
          <p className="mt-8 text-sm" style={{ color: "var(--success)" }}>
            Recorded as signed on{" "}
            {details.signedAt.toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            .
          </p>
        ) : null}
      </article>
    </AppShell>
  );
}
