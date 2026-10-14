/**
 * Discussion boards (job sheet D30, 14 October 2026), against a live database.
 *
 * Who may read and post follows the rest of the platform: learners on the
 * courses they are enrolled on, staff on the programmes they are named on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { courses, enrolments, notifications, organisations, programmeStaff, userRoles, users } from "@/db/schema";
import { getBoard, getThread, myBoards, removePost, reply, setThreadFlags, startThread } from "@/lib/discussions";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let courseId: string;
let learner: AuthenticatedSession;
let classmate: AuthenticatedSession;
let outsider: AuthenticatedSession;
let facilitator: AuthenticatedSession;
let otherFacilitator: AuthenticatedSession;

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

async function person(email: string, role: Role): Promise<AuthenticatedSession> {
  const id = await withPlatformScope("discussion test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ organisationId, email, firstName: email.split("@")[0], lastName: "Tester", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    return user.id;
  });
  return sessionFor([role], id);
}

beforeAll(async () => {
  const slug = `discuss-${Date.now()}`;
  organisationId = await withPlatformScope("discussion test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Discussion Test Co", status: "active" })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  learner = await person("learner@discuss.test", "learner");
  classmate = await person("classmate@discuss.test", "learner");
  outsider = await person("outsider@discuss.test", "learner");
  facilitator = await person("facilitator@discuss.test", "instructor");
  otherFacilitator = await person("other@discuss.test", "instructor");

  courseId = await withPlatformScope("discussion test course", async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "SU1 Organisational Architecture", status: "published" })
      .returning({ id: courses.id });
    await tx.insert(enrolments).values([
      { organisationId, userId: learner.userId, courseId: course.id },
      { organisationId, userId: classmate.userId, courseId: course.id },
    ]);
    await tx.insert(programmeStaff).values({ organisationId, userId: facilitator.userId, capacity: "facilitator", courseId: course.id });
    return course.id;
  });
});

afterAll(async () => {
  await withPlatformScope("discussion test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("who may take part", () => {
  it("lets a learner on the course and its named facilitator in", async () => {
    expect((await getBoard(learner, courseId)).access).toEqual({ read: true, post: true, moderate: false });
    expect((await getBoard(facilitator, courseId)).access).toEqual({ read: true, post: true, moderate: true });
    expect((await myBoards(learner)).map((board) => board.courseId)).toContain(courseId);
  });

  it("keeps out a learner not on it and a facilitator not named on it", async () => {
    await expect(getBoard(outsider, courseId)).rejects.toThrow(/people on that course/);
    await expect(getBoard(otherFacilitator, courseId)).rejects.toThrow(/people on that course/);
    await expect(startThread(outsider, { courseId, title: "Hello", body: "Anyone here?" })).rejects.toThrow();
    expect((await myBoards(otherFacilitator)).map((board) => board.courseId)).not.toContain(courseId);
  });
});

describe("discussing", () => {
  it("tells every learner of a facilitator's discussion, and the people in it of a reply", async () => {
    const threadId = await startThread(facilitator, {
      courseId,
      title: "Reflect: where does job architecture start?",
      body: "Post one example from your own workplace.",
    });

    const told = await withTenant(organisationId, (tx) =>
      tx.select().from(notifications).where(and(eq(notifications.entityId, threadId), eq(notifications.kind, "discussion.started"))),
    );
    expect(told.map((row) => row.userId).sort()).toEqual([learner.userId, classmate.userId].sort());

    await reply(learner, { threadId, body: "In my company it starts with the job profile." });
    const replied = await withTenant(organisationId, (tx) =>
      tx.select().from(notifications).where(and(eq(notifications.entityId, threadId), eq(notifications.kind, "discussion.reply"))),
    );
    expect(replied.map((row) => row.userId)).toEqual([facilitator.userId]);

    const thread = await getThread(classmate, threadId);
    expect(thread.posts).toHaveLength(2);
    expect(thread.posts[0].authorIsStaff).toBe(true);
  });

  it("refuses a learner's reply once the facilitator closes it", async () => {
    const threadId = await startThread(learner, { courseId, title: "Question on IAC0103", body: "What counts as evidence?" });
    await setThreadFlags(facilitator, threadId, { locked: true });
    await expect(reply(classmate, { threadId, body: "Following." })).rejects.toThrow(/closed to replies/);
    await expect(setThreadFlags(learner, threadId, { locked: false })).rejects.toThrow(/Only a facilitator/);
  });

  /** A removed post stays on the record for staff and is withheld from learners. */
  it("withholds a removed post from learners and keeps it for staff", async () => {
    const threadId = await startThread(learner, { courseId, title: "Study group", body: "Meeting on Thursday?" });
    const postId = await reply(classmate, { threadId, body: "Something unkind." });

    await expect(removePost(learner, postId)).rejects.toThrow(/Only the author or a facilitator/);
    await removePost(facilitator, postId);

    const toLearner = (await getThread(learner, threadId)).posts.find((post) => post.id === postId)!;
    const toStaff = (await getThread(facilitator, threadId)).posts.find((post) => post.id === postId)!;
    expect(toLearner.body).toBeNull();
    expect(toStaff.body).toBe("Something unkind.");
  });
});
