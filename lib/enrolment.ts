import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  courseSections,
  courses,
  enrolments,
  lessons,
  progressRecords,
  users,
} from "@/db/schema";
import { assertLessonStepOpen } from "./spine";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";
import { issueCertificateAutomatically } from "./certificates";
import { advanceLearningPaths } from "./learning-paths";
import { raise } from "./notifications";
import { awardCompletionBadgeIn } from "./badges";

/**
 * Enrolment, delivery and progress.
 *
 * The rule that runs through this file: a learner may read and change their
 * own enrolment and nobody else's. That is checked here, at the point the data
 * is fetched, rather than in the pages — a page can be added later without
 * remembering the check, and there is more than one way to reach an enrolment.
 *
 * Tenant separation is already handled underneath by row-level security. This
 * is the layer above it: separation between people within one client.
 */

export class EnrolmentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "not_publishable"
      | "already_enrolled"
      | "invalid_state",
  ) {
    super(message);
    this.name = "EnrolmentError";
  }
}

export const enrolInput = z.object({
  userId: z.string().uuid(),
  courseId: z.string().uuid(),
  dueDate: z.string().trim().optional(),
  /**
   * Set when this enrolment counts towards an accredited qualification. It is
   * what puts the learner on the EISA readiness cohort, so an occupational
   * programme enrolled without it looks like ordinary corporate training and
   * silently never appears in the facilitator's list.
   */
  qualificationId: z.string().uuid().optional(),
});

/**
 * Assigns one learner to one course.
 *
 * Only a published course can be assigned. A draft is unfinished by
 * definition, and its publish gate has not yet confirmed that its content
 * covers what it claims to.
 */
export async function enrolUser(
  session: AuthenticatedSession,
  input: z.infer<typeof enrolInput>,
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = enrolInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({ id: courses.id, status: courses.status, title: courses.title })
      .from(courses)
      .where(eq(courses.id, parsed.courseId));

    if (!course) {
      throw new EnrolmentError("Course not found.", "not_found");
    }

    if (course.status !== "published") {
      throw new EnrolmentError(
        "Only a published course can be assigned to a learner.",
        "not_publishable",
      );
    }

    const [existing] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, parsed.userId),
          eq(enrolments.courseId, parsed.courseId),
        ),
      );

    if (existing) {
      throw new EnrolmentError(
        "That person is already enrolled on this course.",
        "already_enrolled",
      );
    }

    const [created] = await tx
      .insert(enrolments)
      .values({
        organisationId: session.organisationId,
        userId: parsed.userId,
        courseId: parsed.courseId,
        qualificationId: parsed.qualificationId ?? null,
        enrolledById: session.userId,
        enrolmentSource: "manual",
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "enrolment.created",
      entityType: "enrolment",
      entityId: created.id,
      after: {
        userId: parsed.userId,
        courseId: parsed.courseId,
        courseTitle: course.title,
      },
    });

    // Raised inside the same transaction: if the enrolment rolls back, so
    // does the message telling somebody about it.
    await raise(tx, {
      organisationId: session.organisationId,
      userId: parsed.userId,
      kind: "enrolment.assigned",
      subject: `You have been assigned "${course.title}"`,
      body: parsed.dueDate
        ? `It is due by ${new Date(parsed.dueDate).toLocaleDateString("en-ZA")}.`
        : "There is no due date on this one.",
      linkPath: `/learn/${created.id}`,
      entityType: "enrolment",
      entityId: created.id,
      dedupeKey: `assigned:${created.id}`,
      channels: ["in_app", "email"],
    });

    return created;
  });
}

export type BulkEnrolResult = {
  enrolled: string[];
  alreadyEnrolled: string[];
  unknown: string[];
};

/**
 * Enrols a list of email addresses at once, the spreadsheet-upload case from
 * Section 4.3.
 *
 * Reports what happened to every address rather than stopping at the first
 * problem. Someone pasting forty addresses needs to know which three were
 * wrong, not that "an error occurred".
 */
export async function bulkEnrol(
  session: AuthenticatedSession,
  courseId: string,
  emails: string[],
  dueDate?: string,
): Promise<BulkEnrolResult> {
  assertSessionCan(session, "enrolment:manage");

  const normalised = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  ];

  const result: BulkEnrolResult = {
    enrolled: [],
    alreadyEnrolled: [],
    unknown: [],
  };

  if (normalised.length === 0) {
    return result;
  }

  const matches = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, normalised)),
  );

  const byEmail = new Map(matches.map((row) => [row.email, row.id]));

  for (const email of normalised) {
    const userId = byEmail.get(email);
    if (!userId) {
      result.unknown.push(email);
      continue;
    }

    try {
      await enrolUser(session, { userId, courseId, dueDate });
      result.enrolled.push(email);
    } catch (error) {
      if (
        error instanceof EnrolmentError &&
        error.code === "already_enrolled"
      ) {
        result.alreadyEnrolled.push(email);
      } else {
        throw error;
      }
    }
  }

  return result;
}

export type LearnerEnrolment = {
  enrolmentId: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  totalLessons: number;
  completedLessons: number;
};

/** Everything the signed-in person is assigned, with their own progress. */
export async function myEnrolments(
  session: AuthenticatedSession,
): Promise<LearnerEnrolment[]> {
  return withTenant(session.organisationId, (tx) =>
    selectEnrolments(tx, eq(enrolments.userId, session.userId)),
  );
}

async function selectEnrolments(
  tx: TenantDatabase,
  where: ReturnType<typeof eq>,
): Promise<LearnerEnrolment[]> {
  return tx
    .select({
      enrolmentId: enrolments.id,
      courseId: courses.id,
      courseTitle: courses.title,
      courseDescription: courses.description,
      status: enrolments.status,
      dueDate: enrolments.dueDate,
      completedAt: enrolments.completedAt,
      totalLessons: sql<number>`(
        select count(*)::int from lessons l
        join course_sections cs on cs.id = l.section_id
        where cs.course_id = courses.id
      )`,
      completedLessons: sql<number>`(
        select count(*)::int from progress_records pr
        where pr.enrolment_id = enrolments.id and pr.state = 'completed'
      )`,
    })
    .from(enrolments)
    .innerJoin(courses, eq(courses.id, enrolments.courseId))
    .where(where)
    .orderBy(asc(courses.title));
}

/** Who is on a course, for an administrator or instructor. */
export async function listCourseEnrolments(
  session: AuthenticatedSession,
  courseId: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        enrolmentId: enrolments.id,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: enrolments.status,
        dueDate: enrolments.dueDate,
        completedAt: enrolments.completedAt,
        totalLessons: sql<number>`(
          select count(*)::int from lessons l
          join course_sections cs on cs.id = l.section_id
          where cs.course_id = ${courseId}
        )`,
        completedLessons: sql<number>`(
          select count(*)::int from progress_records pr
          where pr.enrolment_id = enrolments.id and pr.state = 'completed'
        )`,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(eq(enrolments.courseId, courseId))
      .orderBy(asc(users.lastName), asc(users.firstName)),
  );
}

/**
 * Loads an enrolment for delivery, with the course content and this learner's
 * progress against every lesson.
 *
 * The access rule lives here: it is yours, or you hold a permission that lets
 * you see other people's. Anything else is refused rather than returning an
 * empty result, because "not found" and "not yours" are different answers and
 * conflating them makes bugs hard to see.
 */
export async function getEnrolmentForDelivery(
  session: AuthenticatedSession,
  enrolmentId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));

    if (!enrolment) {
      throw new EnrolmentError("Enrolment not found.", "not_found");
    }

    const isOwn = enrolment.userId === session.userId;
    if (!isOwn && !can(session, "enrolment:read_all")) {
      throw new EnrolmentError(
        "That enrolment belongs to someone else.",
        "not_permitted",
      );
    }

    const [course] = await tx
      .select()
      .from(courses)
      .where(eq(courses.id, enrolment.courseId!));

    const sections = await tx
      .select()
      .from(courseSections)
      .where(eq(courseSections.courseId, enrolment.courseId!))
      .orderBy(asc(courseSections.sortOrder));

    const sectionIds = sections.map((section) => section.id);

    const courseLessons =
      sectionIds.length === 0
        ? []
        : await tx
            .select()
            .from(lessons)
            .where(inArray(lessons.sectionId, sectionIds))
            .orderBy(asc(lessons.sortOrder));

    const progress = await tx
      .select()
      .from(progressRecords)
      .where(eq(progressRecords.enrolmentId, enrolmentId));

    const progressByLesson = new Map(
      progress.map((record) => [record.lessonId, record]),
    );

    return {
      enrolment,
      course,
      isOwn,
      sections: sections.map((section) => ({
        ...section,
        lessons: courseLessons
          .filter((lesson) => lesson.sectionId === section.id)
          .map((lesson) => ({
            ...lesson,
            state: progressByLesson.get(lesson.id)?.state ?? "not_started",
          })),
      })),
      totalLessons: courseLessons.length,
      completedLessons: progress.filter(
        (record) => record.state === "completed",
      ).length,
    };
  });
}

/**
 * Records that a learner finished a lesson.
 *
 * Only the learner themselves may do this. An administrator can see progress
 * but cannot mark work as done on someone's behalf — a completion record that
 * an administrator could fabricate is worth nothing at an audit.
 */
export async function markLessonComplete(
  session: AuthenticatedSession,
  enrolmentId: string,
  lessonId: string,
) {
  // Checked before the transaction opens rather than inside it: the guard runs
  // its own tenant-scoped read, and nesting one transaction inside another
  // takes a second connection that does not carry this one's tenant setting.
  //
  // A course with no spine is not gated, so this is a no-op there.
  await assertLessonStepOpen(session, lessonId);

  return withTenant(session.organisationId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));

    if (!enrolment) {
      throw new EnrolmentError("Enrolment not found.", "not_found");
    }

    if (enrolment.userId !== session.userId) {
      throw new EnrolmentError(
        "Only the learner can record their own progress.",
        "not_permitted",
      );
    }

    if (enrolment.status === "withdrawn") {
      throw new EnrolmentError(
        "This enrolment has been withdrawn.",
        "invalid_state",
      );
    }

    // The lesson must belong to the course this enrolment is for. Without
    // this, a crafted request could record progress against any lesson in
    // the tenant and complete a course the learner never opened.
    const [lesson] = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .where(
        and(
          eq(lessons.id, lessonId),
          eq(courseSections.courseId, enrolment.courseId!),
        ),
      );

    if (!lesson) {
      throw new EnrolmentError(
        "That lesson is not part of this course.",
        "not_found",
      );
    }

    const now = new Date();

    await tx
      .insert(progressRecords)
      .values({
        organisationId: session.organisationId,
        enrolmentId,
        lessonId,
        state: "completed",
        firstAccessedAt: now,
        lastAccessedAt: now,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [progressRecords.enrolmentId, progressRecords.lessonId],
        set: { state: "completed", lastAccessedAt: now, completedAt: now },
      });

    if (enrolment.status === "assigned") {
      await tx
        .update(enrolments)
        .set({ status: "in_progress", startedAt: enrolment.startedAt ?? now })
        .where(eq(enrolments.id, enrolmentId));
    }

    return refreshCompletion(tx, enrolmentId, session);
  }).then(async (result) => {
    // Finishing the last lesson can be the moment a certificate becomes due.
    // Issued outside the transaction above so that a failure here cannot roll
    // back the learner's progress — the certificate is retried on the next
    // qualifying event, but their completed lesson must stick.
    if (result.completed) {
      try {
        await issueCertificateAutomatically(session.organisationId, enrolmentId);
      } catch (error) {
        console.error("Automatic certificate issue failed", error);
      }
    }
    return result;
  });
}

/**
 * Marks the enrolment complete once every lesson is done, and records it.
 * Completion is derived from progress rather than set by hand, so it cannot
 * drift away from what the learner actually did.
 */
async function refreshCompletion(
  tx: TenantDatabase,
  enrolmentId: string,
  session: AuthenticatedSession,
) {
  const [enrolment] = await tx
    .select()
    .from(enrolments)
    .where(eq(enrolments.id, enrolmentId));

  const [{ total }] = await tx
    .select({ total: count() })
    .from(lessons)
    .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
    .where(eq(courseSections.courseId, enrolment.courseId!));

  const [{ done }] = await tx
    .select({ done: count() })
    .from(progressRecords)
    .where(
      and(
        eq(progressRecords.enrolmentId, enrolmentId),
        eq(progressRecords.state, "completed"),
      ),
    );

  const finished = total > 0 && done >= total;

  if (finished && enrolment.status !== "completed") {
    const completedAt = new Date();
    await tx
      .update(enrolments)
      .set({ status: "completed", completedAt })
      .where(eq(enrolments.id, enrolmentId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "enrolment.completed",
      entityType: "enrolment",
      entityId: enrolmentId,
      after: { lessonsCompleted: done, lessonsTotal: total },
    });

    // Unlock whatever this course opens in any programme the learner is on.
    // Done inside the same transaction so the next step is waiting by the
    // time the page reloads, rather than appearing on some later request.
    await advanceLearningPaths(
      tx,
      session.organisationId,
      enrolment.userId,
      enrolment.courseId!,
    );

    // And the badge for finishing it, if one is designed - the course's own,
    // or the provider's default, or nothing at all. Same transaction as the
    // completion it recognises, so the two cannot disagree.
    await awardCompletionBadgeIn(tx, session.organisationId, enrolment.userId, {
      kind: "course",
      id: enrolment.courseId!,
      completedOn: completedAt.toISOString().slice(0, 10),
    });
  }

  return { total, done, completed: finished };
}

/**
 * Flags enrolments whose due date has passed. Run on a schedule; safe to
 * repeat. Kept as a query rather than computed in the interface so that a
 * report and a reminder email cannot disagree about who is overdue.
 */
export async function markOverdueEnrolments(
  organisationId: string,
): Promise<number> {
  return withTenant(organisationId, async (tx) => {
    const updated = await tx
      .update(enrolments)
      .set({ status: "overdue" })
      .where(
        and(
          sql`${enrolments.dueDate} < now()`,
          isNull(enrolments.completedAt),
          or(
            eq(enrolments.status, "assigned"),
            eq(enrolments.status, "in_progress"),
          ),
        ),
      )
      .returning({ id: enrolments.id });

    return updated.length;
  });
}

/** People who can be enrolled, for the assignment screen. */
export async function listEnrollableUsers(session: AuthenticatedSession) {
  assertSessionCan(session, "user:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        jobTitle: users.jobTitle,
      })
      .from(users)
      .where(eq(users.status, "active"))
      .orderBy(asc(users.lastName), asc(users.firstName)),
  );
}
