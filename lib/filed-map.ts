/**
 * The programme map of a qualification already built (job sheet D60 stage 4,
 * 24 November 2026): the same "Check the map" screen, read from the filed
 * documents rather than from a folder waiting to be committed, so a link can
 * be put right without removing the qualification and uploading again.
 *
 * Answers are saved to the documents themselves: a paper's guide, the study
 * unit a document is filed in, the other units it covers, and what it is.
 * They take effect when the qualification is built again, which re-reads the
 * papers against their guides; steps a person has already arranged stay as
 * they are.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { programmeDocuments, studyUnits } from "@/db/schema";
import { capturableDocuments, versionOf } from "./capture-from-documents";
import type { IngestionPlan, PlannedDocument } from "./folder-plan";
import { mapOf, type MapAnswer, type ProgrammeMap } from "./programme-map";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { rememberKind } from "./filing-lessons";

/** The filed documents as a plan, so the map reads them the same way. */
export async function filedPlan(session: AuthenticatedSession, qualificationId: string): Promise<IngestionPlan> {
  assertSessionCan(session, "qualification:manage");
  const { documents, units } = await withTenant(session.organisationId, async (tx) => {
    const documents = await tx
      .select({
        id: programmeDocuments.id,
        filename: programmeDocuments.filename,
        title: programmeDocuments.title,
        kind: programmeDocuments.kind,
        unit: studyUnits.code,
        guide: programmeDocuments.guideDocumentId,
        also: programmeDocuments.alsoStudyUnits,
      })
      .from(programmeDocuments)
      .leftJoin(studyUnits, eq(studyUnits.id, programmeDocuments.studyUnitId))
      .where(eq(programmeDocuments.qualificationId, qualificationId));
    const units = await tx
      .select({ code: studyUnits.code, title: studyUnits.title })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId));
    return { documents, units };
  });

  // The guide each paper is read with now: confirmed, or paired by the build.
  const pairing = new Map((await capturableDocuments(session, qualificationId).catch(() => [])).map((one) => [one.documentId, one.guide?.documentId ?? null]));

  const planned: PlannedDocument[] = documents.map((document) => ({
    path: document.id,
    filename: document.filename,
    bytes: 0,
    target: document.unit ? "study_unit" : "qualification",
    kind: document.kind,
    category: null,
    studyUnitCode: document.unit,
    title: document.title,
    version: versionOf(document.filename),
    because: "",
    also: document.also ?? [],
    guidePath: document.guide ?? pairing.get(document.id) ?? null,
    guideSource: document.guide ? "person" : "name",
    // Built already: nothing waits for a tick. A question still shows where
    // something is genuinely missing, a paper with no guide above all.
    confirmed: true,
  }));

  return {
    source: "filing",
    qualification: { title: "", saqaId: null, curriculumCode: null, nqfLevel: null, credits: null, purpose: null },
    modules: [],
    studyUnits: units.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    documents: planned,
    warnings: [],
  };
}

export async function filedMap(session: AuthenticatedSession, qualificationId: string): Promise<ProgrammeMap> {
  return mapOf(await filedPlan(session, qualificationId));
}

/** One answer on the built qualification's map, saved to its documents. */
export async function answerFiled(session: AuthenticatedSession, qualificationId: string, answer: MapAnswer | "all"): Promise<void> {
  assertSessionCan(session, "qualification:manage");
  if (answer === "all" || answer.field === "confirm" || answer.field === "keep") return;
  // A file whose kind was corrected, to remember for this provider (stage 5).
  let learned: string | null = null;
  await withTenant(session.organisationId, async (tx) => {
    const ofThis = (id: string) => and(eq(programmeDocuments.id, id), eq(programmeDocuments.qualificationId, qualificationId));
    const unitId = async (code: string) => {
      const [unit] = await tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(and(eq(studyUnits.qualificationId, qualificationId), eq(studyUnits.code, code)));
      return unit?.id ?? null;
    };
    switch (answer.field) {
      case "kind": {
        const [row] = await tx
          .update(programmeDocuments)
          .set({ kind: answer.value as never })
          .where(ofThis(answer.path))
          .returning({ filename: programmeDocuments.filename });
        if (row) learned = row.filename;
        return;
      }
      case "unit": {
        const id = await unitId(answer.value);
        if (id) await tx.update(programmeDocuments).set({ studyUnitId: id }).where(ofThis(answer.path));
        return;
      }
      case "also":
        await tx.update(programmeDocuments).set({ alsoStudyUnits: answer.value }).where(ofThis(answer.path));
        return;
      case "guide":
        // "It has no guide" leaves the choice to the build's own pairing.
        await tx
          .update(programmeDocuments)
          .set({ guideDocumentId: answer.value === "none" ? null : answer.value })
          .where(ofThis(answer.path));
        return;
      case "paper":
        if (answer.value !== "ignore") {
          await tx.update(programmeDocuments).set({ guideDocumentId: answer.path }).where(ofThis(answer.value));
        }
        return;
      case "ignore":
        // Removing a filed document is done from the documents list, where its
        // history is shown; the map does not delete anything.
        return;
    }
  });
  if (learned && answer.field === "kind") await rememberKind(session, learned, answer.value);
}
