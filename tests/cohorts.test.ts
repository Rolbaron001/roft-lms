/**
 * Cohorts and the schedule that hangs off them, against a live database.
 *
 * The test that carries the design is the reschedule: a rollout is written as
 * "workbook 3 in week four", so moving the intake has to move everything for
 * everyone in one write. Storing dates instead of offsets would make that
 * forty edits nobody finishes, and the drift would be invisible.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  cohortMembers,
  cohorts as cohortsTable,
  competencies,
  competencyFrameworks,
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
import { addStep, stepsForLearner } from "@/lib/spine";
import {
  addMember,
  CohortError,
  createCohort,
  dayFrom,
  getCohort,
  removeMember,
  rescheduleCohort,
  setSchedule,
} from "@/lib/cohorts";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
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
  return withPlatformScope("cohort test fixture", async (tx) => {
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

/** A published course with four steps, ready to be scheduled. */
async function buildCourse() {
  const course = await createCourse(admin, { title: `Cohort ${suffix()}` });
  const section = await addSection(admin, {
    courseId: course.id,
    title: "Study Unit 1",
  });

  const stepIds: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const lesson = await addLesson(admin, {
      sectionId: section.id,
      title: `Workbook ${index}`,
    });
    const step = await addStep(admin, {
      courseId: course.id,
      kind: "lesson",
      lessonId: lesson.id,
      release: "open",
    });
    stepIds.push(step.id);
  }

  await tagCourseCompetency(admin, course.id, competencyId);
  const published = await publishCourse(admin, course.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));

  return { courseId: course.id, stepIds };
}

beforeAll(async () => {
  const slug = `cohort-${Date.now()}`;

  const created = await withPlatformScope("cohort test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Cohort Test Co",
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
        code: "COH-01",
        name: "Demonstrated capability",
      })
      .returning({ id: competencies.id });

    return { organisationId: organisation.id, competencyId: competency.id };
  });

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@cohort.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@cohort.test", ["learner"]),
  );
  other = sessionFor(
    ["learner"],
    await createPerson("other@cohort.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("cohort test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a cohort", () => {
  it("enrols a member on its course as well as listing them", async () => {
    const { courseId } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Intake 1",
      startDate: "2026-02-02",
    });

    await addMember(admin, cohort.id, learner.userId);

    // A name on a register who cannot open anything is the half-state this
    // avoids: the spine answers for them, which means they are enrolled.
    const steps = await stepsForLearner(learner, courseId, learner.userId);
    expect(steps).toHaveLength(4);

    const detail = await getCohort(admin, cohort.id);
    expect(detail.members.map((m) => m.userId)).toContain(learner.userId);
  });

  it("keeps a departure on the record rather than deleting it", async () => {
    const { courseId } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Intake 2",
      startDate: "2026-02-02",
    });

    await addMember(admin, cohort.id, learner.userId);
    await removeMember(admin, cohort.id, learner.userId);

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(cohortMembers)
        .where(eq(cohortMembers.cohortId, cohort.id)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].leftAt).not.toBeNull();
  });

  it("does not list someone twice when they re-join", async () => {
    const { courseId } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Intake 3",
      startDate: "2026-02-02",
    });

    await addMember(admin, cohort.id, learner.userId);
    await removeMember(admin, cohort.id, learner.userId);
    await addMember(admin, cohort.id, learner.userId);

    const detail = await getCohort(admin, cohort.id);
    const appearances = detail.members.filter(
      (m) => m.userId === learner.userId,
    );
    expect(appearances).toHaveLength(1);
    expect(appearances[0].leftAt).toBeNull();
  });

  it("refuses to add anyone to a cohort that has finished", async () => {
    const { courseId } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Done",
      startDate: "2025-01-06",
    });

    await withTenant(organisationId, (tx) =>
      tx
        .update(cohortsTable)
        .set({ status: "finished" })
        .where(eq(cohortsTable.id, cohort.id)),
    );

    await expect(
      addMember(admin, cohort.id, learner.userId),
    ).rejects.toThrow(/finished/);
  });
});

describe("the schedule", () => {
  it("holds a step shut until the week it is taught", async () => {
    const { courseId, stepIds } = await buildCourse();

    // Starts a fortnight ago, so week one is open and week four is not.
    const start = new Date(Date.now() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const cohort = await createCohort(admin, {
      courseId,
      name: "Scheduled",
      startDate: start,
    });
    await addMember(admin, cohort.id, learner.userId);

    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0, dueAfterDays: 7 },
      { stepId: stepIds[1], opensAfterDays: 7, dueAfterDays: 14 },
      { stepId: stepIds[2], opensAfterDays: 21, dueAfterDays: 28 },
      { stepId: stepIds[3], opensAfterDays: 28, dueAfterDays: 35 },
    ]);

    const steps = await stepsForLearner(learner, courseId, learner.userId);

    expect(steps[0].open).toBe(true);
    expect(steps[1].open).toBe(true);
    expect(steps[2].open).toBe(false);
    expect(steps[2].blockedBy[0]).toContain("it opens on");
    expect(steps[3].open).toBe(false);

    // And the learner is told when it is due, not merely that it is shut.
    expect(steps[0].dueAt).not.toBeNull();
  });

  /** The reason offsets are stored rather than dates. */
  it("moves every date when the intake moves", async () => {
    const { courseId, stepIds } = await buildCourse();

    const cohort = await createCohort(admin, {
      courseId,
      name: "Delayed",
      startDate: "2026-03-02",
    });
    await addMember(admin, cohort.id, learner.userId);
    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0, dueAfterDays: 7 },
      { stepId: stepIds[3], opensAfterDays: 28, dueAfterDays: 35 },
    ]);

    const before = await getCohort(admin, cohort.id);
    const lastBefore = before.steps.find((s) => s.id === stepIds[3])!;
    expect(lastBefore.opensAt!.toISOString().slice(0, 10)).toBe("2026-03-30");

    // One write.
    await rescheduleCohort(admin, cohort.id, "2026-03-09");

    const after = await getCohort(admin, cohort.id);
    const lastAfter = after.steps.find((s) => s.id === stepIds[3])!;
    expect(lastAfter.opensAt!.toISOString().slice(0, 10)).toBe("2026-04-06");
    expect(
      after.steps.find((s) => s.id === stepIds[0])!.opensAt!.toISOString().slice(0, 10),
    ).toBe("2026-03-09");
  });

  it("refuses a step due before it opens", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Backwards",
      startDate: "2026-02-02",
    });

    await expect(
      setSchedule(admin, cohort.id, [
        { stepId: stepIds[0], opensAfterDays: 14, dueAfterDays: 7 },
      ]),
    ).rejects.toThrow(/due before it opens/);
  });

  it("refuses a schedule naming a step from another course", async () => {
    const first = await buildCourse();
    const second = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId: first.courseId,
      name: "Mixed",
      startDate: "2026-02-02",
    });

    await expect(
      setSchedule(admin, cohort.id, [
        { stepId: second.stepIds[0], opensAfterDays: 0 },
      ]),
    ).rejects.toThrow(/not on this cohort/);
  });

  it("replaces the schedule rather than merging into it", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Rewritten",
      startDate: "2026-02-02",
    });

    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0 },
      { stepId: stepIds[1], opensAfterDays: 7 },
    ]);
    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0 },
    ]);

    const detail = await getCohort(admin, cohort.id);
    const scheduled = detail.steps.filter((s) => s.opensAfterDays !== null);
    expect(scheduled).toHaveLength(1);
  });

  /** Somebody on no cohort is governed by the course, not by nothing. */
  it("leaves a learner who is on no cohort ungated by dates", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Not theirs",
      // Far enough ahead that every step would be shut.
      startDate: "2030-01-07",
    });
    await addMember(admin, cohort.id, learner.userId);
    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0 },
      { stepId: stepIds[1], opensAfterDays: 7 },
    ]);

    // The learner on the cohort waits.
    const theirs = await stepsForLearner(learner, courseId, learner.userId);
    expect(theirs[0].open).toBe(false);

    // Somebody simply assigned the course does not.
    const { enrolUser } = await import("@/lib/enrolment");
    await enrolUser(admin, { userId: other.userId, courseId });
    const mine = await stepsForLearner(other, courseId, other.userId);
    expect(mine[0].open).toBe(true);
    expect(mine[0].dueAt).toBeNull();
  });
});

/**
 * What the cohort screen reads, edits and writes back.
 *
 * setSchedule replaces a cohort's whole schedule rather than merging into it,
 * so a screen that cannot read a field back will silently delete it on the
 * next save. That is the failure these cover: not an exception, but a closing
 * time that quietly stops existing and is noticed weeks later by a step that
 * should have closed and did not.
 */
describe("editing a schedule through the screen", () => {
  it("reads back the closing grace period, not only opens and due", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Round trip",
      startDate: "2026-02-02",
    });

    await setSchedule(admin, cohort.id, [
      {
        stepId: stepIds[0],
        opensAfterDays: 0,
        dueAfterDays: 7,
        closesAfterDays: 3,
      },
    ]);

    const detail = await getCohort(admin, cohort.id);
    const step = detail.steps.find((entry) => entry.id === stepIds[0]);

    expect(step?.closesAfterDays).toBe(3);
    // Closing is counted from the due date, so day 7 plus 3 is day 10.
    expect(step?.closesAt?.toISOString().slice(0, 10)).toBe("2026-02-12");
  });

  it("preserves the whole schedule when the screen saves it back unchanged", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Saved again",
      startDate: "2026-02-02",
    });

    await setSchedule(admin, cohort.id, [
      {
        stepId: stepIds[0],
        opensAfterDays: 0,
        dueAfterDays: 7,
        closesAfterDays: 3,
      },
      { stepId: stepIds[1], opensAfterDays: 7, dueAfterDays: 14 },
    ]);

    // Exactly what the screen posts: every step it was given, straight back.
    const before = await getCohort(admin, cohort.id);
    await setSchedule(
      admin,
      cohort.id,
      before.steps
        .filter(
          (step) =>
            step.opensAfterDays !== null ||
            step.dueAfterDays !== null ||
            step.closesAfterDays !== null,
        )
        .map((step) => ({
          stepId: step.id,
          opensAfterDays: step.opensAfterDays,
          dueAfterDays: step.dueAfterDays,
          closesAfterDays: step.closesAfterDays,
        })),
    );

    const after = await getCohort(admin, cohort.id);

    expect(
      after.steps.map((step) => [
        step.opensAfterDays,
        step.dueAfterDays,
        step.closesAfterDays,
      ]),
    ).toEqual(
      before.steps.map((step) => [
        step.opensAfterDays,
        step.dueAfterDays,
        step.closesAfterDays,
      ]),
    );
  });

  /**
   * A cleared row means no dates at all, which is not the same as day zero:
   * day zero opens on the start date, no dates opens as soon as whatever
   * comes before it is done.
   */
  it("clears a step's dates when its row is emptied", async () => {
    const { courseId, stepIds } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Cleared",
      startDate: "2026-02-02",
    });

    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0 },
      { stepId: stepIds[1], opensAfterDays: 7 },
    ]);
    await setSchedule(admin, cohort.id, [
      { stepId: stepIds[0], opensAfterDays: 0 },
    ]);

    const detail = await getCohort(admin, cohort.id);
    const cleared = detail.steps.find((step) => step.id === stepIds[1]);

    expect(cleared?.opensAfterDays).toBeNull();
    expect(cleared?.opensAt).toBeNull();
  });
});

describe("dates", () => {
  it("counts days from the start without drifting", () => {
    expect(dayFrom("2026-03-02", 0).toISOString().slice(0, 10)).toBe(
      "2026-03-02",
    );
    expect(dayFrom("2026-03-02", 28).toISOString().slice(0, 10)).toBe(
      "2026-03-30",
    );
    // Across a month boundary, and across a leap day.
    expect(dayFrom("2028-02-28", 2).toISOString().slice(0, 10)).toBe(
      "2028-03-01",
    );
  });

  it("refuses a start date that is not a date", async () => {
    const { courseId } = await buildCourse();
    await expect(
      createCohort(admin, {
        courseId,
        name: "Bad",
        startDate: "next Monday",
      }),
    ).rejects.toThrow(CohortError);
  });
});

describe("the record", () => {
  it("writes a reschedule to the audit log, with both dates", async () => {
    const { courseId } = await buildCourse();
    const cohort = await createCohort(admin, {
      courseId,
      name: "Audited",
      startDate: "2026-02-02",
    });
    await rescheduleCohort(admin, cohort.id, "2026-02-09");

    const entries = await withTenant(organisationId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, cohort.id)),
    );

    const move = entries.find((e) => e.action === "cohort.rescheduled");
    expect(move).toBeDefined();
    expect((move!.before as { startDate: string }).startDate).toBe("2026-02-02");
    expect((move!.after as { startDate: string }).startDate).toBe("2026-02-09");
  });
});
