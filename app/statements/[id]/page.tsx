import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { getStatementOfResults, StatementError } from "@/lib/statement-of-results";

const COMPONENT_LABEL: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical Skills",
  workplace: "Work Experience",
  general: "Module",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * The Statement of Results, laid out for paper.
 *
 * A learner carries this to the assessment centre with their identity
 * document, so it is printed, not read on screen: no navigation, no
 * application furniture, black on white.
 *
 * Everything shown comes from the frozen record rather than being recalculated.
 * A curriculum can be reimported and a module renamed after issue; the
 * statement in somebody's hand must keep saying what it said when it was
 * signed, or the assessment centre is checking it against nothing.
 */
export default async function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  let record;
  try {
    record = await getStatementOfResults(session, id);
  } catch (error) {
    if (error instanceof StatementError) notFound();
    throw error;
  }

  const { learner, qualification, provider, modules } = record.statement;

  const byComponent = ["knowledge", "practical", "workplace", "general"]
    .map((component) => ({
      component,
      modules: modules.filter((module) => module.component === component),
    }))
    .filter((group) => group.modules.length > 0);

  return (
    <main className="mx-auto max-w-3xl bg-white px-10 py-10 text-[13px] leading-relaxed text-black print:px-0 print:py-0">
      {record.revokedAt ? (
        <div className="mb-6 border-4 border-black p-4 text-center">
          <p className="text-lg font-bold uppercase">Withdrawn</p>
          <p className="mt-1">
            This Statement of Results was withdrawn on{" "}
            {record.revokedAt.toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . {record.revokedReason}
          </p>
        </div>
      ) : null}

      <header className="mb-6 border-b-2 border-black pb-4">
        <p className="text-xs uppercase tracking-widest">
          {provider.legalName || tenant.displayName}
        </p>
        <h1 className="mt-1 text-lg font-bold">Statement of Results</h1>
        <p className="mt-1 text-xs">
          Issued in respect of admission to the External Integrated Summative
          Assessment
        </p>
      </header>

      <table className="mb-6 w-full border-collapse text-left">
        <tbody>
          {[
            ["Learner", `${learner.firstName} ${learner.lastName}`],
            ["Identity number", learner.nationalId ?? "—"],
            ["Qualification", qualification.title],
            ["SAQA identifier", qualification.saqaId ?? "—"],
            ["Curriculum code", qualification.qctoCode ?? "—"],
            ["NQF level", qualification.nqfLevel ? String(qualification.nqfLevel) : "—"],
            ["Total credits", qualification.totalCredits ? String(qualification.totalCredits) : "—"],
            ["Assessment Quality Partner", qualification.assessmentQualityPartner ?? "—"],
            ["Skills Development Provider", provider.legalName || tenant.displayName],
            ["Provider accreditation", provider.accreditationNumber ?? "—"],
          ].map(([label, value]) => (
            <tr key={label} className="border-b border-neutral-300">
              <th className="w-64 py-1.5 pr-4 align-top font-semibold">{label}</th>
              <td className="py-1.5">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {byComponent.map((group) => (
        <section key={group.component} className="mb-6 break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
            {COMPONENT_LABEL[group.component] ?? group.component} Modules
          </h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-black">
                <th className="w-48 py-1.5 pr-2 font-semibold">Module code</th>
                <th className="py-1.5 pr-2 font-semibold">Title</th>
                <th className="w-16 py-1.5 pr-2 font-semibold">Credits</th>
                <th className="w-24 py-1.5 pr-2 font-semibold">Result</th>
                <th className="w-32 py-1.5 font-semibold">Date achieved</th>
              </tr>
            </thead>
            <tbody>
              {group.modules.map((module) => (
                <tr key={module.code} className="border-b border-neutral-300">
                  <td className="py-1.5 pr-2 align-top font-mono text-xs">
                    {module.code}
                  </td>
                  <td className="py-1.5 pr-2 align-top">
                    {module.title}
                    {module.route === "logbook" ? (
                      <span className="block text-xs text-neutral-600">
                        Evidenced by signed Statement of Work Experience
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 align-top">{module.credits ?? "—"}</td>
                  <td className="py-1.5 pr-2 align-top font-semibold">
                    {module.result}
                  </td>
                  <td className="py-1.5 align-top">
                    {formatDate(module.achievedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="mt-8 break-inside-avoid border-t-2 border-black pt-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
          Confirmation
        </h2>
        <p className="mb-4">
          The Skills Development Provider named above confirms that the learner
          named above has achieved all internal assessment criteria for all
          modules in the curriculum document for this qualification, and is
          therefore eligible to be entered for the External Integrated Summative
          Assessment.
        </p>

        <table className="w-full border-collapse text-left">
          <tbody>
            <tr className="border-b border-neutral-300">
              <th className="w-64 py-1.5 pr-4 font-semibold">Date of issue</th>
              <td className="py-1.5">
                {record.issuedAt.toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 font-semibold">Verification reference</th>
              <td className="py-1.5 font-mono">{record.verificationReference}</td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 align-top font-semibold">
                Signed for the provider
              </th>
              <td className="py-6"></td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-xs text-neutral-600">
          This statement can be checked at any time by entering the verification
          reference above at {tenant.displayName}. A withdrawn statement reports
          itself as withdrawn rather than as unknown.
        </p>
        <p className="mt-2 text-xs text-neutral-600">
          To be presented at the assessment centre together with the
          learner&rsquo;s identity document.
        </p>
      </section>
    </main>
  );
}
