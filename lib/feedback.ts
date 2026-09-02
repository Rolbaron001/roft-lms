import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessments,
  cohortMembers,
  cohorts,
  feedbackQuestionnaires,
  feedbackRequests,
  feedbackResponses,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Programme feedback.
 *
 * The procedure sends a form the day after a summative, gives learners 48
 * hours, and files what comes back in a folder per cohort and study unit. Two
 * of those three steps disappear once the form lives in the platform: the
 * facilitator no longer acknowledges receipt, because receipt is a row, and
 * nobody transcribes anything into a consolidated spreadsheet, because
 * consolidation is a query.
 *
 * What is gained is the two questions the folder could never answer. Which
 * cohorts were never asked. And which learners have not answered yet, while
 * there is still time to ask them again.
 *
 * Names are recorded and never displayed. The facilitator has to know who
 * still owes a form in order to chase them, so the response carries a learner;
 * the consolidated view shows answers together and unattributed, because
 * feedback about a facilitator is only honest if the learner believes it will
 * not be read back to them by name. That is a display decision rather than
 * anonymity - the link is in the table - and the wording shown to learners says
 * only that responses are reported together, which is true.
 */

export class FeedbackError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "already_asked"
      | "already_answered"
      | "closed"
      | "not_a_member",
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}

/** Hours a learner has to answer, from the client's procedure. */
export const HOURS_TO_RESPOND = 48;

export type FeedbackQuestion = {
  key: string;
  prompt: string;
  kind: "rating" | "text";
  required: boolean;
};

/**
 * The question set a tenant gets before it has written its own.
 *
 * Defensible rather than authoritative. The client's real form is a Google
 * Form that was not among the documents handed over; when it arrives it
 * replaces this, and no code changes to let it. Keys are stable identifiers
 * and must never be reused for a different question.
 */
export const DEFAULT_QUESTIONS: FeedbackQuestion[] = [
  {
    key: "facilitation",
    prompt: "The facilitator explained the material clearly.",
    kind: "rating",
    required: true,
  },
  {
    key: "materials",
    prompt: "The workbooks and materials were useful.",
    kind: "rating",
    required: true,
  },
  {
    key: "pace",
    prompt: "The pace suited me.",
    kind: "rating",
    required: true,
  },
  {
    key: "workplace_relevance",
    prompt: "I can use what I learned in my job.",
    kind: "rating",
    required: true,
  },
  {
    key: "assessment_fair",
    prompt: "The assessment was a fair test of what was taught.",
    kind: "rating",
    required: true,
  },
  {
    key: "worked_well",
    prompt: "What worked well?",
    kind: "text",
    required: false,
  },
  {
    key: "would_change",
    prompt: "What would you change?",
    kind: "text",
    required: false,
  },
];

/**
 * The tenant's active questionnaire, creating the default one on first use.
 *
 * Created rather than assumed, so that a response always points at a stored
 * version of the questions it answered. Reading a rating without knowing what
 * was asked is how a report ends up averaging two different questions.
 */
export async function activeQuestionnaire(session: AuthenticatedSession) {
  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(feedbackQuestionnaires)
      .where(eq(feedbackQuestionnaires.active, true))
      .orderBy(desc(feedbackQuestionnaires.createdAt))
      .limit(1);

    if (existing) return existing;

    const [created] = await tx
      .insert(feedbackQuestionnaires)
      .values({
        organisationId: session.organisationId,
        name: "Programme feedback",
        questions: DEFAULT_QUESTIONS,
        active: true,
      })
      .returning();

    return created;
  });
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

const askInput = z.object({
  cohortId: z.string().uuid(),
  assessmentId: z.string().uuid().optional(),
});

/**
 * Asks a cohort for feedback.
 *
 * Refuses to ask twice for the same summative. A second request would restart
 * a deadline that has already run and split one set of answers across two
 * reports, and the person sending it is usually somebody who could not tell
 * whether it had gone out.
 */
export async function requestFeedback(
  session: AuthenticatedSession,
  input: z.input<typeof askInput>,
) {
  assertSessionCan(session, "session:manage");
  const parsed = askInput.parse(input);
  const questionnaire = await activeQuestionnaire(session);

  return withTenant(session.organisationId, async (tx) => {
    const [already] = await tx
      .select({ id: feedbackRequests.id, sentAt: feedbackRequests.sentAt })
      .from(feedbackRequests)
      .where(
        and(
          eq(feedbackRequests.cohortId, parsed.cohortId),
          parsed.assessmentId
            ? eq(feedbackRequests.assessmentId, parsed.assessmentId)
            : eq(feedbackRequests.cohortId, parsed.cohortId),
        ),
      );

    if (already && parsed.assessmentId) {
      throw new FeedbackError(
        "This cohort has already been asked about that assessment. Asking again would restart a deadline that has run and split the answers across two reports.",
        "already_asked",
      );
    }

    const now = new Date();
    const [created] = await tx
      .insert(feedbackRequests)
      .values({
        organisationId: session.organisationId,
        cohortId: parsed.cohortId,
        assessmentId: parsed.assessmentId ?? null,
        questionnaireId: questionnaire.id,
        sentById: session.userId,
        sentAt: now,
        dueAt: new Date(now.getTime() + HOURS_TO_RESPOND * 3_600_000),
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "feedback.requested",
      entityType: "feedback_request",
      entityId: created.id,
      after: {
        cohortId: created.cohortId,
        assessmentId: created.assessmentId,
        dueAt: created.dueAt,
      },
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Records a learner's answers.
 *
 * A late response is recorded rather than refused. Feedback is voluntary and is
 * worth having whenever it arrives; the deadline exists to say whether the
 * provider asked in time, not to punish a learner for answering on the third
 * day. What is refused is answering twice, because a second set of answers
 * would either overwrite the first silently or be counted alongside it.
 */
export async function submitFeedback(
  session: AuthenticatedSession,
  input: { requestId: string; answers: Record<string, string | number> },
) {
  assertSessionCan(session, "assessment:take");

  return withTenant(session.organisationId, async (tx) => {
    const [request] = await tx
      .select()
      .from(feedbackRequests)
      .where(eq(feedbackRequests.id, input.requestId));

    if (!request) throw new FeedbackError("Not found.", "not_found");
    if (request.closedAt) {
      throw new FeedbackError("That request has been closed.", "closed");
    }

    const [member] = await tx
      .select({ id: cohortMembers.id })
      .from(cohortMembers)
      .where(
        and(
          eq(cohortMembers.cohortId, request.cohortId),
          eq(cohortMembers.userId, session.userId),
        ),
      );

    if (!member) {
      throw new FeedbackError(
        "You are not on that cohort.",
        "not_a_member",
      );
    }

    const [existing] = await tx
      .select({ id: feedbackResponses.id })
      .from(feedbackResponses)
      .where(
        and(
          eq(feedbackResponses.requestId, input.requestId),
          eq(feedbackResponses.learnerId, session.userId),
        ),
      );

    if (existing) {
      throw new FeedbackError(
        "You have already answered this one. Thank you.",
        "already_answered",
      );
    }

    const [questionnaire] = await tx
      .select()
      .from(feedbackQuestionnaires)
      .where(eq(feedbackQuestionnaires.id, request.questionnaireId));

    const missing = (questionnaire?.questions ?? [])
      .filter((question) => question.required)
      .filter((question) => {
        const answer = input.answers[question.key];
        return answer === undefined || answer === "" || answer === null;
      });

    if (missing.length > 0) {
      throw new FeedbackError(
        `Still to answer: ${missing.map((question) => question.prompt).join(" ")}`,
        "invalid",
      );
    }

    const now = new Date();
    const [created] = await tx
      .insert(feedbackResponses)
      .values({
        organisationId: session.organisationId,
        requestId: input.requestId,
        learnerId: session.userId,
        answers: input.answers,
        submittedAt: now,
        late: now > request.dueAt,
      })
      .returning();

    return created;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type FeedbackSummary = {
  requestId: string;
  cohortId: string;
  cohortName: string;
  assessmentTitle: string | null;
  sentAt: Date;
  dueAt: Date;
  closedAt: Date | null;
  invited: number;
  answered: number;
  late: number;
  questions: FeedbackQuestion[];
  /** Mean per rating question, to one decimal, and how many answered it. */
  ratings: { key: string; prompt: string; mean: number; count: number }[];
  /** Free text, unattributed and in no particular order. */
  comments: { key: string; prompt: string; text: string }[];
  /** Who has not answered. Names, because chasing needs them. */
  outstanding: { id: string; name: string }[];
};

/**
 * One request, consolidated.
 *
 * The report the procedure describes being assembled by hand. Names appear in
 * exactly one place - who still owes a form - and nowhere near the answers.
 */
export async function feedbackSummary(
  session: AuthenticatedSession,
  requestId: string,
): Promise<FeedbackSummary> {
  assertSessionCan(session, "report:tenant");

  return withTenant(session.organisationId, async (tx) => {
    const [request] = await tx
      .select({
        id: feedbackRequests.id,
        cohortId: feedbackRequests.cohortId,
        cohortName: cohorts.name,
        assessmentTitle: assessments.title,
        sentAt: feedbackRequests.sentAt,
        dueAt: feedbackRequests.dueAt,
        closedAt: feedbackRequests.closedAt,
        questions: feedbackQuestionnaires.questions,
      })
      .from(feedbackRequests)
      .innerJoin(cohorts, eq(cohorts.id, feedbackRequests.cohortId))
      .innerJoin(
        feedbackQuestionnaires,
        eq(feedbackQuestionnaires.id, feedbackRequests.questionnaireId),
      )
      .leftJoin(assessments, eq(assessments.id, feedbackRequests.assessmentId))
      .where(eq(feedbackRequests.id, requestId));

    if (!request) throw new FeedbackError("Not found.", "not_found");

    const members = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(eq(cohortMembers.cohortId, request.cohortId));

    const responses = await tx
      .select({
        learnerId: feedbackResponses.learnerId,
        answers: feedbackResponses.answers,
        late: feedbackResponses.late,
      })
      .from(feedbackResponses)
      .where(eq(feedbackResponses.requestId, requestId));

    const answered = new Set(responses.map((row) => row.learnerId));

    const ratings = request.questions
      .filter((question) => question.kind === "rating")
      .map((question) => {
        const values = responses
          .map((row) => Number(row.answers[question.key]))
          .filter((value) => Number.isFinite(value));

        return {
          key: question.key,
          prompt: question.prompt,
          count: values.length,
          mean:
            values.length === 0
              ? 0
              : Math.round(
                  (values.reduce((sum, value) => sum + value, 0) /
                    values.length) *
                    10,
                ) / 10,
        };
      });

    // Shuffled, so that the order of a comment cannot be lined up against the
    // order of the outstanding list to work out who wrote it.
    const comments = request.questions
      .filter((question) => question.kind === "text")
      .flatMap((question) =>
        responses
          .map((row) => String(row.answers[question.key] ?? "").trim())
          .filter((text) => text.length > 0)
          .map((text) => ({ key: question.key, prompt: question.prompt, text })),
      )
      .sort(() => Math.random() - 0.5);

    return {
      requestId: request.id,
      cohortId: request.cohortId,
      cohortName: request.cohortName,
      assessmentTitle: request.assessmentTitle,
      sentAt: request.sentAt,
      dueAt: request.dueAt,
      closedAt: request.closedAt,
      invited: members.length,
      answered: answered.size,
      late: responses.filter((row) => row.late).length,
      questions: request.questions,
      ratings,
      comments,
      outstanding: members
        .filter((member) => !answered.has(member.id))
        .map((member) => ({
          id: member.id,
          name: `${member.firstName} ${member.lastName}`,
        })),
    };
  });
}

/** Every request on a cohort, newest first. */
export async function cohortFeedback(
  session: AuthenticatedSession,
  cohortId: string,
) {
  assertSessionCan(session, "report:tenant");

  return withTenant(session.organisationId, async (tx) => {
    const requests = await tx
      .select({
        id: feedbackRequests.id,
        assessmentTitle: assessments.title,
        sentAt: feedbackRequests.sentAt,
        dueAt: feedbackRequests.dueAt,
        closedAt: feedbackRequests.closedAt,
      })
      .from(feedbackRequests)
      .leftJoin(assessments, eq(assessments.id, feedbackRequests.assessmentId))
      .where(eq(feedbackRequests.cohortId, cohortId))
      .orderBy(desc(feedbackRequests.sentAt));

    if (requests.length === 0) return [];

    const counts = await tx
      .select({
        requestId: feedbackResponses.requestId,
        learnerId: feedbackResponses.learnerId,
      })
      .from(feedbackResponses)
      .where(
        inArray(
          feedbackResponses.requestId,
          requests.map((row) => row.id),
        ),
      );

    const tally = new Map<string, number>();
    for (const row of counts) {
      tally.set(row.requestId, (tally.get(row.requestId) ?? 0) + 1);
    }

    return requests.map((row) => ({
      ...row,
      answered: tally.get(row.id) ?? 0,
    }));
  });
}

/** A learner's outstanding feedback forms, for their own page. */
export async function feedbackOwedBy(
  session: AuthenticatedSession,
  learnerId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const open = await tx
      .select({
        id: feedbackRequests.id,
        cohortName: cohorts.name,
        assessmentTitle: assessments.title,
        dueAt: feedbackRequests.dueAt,
        questions: feedbackQuestionnaires.questions,
      })
      .from(feedbackRequests)
      .innerJoin(cohorts, eq(cohorts.id, feedbackRequests.cohortId))
      .innerJoin(
        cohortMembers,
        and(
          eq(cohortMembers.cohortId, feedbackRequests.cohortId),
          eq(cohortMembers.userId, learnerId),
        ),
      )
      .innerJoin(
        feedbackQuestionnaires,
        eq(feedbackQuestionnaires.id, feedbackRequests.questionnaireId),
      )
      .leftJoin(assessments, eq(assessments.id, feedbackRequests.assessmentId))
      .orderBy(desc(feedbackRequests.sentAt));

    if (open.length === 0) return [];

    const answered = await tx
      .select({ requestId: feedbackResponses.requestId })
      .from(feedbackResponses)
      .where(eq(feedbackResponses.learnerId, learnerId));

    const done = new Set(answered.map((row) => row.requestId));
    return open.filter((row) => !done.has(row.id));
  });
}
