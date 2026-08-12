import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentItems,
  assessmentSubmissions,
  assessments,
  courses,
  evidenceArtifacts,
  moderationQueue,
  moderationRecords,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";
import { buildStorageKey, putObject } from "./storage";
import { detectMedia } from "./media";
import { issueCertificateAutomatically } from "./certificates";
import { raise, usersWithRole } from "./notifications";

/**
 * Assessment, assessor decisions and moderation.
 *
 * This is the part of the platform that decides whether a certificate means
 * anything. Four rules are enforced here rather than in the interface, because
 * an accreditation reviewer is entitled to ask what actually prevents them:
 *
 *   1. Nobody may assess their own submission.
 *   2. No moderator may moderate a decision they made as assessor. (Also
 *      enforced by a database trigger, so it holds even if this file is wrong.)
 *   3. A decision, once signed, is never edited. A correction is a new
 *      decision that supersedes the old one, and both remain readable.
 *   4. Which decisions get moderated is decided by the system, not chosen by
 *      the person being moderated.
 */

export class AssessmentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "invalid_state"
      | "no_attempts_left"
      | "already_decided",
  ) {
    super(message);
    this.name = "AssessmentError";
  }
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export const assessmentInput = z.object({
  courseId: z.string().uuid(),
  curriculumModuleId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3).max(300),
  instructions: z.string().trim().max(4000).optional(),
  type: z
    .enum([
      "quiz",
      "evidence_submission",
      "practical_observation",
      "workplace_logbook",
    ])
    .default("quiz"),
  purpose: z.enum(["formative", "summative"]).default("formative"),
  passMark: z.coerce.number().int().min(0).max(100).default(70),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  /** Fraction of decisions routed to a moderator. QCTO baseline is 0.25. */
  moderationSampleRate: z.coerce.number().min(0).max(1).default(0.25),
});

export async function createAssessment(
  session: AuthenticatedSession,
  input: z.input<typeof assessmentInput>,
) {
  assertSessionCan(session, "assessment:author");
  const parsed = assessmentInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({ id: courses.id, curriculumModuleId: courses.curriculumModuleId })
      .from(courses)
      .where(eq(courses.id, parsed.courseId));

    if (!course) {
      throw new AssessmentError("Course not found.", "not_found");
    }

    // An externally accredited summative assessment is moderated in full.
    // Sampling a proportion is for internal, formative work.
    const sampleRate =
      parsed.purpose === "summative" ? 1 : parsed.moderationSampleRate;

    const [created] = await tx
      .insert(assessments)
      .values({
        organisationId: session.organisationId,
        courseId: parsed.courseId,
        curriculumModuleId:
          parsed.curriculumModuleId ?? course.curriculumModuleId ?? null,
        title: parsed.title,
        instructions: parsed.instructions ?? null,
        type: parsed.type,
        purpose: parsed.purpose,
        passMark: parsed.passMark,
        maxAttempts: parsed.maxAttempts ?? null,
        moderationSampleRate: sampleRate.toFixed(3),
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.created",
      entityType: "assessment",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export const itemInput = z.object({
  assessmentId: z.string().uuid(),
  stem: z.string().trim().min(3).max(4000),
  type: z
    .enum([
      "multiple_choice",
      "multiple_response",
      "true_false",
      "short_answer",
      "scenario",
      "file_upload",
      "observation_checklist",
    ])
    .default("multiple_choice"),
  /** Option text in order. Ids are generated here so they are stable. */
  options: z.array(z.string().trim().min(1).max(1000)).default([]),
  /** Indexes into `options` that are correct. */
  correctIndexes: z.array(z.coerce.number().int().min(0)).default([]),
  points: z.coerce.number().int().min(1).max(100).default(1),
  criterionId: z.string().uuid().optional().nullable(),
  competencyId: z.string().uuid().optional().nullable(),
  markingGuide: z.string().trim().max(4000).optional(),
});

export async function addAssessmentItem(
  session: AuthenticatedSession,
  input: z.input<typeof itemInput>,
) {
  assertSessionCan(session, "assessment:author");
  const parsed = itemInput.parse(input);

  const autoMarked =
    parsed.type === "multiple_choice" ||
    parsed.type === "multiple_response" ||
    parsed.type === "true_false";

  if (autoMarked) {
    if (parsed.options.length < 2) {
      throw new AssessmentError(
        "A question with answer options needs at least two of them.",
        "invalid_state",
      );
    }
    if (parsed.correctIndexes.length === 0) {
      throw new AssessmentError(
        "Mark at least one option as correct, or the question can never be passed.",
        "invalid_state",
      );
    }
    if (parsed.correctIndexes.some((index) => index >= parsed.options.length)) {
      throw new AssessmentError(
        "A correct answer was chosen that is not one of the options.",
        "invalid_state",
      );
    }
  }

  const options = parsed.options.map((text) => ({ id: randomUUID(), text }));
  const correctOptionIds = parsed.correctIndexes.map(
    (index) => options[index].id,
  );

  return withTenant(session.organisationId, async (tx) => {
    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, parsed.assessmentId));

    const [created] = await tx
      .insert(assessmentItems)
      .values({
        organisationId: session.organisationId,
        assessmentId: parsed.assessmentId,
        stem: parsed.stem,
        type: parsed.type,
        options: options.length > 0 ? options : null,
        correctOptionIds: correctOptionIds.length > 0 ? correctOptionIds : null,
        points: parsed.points,
        criterionId: parsed.criterionId || null,
        competencyId: parsed.competencyId || null,
        markingGuide: parsed.markingGuide ?? null,
        sortOrder: existing,
      })
      .returning();

    return created;
  });
}

export async function publishAssessment(
  session: AuthenticatedSession,
  assessmentId: string,
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId));

    if (!assessment) {
      throw new AssessmentError("Assessment not found.", "not_found");
    }

    if (assessment.type === "quiz") {
      const [{ items }] = await tx
        .select({ items: count() })
        .from(assessmentItems)
        .where(eq(assessmentItems.assessmentId, assessmentId));

      if (items === 0) {
        throw new AssessmentError(
          "A quiz needs at least one question before it can be published.",
          "invalid_state",
        );
      }
    }

    await tx
      .update(assessments)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(assessments.id, assessmentId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.published",
      entityType: "assessment",
      entityId: assessmentId,
    });
  });
}

export async function listCourseAssessments(
  session: AuthenticatedSession,
  courseId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: assessments.id,
        title: assessments.title,
        type: assessments.type,
        purpose: assessments.purpose,
        status: assessments.status,
        passMark: assessments.passMark,
        moderationSampleRate: assessments.moderationSampleRate,
        itemCount: sql<number>`(
          select count(*)::int from assessment_items ai
          where ai.assessment_id = assessments.id
        )`,
      })
      .from(assessments)
      .where(eq(assessments.courseId, courseId))
      .orderBy(asc(assessments.title)),
  );
}

// ---------------------------------------------------------------------------
// Taking an assessment
// ---------------------------------------------------------------------------

/**
 * The learner's view of a quiz.
 *
 * `correctOptionIds` is never selected. Answers must not reach the browser at
 * all — omitting them from the query is the only reliable way to be sure they
 * cannot be read out of the page source.
 */
export async function getAssessmentForLearner(
  session: AuthenticatedSession,
  assessmentId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [assessment] = await tx
      .select({
        id: assessments.id,
        courseId: assessments.courseId,
        title: assessments.title,
        instructions: assessments.instructions,
        type: assessments.type,
        purpose: assessments.purpose,
        passMark: assessments.passMark,
        maxAttempts: assessments.maxAttempts,
        status: assessments.status,
      })
      .from(assessments)
      .where(eq(assessments.id, assessmentId));

    if (!assessment || assessment.status !== "published") {
      throw new AssessmentError("Assessment not available.", "not_found");
    }

    const items = await tx
      .select({
        id: assessmentItems.id,
        stem: assessmentItems.stem,
        type: assessmentItems.type,
        options: assessmentItems.options,
        points: assessmentItems.points,
      })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, assessmentId))
      .orderBy(asc(assessmentItems.sortOrder));

    const attempts = await tx
      .select({
        id: assessmentSubmissions.id,
        attemptNumber: assessmentSubmissions.attemptNumber,
        status: assessmentSubmissions.status,
        autoScore: assessmentSubmissions.autoScore,
        maxScore: assessmentSubmissions.maxScore,
        submittedAt: assessmentSubmissions.submittedAt,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, assessmentId),
          eq(assessmentSubmissions.userId, session.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    return { assessment, items, attempts };
  });
}

export type MarkedResult = {
  submissionId: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  /** True when a person still has to make the competency judgement. */
  awaitingAssessor: boolean;
};

/**
 * Marks a set of answers against the item bank.
 *
 * Kept as a pure function so the marking rules can be tested without a
 * database: partial credit is not given, and a multiple-response question is
 * correct only when the selected set matches exactly.
 */
export function markResponses(
  items: {
    id: string;
    points: number;
    correctOptionIds: string[] | null;
  }[],
  responses: Record<string, string[]>,
): { score: number; maxScore: number } {
  let score = 0;
  let maxScore = 0;

  for (const item of items) {
    maxScore += item.points;

    const correct = item.correctOptionIds;
    if (!correct || correct.length === 0) continue;

    const given = responses[item.id] ?? [];
    const sameLength = given.length === correct.length;
    const allPresent = correct.every((option) => given.includes(option));

    if (sameLength && allPresent) {
      score += item.points;
    }
  }

  return { score, maxScore };
}

export async function submitQuiz(
  session: AuthenticatedSession,
  input: {
    assessmentId: string;
    enrolmentId?: string | null;
    responses: Record<string, string[]>;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<MarkedResult> {
  assertSessionCan(session, "assessment:take");

  return withTenant(session.organisationId, async (tx) => {
    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, input.assessmentId));

    if (!assessment || assessment.status !== "published") {
      throw new AssessmentError("Assessment not available.", "not_found");
    }

    const previous = await tx
      .select({ attemptNumber: assessmentSubmissions.attemptNumber })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, input.assessmentId),
          eq(assessmentSubmissions.userId, session.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber))
      .limit(1);

    const attemptNumber = (previous[0]?.attemptNumber ?? 0) + 1;

    if (assessment.maxAttempts && attemptNumber > assessment.maxAttempts) {
      throw new AssessmentError(
        `You have used all ${assessment.maxAttempts} attempts at this assessment.`,
        "no_attempts_left",
      );
    }

    const items = await tx
      .select({
        id: assessmentItems.id,
        points: assessmentItems.points,
        correctOptionIds: assessmentItems.correctOptionIds,
      })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, input.assessmentId));

    const { score, maxScore } = markResponses(items, input.responses);
    const percentage = maxScore === 0 ? 0 : (score / maxScore) * 100;

    // A summative decision is a person's judgement, recorded by a registered
    // assessor. The automatic score informs it; it does not replace it.
    const awaitingAssessor = assessment.purpose === "summative";

    const [submission] = await tx
      .insert(assessmentSubmissions)
      .values({
        organisationId: session.organisationId,
        assessmentId: input.assessmentId,
        userId: session.userId,
        enrolmentId: input.enrolmentId ?? null,
        attemptNumber,
        status: awaitingAssessor ? "submitted" : "finalised",
        responses: input.responses,
        autoScore: score.toFixed(2),
        maxScore: maxScore.toFixed(2),
        submittedAt: new Date(),
        submittedIp: input.ipAddress ?? null,
        submittedUserAgent: input.userAgent ?? null,
      })
      .returning({ id: assessmentSubmissions.id });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.submitted",
      entityType: "assessment_submission",
      entityId: submission.id,
      after: {
        assessmentId: input.assessmentId,
        attemptNumber,
        score,
        maxScore,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      submissionId: submission.id,
      score,
      maxScore,
      percentage,
      passed: percentage >= assessment.passMark,
      awaitingAssessor,
    };
  });
}

/**
 * Uploads evidence against an assessment: a workplace logbook, a recording of
 * a practical task, a project artefact.
 *
 * Each file is hashed on the way in and the hash stored beside it, so any
 * later alteration is detectable.
 */
export async function submitEvidence(
  session: AuthenticatedSession,
  input: {
    assessmentId: string;
    enrolmentId?: string | null;
    /**
     * `mimeType` is accepted for callers that have one to hand but is
     * deliberately ignored: the type recorded is the one read from the file's
     * own bytes. What a browser claims about an upload is supplied by whoever
     * is uploading, and evidence is exactly the wrong place to take that on
     * trust.
     */
    files: { filename: string; mimeType?: string; bytes: Uint8Array }[];
    note?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  assertSessionCan(session, "evidence:submit");

  if (input.files.length === 0) {
    throw new AssessmentError("Attach at least one file.", "invalid_state");
  }

  const submissionId = await withTenant(
    session.organisationId,
    async (tx) => {
      const [assessment] = await tx
        .select()
        .from(assessments)
        .where(eq(assessments.id, input.assessmentId));

      if (!assessment || assessment.status !== "published") {
        throw new AssessmentError("Assessment not available.", "not_found");
      }

      const previous = await tx
        .select({ attemptNumber: assessmentSubmissions.attemptNumber })
        .from(assessmentSubmissions)
        .where(
          and(
            eq(assessmentSubmissions.assessmentId, input.assessmentId),
            eq(assessmentSubmissions.userId, session.userId),
          ),
        )
        .orderBy(desc(assessmentSubmissions.attemptNumber))
        .limit(1);

      const [submission] = await tx
        .insert(assessmentSubmissions)
        .values({
          organisationId: session.organisationId,
          assessmentId: input.assessmentId,
          userId: session.userId,
          enrolmentId: input.enrolmentId ?? null,
          attemptNumber: (previous[0]?.attemptNumber ?? 0) + 1,
          status: "submitted",
          responses: input.note ? { note: input.note } : null,
          submittedAt: new Date(),
          submittedIp: input.ipAddress ?? null,
          submittedUserAgent: input.userAgent ?? null,
        })
        .returning({ id: assessmentSubmissions.id });

      return submission.id;
    },
  );

  // Files are written outside the transaction: a rolled-back transaction
  // cannot unwrite them, so the rows are inserted afterwards instead.
  const stored: {
    file: { filename: string; mimeType: string };
    object: Awaited<ReturnType<typeof putObject>>;
  }[] = [];

  for (const file of input.files) {
    const detected = detectMedia(file.bytes, file.filename);
    if (!detected.ok) {
      throw new AssessmentError(
        `${file.filename}: ${detected.reason}`,
        "invalid_state",
      );
    }

    const key = buildStorageKey(
      session.organisationId,
      submissionId,
      file.filename,
    );
    const object = await putObject(key, file.bytes);
    stored.push({
      file: { filename: file.filename, mimeType: detected.mimeType },
      object,
    });
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx.insert(evidenceArtifacts).values(
      stored.map(({ file, object }) => ({
        organisationId: session.organisationId,
        submissionId,
        filename: file.filename,
        storageKey: object.storageKey,
        mimeType: file.mimeType,
        sizeBytes: object.sizeBytes,
        sha256: object.sha256,
        uploadedById: session.userId,
        uploadedIp: input.ipAddress ?? null,
      })),
    );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "evidence.submitted",
      entityType: "assessment_submission",
      entityId: submissionId,
      after: {
        files: stored.map(({ file, object }) => ({
          filename: file.filename,
          sha256: object.sha256,
          sizeBytes: object.sizeBytes,
        })),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  });

  return { submissionId, files: stored.map(({ object }) => object) };
}

// ---------------------------------------------------------------------------
// Assessor decisions
// ---------------------------------------------------------------------------

/** Submissions waiting for an assessor. */
export async function listAssessorQueue(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        submissionId: assessmentSubmissions.id,
        assessmentId: assessments.id,
        assessmentTitle: assessments.title,
        assessmentType: assessments.type,
        purpose: assessments.purpose,
        courseTitle: courses.title,
        learnerId: users.id,
        learnerFirstName: users.firstName,
        learnerLastName: users.lastName,
        submittedAt: assessmentSubmissions.submittedAt,
        autoScore: assessmentSubmissions.autoScore,
        maxScore: assessmentSubmissions.maxScore,
        attemptNumber: assessmentSubmissions.attemptNumber,
      })
      .from(assessmentSubmissions)
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentSubmissions.assessmentId),
      )
      .leftJoin(courses, eq(courses.id, assessments.courseId))
      .innerJoin(users, eq(users.id, assessmentSubmissions.userId))
      .where(eq(assessmentSubmissions.status, "submitted"))
      .orderBy(asc(assessmentSubmissions.submittedAt)),
  );
}

/** A submission with everything an assessor needs to judge it. */
export async function getSubmissionForAssessment(
  session: AuthenticatedSession,
  submissionId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));

    if (!submission) {
      throw new AssessmentError("Submission not found.", "not_found");
    }

    const isOwn = submission.userId === session.userId;
    if (
      !isOwn &&
      !can(session, "evidence:read_all") &&
      !can(session, "assessment:assess")
    ) {
      throw new AssessmentError(
        "That submission belongs to someone else.",
        "not_permitted",
      );
    }

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    const [learner] = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, submission.userId));

    const items = await tx
      .select()
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, submission.assessmentId))
      .orderBy(asc(assessmentItems.sortOrder));

    const artifacts = await tx
      .select()
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.submissionId, submissionId));

    const criteria = assessment.curriculumModuleId
      ? await tx
          .select()
          .from(assessmentCriteria)
          .where(
            eq(
              assessmentCriteria.curriculumModuleId,
              assessment.curriculumModuleId,
            ),
          )
          .orderBy(asc(assessmentCriteria.sortOrder))
      : [];

    const decisions = await tx
      .select({
        id: assessmentDecisions.id,
        outcome: assessmentDecisions.outcome,
        comments: assessmentDecisions.comments,
        signedAt: assessmentDecisions.signedAt,
        assessorId: assessmentDecisions.assessorId,
        assessorFirstName: users.firstName,
        assessorLastName: users.lastName,
      })
      .from(assessmentDecisions)
      .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
      .where(eq(assessmentDecisions.submissionId, submissionId))
      .orderBy(desc(assessmentDecisions.signedAt));

    return {
      submission,
      assessment,
      learner,
      items,
      artifacts,
      criteria,
      decisions,
    };
  });
}

/**
 * Decides which decisions go to a moderator.
 *
 * Pure, so the rule can be tested directly rather than inferred from
 * behaviour. A newly registered assessor is moderated in full regardless of
 * the sampling rate: the point of sampling is to monitor someone whose
 * judgement is already established.
 */
export function shouldModerate(input: {
  sampleRate: number;
  isNewAssessor: boolean;
  moderateAllForNewAssessors: boolean;
  random?: number;
}): { moderate: boolean; reason: string } {
  if (input.sampleRate >= 1) {
    return { moderate: true, reason: "full_moderation" };
  }
  if (input.isNewAssessor && input.moderateAllForNewAssessors) {
    return { moderate: true, reason: "new_assessor" };
  }
  if (input.sampleRate <= 0) {
    return { moderate: false, reason: "not_sampled" };
  }
  const roll = input.random ?? Math.random();
  return roll < input.sampleRate
    ? { moderate: true, reason: "random_sample" }
    : { moderate: false, reason: "not_sampled" };
}

/** Below this many prior decisions, an assessor's work is fully moderated. */
export const NEW_ASSESSOR_DECISION_THRESHOLD = 5;

export const decisionInput = z.object({
  submissionId: z.string().uuid(),
  outcome: z.enum(["competent", "not_yet_competent"]),
  comments: z.string().trim().max(4000).optional(),
  /** Per-criterion judgements, keyed by criterion id. */
  criterionOutcomes: z
    .record(z.string(), z.enum(["competent", "not_yet_competent"]))
    .optional(),
});

export async function recordAssessorDecision(
  session: AuthenticatedSession,
  input: z.infer<typeof decisionInput>,
  options: { random?: number } = {},
) {
  assertSessionCan(session, "assessment:assess");
  const parsed = decisionInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, parsed.submissionId));

    if (!submission) {
      throw new AssessmentError("Submission not found.", "not_found");
    }

    // Rule 1. Nobody assesses their own work.
    if (submission.userId === session.userId) {
      throw new AssessmentError(
        "You cannot assess your own submission.",
        "not_permitted",
      );
    }

    if (submission.status === "finalised") {
      throw new AssessmentError(
        "This submission has already been finalised.",
        "already_decided",
      );
    }

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    const [{ priorDecisions }] = await tx
      .select({ priorDecisions: count() })
      .from(assessmentDecisions)
      .where(eq(assessmentDecisions.assessorId, session.userId));

    const [{ score }] = await tx
      .select({ score: assessmentSubmissions.autoScore })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, parsed.submissionId));

    const [decision] = await tx
      .insert(assessmentDecisions)
      .values({
        organisationId: session.organisationId,
        submissionId: parsed.submissionId,
        assessorId: session.userId,
        outcome: parsed.outcome,
        criterionOutcomes: parsed.criterionOutcomes ?? null,
        score,
        comments: parsed.comments ?? null,
        signedAt: new Date(),
      })
      .returning();

    const sampling = shouldModerate({
      sampleRate: Number(assessment.moderationSampleRate),
      isNewAssessor: priorDecisions < NEW_ASSESSOR_DECISION_THRESHOLD,
      moderateAllForNewAssessors: assessment.moderateAllForNewAssessors,
      random: options.random,
    });

    if (sampling.moderate) {
      await tx.insert(moderationQueue).values({
        organisationId: session.organisationId,
        decisionId: decision.id,
        samplingReason: sampling.reason,
      });
    }

    await tx
      .update(assessmentSubmissions)
      .set({ status: sampling.moderate ? "assessed" : "finalised" })
      .where(eq(assessmentSubmissions.id, parsed.submissionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: "assessor",
      action: "assessment.decided",
      entityType: "assessment_decision",
      entityId: decision.id,
      after: {
        submissionId: parsed.submissionId,
        outcome: parsed.outcome,
        routedToModeration: sampling.moderate,
        samplingReason: sampling.reason,
      },
    });

    if (sampling.moderate) {
      // Tell the moderators there is work, rather than relying on them
      // checking a queue nobody mentioned.
      for (const moderatorId of await usersWithRole(tx, "moderator")) {
        if (moderatorId === session.userId) continue;
        await raise(tx, {
          organisationId: session.organisationId,
          userId: moderatorId,
          kind: "moderation.waiting",
          subject: "A decision is waiting for moderation",
          body: `A ${assessment.purpose} decision on "${assessment.title}" has been sampled for independent review.`,
          linkPath: "/moderate",
          entityType: "assessment_decision",
          entityId: decision.id,
          dedupeKey: `moderate:${decision.id}:${moderatorId}`,
        });
      }
    } else {
      // Finalised outright, so the learner has their result now.
      await raise(tx, {
        organisationId: session.organisationId,
        userId: submission.userId,
        kind: "assessment.decided",
        subject: `Your result for "${assessment.title}"`,
        body:
          parsed.outcome === "competent"
            ? "You have been assessed as competent."
            : "You have been assessed as not yet competent. Your assessor's comments explain what is needed.",
        entityType: "assessment_submission",
        entityId: parsed.submissionId,
        dedupeKey: `decided:${decision.id}`,
        channels: ["in_app", "email"],
      });
    }

    return { decision, moderation: sampling };
  });
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export async function listModerationQueue(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:moderate");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        queueId: moderationQueue.id,
        decisionId: assessmentDecisions.id,
        submissionId: assessmentDecisions.submissionId,
        outcome: assessmentDecisions.outcome,
        samplingReason: moderationQueue.samplingReason,
        queuedAt: moderationQueue.queuedAt,
        assessorId: assessmentDecisions.assessorId,
        assessorFirstName: users.firstName,
        assessorLastName: users.lastName,
        assessmentTitle: assessments.title,
        courseTitle: courses.title,
      })
      .from(moderationQueue)
      .innerJoin(
        assessmentDecisions,
        eq(assessmentDecisions.id, moderationQueue.decisionId),
      )
      .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
      .innerJoin(
        assessmentSubmissions,
        eq(assessmentSubmissions.id, assessmentDecisions.submissionId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentSubmissions.assessmentId),
      )
      .leftJoin(courses, eq(courses.id, assessments.courseId))
      .where(isNull(moderationQueue.resolvedAt))
      .orderBy(asc(moderationQueue.queuedAt)),
  );
}

export const moderationInput = z.object({
  decisionId: z.string().uuid(),
  outcome: z.enum(["endorsed", "referred_back", "overridden"]),
  comments: z.string().trim().max(4000).optional(),
  revisedOutcome: z.enum(["competent", "not_yet_competent"]).optional(),
});

export async function recordModeration(
  session: AuthenticatedSession,
  input: z.infer<typeof moderationInput>,
) {
  assertSessionCan(session, "assessment:moderate");
  const parsed = moderationInput.parse(input);

  if (parsed.outcome === "overridden" && !parsed.revisedOutcome) {
    throw new AssessmentError(
      "Overriding a decision requires the outcome it is replaced with.",
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [decision] = await tx
      .select()
      .from(assessmentDecisions)
      .where(eq(assessmentDecisions.id, parsed.decisionId));

    if (!decision) {
      throw new AssessmentError("Decision not found.", "not_found");
    }

    // Rule 2. Checked here for a clear message; the database enforces it too,
    // so it holds even if this check is ever removed by mistake.
    if (decision.assessorId === session.userId) {
      throw new AssessmentError(
        "You assessed this submission, so you cannot moderate it.",
        "not_permitted",
      );
    }

    const [existing] = await tx
      .select({ id: moderationRecords.id })
      .from(moderationRecords)
      .where(eq(moderationRecords.decisionId, parsed.decisionId));

    if (existing) {
      throw new AssessmentError(
        "This decision has already been moderated.",
        "already_decided",
      );
    }

    const [record] = await tx
      .insert(moderationRecords)
      .values({
        organisationId: session.organisationId,
        decisionId: parsed.decisionId,
        moderatorId: session.userId,
        outcome: parsed.outcome,
        samplingReason: "queued",
        comments: parsed.comments ?? null,
        revisedOutcome: parsed.revisedOutcome ?? null,
        actionedAt: new Date(),
      })
      .returning();

    await tx
      .update(moderationQueue)
      .set({ resolvedAt: new Date() })
      .where(eq(moderationQueue.decisionId, parsed.decisionId));

    // Referred back reopens the submission for a fresh assessor decision.
    // Endorsed or overridden closes it.
    await tx
      .update(assessmentSubmissions)
      .set({
        status: parsed.outcome === "referred_back" ? "referred_back" : "moderated",
      })
      .where(eq(assessmentSubmissions.id, decision.submissionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: "moderator",
      action: "assessment.moderated",
      entityType: "moderation_record",
      entityId: record.id,
      after: {
        decisionId: parsed.decisionId,
        outcome: parsed.outcome,
        revisedOutcome: parsed.revisedOutcome ?? null,
      },
    });

    const [submission] = await tx
      .select({ userId: assessmentSubmissions.userId })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, decision.submissionId));

    if (parsed.outcome === "referred_back") {
      // The assessor has to look again, so they are told directly rather than
      // discovering it next time they happen to open the queue.
      await raise(tx, {
        organisationId: session.organisationId,
        userId: decision.assessorId,
        kind: "assessment.referred_back",
        subject: "A moderator has referred your decision back",
        body:
          parsed.comments ??
          "A moderator has asked for this decision to be looked at again.",
        linkPath: `/assess/${decision.submissionId}`,
        entityType: "assessment_decision",
        entityId: decision.id,
        dedupeKey: `referred:${record.id}`,
        channels: ["in_app", "email"],
      });
    } else if (submission) {
      await raise(tx, {
        organisationId: session.organisationId,
        userId: submission.userId,
        kind: "assessment.decided",
        subject: "Your assessment result has been confirmed",
        body:
          parsed.outcome === "overridden"
            ? "A moderator reviewed your assessment and revised the outcome. Your record shows the result that stands."
            : "A moderator has independently reviewed and confirmed your assessment result.",
        entityType: "assessment_submission",
        entityId: decision.submissionId,
        dedupeKey: `moderated:${record.id}`,
        channels: ["in_app", "email"],
      });
    }

    return { record, submissionId: decision.submissionId };
  }).then(async ({ record, submissionId }) => {
    // Moderation is the last step before a certificate is due. Attempted
    // outside the transaction so a failure cannot roll back the moderator's
    // signed record, which must stand on its own.
    if (parsed.outcome !== "referred_back") {
      try {
        const enrolmentId = await withTenant(
          session.organisationId,
          async (tx) => {
            const [row] = await tx
              .select({ enrolmentId: assessmentSubmissions.enrolmentId })
              .from(assessmentSubmissions)
              .where(eq(assessmentSubmissions.id, submissionId));
            return row?.enrolmentId ?? null;
          },
        );

        if (enrolmentId) {
          await issueCertificateAutomatically(
            session.organisationId,
            enrolmentId,
          );
        }
      } catch (error) {
        console.error("Automatic certificate issue failed", error);
      }
    }

    return record;
  });
}

/**
 * The outcome that stands for a submission: the moderator's revision where
 * there is one, otherwise the assessor's decision. Read this rather than the
 * decision directly, or an overridden result will be reported wrongly.
 */
export async function effectiveOutcome(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<{
  outcome: "competent" | "not_yet_competent" | null;
  moderated: boolean;
  overridden: boolean;
}> {
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        decisionOutcome: assessmentDecisions.outcome,
        moderationOutcome: moderationRecords.outcome,
        revisedOutcome: moderationRecords.revisedOutcome,
      })
      .from(assessmentDecisions)
      .leftJoin(
        moderationRecords,
        eq(moderationRecords.decisionId, assessmentDecisions.id),
      )
      .where(eq(assessmentDecisions.submissionId, submissionId))
      .orderBy(desc(assessmentDecisions.signedAt))
      .limit(1);

    if (!row) {
      return { outcome: null, moderated: false, overridden: false };
    }

    const overridden =
      row.moderationOutcome === "overridden" && row.revisedOutcome !== null;

    return {
      outcome: overridden ? row.revisedOutcome! : row.decisionOutcome,
      moderated: row.moderationOutcome !== null,
      overridden,
    };
  });
}
