import Link from "next/link";
import { requireAnyPermission, requireTenant } from "@/lib/request";
import { curriculumOutline } from "@/lib/authoring";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  listProgrammeDocuments,
  qualificationForDocumentUpload,
} from "@/lib/programme-documents";
import { describeSize } from "@/lib/media";
import { extensionOffered, extensionState } from "@/lib/extensions";
import { AppShell, Card } from "@/components/app-shell";
import { DocumentUploader } from "./documents/document-uploader";
import { FolderPicker } from "@/components/folder-picker";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ just?: string }>;
}) {
  const { id } = await params;
  const justCreated = (await searchParams).just === "created";
  const tenant = await requireTenant();
  /*
   * Read by everybody who delivers or judges against it; changed by an
   * administrator.
   *
   * It was gated on the permission to *manage* qualifications, which meant a
   * facilitator, an assessor and a moderator could not read the curriculum
   * they teach and mark against at all. That is the wrong way round: a
   * curriculum is a published QCTO document, and needing to see what a module
   * requires is the ordinary case. What each of them may *do* here is a
   * separate question, answered further down.
   *
   * Not opened to learners. Their route to what they must cover is their
   * course, where it comes with the material.
   */
  const session = await requireAnyPermission([
    "qualification:manage",
    "course:author",
    "assessment:assess",
    "assessment:moderate",
  ]);
  const canManage = session.permissions.includes("qualification:manage");

  const { qualification, modules, studyUnits, outcomes, unplacedModules } =
    await curriculumOutline(session, id);
  const [documents, uploadTargets] = await Promise.all([
    listProgrammeDocuments(session, id),
    // Only where something will be uploaded. It asserts the permission to
    // manage qualifications, so asking for it unconditionally turned the whole
    // page into a server error for the facilitators it was just opened to.
    canManage ? qualificationForDocumentUpload(session, id) : null,
  ]);

  // Read only so the top-up form can say what an extension would add. A folder
  // that includes a summary of itself needs none.
  const extension = await extensionState(session);
  const mayUseExtension =
    extensionOffered() && session.permissions.includes("extension:use");

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
      {/*
        What just happened, and what is left.

        Creating a qualification from its documents used to land somebody on a
        full screen with nothing to say that anything had happened — the
        curriculum is in, the material is not, and the difference is not
        obvious from looking at it. Heidi had no way to tell how far she had
        got, which is half of why the test on 16 September felt like a failure
        rather than a step.

        Shown once, on arrival. It is not a state the qualification is in.
      */}
      {justCreated && canManage ? (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 ${
            modules.length > 0
              ? "border-[var(--success)]/40 bg-[var(--success)]/5"
              : "border-[var(--danger)]/40 bg-[var(--danger)]/5"
          }`}
        >
          {/*
            Nothing is claimed that is not true. A reading that produced no
            modules at all has not put a curriculum in, and saying "the
            curriculum is in: 0 modules" would be the platform congratulating
            itself on a failure - which is the exact habit that made the test
            on 16 September look like it had half worked.
          */}
          {modules.length > 0 ? (
            <p className="text-sm font-medium">
              The curriculum is in: {modules.length}{" "}
              {modules.length === 1 ? "module" : "modules"} and {totalCriteria}{" "}
              assessment criteria, read from the documents you supplied.
            </p>
          ) : (
            <p className="text-sm font-medium">
              The qualification was created, but no curriculum was read from
              the documents. Nothing here can be taught or assessed until its
              modules exist.
            </p>
          )}
          {modules.length > 0 ? (
            <>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
                What is not in yet is the material — the theory guides,
                workbooks and assessments. Add the whole folder at once further
                down this page; the study units are created from the filenames,
                and answer guides are recognised and kept from learners. No AI
                is used for any of it.
              </p>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
                Check a module or two against the printed document first.
                Anything the reading was unsure of was listed on the screen
                before this one.
              </p>
            </>
          ) : (
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
              Either the curriculum document was not among the files, or it is
              laid out in a way the reader did not recognise. Build the
              curriculum by hand, or say what the document looks like and the
              reader can be taught it — that is how the Commercial Cleaner
              curriculum came to be read.
            </p>
          )}
        </div>
      ) : null}

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
            qualification.curriculumCode,
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
        {/*
          A part qualification is not built here and must not offer to be. Its
          curriculum belongs to the qualification it comes from; what is its
          own is which of those modules it takes.
        */}
        {qualification.parentQualificationId ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            A part qualification drawn from{" "}
            <Link
              href={`/qualifications/${qualification.parentQualificationId}`}
              className="underline underline-offset-2"
            >
              its parent qualification
            </Link>
            , whose curriculum it shares. Nothing is copied, so a
            learner&rsquo;s work against a module counts once wherever they met
            it.
          </p>
        ) : null}

        {canManage ? (
          <Link
            href={
              qualification.parentQualificationId
                ? `/qualifications/${qualification.id}/modules`
                : `/qualifications/${qualification.id}/edit`
            }
            className="mt-3 inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
          >
            {qualification.parentQualificationId
              ? "Choose which modules this takes"
              : "Build the curriculum"}
          </Link>
        ) : null}
      </div>

      {notCaptured.length > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--danger)" }}
        >
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--danger)" }}
          >
            {notCaptured.length} of {modules.length} modules have no criteria
            yet.
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Nobody can be declared ready for the EISA against this qualification
            until the whole curriculum document has been transcribed — a module
            with no criteria cannot be failed, so leaving them empty would make
            every learner look finished.
          </p>
        </div>
      ) : null}

      {studyUnits.length > 0 || outcomes.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 font-semibold">Delivery structure</h2>
          <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
            The curriculum publishes modules; a provider teaches study units.
            Each bundles the Knowledge, Practical and Work Experience modules
            that serve one Exit Level Outcome, which is what the External
            Integrated Summative Assessment is set against. Two providers may
            group the same qualification differently and both be correct, so
            this is the provider&rsquo;s structure rather than the
            curriculum&rsquo;s.
          </p>

          {unplacedModules.length > 0 ? (
            <div
              className="mb-4 rounded-lg border-2 p-4"
              style={{ borderColor: "var(--danger)" }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--danger)" }}
              >
                {unplacedModules.length}{" "}
                {unplacedModules.length === 1
                  ? "module belongs"
                  : "modules belong"}{" "}
                to no study unit.
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {unplacedModules.map((m) => m.code).join(", ")}. A module no
                study unit delivers is a module nobody teaches, however
                completely its curriculum has been captured.
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            {studyUnits.map((unit) => (
              <Card key={unit.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      <span className="font-mono text-sm">{unit.code}</span>{" "}
                      {unit.title}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {unit.outcome
                        ? `Exit Level Outcome ${unit.outcome.number}`
                        : "Aligned to no Exit Level Outcome"}
                      {unit.credits ? ` · ${unit.credits} credits` : ""}
                    </p>
                  </div>
                  <p className="text-sm text-[var(--muted)] tabular-nums">
                    {unit.modules.length}{" "}
                    {unit.modules.length === 1 ? "module" : "modules"}
                  </p>
                </div>

                {unit.outcome ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-sm">{unit.outcome.description}</p>
                    {unit.outcome.criteria.length > 0 ? (
                      <>
                        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                          Associated assessment criteria — what the EISA tests
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {unit.outcome.criteria.map((criterion) => (
                            <li key={criterion.id} className="text-sm">
                              {criterion.description}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {unit.modules.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                    {unit.modules.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono">{entry.code}</span>{" "}
                        <span className="text-[var(--muted)]">
                          {COMPONENT_LABELS[entry.component] ?? entry.component}
                          {entry.credits ? ` · ${entry.credits} cr` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    className="mt-3 border-t border-[var(--border)] pt-3 text-sm"
                    style={{ color: "var(--danger)" }}
                  >
                    This study unit delivers no modules.
                  </p>
                )}
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Programme documents</h2>
        <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
          Filed here are the authoritative copies: the source documents this
          qualification is built from, each attached to the part of the
          curriculum it serves and hashed so it can be proved unchanged.
        </p>
        <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
          <span className="font-medium text-[var(--foreground)]">
            A workbook or an assessment filed here is a record, not the thing a
            learner works on.
          </span>{" "}
          Those are read in and presented on screen, so a learner answers in the
          platform and a facilitator marks and comments there. Upload the Word
          document under Capture rather than here, and it becomes the questions
          themselves. Handbooks, guides and workplace sign-off sheets are
          different: they stay as documents, because a facilitator annotates
          them and a coach signs them on paper.
        </p>

        {canManage ? (
          <>
            {/*
          Finishing a curriculum, rather than filing material against one.

          Roland asked on 15 September whether a qualification loaded from an
          incomplete folder could be completed by pointing at the finished one.
          It can, and this is where. It is deliberately a separate control from
          the material picker below: the two do different things to the same
          folder, and nothing on the screen would otherwise say which one a
          person was about to get.
        */}
            <Card>
              <p className="mb-3 text-sm font-medium">
                Finish this qualification from a fuller folder
              </p>
              <FolderPicker
                qualificationId={id}
                topUp
                label="The completed folder for this qualification, from your own computer"
                extension={
                  mayUseExtension
                    ? {
                        on: extension.on,
                        available: extension.availability?.available ?? false,
                        reason: extension.availability?.reason ?? null,
                      }
                    : null
                }
                hint={
                  <>
                    For a qualification that was loaded before its documents
                    were complete. The whole folder is read again — the
                    curriculum as well as the material — and only what is
                    missing is added.
                    <br />
                    Nothing already here is changed or replaced, down to the
                    wording of a single criterion, and running it twice does
                    nothing the second time. You still see everything it found
                    and confirm it before any of it is written.
                  </>
                }
              />
            </Card>

            <div className="mt-4">
              <Card>
                <p className="mb-3 text-sm font-medium">
                  A whole folder at once
                </p>
                <FolderPicker
                  qualificationId={id}
                  label="A folder of material, from your own computer"
                  hint={
                    <>
                      Theory guides and workbooks go to the study unit their
                      filename names, policies and contracts to the document
                      library, and everything else against this qualification.
                      No AI is used here at all — sorting documents by name is a
                      rule rather than a judgement.
                    </>
                  }
                />
              </Card>
            </div>

            <div className="mt-4">
              <Card>
                <p className="mb-3 text-sm font-medium">Or one document</p>
                <DocumentUploader
                  qualificationId={id}
                  kinds={DOCUMENT_KINDS.map((kind) => ({
                    value: kind,
                    label: DOCUMENT_KIND_LABELS[kind],
                  }))}
                  units={uploadTargets?.units ?? []}
                  modules={uploadTargets?.modules ?? []}
                />
              </Card>
            </div>
          </>
        ) : null}

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
                            {ELEMENT_LABELS[kind] ?? kind} — what must be taught
                          </p>
                          <ul className="mt-1.5 space-y-1">
                            {items.map((element) => (
                              <li key={element.id} className="text-sm">
                                {/*
                                  A link, because Roland asked on 15 September
                                  how these are viewed and the honest answer
                                  was that they were not: the wording was all
                                  there, but what teaches and assesses a line
                                  was three records away and reachable from
                                  nowhere.
                                */}
                                <Link
                                  href={`/qualifications/${id}/elements/${element.id}`}
                                  className="underline-offset-2 hover:underline"
                                >
                                  <span className="font-mono text-xs text-[var(--muted)]">
                                    {element.code}
                                  </span>{" "}
                                  {element.description}
                                </Link>
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
                        <p
                          className="text-sm"
                          style={{ color: "var(--danger)" }}
                        >
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
