import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiImportJobs, curriculumModules, studyUnits } from "@/db/schema";
import { recordAudit } from "./audit";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  AuthoringError,
} from "./authoring";
import { addTopic, addTopicElement } from "./curriculum-editor";
import { uploadProgrammeDocument } from "./programme-documents";
import { fileLibraryDocument } from "./records";
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
  modules: number;
  topics: number;
  elements: number;
  criteria: number;
  studyUnits: number;
  documents: number;
  libraryDocuments: number;
  /** What the ordinary guards turned away, in their own words. */
  refused: string[];
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

  // A course or a programme takes documents and nothing else: there is no
  // curriculum under it to build, and its study units belong to the
  // qualification rather than to it.
  const intoQualification = Boolean(input.qualificationId);

  const report: CommitReport = {
    qualificationId: input.qualificationId ?? "",
    modules: 0,
    topics: 0,
    elements: 0,
    criteria: 0,
    studyUnits: 0,
    documents: 0,
    libraryDocuments: 0,
    refused: [],
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
              eq(studyUnits.qualificationId, input.qualificationId!),
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
            qualificationId: input.qualificationId!,
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
    await commitModule(session, input.qualificationId!, planned, report);
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
        await fileLibraryDocument(session, {
          category: document.category as
            | "policy"
            | "accreditation"
            | "contract"
            | "statutory"
            | "operational"
            | "other",
          title: document.title,
          version: document.version ?? undefined,
          filename: document.filename,
          mimeType: "application/octet-stream",
          bytes,
        });
        report.libraryDocuments += 1;
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
            unitId || !intoQualification ? undefined : input.qualificationId,
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
        qualificationId: input.qualificationId ?? null,
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
        qualificationId: input.qualificationId,
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

  if (existing) {
    report.refused.push(
      `${module.code}: already in this qualification, so it was left alone.`,
    );
    return;
  }

  let created;
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

  // Criterion codes are unique within the module rather than the topic, so the
  // numbering runs across the whole module. Restarting it per topic collides
  // the moment a module has two.
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
    let topicId: string;

    try {
      const made = await addTopic(session, {
        curriculumModuleId: created.id,
        code: topic.code?.trim() || `T${topicNumber}`,
        title: topic.title || `Topic ${topicNumber}`,
      });
      topicId = made.id;
      report.topics += 1;
    } catch (error) {
      report.refused.push(
        explain(error, `${module.code} ${topic.code ?? topic.title}`),
      );
      continue;
    }

    let elementNumber = 0;
    for (const element of topic.elements) {
      elementNumber += 1;
      try {
        await addTopicElement(session, {
          topicId,
          kind: elementKind,
          code: `${topic.code?.trim() || `T${topicNumber}`}.${elementNumber}`,
          description: element,
        });
        report.elements += 1;
      } catch (error) {
        report.refused.push(explain(error, `${module.code} an element`));
      }
    }

    for (const criterion of topic.criteria) {
      criterionNumber += 1;
      try {
        await addAssessmentCriterion(session, {
          curriculumModuleId: created.id,
          topicId,
          code: `${module.code}-IAC${criterionNumber}`,
          description: criterion,
        });
        report.criteria += 1;
      } catch (error) {
        report.refused.push(explain(error, `${module.code} a criterion`));
      }
    }
  }
}
