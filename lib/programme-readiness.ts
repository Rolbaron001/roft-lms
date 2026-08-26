import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  programmeDocuments,
  qualifications,
  studyUnits,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Whether a qualification is ready to have material built on it.
 *
 * A programme is assembled in an order, and the order is not a convention —
 * it is what makes the rest of the platform able to check anything. Material
 * captured before the curriculum is in cannot have its criteria linked, so its
 * questions evidence nothing, the alignment matrix under-reports, and the
 * readiness figure is wrong in a way nobody notices until an audit. Fixing that
 * afterwards means re-tagging every question by hand.
 *
 * So the three published documents come first, and the curriculum is read in
 * before a study unit's workbooks are. This is the check that enforces it.
 */

export type ReadinessGap = {
  what: string;
  why: string;
  /** What the user should do about it, in the order they should do it. */
  action: string;
};

export type ProgrammeReadiness = {
  qualificationId: string;
  title: string;
  ready: boolean;
  documents: {
    qualification: boolean;
    curriculum: boolean;
    assessmentSpecification: boolean;
  };
  curriculum: {
    imported: boolean;
    modules: number;
    criteria: number;
    studyUnits: number;
  };
  gaps: ReadinessGap[];
};

const REQUIRED_DOCUMENTS = [
  {
    kind: "qualification_document" as const,
    label: "Qualification Document",
    why: "It carries the exit level outcomes and the rules of combination that everything else is checked against.",
  },
  {
    kind: "curriculum_document" as const,
    label: "Curriculum Document",
    why: "It is the authority for every module, topic and assessment criterion. Without it the platform has nothing to link a question to.",
  },
  {
    kind: "assessment_specification" as const,
    label: "Assessment Specification",
    why: "It states how the external assessment is conducted, which is what a Statement of Results admits a learner to.",
  },
];

export async function programmeReadiness(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<ProgrammeReadiness> {
  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new Error("No such qualification.");
    }

    const held = await tx
      .select({ kind: programmeDocuments.kind })
      .from(programmeDocuments)
      .where(
        and(
          eq(programmeDocuments.qualificationId, qualificationId),
          inArray(
            programmeDocuments.kind,
            REQUIRED_DOCUMENTS.map((document) => document.kind),
          ),
        ),
      );

    const have = new Set(held.map((row) => row.kind));

    const modules = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    const criteria = modules.length
      ? await tx
          .select({ id: assessmentCriteria.id })
          .from(assessmentCriteria)
          .where(
            inArray(
              assessmentCriteria.curriculumModuleId,
              modules.map((module) => module.id),
            ),
          )
      : [];

    const units = await tx
      .select({ id: studyUnits.id })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId));

    const gaps: ReadinessGap[] = [];

    for (const document of REQUIRED_DOCUMENTS) {
      if (!have.has(document.kind)) {
        gaps.push({
          what: `The ${document.label} has not been uploaded.`,
          why: document.why,
          action: `Upload the ${document.label} against this qualification first.`,
        });
      }
    }

    // Holding the file is not the same as having read it. A curriculum
    // document sitting in the library with no modules behind it looks
    // complete on a shelf and is useless to everything downstream.
    if (modules.length === 0) {
      gaps.push({
        what: "The curriculum has not been read into the App.",
        why: "The file being uploaded is not the same as its modules, topics and criteria being in the database. Until they are, a question cannot be tagged to anything and nothing can check coverage.",
        action:
          "Import the curriculum so its modules and criteria exist, then come back.",
      });
    } else if (criteria.length === 0) {
      gaps.push({
        what: `The curriculum has ${modules.length} modules but no assessment criteria.`,
        why: "Criteria are what a question evidences. Without them the alignment matrix has nothing to report and readiness cannot be calculated.",
        action:
          "Check the curriculum file was transcribed down to its internal assessment criteria, and import it again.",
      });
    }

    return {
      qualificationId,
      title: qualification.title,
      ready: gaps.length === 0,
      documents: {
        qualification: have.has("qualification_document"),
        curriculum: have.has("curriculum_document"),
        assessmentSpecification: have.has("assessment_specification"),
      },
      curriculum: {
        imported: modules.length > 0,
        modules: modules.length,
        criteria: criteria.length,
        studyUnits: units.length,
      },
      gaps,
    };
  });
}

export class NotReadyError extends Error {
  constructor(
    message: string,
    public readonly gaps: ReadinessGap[],
  ) {
    super(message);
    this.name = "NotReadyError";
  }
}

/**
 * Refuses unless the qualification is ready for material to be built on it.
 *
 * A refusal rather than a warning, and it names what is missing and what to do
 * about it. Letting material in first and asking somebody to tidy up later
 * means the tidying never happens — it means re-tagging every question by
 * hand, which is exactly the work nobody has time for.
 */
export async function assertProgrammeReady(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<void> {
  const readiness = await programmeReadiness(session, qualificationId);

  if (!readiness.ready) {
    throw new NotReadyError(
      `"${readiness.title}" is not ready for material yet. ` +
        readiness.gaps.map((gap) => gap.what).join(" "),
      readiness.gaps,
    );
  }
}

/**
 * Every qualification, with whether material may be built on it.
 *
 * Gated on authoring assessments rather than on managing qualifications: an
 * instructor may write material without being entitled to change the
 * curriculum, and they are exactly who needs to see which programmes are ready
 * before they start.
 */
export async function listProgrammeReadiness(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:author");

  const all = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications),
  );

  return Promise.all(
    all.map((qualification) => programmeReadiness(session, qualification.id)),
  );
}
