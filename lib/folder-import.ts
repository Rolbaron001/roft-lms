import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiImportJobs, curriculumModules, programmeDocuments, qualifications, studyUnitModules, studyUnits } from "@/db/schema";
import { foreignCurriculum } from "./programme-documents";
import { applyMatrix, readMatrix } from "./programme-matrix";
import { applyLessons, lessonsOf, rememberKind } from "./filing-lessons";
import { bestAlignmentUnits, looksLikeAlignmentDocument, readAlignmentDocument } from "./alignment-document";
import { placeMaterial, type PlacementUnit } from "./material-placement";
import { GUIDE_KINDS, PAPER_KINDS, applyAnswer, confirmAll, pairPapers, type MapAnswer } from "./programme-map";
import { kindFromContent } from "./document-linking";
import { recordAudit } from "./audit";
import {
  classifyDocument,
  readBlueprint,
  readRegister,
  studyUnitFromName,
  type IngestionPlan,
  type PlannedDocument,
} from "./folder-plan";
import {
  shapeUpload,
  MAX_FILE_BYTES,
  type UploadedFile,
} from "./folder-upload";
import { extensionState, readJson, runExtension } from "./extensions";
import { readOfficeText } from "./office";
import { parseCurriculumText } from "./curriculum-parse";
import { qualificationWithSaqaId, readQualificationSources } from "./qualification-from-document";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { buildStorageKey, hashBytes, putObject } from "./storage";
import { libraryFilingPreview } from "./records";

/**
 * Reading an uploaded folder into a plan.
 *
 * The whole tree in one pass: the qualification, its modules with their topics
 * and criteria, the study units, and every document filed against whichever of
 * those it belongs to. What comes back is a plan, not a qualification - a
 * person reads it and commits it in one act.
 *
 * **Ordinary functionality; no AI extension needed.** A folder carrying
 * `_control/blueprint.json` is read from that file, and the manifest beside it
 * says which study unit each document belongs to and at what version. That is
 * parsing: free, instant, and incapable of inventing an assessment criterion.
 *
 * **The extension adds exactly one thing.** A folder with no blueprint has no
 * structure to read, only prose - a curriculum document as a PDF. Deriving the
 * modules and criteria from that is the part that needs a model, and the only
 * part. Somebody without an extension is told precisely that.
 *
 * The files arrive from the browser rather than being read off the server's
 * disk, so no path is ever sent and no folder has to be registered anywhere.
 * A person can offer what they can already open and nothing else.
 */

export class IngestError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "needs_extension"
      | "not_found"
      | "empty"
      | "unreadable"
      | "no_plan",
  ) {
    super(message);
    this.name = "IngestError";
  }
}

const INSTRUCTION = `Read every document in this directory. They describe a South African
occupational qualification.

Report what they say as a single JSON object of exactly this shape:

{
  "title": string,
  "saqaId": string or null,
  "curriculumCode": string or null,
  "nqfLevel": number or null,
  "credits": number or null,
  "purpose": string or null,
  "modules": [
    {
      "component": "knowledge" or "practical" or "workplace",
      "code": string,
      "title": string,
      "credits": number or null,
      "topics": [
        {
          "code": string or null,
          "title": string,
          "elements": [string],
          "criteria": [string]
        }
      ]
    }
  ],
  "studyUnits": [{ "code": string, "title": string }],
  "notes": [string]
}

Report what the documents say. Where they do not say something, leave the field
out rather than inventing a plausible value: a fabricated assessment criterion
is worse than a missing one, because somebody will be assessed against it.

Put anything you could not determine, and anything that looked wrong or
incomplete in the source, into "notes". A person reads that list before
anything is written to the platform.`;

export type IngestMode =
  /** The whole tree: the curriculum, the study units and every document. */
  | "qualification"
  /**
   * Documents only, filed against a qualification that already exists.
   *
   * Never calls a model. Classifying a document is rules and a manifest, so
   * uploading a folder of workbooks or theory guides is ordinary functionality
   * with no extension involved at any point.
   */
  | "material"
  /**
   * The curriculum and the documents, into a qualification already here.
   *
   * Roland, 15 September: part of the HRM Officer qualification was loaded
   * from the documents that existed at the time, and he wants to finish it by
   * pointing at the completed folder rather than deleting it and starting
   * again. So this reads the whole tree the way "qualification" does, but adds
   * it to the qualification named instead of creating a second one - which the
   * duplicate guard would refuse anyway, and rightly.
   *
   * What is already held is left exactly as it is, down to the wording of a
   * single criterion. Only what is missing is added.
   */
  | "top_up"
  /** Documents filed against a course that already exists. */
  | "course"
  /** Documents filed against a programme that already exists. */
  | "programme";

/**
 * Reads an uploaded folder and records what it found.
 *
 * The files are staged into storage under the job before anything else, for
 * two reasons. The commit happens in a later request and needs the bytes back.
 * And what was uploaded is the evidence of what was imported: a proposal that
 * cannot be compared with the folder it came from is a proposal nobody can
 * audit afterwards.
 */
export async function ingestUpload(
  session: AuthenticatedSession,
  incoming: { path: string; bytes: Uint8Array }[],
  mode: IngestMode = "qualification",
  folderName = "an uploaded folder",
  target: {
    qualificationId?: string;
    courseId?: string;
    learningPathId?: string;
  } = {},
) {
  assertSessionCan(session, "qualification:manage");

  const shaped = shapeUpload(incoming);
  if (shaped.files.length === 0) {
    throw new IngestError(
      "That folder has nothing that can be read.",
      "empty",
    );
  }

  const job = await withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(aiImportJobs)
      .values({
        organisationId: session.organisationId,
        sourcePath: folderName,
        files: shaped.files.map((file) => ({
          name: file.path,
          bytes: file.bytes.byteLength,
          kind: file.kind,
        })),
        status: "reading",
        target: { mode, ...target },
        requestedById: session.userId,
      })
      .returning();
    return created;
  });

  try {
    // Staged first, so the commit has the bytes and the record has the folder.
    const staged: Record<string, string> = {};
    for (const file of shaped.files) {
      if (file.kind === "skip") continue;
      const key = buildStorageKey(
        session.organisationId,
        `import/${job.id}`,
        file.path.replace(/[\\/]/g, "_"),
      );
      await putObject(key, file.bytes, "application/octet-stream");
      staged[file.path] = key;
    }

    const plan = await buildPlan(session, shaped.files, shaped.warnings, mode, folderName);
    // What this provider has corrected before, applied first (D60 stage 5).
    const learned = applyLessons(plan, await lessonsOf(session));
    if (learned > 0) {
      plan.warnings.push(`${learned} ${learned === 1 ? "file was" : "files were"} filed as you corrected similar files before.`);
    }
    await placeByContent(session, target.qualificationId ?? null, shaped.files, plan);
    return await finish(session, job.id, { status: "proposed", plan, staged });
  } catch (error) {
    return await finish(session, job.id, {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "That folder could not be read.",
    });
  }
}

async function buildPlan(
  session: AuthenticatedSession,
  files: UploadedFile[],
  uploadWarnings: string[],
  mode: IngestMode,
  folderName: string,
): Promise<IngestionPlan> {
  const warnings: string[] = [...uploadWarnings];

  // Material, a course and a programme all go against something that already
  // exists, so there is no curriculum to read and nothing for a model to do.
  // A top-up goes against something that exists too, but its whole purpose is
  // the curriculum, so it reads the folder in full.
  if (mode !== "qualification" && mode !== "top_up") {
    const gathered = documentsFor(files, warnings);
    return { ...emptyPlan(), ...gathered, warnings };
  }

  // The structured path first, always. No model, no extension, no waiting.
  let plan = readBlueprint(files);

  // Then the qualification's own documents, if the folder holds them: read by
  // the platform's readers, as adding it from its documents does. A model is
  // only the last resort, for a folder with no curriculum document in it.
  if (!plan) plan = await planFromBaseDocuments(session, files, folderName);

  if (!plan) {
    // Only here is a model needed, and only for the structure. Filing the
    // documents happens the same way either way.
    const state = await extensionState(session);
    const usable = state.on && (state.availability?.available ?? false);

    if (!usable) {
      throw new IngestError(
        state.on
          ? `This folder has no summary of itself (a _control/blueprint.json), so its structure must be worked out by an AI extension. Yours cannot run here: ${state.availability?.reason ?? "it is not available on this machine."}`
          : "This folder has no summary of itself (a _control/blueprint.json), so its structure must be worked out by an AI extension. Switch yours on at the top of the page, then read the folder again.",
        "needs_extension",
      );
    }

    plan = await planFromDocuments(session, files);
    warnings.push(
      "This folder has no blueprint.json, so the structure below was read from the documents by the AI model. Check it against the curriculum document before you commit.",
    );
  }

  const gathered = documentsFor(files, warnings);
  await warnAboutLibraryDuplicates(session, files, gathered.documents, warnings);

  return {
    ...plan,
    studyUnits:
      plan.studyUnits.length > 0 ? plan.studyUnits : gathered.studyUnits,
    documents: gathered.documents,
    warnings: [...plan.warnings, ...warnings],
  };
}

/**
 * The qualification read from the base documents in the folder, or null where
 * the folder has no curriculum document.
 *
 * Roland, 17 November 2026: uploading a folder must be "a good place to
 * start". Until then a folder without a blueprint needed an AI extension to
 * become a qualification, although the documents in it were ones the platform
 * reads itself on the "From its documents" screen; so a provider uploaded the
 * base documents, then the alignment document, then the folder, as three jobs.
 */
async function planFromBaseDocuments(session: AuthenticatedSession, files: UploadedFile[], folderName: string): Promise<IngestionPlan | null> {
  const seen = new Set<string>();
  const found: Record<"curriculum_document" | "qualification_document" | "assessment_specification", UploadedFile | null> = {
    curriculum_document: null,
    qualification_document: null,
    assessment_specification: null,
  };
  for (const file of files) {
    if (file.kind !== "convert" || !/\.(pdf|docx)$/i.test(file.filename)) continue;
    const kind = classifyDocument(file.path, file.filename, file.bytes.byteLength).kind as keyof typeof found | null;
    if (!kind || !(kind in found) || found[kind]) continue;
    const digest = hashBytes(file.bytes);
    if (seen.has(digest)) continue;
    seen.add(digest);
    found[kind] = file;
  }

  /*
   * By what they say, where the name said nothing. The QCTO's own files are
   * named every way: "SAQA 118709.pdf", "CommercialCleaner-External
   * AssessmentSpecificationsDocument.pdf" (17 November 2026). Only files the
   * names left unrecognised are opened, and only while something is missing.
   */
  const missing = () => (Object.keys(found) as (keyof typeof found)[]).filter((kind) => !found[kind]);
  if (missing().length > 0) {
    for (const file of files) {
      if (missing().length === 0) break;
      if (file.kind !== "convert" || !/\.(pdf|docx)$/i.test(file.filename)) continue;
      if (classifyDocument(file.path, file.filename, file.bytes.byteLength).kind !== "other") continue;
      if (seen.has(hashBytes(file.bytes))) continue;
      let opening = "";
      try {
        opening = (await readOfficeText(file.filename, file.bytes)).slice(0, 6000);
      } catch {
        continue;
      }
      const kind: keyof typeof found | null = /SAQA\s+QUAL(?:IFICATION)?\s+ID|Skills\s+Programme\s+ID|QCTO\s+OCCUPATIONAL\s+SKILLS\s+PROGRAMME\s+DOCUMENT/i.test(opening)
        ? "qualification_document"
        : /ASSESSMENT\s+SPECIFICATIONS?\b/i.test(opening)
          ? "assessment_specification"
          : /CURRICULUM\s+(?:DOCUMENT|SUMMARY)|Knowledge\s+Module\s+Specifications?/i.test(opening)
            ? "curriculum_document"
            : null;
      if (!kind || found[kind]) continue;
      seen.add(hashBytes(file.bytes));
      found[kind] = file;
    }
  }

  const curriculumFile = found.curriculum_document;
  if (!curriculumFile) return null;

  const source = (file: UploadedFile | null) => (file ? { filename: file.filename, bytes: file.bytes } : null);
  let reading;
  try {
    reading = await readQualificationSources(session, {
      curriculum: source(curriculumFile)!,
      qualification: source(found.qualification_document),
      assessmentSpecification: source(found.assessment_specification),
    });
  } catch (error) {
    throw new IngestError(error instanceof Error ? error.message : "The qualification's documents could not be read.", "unreadable");
  }

  const curriculum = parseCurriculumText(await readOfficeText(curriculumFile.filename, curriculumFile.bytes));
  const warnings = [...reading.notes];
  // Never an empty title: the documents' own, else the folder's name, and said.
  let title = (reading.details.title ?? curriculum.qualification.title ?? "").trim();
  if (title.length < 3) {
    title = folderName.trim();
    warnings.unshift(`No title was found in the documents, so it is named "${title}" after the folder. Change it on its page.`);
  }
  if (reading.part) {
    const taken = reading.part.modules.filter((entry) => entry.found).length;
    const missingCodes = reading.part.modules.filter((entry) => !entry.found).map((entry) => entry.code);
    warnings.unshift(
      `A part qualification of "${reading.part.parent.title}", taking ${taken} of its modules. It uses that qualification's curriculum, so no modules are listed below.${missingCodes.length ? ` Not found in it: ${missingCodes.join(", ")}.` : ""}`,
    );
  }
  const sameId = reading.part ? null : await qualificationWithSaqaId(session, reading.details.saqaId);
  if (sameId) {
    warnings.unshift(
      `"${sameId.title}" is already on the platform with the ID ${reading.details.saqaId}, so committing will create nothing. To add this material to it, open it and upload the folder there; to replace it, remove it first.`,
    );
  } else if (reading.existing && !reading.part) {
    warnings.unshift(
      `"${reading.existing.title}" already has the curriculum code ${reading.details.curriculumCode}. Open it and upload this folder there to add the material to it.`,
    );
  }

  return {
    source: "readers",
    baseDocuments: {
      curriculum: curriculumFile.path,
      qualification: found.qualification_document?.path ?? null,
      assessmentSpecification: found.assessment_specification?.path ?? null,
    },
    qualification: {
      title,
      saqaId: reading.details.saqaId,
      curriculumCode: reading.details.curriculumCode,
      nqfLevel: reading.details.nqfLevel,
      credits: reading.details.totalCredits,
      purpose: reading.skillsProgramme?.purpose ?? null,
    },
    // Shown for checking; the commit writes the curriculum from the document
    // itself, so a part qualification lists the modules it takes and none of
    // its own.
    modules: reading.part
      ? []
      : curriculum.modules.map((entry) => ({
          component: entry.component,
          code: entry.code,
          title: entry.title,
          credits: entry.credits ?? null,
          topics: entry.topics.map((topic) => ({
            code: topic.code,
            title: topic.title,
            elements: topic.elements.map((element) => element.description),
            criteria: topic.criteria.map((criterion) => criterion.description),
          })),
        })),
    studyUnits: [],
    documents: [],
    warnings,
  };
}

/**
 * The study units, with the modules and topics each takes: from an alignment
 * document in the folder if there is one, otherwise from the qualification
 * and the alignment document already filed against it.
 */
async function placementUnits(
  session: AuthenticatedSession,
  qualificationId: string | null,
  files: UploadedFile[],
): Promise<PlacementUnit[]> {
  /*
   * Of the alignment documents in the folder, the one that says most: the
   * most papers listed, then the most units. SP-260508 carries two, and the
   * first by name was not the one with the units' papers in it.
   */
  let best: PlacementUnit[] | null = null;
  const score = (units: PlacementUnit[]) => units.reduce((sum, unit) => sum + (unit.papers?.length ?? 0), 0) * 100 + units.length;
  for (const file of files) {
    if (file.kind !== "convert" || !/align/i.test(file.filename)) continue;
    try {
      const text = await readOfficeText(file.filename, file.bytes);
      if (!looksLikeAlignmentDocument(text)) continue;
      const units = readAlignmentDocument(text).studyUnits.map((unit) => ({ code: unit.code, moduleCodes: unit.moduleCodes, topics: unit.topics, papers: unit.papers }));
      if (units.length > 0 && (!best || score(units) > score(best))) best = units;
    } catch {
      /* not one after all; try the next */
    }
  }
  if (best) return best;
  if (!qualificationId) return [];

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({ code: studyUnits.code, module: curriculumModules.code })
      .from(studyUnits)
      .leftJoin(studyUnitModules, eq(studyUnitModules.studyUnitId, studyUnits.id))
      .leftJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    const units: PlacementUnit[] = [];
    for (const row of rows) {
      let unit = units.find((one) => one.code === row.code);
      if (!unit) units.push((unit = { code: row.code, moduleCodes: [], topics: {} }));
      const code = row.module?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code && !unit.moduleCodes.includes(code)) unit.moduleCodes.push(code);
    }
    // The topics are not stored; the alignment document filed against the
    // qualification still says them.
    const filed = await tx
      .select({ text: programmeDocuments.extractedText })
      .from(programmeDocuments)
      .where(and(eq(programmeDocuments.qualificationId, qualificationId), eq(programmeDocuments.kind, "alignment_matrix")))
      .orderBy(desc(programmeDocuments.createdAt));
    for (const read of bestAlignmentUnits(filed.map((one) => one.text))) {
      const unit = units.find((one) => one.code === read.code);
      if (unit) {
        unit.topics = read.topics;
        unit.papers = read.papers;
      }
    }
    return units;
  });
}

/**
 * Places material its name does not place, by the modules and topics it
 * covers. See lib/material-placement.ts.
 */
async function placeByContent(
  session: AuthenticatedSession,
  qualificationId: string | null,
  files: UploadedFile[],
  plan: IngestionPlan,
): Promise<void> {
  /*
   * What a file is, read from its content where its name said nothing
   * (Roland, 18 November 2026: read the documents, starting with the file
   * names). Only a guide, a workbook or a summative, the kinds the build
   * depends on, and only where the text plainly says so.
   */
  const fileAt = new Map(files.map((file) => [file.path, file]));
  for (const document of plan.documents) {
    if (document.kind !== "other" || document.target === "library") continue;
    const file = fileAt.get(document.path);
    if (file?.kind !== "convert") continue;
    try {
      const kind = kindFromContent(await readOfficeText(file.filename, file.bytes));
      if (!kind) continue;
      document.kind = kind;
      document.because = `${document.because} Its content reads as ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind.replace(/_/g, " ")}, so it is filed as one.`;
    } catch {
      /* unreadable: it stays as it was */
    }
  }

  // Each file's text, read once and kept for pairing papers with guides.
  const texts = new Map<string, string | null>();
  const fileAt2 = new Map(files.map((file) => [file.path, file]));
  const textOf = async (path: string) => {
    if (texts.has(path)) return texts.get(path) ?? null;
    const file = fileAt2.get(path);
    let text: string | null = null;
    if (file?.kind === "convert") {
      try {
        text = await readOfficeText(file.filename, file.bytes);
      } catch {
        text = null;
      }
    }
    texts.set(path, text);
    return text;
  };

  const waiting = plan.documents.filter((document) => !document.studyUnitCode && document.target !== "library");
  const inFolders = plan.documents.filter((document) => document.source === "folder");
  const units = waiting.length > 0 || inFolders.length > 0 ? await placementUnits(session, qualificationId, files) : [];
  await placeWaiting(waiting, units, plan, textOf);

  /*
   * A file in a folder named for a unit keeps that unit (D60 stage 2). Where
   * the alignment document says otherwise it is said on the map, not
   * overruled; where the alignment lists it for earlier units as well, those
   * are recorded as the units it also covers.
   */
  for (const document of inFolders) {
    if (units.length === 0) break;
    const placed = placeMaterial(units, { filename: document.filename, kind: document.kind, text: await textOf(document.path) });
    if (!placed) continue;
    const at = placed.covers.indexOf(document.studyUnitCode!);
    if (at === -1) {
      document.conflict = `Its folder says ${document.studyUnitCode}; ${placed.source === "alignment" ? "the alignment document lists it for" : "what it covers points to"} ${placed.covers.join(", ")}.`;
    } else if (at > 0) {
      document.also = placed.covers.slice(0, at);
    }
  }

  /*
   * A matrix or schedule that maps another programme's curriculum, asked
   * about on the map rather than only refused at the commit (D60 stage 2).
   */
  const ownCode =
    plan.qualification.curriculumCode ??
    (qualificationId
      ? ((await withTenant(session.organisationId, (tx) =>
          tx.select({ code: qualifications.curriculumCode }).from(qualifications).where(eq(qualifications.id, qualificationId)),
        ))[0]?.code ?? null)
      : null);
  for (const document of plan.documents) {
    if (document.kind !== "alignment_matrix" && document.kind !== "rollout_schedule") continue;
    document.foreign = foreignCurriculum((await textOf(document.path)) ?? "", ownCode);
  }

  /*
   * Every workbook and summative given its guide now, while the files are in
   * hand, so "Check the map" can show the pairs and ask about the rest (D60).
   */
  const unpaired = plan.documents.filter((document) => PAPER_KINDS.has(document.kind ?? "") || GUIDE_KINDS.has(document.kind ?? ""));
  for (const document of unpaired) await textOf(document.path);
  pairPapers(plan, texts);

  /*
   * A filled-in programme map in the folder (D60 stage 3) is read last, so it
   * wins over everything the readers worked out. The matrix itself is read,
   * not filed.
   */
  for (const file of files) {
    if (!/\.xlsx$/i.test(file.filename)) continue;
    const rows = readMatrix(file.bytes);
    if (rows === null) continue;
    const notes = applyMatrix(plan, rows, file.path, units.map((unit) => unit.code));
    const own = plan.documents.find((document) => document.path === file.path);
    if (own) {
      own.ignored = true;
      own.confirmed = true;
      own.because = "The programme map: read, not filed.";
    }
    plan.warnings.push(`The folder's programme map (${file.filename}) was read: ${rows.length} ${rows.length === 1 ? "file" : "files"} placed by it.`, ...notes);
    break;
  }
}

async function placeWaiting(
  waiting: IngestionPlan["documents"],
  units: PlacementUnit[],
  plan: IngestionPlan,
  textOf: (path: string) => Promise<string | null>,
): Promise<void> {
  if (waiting.length === 0 || units.length === 0) return;

  let placed = 0;
  let toCheck = 0;
  for (const document of waiting) {
    const text = await textOf(document.path);
    const placement = placeMaterial(units, { filename: document.filename, kind: document.kind, text });
    if (!placement) continue;
    document.studyUnitCode = placement.studyUnitCode;
    document.target = "study_unit";
    document.because = `${document.because} ${placement.because}`;
    // For "Check the map" (D60): what settled it, and the earlier units it also covers.
    document.source = placement.source ?? "content";
    document.also = placement.covers.filter((code) => code !== placement.studyUnitCode);
    placed += 1;
    if (placement.covers.length > 1) toCheck += 1;
    if (!plan.studyUnits.some((unit) => unit.code === placement.studyUnitCode)) {
      plan.studyUnits.push({ code: placement.studyUnitCode, title: placement.studyUnitCode });
    }
  }
  if (placed > 0) {
    plan.warnings.push(
      `${placed} ${placed === 1 ? "document was" : "documents were"} placed in a study unit by the modules and topics ${placed === 1 ? "it covers" : "they cover"}, read against the alignment document.${toCheck > 0 ? ` ${toCheck} of them ${toCheck === 1 ? "covers" : "cover"} more than one study unit and ${toCheck === 1 ? "was" : "were"} placed in the last; check ${toCheck === 1 ? "it" : "them"} below.` : ""}`,
    );
  }
}

/**
 * Says what the library already holds, before anything is committed.
 *
 * Roland, 22 September: every QMS policy was filed four times over. "The QMS
 * policy shouldn't file 4 times without overwriting with a warning and
 * decision." The commit no longer duplicates them, which is the defect; this
 * is the warning, on the screen that already waits for a person.
 *
 * Re-importing a folder is an ordinary thing to do - a document is added, the
 * curriculum is corrected, the whole folder goes back in - so "you already
 * have all nine of these" is the normal answer rather than an error.
 */
async function warnAboutLibraryDuplicates(
  session: AuthenticatedSession,
  files: UploadedFile[],
  documents: PlannedDocument[],
  warnings: string[],
): Promise<void> {
  const bytesByPath = new Map(files.map((file) => [file.path, file.bytes]));

  const incoming = documents
    .filter((document) => document.target === "library")
    .flatMap((document) => {
      const bytes = bytesByPath.get(document.path);
      if (!bytes) return [];
      return [
        {
          title: document.title,
          category: document.category ?? "other",
          contentHash: hashBytes(bytes),
        },
      ];
    });

  const { alreadyHeld, willReplace } = await libraryFilingPreview(
    session,
    incoming,
  );

  if (alreadyHeld.length > 0) {
    warnings.push(
      `${alreadyHeld.length} of these documents ${alreadyHeld.length === 1 ? "is" : "are"} already in the library, byte for byte, so ${alreadyHeld.length === 1 ? "it" : "they"} will not be filed again: ${alreadyHeld.slice(0, 6).join(", ")}${alreadyHeld.length > 6 ? `, and ${alreadyHeld.length - 6} more` : ""}.`,
    );
  }

  if (willReplace.length > 0) {
    warnings.push(
      `${willReplace.length} ${willReplace.length === 1 ? "document has" : "documents have"} changed since the version the library holds and will become the current one, with the version held kept as superseded: ${willReplace.slice(0, 6).join(", ")}${willReplace.length > 6 ? `, and ${willReplace.length - 6} more` : ""}.`,
    );
  }
}

/** A plan with no qualification in it, for a material-only import. */
function emptyPlan(): IngestionPlan {
  return {
    // Not "blueprint". Nothing was read to produce this and nothing is meant
    // to be: a material import files documents by name and leaves the
    // curriculum alone.
    source: "filing",
    qualification: {
      title: "",
      saqaId: null,
      curriculumCode: null,
      nqfLevel: null,
      credits: null,
      purpose: null,
    },
    modules: [],
    studyUnits: [],
    documents: [],
    warnings: [],
  };
}

/**
 * The documents in a folder, and the study units they imply.
 *
 * Shared by both modes because filing a document is the same job whether it
 * arrived with a curriculum or on its own. Rules and a manifest throughout: no
 * model is asked anything here, in either mode.
 */
function documentsFor(
  files: UploadedFile[],
  warnings: string[],
): {
  documents: PlannedDocument[];
  studyUnits: { code: string; title: string }[];
} {
  const register = readRegister(files);

  const documents: PlannedDocument[] = [];
  for (const file of files) {
    if (file.kind === "skip") continue;
    // The blueprint and the manifest describe the folder; filing them as
    // programme documents would put build machinery in front of a learner.
    if (file.path.startsWith("_control/")) continue;
    // A blueprint kept elsewhere in the folder ("121151-blueprint.json") is
    // the same machinery, and the upload refuses JSON as a document anyway.
    if (/blueprint\.json$/i.test(file.filename)) continue;
    if (file.bytes.byteLength > MAX_FILE_BYTES) continue;

    const planned = classifyDocument(
      file.path,
      file.filename,
      file.bytes.byteLength,
    );
    const manifest = register.get(file.path);

    if (manifest) {
      // The manifest is authoritative about the study unit and the version.
      if (manifest.studyUnit) {
        planned.studyUnitCode = manifest.studyUnit;
        planned.target = planned.target === "library" ? "library" : "study_unit";
      }
      if (manifest.title) planned.title = manifest.title;
      planned.version = manifest.version;
      planned.because = `${planned.because} The folder's own manifest names it${manifest.studyUnit ? ` under ${manifest.studyUnit}` : ""}${manifest.version ? ` at version ${manifest.version}` : ""}.`;
    }

    documents.push(planned);
  }

  // A theory guide for SU1 implies SU1 exists even where nothing else says so.
  const unitCodes = new Set<string>();
  for (const document of documents) {
    if (document.studyUnitCode) unitCodes.add(document.studyUnitCode);
  }
  for (const file of files) {
    const code = studyUnitFromName(file.filename);
    if (code) unitCodes.add(code);
  }

  const unrecognised = documents.filter((row) => row.kind === "other").length;
  if (unrecognised > 0) {
    warnings.push(
      `${unrecognised} ${unrecognised === 1 ? "document was" : "documents were"} not recognised by name and will be filed as "other". They are listed below with the reasoning, and can be re-filed afterwards.`,
    );
  }

  return {
    documents,
    studyUnits: [...unitCodes]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((code) => ({ code, title: code })),
  };
}

/**
 * The fallback: a model reads the documents.
 *
 * Written into a workspace and read as files, because asking for JSON on stdin
 * gets prose - this appends to Claude Code's own system prompt rather than
 * replacing it, and the coding-assistant framing wins that argument every time.
 */
async function planFromDocuments(
  session: AuthenticatedSession,
  files: UploadedFile[],
): Promise<IngestionPlan> {
  const workdir = await mkdtemp(join(tmpdir(), "lms-ingest-"));
  let staged = 0;

  try {
    for (const file of files) {
      if (file.kind !== "text" && file.kind !== "convert") continue;
      if (file.path.startsWith("_control/")) continue;

      // Only the documents that describe the qualification. A folder of sixty
      // policies and workbooks would bury the curriculum document in material
      // the model does not need to read to answer the question.
      if (
        !/qualification|curriculum|assessment specification|blueprint/i.test(
          file.path,
        )
      ) {
        continue;
      }

      const flat = file.path.replace(/[\\/]/g, "_");
      try {
        if (file.kind === "text") {
          await writeFile(
            join(workdir, flat),
            Buffer.from(file.bytes),
          );
        } else {
          const text = await readOfficeText(file.filename, file.bytes);
          if (text.trim().length === 0) continue;
          await writeFile(join(workdir, `${flat}.txt`), text, "utf8");
        }
        staged += 1;
      } catch {
        /* listed as unread in the plan rather than stopping the run */
      }
    }

    if (staged === 0) {
      throw new IngestError(
        "Nothing in that folder describes a qualification. Include a curriculum document, a qualification document or an assessment specification.",
        "unreadable",
      );
    }

    const result = await runExtension(session, {
      task: "ingest_qualification",
      prompt: INSTRUCTION,
      workdir,
      /*
       * Where to put the answer, if this provider can put it anywhere but its
       * reply. The registry adds the right sentence: Claude Code is told to
       * write the file, Gemini and OpenAI are told to reply with the object.
       *
       * This used to be written into INSTRUCTION, which made the prompt right
       * for Claude Code and useless for every other provider - "the file is
       * the answer" given to an HTTP call asks it to return nothing. So the
       * one route Gemini was added for, folder import on the server, would
       * have failed on the first attempt.
       */
      answerFile: "proposal.json",
      timeoutMs: 900_000,
    });

    if (!result.ok) {
      throw new IngestError(
        result.error ?? "The extension did not answer.",
        "no_plan",
      );
    }

    let raw: Record<string, unknown> | null = null;
    try {
      const { readFile } = await import("node:fs/promises");
      raw = readJson(await readFile(join(workdir, "proposal.json"), "utf8"));
    } catch {
      raw = readJson(result.text ?? "");
    }

    if (!raw) {
      throw new IngestError(
        "The extension returned nothing that could be read as a plan.",
        "no_plan",
      );
    }

    return {
      source: "documents",
      qualification: {
        title: String(raw.title ?? ""),
        saqaId: raw.saqaId ? String(raw.saqaId) : null,
        curriculumCode: raw.curriculumCode ? String(raw.curriculumCode) : null,
        nqfLevel: typeof raw.nqfLevel === "number" ? raw.nqfLevel : null,
        credits: typeof raw.credits === "number" ? raw.credits : null,
        purpose: raw.purpose ? String(raw.purpose) : null,
      },
      modules: (Array.isArray(raw.modules) ? raw.modules : []) as never,
      studyUnits: (Array.isArray(raw.studyUnits) ? raw.studyUnits : []) as never,
      documents: [],
      warnings: (Array.isArray(raw.notes) ? raw.notes : []).map(String),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function finish(
  session: AuthenticatedSession,
  jobId: string,
  input: {
    status: "proposed" | "failed";
    plan?: IngestionPlan;
    staged?: Record<string, string>;
    error?: string;
  },
) {
  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(aiImportJobs)
      .set({
        status: input.status,
        proposal: input.plan ?? null,
        problems: input.plan?.warnings ?? [],
        stagedFiles: input.staged ?? {},
        error: input.error ?? null,
      })
      .where(eq(aiImportJobs.id, jobId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "folder.read",
      entityType: "ai_import_job",
      entityId: jobId,
      after: {
        status: updated.status,
        source: input.plan?.source ?? null,
        modules: input.plan?.modules.length ?? 0,
        documents: input.plan?.documents.length ?? 0,
        warnings: input.plan?.warnings.length ?? 0,
      },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

export async function listIngestJobs(session: AuthenticatedSession) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select()
      .from(aiImportJobs)
      .orderBy(desc(aiImportJobs.requestedAt))
      .limit(25),
  );
}

export async function getIngestJob(
  session: AuthenticatedSession,
  jobId: string,
) {
  assertSessionCan(session, "qualification:manage");

  const [job] = await withTenant(session.organisationId, (tx) =>
    tx.select().from(aiImportJobs).where(eq(aiImportJobs.id, jobId)),
  );

  if (!job) throw new IngestError("That import was not found.", "not_found");
  return job;
}

/**
 * An answer on "Check the map", saved on the plan waiting to be committed
 * (D60). "all" ticks everything worth a look. Only while it is waiting: a
 * committed plan is history.
 */
export async function answerMap(
  session: AuthenticatedSession,
  jobId: string,
  answer: MapAnswer | "all",
): Promise<void> {
  assertSessionCan(session, "qualification:manage");
  const job = await getIngestJob(session, jobId);
  const plan = job.proposal as IngestionPlan | null;
  if (!plan || job.status !== "proposed") throw new IngestError("That import is no longer waiting to be committed.", "no_plan");
  if (answer === "all") confirmAll(plan);
  else applyAnswer(plan, answer);
  // A correction to what a file is, remembered for this provider (stage 5).
  if (answer !== "all" && answer.field === "kind") {
    const document = plan.documents.find((one) => one.path === answer.path);
    if (document) await rememberKind(session, document.filename, answer.value);
  }
  await withTenant(session.organisationId, (tx) => tx.update(aiImportJobs).set({ proposal: plan }).where(eq(aiImportJobs.id, jobId)));
}

export async function discardIngest(
  session: AuthenticatedSession,
  jobId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(aiImportJobs)
      .set({ status: "discarded" })
      .where(eq(aiImportJobs.id, jobId))
      .returning();

    if (!updated) throw new IngestError("That import was not found.", "not_found");
    return updated;
  });
}
