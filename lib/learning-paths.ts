import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  courses,
  enrolments,
  learningPathCourses,
  learningPaths,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";

/**
 * Learning paths: several courses chained into a programme, with
 * prerequisites and automatic progression from one to the next.
 *
 * The design choice worth understanding is how a locked step is represented.
 * A learner is enrolled only on the courses currently open to them; a locked
 * course simply has no enrolment yet. That means the existing access rule —
 * you may open an enrolment that is yours — already refuses a locked course,
 * with no second permission system to keep in step with the first.
 *
 * Completing a course then creates the enrolment for whatever it unlocks.
 * Progression is a consequence of finishing, not a separate administrative
 * act somebody has to remember.
 */

export class LearningPathError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "invalid_state"
      | "already_enrolled",
  ) {
    super(message);
    this.name = "LearningPathError";
  }
}

export const pathInput = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(4000).optional(),
  qualificationId: z.string().uuid().optional().nullable(),
});

export async function createLearningPath(
  session: AuthenticatedSession,
  input: z.infer<typeof pathInput>,
) {
  assertSessionCan(session, "course:author");
  const parsed = pathInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(learningPaths)
      .values({
        organisationId: session.organisationId,
        title: parsed.title,
        description: parsed.description ?? null,
        qualificationId: parsed.qualificationId || null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "learning_path.created",
      entityType: "learning_path",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export async function listLearningPaths(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const paths = await tx
      .select()
      .from(learningPaths)
      .orderBy(asc(learningPaths.title));

    if (paths.length === 0) return [];

    const steps = await tx
      .select({
        learningPathId: learningPathCourses.learningPathId,
        courseId: courses.id,
        courseTitle: courses.title,
        courseStatus: courses.status,
        sortOrder: learningPathCourses.sortOrder,
        requiresPrevious: learningPathCourses.requiresPrevious,
      })
      .from(learningPathCourses)
      .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
      .where(
        inArray(
          learningPathCourses.learningPathId,
          paths.map((path) => path.id),
        ),
      )
      .orderBy(asc(learningPathCourses.sortOrder));

    return paths.map((path) => ({
      ...path,
      steps: steps.filter((step) => step.learningPathId === path.id),
    }));
  });
}

export async function getLearningPath(
  session: AuthenticatedSession,
  pathId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [path] = await tx
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId));

    if (!path) {
      throw new LearningPathError("Learning path not found.", "not_found");
    }

    const steps = await tx
      .select({
        id: learningPathCourses.id,
        courseId: courses.id,
        title: courses.title,
        status: courses.status,
        sortOrder: learningPathCourses.sortOrder,
        requiresPrevious: learningPathCourses.requiresPrevious,
      })
      .from(learningPathCourses)
      .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
      .where(eq(learningPathCourses.learningPathId, pathId))
      .orderBy(asc(learningPathCourses.sortOrder));

    const [{ enrolled }] = await tx
      .select({ enrolled: count() })
      .from(enrolments)
      .where(eq(enrolments.learningPathId, pathId));

    return { path, steps, enrolled };
  });
}

/** Courses that can still be added: published, and not already in the path. */
export async function availableCourses(
  session: AuthenticatedSession,
  pathId: string,
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const already = await tx
      .select({ courseId: learningPathCourses.courseId })
      .from(learningPathCourses)
      .where(eq(learningPathCourses.learningPathId, pathId));

    const taken = new Set(already.map((row) => row.courseId));

    const published = await tx
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.status, "published"))
      .orderBy(asc(courses.title));

    return published.filter((course) => !taken.has(course.id));
  });
}

export async function addCourseToPath(
  session: AuthenticatedSession,
  pathId: string,
  courseId: string,
  requiresPrevious = true,
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    await assertPathIsEditable(tx, pathId);

    const [course] = await tx
      .select({ status: courses.status })
      .from(courses)
      .where(eq(courses.id, courseId));

    if (!course) {
      throw new LearningPathError("Course not found.", "not_found");
    }

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(learningPathCourses)
      .where(eq(learningPathCourses.learningPathId, pathId));

    const [created] = await tx
      .insert(learningPathCourses)
      .values({
        organisationId: session.organisationId,
        learningPathId: pathId,
        courseId,
        sortOrder: existing,
        requiresPrevious: requiresPrevious ? 1 : 0,
      })
      .returning();

    return created;
  });
}

export async function removeCourseFromPath(
  session: AuthenticatedSession,
  pathId: string,
  courseId: string,
) {
  assertSessionCan(session, "course:author");

  await withTenant(session.organisationId, async (tx) => {
    await assertPathIsEditable(tx, pathId);

    await tx
      .delete(learningPathCourses)
      .where(
        and(
          eq(learningPathCourses.learningPathId, pathId),
          eq(learningPathCourses.courseId, courseId),
        ),
      );

    // Close the gap the removal left, or the ordering drifts from 0,1,2 and
    // "the next step" stops meaning what it looks like.
    const remaining = await tx
      .select({ id: learningPathCourses.id })
      .from(learningPathCourses)
      .where(eq(learningPathCourses.learningPathId, pathId))
      .orderBy(asc(learningPathCourses.sortOrder));

    for (const [index, row] of remaining.entries()) {
      await tx
        .update(learningPathCourses)
        .set({ sortOrder: index })
        .where(eq(learningPathCourses.id, row.id));
    }
  });
}

export async function moveCourseInPath(
  session: AuthenticatedSession,
  pathId: string,
  courseId: string,
  direction: "up" | "down",
) {
  assertSessionCan(session, "course:author");

  await withTenant(session.organisationId, async (tx) => {
    await assertPathIsEditable(tx, pathId);

    const rows = await tx
      .select({
        id: learningPathCourses.id,
        courseId: learningPathCourses.courseId,
      })
      .from(learningPathCourses)
      .where(eq(learningPathCourses.learningPathId, pathId))
      .orderBy(asc(learningPathCourses.sortOrder));

    const index = rows.findIndex((row) => row.courseId === courseId);
    if (index === -1) {
      throw new LearningPathError("That course is not in this path.", "not_found");
    }

    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return;

    [rows[index], rows[target]] = [rows[target], rows[index]];

    for (const [position, row] of rows.entries()) {
      await tx
        .update(learningPathCourses)
        .set({ sortOrder: position })
        .where(eq(learningPathCourses.id, row.id));
    }
  });
}

/**
 * A published path is being worked through by people. Reordering or removing
 * a step underneath them would change what they had already been told to do,
 * so the shape is fixed once it is in use.
 */
async function assertPathIsEditable(tx: TenantDatabase, pathId: string) {
  const [path] = await tx
    .select({ status: learningPaths.status })
    .from(learningPaths)
    .where(eq(learningPaths.id, pathId));

  if (!path) {
    throw new LearningPathError("Learning path not found.", "not_found");
  }

  if (path.status !== "draft") {
    throw new LearningPathError(
      "This programme is published and people are working through it. Its steps cannot be changed.",
      "invalid_state",
    );
  }
}

export type PathPublishResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

export async function publishLearningPath(
  session: AuthenticatedSession,
  pathId: string,
): Promise<PathPublishResult> {
  assertSessionCan(session, "course:publish");

  return withTenant(session.organisationId, async (tx) => {
    const [path] = await tx
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId));

    if (!path) {
      throw new LearningPathError("Learning path not found.", "not_found");
    }

    if (path.status === "published") {
      throw new LearningPathError(
        "This programme is already published.",
        "invalid_state",
      );
    }

    const steps = await tx
      .select({ title: courses.title, status: courses.status })
      .from(learningPathCourses)
      .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
      .where(eq(learningPathCourses.learningPathId, pathId));

    const reasons: string[] = [];

    if (steps.length === 0) {
      reasons.push("The programme has no courses in it.");
    }

    // Assigning a draft course would put learners on material whose own
    // publish gate has not confirmed it covers what it claims to.
    const drafts = steps.filter((step) => step.status !== "published");
    if (drafts.length > 0) {
      reasons.push(
        `${drafts.length === 1 ? "A course is" : "Some courses are"} not published yet: ${drafts
          .map((step) => `"${step.title}"`)
          .join(", ")}.`,
      );
    }

    if (reasons.length > 0) {
      return { ok: false as const, reasons };
    }

    await tx
      .update(learningPaths)
      .set({ status: "published" })
      .where(eq(learningPaths.id, pathId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "learning_path.published",
      entityType: "learning_path",
      entityId: pathId,
      after: { steps: steps.length },
    });

    return { ok: true as const };
  });
}

/**
 * Assigns a learner to a programme.
 *
 * Creates the path enrolment plus enrolments for whatever is open at the
 * start: the first course, and any later step marked as not requiring the one
 * before it. The rest arrive as they are unlocked.
 */
export async function enrolOnPath(
  session: AuthenticatedSession,
  userId: string,
  pathId: string,
  dueDate?: string,
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [path] = await tx
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId));

    if (!path) {
      throw new LearningPathError("Learning path not found.", "not_found");
    }

    if (path.status !== "published") {
      throw new LearningPathError(
        "Only a published programme can be assigned.",
        "invalid_state",
      );
    }

    const [existing] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, userId),
          eq(enrolments.learningPathId, pathId),
        ),
      );

    if (existing) {
      throw new LearningPathError(
        "That person is already on this programme.",
        "already_enrolled",
      );
    }

    const [pathEnrolment] = await tx
      .insert(enrolments)
      .values({
        organisationId: session.organisationId,
        userId,
        learningPathId: pathId,
        enrolledById: session.userId,
        enrolmentSource: "learning_path",
        dueDate: dueDate ? new Date(dueDate) : null,
      })
      .returning();

    await openAvailableSteps(tx, session.organisationId, userId, pathId, {
      enrolledById: session.userId,
      dueDate: dueDate ? new Date(dueDate) : null,
    });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "learning_path.enrolled",
      entityType: "enrolment",
      entityId: pathEnrolment.id,
      after: { userId, learningPathId: pathId, title: path.title },
    });

    return pathEnrolment;
  });
}

/**
 * Creates enrolments for every step whose prerequisite is satisfied and which
 * the learner is not already on. Returns the courses newly opened.
 *
 * Written to be safe to call repeatedly: it is invoked on enrolment and again
 * after every course completion, and must never double-enrol.
 */
async function openAvailableSteps(
  tx: TenantDatabase,
  organisationId: string,
  userId: string,
  pathId: string,
  options: { enrolledById: string | null; dueDate: Date | null },
): Promise<string[]> {
  const steps = await tx
    .select({
      courseId: learningPathCourses.courseId,
      sortOrder: learningPathCourses.sortOrder,
      requiresPrevious: learningPathCourses.requiresPrevious,
    })
    .from(learningPathCourses)
    .where(eq(learningPathCourses.learningPathId, pathId))
    .orderBy(asc(learningPathCourses.sortOrder));

  if (steps.length === 0) return [];

  const theirs = await tx
    .select({ courseId: enrolments.courseId, status: enrolments.status })
    .from(enrolments)
    .where(eq(enrolments.userId, userId));

  const enrolledOn = new Map(
    theirs
      .filter((row) => row.courseId)
      .map((row) => [row.courseId as string, row.status]),
  );

  const opened: string[] = [];

  for (const [index, step] of steps.entries()) {
    if (enrolledOn.has(step.courseId)) continue;

    if (step.requiresPrevious === 1 && index > 0) {
      const previous = steps[index - 1];
      if (enrolledOn.get(previous.courseId) !== "completed") {
        // Locked. Everything after it stays locked too, since each waits on
        // the one before.
        break;
      }
    }

    await tx.insert(enrolments).values({
      organisationId,
      userId,
      courseId: step.courseId,
      enrolledById: options.enrolledById,
      enrolmentSource: "learning_path",
      dueDate: options.dueDate,
    });

    enrolledOn.set(step.courseId, "assigned");
    opened.push(step.courseId);
  }

  return opened;
}

/**
 * Called when a learner completes a course. Opens whatever that unlocks, and
 * closes the programme when every step is done.
 *
 * Takes the transaction it is given so progression happens with the
 * completion itself: a learner who finished the last lesson of step one has
 * step two waiting by the time the page reloads.
 */
export async function advanceLearningPaths(
  tx: TenantDatabase,
  organisationId: string,
  userId: string,
  completedCourseId: string,
): Promise<{ opened: string[]; completedPaths: string[] }> {
  const memberships = await tx
    .select({ learningPathId: learningPathCourses.learningPathId })
    .from(learningPathCourses)
    .where(eq(learningPathCourses.courseId, completedCourseId));

  const opened: string[] = [];
  const completedPaths: string[] = [];

  for (const membership of memberships) {
    const [pathEnrolment] = await tx
      .select()
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, userId),
          eq(enrolments.learningPathId, membership.learningPathId),
        ),
      );

    // On the course, but not on the programme it belongs to. Nothing to do.
    if (!pathEnrolment) continue;

    opened.push(
      ...(await openAvailableSteps(
        tx,
        organisationId,
        userId,
        membership.learningPathId,
        {
          enrolledById: pathEnrolment.enrolledById,
          dueDate: pathEnrolment.dueDate,
        },
      )),
    );

    const steps = await tx
      .select({ courseId: learningPathCourses.courseId })
      .from(learningPathCourses)
      .where(
        eq(learningPathCourses.learningPathId, membership.learningPathId),
      );

    const finished = await tx
      .select({ courseId: enrolments.courseId })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, userId),
          eq(enrolments.status, "completed"),
          inArray(
            enrolments.courseId,
            steps.map((step) => step.courseId),
          ),
        ),
      );

    if (
      finished.length === steps.length &&
      pathEnrolment.status !== "completed"
    ) {
      await tx
        .update(enrolments)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(enrolments.id, pathEnrolment.id));

      await recordAudit(tx, {
        organisationId,
        actorId: userId,
        action: "learning_path.completed",
        entityType: "enrolment",
        entityId: pathEnrolment.id,
        after: { steps: steps.length },
      });

      completedPaths.push(membership.learningPathId);
    }
  }

  return { opened, completedPaths };
}

export type PathStepState = "completed" | "in_progress" | "open" | "locked";

export type LearnerPath = {
  enrolmentId: string;
  pathId: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  steps: {
    courseId: string;
    title: string;
    state: PathStepState;
    /** Present once the step is open; this is what a learner clicks. */
    enrolmentId: string | null;
  }[];
  completedSteps: number;
  totalSteps: number;
};

/** The programmes this person is on, with each step's state. */
export async function myLearningPaths(
  session: AuthenticatedSession,
): Promise<LearnerPath[]> {
  return withTenant(session.organisationId, (tx) =>
    learnerPathsFor(tx, session.userId),
  );
}

/** The same view for somebody else, for an administrator or line manager. */
export async function learningPathsFor(
  session: AuthenticatedSession,
  userId: string,
): Promise<LearnerPath[]> {
  if (userId !== session.userId && !can(session, "enrolment:read_all")) {
    throw new LearningPathError(
      "That belongs to somebody else.",
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, (tx) => learnerPathsFor(tx, userId));
}

async function learnerPathsFor(
  tx: TenantDatabase,
  userId: string,
): Promise<LearnerPath[]> {
  const pathEnrolments = await tx
    .select({
      enrolmentId: enrolments.id,
      pathId: learningPaths.id,
      title: learningPaths.title,
      description: learningPaths.description,
      status: enrolments.status,
      dueDate: enrolments.dueDate,
    })
    .from(enrolments)
    .innerJoin(learningPaths, eq(learningPaths.id, enrolments.learningPathId))
    .where(eq(enrolments.userId, userId))
    .orderBy(asc(learningPaths.title));

  if (pathEnrolments.length === 0) return [];

  const courseEnrolments = await tx
    .select({
      id: enrolments.id,
      courseId: enrolments.courseId,
      status: enrolments.status,
    })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), isNull(enrolments.learningPathId)));

  const byCourse = new Map(
    courseEnrolments
      .filter((row) => row.courseId)
      .map((row) => [row.courseId as string, row]),
  );

  const result: LearnerPath[] = [];

  for (const path of pathEnrolments) {
    const steps = await tx
      .select({
        courseId: learningPathCourses.courseId,
        title: courses.title,
        requiresPrevious: learningPathCourses.requiresPrevious,
      })
      .from(learningPathCourses)
      .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
      .where(eq(learningPathCourses.learningPathId, path.pathId))
      .orderBy(asc(learningPathCourses.sortOrder));

    let completedSteps = 0;

    const mapped = steps.map((step) => {
      const enrolment = byCourse.get(step.courseId);

      // No enrolment means it has not been unlocked yet. That is the whole
      // locking mechanism: there is nothing to open.
      let state: PathStepState = "locked";

      if (enrolment) {
        if (enrolment.status === "completed") {
          state = "completed";
          completedSteps += 1;
        } else if (enrolment.status === "in_progress") {
          state = "in_progress";
        } else {
          state = "open";
        }
      }

      return {
        courseId: step.courseId,
        title: step.title,
        state,
        enrolmentId: enrolment?.id ?? null,
      };
    });

    result.push({
      ...path,
      steps: mapped,
      completedSteps,
      totalSteps: steps.length,
    });
  }

  return result;
}

/** People who can be put on a programme. */
export async function enrollableForPath(session: AuthenticatedSession) {
  assertSessionCan(session, "user:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.status, "active"))
      .orderBy(asc(users.lastName)),
  );
}
