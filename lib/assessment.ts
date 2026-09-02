import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentItems,
  assessmentSubmissions,
  assessments,
  cohortMembers,
  cohorts,
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
import { awardEarnedBadges } from "./badges";
import { qualificationReadiness } from "./eisa";
import { DEFAULT_TIME_ZONE, dateInZone } from "./timezone";
import { enrolments, organisations } from "@/db/schema";
import { raise, usersWithRole } from "./notifications";
import { assertOralRecorded } from "./reassessment";

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
  /**
   * How long a learner has once they start. Enforced on the server from the
   * moment the attempt opened, so leaving the page open gains nobody time.
   */
  timeLimitMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  /** Which paper each attempt draws, where more than one exists. */
  attemptPolicy: z.enum(["fixed", "rotate", "random"]).default("rotate"),
  /** Whether a person opens the sitting. Almost never, and never implied. */
  requiresInvigilator: z.boolean().default(false),
  /** What the learner attests to on handing in. */
  declarationText: z.string().trim().max(4000).optional(),
  /**
   * Fraction of decisions routed to a moderator. 0.25 is a platform default,
   * not a prescribed figure: the provider's own moderation policy sets it.
   */
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
        timeLimitMinutes: parsed.timeLimitMinutes ?? null,
        attemptPolicy: parsed.attemptPolicy,
        requiresInvigilator: parsed.requiresInvigilator,
        declarationText: parsed.declarationText ?? null,
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
        // The left column of a matching item. Its answers live in
        // correctMatches, which is deliberately not selected here: this query
        // feeds the learner's browser.
        matchPrompts: assessmentItems.matchPrompts,
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
        lastSavedAt: assessmentSubmissions.lastSavedAt,
        responses: assessmentSubmissions.responses,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, assessmentId),
          eq(assessmentSubmissions.userId, session.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    // Whatever was kept the last time the learner worked on this, so the form
    // opens where they left it rather than empty.
    const draft = attempts.find((attempt) => attempt.status === "draft");

    return {
      assessment,
      items,
      attempts,
      draft: draft
        ? {
            savedAt: draft.lastSavedAt,
            answers: (draft.responses ?? {}) as Record<string, string[]>,
          }
        : null,
    };
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
    type?: string | null;
    points: number;
    correctOptionIds: string[] | null;
    correctMatches?: Record<string, string> | null;
  }[],
  responses: Record<string, string[]>,
): { score: number; maxScore: number } {
  let score = 0;
  let maxScore = 0;

  for (const item of items) {
    maxScore += item.points;

    // True or false with a justification is deliberately never auto-awarded,
    // even though half of it could be. A learner who picks the right box and
    // justifies it wrongly has not shown competence, and the box is the half
    // a guess gets right. Awarding the item on the choice alone would hand
    // full marks to the guess and call it evidence. The whole item goes to a
    // person, the same way a written answer does.
    if (item.type === "true_false_justified") continue;

    if (item.type === "matching") {
      const correct = item.correctMatches;
      if (!correct || Object.keys(correct).length === 0) continue;

      // Pairs arrive as "promptId:optionId", so one field carries the whole
      // answer and nothing about the form encoding has to change.
      const given = new Map<string, string>();
      for (const pair of responses[item.id] ?? []) {
        const at = pair.indexOf(":");
        if (at > 0) given.set(pair.slice(0, at), pair.slice(at + 1));
      }

      const entries = Object.entries(correct);
      const everyPairRight =
        given.size === entries.length &&
        entries.every(([prompt, option]) => given.get(prompt) === option);

      // All or nothing, which is how a multiple-response item is already
      // marked here. Partial credit on one type and not the others would be a
      // second marking philosophy hiding inside the first; an assessor can
      // still award what they think is right.
      if (everyPairRight) score += item.points;
      continue;
    }

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

/**
 * Saves a learner's answers without submitting them.
 *
 * A workbook is not a quiz taken in one sitting. The client's are worked
 * through over a fortnight between lectures, and until now the only way to
 * keep an answer was to submit the lot, which is also the act that spends an
 * attempt. A learner who closed the tab lost the evening.
 *
 * The draft is a real submission at status `draft`, not a separate kind of
 * thing, so submitting is a change of status rather than a copy between two
 * tables and there is no second place for answers to live.
 *
 * Nothing is marked here and no attempt is spent. `submitQuiz` picks the draft
 * up and finishes it.
 */
export async function saveQuizDraft(
  session: AuthenticatedSession,
  input: {
    assessmentId: string;
    enrolmentId?: string | null;
    responses: Record<string, string[]>;
  },
): Promise<{ submissionId: string; savedAt: Date }> {
  assertSessionCan(session, "assessment:take");

  return withTenant(session.organisationId, async (tx) => {
    const [assessment] = await tx
      .select({ id: assessments.id, status: assessments.status })
      .from(assessments)
      .where(eq(assessments.id, input.assessmentId));

    if (!assessment || assessment.status !== "published") {
      throw new AssessmentError("Assessment not available.", "not_found");
    }

    const existing = await tx
      .select({
        id: assessmentSubmissions.id,
        attemptNumber: assessmentSubmissions.attemptNumber,
        status: assessmentSubmissions.status,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, input.assessmentId),
          eq(assessmentSubmissions.userId, session.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    const draft = existing.find((row) => row.status === "draft");
    const savedAt = new Date();

    if (draft) {
      await tx
        .update(assessmentSubmissions)
        .set({ responses: input.responses, lastSavedAt: savedAt })
        .where(eq(assessmentSubmissions.id, draft.id));
      return { submissionId: draft.id, savedAt };
    }

    const [created] = await tx
      .insert(assessmentSubmissions)
      .values({
        organisationId: session.organisationId,
        assessmentId: input.assessmentId,
        userId: session.userId,
        enrolmentId: input.enrolmentId ?? null,
        attemptNumber: (existing[0]?.attemptNumber ?? 0) + 1,
        status: "draft",
        responses: input.responses,
        lastSavedAt: savedAt,
      })
      .returning({ id: assessmentSubmissions.id });

    // Deliberately not audited. A draft saving every few seconds would bury
    // the events that matter in a log a moderator has to read.
    return { submissionId: created.id, savedAt };
  });
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
      .select({
        id: assessmentSubmissions.id,
        attemptNumber: assessmentSubmissions.attemptNumber,
        status: assessmentSubmissions.status,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, input.assessmentId),
          eq(assessmentSubmissions.userId, session.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    // A draft is this attempt, already begun. Submitting finishes it rather
    // than starting another: without this the draft holds attempt 1, the
    // submission takes attempt 2, and a learner who saved once has silently
    // spent two of the attempts they were allowed.
    const draft = previous.find((row) => row.status === "draft");
    const attemptNumber =
      draft?.attemptNumber ?? (previous[0]?.attemptNumber ?? 0) + 1;

    if (assessment.maxAttempts && attemptNumber > assessment.maxAttempts) {
      throw new AssessmentError(
        `You have used all ${assessment.maxAttempts} attempts at this assessment.`,
        "no_attempts_left",
      );
    }

    const items = await tx
      .select({
        id: assessmentItems.id,
        type: assessmentItems.type,
        points: assessmentItems.points,
        correctOptionIds: assessmentItems.correctOptionIds,
        correctMatches: assessmentItems.correctMatches,
      })
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, input.assessmentId));

    const { score, maxScore } = markResponses(items, input.responses);
    const percentage = maxScore === 0 ? 0 : (score / maxScore) * 100;

    // A summative decision is a person's judgement, recorded by a registered
    // assessor. The automatic score informs it; it does not replace it.
    const awaitingAssessor = assessment.purpose === "summative";

    const finished = {
      status: (awaitingAssessor ? "submitted" : "finalised") as
        | "submitted"
        | "finalised",
      responses: input.responses,
      autoScore: score.toFixed(2),
      maxScore: maxScore.toFixed(2),
      submittedAt: new Date(),
      submittedIp: input.ipAddress ?? null,
      submittedUserAgent: input.userAgent ?? null,
    };

    const submission = draft
      ? ((await tx
          .update(assessmentSubmissions)
          .set({ ...finished, lastSavedAt: new Date() })
          .where(eq(assessmentSubmissions.id, draft.id))
          .returning({ id: assessmentSubmissions.id }))[0])
      : ((await tx
          .insert(assessmentSubmissions)
          .values({
            organisationId: session.organisationId,
            assessmentId: input.assessmentId,
            userId: session.userId,
            enrolmentId: input.enrolmentId ?? null,
            attemptNumber,
            ...finished,
          })
          .returning({ id: assessmentSubmissions.id }))[0]);

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
    const object = await putObject(key, file.bytes, detected.mimeType);
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
 * How much of a cohort must be moderated, given how big it is.
 *
 * QCTO policy sets a floor that rises as the cohort shrinks: a cohort of ten
 * or fewer is moderated in full, and one of twenty or fewer is moderated at
 * half. The reason is statistical rather than bureaucratic. A quarter of eight
 * scripts is two, and two scripts say almost nothing about an assessor's
 * judgement, so on a small cohort a percentage that is reasonable for a large
 * one stops being evidence of anything.
 *
 * The configured rate is a floor, not a ceiling: a provider that chooses to
 * moderate more than the policy requires keeps its own figure. Above twenty
 * the configured rate governs, because the policy text sets minimums for small
 * cohorts and leaves the rest to the provider's own assessment strategy.
 *
 * A cohort size of null means the learner is not on one - an individual
 * enrolment rather than a scheduled intake - and there is no cohort rule to
 * apply, so the configured rate stands.
 */
export function moderationRateFor(input: {
  cohortSize: number | null;
  configuredRate: number;
}): { rate: number; reason: string } {
  const configured = input.configuredRate;

  if (input.cohortSize === null) {
    return { rate: configured, reason: "no_cohort" };
  }

  if (input.cohortSize <= 10) {
    return { rate: 1, reason: "cohort_of_ten_or_fewer" };
  }

  if (input.cohortSize <= 20) {
    return {
      rate: Math.max(0.5, configured),
      reason: "cohort_of_twenty_or_fewer",
    };
  }

  return { rate: configured, reason: "configured_rate" };
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
  /**
   * Why, per criterion. Required wherever the assessor departs from what the
   * marks proposed — see the refusal in `recordAssessorDecision`.
   */
  criterionNotes: z.record(z.string(), z.string().trim().max(2000)).optional(),
  /** What the marks implied, carried in so it can be stored beside the call. */
  criterionProposed: z
    .record(z.string(), z.enum(["competent", "not_yet_competent"]))
    .optional(),
});

/**
 * How many learners are on the cohort this learner sits in for this course.
 *
 * A learner can be on more than one cohort over time, so the largest current
 * one is taken: moderating to the bigger cohort's floor is the safe direction
 * to be wrong in, and the alternative is choosing arbitrarily between them.
 *
 * Only current members count. Somebody who left the programme is not a
 * candidate whose script could be sampled.
 */
async function cohortSizeForLearner(
  tx: TenantDatabase,
  courseId: string,
  userId: string,
): Promise<number | null> {
  // The cohorts on this course the learner is currently a member of.
  const mine = await tx
    .select({ cohortId: cohortMembers.cohortId })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .where(
      and(
        eq(cohorts.courseId, courseId),
        eq(cohortMembers.userId, userId),
        isNull(cohortMembers.leftAt),
      ),
    );

  if (mine.length === 0) return null;

  const sizes = await tx
    .select({ cohortId: cohortMembers.cohortId, size: count() })
    .from(cohortMembers)
    .where(
      and(
        inArray(
          cohortMembers.cohortId,
          mine.map((row) => row.cohortId),
        ),
        isNull(cohortMembers.leftAt),
      ),
    )
    .groupBy(cohortMembers.cohortId);

  if (sizes.length === 0) return null;

  // A learner can sit on more than one cohort for the same course over time.
  // The largest is taken, because moderating to the bigger cohort's floor is
  // the safe direction to be wrong in, and the alternative is choosing
  // arbitrarily between them.
  return Math.max(...sizes.map((row) => Number(row.size)));
}

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

    // An oral third attempt leaves no evidence of its own. Refused here rather
    // than only on the screen, because the screen is not the only way in and
    // this is what makes an oral pass defensible at verification.
    await assertOralRecorded(session, parsed.submissionId);

    // The wall between developmental and summative work. A workbook produces
    // no competence decision, so per-criterion judgements recorded against one
    // would reach the criterion ledger and carry a learner towards eligibility
    // on practice exercises. Refused rather than ignored: an ignored write
    // looks, to whoever made it, exactly like one that worked.
    if (parsed.criterionOutcomes && submission.assessmentId) {
      const [assessment] = await tx
        .select({ purpose: assessments.purpose, title: assessments.title })
        .from(assessments)
        .where(eq(assessments.id, submission.assessmentId));

      if (assessment?.purpose === "formative") {
        throw new AssessmentError(
          `"${assessment.title}" is developmental, so it cannot record competence against criteria. ` +
            `Return feedback on it instead.`,
          "not_permitted",
        );
      }
    }

    // Departing from the arithmetic is expected and often right — the marks
    // are not the whole picture. What is refused is departing from it in
    // silence, because an unexplained override is indistinguishable at audit
    // from a mistake.
    if (parsed.criterionProposed && parsed.criterionOutcomes) {
      const unexplained = Object.entries(parsed.criterionOutcomes)
        .filter(([criterionId, outcome]) => {
          const proposed = parsed.criterionProposed![criterionId];
          if (!proposed || proposed === outcome) return false;
          return !parsed.criterionNotes?.[criterionId]?.trim();
        })
        .map(([criterionId]) => criterionId);

      if (unexplained.length > 0) {
        throw new AssessmentError(
          `You have changed ${unexplained.length === 1 ? "a criterion" : `${unexplained.length} criteria`} from what the marks proposed. ` +
            `Say why — practical performance and workplace evidence do not reach the platform, and the reason has to.`,
          "invalid_state",
        );
      }
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
        criterionProposed: parsed.criterionProposed ?? null,
        criterionNotes: parsed.criterionNotes ?? null,
        score,
        comments: parsed.comments ?? null,
        signedAt: new Date(),
      })
      .returning();

    // How big is the cohort this learner sits in for this course? QCTO policy
    // raises the moderation floor as a cohort shrinks, so the rate cannot be
    // read from the assessment alone.
    //
    // Null where the learner is on no cohort at all, which is an individual
    // enrolment rather than a scheduled intake. There is no cohort rule to
    // apply to one person, so the configured rate stands.
    const cohortSize = assessment.courseId
      ? await cohortSizeForLearner(tx, assessment.courseId, submission.userId)
      : null;

    const required = moderationRateFor({
      cohortSize,
      configuredRate: Number(assessment.moderationSampleRate),
    });

    const sampling = shouldModerate({
      sampleRate: required.rate,
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
        cohortSize,
        moderationRate: required.rate,
        moderationRule: required.reason,
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

    return { decision, moderation: sampling, learnerId: submission.userId };
  }).then(async (result) => {
    // Badges, from the same reading of the criterion ledger that decides
    // readiness. Attempted outside the transaction and swallowed on failure:
    // a badge is recognition, and no failure to hand one out may roll back an
    // assessor's signed decision.
    //
    // A learner whose result is not yet competent can still have completed a
    // different module on the same qualification, so this is not gated on the
    // outcome - it awards whatever is now true and nothing else.
    try {
      const timeZone = await withTenant(
        session.organisationId,
        async (tx) => {
          const [row] = await tx
            .select({ timezone: organisations.timezone })
            .from(organisations)
            .where(eq(organisations.id, session.organisationId));
          return row?.timezone ?? DEFAULT_TIME_ZONE;
        },
      );

      await awardBadgesForLearner(session, result.learnerId, timeZone);
    } catch (error) {
      console.error("Badge award failed", error);
    }

    return result;
  });
}

/**
 * Awards any badge this learner has now earned across every qualification
 * they are on.
 *
 * Reads readiness rather than re-deriving completion, so a badge can never
 * claim something the assessment record does not. Readiness is the expensive
 * part; it runs once per qualification the learner is actually enrolled on.
 */
async function awardBadgesForLearner(
  session: AuthenticatedSession,
  learnerId: string,
  timeZone: string,
): Promise<void> {
  const qualificationIds = await withTenant(
    session.organisationId,
    async (tx) => {
      const rows = await tx
        .selectDistinct({ id: enrolments.qualificationId })
        .from(enrolments)
        .where(eq(enrolments.userId, learnerId));

      return rows
        .map((row) => row.id)
        .filter((id): id is string => id !== null);
    },
  );

  for (const qualificationId of qualificationIds) {
    const readiness = await qualificationReadiness(
      session,
      qualificationId,
      learnerId,
    );

    const completed = readiness.components
      .flatMap((component) => component.modules)
      .filter((module) => module.complete && module.competenceAchievedAt)
      .map((module) => ({
        curriculumModuleId: module.moduleId,
        // The date the last criterion was achieved, on the provider's own
        // calendar rather than the server's - a badge earned at 01:00 in
        // Johannesburg was not earned yesterday.
        completedOn: dateInZone(
          module.competenceAchievedAt as Date,
          timeZone,
        ),
      }));

    await awardEarnedBadges(session.organisationId, learnerId, completed);
  }
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
