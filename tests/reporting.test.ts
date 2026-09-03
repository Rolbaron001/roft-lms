/**
 * Reporting, against a live database.
 *
 * Two risks are guarded here. The first is scope: a reporting screen is the
 * easiest place to accidentally hand a line manager the whole workforce. The
 * second is honesty of the capability numbers - counting a course completion
 * as capability would overstate coverage, which is exactly the number a client
 * would act on.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
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
import {
  enrolUser,
  getEnrolmentForDelivery,
  markLessonComplete,
  markOverdueEnrolments,
} from "@/lib/enrolment";
import { revokeCertificate, listMyCertificates } from "@/lib/certificates";
import {
  capabilityCoverage,
  courseCompletion,
  headlineNumbers,
  overdueTraining,
  scopeFor,
  teamStatus,
  toCsv,
} from "@/lib/reporting";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let manager: AuthenticatedSession;
let reportA: AuthenticatedSession;
let reportB: AuthenticatedSession;
let outsider: AuthenticatedSession;

let competencyAlpha: string;
let competencyBeta: string;

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

async function createPerson(
  email: string,
  roles: Role[],
  extra: { team?: string; site?: string; lineManagerId?: string } = {},
) {
  return withPlatformScope("reporting test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
        team: extra.team ?? null,
        site: extra.site ?? null,
        lineManagerId: extra.lineManagerId ?? null,
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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A published course tagged to one competency. */
async function courseFor(competencyId: string) {
  const course = await createCourse(admin, { title: `Course ${suffix()}` });
  const section = await addSection(admin, {
    courseId: course.id,
    title: "Section",
  });
  await addLesson(admin, { sectionId: section.id, title: "Lesson" });
  await tagCourseCompetency(admin, course.id, competencyId);
  const published = await publishCourse(admin, course.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));
  return course.id;
}

/** Enrols someone and finishes the course, which issues their certificate. */
async function completeCourse(
  learner: AuthenticatedSession,
  courseId: string,
) {
  const enrolment = await enrolUser(admin, {
    userId: learner.userId,
    courseId,
  });
  const delivery = await getEnrolmentForDelivery(learner, enrolment.id);
  for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
    await markLessonComplete(learner, enrolment.id, lesson.id);
  }
  return enrolment.id;
}

beforeAll(async () => {
  const slug = `report-${Date.now()}`;

  const created = await withPlatformScope(
    "reporting test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Reporting Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({ organisationId: organisation.id, name: "Framework" })
        .returning({ id: competencyFrameworks.id });

      const inserted = await tx
        .insert(competencies)
        .values([
          {
            organisationId: organisation.id,
            frameworkId: framework.id,
            code: "CAP-01",
            name: "Alpha capability",
          },
          {
            organisationId: organisation.id,
            frameworkId: framework.id,
            code: "CAP-02",
            name: "Beta capability",
          },
        ])
        .returning({ id: competencies.id, code: competencies.code });

      return {
        organisationId: organisation.id,
        alpha: inserted.find((c) => c.code === "CAP-01")!.id,
        beta: inserted.find((c) => c.code === "CAP-02")!.id,
      };
    },
  );

  organisationId = created.organisationId;
  competencyAlpha = created.alpha;
  competencyBeta = created.beta;

  const adminId = await createPerson("admin@report.test", ["tenant_admin"]);
  admin = sessionFor(["tenant_admin"], adminId);

  const managerId = await createPerson("manager@report.test", ["line_manager"], {
    team: "Plant",
  });
  manager = sessionFor(["line_manager"], managerId);

  reportA = sessionFor(
    ["learner"],
    await createPerson("a@report.test", ["learner"], {
      team: "Plant",
      site: "Rustenburg",
      lineManagerId: managerId,
    }),
  );
  reportB = sessionFor(
    ["learner"],
    await createPerson("b@report.test", ["learner"], {
      team: "Plant",
      site: "Rustenburg",
      lineManagerId: managerId,
    }),
  );
  outsider = sessionFor(
    ["learner"],
    await createPerson("outsider@report.test", ["learner"], {
      team: "Logistics",
      site: "Durban",
    }),
  );
});

afterAll(async () => {
  await withPlatformScope("reporting test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("who may see what", () => {
  it("gives an administrator the whole tenant", () => {
    expect(scopeFor(admin)).toEqual({ kind: "tenant" });
  });

  it("gives a line manager their own reports only", () => {
    expect(scopeFor(manager)).toEqual({
      kind: "team",
      managerId: manager.userId,
    });
  });

  it("gives a learner only themselves", () => {
    expect(scopeFor(reportA)).toEqual({
      kind: "self",
      userId: reportA.userId,
    });
  });

  /**
   * The mistake this file exists to prevent: a reporting screen quietly
   * becoming a way around role restrictions.
   */
  it("counts only a manager's direct reports, not the whole workforce", async () => {
    const forManager = await headlineNumbers(manager);
    const forAdmin = await headlineNumbers(admin);

    expect(forManager.people).toBe(2);
    expect(forAdmin.people).toBeGreaterThan(forManager.people);
  });

  it("counts only themselves for a learner", async () => {
    expect((await headlineNumbers(reportA)).people).toBe(1);
  });

  it("does not show a manager somebody else's overdue training", async () => {
    const courseId = await courseFor(competencyAlpha);
    await enrolUser(admin, {
      userId: outsider.userId,
      courseId,
      dueDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    await markOverdueEnrolments(organisationId);

    const rows = await overdueTraining(manager);
    expect(rows.map((row) => row.userId)).not.toContain(outsider.userId);

    const adminRows = await overdueTraining(admin);
    expect(adminRows.map((row) => row.userId)).toContain(outsider.userId);
  });

  it("lists a manager's direct reports and nobody else", async () => {
    const team = await teamStatus(manager);
    const ids = team.map((row) => row.id);

    expect(ids).toContain(reportA.userId);
    expect(ids).toContain(reportB.userId);
    expect(ids).not.toContain(outsider.userId);
  });
});

describe("capability coverage", () => {
  it("lists a competency nobody holds, rather than omitting it", async () => {
    const rows = await capabilityCoverage(admin);
    const beta = rows.find((row) => row.code === "CAP-02");

    // A gap is invisible if the report only lists what people already have.
    expect(beta).toBeDefined();
    expect(beta!.holders).toBe(0);
    expect(beta!.noCoverage).toBe(true);
  });

  /**
   * The workforce-risk flag the platform is for: one person holding a
   * capability means a resignation removes it entirely.
   */
  it("flags a capability held by exactly one person", async () => {
    const courseId = await courseFor(competencyAlpha);
    await completeCourse(reportA, courseId);

    const rows = await capabilityCoverage(admin);
    const alpha = rows.find((row) => row.code === "CAP-01")!;

    expect(alpha.holders).toBe(1);
    expect(alpha.singlePointOfFailure).toBe(true);
    expect(alpha.noCoverage).toBe(false);
  });

  it("stops flagging it once a second person holds it", async () => {
    const courseId = await courseFor(competencyAlpha);
    await completeCourse(reportB, courseId);

    const rows = await capabilityCoverage(admin);
    const alpha = rows.find((row) => row.code === "CAP-01")!;

    expect(alpha.holders).toBeGreaterThanOrEqual(2);
    expect(alpha.singlePointOfFailure).toBe(false);
  });

  /**
   * Capability is counted from certificates. Withdrawing one must remove the
   * capability, or the report would keep asserting something the platform has
   * formally retracted.
   */
  it("stops counting a withdrawn certificate", async () => {
    const before = await capabilityCoverage(admin);
    const alphaBefore = before.find((row) => row.code === "CAP-01")!.holders;

    const theirs = await listMyCertificates(reportA);
    await revokeCertificate(admin, theirs[0].id, "Issued in error during testing.");

    const after = await capabilityCoverage(admin);
    const alphaAfter = after.find((row) => row.code === "CAP-01")!.holders;

    expect(alphaAfter).toBe(alphaBefore - 1);
  });

  it("counts one holder once, however many certificates they hold", async () => {
    const first = await courseFor(competencyBeta);
    const second = await courseFor(competencyBeta);
    await completeCourse(reportB, first);
    await completeCourse(reportB, second);

    const rows = await capabilityCoverage(admin);
    const beta = rows.find((row) => row.code === "CAP-02")!;

    expect(beta.holders).toBe(1);
  });

  it("reports coverage against the population in scope", async () => {
    const rows = await capabilityCoverage(manager);
    const alpha = rows.find((row) => row.code === "CAP-01")!;

    // The manager's scope is their two direct reports.
    expect(alpha.population).toBe(2);
  });

  it("returns nothing when the scope contains nobody", async () => {
    const lonely = sessionFor(
      ["line_manager"],
      await createPerson(`lonely-${suffix()}@report.test`, ["line_manager"]),
    );

    expect(await capabilityCoverage(lonely)).toEqual([]);
    expect((await headlineNumbers(lonely)).people).toBe(0);
  });
});

describe("course completion", () => {
  it("reports enrolled and completed per course", async () => {
    const courseId = await courseFor(competencyAlpha);
    await completeCourse(reportA, courseId);
    await enrolUser(admin, { userId: reportB.userId, courseId });

    const rows = await courseCompletion(admin);
    const row = rows.find((entry) => entry.courseId === courseId)!;

    expect(row.enrolled).toBe(2);
    expect(row.completed).toBe(1);
    expect(row.completionRate).toBe(50);
  });
});

describe("CSV export", () => {
  it("quotes fields containing commas, quotes and newlines", () => {
    const csv = toCsv(
      ["name", "note"],
      [["Smith, John", 'He said "hello"'], ["Line", "one\ntwo"]],
    );

    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"He said ""hello"""');
    expect(csv).toContain('"one\ntwo"');
  });

  /**
   * A field beginning with =, +, - or @ is treated as a formula by spreadsheet
   * software. A learner could put one in their own name, and it would run on
   * whoever opened the export.
   */
  it("neutralises values a spreadsheet would treat as a formula", () => {
    const csv = toCsv(
      ["name"],
      [["=cmd|'/c calc'!A1"], ["+1"], ["-2"], ["@SUM(A1)"]],
    );

    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM(A1)");
  });

  it("renders empty values as blanks rather than the word null", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,");
  });
});
