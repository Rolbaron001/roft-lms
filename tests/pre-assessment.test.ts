/**
 * The pre-assessment checklist before each study unit (job sheet D32,
 * 19 October 2026), against a live database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { courses, enrolments, organisations, preAssessmentConfirmations, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { checklistOwed, confirmChecklist, DEFAULT_CHECKLIST, saveChecklist, unitChecklist } from "@/lib/pre-assessment";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let unitCourseId: string;
let plainCourseId: string;
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
    aiOn: false,
  };
}

async function person(email: string, role: Role) {
  const id = await withPlatformScope("pre-assessment test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ organisationId, email, firstName: "Pre", lastName: "Tester", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    return user.id;
  });
  return sessionFor([role], id);
}

const owed = (courseId: string) => withTenant(organisationId, (tx) => checklistOwed(tx, courseId, learner.userId));

beforeAll(async () => {
  const slug = `pre-${Date.now()}`;
  organisationId = await withPlatformScope("pre-assessment test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Pre-assessment Test Co", status: "active" })
      .returning({ id: organisations.id });
    return organisation.id;
  });
  admin = await person("admin@pre.test", "tenant_admin");
  learner = await person("learner@pre.test", "learner");

  await withPlatformScope("pre-assessment test courses", async (tx) => {
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Test qualification" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Study unit one" }).returning({ id: studyUnits.id });
    const [unitCourse] = await tx.insert(courses).values({ organisationId, title: "SU1", studyUnitId: unit.id, status: "published" }).returning({ id: courses.id });
    const [plain] = await tx.insert(courses).values({ organisationId, title: "A short course", status: "published" }).returning({ id: courses.id });
    unitCourseId = unitCourse.id;
    plainCourseId = plain.id;
    await tx.insert(enrolments).values([
      { organisationId, userId: learner.userId, courseId: unitCourse.id },
      { organisationId, userId: learner.userId, courseId: plain.id },
    ]);
  });
});

afterAll(async () => {
  await withPlatformScope("pre-assessment test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("the pre-assessment checklist", () => {
  it("asks nothing until the provider switches it on", async () => {
    expect(await owed(unitCourseId)).toBe(false);
    expect(await unitChecklist(learner, unitCourseId)).toBeNull();
  });

  it("is owed on a study unit, not on a course that is not one", async () => {
    await saveChecklist(admin, { ...DEFAULT_CHECKLIST, enabled: true });
    expect(await owed(unitCourseId)).toBe(true);
    expect(await owed(plainCourseId)).toBe(false);
    expect((await unitChecklist(learner, unitCourseId))?.owed).toBe(true);
  });

  it("refuses a confirmation with a statement unticked or the declaration not agreed", async () => {
    await expect(
      confirmChecklist(learner, { courseId: unitCourseId, ticked: DEFAULT_CHECKLIST.items.length - 1, declarationAccepted: true }),
    ).rejects.toThrow(/Tick every statement/);
    await expect(
      confirmChecklist(learner, { courseId: unitCourseId, ticked: DEFAULT_CHECKLIST.items.length, declarationAccepted: false }),
    ).rejects.toThrow(/Agree to the declaration/);
    expect(await owed(unitCourseId)).toBe(true);
  });

  it("opens the study unit once confirmed, and keeps the wording agreed", async () => {
    await confirmChecklist(learner, { courseId: unitCourseId, ticked: DEFAULT_CHECKLIST.items.length, declarationAccepted: true });
    expect(await owed(unitCourseId)).toBe(false);

    const [kept] = await withTenant(organisationId, (tx) =>
      tx.select().from(preAssessmentConfirmations).where(eq(preAssessmentConfirmations.courseId, unitCourseId)),
    );
    expect(kept.declaration).toBe(DEFAULT_CHECKLIST.declaration);
    expect(kept.items).toHaveLength(DEFAULT_CHECKLIST.items.length);
  });

  it("is set by an administrator only", async () => {
    await expect(saveChecklist(learner, { ...DEFAULT_CHECKLIST, enabled: false })).rejects.toThrow();
  });
});
