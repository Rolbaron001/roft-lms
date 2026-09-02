import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiImportJobs } from "@/db/schema";
import { recordAudit } from "./audit";
import { extensionState, readJson, runExtension } from "./extensions";
import { readDocxText, readPdfText } from "./office";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Pointing the extension at a folder.
 *
 * The thing that was asked for: a folder of documents goes in, a qualification
 * with its modules, topics and criteria comes out. What actually happens is
 * that a proposal comes out, and a person commits it - through the same
 * authoring functions the hand editor uses, one module at a time.
 *
 * That is not caution for its own sake. A qualification is an accredited
 * structure an external verifier reads against the source document, and a
 * curriculum nobody has checked against the document it came from is exactly
 * what this platform exists to prevent. It makes no difference whether a
 * person typed it or a model did; if anything the model makes checking more
 * necessary, because it will produce something plausible from a document that
 * says nothing of the kind.
 *
 * So: the model reads, and proposes. It never writes a qualification.
 */

export class ImportError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_enabled"
      | "not_allowed"
      | "not_found"
      | "empty"
      | "too_large"
      | "unreadable"
      | "no_proposal",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** A single document larger than this is not a curriculum document. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Read straight through as text. */
const READABLE = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html"]);
/**
 * Converted to text first, using the extractors the platform already has for
 * uploaded documents.
 *
 * This matters more than it looks. A real qualification folder is PDFs and
 * Word files - the curriculum document, the assessment specification, the
 * qualification document - and an import that could only read .txt would have
 * been an import that could not read anything anybody actually has.
 */
const CONVERTIBLE = new Set([".pdf", ".docx"]);
/** Recognised and not read: no extractor, or nothing useful in it. */
const KNOWN_BINARY = new Set([".doc", ".xlsx", ".pptx", ".ppt"]);

export type ImportFile = { name: string; bytes: number; kind: string };

/**
 * Whether a folder is one this tenant has said may be read.
 *
 * An allow-list rather than a free path. "Point it at a folder", given to a
 * server process, otherwise means "read any file the service account can
 * reach" - which on the production server includes the platform's own
 * configuration. The check is on the resolved path so that a `..` cannot climb
 * out of an allowed root.
 */
export function isAllowedRoot(candidate: string, roots: string[]): boolean {
  if (roots.length === 0) return false;

  const target = resolve(candidate);
  return roots.some((root) => {
    const allowed = resolve(root);
    return target === allowed || target.startsWith(allowed + sep);
  });
}

/** What is in the folder, without reading any of it. */
export async function surveyFolder(path: string): Promise<ImportFile[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    throw new ImportError(
      `Nothing could be read at ${path}. Check the folder exists on the machine running the platform - not on yours, if those are different.`,
      "not_found",
    );
  }

  const files: ImportFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const info = await stat(join(path, entry.name));

    files.push({
      name: entry.name,
      bytes: info.size,
      kind: READABLE.has(extension)
        ? "text"
        : CONVERTIBLE.has(extension)
          ? "convert"
          : KNOWN_BINARY.has(extension)
            ? "needs-conversion"
            : "skipped",
    });
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
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
  "notes": [string]
}

Report what the documents say. Where they do not say something, leave the field
out rather than inventing a plausible value: a fabricated assessment criterion
is worse than a missing one, because somebody will be assessed against it.

Put anything you could not determine, and anything that looked wrong or
incomplete in the source, into "notes". A person reads that list before
anything is written to the platform.`;

export type ImportProposal = {
  title?: string;
  saqaId?: string | null;
  nqfLevel?: number | null;
  credits?: number | null;
  purpose?: string | null;
  modules?: {
    component?: string;
    code?: string;
    title?: string;
    credits?: number | null;
    topics?: {
      code?: string | null;
      title?: string;
      elements?: string[];
      criteria?: string[];
    }[];
  }[];
  notes?: string[];
};

/**
 * Reads a folder and asks the extension what qualification it describes.
 *
 * Everything is recorded: the folder, what was found in it, what was sent for
 * conversion rather than read, and the proposal exactly as it came back. A
 * proposal quietly normalised on the way in cannot be compared with what
 * somebody approved.
 */
export async function importFromFolder(
  session: AuthenticatedSession,
  path: string,
) {
  assertSessionCan(session, "qualification:manage");

  const state = await extensionState(session);
  if (!state.enabled) {
    throw new ImportError(
      "No AI extension is switched on for this tenant. Turn one on in Settings first.",
      "not_enabled",
    );
  }

  if (!isAllowedRoot(path, state.allowedImportRoots)) {
    throw new ImportError(
      state.allowedImportRoots.length === 0
        ? "No import folders have been allowed for this tenant. Add one in Settings: a server process given a free path can read anything it can reach, so the folders it may read are listed rather than typed each time."
        : `That folder is outside the ones allowed for this tenant. Allowed: ${state.allowedImportRoots.join(", ")}.`,
      "not_allowed",
    );
  }

  const files = await surveyFolder(path);
  if (files.length === 0) {
    throw new ImportError("That folder has no files in it.", "empty");
  }

  const job = await withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(aiImportJobs)
      .values({
        organisationId: session.organisationId,
        sourcePath: path,
        files,
        status: "reading",
        requestedById: session.userId,
      })
      .returning();
    return created;
  });

  const problems: string[] = [];

  // The documents are copied into a workspace and the model is asked to read
  // them as files and write its answer as a file. Sending the text on stdin and
  // asking for JSON back does not work: Claude Code's own system prompt is
  // appended to rather than replaced, so it answers conversationally and
  // returned a markdown table on the first attempt. Given a directory it does
  // what it is built to do.
  const workdir = await mkdtemp(join(tmpdir(), "lms-import-"));
  let staged = 0;

  try {
    for (const file of files) {
      if (file.kind === "needs-conversion") {
        problems.push(
          `${file.name} was not read: there is no extractor for that format.`,
        );
        continue;
      }
      if (file.kind === "skipped") {
        problems.push(`${file.name} was not read: not a document.`);
        continue;
      }
      if (file.bytes > MAX_FILE_BYTES) {
        problems.push(
          `${file.name} was not read: larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
        );
        continue;
      }

      try {
        if (file.kind === "text") {
          await copyFile(join(path, file.name), join(workdir, file.name));
        } else {
          // Converted here rather than handed over as a binary, so the model
          // reads exactly the text the rest of the platform would read from
          // the same document. One extractor, one answer.
          const bytes = new Uint8Array(await readFile(join(path, file.name)));
          const text = file.name.toLowerCase().endsWith(".pdf")
            ? (await readPdfText(bytes)).text
            : readDocxText(bytes);

          if (text.trim().length === 0) {
            problems.push(
              `${file.name} was read but contained no text. A scanned document needs to go through Capture, which can read one.`,
            );
            continue;
          }

          await writeFile(join(workdir, `${file.name}.txt`), text, "utf8");
        }
        staged += 1;
      } catch (error) {
        problems.push(
          `${file.name} could not be read: ${error instanceof Error ? error.message : "unknown error"}.`,
        );
      }
    }

    if (staged === 0) {
      return await finish(session, job.id, {
        status: "failed",
        problems,
        error:
          "Nothing in that folder could be read as text. Word and PDF documents go through Capture, which converts them first.",
      });
    }

    const result = await runExtension(session, {
      task: "import_qualification",
      prompt: INSTRUCTION,
      workdir,
      timeoutMs: 900_000,
    });

    if (!result.ok) {
      return await finish(session, job.id, {
        status: "failed",
        problems,
        error: result.error ?? "The extension did not answer.",
      });
    }

    // The file is the answer. Falling back to the reply text costs nothing and
    // covers the run where it wrote the JSON out but also pasted it back.
    let proposal: ImportProposal | null = null;
    try {
      proposal = readJson<ImportProposal>(
        await readFile(join(workdir, "proposal.json"), "utf8"),
      );
    } catch {
      proposal = readJson<ImportProposal>(result.text ?? "");
    }

    if (!proposal) {
      return await finish(session, job.id, {
        status: "failed",
        problems,
        error:
          "The extension ran, but wrote nothing that could be read as a proposal. Try again; if it keeps happening the documents may not be a curriculum.",
      });
    }

    if ((proposal.modules?.length ?? 0) === 0) {
      problems.push(
        "The extension found no modules in those documents. That usually means the curriculum document was not among them.",
      );
    }

    return await finish(session, job.id, {
      status: "proposed",
      proposal,
      problems: [...problems, ...(proposal.notes ?? [])],
    });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function finish(
  session: AuthenticatedSession,
  jobId: string,
  input: {
    status: "proposed" | "failed";
    proposal?: ImportProposal;
    problems: string[];
    error?: string;
  },
) {
  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(aiImportJobs)
      .set({
        status: input.status,
        proposal: input.proposal ?? null,
        problems: input.problems,
        error: input.error ?? null,
      })
      .where(eq(aiImportJobs.id, jobId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "ai.import_proposed",
      entityType: "ai_import_job",
      entityId: jobId,
      after: {
        status: updated.status,
        moduleCount: input.proposal?.modules?.length ?? 0,
        problems: input.problems.length,
      },
    });

    return updated;
  });
}

export async function listImportJobs(session: AuthenticatedSession) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select()
      .from(aiImportJobs)
      .orderBy(desc(aiImportJobs.requestedAt))
      .limit(25),
  );
}

export async function getImportJob(
  session: AuthenticatedSession,
  jobId: string,
) {
  assertSessionCan(session, "qualification:manage");

  const [job] = await withTenant(session.organisationId, (tx) =>
    tx.select().from(aiImportJobs).where(eq(aiImportJobs.id, jobId)),
  );

  if (!job) throw new ImportError("That import was not found.", "not_found");
  return job;
}

/**
 * Marks a proposal discarded.
 *
 * Kept rather than deleted. What the extension proposed and was rejected is
 * the more interesting half of the record: it is how anybody judges whether
 * the extension is worth having.
 */
export async function discardImport(
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

    if (!updated) throw new ImportError("That import was not found.", "not_found");
    return updated;
  });
}
