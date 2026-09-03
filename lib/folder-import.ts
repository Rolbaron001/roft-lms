import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { isAllowedRoot, walkFolder, type FoundFile } from "./folder-walk";
import { extensionState, readJson, runExtension } from "./extensions";
import { readDocxText, readPdfText } from "./office";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Reading a folder into a plan.
 *
 * The whole tree, in one pass: the qualification, its modules with their topics
 * and criteria, the study units, and every document filed against whichever of
 * those it belongs to. What comes back is a plan, not a qualification - a
 * person reads it and commits it in one act.
 *
 * **This is ordinary functionality and needs no AI extension.** A folder that
 * carries `_control/blueprint.json` is read from that file directly, and the
 * manifest beside it says which study unit each document belongs to and at what
 * version. That is file reading and pattern matching: free, instant, and
 * incapable of inventing an assessment criterion. Every user who can manage a
 * qualification can do it, on any machine, including the server.
 *
 * **The extension adds exactly one thing.** A folder with no blueprint has no
 * structure to read, only prose - a curriculum document as a PDF. Deriving the
 * modules, topics and criteria from that is the part that needs a model, and it
 * is the only part. Somebody without an extension gets told precisely that,
 * rather than being turned away from the whole feature.
 *
 * Getting this the wrong way round is a mistake worth naming: the first version
 * gated the lot behind the extension, which made a deterministic file read
 * unavailable to anybody who had not signed in to a model somewhere.
 */

export class IngestError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "needs_extension"
      | "not_allowed"
      | "not_found"
      | "empty"
      | "unreadable"
      | "no_plan",
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/** A single document larger than this is not a curriculum document. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

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

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function ingestFolder(
  session: AuthenticatedSession,
  path: string,
) {
  assertSessionCan(session, "qualification:manage");

  // The allow-list is a control on the platform reading the disk at all, not an
  // AI setting. It applies whether or not a model is ever involved: a server
  // process given a free path can read anything it can reach.
  const state = await extensionState(session);

  if (!isAllowedRoot(path, state.allowedImportRoots)) {
    throw new IngestError(
      state.allowedImportRoots.length === 0
        ? "No import folders have been allowed for this tenant. An administrator lists them in Settings: a server process given a free path can read anything it can reach."
        : `That folder is outside the ones allowed for this tenant. Allowed: ${state.allowedImportRoots.join(", ")}.`,
      "not_allowed",
    );
  }

  const files = await walkFolder(path);
  if (files.length === 0) {
    throw new IngestError(
      `Nothing was found at ${path}. Check the folder exists on the machine running the platform - not on yours, if those differ.`,
      "empty",
    );
  }

  const job = await withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(aiImportJobs)
      .values({
        organisationId: session.organisationId,
        sourcePath: path,
        files: files.map((file) => ({
          name: file.path,
          bytes: file.bytes,
          kind: file.kind,
        })),
        status: "reading",
        requestedById: session.userId,
      })
      .returning();
    return created;
  });

  try {
    const plan = await buildPlan(session, path, files);
    return await finish(session, job.id, { status: "proposed", plan });
  } catch (error) {
    return await finish(session, job.id, {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "The folder could not be read.",
    });
  }
}

async function buildPlan(
  session: AuthenticatedSession,
  path: string,
  files: FoundFile[],
): Promise<IngestionPlan> {
  const warnings: string[] = [];

  // The structured path first, always. No model, no extension, no waiting.
  let plan = await readBlueprint(path);

  if (!plan) {
    // Only here is a model needed, and only for the structure. Everything
    // below this point - filing the documents, identifying the study units -
    // happens the same way either way.
    const state = await extensionState(session);
    const usable = state.enabled && (state.availability?.available ?? false);

    if (!usable) {
      throw new IngestError(
        state.enabled
          ? `This folder has no _control/blueprint.json, so its structure has to be read out of the documents - and that is the one part that needs an AI extension. Yours is switched on but cannot run here: ${state.availability?.reason ?? "it is not available on this machine."} Everything else about importing a folder works without it.`
          : "This folder has no _control/blueprint.json, so its structure has to be read out of the documents - and that is the one part that needs an AI extension, which you have not switched on. A folder that carries a blueprint imports with no extension at all.",
        "needs_extension",
      );
    }

    plan = await planFromDocuments(session, path, files);
    warnings.push(
      "This folder had no blueprint.json, so the structure below was read from the documents by the model. Check it against the curriculum document before committing: a model will produce something plausible from a document that says nothing of the kind.",
    );
  }

  const register = await readRegister(path);

  // Every file becomes a planned document, except the ones that are structure
  // rather than content. The blueprint and the manifest describe the folder;
  // filing them as programme documents would put build machinery in front of a
  // learner.
  const documents: PlannedDocument[] = [];
  for (const file of files) {
    if (file.kind === "skip") continue;
    if (file.path.startsWith("_control/")) continue;
    if (file.bytes > MAX_FILE_BYTES) {
      warnings.push(
        `${file.path} was left out: larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      );
      continue;
    }

    const planned = classifyDocument(file.path, file.filename, file.bytes);
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

  // Study units, from whatever named one. A theory guide for SU1 implies SU1
  // exists even where nothing else says so.
  const unitCodes = new Set<string>();
  for (const document of documents) {
    if (document.studyUnitCode) unitCodes.add(document.studyUnitCode);
  }
  for (const file of files) {
    const code = studyUnitFromName(file.filename);
    if (code) unitCodes.add(code);
  }

  const studyUnits = [...unitCodes]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((code) => ({ code, title: code }));

  const unrecognised = documents.filter((row) => row.kind === "other").length;
  if (unrecognised > 0) {
    warnings.push(
      `${unrecognised} ${unrecognised === 1 ? "document was" : "documents were"} not recognised by name and will be filed as "other" against the qualification. They are listed below with the reasoning, and can be re-filed afterwards.`,
    );
  }

  return {
    ...plan,
    studyUnits: plan.studyUnits.length > 0 ? plan.studyUnits : studyUnits,
    documents,
    warnings: [...plan.warnings, ...warnings],
  };
}

/**
 * The fallback: a model reads the documents.
 *
 * Staged into a workspace and read as files, because asking for JSON on stdin
 * gets prose - this appends to Claude Code's own system prompt rather than
 * replacing it, and the coding-assistant framing wins that argument every time.
 */
async function planFromDocuments(
  session: AuthenticatedSession,
  path: string,
  files: FoundFile[],
): Promise<IngestionPlan> {
  const workdir = await mkdtemp(join(tmpdir(), "lms-ingest-"));
  let staged = 0;

  try {
    for (const file of files) {
      if (file.kind !== "text" && file.kind !== "convert") continue;
      if (file.bytes > MAX_FILE_BYTES) continue;
      if (file.path.startsWith("_control/")) continue;

      // Only the documents that describe the qualification. A folder of
      // sixty policies and workbooks would bury the curriculum document in
      // material the model does not need to read to answer the question.
      if (!/qualification|curriculum|assessment specification|blueprint/i.test(file.path)) {
        continue;
      }

      const flat = file.path.replace(/[\\/]/g, "_");
      try {
        if (file.kind === "text") {
          await copyFile(join(path, file.path), join(workdir, flat));
        } else {
          const bytes = new Uint8Array(await readFile(join(path, file.path)));
          const text = file.filename.toLowerCase().endsWith(".pdf")
            ? (await readPdfText(bytes)).text
            : readDocxText(bytes);
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
        error: input.error ?? null,
      })
      .where(eq(aiImportJobs.id, jobId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "ai.folder_read",
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
