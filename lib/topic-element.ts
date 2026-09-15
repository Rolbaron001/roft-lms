/**
 * One line of a curriculum, and everything the platform holds against it.
 *
 * Roland, 15 September, looking at a qualification: "there is a long list of
 * Topic Elements, which is great, but none of them can be accessed. So as a
 * user, how do I view these items?"
 *
 * The list already showed each element's code and its full text, so there was
 * no hidden wording to reveal. What could not be reached is the question a
 * curriculum line actually raises: this has to be taught, so what teaches it,
 * what tests it, and is anything missing? That is held in three places - the
 * provider's alignment matrix, the documents uploaded against the
 * qualification, and the topic's own assessment criteria - and was shown
 * together in none of them.
 *
 * Coverage is a claim, not a link. The matrix says "SU1 Theory Guide, chapter
 * 1" in free text, because that is what a provider types into a spreadsheet,
 * and nothing obliges them to type the name of a file the platform holds. So a
 * reference is matched to a document where it plainly matches and left as
 * written where it does not: never guessed at, and never shown as a document
 * that exists when it might not.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  programmeDocuments,
  qualificationModules,
  qualifications,
  studyUnitModules,
  studyUnits,
  topicElementAlignment,
} from "@/db/schema";
import {
  assertSessionCan,
  type AuthenticatedSession,
} from "@/lib/session";

export class TopicElementError extends Error {}

/** A claim of coverage, with the document it turned out to name, if any. */
export type Coverage = {
  id: string;
  kind: string;
  /** Exactly as the matrix wrote it. */
  reference: string;
  /** A document held here whose title or filename the reference names. */
  document: { id: string; title: string; kind: string } | null;
};

export type TopicElementDetail = {
  element: { id: string; code: string; kind: string; description: string };
  topic: { id: string; code: string; title: string };
  module: { id: string; code: string; title: string; component: string };
  qualification: { id: string; title: string };
  /** What the provider's matrix says covers this line. */
  coverage: Coverage[];
  /**
   * The criteria for the topic this element belongs to.
   *
   * Not for the element: the curriculum assesses a topic, and an element is
   * part of what that topic requires. Shown because "taught but never
   * assessed" is the gap this screen exists to make visible, and neither half
   * shows it alone.
   */
  criteria: { id: string; code: string; description: string }[];
  /** How the provider delivers the module this line sits in. */
  studyUnits: { id: string; code: string; title: string }[];
  /** Every element of the same topic, so the list can be walked from here. */
  siblings: { id: string; code: string; description: string }[];
};

/**
 * Whether a free-text reference names a document held here.
 *
 * Deliberately strict. A reference that merely shares a word with a filename
 * is not a match: linking the wrong document is worse than linking none,
 * because somebody checking coverage would tick a line the document says
 * nothing about.
 */
function documentFor(
  reference: string,
  documents: { id: string; title: string; kind: string; filename: string }[],
): { id: string; title: string; kind: string } | null {
  // Matrix cells routinely carry a location after the name - "SU1 Theory
  // Guide, chapter 1" - so the part before a comma is what names a document.
  const head = reference.trim().toLowerCase().split(",")[0].trim();
  if (head.length < 3) return null;

  for (const document of documents) {
    const title = document.title.trim().toLowerCase();
    const filename = document.filename.trim().toLowerCase();
    if (title === head || filename === head) {
      return { id: document.id, title: document.title, kind: document.kind };
    }
    // A filename carries its extension and often a version; a title does not.
    // Long enough that a short code cannot drag in an unrelated file.
    if (head.length >= 6 && (title.includes(head) || filename.includes(head))) {
      return { id: document.id, title: document.title, kind: document.kind };
    }
  }

  return null;
}

export async function topicElementDetail(
  session: AuthenticatedSession,
  qualificationId: string,
  elementId: string,
): Promise<TopicElementDetail> {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        element: curriculumTopicElements,
        topic: curriculumTopics,
        module: curriculumModules,
      })
      .from(curriculumTopicElements)
      .innerJoin(
        curriculumTopics,
        eq(curriculumTopics.id, curriculumTopicElements.topicId),
      )
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, curriculumTopics.curriculumModuleId),
      )
      .where(eq(curriculumTopicElements.id, elementId));

    if (!row) {
      throw new TopicElementError("That curriculum line is not here.");
    }

    const [qualification] = await tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new TopicElementError("That qualification is not here.");
    }

    /*
     * The line has to belong to the qualification in the address, or a link
     * from one qualification would read another's curriculum.
     *
     * Two ways it can belong. A module is owned by the qualification whose
     * curriculum document published it; a part qualification or skills
     * programme selects modules of its parent instead, and shows them as its
     * own. Checking ownership alone would turn every element of a part
     * qualification away from its own screen.
     */
    const owned = row.module.qualificationId === qualificationId;
    const selected = owned
      ? true
      : (
          await tx
            .select({ id: qualificationModules.id })
            .from(qualificationModules)
            .where(
              and(
                eq(qualificationModules.qualificationId, qualificationId),
                eq(qualificationModules.curriculumModuleId, row.module.id),
              ),
            )
        ).length > 0;

    if (!selected) {
      throw new TopicElementError(
        "That curriculum line does not belong to this qualification.",
      );
    }

    const claims = await tx
      .select()
      .from(topicElementAlignment)
      .where(eq(topicElementAlignment.topicElementId, elementId));

    // Only read when there is something to match against. Every document of a
    // qualification is a long list, and nothing is done with it otherwise.
    const documents = claims.length
      ? await tx
          .select({
            id: programmeDocuments.id,
            title: programmeDocuments.title,
            kind: programmeDocuments.kind,
            filename: programmeDocuments.filename,
          })
          .from(programmeDocuments)
          .where(
            eq(
              programmeDocuments.qualificationId,
              row.module.qualificationId,
            ),
          )
      : [];

    const criteria = await tx
      .select({
        id: assessmentCriteria.id,
        code: assessmentCriteria.code,
        description: assessmentCriteria.description,
      })
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.topicId, row.topic.id))
      .orderBy(asc(assessmentCriteria.sortOrder));

    const unitLinks = await tx
      .select({ studyUnitId: studyUnitModules.studyUnitId })
      .from(studyUnitModules)
      .where(eq(studyUnitModules.curriculumModuleId, row.module.id));

    const units = unitLinks.length
      ? await tx
          .select({
            id: studyUnits.id,
            code: studyUnits.code,
            title: studyUnits.title,
          })
          .from(studyUnits)
          .where(
            inArray(
              studyUnits.id,
              unitLinks.map((link) => link.studyUnitId),
            ),
          )
          .orderBy(asc(studyUnits.sortOrder))
      : [];

    const siblings = await tx
      .select({
        id: curriculumTopicElements.id,
        code: curriculumTopicElements.code,
        description: curriculumTopicElements.description,
      })
      .from(curriculumTopicElements)
      .where(eq(curriculumTopicElements.topicId, row.topic.id))
      .orderBy(asc(curriculumTopicElements.sortOrder));

    return {
      element: {
        id: row.element.id,
        code: row.element.code,
        kind: row.element.kind,
        description: row.element.description,
      },
      topic: { id: row.topic.id, code: row.topic.code, title: row.topic.title },
      module: {
        id: row.module.id,
        code: row.module.code,
        title: row.module.title,
        component: row.module.component,
      },
      qualification: { id: qualification.id, title: qualification.title },
      coverage: claims.map((claim) => ({
        id: claim.id,
        kind: claim.kind,
        reference: claim.reference,
        document: documentFor(claim.reference, documents),
      })),
      criteria,
      studyUnits: units,
      siblings,
    };
  });
}
