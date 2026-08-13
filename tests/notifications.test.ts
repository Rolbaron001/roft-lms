/**
 * Notifications, against a live database.
 *
 * Two failure modes matter. The first is silence: somebody who should have
 * been told is not, and the work sits. The second, worse in practice, is
 * noise — the same reminder every night until people stop reading any of them.
 * Deduplication is what separates a useful reminder from that.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  enrolments,
  notifications,
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
import {
  enrolUser,
  getEnrolmentForDelivery,
  markLessonComplete,
  markOverdueEnrolments,
} from "@/lib/enrolment";
import {
  markAllRead,
  markRead,
  myNotifications,
  pendingEmails,
  sweepTenant,
  unreadCount,
} from "@/lib/notifications";
import { mailIsConfigured, renderEmail } from "@/lib/mail";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;
let colleague: AuthenticatedSession;

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

async function createPerson(
  email: string,
  roles: Role[],
  lineManagerId?: string,
) {
  return withPlatformScope("notification fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
        lineManagerId: lineManagerId ?? null,
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

beforeAll(async () => {
  const slug = `notify-${Date.now()}`;

  const created = await withPlatformScope("notification setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Notification Test Co",
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
        code: "NTF-01",
        name: "Test competency",
      })
      .returning({ id: competencies.id });

    return { organisationId: organisation.id, competencyId: competency.id };
  });

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  const adminId = await createPerson("admin@notify.test", ["tenant_admin"]);
  admin = sessionFor(["tenant_admin"], adminId);

  const managerId = await createPerson("manager@notify.test", ["line_manager"]);

  learner = sessionFor(
    ["learner"],
    await createPerson("learner@notify.test", ["learner"], managerId),
  );
  colleague = sessionFor(
    ["learner"],
    await createPerson("colleague@notify.test", ["learner"]),
  );

  // Kept for the manager assertion below.
  managerSession = sessionFor(["line_manager"], managerId);
});

let managerSession: AuthenticatedSession;

afterAll(async () => {
  await withPlatformScope("notification teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("being told about your own training", () => {
  it("notifies a learner when a course is assigned", async () => {
    const courseId = await publishedCourse(`Assigned ${suffix()}`);
    await enrolUser(admin, { userId: learner.userId, courseId });

    const mine = await myNotifications(learner);
    const assigned = mine.find((row) => row.kind === "enrolment.assigned");

    expect(assigned).toBeDefined();
    expect(assigned!.subject).toContain("Assigned");
    expect(assigned!.linkPath).toMatch(/^\/learn\//);
  });

  /** A notification about something that did not happen is worse than none. */
  it("queues an email as well as the in-app message", async () => {
    const courseId = await publishedCourse(`Emailed ${suffix()}`);
    await enrolUser(admin, { userId: learner.userId, courseId });

    const queued = await pendingEmails(500);
    expect(
      queued.some((row) => row.subject.includes("Emailed")),
    ).toBe(true);
  });

  it("does not show one learner another's notifications", async () => {
    const courseId = await publishedCourse(`Private ${suffix()}`);
    await enrolUser(admin, { userId: colleague.userId, courseId });

    const mine = await myNotifications(learner);
    expect(mine.some((row) => row.subject.includes("Private"))).toBe(false);

    const theirs = await myNotifications(colleague);
    expect(theirs.some((row) => row.subject.includes("Private"))).toBe(true);
  });

  it("tells a learner when their certificate is issued", async () => {
    const courseId = await publishedCourse(`Certified ${suffix()}`);
    const enrolment = await enrolUser(admin, {
      userId: learner.userId,
      courseId,
    });

    const delivery = await getEnrolmentForDelivery(learner, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(learner, enrolment.id, lesson.id);
    }

    const mine = await myNotifications(learner);
    const certificate = mine.find((row) => row.kind === "certificate.issued");

    expect(certificate).toBeDefined();
    expect(certificate!.body).toContain("ROFT-");
  });
});

describe("the scheduled sweep", () => {
  it("raises a reminder for overdue training, and tells the line manager", async () => {
    const courseId = await publishedCourse(`Overdue ${suffix()}`);
    await enrolUser(admin, {
      userId: learner.userId,
      courseId,
      dueDate: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    await markOverdueEnrolments(organisationId);

    await sweepTenant(organisationId);

    const theirs = await myNotifications(learner);
    expect(theirs.some((row) => row.kind === "enrolment.overdue")).toBe(true);

    // The reminder does not rest entirely on the person already not doing it.
    const manager = await myNotifications(managerSession);
    expect(manager.some((row) => row.kind === "enrolment.overdue")).toBe(true);
  });

  it("warns before something is due, not only after", async () => {
    const courseId = await publishedCourse(`Due soon ${suffix()}`);
    await enrolUser(admin, {
      userId: learner.userId,
      courseId,
      dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });

    await sweepTenant(organisationId);

    const theirs = await myNotifications(learner);
    const soon = theirs.find((row) => row.kind === "enrolment.due_soon");

    expect(soon).toBeDefined();
    expect(soon!.subject).toContain("due in");
  });

  /**
   * The behaviour that decides whether anybody keeps reading notifications.
   * A nightly sweep must not raise the same reminder nightly.
   */
  it("does not repeat the same reminder when run again", async () => {
    const courseId = await publishedCourse(`Repeat ${suffix()}`);
    await enrolUser(admin, {
      userId: learner.userId,
      courseId,
      dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    await markOverdueEnrolments(organisationId);

    await sweepTenant(organisationId);
    const afterFirst = (await myNotifications(learner, { limit: 200 })).length;

    await sweepTenant(organisationId);
    await sweepTenant(organisationId);
    const afterThree = (await myNotifications(learner, { limit: 200 })).length;

    expect(afterThree).toBe(afterFirst);
  });

  it("raises nothing when there is nothing to say", async () => {
    const quietSlug = `quiet-${Date.now()}`;
    const quiet = await withPlatformScope("quiet tenant", async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: quietSlug,
          legalName: "Quiet Ltd",
          displayName: "Quiet Co",
          status: "active",
        })
        .returning({ id: organisations.id });
      return organisation.id;
    });

    const result = await sweepTenant(quiet);
    expect(result).toEqual({
      dueSoon: 0,
      overdue: 0,
      awaitingAssessor: 0,
      awaitingModerator: 0,
    });

    await withPlatformScope("quiet teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, quiet)),
    );
  });
});

describe("the inbox", () => {
  it("counts what is unread and clears on reading", async () => {
    const courseId = await publishedCourse(`Counting ${suffix()}`);
    await enrolUser(admin, { userId: colleague.userId, courseId });

    const before = await unreadCount(colleague);
    expect(before).toBeGreaterThan(0);

    const [first] = await myNotifications(colleague);
    await markRead(colleague, first.id);

    expect(await unreadCount(colleague)).toBe(before - 1);

    await markAllRead(colleague);
    expect(await unreadCount(colleague)).toBe(0);
  });

  /** Marking somebody else's notification read would hide it from them. */
  it("cannot mark another person's notification as read", async () => {
    const courseId = await publishedCourse(`Not yours ${suffix()}`);
    await enrolUser(admin, { userId: learner.userId, courseId });

    const [theirs] = await myNotifications(learner);
    const beforeCount = await unreadCount(learner);

    await markRead(colleague, theirs.id);

    expect(await unreadCount(learner)).toBe(beforeCount);
  });
});

describe("the outbox", () => {
  it("holds email until a mail server exists, rather than losing it", async () => {
    const courseId = await publishedCourse(`Queued ${suffix()}`);
    await enrolUser(admin, { userId: learner.userId, courseId });

    const queued = await pendingEmails(500);
    const mine = queued.find((row) => row.subject.includes("Queued"));

    expect(mine).toBeDefined();
    expect(mine!.email).toBe("learner@notify.test");
    // Still pending: nothing has been sent and nothing has been dropped.
    expect(mine!.attempts).toBe(0);
  });

  it("knows it has no mail server configured", () => {
    // The environment under test has none, which is the honest default.
    expect(mailIsConfigured()).toBe(
      Boolean(process.env.MAIL_HOST && process.env.MAIL_FROM),
    );
  });

  it("renders a message that reads like a person wrote it", () => {
    const text = renderEmail({
      to: "someone@example.test",
      toName: "Sam",
      subject: "Your training is due",
      body: "Plant Safety Fundamentals is due on Friday.",
      linkUrl: "https://lms.example.test/learn/123",
    });

    expect(text).toContain("Hello Sam,");
    expect(text).toContain("Plant Safety Fundamentals");
    expect(text).toContain("https://lms.example.test/learn/123");
  });
});

describe("tenant separation", () => {
  it("keeps notifications inside the organisation that raised them", async () => {
    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ organisationId: notifications.organisationId })
        .from(notifications),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organisationId === organisationId)).toBe(
      true,
    );

    // And the enrolments they refer to belong here too.
    const theirs = await withTenant(organisationId, (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments),
    );
    expect(theirs.length).toBeGreaterThan(0);
  });
});
