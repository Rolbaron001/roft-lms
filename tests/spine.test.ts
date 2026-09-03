/**
 * The spine and its gates, against a live database.
 *
 * Every test here guards a way a gate could quietly stop being a gate: a
 * locked step that can still be worked by asking directly, a chain that a
 * reorder silently weakens, a prerequisite that can never be satisfied, or an
 * exception that leaves no trace.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  competencies,
  competencyFrameworks,
  assessmentItems,
  courseSteps,
  organisations,
  stepOverrides,
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
import {
  createAssessment,
  addAssessmentItem,
  publishAssessment,
  submitQuiz,
} from "@/lib/assessment";
import { enrolUser, markLessonComplete } from "@/lib/enrolment";
import {
  addPrerequisite,
  addStep,
  blockedLearners,
  grantOverride,
  recordStepOpened,
  removeStep,
  reorderSteps,
  revokeOverride,
  SpineError,
  stepsForLearner,
  assertStepOpen,
} from "@/lib/spine";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let author: AuthenticatedSession;
let learner: AuthenticatedSession;
let other: AuthenticatedSession;

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
    aiOn: false,
  };
}

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("spine test fixture", async (tx) => {
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
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    return user.id;
  });
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A published course with `count` lessons, each already a step on the spine. */
async function buildSpine(count: number) {
  const course = await createCourse(author, { title: `Spine ${suffix()}` });
  const section = await addSection(author, {
    courseId: course.id,
    title: "Section",
  });

  const stepIds: string[] = [];
  const lessonIds: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const lesson = await addLesson(author, {
      sectionId: section.id,
      title: `Lesson ${index + 1}`,
    });
    lessonIds.push(lesson.id);
    const step = await addStep(author, {
      courseId: course.id,
      kind: "lesson",
      lessonId: lesson.id,
      release: index === 0 ? "open" : "sequential",
      sequentialRule: "submitted",
    });
    stepIds.push(step.id);
  }

  await tagCourseCompetency(author, course.id, competencyId);
  const published = await publishCourse(author, course.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));

  return { courseId: course.id, sectionId: section.id, stepIds, lessonIds };
}

beforeAll(async () => {
  const slug = `spine-${Date.now()}`;

  organisationId = await withPlatformScope("spine test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Spine Test Co",
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
        code: "SPN-01",
        name: "Demonstrated capability",
      })
      .returning({ id: competencies.id });

    competencyId = competency.id;
    return organisation.id;
  });

  author = sessionFor(
    ["tenant_admin"],
    await createPerson("author@spine.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@spine.test", ["learner"]),
  );
  other = sessionFor(
    ["learner"],
    await createPerson("other@spine.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("spine test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("walking a spine", () => {
  it("opens the first step and holds the rest shut", async () => {
    const { courseId } = await buildSpine(3);

    const steps = await stepsForLearner(learner, courseId, learner.userId);

    expect(steps).toHaveLength(3);
    expect(steps[0].open).toBe(true);
    expect(steps[1].open).toBe(false);
    expect(steps[2].open).toBe(false);
    // The reason is in words a learner can act on, not a code.
    expect(steps[1].blockedBy[0]).toContain("Lesson 1");
    expect(steps[1].blockedBy[0]).toContain("handed in");
  });

  it("opens the next step once the one before is done", async () => {
    const { courseId, lessonIds } = await buildSpine(3);
    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId,
    });

    await markLessonComplete(learner, enrolment.id, lessonIds[0]);

    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[0].state).toBe("done");
    expect(steps[1].open).toBe(true);
    expect(steps[2].open).toBe(false);
  });
});

describe("the guard", () => {
  /**
   * The point of the whole design. Hiding a locked step in the interface is
   * presentation; refusing the action is protection.
   */
  it("refuses a locked step asked for directly", async () => {
    const { courseId, stepIds } = await buildSpine(2);
    await enrolUser(author, { userId: learner.userId, courseId });

    await expect(assertStepOpen(learner, stepIds[1])).rejects.toThrow(SpineError);
    await expect(assertStepOpen(learner, stepIds[1])).rejects.toThrow(
      /not open yet/,
    );
  });

  it("refuses to record a locked step as opened", async () => {
    const { courseId, stepIds } = await buildSpine(2);
    await enrolUser(author, { userId: learner.userId, courseId });

    await expect(recordStepOpened(learner, stepIds[1])).rejects.toThrow(
      SpineError,
    );

    // And nothing was written, so the gate did not open itself as a side effect.
    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[1].progress.opened).toBe(false);
  });

  it("refuses to complete a lesson whose step is locked", async () => {
    const { courseId, lessonIds } = await buildSpine(2);
    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId,
    });

    await expect(
      markLessonComplete(learner, enrolment.id, lessonIds[1]),
    ).rejects.toThrow(/not open yet/);
  });

  /** Courses built before the spine existed must keep working untouched. */
  it("does not gate a course that has no spine", async () => {
    const course = await createCourse(author, { title: `Ungated ${suffix()}` });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section",
    });
    const lesson = await addLesson(author, {
      sectionId: section.id,
      title: "Lesson",
    });
    await tagCourseCompetency(author, course.id, competencyId);
    const published = await publishCourse(author, course.id);
    expect(published.ok).toBe(true);

    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId: course.id,
    });

    await expect(
      markLessonComplete(learner, enrolment.id, lesson.id),
    ).resolves.toBeDefined();
  });

  it("will not show one learner another learner's spine", async () => {
    const { courseId } = await buildSpine(2);
    await expect(
      stepsForLearner(learner, courseId, other.userId),
    ).rejects.toThrow(SpineError);
  });
});

describe("prerequisites an author writes by hand", () => {
  it("waits for every one of them", async () => {
    const { courseId, stepIds, lessonIds } = await buildSpine(3);

    // The third step waits for both of the first two, not merely the second.
    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[0],
      rule: "submitted",
    });
    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[1],
      rule: "submitted",
    });

    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId,
    });
    await markLessonComplete(learner, enrolment.id, lessonIds[0]);

    let steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[2].open).toBe(false);
    expect(steps[2].blockedBy).toHaveLength(1);
    expect(steps[2].blockedBy[0]).toContain("Lesson 2");

    await markLessonComplete(learner, enrolment.id, lessonIds[1]);
    steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[2].open).toBe(true);
  });

  it("accepts any one of a group of equivalent alternatives", async () => {
    const { courseId, stepIds, lessonIds } = await buildSpine(3);

    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[0],
      rule: "submitted",
      anyOfGroup: "either-route",
    });
    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[1],
      rule: "submitted",
      anyOfGroup: "either-route",
    });

    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId,
    });
    await markLessonComplete(learner, enrolment.id, lessonIds[0]);

    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[2].open).toBe(true);
  });

  /**
   * A gate written as a chain of prerequisites must not be weakened by
   * somebody dragging the list into a different order.
   */
  it("survives a reorder", async () => {
    const { courseId, stepIds } = await buildSpine(3);
    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[0],
      rule: "submitted",
    });

    await reorderSteps(author, courseId, [stepIds[2], stepIds[0], stepIds[1]]);

    await enrolUser(author, { userId: learner.userId, courseId });
    const steps = await stepsForLearner(learner, courseId, learner.userId);

    const moved = steps.find((step) => step.id === stepIds[2])!;
    expect(moved.open).toBe(false);
    expect(moved.blockedBy[0]).toContain("Lesson 1");
  });

  it("refuses an order that does not list every step once", async () => {
    const { courseId, stepIds } = await buildSpine(3);
    await expect(
      reorderSteps(author, courseId, [stepIds[0], stepIds[1]]),
    ).rejects.toThrow(/every step/);
  });
});

describe("gates that could never open", () => {
  /**
   * The wall between developmental and summative work. A workbook prepares a
   * learner; it does not judge them, so it produces no competence decision. A
   * gate waiting for one would stay shut for ever, and it usually means the
   * author has mistaken a workbook for a measurement.
   */
  it("refuses to wait for competence on a formative assessment", async () => {
    const course = await createCourse(author, { title: `Formative ${suffix()}` });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section",
    });
    const lesson = await addLesson(author, {
      sectionId: section.id,
      title: "Lesson",
    });

    const workbook = await createAssessment(author, {
      courseId: course.id,
      title: "Workbook 1",
      purpose: "formative",
    });
    await addAssessmentItem(author, {
      assessmentId: workbook.id,
      stem: "Question",
      options: ["Right", "Wrong"],
      correctIndexes: [0],
    });
    await publishAssessment(author, workbook.id);

    const workbookStep = await addStep(author, {
      courseId: course.id,
      kind: "assessment",
      assessmentId: workbook.id,
    });
    const lessonStep = await addStep(author, {
      courseId: course.id,
      kind: "lesson",
      lessonId: lesson.id,
    });

    await expect(
      addPrerequisite(author, {
        stepId: lessonStep.id,
        requiredStepId: workbookStep.id,
        rule: "competent",
      }),
    ).rejects.toThrow(/formative/);
  });

  it("refuses to wait for competence on a lesson", async () => {
    const { stepIds } = await buildSpine(2);
    await expect(
      addPrerequisite(author, {
        stepId: stepIds[1],
        requiredStepId: stepIds[0],
        rule: "competent",
      }),
    ).rejects.toThrow(/not assessed/);
  });

  it("refuses a chain that closes on itself", async () => {
    const { stepIds } = await buildSpine(3);

    await addPrerequisite(author, {
      stepId: stepIds[1],
      requiredStepId: stepIds[0],
      rule: "submitted",
    });
    await addPrerequisite(author, {
      stepId: stepIds[2],
      requiredStepId: stepIds[1],
      rule: "submitted",
    });

    // Closing the loop would lock a learner out of all three, permanently.
    await expect(
      addPrerequisite(author, {
        stepId: stepIds[0],
        requiredStepId: stepIds[2],
        rule: "submitted",
      }),
    ).rejects.toThrow(/wait for each other/);
  });

  it("refuses a step that waits for itself", async () => {
    const { stepIds } = await buildSpine(2);
    await expect(
      addPrerequisite(author, {
        stepId: stepIds[0],
        requiredStepId: stepIds[0],
        rule: "opened",
      }),
    ).rejects.toThrow(/cannot wait for itself/);
  });

  it("refuses a step waiting on another course", async () => {
    const first = await buildSpine(2);
    const second = await buildSpine(2);
    await expect(
      addPrerequisite(author, {
        stepId: second.stepIds[1],
        requiredStepId: first.stepIds[0],
        rule: "submitted",
      }),
    ).rejects.toThrow(/same course/);
  });
});

describe("exceptions", () => {
  it("lets one learner past, and records why", async () => {
    const { courseId, stepIds } = await buildSpine(2);
    await enrolUser(author, { userId: learner.userId, courseId });

    const override = await grantOverride(author, {
      stepId: stepIds[1],
      userId: learner.userId,
      reason: "Joined the cohort late; catching up with the facilitator.",
    });

    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps[1].open).toBe(true);
    expect(steps[1].overrideReason).toContain("Joined the cohort late");

    // Visible afterwards, or it is indistinguishable from a broken gate.
    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, stepIds[1])),
    );
    expect(
      entries.some((entry) => entry.action === "course.step_overridden"),
    ).toBe(true);

    // And it lets only that learner past.
    await enrolUser(author, { userId: other.userId, courseId });
    const others = await stepsForLearner(author, courseId, other.userId);
    expect(others[1].open).toBe(false);

    await revokeOverride(author, override.id);
    const after = await stepsForLearner(learner, courseId, learner.userId);
    expect(after[1].open).toBe(false);
  });

  it("refuses an override with no reason worth the name", async () => {
    const { stepIds } = await buildSpine(2);
    await expect(
      grantOverride(author, {
        stepId: stepIds[1],
        userId: learner.userId,
        reason: "ok",
      }),
    ).rejects.toThrow(/Say why/);
  });

  it("keeps the record after an override is withdrawn", async () => {
    const { stepIds } = await buildSpine(2);
    const override = await grantOverride(author, {
      stepId: stepIds[1],
      userId: learner.userId,
      reason: "Assessor on leave; unblocking so the cohort is not held up.",
    });
    await revokeOverride(author, override.id);

    const rows = await withTenant(organisationId, (tx) =>
      tx.select().from(stepOverrides).where(eq(stepOverrides.id, override.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[0].reason).toContain("Assessor on leave");
  });
});

describe("what a facilitator sees", () => {
  it("names each stuck learner once, at their earliest blocked step", async () => {
    const { courseId, lessonIds } = await buildSpine(3);
    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId,
    });
    await enrolUser(author, { userId: other.userId, courseId });

    // One learner has moved on a step; the other has not started.
    await markLessonComplete(learner, enrolment.id, lessonIds[0]);

    const blocked = await blockedLearners(author, courseId);
    const mine = blocked.find((row) => row.userId === learner.userId)!;
    const theirs = blocked.find((row) => row.userId === other.userId)!;

    expect(mine.stepTitle).toBe("Lesson 3");
    expect(theirs.stepTitle).toBe("Lesson 2");
    expect(blocked.filter((row) => row.userId === learner.userId)).toHaveLength(
      1,
    );
  });

  it("is not offered to a learner", async () => {
    const { courseId } = await buildSpine(2);
    await expect(blockedLearners(learner, courseId)).rejects.toThrow();
  });
});

describe("the shape of a step", () => {
  it("refuses a step that names nothing to point at", async () => {
    const { courseId } = await buildSpine(1);
    await expect(
      addStep(author, { courseId, kind: "lesson" }),
    ).rejects.toThrow(/has to name/);
  });

  /** The database is the backstop, not the application. */
  it("refuses a step whose kind and target disagree", async () => {
    const { courseId, lessonIds } = await buildSpine(1);

    await expect(
      withTenant(organisationId, (tx) =>
        tx.insert(courseSteps).values({
          organisationId,
          courseId,
          // Says assessment, points at a lesson. The gate evaluator would have
          // to guess what this is, and a gate that guesses is not a gate.
          kind: "assessment",
          lessonId: lessonIds[0],
          sortOrder: 98,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a step that points at nothing", async () => {
    const { courseId } = await buildSpine(1);

    await expect(
      withTenant(organisationId, (tx) =>
        tx.insert(courseSteps).values({
          organisationId,
          courseId,
          kind: "lesson",
          sortOrder: 97,
        }),
      ),
    ).rejects.toThrow();
  });

  it("removes a step without disturbing the rest", async () => {
    const { courseId, stepIds } = await buildSpine(3);
    await removeStep(author, stepIds[1]);

    await enrolUser(author, { userId: learner.userId, courseId });
    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.title)).toEqual(["Lesson 1", "Lesson 3"]);
  });
});

/**
 * Study Unit 1 as it is actually shaped, walked from end to end.
 *
 * The acceptance test for the whole design: a theory guide to read, six
 * developmental workbooks in order, and a summative assessment that refuses to
 * open until every one of them is in. It exists because each of those rules is
 * easy to state and easy to get subtly wrong, and because the wall between
 * developmental and summative work is the thing most worth guarding.
 */
describe("a study unit, end to end", () => {
  it("walks theory guide, six workbooks, then the summative", async () => {
    const course = await createCourse(author, {
      title: `Study Unit 1 ${suffix()}`,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Study Unit 1",
    });

    // The theory guide. Read, not handed in.
    const guide = await addLesson(author, {
      sectionId: section.id,
      title: "SU1 Theory Guide",
    });
    const guideStep = await addStep(author, {
      courseId: course.id,
      kind: "lesson",
      lessonId: guide.id,
      release: "open",
    });

    // Six workbooks, each waiting for the one before to be handed in. Not for
    // it to be judged competent: a workbook is developmental and produces no
    // competence decision at all.
    const workbookSteps: string[] = [];
    const workbookIds: string[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const workbook = await createAssessment(author, {
        courseId: course.id,
        title: `Workbook ${index}`,
        purpose: "formative",
      });
      await addAssessmentItem(author, {
        assessmentId: workbook.id,
        stem: `Activity ${index}.1`,
        options: ["Right", "Wrong"],
        correctIndexes: [0],
      });
      await publishAssessment(author, workbook.id);
      workbookIds.push(workbook.id);

      const step = await addStep(author, {
        courseId: course.id,
        kind: "assessment",
        assessmentId: workbook.id,
        release: "sequential",
        sequentialRule: index === 1 ? "opened" : "submitted",
      });
      workbookSteps.push(step.id);
    }

    // The summative. Gated on all six explicitly rather than on sequence, so
    // reordering the workbooks cannot quietly weaken it.
    const summative = await createAssessment(author, {
      courseId: course.id,
      title: "SU1 Summative Assessment",
      purpose: "summative",
      passMark: 75,
    });
    await addAssessmentItem(author, {
      assessmentId: summative.id,
      stem: "Section A question 1",
      options: ["Right", "Wrong"],
      correctIndexes: [0],
    });
    await publishAssessment(author, summative.id);

    const summativeStep = await addStep(author, {
      courseId: course.id,
      kind: "assessment",
      assessmentId: summative.id,
      release: "prerequisites",
    });
    for (const stepId of workbookSteps) {
      await addPrerequisite(author, {
        stepId: summativeStep.id,
        requiredStepId: stepId,
        rule: "submitted",
      });
    }

    await tagCourseCompetency(author, course.id, competencyId);
    const published = await publishCourse(author, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));

    const enrolment = await enrolUser(author, {
      userId: learner.userId,
      courseId: course.id,
    });

    // Only the guide is open at the start.
    let steps = await stepsForLearner(learner, course.id, learner.userId);
    expect(steps).toHaveLength(8);
    expect(steps.filter((step) => step.open).map((step) => step.title)).toEqual([
      "SU1 Theory Guide",
    ]);

    await recordStepOpened(learner, guideStep.id);
    steps = await stepsForLearner(learner, course.id, learner.userId);
    expect(steps[1].open).toBe(true);
    expect(steps[1].title).toBe("Workbook 1");

    // Work the six workbooks. Each opens the next; none opens the summative.
    for (let index = 0; index < 6; index += 1) {
      const items = await withTenant(organisationId, (tx) =>
        tx
          .select()
          .from(assessmentItems)
          .where(eq(assessmentItems.assessmentId, workbookIds[index])),
      );

      await submitQuiz(learner, {
        assessmentId: workbookIds[index],
        enrolmentId: enrolment.id,
        responses: { [items[0].id]: [items[0].options![0].id] },
      });

      steps = await stepsForLearner(learner, course.id, learner.userId);
      const summativeView = steps.find((step) => step.id === summativeStep.id)!;

      if (index < 5) {
        expect(summativeView.open).toBe(false);
        // It names what is still outstanding, and only what is outstanding.
        expect(summativeView.blockedBy).toHaveLength(5 - index);
      } else {
        expect(summativeView.open).toBe(true);
        expect(summativeView.blockedBy).toEqual([]);
      }
    }

    // And nothing a workbook did counted as competence.
    steps = await stepsForLearner(learner, course.id, learner.userId);
    for (const step of steps.filter((s) => s.title.startsWith("Workbook"))) {
      expect(step.progress.submitted).toBe(true);
      expect(step.progress.competent).toBe(false);
    }
  });
});
