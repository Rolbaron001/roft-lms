import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { curriculumOutline } from "@/lib/authoring";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  listProgrammeDocuments,
  qualificationForDocumentUpload,
} from "@/lib/programme-documents";
import { describeSize } from "@/lib/media";
import { AppShell, Card } from "@/components/app-shell";
import { DocumentUploader } from "./documents/document-uploader";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge module",
  practical: "Practical skills module",
  workplace: "Work experience module",
  general: "Module",
};

/**
 * What the curriculum document says, as the platform holds it.
 *
 * Codes are shown exactly as the document numbers them, in the document's
 * order, so somebody can read the two side by side and check the transcription
 * line by line. That check is the point: everything downstream — the Learning
 * Material Matrix, readiness, the Statement of Results — is only as good as
 * what was typed in here.
 */
const ELEMENT_LABELS: Record<string, string> = {
  knowledge_topic: "Topic elements",
  practical_activity: "Required performance",
  applied_knowledge: "Applied knowledge",
  work_activity: "Work activities",
  contextual_knowledge: "Contextual workplace knowledge",
  supporting_evidence: "Supporting evidence",
};

export default async function QualificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");
  const { qualification, modules } = await curriculumOutline(session, id);
  const [documents, uploadTargets] = await Promise.all([
    listProgrammeDocuments(session, id),
    qualificationForDocumentUpload(session, id),
  ]);

  const totalCriteria = modules.reduce(
    (sum, m) =>
      sum +
      m.topics.reduce((t, topic) => t + topic.criteria.length, 0) +
      m.looseCriteria.length,
    0,
  );
  const notCaptured = modules.filter(
    (m) =>
      m.topics.every((topic) => topic.criteria.length === 0) &&
      m.looseCriteria.length === 0,
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/qualifications"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← All qualifications
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{qualification.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {[
            qualification.saqaId ? `SAQA ${qualification.saqaId}` : null,
            qualification.qctoCode,
            qualification.nqfLevel ? `NQF ${qualification.nqfLevel}` : null,
            qualification.totalCredits
              ? `${qualification.totalCredits} credits`
              : null,
            qualification.assessmentQualityPartner,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {modules.length} modules · {totalCriteria} internal assessment
          criteria ·{" "}
          {qualification.componentWeights
            ? `weighted ${Math.round(qualification.componentWeights.knowledge * 100)}/${Math.round(qualification.componentWeights.practical * 100)}/${Math.round(qualification.componentWeights.workplace * 100)} as stated in the document`
            : "no component weighting stated — readiness derives it from credits"}
        </p>
      </div>

      {notCaptured.length > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--danger)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
            {notCaptured.length} of {modules.length} modules have no criteria yet.
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Nobody can be declared ready for the EISA against this qualification
            until the whole curriculum document has been transcribed — a module
            with no criteria cannot be failed, so leaving them empty would make
            every learner look finished.
          </p>
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Programme documents</h2>
        <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
          The handbooks, workbooks, marking memoranda and workplace sign-off
          sheets are written in Word and Excel, and stay that way — they are
          print artefacts a facilitator annotates and a moderator marks up.
          What the platform holds is the authoritative copy, attached to the
          part of the curriculum it serves and hashed so it can be proved
          unchanged.
        </p>

        <Card>
          <DocumentUploader
            qualificationId={id}
            kinds={DOCUMENT_KINDS.map((kind) => ({
              value: kind,
              label: DOCUMENT_KIND_LABELS[kind],
            }))}
            units={uploadTargets.units}
            modules={uploadTargets.modules}
          />
        </Card>

        {documents.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Attached to</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr
                    key={document.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`/api/programme-documents/${document.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {document.title}
                      </a>
                      {document.version ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {document.version}
                        </span>
                      ) : null}
                      <p className="text-xs text-[var(--muted)]">
                        {document.filename}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {DOCUMENT_KIND_LABELS[
                        document.kind as keyof typeof DOCUMENT_KIND_LABELS
                      ] ?? document.kind}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {document.studyUnitCode ??
                        document.moduleCode ??
                        "Qualification"}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                      {describeSize(document.sizeBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No documents held yet.
          </p>
        )}
      </section>

      <h2 className="mb-2 font-semibold">Curriculum</h2>
      <div className="space-y-4">
        {modules.map((curriculumModule) => {
          const criteriaHere =
            curriculumModule.topics.reduce(
              (sum, topic) => sum + topic.criteria.length,
              0,
            ) + curriculumModule.looseCriteria.length;

          return (
            <Card key={curriculumModule.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">
                    <span className="font-mono text-sm">
                      {curriculumModule.code}
                    </span>{" "}
                    {curriculumModule.title}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {COMPONENT_LABELS[curriculumModule.component] ??
                      curriculumModule.component}
                    {curriculumModule.credits
                      ? ` · ${curriculumModule.credits} credits`
                      : ""}
                  </p>
                </div>
                <p className="text-sm text-[var(--muted)] tabular-nums">
                  {criteriaHere} {criteriaHere === 1 ? "criterion" : "criteria"}
                </p>
              </div>

              {curriculumModule.topics.length === 0 &&
              curriculumModule.looseCriteria.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Not yet transcribed from the curriculum document.
                </p>
              ) : null}

              {curriculumModule.topics.map((topic) => {
                const byKind = new Map<string, typeof topic.elements>();
                for (const element of topic.elements) {
                  byKind.set(element.kind, [
                    ...(byKind.get(element.kind) ?? []),
                    element,
                  ]);
                }

                return (
                  <div
                    key={topic.id}
                    className="mt-4 border-t border-[var(--border)] pt-4"
                  >
                    <p className="text-sm font-medium">
                      <span className="font-mono">{topic.code}</span>{" "}
                      {topic.title}
                      {topic.weightPercent !== null ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {topic.weightPercent}% of the module
                        </span>
                      ) : null}
                    </p>

                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      {[...byKind.entries()].map(([kind, items]) => (
                        <div key={kind}>
                          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                            {ELEMENT_LABELS[kind] ?? kind} — what must be
                            taught
                          </p>
                          <ul className="mt-1.5 space-y-1">
                            {items.map((element) => (
                              <li key={element.id} className="text-sm">
                                <span className="font-mono text-xs text-[var(--muted)]">
                                  {element.code}
                                </span>{" "}
                                {element.description}
                                {element.coveredBy.length > 0 ? (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {element.coveredBy.map((cover) => (
                                      <span
                                        key={cover.id}
                                        title={cover.kind.replace(/_/g, " ")}
                                        className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]"
                                      >
                                        {cover.reference}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}

                      {topic.criteria.length > 0 ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                            Internal assessment criteria — what must be achieved
                          </p>
                          <ul className="mt-1.5 space-y-1">
                            {topic.criteria.map((criterion) => (
                              <li key={criterion.id} className="text-sm">
                                <span className="font-mono text-xs text-[var(--muted)]">
                                  {criterion.code}
                                </span>{" "}
                                {criterion.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-sm" style={{ color: "var(--danger)" }}>
                          No assessment criteria, so this topic can never be
                          achieved.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {curriculumModule.looseCriteria.length > 0 ? (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    Assessment criteria
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {curriculumModule.looseCriteria.map((criterion) => (
                      <li key={criterion.id} className="text-sm">
                        <span className="font-mono text-xs text-[var(--muted)]">
                          {criterion.code}
                        </span>{" "}
                        {criterion.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
