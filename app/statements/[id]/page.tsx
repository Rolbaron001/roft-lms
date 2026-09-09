import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import {
  getStatementOfResults,
  StatementError,
  validUntilFor,
} from "@/lib/statement-of-results";
import { describeAccreditation } from "@/lib/accreditation";
import { PrintButton } from "@/components/print-button";
import { WithdrawDocument } from "@/components/withdraw-document";
import { withdrawStatementAction } from "./actions";

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

  // Issuing and withdrawing are the same responsibility, so they are the same
  // permission. A learner reading their own statement sees neither.
  const mayWithdraw = session.permissions.includes("certificate:issue");

  const { learner, qualification, provider, modules, studyUnit } =
    record.statement;

  const validUntil = record.statement.validUntil
    ? new Date(record.statement.validUntil)
    : validUntilFor(record.issuedAt);

  const nextEisa = record.statement.nextEisa ?? null;

  /**
   * The QCTO template asks for proof of Maths and English at levels 3 and 4
   * specifically, so the checklist follows the level rather than listing a
   * requirement that does not apply and leaving somebody to work that out.
   */
  const needsFoundationalProof =
    qualification.nqfLevel === 3 || qualification.nqfLevel === 4;

  const byComponent = ["knowledge", "practical", "workplace", "general"]
    .map((component) => ({
      component,
      modules: modules.filter((module) => module.component === component),
    }))
    .filter((group) => group.modules.length > 0);

  return (
    <main className="mx-auto max-w-3xl bg-white px-10 py-10 text-[13px] leading-relaxed text-black print:px-0 print:py-0">
      {/*
        The only thing on this page that is not the document. A learner carries
        this to the assessment centre on paper, so there has to be something
        that produces the paper - and until now the page assumed somebody would
        find their browser's own print menu.
      */}
      <div className="mb-6 flex flex-wrap items-start justify-end gap-3 print:hidden">
        {/* Withdrawal sits beside the document rather than on a management
            screen, because the moment somebody decides to withdraw one is the
            moment they are looking at it. */}
        {mayWithdraw && !record.revokedAt ? (
          <WithdrawDocument
            action={withdrawStatementAction}
            idName="statementId"
            idValue={id}
            what="this Statement of Results"
            consequence="An assessment centre may already hold a copy. The reference keeps working and will say it was withdrawn."
          />
        ) : null}
        <PrintButton label="Print or save this Statement of Results" />
      </div>

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
        {/* The template opens with the provider's letterhead and address. */}
        {provider.address && provider.address.length > 0 ? (
          <p className="mt-0.5 text-xs text-neutral-700">
            {provider.address.join(" · ")}
          </p>
        ) : null}
        <h1 className="mt-1 text-lg font-bold">Statement of Results</h1>
        <p className="mt-1 text-xs">
          {studyUnit
            ? `Issued in respect of ${studyUnit.code}: ${studyUnit.title}`
            : "Issued in respect of admission to the External Integrated Summative Assessment"}
        </p>
      </header>

      <table className="mb-6 w-full border-collapse text-left">
        <tbody>
          {[
            ["Learner", `${learner.firstName} ${learner.lastName}`],
            ["Identity number", learner.nationalId ?? "—"],
            ["Qualification", qualification.title],
            ...(studyUnit
              ? [["Study unit", `${studyUnit.code}: ${studyUnit.title}`]]
              : []),
            ["SAQA identifier", qualification.saqaId ?? "—"],
            ["Curriculum code", qualification.curriculumCode ?? "—"],
            ["NQF level", qualification.nqfLevel ? String(qualification.nqfLevel) : "—"],
            ["Total credits", qualification.totalCredits ? String(qualification.totalCredits) : "—"],
            ["Assessment Quality Partner", qualification.assessmentQualityPartner ?? "—"],
            ["Skills Development Provider", provider.legalName || tenant.displayName],
            [
              "Accreditation number",
              describeAccreditation(
                qualification.accreditationNumber,
                provider.accreditationNumber,
              ).label,
            ],
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

      {/*
        The wording the QCTO template prints under its own module tables.
        "Competent" is the C of C/NYC written out; saying so removes the
        question rather than leaving an assessment centre to assume it.
      */}
      <p className="mb-6 text-xs text-neutral-600">
        Achievement is recorded as Competent or Not Yet Competent (C/NYC).
      </p>

      {/*
        Admission to the EISA, which the QCTO template asks for as a yes/no
        with the date of the next sitting beside it.

        Yes is not a formality here. This statement cannot be issued at all
        unless every internal assessment criterion in scope has been achieved -
        the same calculation the readiness screen shows - so the answer is
        settled before the document exists. A whole-qualification statement is
        the one that grants admission; one issued for a single study unit
        records progress and does not.
      */}
      <section className="mb-6 break-inside-avoid border-y-2 border-black py-3">
        <table className="w-full border-collapse text-left">
          <tbody>
            <tr>
              <th className="w-64 py-1 pr-4 align-top font-semibold">
                Learner has gained admission to the EISA
              </th>
              <td className="py-1 font-bold">
                {studyUnit
                  ? "Not applicable — this statement covers one study unit"
                  : "Yes"}
              </td>
            </tr>
            <tr>
              <th className="py-1 pr-4 align-top font-semibold">
                Date of next EISA
              </th>
              <td className="py-1">
                {nextEisa
                  ? `${formatDate(nextEisa.date)}${nextEisa.name ? ` — ${nextEisa.name}` : ""}`
                  : "Not yet scheduled"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

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
              <th className="py-1.5 pr-4 font-semibold">Valid until</th>
              <td className="py-1.5">
                {validUntil.toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </td>
            </tr>
            {/*
              Named and designated, not just signed. The QCTO template asks for
              "Name of Principal/Academic Manager" and a designation, because
              whoever signs is making the confirmation above in their own name.
            */}
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 align-top font-semibold">
                Name of Principal / Academic Manager
              </th>
              <td className="py-6"></td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 align-top font-semibold">
                Designation
              </th>
              <td className="py-6"></td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 align-top font-semibold">Signature</th>
              <td className="py-6"></td>
            </tr>
            <tr className="border-b border-neutral-300">
              <th className="py-1.5 pr-4 align-top font-semibold">
                Stamp of the institution
              </th>
              <td className="py-10"></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/*
        What the QCTO asks to be attached to each statement sent to it. Printed
        as a checklist because that is how it is used: somebody assembling an
        envelope, ticking things off.
      */}
      <section className="mt-8 break-inside-avoid">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
          To be attached to each statement sent to the QCTO
        </h2>
        <ul className="space-y-1.5">
          <li className="flex gap-2">
            <span className="mt-0.5 inline-block h-3 w-3 shrink-0 border border-black" />
            <span>The learner&rsquo;s identity document</span>
          </li>
          {needsFoundationalProof ? (
            <li className="flex gap-2">
              <span className="mt-0.5 inline-block h-3 w-3 shrink-0 border border-black" />
              <span>
                Proof of passing Mathematics and English, required at NQF levels
                3 and 4. Either a Grade 12 certificate (or equivalent) showing
                pass marks for both, or a Foundational Learning Competence
                Statement of Results reporting Competent for Numeracy and
                Literacy — or a combination of the two.
              </span>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8 break-inside-avoid border-t border-black pt-4 text-xs text-neutral-700">
        {/*
          The QCTO's own disclaimers, which say what this document is not. They
          matter: a learner holding a Statement of Results has something that
          looks like a certificate and is not one, and only the QCTO can issue
          the certificate itself.
        */}
        <p>
          <span className="font-semibold">
            This Statement of Results is not an Occupational Certificate.
          </span>{" "}
          The learner must comply with the requirements of the Knowledge,
          Practical and Workplace components of the qualification in order to be
          admitted to the External Integrated Summative Assessment. This
          Statement of Results is valid for a period of two years from the date
          of issue.
        </p>
        <p className="mt-2">
          The Quality Council for Trades and Occupations will issue the
          Occupational Certificate upon successful completion of the External
          Integrated Summative Assessment, and having met the requirements of
          the qualification.
        </p>
        <p className="mt-2">
          Learners must bring this Statement of Results together with their
          identity document when writing the EISA.
        </p>
        <p className="mt-2">
          This statement can be checked at any time by entering the verification
          reference above at {tenant.displayName}. A withdrawn statement reports
          itself as withdrawn rather than as unknown, and one past its two years
          reports itself as expired.
        </p>
      </section>
    </main>
  );
}
