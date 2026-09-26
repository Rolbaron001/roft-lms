/**
 * Learning records out of one provider and into another, as xAPI.
 *
 * Job sheet A10, Roland 27 September: a provider's learning records must be
 * able to move to and from another system. Tested as the round trip a
 * provider would make: one provider's records exported, then imported into a
 * second, where the same learner is known by the same email.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  courseSections,
  courses,
  enrolments,
  lessons,
  organisations,
  progressRecords,
  userRoles,
  users,
} from "@/db/schema";
import {
  exportStatements,
  externalRecordsFor,
  importStatements,
  readStatements,
  statementId,
  XapiError,
  type Statement,
} from "@/lib/xapi";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const stamp = Date.now();
const ids: Record<string, string> = {};

function sessionFor(organisationId: string, userId: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "x@example.test",
    firstName: "X",
    lastName: "Y",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function provider(slug: string) {
  return withPlatformScope("xapi fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: `${slug} Academy`, status: "active" })
      .returning({ id: organisations.id });
    const [admin] = await tx
      .insert(users)
      .values({ organisationId: organisation.id, email: `admin-${slug}@example.test`, firstName: "A", lastName: "Admin", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: organisation.id, userId: admin.id, role: "tenant_admin" });
    return { organisationId: organisation.id, adminId: admin.id };
  });
}

let from: { organisationId: string; adminId: string };
let to: { organisationId: string; adminId: string };
let exported: Statement[];

beforeAll(async () => {
  from = await provider(`xapi-from-${stamp}`);
  to = await provider(`xapi-to-${stamp}`);

  await withPlatformScope("xapi records", async (tx) => {
    const organisationId = from.organisationId;
    const [learner] = await tx
      .insert(users)
      .values({ organisationId, email: `Thandi-${stamp}@Example.test`, firstName: "Thandi", lastName: "Mokoena", status: "active" })
      .returning({ id: users.id });
    ids.learner = learner.id;
    const [assessor] = await tx
      .insert(users)
      .values({ organisationId, email: `assessor-${stamp}@example.test`, firstName: "N", lastName: "Assessor", status: "active" })
      .returning({ id: users.id });

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "Records Management", status: "published" })
      .returning({ id: courses.id });
    const [section] = await tx
      .insert(courseSections)
      .values({ organisationId, courseId: course.id, title: "One" })
      .returning({ id: courseSections.id });
    const [lesson] = await tx
      .insert(lessons)
      .values({ organisationId, sectionId: section.id, title: "Filing a record" })
      .returning({ id: lessons.id });
    const [enrolment] = await tx
      .insert(enrolments)
      .values({
        organisationId,
        userId: learner.id,
        courseId: course.id,
        status: "completed",
        createdAt: new Date("2026-09-01T10:00:00Z"),
        completedAt: new Date("2026-09-10T10:00:00Z"),
      })
      .returning({ id: enrolments.id });
    await tx.insert(progressRecords).values({
      organisationId,
      enrolmentId: enrolment.id,
      lessonId: lesson.id,
      state: "completed",
      completedAt: new Date("2026-09-05T10:00:00Z"),
    });
    const [assessment] = await tx
      .insert(assessments)
      .values({ organisationId, courseId: course.id, title: "Records Summative", purpose: "summative", status: "published" })
      .returning({ id: assessments.id });
    const [submission] = await tx
      .insert(assessmentSubmissions)
      .values({
        organisationId,
        assessmentId: assessment.id,
        userId: learner.id,
        enrolmentId: enrolment.id,
        status: "assessed",
        autoScore: "8",
        maxScore: "10",
        submittedAt: new Date("2026-09-08T10:00:00Z"),
        declarationText: "Mine.",
        declarationAcceptedAt: new Date("2026-09-08T10:00:00Z"),
      })
      .returning({ id: assessmentSubmissions.id });
    await tx.insert(assessmentDecisions).values({
      organisationId,
      submissionId: submission.id,
      assessorId: assessor.id,
      outcome: "competent",
      signedAt: new Date("2026-09-09T10:00:00Z"),
    });
  });

  exported = await exportStatements(
    sessionFor(from.organisationId, from.adminId, ["tenant_admin"]),
    "https://from.example.test",
  );
});

afterAll(async () => {
  await withPlatformScope("xapi teardown", async (tx) => {
    await tx.delete(assessmentDecisions).where(eq(assessmentDecisions.organisationId, from.organisationId));
    await tx.delete(organisations).where(eq(organisations.id, from.organisationId));
    await tx.delete(organisations).where(eq(organisations.id, to.organisationId));
  });
});

describe("taking records out", () => {
  it("writes each record as a statement, in order", () => {
    const verbs = exported.map((s) => s.verb.display["en-US"]);
    expect(verbs).toEqual(["registered", "completed", "attempted", "passed", "completed"]);
    const attempted = exported.find((s) => s.verb.display["en-US"] === "attempted")!;
    expect(attempted.result?.score).toEqual({ raw: 8, min: 0, max: 10, scaled: 0.8 });
    expect(attempted.object.id).toMatch(/^https:\/\/from\.example\.test\/xapi\/activities\/assessment\//);
    expect(attempted.actor.mbox).toBe(`mailto:Thandi-${stamp}@Example.test`);
  });

  it("uses the identifiers the published vocabularies define", () => {
    const verbIds = new Set(exported.map((s) => s.verb.id));
    for (const id of verbIds) expect(id).toMatch(/^http:\/\/adlnet\.gov\/expapi\/verbs\/(registered|attempted|completed|passed|failed)$/);
    const course = exported.find((s) => s.verb.display["en-US"] === "registered")!;
    expect(course.object.definition.type).toBe("https://w3id.org/xapi/cmi5/activitytype/course");
  });

  it("gives each record the same statement id every time", async () => {
    const again = await exportStatements(
      sessionFor(from.organisationId, from.adminId, ["tenant_admin"]),
      "https://from.example.test",
    );
    expect(again.map((s) => s.id)).toEqual(exported.map((s) => s.id));
    for (const s of exported) expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(statementId("a")).not.toBe(statementId("b"));
  });

  it("is for a provider administrator only", async () => {
    await expect(
      exportStatements(sessionFor(from.organisationId, ids.learner, ["learner"]), "https://from.example.test"),
    ).rejects.toThrow();
  });
});

describe("bringing records in", () => {
  const file = () => ({
    filename: "from-export.json",
    bytes: new TextEncoder().encode(JSON.stringify({ statements: exported })),
  });

  it("keeps statements for a learner who is not here yet, and attaches them once invited", async () => {
    const admin = sessionFor(to.organisationId, to.adminId, ["tenant_admin"]);
    const summary = await importStatements(admin, file());
    expect(summary).toMatchObject({ read: 5, added: 5, alreadyHeld: 0, learnersMatched: 0 });
    expect(summary.unmatchedActors).toEqual([`mailto:Thandi-${stamp}@Example.test`]);

    // Invited later, with the same address in a different case.
    const [person] = await withPlatformScope("xapi invite", (tx) =>
      tx
        .insert(users)
        .values({ organisationId: to.organisationId, email: `thandi-${stamp}@example.test`, firstName: "Thandi", lastName: "Mokoena", status: "active" })
        .returning({ id: users.id }),
    );
    const records = await externalRecordsFor(admin, person.id);
    expect(records).toHaveLength(5);
    expect(records.map((r) => r.verb)).toContain("passed");
  });

  it("adds nothing when the same export is imported twice", async () => {
    const admin = sessionFor(to.organisationId, to.adminId, ["tenant_admin"]);
    const summary = await importStatements(admin, file());
    expect(summary.added).toBe(0);
    expect(summary.alreadyHeld).toBe(5);
    expect(summary.learnersMatched).toBe(1);
  });

  it("says which statements it could not read, and why", () => {
    const { statements, rejected } = readStatements(
      JSON.stringify([
        { actor: { mbox: "mailto:a@b.test" }, verb: { id: "http://adlnet.gov/expapi/verbs/completed" }, object: { id: "x:1" } },
        { verb: { id: "v" }, object: { id: "o" } },
        { actor: { mbox: "mailto:a@b.test" }, object: { id: "o" } },
      ]),
    );
    expect(statements).toHaveLength(1);
    expect(rejected).toEqual([
      "Statement 2 names no learner by email or account.",
      "Statement 3 has no verb.",
    ]);
    expect(() => readStatements("not json")).toThrow(XapiError);
  });
});
