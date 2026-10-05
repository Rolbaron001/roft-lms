import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { courseSteps, courses, libraryItems, libraryLinks, qualifications, studyUnits } from "@/db/schema";
import { recordAudit } from "./audit";
import { getObject } from "./storage";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { detectMedia } from "./media";
import { acceptFile, UploadError, type ServableFile } from "./uploads";
import { resolveTitles } from "./spine";

/**
 * The provider's library of learning material (db/schema/library.ts).
 *
 * Staff upload an item once and link it to every study unit that uses it.
 * Learners never browse the library: they meet an item on a study unit's
 * page, through lib/learner-unit.ts, once their cohort has released it.
 */

export type LibraryItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  links: { id: string; studyUnitId: string; studyUnitCode: string; studyUnitTitle: string; qualificationTitle: string; releaseWithStepId: string | null; releaseWithTitle: string | null }[];
};

export async function uploadLibraryItem(
  session: AuthenticatedSession,
  input: { title?: string; description?: string; studyUnitId?: string; releaseWithStepId?: string },
  file: { filename: string; bytes: Uint8Array },
): Promise<{ id: string }> {
  assertSessionCan(session, "course:author");
  const stored = await acceptFile(session.organisationId, "library", file);
  const title = input.title?.trim() || file.filename.replace(/\.[A-Za-z0-9]+$/, "");

  const id = await withTenant(session.organisationId, async (tx) => {
    const [item] = await tx
      .insert(libraryItems)
      .values({
        organisationId: session.organisationId,
        title,
        description: input.description?.trim() || null,
        kind: stored.kind,
        storageKey: stored.storageKey,
        filename: stored.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        uploadedById: session.userId,
      })
      .returning({ id: libraryItems.id });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "library.item_added",
      entityType: "library_item",
      entityId: item.id,
      after: { title, kind: stored.kind, sizeBytes: stored.sizeBytes },
    });
    return item.id;
  });

  if (input.studyUnitId) await linkLibraryItem(session, id, input.studyUnitId, input.releaseWithStepId || null);
  return { id };
}

/** Uses an item on a study unit, released with one of its steps or with the unit. */
export async function linkLibraryItem(
  session: AuthenticatedSession,
  itemId: string,
  studyUnitId: string,
  releaseWithStepId: string | null,
): Promise<void> {
  assertSessionCan(session, "course:author");
  await withTenant(session.organisationId, async (tx) => {
    const [item] = await tx.select({ id: libraryItems.id }).from(libraryItems).where(eq(libraryItems.id, itemId));
    const [unit] = await tx.select({ id: studyUnits.id }).from(studyUnits).where(eq(studyUnits.id, studyUnitId));
    if (!item || !unit) throw new UploadError("That item or study unit was not found.", "not_found");
    if (releaseWithStepId) {
      const [step] = await tx
        .select({ id: courseSteps.id })
        .from(courseSteps)
        .innerJoin(courses, eq(courses.id, courseSteps.courseId))
        .where(and(eq(courseSteps.id, releaseWithStepId), eq(courses.studyUnitId, studyUnitId)));
      if (!step) throw new UploadError("That step is not on this study unit.", "rejected");
    }
    await tx
      .insert(libraryLinks)
      .values({ organisationId: session.organisationId, itemId, studyUnitId, releaseWithStepId })
      .onConflictDoUpdate({ target: [libraryLinks.itemId, libraryLinks.studyUnitId], set: { releaseWithStepId } });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "library.item_linked",
      entityType: "library_item",
      entityId: itemId,
      after: { studyUnitId, releaseWithStepId },
    });
  });
}

export async function unlinkLibraryItem(session: AuthenticatedSession, linkId: string): Promise<void> {
  assertSessionCan(session, "course:author");
  await withTenant(session.organisationId, async (tx) => {
    const [link] = await tx.delete(libraryLinks).where(eq(libraryLinks.id, linkId)).returning({ itemId: libraryLinks.itemId, studyUnitId: libraryLinks.studyUnitId });
    if (link) {
      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        action: "library.item_unlinked",
        entityType: "library_item",
        entityId: link.itemId,
        after: { studyUnitId: link.studyUnitId },
      });
    }
  });
}

/** Removes an item no study unit uses any more. One in use is refused. */
export async function removeLibraryItem(session: AuthenticatedSession, itemId: string): Promise<void> {
  assertSessionCan(session, "course:author");
  await withTenant(session.organisationId, async (tx) => {
    const [used] = await tx.select({ id: libraryLinks.id }).from(libraryLinks).where(eq(libraryLinks.itemId, itemId)).limit(1);
    if (used) throw new UploadError("That item is still used by a study unit. Take it off every study unit first.", "rejected");
    const [item] = await tx.delete(libraryItems).where(eq(libraryItems.id, itemId)).returning({ title: libraryItems.title });
    if (item) {
      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        action: "library.item_removed",
        entityType: "library_item",
        entityId: itemId,
        before: { title: item.title },
      });
    }
  });
}

/** Every item, with the study units that use it. `studyUnitId` narrows it to one unit's. */
export async function listLibrary(session: AuthenticatedSession, studyUnitId?: string): Promise<LibraryItem[]> {
  assertSessionCan(session, "course:read");
  return withTenant(session.organisationId, async (tx) => {
    const links = await tx
      .select({
        id: libraryLinks.id,
        itemId: libraryLinks.itemId,
        studyUnitId: libraryLinks.studyUnitId,
        studyUnitCode: studyUnits.code,
        studyUnitTitle: studyUnits.title,
        qualificationTitle: qualifications.title,
        releaseWithStepId: libraryLinks.releaseWithStepId,
      })
      .from(libraryLinks)
      .innerJoin(studyUnits, eq(studyUnits.id, libraryLinks.studyUnitId))
      .innerJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
      .orderBy(asc(studyUnits.code));
    const stepIds = links.map((link) => link.releaseWithStepId).filter((id): id is string => Boolean(id));
    const steps = stepIds.length ? await tx.select().from(courseSteps).where(inArray(courseSteps.id, stepIds)) : [];
    const titles = await resolveTitles(tx, steps);

    const wanted = studyUnitId ? new Set(links.filter((link) => link.studyUnitId === studyUnitId).map((link) => link.itemId)) : null;
    const items = await tx.select().from(libraryItems).orderBy(desc(libraryItems.createdAt));
    return items
      .filter((item) => !wanted || wanted.has(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        kind: item.kind,
        filename: item.filename,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        links: links
          .filter((link) => link.itemId === item.id)
          .map((link) => ({
            id: link.id,
            studyUnitId: link.studyUnitId,
            studyUnitCode: link.studyUnitCode,
            studyUnitTitle: link.studyUnitTitle,
            qualificationTitle: link.qualificationTitle,
            releaseWithStepId: link.releaseWithStepId,
            releaseWithTitle: link.releaseWithStepId ? (titles.get(link.releaseWithStepId) ?? null) : null,
          })),
      }));
  });
}

/** The bytes of an item, for staff. Learners go through lib/learner-unit.ts. */
export async function readLibraryItem(session: AuthenticatedSession, itemId: string): Promise<ServableFile> {
  assertSessionCan(session, "course:read");
  const item = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(libraryItems).where(eq(libraryItems.id, itemId));
    return row;
  });
  if (!item) throw new UploadError("No file here.", "not_found");
  return servable(item);
}

/** Served as what the bytes are, re-checked on the way out. */
export async function servable(item: { storageKey: string; filename: string }): Promise<ServableFile> {
  const bytes = await getObject(item.storageKey);
  const detected = detectMedia(bytes, item.filename);
  return {
    bytes,
    mimeType: detected.ok ? detected.mimeType : "application/octet-stream",
    filename: item.filename,
    safeToEmbed: detected.ok ? detected.safeToEmbed : false,
  };
}

/** The study units staff can link to, with each unit's steps to release with. */
export async function linkableUnits(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");
  return withTenant(session.organisationId, async (tx) => {
    const units = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title, qualificationTitle: qualifications.title, courseId: courses.id })
      .from(studyUnits)
      .innerJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
      .leftJoin(courses, eq(courses.studyUnitId, studyUnits.id))
      .orderBy(asc(qualifications.title), asc(studyUnits.sortOrder), asc(studyUnits.code));
    const courseIds = units.map((unit) => unit.courseId).filter((id): id is string => Boolean(id));
    const steps = courseIds.length ? await tx.select().from(courseSteps).where(inArray(courseSteps.courseId, courseIds)).orderBy(asc(courseSteps.sortOrder)) : [];
    const titles = await resolveTitles(tx, steps);
    return units.map((unit) => ({
      id: unit.id,
      label: `${unit.qualificationTitle} · ${unit.code} ${unit.title}`,
      steps: steps.filter((step) => step.courseId === unit.courseId).map((step) => ({ id: step.id, title: titles.get(step.id) ?? "Step" })),
    }));
  });
}
