import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiImportJobs } from "@/db/schema";
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
import { readDocxText, readPdfText } from "./office";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { buildStorageKey, putObject } from "./storage";

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

Write what they say to a file called proposal.json in this directory. Write
nothing else, and do not summarise your findings in your reply - the file is
the answer.

proposal.json must contain exactly this shape:

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
      "That folder had nothing in it the platform could read.",
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

    const plan = await buildPlan(session, shaped.files, shaped.warnings, mode);
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
): Promise<IngestionPlan> {
  const warnings: string[] = [...uploadWarnings];

  // Material, a course and a programme all go against something that already
  // exists, so there is no curriculum to read and nothing for a model to do.
  if (mode !== "qualification") {
    const gathered = documentsFor(files, warnings);
    return { ...emptyPlan(), ...gathered, warnings };
  }

  // The structured path first, always. No model, no extension, no waiting.
  let plan = readBlueprint(files);

  if (!plan) {
    // Only here is a model needed, and only for the structure. Filing the
    // documents happens the same way either way.
    const state = await extensionState(session);
    const usable = state.on && (state.availability?.available ?? false);

    if (!usable) {
      throw new IngestError(
        state.on
          ? `This folder does not include a summary of itself (a _control/blueprint.json), so its structure has to be worked out from the documents - and that is the one part that needs an AI extension. Yours is switched on but cannot run here: ${state.availability?.reason ?? "it is not available on this machine."} Everything else about importing a folder works without it.`
          : "This folder does not include a summary of itself (a _control/blueprint.json, which your programme development system writes), so its structure has to be worked out from the documents - and that is the one part that needs an AI extension. Yours is not switched on: use the AI switch at the top of the page, then read the folder again. A folder that includes a summary imports with no extension at all.",
        "needs_extension",
      );
    }

    plan = await planFromDocuments(session, files);
    warnings.push(
      "This folder had no blueprint.json, so the structure below was read from the documents by the model. Check it against the curriculum document before committing: a model will produce something plausible from a document that says nothing of the kind.",
    );
  }

  const gathered = documentsFor(files, warnings);

  return {
    ...plan,
    studyUnits:
      plan.studyUnits.length > 0 ? plan.studyUnits : gathered.studyUnits,
    documents: gathered.documents,
    warnings: [...plan.warnings, ...warnings],
  };
}

/** A plan with no qualification in it, for a material-only import. */
function emptyPlan(): IngestionPlan {
  return {
    source: "blueprint",
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
          const text = file.filename.toLowerCase().endsWith(".pdf")
            ? (await readPdfText(file.bytes)).text
            : readDocxText(file.bytes);
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
        "Nothing in that folder describes a qualification. Expected a curriculum document, a qualification document or an assessment specification.",
        "unreadable",
      );
    }

    const result = await runExtension(session, {
      task: "ingest_qualification",
      prompt: INSTRUCTION,
      workdir,
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
        "The extension ran but wrote nothing that could be read as a plan.",
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
