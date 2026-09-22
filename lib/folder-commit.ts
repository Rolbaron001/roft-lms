import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  aiImportJobs,
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  qualifications,
  studyUnits,
} from "@/db/schema";
import { recordAudit } from "./audit";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  AuthoringError,
  createQualification,
} from "./authoring";
import { addTopic, addTopicElement } from "./curriculum-editor";
import { uploadProgrammeDocument } from "./programme-documents";
import { fileLibraryDocument, type LibraryCategory } from "./records";
import { getIngestJob, IngestError } from "./folder-import";
import { getObject } from "./storage";
import type { IngestionPlan, PlannedModule } from "./folder-plan";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Committing a plan.
 *
 * One act, because that is what was asked for and because reviewing fifteen
 * modules one button at a time is a review nobody finishes. What makes that
 * safe is not the number of buttons but the fact that everything still goes
 * through the ordinary authoring functions - the same ones the hand editor
 * uses, with the same guards - and that anything they refuse is reported
 * rather than swallowed.
 *
 * Nothing here writes to a table directly. A module that would clash, a
 * criterion with a duplicate code, a document of a kind the platform does not
 * accept: each is turned away by the guard that already existed, counted, and
 * put in front of the person who pressed the button.
 *
 * It is deliberately not transactional across the whole plan. A folder of
 * sixty documents where the fifty-first is corrupt should leave fifty filed
 * and say so, not throw the afternoon away.
 */

export type CommitReport = {
  qualificationId: string;
  /** Its title, where this commit is what brought it into existence. */
  createdQualification?: string | null;
  modules: number;
  topics: number;
  elements: number;
  criteria: number;
  studyUnits: number;
  documents: number;
  libraryDocuments: number;
  /** What the ordinary guards turned away, in their own words. */
  refused: string[];
  /**
   * What was already there and was left as it was.
   *
   * Separate from `refused` because they are different news. A refusal is
   * something to go and fix; this is the platform declining to overwrite work
   * somebody has already done, which is what a second pass over a folder
   * should do.
   */
  alreadyHeld: string[];
};

function explain(error: unknown, where: string): string {
  if (error instanceof AuthoringError) return `${where}: ${error.message}`;
  if (error instanceof Error && error.name.endsWith("Error")) {
    return `${where}: ${error.message}`;
  }
  if (error && typeof error === "object" && "issues" in error) {
    return `${where}: ${(error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ")}`;
  }
  return `${where}: could not be added.`;
}

const COMPONENTS = new Set(["knowledge", "practical", "workplace"]);

export async function commitPlan(
  session: AuthenticatedSession,
  input: {
    jobId: string;
    /** Exactly one of these says where the documents belong. */
    qualificationId?: string;
    courseId?: string;
    learningPathId?: string;
  },
): Promise<CommitReport> {
  assertSessionCan(session, "qualification:manage");

  const job = await getIngestJob(session, input.jobId);
  const plan = job.proposal as IngestionPlan | null;

  if (!plan || job.status !== "proposed") {
    throw new IngestError(
      "That import has nothing waiting to be committed.",
      "no_plan",
    );
  }

  /*
   * Building the qualification this folder describes, where there is not one
   * already.
   *
   * Roland, 20 September: he emptied the platform, read the 121151 folder with
   * Claude Code - which worked, and reported 15 modules, 52 topics, 331
   * elements and 160 criteria - and then found "Into which qualification" with
   * nothing in it. There was nothing to choose, because the only qualification
   * had just been deleted, and this function had no way to make one.
   *
   * So the folder route could read a whole qualification and not create one.
   * It could only add to a qualification built some other way first, which
   * makes "build it from a folder" a promise the screen could not keep. The
   * plan already carries the title, the SAQA id, the curriculum code, the
   * level and the credits; nothing was missing except the step that uses them.
   *
   * Refused where the code is already held, for the same reason the documents
   * route refuses it: two qualifications carrying one curriculum code is an
   * ambiguity nothing downstream can resolve.
   */
  let qualificationId = input.qualificationId;
  let created: string | null = null;

  if (!qualificationId && job.target?.mode === "qualification") {
    const details = plan.qualification;

    if (!details?.title?.trim()) {
      throw new IngestError(
        "This folder was read as a new qualification, but no title was found in it, so there is nothing to create. Choose an existing qualification to add it to instead.",
        "no_plan",
      );
    }

    if (details.curriculumCode) {
      const [clash] = await withTenant(session.organisationId, (tx) =>
        tx
          .select({ id: qualifications.id, title: qualifications.title })
          .from(qualifications)
          .where(eq(qualifications.curriculumCode, details.curriculumCode!)),
      );

      if (clash) {
        throw new IngestError(
          `"${clash.title}" already carries the curriculum code ${details.curriculumCode}. Two qualifications on one code is an ambiguity nothing downstream can resolve. Choose it above to add this folder to it instead.`,
          "no_plan",
        );
      }
    }

    const made = await createQualification(session, {
      title: details.title.trim(),
      curriculumCode: details.curriculumCode ?? undefined,
      saqaId: details.saqaId ?? undefined,
      nqfLevel: details.nqfLevel ?? undefined,
      totalCredits: details.credits ?? undefined,
      description: details.purpose ?? undefined,
    });

    qualificationId = made.id;
    created = made.title;
  }

  // A course or a programme takes documents and nothing else: there is no
  // curriculum under it to build, and its study units belong to the
  // qualification rather than to it.
  const intoQualification = Boolean(qualificationId);

  const report: CommitReport = {
    qualificationId: qualificationId ?? "",
    createdQualification: created,
    modules: 0,
    topics: 0,
    elements: 0,
    criteria: 0,
    studyUnits: 0,
    documents: 0,
    libraryDocuments: 0,
    refused: [],
    alreadyHeld: [],
  };

  // --- study units first, because documents attach to them -----------------
  const unitIds = new Map<string, string>();

  for (const unit of intoQualification ? plan.studyUnits : []) {
    try {
      const existing = await withTenant(session.organisationId, async (tx) => {
        const [row] = await tx
          .select({ id: studyUnits.id })
          .from(studyUnits)
          .where(
            and(
              eq(studyUnits.qualificationId, qualificationId!),
              eq(studyUnits.code, unit.code),
            ),
          );
        return row ?? null;
      });

      if (existing) {
        unitIds.set(unit.code, existing.id);
        continue;
      }

      const [created] = await withTenant(session.organisationId, (tx) =>
        tx
          .insert(studyUnits)
          .values({
            organisationId: session.organisationId,
            qualificationId: qualificationId!,
            code: unit.code,
            title: unit.title,
          })
          .returning({ id: studyUnits.id }),
      );

      unitIds.set(unit.code, created.id);
      report.studyUnits += 1;
    } catch (error) {
      report.refused.push(explain(error, `study unit ${unit.code}`));
    }
  }

  // --- the curriculum ------------------------------------------------------
  for (const planned of intoQualification ? plan.modules : []) {
    await commitModule(session, qualificationId!, planned, report);
  }

  // --- the documents -------------------------------------------------------
  for (const document of plan.documents) {
    // Read back from where the upload was staged. The bytes are not on any
    // disk path the server could re-walk: they came from a browser.
    const key = (job.stagedFiles ?? {})[document.path];
    if (!key) {
      report.refused.push(
        `${document.path}: was not staged when the folder was read, so there is nothing to file.`,
      );
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await getObject(key);
    } catch {
      report.refused.push(`${document.path}: could not be read back from storage.`);
      continue;
    }

    try {
      if (document.target === "library") {
        const filed = await fileLibraryDocument(session, {
          category: document.category as LibraryCategory,
          title: document.title,
          version: document.version ?? undefined,
          filename: document.filename,
          mimeType: "application/octet-stream",
          bytes,
        });

        /*
         * Counted by what happened, not by what was offered.
         *
         * Roland, 22 September: the library held every QMS policy four times.
         * Re-importing a folder is an ordinary thing to do, and it used to
         * add a second copy of everything in it with no sign that it had.
         */
        if (filed.outcome === "already_held") {
          report.alreadyHeld.push(
            `${document.title}: already in the library, byte for byte. Not filed again.`,
          );
        } else if (filed.outcome === "superseded") {
          report.alreadyHeld.push(
            `${document.title}: a newer version of one already filed. It is now the current one, and the previous version is kept.`,
          );
          report.libraryDocuments += 1;
        } else {
          report.libraryDocuments += 1;
        }
        continue;
      }

      const unitId = document.studyUnitCode
        ? unitIds.get(document.studyUnitCode)
        : undefined;

      await uploadProgrammeDocument(
        session,
        {
          // Attached to the study unit where one was identified, and otherwise
          // to whichever thing the import was started from. The upload guard
          // requires exactly one, which is why these are mutually exclusive.
          qualificationId:
            unitId || !intoQualification ? undefined : qualificationId,
          studyUnitId: intoQualification ? unitId : undefined,
          courseId: input.courseId,
          learningPathId: input.learningPathId,
          kind: document.kind ?? "other",
          title: document.title,
          version: document.version ?? undefined,
        } as never,
        { filename: document.filename, bytes },
      );

      report.documents += 1;
    } catch (error) {
      report.refused.push(explain(error, document.path));
    }
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(aiImportJobs)
      .set({
        qualificationId: qualificationId ?? null,
        committedById: session.userId,
        committedAt: new Date(),
        status: "committed",
      })
      .where(eq(aiImportJobs.id, input.jobId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "ai.plan_committed",
      entityType: "ai_import_job",
      entityId: input.jobId,
      after: {
        qualificationId: qualificationId,
        source: plan.source,
        modules: report.modules,
        criteria: report.criteria,
        documents: report.documents + report.libraryDocuments,
        refused: report.refused.length,
      },
    });
  });

  return report;
}

async function commitModule(
  session: AuthenticatedSession,
  qualificationId: string,
  module: PlannedModule,
  report: CommitReport,
): Promise<void> {
  const component = String(module.component ?? "").toLowerCase();

  // The component decides which third of the qualification a module counts
  // towards, so a wrong one is a readiness calculation that is quietly wrong
  // rather than an error anybody sees.
  if (!COMPONENTS.has(component)) {
    report.refused.push(
      `${module.code}: no usable component - it says "${module.component ?? "nothing"}", and it has to be knowledge, practical or workplace.`,
    );
    return;
  }

  // Already there is not a failure. A folder read twice, or a qualification
  // half-built by hand, should add what is missing and leave the rest.
  const existing = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(
        and(
          eq(curriculumModules.qualificationId, qualificationId),
          eq(curriculumModules.code, module.code),
        ),
      );
    return row ?? null;
  });

  /**
   * A module that is already there is topped up, not skipped.
   *
   * It used to return here, which made the comment above a lie: nothing was
   * added and a half-built module stayed half-built. Roland asked on
   * 15 September whether pointing the platform at a completed folder would
   * finish a qualification that was partly loaded, and the honest answer was
   * no - it added missing modules but never looked inside an existing one.
   *
   * Now it goes in and adds the topics, elements and criteria that are not
   * there yet, leaving everything that is exactly as it stands. Nothing is
   * overwritten and nothing is deleted, so a second pass over a fuller folder
   * completes the qualification rather than forcing somebody to delete it and
   * start again.
   */
  let created: { id: string };

  if (existing) {
    created = existing;
    report.alreadyHeld.push(
      `${module.code}: already here, so only what was missing from it was added.`,
    );
  } else {
    try {
      created = await addCurriculumModule(session, {
        qualificationId,
        component: component as "knowledge" | "practical" | "workplace",
        code: module.code,
        title: module.title,
        credits: module.credits ?? undefined,
      });
      report.modules += 1;
    } catch (error) {
      report.refused.push(explain(error, module.code));
      return;
    }
  }

  /**
   * What the module already holds, so a top-up adds rather than duplicates.
   *
   * Topics are matched on code, which is what the curriculum document numbers
   * them by. Elements and criteria are matched on their text, because their
   * codes are generated here from position - and position shifts the moment a
   * document gains a topic, so a code match would miss every one of them.
   */
  const held = await withTenant(session.organisationId, async (tx) => {
    const topicRows = await tx
      .select({ id: curriculumTopics.id, code: curriculumTopics.code })
      .from(curriculumTopics)
      .where(eq(curriculumTopics.curriculumModuleId, created.id));

    const topicIds = topicRows.map((row) => row.id);

    const elementRows = topicIds.length
      ? await tx
          .select({ description: curriculumTopicElements.description })
          .from(curriculumTopicElements)
          .where(inArray(curriculumTopicElements.topicId, topicIds))
      : [];

    const criterionRows = await tx
      .select({
        code: assessmentCriteria.code,
        description: assessmentCriteria.description,
      })
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.curriculumModuleId, created.id));

    return {
      topics: new Map(topicRows.map((row) => [row.code.trim(), row.id])),
      elements: new Set(
        elementRows.map((row) => row.description.trim().toLowerCase()),
      ),
      criteria: new Set(
        criterionRows.map((row) => row.description.trim().toLowerCase()),
      ),
      /**
       * The highest criterion number already used in this module.
       *
       * Numbering has to continue past it rather than restart. The code is
       * generated from position - KM01-IAC1, KM01-IAC2 - so a top-up that
       * started again at one would collide with the criteria loaded first, and
       * the guard would refuse a criterion whose text is genuinely new. That is
       * exactly what happened the first time this was tested: the topic and its
       * element went in and its criterion was turned away.
       */
      highestCriterion: criterionRows.reduce((highest, row) => {
        const number = Number(/(\d+)$/.exec(row.code)?.[1] ?? 0);
        return Number.isFinite(number) && number > highest ? number : highest;
      }, 0),
    };
  });

  // Criterion codes are unique within the module rather than the topic, so the
  // numbering runs across the whole module. Restarting it per topic collides
  // the moment a module has two.
  // Continues past whatever the module already holds, rather than from zero.
  let criterionNumber = 0;
  let topicNumber = 0;

  const elementKind =
    component === "knowledge"
      ? ("knowledge_topic" as const)
      : component === "practical"
        ? ("practical_activity" as const)
        : ("work_activity" as const);

  for (const topic of module.topics) {
    topicNumber += 1;
    const topicCode = topic.code?.trim() || `T${topicNumber}`;
    let topicId: string;

    // A topic already under this module is used as it stands. Only a topic
    // that is not there gets made.
    const existingTopic = held.topics.get(topicCode);

    if (existingTopic) {
      topicId = existingTopic;
    } else {
      try {
        const made = await addTopic(session, {
          curriculumModuleId: created.id,
          code: topicCode,
          title: topic.title || `Topic ${topicNumber}`,
        });
        topicId = made.id;
        held.topics.set(topicCode, made.id);
        report.topics += 1;
      } catch (error) {
        report.refused.push(
          explain(error, `${module.code} ${topic.code ?? topic.title}`),
        );
        continue;
      }
    }

    let elementNumber = 0;
    for (const element of topic.elements) {
      elementNumber += 1;

      /**
       * Matched on the text rather than the code.
       *
       * These codes are generated here from position, so a document that has
       * gained a topic since the last pass renumbers everything after it. A
       * code match would then miss every element and add the lot a second
       * time, which is the one outcome a top-up must not produce.
       */
      const seen = element.trim().toLowerCase();
      if (held.elements.has(seen)) continue;

      try {
        await addTopicElement(session, {
          topicId,
          kind: elementKind,
          code: `${topicCode}.${elementNumber}`,
          description: element,
        });
        held.elements.add(seen);
        report.elements += 1;
      } catch (error) {
        report.refused.push(explain(error, `${module.code} an element`));
      }
    }

    for (const criterion of topic.criteria) {
      const seen = criterion.trim().toLowerCase();
      // Checked before the number is spent, so a criterion already held does
      // not push the next new one's code along by one.
      if (held.criteria.has(seen)) continue;

      criterionNumber += 1;

      try {
        await addAssessmentCriterion(session, {
          curriculumModuleId: created.id,
          topicId,
          code: `${module.code}-IAC${held.highestCriterion + criterionNumber}`,
          description: criterion,
        });
        held.criteria.add(seen);
        report.criteria += 1;
      } catch (error) {
        report.refused.push(explain(error, `${module.code} a criterion`));
      }
    }
  }
}
