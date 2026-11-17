/**
 * A facilitator's announcements to a cohort (Heidi's role specifications,
 * job sheet D52 (1), 17 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { cohortMembers, cohorts, courses, notifications, organisations, programmeStaff, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { cohortAnnouncementList, getAnnouncement, postAnnouncement } from "@/lib/announcements";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@announce.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("announcements fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `announce-${Date.now()}`, legalName: "Announce Ltd", displayName: "Announce", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [["facilitator", "instructor"], ["other", "instructor"], ["learner", "learner"], ["outsider", "learner"], ["left", "learner"]] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@announce.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Announce Qualification" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: course.id, name: "March", startDate: "2027-03-01", status: "running" }).returning({ id: cohorts.id });
    ids.cohort = cohort.id;
    await tx.insert(programmeStaff).values({ organisationId, userId: ids.facilitator, capacity: "facilitator", qualificationId: qualification.id });
    await tx.insert(cohortMembers).values([
      { organisationId, cohortId: cohort.id, userId: ids.learner },
      { organisationId, cohortId: cohort.id, userId: ids.left, leftAt: new Date() },
    ]);
  });
});

afterAll(async () => {
  await withPlatformScope("announcements teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("a facilitator's announcement", () => {
  it("reaches every learner still in the cohort, by email when asked, and is kept", async () => {
    const posted = await postAnnouncement(sessionFor("facilitator", ["instructor"]), {
      cohortId: ids.cohort,
      subject: "Class moved to Thursday",
      body: "This week's class is on Thursday at 09:00.",
      email: true,
    });
    expect(posted.reached).toBe(1);

    const sent = await withTenant(organisationId, (tx) =>
      tx.select({ userId: notifications.userId, channel: notifications.channel }).from(notifications).where(and(eq(notifications.kind, "cohort.announcement"))),
    );
    expect(sent.map((row) => row.userId).every((id) => id === ids.learner)).toBe(true);
    expect(sent.map((row) => row.channel).sort()).toEqual(["email", "in_app"]);

    const list = await cohortAnnouncementList(sessionFor("learner", ["learner"]), ids.cohort);
    expect(list.map((one) => one.subject)).toEqual(["Class moved to Thursday"]);
    expect(await getAnnouncement(sessionFor("learner", ["learner"]), posted.id)).toMatchObject({ cohortName: "March" });
  });

  it("is refused to a facilitator not assigned to the cohort, and hidden from a learner outside it", async () => {
    await expect(
      postAnnouncement(sessionFor("other", ["instructor"]), { cohortId: ids.cohort, subject: "Not mine", body: "Hello", email: false }),
    ).rejects.toThrow(/not one of the cohorts you are assigned to/);
    expect(await cohortAnnouncementList(sessionFor("outsider", ["learner"]), ids.cohort)).toEqual([]);
  });

  it("is refused to a learner", async () => {
    await expect(
      postAnnouncement(sessionFor("learner", ["learner"]), { cohortId: ids.cohort, subject: "Hello all", body: "Hi", email: false }),
    ).rejects.toThrow();
  });
});
