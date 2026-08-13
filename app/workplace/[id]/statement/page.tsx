import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { getLogbook } from "@/lib/workplace";

function formatDate(value: Date | null | undefined): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const KIND_HEADINGS: Record<string, string> = {
  work_activity: "Work Experience",
  contextual_knowledge: "Workplace Knowledge Tested",
  supporting_evidence: "Supporting Evidence",
};

/**
 * The Statement of Work Experience — Section 4D of the curriculum document.
 *
 * A print artefact, deliberately. It is signed, filed and handed to a
 * moderator, so it is laid out for paper: no navigation, no application
 * furniture, black on white. The provider prints it from the browser.
 *
 * Only produced for a logbook the coach has actually signed. A blank statement
 * with a signature line is a form; this is a record, and issuing one before
 * the attestation exists would make it a form again.
 */
export default async function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const view = await getLogbook(session, id);

  if (
    view.logbook.status !== "coach_signed" &&
    view.logbook.status !== "accepted_by_assessor"
  ) {
    notFound();
  }

  const { logbook, agreement, module, learner, entries } = view;

  const byKind = new Map<string, typeof entries>();
  for (const entry of entries) {
    byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  }

  return (
    <main className="mx-auto max-w-3xl bg-white px-10 py-10 text-[13px] leading-relaxed text-black print:px-0 print:py-0">
      <header className="mb-6 border-b-2 border-black pb-4">
        <p className="text-xs uppercase tracking-widest">
          {tenant.displayName}
        </p>
        <h1 className="mt-1 text-lg font-bold">Statement of Work Experience</h1>
      </header>

      <table className="mb-6 w-full border-collapse text-left">
        <tbody>
          {[
            ["Learner", `${learner?.firstName ?? ""} ${learner?.lastName ?? ""}`],
            ["Identity number", learner?.nationalId ?? "—"],
            ["Work Experience Module", `${module?.code} — ${module?.title}`],
            ["Credits", module?.credits ? String(module.credits) : "—"],
            ["Employer", agreement?.employerName ?? "—"],
            ["Employer address", agreement?.employerAddress ?? "—"],
            ["Workplace coach", agreement?.coachName ?? "—"],
            ["Designation", agreement?.coachDesignation ?? "—"],
            ["Coach contact", agreement?.coachEmail ?? "—"],
            ["Hours completed", logbook.hoursClaimed ? String(logbook.hoursClaimed) : "—"],
          ].map(([label, value]) => (
            <tr key={label} className="border-b border-neutral-300">
              <th className="w-56 py-1.5 pr-4 align-top font-semibold">
                {label}
              </th>
              <td className="py-1.5">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {[...byKind.entries()].map(([kind, items]) => (
        <section key={kind} className="mb-6 break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
            {KIND_HEADINGS[kind] ?? kind}
          </h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-black">
                <th className="w-20 py-1.5 pr-2 font-semibold">Code</th>
                <th className="py-1.5 pr-2 font-semibold">Scope</th>
                <th className="w-28 py-1.5 pr-2 font-semibold">Date</th>
                <th className="w-24 py-1.5 font-semibold">Signature</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.entryId} className="border-b border-neutral-300">
                  <td className="py-1.5 pr-2 font-mono text-xs align-top">
                    {entry.code}
                  </td>
                  <td className="py-1.5 pr-2 align-top">
                    {entry.description}
                    {entry.evidence.length > 0 ? (
                      <span className="block text-xs text-neutral-600">
                        {entry.evidence.map((file) => file.filename).join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 align-top">
                    {formatDate(entry.completedAt)}
                  </td>
                  <td className="py-1.5 align-top text-xs">
                    {/* The coach's attestation covers every line, so this
                        column carries their initials rather than a separate
                        signature per row. */}
                    {agreement?.coachName
                      ?.split(" ")
                      .map((part) => part[0])
                      .join("") ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="mt-8 break-inside-avoid border-t-2 border-black pt-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
          Attestation
        </h2>
        <p className="mb-4">
          The signature below records that the Workplace Coach understands the
          process of Work Integrated Learning, that the learner&rsquo;s evidence
          was checked, and that the Workplace Coach will attest to the
          truthfulness of that evidence if contacted by the Assessor.
        </p>

        {logbook.coachComments ? (
          <p className="mb-4">
            <span className="font-semibold">Coach&rsquo;s comments: </span>
            {logbook.coachComments}
          </p>
        ) : null}

        <table className="w-full border-collapse text-left">
          <tbody>
            <tr className="border-b border-neutral-300">
              <th className="w-56 py-1.5 pr-4 font-semibold">Signed by</th>
              <td className="py-1.5">
                {agreement?.coachName} ({agreement?.coachEmail})
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 font-semibold">Date</th>
              <td className="py-1.5">{formatDate(logbook.coachSignedAt)}</td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 font-semibold">Signature reference</th>
              <td className="break-all py-1.5 font-mono text-[11px]">
                {logbook.coachSignatureHash}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-xs text-neutral-600">
          The signature reference is a hash over the coach, the logbook and
          every line as it stood when signed. Any later change to this record
          produces a different reference, so an alteration after signature is
          detectable rather than deniable.
        </p>
      </section>
    </main>
  );
}
