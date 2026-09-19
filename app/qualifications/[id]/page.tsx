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
import { DrivePicker } from "@/components/drive-picker";
import { PointHere, ProgressMap } from "@/components/progress-map";
import { connectionsFor } from "@/lib/drive";

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

/*
 * `?just=created` is no longer read.
 *
 * What replaced it is a panel built from the qualification itself, which says
 * the same thing on arrival and still says it on a return visit - the one-shot
 * version vanished on the first reload, which is exactly when somebody comes
 * back to finish. The parameter is still appended by the create action and is
 * harmless; nothing here depends on it.
 */
export default async function QualificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  // Reading the material where it already lives, for somebody who connected
  // a drive. Absent for everybody else rather than offered and refused.
  const drives = canManage ? await connectionsFor(session) : [];

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
  /*
   * Modules whose criteria have not been transcribed yet.
   *
   * A work experience module is not one of them, ever. It is proved by a
   * logbook a coach signs rather than by assessment criteria, so having none
   * is its finished state — the parser and the importer both already know
   * that, and this screen did not.
   *
   * The result was a warning on every correctly imported QCTO qualification:
   * the HRM Officer read perfectly and then announced "5 of 15 modules have no
   * criteria yet", because five of its fifteen are work experience modules.
   * Somebody importing for the first time reads that as the import having
   * half failed — which is exactly the kind of false alarm that made the test
   * on 16 September feel like a failure.
   */
  const notCaptured = modules.filter(
    (m) =>
      m.component !== "workplace" &&
      m.topics.every((topic) => topic.criteria.length === 0) &&
      m.looseCriteria.length === 0,
  );

  /*
   * The three things that have to happen before a qualification can be taught,
   * in the order they have to happen in, each answered from the data rather
   * than from a flag somebody has to remember to set.
   *
   * The material can be uploaded before the study units exist - filenames name
   * their unit and the importer creates them - so these are a sequence by
   * convenience rather than by rule. What matters is that somebody can see
   * which of them are outstanding without reading the whole page.
   */
  const studyUnitsPlaced =
    studyUnits.length > 0 && unplacedModules.length === 0;

  /*
   * The qualification's own source documents, as opposed to what is taught
   * from. Filed automatically when a qualification is built from them, so
   * counting them as material would mark the last step done before anybody
   * had uploaded a single workbook.
   */
  const SOURCE_KINDS = new Set([
    "qualification_document",
    "curriculum_document",
    "assessment_specification",
  ]);
  const teachingMaterial = documents.filter(
    (document) => !SOURCE_KINDS.has(document.kind),
  );

  const steps = [
    {
      title: "The curriculum",
      done: modules.length > 0,
      state:
        modules.length > 0
          ? `${modules.length} modules, ${totalCriteria} assessment criteria, read from the qualification's own documents.`
          : "Nothing here can be taught or assessed until its modules exist.",
      href: "#curriculum",
      action: "Build it by hand",
    },
    {
      title: "Study units",
      done: studyUnitsPlaced,
      state: studyUnitsPlaced
        ? `${studyUnits.length} units, with every module placed in one.`
        : studyUnits.length === 0
          ? "The curriculum publishes modules and says nothing about how you group them, so this is yours to decide. Your alignment document does it in one upload — Word or Excel."
          : `${unplacedModules.length} ${unplacedModules.length === 1 ? "module belongs" : "modules belong"} to no unit yet. A module no study unit delivers is a module nobody teaches.`,
      href: "#documents",
      action: "Upload the alignment document",
    },
    {
      title: "The material",
      /*
       * Teaching material, not the qualification's own source documents.
       *
       * This counted every filed document, so creating a qualification ticked
       * it immediately: the curriculum, qualification and assessment
       * specification are filed by that step and are three documents. A
       * qualification with its source documents and nothing to teach from is
       * not ready, and a map that says otherwise is worse than no map.
       */
      done: teachingMaterial.length > 0,
      state:
        teachingMaterial.length > 0
          ? `${teachingMaterial.length} theory guides, workbooks and assessments filed.`
          : "The theory guides, workbooks and assessments. The whole folder goes in at once, answer guides are recognised and withheld from learners, and no AI is involved at any point.",
      href: "#material",
      action: "Add the folder",
    },
  ];

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

      {canManage ? <ProgressMap steps={steps} /> : null}

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
        <section id="structure" className="mb-8 scroll-mt-24">
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

          {/*
            Two different situations, and they were being told apart by nobody.

            A qualification built from its two base documents has no study
            units at all, because a curriculum publishes modules and says
            nothing about how a provider groups them. So every module is
            unplaced, and the first thing somebody saw after a successful
            import was a red box announcing that fifteen modules were taught
            by nobody - which reads as the import having failed when it did
            exactly what it was asked to.

            The alarming version is right once some study units exist: modules
            left out of a structure that is otherwise built is a real gap.
            Before that it is simply the next step, and saying what that step
            is matters more than the colour of the box.
          */}
          {unplacedModules.length > 0 ? (
            studyUnits.length === 0 ? (
              <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold">
                  The next step: group these modules into study units.
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  The curriculum publishes modules and says nothing about study
                  units, because grouping them is the provider&rsquo;s own
                  decision — so a qualification read from its documents arrives
                  with all {unplacedModules.length} of its modules unplaced.
                  That is expected, not a fault in the import.
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Upload your alignment document — the one mapping each Exit
                  Level Outcome to its modules, in Word or Excel. It creates the
                  study units, names them, and places every module it covers.
                </p>
                {/*
                  A link, because "under the documents below" is not a
                  direction on a page this long. The sentence that used to sit
                  here also offered to build them "by hand here", pointing at a
                  screen that does not exist - worse than a vague pointer,
                  because somebody looks for it.
                */}
                <p className="mt-2">
                  <Link
                    href="#documents"
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                    style={{ background: "var(--brand-primary)" }}
                  >
                    Take me to the upload →
                  </Link>
                </p>
              </div>
            ) : (
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
            )
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

      <section id="documents" className="mb-8 scroll-mt-24">
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
                        registered: extension.registered,
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

              {drives.length > 0 ? (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="mb-2 text-xs text-[var(--muted)]">
                    Or the completed folder from a drive you have connected. It
                    tops up the same way: only what is missing is added.
                  </p>
                  <DrivePicker
                    drives={drives.map((one) => ({
                      provider: one.provider,
                      label: one.label,
                      accountLabel: one.accountLabel,
                    }))}
                    qualificationId={id}
                    topUp
                  />
                </div>
              ) : null}
            </Card>

            <div id="material" className="mt-4 scroll-mt-24">
              {studyUnitsPlaced && teachingMaterial.length === 0 ? (
                <PointHere>
                  The material goes here — the whole folder at once. Nothing is
                  saved until you have seen what it found.
                </PointHere>
              ) : null}
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

            {drives.length > 0 ? (
              <div className="mt-4">
                <Card>
                  <p className="mb-3 text-sm font-medium">
                    Or the folder where it already lives
                  </p>
                  <DrivePicker
                    drives={drives.map((one) => ({
                      provider: one.provider,
                      label: one.label,
                      accountLabel: one.accountLabel,
                    }))}
                    qualificationId={id}
                  />
                </Card>
              </div>
            ) : null}

            <div className="mt-4">
              {/*
                The pointer sits on the control, not in a sentence describing
                where the control might be. Shown only while this is the step
                somebody is on, so it is never pointing at finished work.
              */}
              {!studyUnitsPlaced && modules.length > 0 ? (
                <PointHere>
                  Your alignment document goes here — choose it, set its kind to
                  Curriculum Alignment Matrix, and upload. That builds the study
                  units.
                </PointHere>
              ) : null}
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

      <h2 id="curriculum" className="mb-2 scroll-mt-24 font-semibold">
        Curriculum
      </h2>
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
                      ) : curriculumModule.component === "workplace" ? (
                        /*
                          Not a fault here. A work experience module is proved
                          by a logbook a coach signs and an assessor accepts,
                          so having no criteria is its finished state - and
                          colouring that red taught somebody reading a
                          correctly imported qualification to distrust it.
                        */
                        <p className="text-sm text-[var(--muted)]">
                          No assessment criteria, which is right for work
                          experience: it is proved by a signed record of the
                          work rather than judged against criteria.
                        </p>
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
