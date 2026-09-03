/**
 * Enrolment, delivery and progress, against a live database.
 *
 * Tenant isolation is proven elsewhere. What matters here is separation
 * between people *inside* one client: a learner must not be able to read or
 * alter a colleague's record, and nobody may mark work complete on a learner's
 * behalf. A completion record an administrator could fabricate is worth
 * nothing at an accreditation audit.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  competencies,
  competencyFrameworks,
  enrolments,
  organisations,
  progressRecords,
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
  bulkEnrol,
  EnrolmentError,
  enrolUser,
  getEnrolmentForDelivery,
  listCourseEnrolments,
  markLessonComplete,
  markOverdueEnrolments,
  myEnrolments,
} from "@/lib/enrolment";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let samSession: AuthenticatedSession;
let jordanSession: AuthenticatedSession;

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

async function createPerson(email: string, role: Role) {
  return withPlatformScope("enrolment test fixture", async (tx) => {
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

    await tx
      .insert(userRoles)
      .values({ organisationId, userId: user.id, role });

    return user.id;
  });
}

/** A published, two-lesson course ready to be assigned. */
async function publishedCourse(title: string) {
  const course = await createCourse(admin, { title });
  const section = await addSection(admin, {
    courseId: course.id,
    title: "Section one",
  });
  await addLesson(admin, { sectionId: section.id, title: "Lesson one" });
  await addLesson(admin, { sectionId: section.id, title: "Lesson two" });
  await tagCourseCompetency(admin, course.id, competencyId);

  const result = await publishCourse(admin, course.id);
  if (!result.ok) throw new Error(result.reasons.join(" "));

  return course.id;
}

beforeAll(async () => {
  const slug = `enrol-${Date.now()}`;

  const created = await withPlatformScope(
    "enrolment test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Enrolment Test Co",
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
          code: "ENR-01",
          name: "Test competency",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  const adminId = await createPerson("admin@enrol.test", "tenant_admin");
  const samId = await createPerson("sam@enrol.test", "learner");
  const jordanId = await createPerson("jordan@enrol.test", "learner");

  admin = sessionFor(["tenant_admin"], adminId);
  samSession = sessionFor(["learner"], samId);
  jordanSession = sessionFor(["learner"], jordanId);
});

afterAll(async () => {
  await withPlatformScope("enrolment test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("assigning a course", () => {
  it("enrols a learner on a published course", async () => {
    const courseId = await publishedCourse("Assignable course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });

    expect(enrolment.userId).toBe(samSession.userId);
    expect(enrolment.status).toBe("assigned");
  });

  /**
   * A draft has not passed its publish gate, so nothing has confirmed its
   * content covers what it claims to. Assigning one would put learners on
   * material that cannot be defended.
   */
  it("refuses to assign a draft course", async () => {
    const course = await createCourse(admin, { title: "Still drafting" });

    await expect(
      enrolUser(admin, { userId: samSession.userId, courseId: course.id }),
    ).rejects.toMatchObject({ code: "not_publishable" });
  });

  it("refuses to enrol the same person twice", async () => {
    const courseId = await publishedCourse("Once only");
    await enrolUser(admin, { userId: samSession.userId, courseId });

    await expect(
      enrolUser(admin, { userId: samSession.userId, courseId }),
    ).rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("stops a learner enrolling anybody, including themselves", async () => {
    const courseId = await publishedCourse("Not self-service");

    await expect(
      enrolUser(samSession, { userId: samSession.userId, courseId }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("records who assigned the course", async () => {
    const courseId = await publishedCourse("Audited assignment");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action, actorId: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, enrolment.id)),
    );

    expect(entries).toContainEqual({
      action: "enrolment.created",
      actorId: admin.userId,
    });
  });
});

describe("bulk enrolment", () => {
  it("reports what happened to every address rather than stopping at the first problem", async () => {
    const courseId = await publishedCourse("Bulk course");
    await enrolUser(admin, { userId: jordanSession.userId, courseId });

    const result = await bulkEnrol(admin, courseId, [
      "sam@enrol.test",
      "jordan@enrol.test",
      "nobody@enrol.test",
      "  SAM@ENROL.TEST  ",
    ]);

    expect(result.enrolled).toEqual(["sam@enrol.test"]);
    expect(result.alreadyEnrolled).toEqual(["jordan@enrol.test"]);
    expect(result.unknown).toEqual(["nobody@enrol.test"]);
  });

  it("ignores blank lines from a pasted list", async () => {
    const courseId = await publishedCourse("Bulk with blanks");
    const result = await bulkEnrol(admin, courseId, ["", "  ", "sam@enrol.test"]);

    expect(result.enrolled).toEqual(["sam@enrol.test"]);
  });
});

describe("who may open an enrolment", () => {
  it("lets a learner open their own", async () => {
    const courseId = await publishedCourse("Sam's course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });

    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    expect(delivery.isOwn).toBe(true);
    expect(delivery.totalLessons).toBe(2);
  });

  /** The check that matters most in this file. */
  it("refuses a learner opening a colleague's enrolment", async () => {
    const courseId = await publishedCourse("Jordan's course");
    const enrolment = await enrolUser(admin, {
      userId: jordanSession.userId,
      courseId,
    });

    await expect(
      getEnrolmentForDelivery(samSession, enrolment.id),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("lets an administrator view a learner's enrolment", async () => {
    const courseId = await publishedCourse("Overseen course");
    const enrolment = await enrolUser(admin, {
      userId: jordanSession.userId,
      courseId,
    });

    const delivery = await getEnrolmentForDelivery(admin, enrolment.id);
    expect(delivery.isOwn).toBe(false);
  });

  it("shows a learner only their own enrolments in their list", async () => {
    const courseId = await publishedCourse("Listing course");
    await enrolUser(admin, { userId: jordanSession.userId, courseId });

    const mine = await myEnrolments(samSession);
    const theirs = await myEnrolments(jordanSession);

    expect(mine.map((row) => row.enrolmentId)).not.toContain(
      theirs.find((row) => row.courseId === courseId)?.enrolmentId,
    );
  });
});

describe("recording progress", () => {
  it("marks a lesson complete and moves the enrolment to in progress", async () => {
    const courseId = await publishedCourse("Progress course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });

    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    const firstLesson = delivery.sections[0].lessons[0];

    const result = await markLessonComplete(
      samSession,
      enrolment.id,
      firstLesson.id,
    );

    expect(result).toMatchObject({ total: 2, done: 1, completed: false });

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(enrolments).where(eq(enrolments.id, enrolment.id)),
    );
    expect(row.status).toBe("in_progress");
  });

  it("completes the enrolment once every lesson is done", async () => {
    const courseId = await publishedCourse("Completable course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });

    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(samSession, enrolment.id, lesson.id);
    }

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(enrolments).where(eq(enrolments.id, enrolment.id)),
    );

    expect(row.status).toBe("completed");
    expect(row.completedAt).not.toBeNull();
  });

  it("is safe to mark the same lesson complete twice", async () => {
    const courseId = await publishedCourse("Double click course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });
    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    const lesson = delivery.sections[0].lessons[0];

    await markLessonComplete(samSession, enrolment.id, lesson.id);
    const second = await markLessonComplete(samSession, enrolment.id, lesson.id);

    expect(second.done).toBe(1);

    const records = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(progressRecords)
        .where(eq(progressRecords.enrolmentId, enrolment.id)),
    );
    expect(records).toHaveLength(1);
  });

  /**
   * Progress is evidence. If an administrator could record it, a completion
   * record would prove only that somebody clicked a button.
   */
  it("does not let an administrator complete a lesson for a learner", async () => {
    const courseId = await publishedCourse("Not on their behalf");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });
    const delivery = await getEnrolmentForDelivery(admin, enrolment.id);
    const lesson = delivery.sections[0].lessons[0];

    await expect(
      markLessonComplete(admin, enrolment.id, lesson.id),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("does not let one learner record progress on another's enrolment", async () => {
    const courseId = await publishedCourse("Colleague progress");
    const enrolment = await enrolUser(admin, {
      userId: jordanSession.userId,
      courseId,
    });
    const delivery = await getEnrolmentForDelivery(admin, enrolment.id);
    const lesson = delivery.sections[0].lessons[0];

    await expect(
      markLessonComplete(samSession, enrolment.id, lesson.id),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  /**
   * Without this check a crafted request could record progress against any
   * lesson in the tenant and complete a course the learner never opened.
   */
  it("refuses a lesson that belongs to a different course", async () => {
    const courseId = await publishedCourse("The real course");
    const otherCourseId = await publishedCourse("A different course");

    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });
    const otherEnrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId: otherCourseId,
    });

    const otherDelivery = await getEnrolmentForDelivery(
      samSession,
      otherEnrolment.id,
    );
    const foreignLesson = otherDelivery.sections[0].lessons[0];

    await expect(
      markLessonComplete(samSession, enrolment.id, foreignLesson.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("records completion in the audit log", async () => {
    const courseId = await publishedCourse("Audited completion");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
    });
    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(samSession, enrolment.id, lesson.id);
    }

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, enrolment.id)),
    );

    expect(entries.map((e) => e.action)).toContain("enrolment.completed");
  });
});

describe("oversight", () => {
  it("shows an administrator everyone on a course with their progress", async () => {
    const courseId = await publishedCourse("Cohort course");
    await enrolUser(admin, { userId: samSession.userId, courseId });
    await enrolUser(admin, { userId: jordanSession.userId, courseId });

    const rows = await listCourseEnrolments(admin, courseId);
    expect(rows).toHaveLength(2);
    expect(rows[0].totalLessons).toBe(2);
  });

  it("stops a learner listing a whole cohort", async () => {
    const courseId = await publishedCourse("Private cohort");
    await expect(
      listCourseEnrolments(samSession, courseId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("flags an enrolment whose due date has passed", async () => {
    const courseId = await publishedCourse("Overdue course");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await markOverdueEnrolments(organisationId);

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(enrolments).where(eq(enrolments.id, enrolment.id)),
    );
    expect(row.status).toBe("overdue");
  });

  it("does not flag a completed enrolment as overdue", async () => {
    const courseId = await publishedCourse("Finished in time");
    const enrolment = await enrolUser(admin, {
      userId: samSession.userId,
      courseId,
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const delivery = await getEnrolmentForDelivery(samSession, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(samSession, enrolment.id, lesson.id);
    }

    await markOverdueEnrolments(organisationId);

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(enrolments).where(eq(enrolments.id, enrolment.id)),
    );
    expect(row.status).toBe("completed");
  });
});

describe("EnrolmentError", () => {
  it("is thrown as a typed error so callers can tell cases apart", async () => {
    await expect(
      getEnrolmentForDelivery(admin, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(EnrolmentError);
  });
});
