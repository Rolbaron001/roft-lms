/**
 * Room in the shared LMS classroom (Roland, 29 October 2026): each provider's
 * allowance, the deployment's limit, the check when a class is booked, moving
 * one session another way, and the list of classes left without room.
 *
 * The classes are booked on a date far ahead, so no other test's classes
 * share the classroom with them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { cohorts, courses, organisations, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { scheduleSession, setSessionMethod, sessionsWithoutRoom } from "@/lib/scheduling";
import { classesWithoutRoom, roomInClassroom } from "@/lib/classroom-capacity";
import { setTenantClassroom } from "@/lib/provisioning";

const DAY = "2031-03-04";

let alpha: { organisationId: string; admin: AuthenticatedSession; cohortId: string };
let beta: { organisationId: string; admin: AuthenticatedSession; cohortId: string };
const savedCapacity = process.env.CLASSROOM_CAPACITY;

function sessionFor(organisationId: string, roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@capacity.test",
    firstName: "Test",
    lastName: "Admin",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function provider(slug: string, allowance: number | null) {
  return withPlatformScope("classroom capacity test fixture", async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: slug, status: "active", liveClassMethod: "lms_classroom", classroomAllowance: allowance })
      .returning({ id: organisations.id });
    const [user] = await tx
      .insert(users)
      .values({ organisationId: org.id, email: `admin@${slug}.test`, firstName: "Admin", lastName: slug, status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: org.id, userId: user.id, role: "tenant_admin" });
    const [course] = await tx.insert(courses).values({ organisationId: org.id, title: "SU1", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId: org.id, courseId: course.id, name: `${slug} cohort`, startDate: "2031-01-01", status: "running" })
      .returning({ id: cohorts.id });
    return { organisationId: org.id, admin: sessionFor(org.id, ["tenant_admin"], user.id), cohortId: cohort.id };
  });
}

function book(who: typeof alpha, startTime: string, endTime: string, extra: Record<string, string> = {}) {
  return scheduleSession(who.admin, { cohortId: who.cohortId, scheduledDate: DAY, startTime, endTime, deliveryMode: "virtual", ...extra });
}

beforeAll(async () => {
  process.env.CLASSROOM_CAPACITY = "2";
  const stamp = Date.now();
  alpha = await provider(`capacity-a-${stamp}`, 1);
  beta = await provider(`capacity-b-${stamp}`, null);
});

afterAll(async () => {
  if (savedCapacity === undefined) delete process.env.CLASSROOM_CAPACITY;
  else process.env.CLASSROOM_CAPACITY = savedCapacity;
  await withPlatformScope("classroom capacity test teardown", async (tx) => {
    for (const one of [alpha, beta]) if (one) await tx.delete(organisations).where(eq(organisations.id, one.organisationId));
  });
});

describe("room in the shared classroom", () => {
  it("holds a provider to its own allowance", async () => {
    await book(alpha, "18:00", "20:00");
    await expect(book(alpha, "19:00", "21:00")).rejects.toThrow(/your allowance is 1 class at once/);
    // Back to back is not at the same time.
    await expect(book(alpha, "20:00", "22:00")).resolves.toBeTruthy();
  });

  it("books a class held another way without counting it", async () => {
    await expect(book(alpha, "19:00", "21:00", { liveClassMethod: "meeting_link" })).resolves.toBeTruthy();
    await expect(book(alpha, "19:00", "21:00", { meetingUrl: "https://meet.example/abc" })).resolves.toBeTruthy();
  });

  it("holds every provider to the deployment's limit, without naming the others", async () => {
    await book(beta, "18:00", "20:00");
    const refused = book(beta, "19:00", "20:30");
    await expect(refused).rejects.toThrow("The LMS classroom is full at this time. Choose another time, or hold this session another way.");
    await expect(refused).rejects.not.toThrow(new RegExp(alpha.admin.organisationId));
    expect(await roomInClassroom(beta.organisationId, { scheduledDate: DAY, startTime: "21:00", endTime: "22:30" })).toEqual({ fits: true });
  });

  it("checks room when one session is moved into the classroom, not when it is moved out", async () => {
    const elsewhere = await book(alpha, "18:30", "19:30", { liveClassMethod: "microsoft_teams" });
    await expect(setSessionMethod(alpha.admin, elsewhere.id, { method: "lms_classroom" })).rejects.toThrow(/allowance/);
    const inside = await book(alpha, "22:00", "23:00");
    await expect(setSessionMethod(alpha.admin, inside.id, { method: "google_meet", meetingUrl: "meet.google.com/xyz" })).resolves.toBeUndefined();
    // The same class back in: there is room, and it does not count against itself.
    await expect(setSessionMethod(alpha.admin, inside.id, { method: null })).resolves.toBeUndefined();
  });

  it("names the classes left without room once an allowance is lowered, the last booked first", async () => {
    await withPlatformScope("classroom capacity test: lowering an allowance", (tx) =>
      tx.update(organisations).set({ classroomAllowance: 0 }).where(eq(organisations.id, beta.organisationId)),
    );
    const now = new Date("2031-03-01T00:00:00Z");
    const found = await classesWithoutRoom(beta.organisationId, now);
    expect(found.length).toBe(1);
    expect(found[0].reason).toBe("not_offered");
    // Alpha's list is alpha's own.
    expect((await classesWithoutRoom(alpha.organisationId, now)).length).toBe(0);
    const listed = await sessionsWithoutRoom(beta.admin);
    expect(listed.every((one) => one.cohortId === beta.cohortId)).toBe(true);
  });

  it("does not let a provider choose the classroom when it is not offered", async () => {
    await expect(
      setTenantClassroom(beta.admin, { method: "lms_classroom", cameras: true, presentPercent: 75, attendanceTarget: null, transcribe: false }),
    ).rejects.toThrow(/not offered/);
    await expect(
      setTenantClassroom(beta.admin, { method: "google_meet", cameras: true, presentPercent: 75, attendanceTarget: null, transcribe: false }),
    ).resolves.toBeUndefined();
  });
});
