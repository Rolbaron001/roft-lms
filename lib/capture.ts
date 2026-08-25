import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { captureJobs, organisations } from "@/db/schema";
import { readDocxText, OfficeReadError } from "./office";
import { buildStorageKey, putObject } from "./storage";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import {
  mergeMemorandum,
  parseMemorandum,
  parseWorkbook,
  type ParsedPaper,
} from "./capture-parse";
import { addPaper, addSection, addSectionItem, publishPaper } from "./papers";
import { tagItemCriteria } from "./marking";

/**
 * Capturing a Word document as a paper the App can present.
 *
 * The pipeline is deliberately in two halves with a person in the middle.
 * Everything up to `proposeCapture` is automatic; nothing past it happens
 * without somebody holding `assessment:author` confirming what was read. That
 * is not a configuration choice and there is no flag to skip it: a parser that
 * gets a correct answer wrong produces confidently wrong marking, discovered
 * only when a moderator looks or a learner appeals.
 */

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid" | "already_committed",
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

// ---------------------------------------------------------------------------
// What the filename says
// ---------------------------------------------------------------------------

export type NamingConvention = {
  /** "{provider} {qualification} {studyUnit} {artefact}{number} [{memo}]" */
  pattern: string;
  /** { WB: "workbook", SA: "summative_assessment", WEM: "workplace_signoff" } */
  artefactCodes: Record<string, string>;
  /** "AG" */
  memorandumMarker: string;
};

export const DEFAULT_CONVENTION: NamingConvention = {
  pattern: "{provider} {qualification} {studyUnit} {artefact}{number} [{memo}]",
  artefactCodes: {
    WB: "workbook",
    SA: "summative_assessment",
    WEM: "workplace_signoff",
  },
  memorandumMarker: "AG",
};

export type Classified = {
  provider: string | null;
  qualification: string | null;
  studyUnit: string | null;
  artefact: string | null;
  number: string | null;
  isMemorandum: boolean;
  /** What could not be read, so the reviewer knows to fill it in. */
  unread: string[];
};

/**
 * Reads a filename under a tenant's own convention.
 *
 * Nothing here refuses. A tenant that files inconsistently gets a blank form
 * to fill in rather than a filled one to check — a slower path, not a closed
 * one — so the classifier reports what it could not read instead of rejecting
 * the upload.
 */
export function classifyFilename(
  filename: string,
  convention: NamingConvention = DEFAULT_CONVENTION,
): Classified {
  const stem = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stem.split(" ");
  const artefactCodes = Object.keys(convention.artefactCodes);
  const memo = convention.memorandumMarker.toUpperCase();

  const isMemorandum = tokens.some(
    (token) => token.toUpperCase() === memo,
  );

  let artefact: string | null = null;
  let number: string | null = null;
  for (const token of tokens) {
    const match = new RegExp(`^(${artefactCodes.join("|")})(\\d*)$`, "i").exec(
      token,
    );
    if (match) {
      artefact = convention.artefactCodes[match[1].toUpperCase()] ?? null;
      number = match[2] || null;
      break;
    }
  }

  const qualification = tokens.find((token) => /^\d{5,6}$/.test(token)) ?? null;
  const studyUnit = tokens.find((token) => /^SU\d+$/i.test(token)) ?? null;
  // The provider code is the leading token, where it is not one of the others.
  const first = tokens[0] ?? "";
  const provider =
    first && first !== qualification && !/^SU\d+$/i.test(first) ? first : null;

  const unread: string[] = [];
  if (!provider) unread.push("provider");
  if (!qualification) unread.push("qualification");
  if (!studyUnit) unread.push("study unit");
  if (!artefact) unread.push("artefact");

  return {
    provider,
    qualification,
    studyUnit,
    artefact,
    number,
    isMemorandum,
    unread,
  };
}

export async function namingConventionFor(
  session: AuthenticatedSession,
): Promise<NamingConvention> {
  return withTenant(session.organisationId, async (tx) => {
    const [organisation] = await tx
      .select({ namingConvention: organisations.namingConvention })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    return organisation?.namingConvention ?? DEFAULT_CONVENTION;
  });
}

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

export type CaptureProposal = {
  jobId: string;
  classified: Classified;
  proposal: ParsedPaper;
  problems: string[];
};

/**
 * Reads an uploaded pair and records what it made of them.
 *
 * The files are stored and hashed whether or not the parse went well, because
 * the source is the authority: a dispute about what a question said is settled
 * against the document the author wrote, not against this reading of it.
 */
export async function proposeCapture(
  session: AuthenticatedSession,
  input: {
    paper: { filename: string; bytes: Uint8Array };
    guide?: { filename: string; bytes: Uint8Array };
  },
): Promise<CaptureProposal> {
  assertSessionCan(session, "assessment:author");

  let paperText: string;
  try {
    paperText = readDocxText(input.paper.bytes);
  } catch (error) {
    if (error instanceof OfficeReadError) {
      throw new CaptureError(
        `That file could not be read as a Word document: ${error.message}`,
        "invalid",
      );
    }
    throw error;
  }

  let parsed = parseWorkbook(paperText);

  if (input.guide) {
    const guideText = readDocxText(input.guide.bytes);
    parsed = mergeMemorandum(parsed, parseMemorandum(guideText));
  } else {
    parsed = {
      ...parsed,
      problems: [
        ...parsed.problems,
        "No answer guide was uploaded, so no correct answers, marks or criteria could be read. Every question will need them by hand.",
      ],
    };
  }

  const convention = await namingConventionFor(session);
  const classified = classifyFilename(input.paper.filename, convention);

  const paperStored = await putObject(
    buildStorageKey(session.organisationId, "capture", input.paper.filename),
    input.paper.bytes,
  );
  const guideStored = input.guide
    ? await putObject(
        buildStorageKey(session.organisationId, "capture", input.guide.filename),
        input.guide.bytes,
      )
    : null;

  const jobId = await withTenant(session.organisationId, async (tx) => {
    const [job] = await tx
      .insert(captureJobs)
      .values({
        organisationId: session.organisationId,
        paperFilename: input.paper.filename,
        paperStorageKey: paperStored.storageKey,
        paperSha256: paperStored.sha256,
        guideFilename: input.guide?.filename ?? null,
        guideStorageKey: guideStored?.storageKey ?? null,
        guideSha256: guideStored?.sha256 ?? null,
        classified: classified as unknown as Record<string, string | null>,
        proposal: parsed,
        problems: parsed.problems,
        uploadedById: session.userId,
      })
      .returning({ id: captureJobs.id });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "capture.proposed",
      entityType: "capture_job",
      entityId: job.id,
      after: {
        paper: input.paper.filename,
        guide: input.guide?.filename ?? null,
        sections: parsed.sections.length,
        questions: parsed.sections.reduce(
          (sum, section) => sum + section.items.length,
          0,
        ),
        problems: parsed.problems.length,
      },
    });

    return job.id;
  });

  return { jobId, classified, proposal: parsed, problems: parsed.problems };
}

export async function getCaptureJob(
  session: AuthenticatedSession,
  jobId: string,
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const [job] = await tx
      .select()
      .from(captureJobs)
      .where(eq(captureJobs.id, jobId));

    if (!job) throw new CaptureError("No such upload.", "not_found");

    return {
      ...job,
      proposal: job.proposal as ParsedPaper,
      classified: job.classified as unknown as Classified | null,
    };
  });
}

export async function listCaptureJobs(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, (tx) =>
    tx.select().from(captureJobs).orderBy(captureJobs.uploadedAt),
  );
}

// ---------------------------------------------------------------------------
// The commit
// ---------------------------------------------------------------------------

/**
 * Turns a confirmed proposal into a paper.
 *
 * Takes the structure back from the reviewer rather than reading it from the
 * job, because what is committed has to be what they saw and corrected, not
 * what the parser originally proposed. The job records who confirmed it, and
 * their name stays on the assessment afterwards.
 */
export async function commitCapture(
  session: AuthenticatedSession,
  input: {
    jobId: string;
    assessmentId: string;
    paperCode: string;
    /** The structure as the reviewer confirmed it. */
    confirmed: ParsedPaper;
    /** Criterion code to criterion id, resolved on the review screen. */
    criterionIds: Record<string, string>;
  },
) {
  assertSessionCan(session, "assessment:author");

  const job = await getCaptureJob(session, input.jobId);
  if (job.committedAt) {
    throw new CaptureError(
      "That upload has already been committed.",
      "already_committed",
    );
  }

  if (input.confirmed.sections.length === 0) {
    throw new CaptureError(
      "There is nothing to commit: the confirmed paper has no sections.",
      "invalid",
    );
  }

  const paper = await addPaper(session, {
    assessmentId: input.assessmentId,
    code: input.paperCode,
  });

  for (const section of input.confirmed.sections) {
    const created = await addSection(session, {
      paperId: paper.id,
      title: section.title,
      instruction: section.instruction ?? undefined,
      markTotal: section.markTotal ?? undefined,
    });

    for (const item of section.items) {
      const created_item = await addSectionItem(session, {
        sectionId: created.id,
        type: item.type,
        stem: item.stem,
        options: item.options.length > 0 ? item.options : undefined,
        correctIndexes:
          item.correctIndex !== null ? [item.correctIndex] : undefined,
        markingGuide: item.markingGuide ?? undefined,
        points: item.points ?? 1,
      });

      const ids = item.criterionCodes
        .map((code) => input.criterionIds[code])
        .filter(Boolean);
      if (ids.length > 0) {
        await tagItemCriteria(session, created_item.id, ids);
      }
    }
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(captureJobs)
      .set({
        committedById: session.userId,
        committedAt: new Date(),
        paperId: paper.id,
        proposal: input.confirmed,
      })
      .where(eq(captureJobs.id, input.jobId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "capture.committed",
      entityType: "capture_job",
      entityId: input.jobId,
      after: {
        assessmentId: input.assessmentId,
        paperId: paper.id,
        paperCode: input.paperCode,
        // What the reviewer changed is worth recording: it is the measure of
        // how far the parser can be trusted next time.
        sections: input.confirmed.sections.length,
      },
    });
  });

  // Published only if it passes the paper's own checks, which are stricter
  // than the parser's — the marks have to reconcile.
  const published = await publishPaper(session, paper.id);

  return { paperId: paper.id, published };
}
