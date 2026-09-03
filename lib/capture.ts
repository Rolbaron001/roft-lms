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
import { assertProgrammeReady } from "./programme-readiness";
import { assistCapture } from "./capture-assist";

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

import {
  classifyFilename,
  DEFAULT_CONVENTION,
  type Classified,
  type NamingConvention,
} from "./naming-convention";

// Re-exported so every existing caller keeps importing from here.
export {
  classifyFilename,
  DEFAULT_CONVENTION,
  type Classified,
  type NamingConvention,
};

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

/**
 * Changes how this tenant's filenames are read.
 *
 * The codes are what the classifier actually matches on, so getting them wrong
 * is not cosmetic: an upload whose artefact code is unrecognised arrives as a
 * blank form for somebody to fill in by hand rather than a filled one to
 * check. Slower, never wrong — but slow enough that it is worth setting this
 * once rather than living with it.
 */
export async function setNamingConvention(
  session: AuthenticatedSession,
  convention: NamingConvention,
): Promise<NamingConvention> {
  assertSessionCan(session, "tenant:manage_settings");

  const codes = Object.entries(convention.artefactCodes)
    .map(([code, meaning]) => [code.trim().toUpperCase(), meaning.trim()])
    .filter(([code, meaning]) => code.length > 0 && meaning.length > 0);

  if (codes.length === 0) {
    throw new CaptureError(
      "Keep at least one artefact code. With none, no upload can be recognised at all.",
      "invalid",
    );
  }

  for (const [code] of codes) {
    if (!/^[A-Z0-9]{1,10}$/.test(code)) {
      throw new CaptureError(
        `"${code}" cannot be an artefact code. Use letters and digits only, up to ten of them — it has to be readable as one word in a filename.`,
        "invalid",
      );
    }
  }

  const marker = convention.memorandumMarker.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(marker)) {
    throw new CaptureError(
      "The memorandum marker has to be letters and digits, up to ten of them.",
      "invalid",
    );
  }

  // A marker that is also an artefact code makes every memorandum ambiguous:
  // the same token would say both "this is a workbook" and "this is the answer
  // guide", and the classifier would have to guess.
  if (codes.some(([code]) => code === marker)) {
    throw new CaptureError(
      `"${marker}" is both the memorandum marker and an artefact code. One filename token cannot mean both.`,
      "invalid",
    );
  }

  const next: NamingConvention = {
    pattern: convention.pattern.trim() || DEFAULT_CONVENTION.pattern,
    artefactCodes: Object.fromEntries(codes),
    memorandumMarker: marker,
  };

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select({ namingConvention: organisations.namingConvention })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    await tx
      .update(organisations)
      .set({ namingConvention: next })
      .where(eq(organisations.id, session.organisationId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "tenant.naming_convention_set",
      entityType: "organisation",
      entityId: session.organisationId,
      before: before?.namingConvention ?? DEFAULT_CONVENTION,
      after: next,
    });

    return next;
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
    /** Which qualification this material belongs to. */
    qualificationId: string;
    paper: { filename: string; bytes: Uint8Array };
    guide?: { filename: string; bytes: Uint8Array };
  },
): Promise<CaptureProposal> {
  assertSessionCan(session, "assessment:author");

  // The order matters and this is what enforces it. Material captured before
  // the curriculum is in cannot have its criteria linked, so its questions
  // evidence nothing and the alignment matrix under-reports — discovered at an
  // audit, and fixed by re-tagging every question by hand. Refused up front
  // instead, with what is missing named.
  await assertProgrammeReady(session, input.qualificationId);

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

  // Where the house-style parser found nothing, an AI extension gets a second
  // reading - and only then. A paper it read twenty questions out of is a
  // paper it understood, and replacing a deterministic reading with a
  // probabilistic one would be a loss. Returns the paper unchanged where it
  // cannot help, so a failed second attempt never costs the first.
  const assist = await assistCapture(session, parsed, paperText);
  parsed = assist.paper;

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

  // Capture only ever accepts Word files, so the type is known rather than
  // detected. Stored with it so the bucket hands the file back as a document
  // rather than as a stream of bytes the browser offers to save blindly.
  const WORD =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const paperStored = await putObject(
    buildStorageKey(session.organisationId, "capture", input.paper.filename),
    input.paper.bytes,
    WORD,
  );
  const guideStored = input.guide
    ? await putObject(
        buildStorageKey(session.organisationId, "capture", input.guide.filename),
        input.guide.bytes,
        WORD,
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
        qualificationId: input.qualificationId,
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
/**
 * The checks that must hold at the moment of commit.
 *
 * Deliberately fewer than the parser's: the reviewer has had the full list and
 * these are the ones that would make a paper actively wrong rather than merely
 * incomplete.
 */
function recheck(confirmed: ParsedPaper): string[] {
  const outstanding: string[] = [];

  for (const section of confirmed.sections) {
    for (const item of section.items) {
      if (item.markedBy === "app" && item.correctIndex === null) {
        outstanding.push(
          `"${item.stem.slice(0, 50)}…" is marked by the App but has no correct answer.`,
        );
      }
    }

    const marks = section.items.reduce((sum, item) => sum + (item.points ?? 0), 0);
    if (section.markTotal !== null && section.markTotal !== marks) {
      outstanding.push(
        `"${section.title}" is printed as ${section.markTotal} marks but its questions add up to ${marks}.`,
      );
    }
  }

  return outstanding;
}

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
    /**
     * Set when the reviewer has read the findings and chosen to go on anyway.
     *
     * Required whenever anything is outstanding. The platform's job is to put
     * what it found in front of the person and wait — not to decide for them,
     * and not to let the findings scroll past unread.
     */
    acknowledgedProblems?: boolean;
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

  // Re-checked against what the reviewer confirmed rather than against the
  // original parse: they may have fixed some and introduced others, and it is
  // the state they are committing that has to be accounted for.
  const outstanding = recheck(input.confirmed);
  if (outstanding.length > 0 && !input.acknowledgedProblems) {
    throw new CaptureError(
      `${outstanding.length === 1 ? "One thing is" : `${outstanding.length} things are`} still outstanding on this paper. ` +
        `Correct them, or say explicitly that you have read them and want to go on: ` +
        outstanding.slice(0, 3).join(" "),
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
        // And what they chose to go ahead despite, which is what an audit of a
        // disputed question would want to see first.
        outstandingAtCommit: outstanding,
      },
    });
  });

  // Published only if it passes the paper's own checks, which are stricter
  // than the parser's — the marks have to reconcile.
  const published = await publishPaper(session, paper.id);

  return { paperId: paper.id, published };
}
