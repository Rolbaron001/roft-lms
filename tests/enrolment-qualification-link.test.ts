/**
 * An enrolment records the qualification its course counts towards.
 *
 * Job sheet A2, finding W1, 26 September. A cohort enrols its learners without
 * naming a qualification, and the enrolment kept none, so a learner who
 * finished SU1 through a cohort did not appear in EISA readiness and could not
 * be given a statement of results. The course already knew: through its study
 * unit, or the module it teaches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  courses,
  curriculumModules,
  enrolments,
  organisations,
  qualifications,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { enrolUser } from "@/lib/enrolment";
import { permissionsFor } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const slug = `qualink-${Date.now()}`;
  await withPlatformScope("enrolment qualification test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: slug, status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    const [adminUser] = await tx
      .insert(users)
      .values({ organisationId, email: `admin-${slug}@example.test`, firstName: "A", lastName: "Admin", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: adminUser.id, role: "tenant_admin" });
    ids.admin = adminUser.id;

    for (const name of ["one", "two", "three", "four"]) {
      const [learner] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Learner", status: "active" })
        .returning({ id: users.id });
      ids[name] = learner.id;
    }

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Occupational Certificate: Linking" })
      .returning({ id: qualifications.id });
    ids.qualification = qualification.id;

    const [other] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Another qualification" })
      .returning({ id: qualifications.id });
    ids.other = other.id;

    const [unit] = await tx
      .insert(studyUnits)
      .values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit one" })
      .returning({ id: studyUnits.id });
    const [module] = await tx
      .insert(curriculumModules)
      .values({ organisationId, qualificationId: qualification.id, component: "knowledge", code: "KM-01", title: "Module one" })
      .returning({ id: curriculumModules.id });

    const course = async (values: Partial<typeof courses.$inferInsert>) =>
      (
        await tx
          .insert(courses)
          .values({ organisationId, title: "Course", status: "published", ...values })
          .returning({ id: courses.id })
      )[0].id;

    ids.unitCourse = await course({ studyUnitId: unit.id });
    ids.moduleCourse = await course({ curriculumModuleId: module.id });
    ids.plainCourse = await course({});
  });

  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: ids.admin,
    organisationId,
    email: "admin@example.test",
    firstName: "A",
    lastName: "Admin",
    roles: ["tenant_admin"],
    permissions: permissionsFor({ roles: ["tenant_admin"] }),
    mustChangePassword: false,
    aiOn: false,
  };
});

afterAll(async () => {
  await withPlatformScope("enrolment qualification test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function qualificationOf(enrolmentId: string) {
  return withPlatformScope("enrolment qualification test read", async (tx) => {
    const [row] = await tx
      .select({ qualificationId: enrolments.qualificationId })
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));
    return row.qualificationId;
  });
}

describe("the qualification an enrolment counts towards", () => {
  it("comes from the course's study unit when nobody names it", async () => {
    const created = await enrolUser(admin, { userId: ids.one, courseId: ids.unitCourse });
    expect(await qualificationOf(created.id)).toBe(ids.qualification);
  });

  it("comes from the module a course teaches", async () => {
    const created = await enrolUser(admin, { userId: ids.two, courseId: ids.moduleCourse });
    expect(await qualificationOf(created.id)).toBe(ids.qualification);
  });

  it("is left empty for training that counts towards nothing", async () => {
    const created = await enrolUser(admin, { userId: ids.three, courseId: ids.plainCourse });
    expect(await qualificationOf(created.id)).toBeNull();
  });

  it("is whatever the person enrolling chose, when they chose", async () => {
    const created = await enrolUser(admin, {
      userId: ids.four,
      courseId: ids.unitCourse,
      qualificationId: ids.other,
    });
    expect(await qualificationOf(created.id)).toBe(ids.other);
  });
});
