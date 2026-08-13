/**
 * Learning paths, against a live database.
 *
 * Locking is the part with a silent failure mode. A step that opens too early
 * lets somebody take the advanced course before the foundation one and nobody
 * notices; a step that never opens strands them halfway through a programme
 * with no error to report.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  enrolments,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import { getEnrolmentForDelivery, markLessonComplete } from "@/lib/enrolment";
import {
  addCourseToPath,
  createLearningPath,
  enrolOnPath,
  LearningPathError,
  moveCourseInPath,
  myLearningPaths,
  publishLearningPath,
  removeCourseFromPath,
} from "@/lib/learning-paths";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
  };
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("learning path fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });

    for (const role of roles) {
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
    }

    return user.id;
  });
}

/** A published, single-lesson course. */
async function publishedCourse(title: string) {
  const course = await createCourse(admin, { title });
  const section = await addSection(admin, {
    courseId: course.id,
    title: "Section",
  });
  await addLesson(admin, { sectionId: section.id, title: "Lesson" });
  await tagCourseCompetency(admin, course.id, competencyId);
  const result = await publishCourse(admin, course.id);
  if (!result.ok) throw new Error(result.reasons.join(" "));
  return course.id;
}

/** Finishes a course for a learner, given their enrolment. */
async function finishCourse(
  who: AuthenticatedSession,
  enrolmentId: string,
) {
  const delivery = await getEnrolmentForDelivery(who, enrolmentId);
  for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
    await markLessonComplete(who, enrolmentId, lesson.id);
  }
}

/** A published three-step programme. */
async function threeStepPath() {
  const first = await publishedCourse(`Step one ${suffix()}`);
  const second = await publishedCourse(`Step two ${suffix()}`);
  const third = await publishedCourse(`Step three ${suffix()}`);

  const path = await createLearningPath(admin, {
    title: `Programme ${suffix()}`,
    description: "A three-step programme.",
  });

  await addCourseToPath(admin, path.id, first);
  await addCourseToPath(admin, path.id, second);
  await addCourseToPath(admin, path.id, third);

  const published = await publishLearningPath(admin, path.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));

  return { pathId: path.id, courses: [first, second, third] };
}

beforeAll(async () => {
  const slug = `paths-${Date.now()}`;

  const created = await withPlatformScope(
    "learning path fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Learning Path Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({ organisationId: organisation.id, name: "Framework" })
        .returning({ id: competencyFrameworks.id });

      const [competency] = await tx
        .insert(competencies)
        .values({
          organisationId: organisation.id,
          frameworkId: framework.id,
          code: "PTH-01",
          name: "Test competency",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@paths.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@paths.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("learning path teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("building a programme", () => {
  it("keeps courses in the order they were added", async () => {
    const { pathId, courses } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    const enrolled = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    expect(enrolled.steps.map((step) => step.courseId)).toEqual(courses);
  });

  it("reorders and closes the gap when a step is removed", async () => {
    const first = await publishedCourse(`A ${suffix()}`);
    const second = await publishedCourse(`B ${suffix()}`);
    const third = await publishedCourse(`C ${suffix()}`);

    const path = await createLearningPath(admin, { title: `Order ${suffix()}` });
    await addCourseToPath(admin, path.id, first);
    await addCourseToPath(admin, path.id, second);
    await addCourseToPath(admin, path.id, third);

    await moveCourseInPath(admin, path.id, third, "up");
    await removeCourseFromPath(admin, path.id, first);

    await publishLearningPath(admin, path.id);
    await enrolOnPath(admin, learner.userId, path.id);

    const enrolled = (await myLearningPaths(learner)).find(
      (row) => row.pathId === path.id,
    )!;

    // Third moved above second, then first was removed entirely.
    expect(enrolled.steps.map((step) => step.courseId)).toEqual([third, second]);
  });

  /** Assigning a draft course would bypass its own publish gate. */
  it("refuses to publish a programme containing an unpublished course", async () => {
    const published = await publishedCourse(`Ready ${suffix()}`);
    const draft = await createCourse(admin, { title: `Draft ${suffix()}` });

    const path = await createLearningPath(admin, { title: `Mixed ${suffix()}` });
    await addCourseToPath(admin, path.id, published);
    await addCourseToPath(admin, path.id, draft.id);

    const result = await publishLearningPath(admin, path.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("not published yet");
  });

  it("refuses to publish an empty programme", async () => {
    const path = await createLearningPath(admin, { title: `Empty ${suffix()}` });
    const result = await publishLearningPath(admin, path.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("no courses");
  });

  /**
   * People are working through it. Reordering underneath them would change
   * what they had already been told to do.
   */
  it("fixes the steps once the programme is published", async () => {
    const { pathId } = await threeStepPath();
    const extra = await publishedCourse(`Late addition ${suffix()}`);

    await expect(
      addCourseToPath(admin, pathId, extra),
    ).rejects.toMatchObject({ code: "invalid_state" });

    await expect(
      moveCourseInPath(admin, pathId, extra, "up"),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("stops a learner building programmes", async () => {
    await expect(
      createLearningPath(learner, { title: "Mine now" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("assigning a programme", () => {
  it("opens only the first course", async () => {
    const { pathId, courses } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    const path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    expect(path.steps[0].state).toBe("open");
    expect(path.steps[1].state).toBe("locked");
    expect(path.steps[2].state).toBe("locked");

    // A locked step has no enrolment, which is the entire locking mechanism:
    // there is simply nothing to open.
    expect(path.steps[1].enrolmentId).toBeNull();
    void courses;
  });

  it("refuses to assign a draft programme", async () => {
    const course = await publishedCourse(`Solo ${suffix()}`);
    const path = await createLearningPath(admin, { title: `Draft ${suffix()}` });
    await addCourseToPath(admin, path.id, course);

    await expect(
      enrolOnPath(admin, learner.userId, path.id),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("refuses to add the same person twice", async () => {
    const { pathId } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    await expect(
      enrolOnPath(admin, learner.userId, pathId),
    ).rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("stops a learner adding themselves", async () => {
    const { pathId } = await threeStepPath();
    await expect(
      enrolOnPath(learner, learner.userId, pathId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("automatic progression", () => {
  it("opens the next course when one is finished, and no further", async () => {
    const { pathId } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    let path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    await finishCourse(learner, path.steps[0].enrolmentId!);

    path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    expect(path.steps[0].state).toBe("completed");
    expect(path.steps[1].state).toBe("open");
    // Crucially still shut: one step at a time.
    expect(path.steps[2].state).toBe("locked");
  });

  it("completes the programme when the last course is finished", async () => {
    const { pathId } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    for (let step = 0; step < 3; step += 1) {
      const path = (await myLearningPaths(learner)).find(
        (row) => row.pathId === pathId,
      )!;
      await finishCourse(learner, path.steps[step].enrolmentId!);
    }

    const path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    expect(path.completedSteps).toBe(3);
    expect(path.status).toBe("completed");
    expect(path.steps.every((step) => step.state === "completed")).toBe(true);
  });

  it("opens a step marked as not requiring the one before it straight away", async () => {
    const first = await publishedCourse(`Sequential ${suffix()}`);
    const anytime = await publishedCourse(`Anytime ${suffix()}`);

    const path = await createLearningPath(admin, {
      title: `Optional order ${suffix()}`,
    });
    await addCourseToPath(admin, path.id, first);
    await addCourseToPath(admin, path.id, anytime, false);
    await publishLearningPath(admin, path.id);

    await enrolOnPath(admin, learner.userId, path.id);

    const enrolled = (await myLearningPaths(learner)).find(
      (row) => row.pathId === path.id,
    )!;

    expect(enrolled.steps[0].state).toBe("open");
    expect(enrolled.steps[1].state).toBe("open");
  });

  it("carries the programme's due date onto each course as it opens", async () => {
    const { pathId } = await threeStepPath();
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString();

    await enrolOnPath(admin, learner.userId, pathId, due);

    let path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;
    await finishCourse(learner, path.steps[0].enrolmentId!);

    path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;

    const [second] = await withTenant(organisationId, (tx) =>
      tx
        .select({ dueDate: enrolments.dueDate })
        .from(enrolments)
        .where(eq(enrolments.id, path.steps[1].enrolmentId!)),
    );

    expect(second.dueDate).not.toBeNull();
  });

  /**
   * Progression runs on every completion, so it must never create a second
   * enrolment for a course the learner already has.
   */
  it("does not enrol anybody twice when progression runs again", async () => {
    const { pathId, courses } = await threeStepPath();
    await enrolOnPath(admin, learner.userId, pathId);

    const path = (await myLearningPaths(learner)).find(
      (row) => row.pathId === pathId,
    )!;
    await finishCourse(learner, path.steps[0].enrolmentId!);

    // Completing the same lessons again re-runs progression.
    await finishCourse(learner, path.steps[0].enrolmentId!);

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(eq(enrolments.courseId, courses[1])),
    );

    expect(rows).toHaveLength(1);
  });

  it("leaves somebody who is on the course but not the programme alone", async () => {
    const { pathId, courses } = await threeStepPath();

    // On the first course directly, never added to the programme.
    const other = sessionFor(
      ["learner"],
      await createPerson(`solo-${suffix()}@paths.test`, ["learner"]),
    );

    const { enrolUser } = await import("@/lib/enrolment");
    const enrolment = await enrolUser(admin, {
      userId: other.userId,
      courseId: courses[0],
    });
    await finishCourse(other, enrolment.id);

    // Finishing it must not silently sign them up to the rest of a programme
    // nobody put them on.
    const theirs = await withTenant(organisationId, (tx) =>
      tx
        .select({ courseId: enrolments.courseId })
        .from(enrolments)
        .where(eq(enrolments.userId, other.userId)),
    );

    expect(theirs.map((row) => row.courseId)).toEqual([courses[0]]);
    void pathId;
  });
});

describe("errors", () => {
  it("is a typed error, so callers can tell cases apart", async () => {
    await expect(
      publishLearningPath(admin, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(LearningPathError);
  });
});

