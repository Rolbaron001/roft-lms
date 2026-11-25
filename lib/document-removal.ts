/**
 * Taking one document off a programme (job sheet D63, 25 November 2026).
 *
 * Until this, a filed document could be removed only with the whole
 * qualification. Heidi confirmed two RPL Advisor files should never have been
 * in its folder: another programme's matrix, and a learning material matrix
 * meant only for QCTO auditors. The second is kept, so it can go to the
 * provider's Library under a category (Accreditation for an auditor's
 * document), where learners never see it; the Library entry uses the stored
 * file as it is.
 *
 * Refused while a learner's path uses the document, or a captured paper was
 * read from it: those depend on it, and the reason says where.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { captureJobs, courseSteps, courses, libraryDocuments, programmeDocuments, qualifications, studyUnits } from "@/db/schema";
import { recordAudit } from "./audit";
import { LIBRARY_CATEGORIES, visibilityFor, type LibraryCategory } from "./records";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export class DocumentRemovalError extends Error {}

export async function removeProgrammeDocument(
  session: AuthenticatedSession,
  documentId: string,
  input: { reason: string; keepInLibraryAs?: LibraryCategory | null },
): Promise<{ qualificationId: string | null; libraryId: string | null }> {
  assertSessionCan(session, "qualification:manage");
  const reason = input.reason.trim();
  if (reason.length < 10) throw new DocumentRemovalError("Say in a sentence why it is being removed. The reason is kept in the audit trail.");
  const category = input.keepInLibraryAs ?? null;
  if (category && !(LIBRARY_CATEGORIES as readonly string[]).includes(category)) throw new DocumentRemovalError("Choose a Library category.");

  return withTenant(session.organisationId, async (tx) => {
    const [document] = await tx.select().from(programmeDocuments).where(eq(programmeDocuments.id, documentId));
    if (!document) throw new DocumentRemovalError("That document was not found.");

    const onPaths = await tx
      .select({ unit: studyUnits.code })
      .from(courseSteps)
      .innerJoin(courses, eq(courses.id, courseSteps.courseId))
      .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(courseSteps.programmeDocumentId, documentId));
    if (onPaths.length > 0) {
      const units = [...new Set(onPaths.map((one) => one.unit ?? "a course"))].join(", ");
      throw new DocumentRemovalError(`It is a step on the learners' path in ${units}. Take that step off the study unit first, then remove it.`);
    }
    const [captured] = await tx
      .select({ id: captureJobs.id })
      .from(captureJobs)
      .where(and(eq(captureJobs.paperSha256, document.sha256), isNotNull(captureJobs.committedAt)))
      .limit(1);
    if (captured) throw new DocumentRemovalError("A workbook or assessment was captured from it, so it is kept as the record of what that paper said.");

    let libraryId: string | null = null;
    if (category) {
      const [kept] = await tx
        .insert(libraryDocuments)
        .values({
          organisationId: session.organisationId,
          category,
          title: document.title,
          description: reason,
          version: document.version,
          filename: document.filename,
          storageKey: document.storageKey,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          contentHash: document.sha256,
          visibleToAll: visibilityFor(category, false),
          uploadedById: session.userId,
        })
        .returning({ id: libraryDocuments.id });
      libraryId = kept.id;
    }

    // A later version that named this one as the one it replaces now
    // replaces nothing, rather than pointing at a document that is gone.
    await tx.update(programmeDocuments).set({ supersedesId: null }).where(eq(programmeDocuments.supersedesId, documentId));
    await tx.update(programmeDocuments).set({ guideDocumentId: null }).where(eq(programmeDocuments.guideDocumentId, documentId));
    await tx.delete(programmeDocuments).where(eq(programmeDocuments.id, documentId));

    const [programme] = document.qualificationId
      ? await tx.select({ title: qualifications.title }).from(qualifications).where(eq(qualifications.id, document.qualificationId))
      : [];
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "programme_document.removed",
      entityType: "programme_document",
      entityId: documentId,
      before: { filename: document.filename, kind: document.kind, programme: programme?.title ?? null },
      after: { reason, keptInLibraryAs: category, libraryId },
    });
    return { qualificationId: document.qualificationId, libraryId };
  });
}
