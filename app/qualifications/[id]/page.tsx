import Link from "next/link";
import { pageT, requireAnyPermission, requireCapability, said } from "@/lib/request";
import { curriculumOutline } from "@/lib/authoring";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  RESTRICTED_TO_ASSESSORS,
  TEACHING_KINDS,
  listProgrammeDocuments,
  qualificationForDocumentUpload,
  type DocumentKind,
} from "@/lib/programme-documents";
import { describeSize } from "@/lib/media";
import { extensionOffered, extensionState } from "@/lib/extensions";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card } from "@/components/app-shell";
import { Rich } from "@/components/rich-text";
import { DocumentUploader } from "./documents/document-uploader";
import { FolderPicker } from "@/components/folder-picker";
import { DrivePicker } from "@/components/drive-picker";
import { PointHere, ProgressMap } from "@/components/progress-map";
import { QualificationNav } from "@/components/qualification-nav";
import { verificationOf } from "@/lib/qualification-build";
import { BuildForm } from "./verify/verify-forms";
import { ViewTabs } from "@/components/view-tabs";
import { PageNav } from "@/components/page-nav";
import { qualificationUsage } from "@/lib/qualification-removal";
import { blueprintFrom } from "@/lib/blueprint-export";
import { capturableDocuments } from "@/lib/capture-from-documents";
import { CaptureList } from "./capture/capture-list";
import { RemoveQualification } from "./remove-qualification";
import { connectionsFor } from "@/lib/drive";

/**
 * What the curriculum document says, as the platform holds it.
 *
 * Codes are shown exactly as the document numbers them, in the document's
 * order, so somebody can read the two side by side and check the transcription
 * line by line. That check is the point: everything downstream (the Learning
 * Material Matrix, readiness, the Statement of Results) is only as good as
 * what was typed in here.
 */

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  /*
   * Which half of this page somebody is on.
   *
   * "what it holds" is the qualification as it stands - the structure, the
   * curriculum, the documents filed. "build" is the machinery for adding to
   * it. They were interleaved, so a curriculum sat below three upload cards
   * and somebody reading one had to scroll past the controls for making
   * another.
   */
  const view = (await searchParams).view === "build" ? "build" : "holds";
  const tenant = await requireCapability("qualifications");
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
  const t = await pageT();
  const componentLabel = (component: string) => maybe(t, `qualPage.componentModule.${component}`) ?? component;
  const kindLabel = (kind: string) =>
    maybe(t, `docKind.${kind}`) ?? DOCUMENT_KIND_LABELS[kind as DocumentKind] ?? kind;
  const canManage = session.permissions.includes("qualification:manage");
  // Administrators and facilitators, which is who job sheet 2.1 named.
  const canAuthorCourses = session.permissions.includes("course:author");
  // Reading the material where it already lives, for somebody who connected
  // a drive. Absent for everybody else rather than offered and refused.
  const drives = canManage ? await connectionsFor(session) : [];

  const outline = await curriculumOutline(session, id);
  const { qualification, modules, studyUnits, outcomes, unplacedModules } = outline;
  const [documents, uploadTargets] = await Promise.all([
    listProgrammeDocuments(session, id),
    // Only where something will be uploaded. It asserts the permission to
    // manage qualifications, so asking for it unconditionally turned the whole
    // page into a server error for the facilitators it was just opened to.
    canManage ? qualificationForDocumentUpload(session, id) : null,
  ]);

  /*
   * Whether this may be removed, and what would go with it.
   *
   * Only asked for somebody who could act on the answer - it is several
   * counting queries, and a facilitator has no use for them.
   */
  const removal = canManage ? await said(await qualificationUsage(session, id)) : null;

  /*
   * How many of this qualification's papers a learner can actually answer.
   *
   * Gated on authoring assessments rather than on managing qualifications: an
   * instructor writes material without being entitled to change a curriculum,
   * and they are exactly who does this.
   */
  const capturable = session.permissions.includes("assessment:author")
    ? await capturableDocuments(session, id)
    : [];
  // Whether its study units are built, and whether anything holds it back from
  // going live (lib/qualification-build.ts). For whoever can build and publish.
  const verification =
    canManage && canAuthorCourses && session.permissions.includes("assessment:author")
      ? await said(await verificationOf(session, id))
      : null;

  const capture = capturable.length
    ? {
        total: capturable.length,
        captured: capturable.filter((one) => one.captured).length,
      }
    : null;

  /*
   * The blueprint this qualification would export, built from the outline
   * already in hand rather than by reading it all again. Offered only where
   * there is a curriculum to describe - a blueprint of no modules is not a
   * file worth downloading, and the reader would ignore it anyway.
   */
  const blueprint = canManage && modules.length > 0 ? await said(blueprintFrom(outline)) : null;

  // Read only so the top-up form can say what an extension would add. A folder
  // that includes a summary of itself needs none.
  const extension = await said(await extensionState(session));
  const mayUseExtension = extensionOffered() && session.permissions.includes("extension:use");

  const totalCriteria = modules.reduce(
    (sum, m) => sum + m.topics.reduce((total, topic) => total + topic.criteria.length, 0) + m.looseCriteria.length,
    0,
  );
  /*
   * Modules whose criteria have not been transcribed yet.
   *
   * A work experience module is not one of them, ever. It is proved by a
   * logbook a coach signs rather than by assessment criteria, so having none
   * is its finished state: the parser and the importer both already know
   * that, and this screen did not.
   *
   * The result was a warning on every correctly imported QCTO qualification:
   * the HRM Officer read perfectly and then announced "5 of 15 modules have no
   * criteria yet", because five of its fifteen are work experience modules.
   * Somebody importing for the first time reads that as the import having
   * half failed, which is exactly the kind of false alarm that made the test
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
  const studyUnitsPlaced = studyUnits.length > 0 && unplacedModules.length === 0;

  /*
   * What is taught from, as opposed to what the qualification is built out of.
   *
   * This was an exclusion list - everything that is not one of the three
   * source documents - and it lasted an hour. Uploading the alignment matrix,
   * which is structure rather than teaching, marked the material step complete
   * on the strength of one spreadsheet: "3 of 3 done" after a single file.
   *
   * TEACHING_KINDS names them positively instead, so a kind that nobody has
   * classified does not quietly count.
   */
  const teachingMaterial = documents.filter((document) => TEACHING_KINDS.has(document.kind as DocumentKind));

  /*
   * Each study unit's own material, so it can be read where somebody looks
   * for it.
   *
   * Roland, 19 September: "How do I see the actual content of each Study Unit
   * - Where is the Theory Guide? How do I view it?" The documents were
   * openable, but only from a table of eighty-one rows at the bottom of the
   * page, with the unit code in a column. A study unit's card listed its
   * modules and nothing else, so the one place somebody would look for SU1's
   * theory guide was the one place it was not.
   *
   * Grouped from the documents already loaded rather than queried again.
   */
  const materialByUnit = new Map<string, typeof documents>();
  for (const document of documents) {
    if (!document.studyUnitCode) continue;
    const held = materialByUnit.get(document.studyUnitCode) ?? [];
    held.push(document);
    materialByUnit.set(document.studyUnitCode, held);
  }

  /*
   * Each step goes to the tab its control is on, not to an anchor.
   *
   * Roland, 20 September: "the 'Upload the alignment document' button doesn't
   * work. It doesn't open a folder or anything to upload from."
   *
   * My own regression from splitting this page into tabs the day before. The
   * steps pointed at "#documents" and "#material", written when everything was
   * on one page. Afterwards "#documents" was the document *list* - on the
   * other tab, with no uploader under it - so the button scrolled somewhere
   * useless, and "#material" did not exist on the default tab at all, so that
   * one did nothing whatever. A link within a page stops working the moment
   * the page becomes two.
   */
  const steps = [
    {
      title: t("qualPage.step.curriculum"),
      done: modules.length > 0,
      state:
        modules.length > 0
          ? t("qualPage.step.curriculumDone", { modules: modules.length, criteria: totalCriteria })
          : t("qualPage.step.curriculumTodo"),
      href: "#curriculum",
      action: t("qualPage.step.curriculumAction"),
    },
    {
      title: t("qualPage.step.units"),
      done: studyUnitsPlaced,
      state: studyUnitsPlaced
        ? t("qualPage.step.unitsDone", { count: studyUnits.length })
        : studyUnits.length === 0
          ? t("qualPage.step.unitsNone")
          : unplacedModules.length === 1
            ? t("qualPage.step.unitsSomeOne")
            : t("qualPage.step.unitsSome", { count: unplacedModules.length }),
      href: `/qualifications/${id}?view=build#add-document`,
      action: t("qualPage.step.unitsAction"),
    },
    {
      title: t("qualPage.step.material"),
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
          ? t("qualPage.step.materialDone", { count: teachingMaterial.length })
          : t("qualPage.step.materialTodo"),
      href: `/qualifications/${id}?view=build#material`,
      action: t("qualPage.step.materialAction"),
    },
    /*
     * The step that was missing entirely.
     *
     * Roland, 21 September: "once a qualification has been uploaded from a
     * folder, there is nothing that tells a user that he still needs to
     * capture workbooks and assessments."
     *
     * Nothing did. The map ended at "the material", which is filing - the
     * files are held and downloadable, and no learner can answer any of them.
     * Turning a workbook into questions somebody types into is a separate job,
     * and the only sign of it was a Capture entry in the menu that never
     * mentioned this qualification.
     */
    /*
     * Built, then checked and live (Roland, 2 October 2026).
     *
     * Capturing used to be a step of its own, paper by paper, and building
     * each study unit another nobody was told about. The platform now does
     * both from what the folder holds, so the map says whether it has, and
     * ends at the one thing a person still does: check it and make it live.
     */
    ...(verification
      ? [
          {
            title: t("qualPage.step.built"),
            done: verification.built && (!capture || capture.captured === capture.total),
            state:
              verification.built && (!capture || capture.captured === capture.total)
                ? t("qualPage.step.builtDone", { units: verification.units.length, papers: capture?.captured ?? 0 })
                : t("qualPage.step.builtTodo"),
            href: `/qualifications/${id}/verify`,
            action: t("qualPage.step.builtAction"),
          },
          {
            title: t("qualPage.step.live"),
            done: verification.live,
            state: verification.live
              ? t("qualPage.step.liveDone")
              : verification.ready
                ? t("qualPage.step.liveReady")
                : t("qualPage.step.liveTodo", {
                    count: verification.units.reduce((sum, unit) => sum + unit.blocking.length, 0),
                  }),
            href: `/qualifications/${id}/verify`,
            action: t("qualPage.step.liveAction"),
          },
        ]
      : capture && capture.total > 0
        ? [
            {
              title: t("qualPage.step.capture"),
              done: capture.captured === capture.total,
              state:
                capture.captured === capture.total
                  ? t("qualPage.step.captureDone", { count: capture.total })
                  : t("qualPage.step.captureTodo", { captured: capture.captured, total: capture.total }),
              href: `/qualifications/${id}?view=build#capture`,
              action: t("qualPage.step.captureAction"),
            },
          ]
        : []),
  ];

  const folderExtension = mayUseExtension
    ? {
        on: extension.on,
        available: extension.availability?.available ?? false,
        registered: extension.registered,
        reason: extension.availability?.reason ?? null,
      }
    : null;
  const driveList = drives.map((one) => ({
    provider: one.provider,
    label: one.label,
    accountLabel: one.accountLabel,
  }));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/qualifications" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
          {t("qualPage.all")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{qualification.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {[
            qualification.saqaId ? t("qualPage.saqa", { id: qualification.saqaId }) : null,
            qualification.curriculumCode,
            qualification.nqfLevel ? t("qualPage.nqf", { level: qualification.nqfLevel }) : null,
            qualification.totalCredits ? t("qualPage.credits", { credits: qualification.totalCredits }) : null,
            qualification.assessmentQualityPartner,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {t("qualPage.summary", {
            modules: modules.length,
            criteria: totalCriteria,
            weighting: qualification.componentWeights
              ? t("qualPage.weighted", {
                  k: Math.round(qualification.componentWeights.knowledge * 100),
                  p: Math.round(qualification.componentWeights.practical * 100),
                  w: Math.round(qualification.componentWeights.workplace * 100),
                })
              : t("qualPage.notWeighted"),
          })}
        </p>
        {/*
          A part qualification is not built here and must not offer to be. Its
          curriculum belongs to the qualification it comes from; what is its
          own is which of those modules it takes.
        */}
        {qualification.parentQualificationId ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            <Rich
              text={t("qualPage.partOf")}
              parts={{
                parent: (
                  <Link
                    href={`/qualifications/${qualification.parentQualificationId}`}
                    className="underline underline-offset-2"
                  >
                    {t("qualPage.parentLink")}
                  </Link>
                ),
              }}
            />
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
            {qualification.parentQualificationId ? t("qualPage.chooseModules") : t("qualPage.buildCurriculum")}
          </Link>
        ) : null}

        {/* Building from the folder, offered where a qualification is looked at
            rather than only on the check page (Roland, 2 October 2026). */}
        {verification && !verification.live ? (
          <div className="mt-3">
            <BuildForm qualificationId={id} again={verification.built} />
          </div>
        ) : null}
      </div>

      <QualificationNav qualificationId={id} current="overview" />

      {canManage ? <ProgressMap steps={steps} /> : null}

      {/*
        Two jobs, told apart. See components/view-tabs.tsx for why this is a
        query parameter rather than client state.
      */}
      {canManage ? (
        <ViewTabs
          basePath={`/qualifications/${id}`}
          current={view}
          tabs={[
            { id: "holds", label: t("qualPage.tabHolds") },
            { id: "build", label: t("qualPage.tabBuild") },
          ]}
        />
      ) : null}

      {view === "build" ? (
        <section className="mb-8">
          <h2 className="mb-2 font-semibold">{t("qualPage.addTitle")}</h2>
          <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">{t("qualPage.addIntro")}</p>
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
                <p className="mb-3 text-sm font-medium">{t("qualPage.finish")}</p>
                <FolderPicker
                  qualificationId={id}
                  topUp
                  label={t("qualPage.finishLabel")}
                  extension={folderExtension}
                  hint={
                    <>
                      {t("qualPage.finishHint")}
                      <br />
                      {t("qualPage.finishHint2")}
                    </>
                  }
                />

                {drives.length > 0 ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <p className="mb-2 text-xs text-[var(--muted)]">{t("qualPage.finishDrive")}</p>
                    <DrivePicker drives={driveList} qualificationId={id} topUp />
                  </div>
                ) : null}
              </Card>

              <div id="material" className="mt-4 scroll-mt-24">
                {studyUnitsPlaced && teachingMaterial.length === 0 ? (
                  <PointHere>{t("qualPage.materialHere")}</PointHere>
                ) : null}
                <Card>
                  <p className="mb-3 text-sm font-medium">{t("qualPage.wholeFolder")}</p>
                  <FolderPicker
                    qualificationId={id}
                    label={t("qualPage.materialLabel")}
                    hint={<>{t("qualPage.materialHint")}</>}
                  />
                </Card>
              </div>

              {drives.length > 0 ? (
                <div className="mt-4">
                  <Card>
                    <p className="mb-3 text-sm font-medium">{t("qualPage.whereItLives")}</p>
                    <DrivePicker drives={driveList} qualificationId={id} />
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
                  <PointHere>{t("qualPage.alignmentHere")}</PointHere>
                ) : null}
                <Card>
                  <p id="add-document" className="mb-3 scroll-mt-24 text-sm font-medium">
                    {t("qualPage.oneDocument")}
                  </p>
                  <DocumentUploader
                    qualificationId={id}
                    kinds={DOCUMENT_KINDS.map((kind) => ({
                      value: kind,
                      label: kindLabel(kind),
                    }))}
                    units={uploadTargets?.units ?? []}
                    modules={uploadTargets?.modules ?? []}
                  />
                </Card>
              </div>
            </>
          ) : null}
          {/*
            Turning the filed workbooks into something a learner can answer.

            Roland, 21 September: "The workbooks and assessments are in the
            folder, they have been read and linked. Why can't they just be
            captured?" They can now - the second upload is gone. The review is
            not, because that is the step that catches a misread answer.
          */}
          {capturable.length > 0 ? (
            <div id="capture" className="mt-6 scroll-mt-24">
              <Card>
                <p className="mb-2 text-sm font-medium">{t("qualPage.capture")}</p>
                <CaptureList qualificationId={id} rows={capturable} />
              </Card>
            </div>
          ) : null}

          {/*
            The way out, which is also the cheapest way back in.

            A folder carrying _control/blueprint.json is read directly - no
            model, no token, no quota - and until now nothing could produce
            one. Reading a qualification in the expensive way once and
            downloading this makes every later import of that folder free and
            exact. See lib/blueprint-export.ts.
          */}
          {blueprint ? (
            <div className="mt-6">
              <Card>
                <p className="text-sm font-medium">{t("qualPage.blueprint")}</p>
                <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                  <Rich
                    text={t("qualPage.blueprintIntro")}
                    parts={{
                      count:
                        blueprint.file.knowledge_modules.length +
                        blueprint.file.practical_modules.length +
                        blueprint.file.workplace_modules.length,
                      folder: <code className="rounded bg-[var(--surface)] px-1">_control</code>,
                    }}
                  />
                </p>
                <a
                  href={`/api/blueprint/${id}`}
                  className="mt-3 inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {t("qualPage.download", { file: blueprint.filename })}
                </a>
                {blueprint.notes.length > 0 ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-medium text-[var(--muted)]">{t("qualPage.notCarried")}</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-[var(--muted)]">
                      {blueprint.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            </div>
          ) : null}

          {/*
            At the foot of the tab that changes things, and nowhere near the
            curriculum somebody is reading. A destructive control belongs with
            the other controls, last.
          */}
          {removal ? (
            <RemoveQualification
              qualificationId={id}
              title={qualification.title}
              holds={removal.holds}
              removes={removal.removes}
            />
          ) : null}
        </section>
      ) : (
        <>
          {/*
            The way around the long tab.

            Roland, 19 September: "A floating navigation bar or sub-menu would work
            better for such long pages." This one runs to fifteen modules, five
            hundred curriculum lines and eighty documents; by the time somebody is
            reading a criterion the headings are a screen and a half above them.

            Only on this tab. The build tab is a column of forms somebody works
            down in order, and a menu over the top of it would be answering a
            question nobody is asking there.
          */}
          <PageNav />

          {notCaptured.length > 0 ? (
            <div className="mb-6 rounded-lg border-2 p-4" style={{ borderColor: "var(--danger)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                {t("qualPage.notCaptured", { count: notCaptured.length, total: modules.length })}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("qualPage.notCapturedWhy")}</p>
            </div>
          ) : null}

          {studyUnits.length > 0 || outcomes.length > 0 ? (
            <section id="structure" data-page-section={t("qualPage.nav.units")} className="mb-8 scroll-mt-24">
              <h2 className="mb-2 font-semibold">{t("qualPage.structure")}</h2>
              <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">{t("qualPage.structureIntro")}</p>

              {/*
                The way to see whether any of it actually reaches a learner.

                Job sheet 2.1. Every screen here shows what exists; that one shows
                what is reachable, and names the study units a learner would open
                and find empty. A tested pipeline with no screen is a feature that
                does not exist, and a screen with no link to it is the same thing.
              */}
              {canAuthorCourses ? (
                <p className="mb-4 text-sm">
                  <Link href={`/qualifications/${id}/learner`} className="underline underline-offset-2">
                    {t("qualPage.seeAsLearner")}
                  </Link>
                  <span className="text-[var(--muted)]">{t("qualPage.seeAsLearnerNote")}</span>
                </p>
              ) : null}

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
                    <p className="text-sm font-semibold">{t("qualPage.nextStep")}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {t("qualPage.nextStepWhy", { count: unplacedModules.length })}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{t("qualPage.nextStepHow")}</p>
                    {/*
                      A link, because "under the documents below" is not a
                      direction on a page this long. The sentence that used to sit
                      here also offered to build them "by hand here", pointing at a
                      screen that does not exist - worse than a vague pointer,
                      because somebody looks for it.
                    */}
                    <p className="mt-2">
                      <Link
                        href={`/qualifications/${id}?view=build#add-document`}
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                        style={{ background: "var(--brand-primary)" }}
                      >
                        {t("qualPage.takeMe")}
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="mb-4 rounded-lg border-2 p-4" style={{ borderColor: "var(--danger)" }}>
                    <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                      {unplacedModules.length === 1
                        ? t("qualPage.unplacedOne")
                        : t("qualPage.unplaced", { count: unplacedModules.length })}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {t("qualPage.unplacedWhy", { modules: unplacedModules.map((m) => m.code).join(", ") })}
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
                          <span className="font-mono text-sm">{unit.code}</span> {unit.title}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {unit.outcome ? t("qualPage.elo", { number: unit.outcome.number }) : t("qualPage.noElo")}
                          {unit.credits ? ` · ${t("qualPage.credits", { credits: unit.credits })}` : ""}
                        </p>
                      </div>
                      <p className="text-sm text-[var(--muted)] tabular-nums">
                        {unit.modules.length === 1 ? t("qual.oneModule") : t("qual.modules", { count: unit.modules.length })}
                      </p>
                    </div>

                    {unit.outcome ? (
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        <p className="text-sm">{unit.outcome.description}</p>
                        {unit.outcome.criteria.length > 0 ? (
                          <>
                            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                              {t("qualPage.eisaTests")}
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
                        {/*
                          Chips that go somewhere.

                          Roland: "there are no links on the buttons, so I can't
                          view the respective modules." They looked exactly like
                          controls and did nothing. There is no page per module -
                          a module's content is a card further down this one - so
                          each goes to that card.
                        */}
                        {unit.modules.map((entry) => (
                          <li key={entry.id}>
                            <Link
                              href={`#module-${entry.code}`}
                              className="block rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:border-[var(--brand-accent)] hover:bg-[var(--brand-accent)]/5"
                            >
                              <span className="font-mono">{entry.code}</span>{" "}
                              <span className="text-[var(--muted)]">
                                {componentLabel(entry.component)}
                                {entry.credits ? ` · ${t("qualPage.cr", { credits: entry.credits })}` : ""}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p
                        className="mt-3 border-t border-[var(--border)] pt-3 text-sm"
                        style={{ color: "var(--danger)" }}
                      >
                        {t("qualPage.noModules")}
                      </p>
                    )}

                    {/*
                      What a learner and a facilitator actually work from, in the
                      place somebody looks for it. Each one opens.

                      The restricted kinds - memoranda, answer guides, summative
                      papers - are marked, because this is a screen a facilitator
                      reads and the difference between a workbook and its answer
                      guide matters at a glance. What is withheld from learners is
                      enforced on the download itself, not here; this is a label,
                      not the lock.
                    */}
                    {(materialByUnit.get(unit.code) ?? []).length > 0 ? (
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                          {t("qualPage.unitMaterial")}
                        </p>
                        <ul className="space-y-1">
                          {(materialByUnit.get(unit.code) ?? []).map((document) => (
                            <li key={document.id} className="text-sm">
                              <Link
                                href={`/api/programme-documents/${document.id}`}
                                className="underline-offset-2 hover:underline"
                              >
                                {document.title}
                              </Link>{" "}
                              <span className="text-xs text-[var(--muted)]">
                                {kindLabel(document.kind)}
                                {document.version ? ` · ${document.version}` : ""}
                              </span>
                              {RESTRICTED_TO_ASSESSORS.has(document.kind as DocumentKind) ? (
                                <span className="ml-1.5 rounded bg-[var(--border)]/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                  {t("qualPage.withheld")}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <section id="documents" data-page-section={t("qualPage.nav.documents")} className="mb-8 scroll-mt-24">
            <h2 className="mb-2 font-semibold">{t("qualPage.documents")}</h2>
            <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">{t("qualPage.documentsIntro")}</p>
            <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">{t("qualPage.recordNotThing")}</span>{" "}
              {t("qualPage.recordWhy")}
            </p>

            {documents.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("qualPage.document")}</th>
                      <th className="px-4 py-3 font-medium">{t("qualPage.kind")}</th>
                      <th className="px-4 py-3 font-medium">{t("qualPage.attached")}</th>
                      <th className="px-4 py-3 font-medium">{t("qualPage.size")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3">
                          <a
                            href={`/api/programme-documents/${document.id}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {document.title}
                          </a>
                          {document.version ? (
                            <span className="ml-2 text-xs text-[var(--muted)]">{document.version}</span>
                          ) : null}
                          <p className="text-xs text-[var(--muted)]">{document.filename}</p>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">{kindLabel(document.kind)}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {document.studyUnitCode ?? document.moduleCode ?? t("qualPage.wholeQualification")}
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
              <p className="mt-3 text-sm text-[var(--muted)]">{t("qualPage.noDocuments")}</p>
            )}
          </section>

          <h2 id="curriculum" data-page-section={t("qualPage.nav.curriculum")} className="mb-2 scroll-mt-24 font-semibold">
            {t("qualPage.curriculum")}
          </h2>
          <div className="space-y-4">
            {modules.map((curriculumModule) => {
              const criteriaHere =
                curriculumModule.topics.reduce((sum, topic) => sum + topic.criteria.length, 0) +
                curriculumModule.looseCriteria.length;

              return (
                /* The destination for the chips in the delivery structure
                   above. scroll-mt-24 keeps the heading clear of the fixed
                   header when somebody arrives. */
                <div
                  key={curriculumModule.id}
                  id={`module-${curriculumModule.code}`}
                  className="scroll-mt-24"
                >
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          <span className="font-mono text-sm">{curriculumModule.code}</span> {curriculumModule.title}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {componentLabel(curriculumModule.component)}
                          {curriculumModule.credits
                            ? ` · ${t("qualPage.credits", { credits: curriculumModule.credits })}`
                            : ""}
                        </p>
                      </div>
                      <p className="text-sm text-[var(--muted)] tabular-nums">
                        {criteriaHere === 1 ? t("qual.oneCriterion") : t("qual.criteria", { count: criteriaHere })}
                      </p>
                    </div>

                    {curriculumModule.topics.length === 0 && curriculumModule.looseCriteria.length === 0 ? (
                      <p className="mt-3 text-sm text-[var(--muted)]">{t("qualPage.notTranscribed")}</p>
                    ) : null}

                    {curriculumModule.topics.map((topic) => {
                      const byKind = new Map<string, typeof topic.elements>();
                      for (const element of topic.elements) {
                        byKind.set(element.kind, [...(byKind.get(element.kind) ?? []), element]);
                      }

                      return (
                        <div key={topic.id} className="mt-4 border-t border-[var(--border)] pt-4">
                          <p className="text-sm font-medium">
                            <span className="font-mono">{topic.code}</span> {topic.title}
                            {topic.weightPercent !== null ? (
                              <span className="ml-2 text-xs text-[var(--muted)]">
                                {t("qualPage.ofModule", { percent: topic.weightPercent })}
                              </span>
                            ) : null}
                          </p>

                          <div className="mt-3 grid gap-4 md:grid-cols-2">
                            {[...byKind.entries()].map(([kind, items]) => (
                              <div key={kind}>
                                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                                  {t("qualPage.toTeach", { kind: maybe(t, `qualPage.element.${kind}`) ?? kind })}
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
                                        <span className="font-mono text-xs text-[var(--muted)]">{element.code}</span>{" "}
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
                                  {t("qualPage.iac")}
                                </p>
                                <ul className="mt-1.5 space-y-1">
                                  {topic.criteria.map((criterion) => (
                                    <li key={criterion.id} className="text-sm">
                                      <span className="font-mono text-xs text-[var(--muted)]">{criterion.code}</span>{" "}
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
                              <p className="text-sm text-[var(--muted)]">{t("qualPage.workplaceNone")}</p>
                            ) : (
                              <p className="text-sm" style={{ color: "var(--danger)" }}>
                                {t("qualPage.neverAchieved")}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {curriculumModule.looseCriteria.length > 0 ? (
                      <div className="mt-4 border-t border-[var(--border)] pt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                          {t("qualPage.looseCriteria")}
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {curriculumModule.looseCriteria.map((criterion) => (
                            <li key={criterion.id} className="text-sm">
                              <span className="font-mono text-xs text-[var(--muted)]">{criterion.code}</span>{" "}
                              {criterion.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </Card>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
