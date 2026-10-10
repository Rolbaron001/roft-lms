/**
 * Facilitators, assessors and moderators see only what they are assigned to
 * (Roland, 10 October 2026), against a live database. Two qualifications,
 * people assigned to parts of them, and learners on each.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessments,
  assessmentSubmissions,
  cohortMembers,
  cohorts,
  courses,
  enrolments,
  organisations,
  programmeStaff,
  qualifications,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { listAssessorQueue, listModerationQueue } from "@/lib/assessment";
import { listCourses, listQualifications } from "@/lib/authoring";
import { getCohort, listCohorts } from "@/lib/cohorts";
import { activeProgrammes } from "@/lib/tracker";
import { isAssignedOnly, learnerInReach, reachOf } from "@/lib/staff-scope";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const people: Record<string, string> = {};
const ids: Record<string, string> = {};

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "scope@example.test",
    firstName: "Scope",
    lastName: "Tester",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

const roleOf: Record<string, Role[]> = {
  admin: ["tenant_admin"],
  cara: ["assessor"],
  dan: ["moderator"],
  anna: ["instructor"],
  nobody: ["assessor"],
  both: ["tenant_admin", "assessor"],
  sdf: ["skills_development_facilitator"],
  l1: ["learner"],
  l3: ["learner"],
};
const as = (name: string) => sessionFor(roleOf[name], people[name]);

beforeAll(async () => {
  const slug = `scope-${Date.now()}`;
  await withPlatformScope("staff scope test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Scope Test Co", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, roles] of Object.entries(roleOf)) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      for (const role of roles) await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
      people[name] = user.id;
    }
    const [q1] = await tx.insert(qualifications).values({ organisationId, title: "Qualification One" }).returning({ id: qualifications.id });
    const [q2] = await tx.insert(qualifications).values({ organisationId, title: "Qualification Two" }).returning({ id: qualifications.id });
    ids.q1 = q1.id;
    ids.q2 = q2.id;
    const unit = async (qualificationId: string, code: string) => {
      const [su] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code, title: code }).returning({ id: studyUnits.id });
      const [course] = await tx.insert(courses).values({ organisationId, studyUnitId: su.id, title: `${code} course`, status: "published" }).returning({ id: courses.id });
      return { unit: su.id, course: course.id };
    };
    const su1 = await unit(q1.id, "SU1");
    const su2 = await unit(q1.id, "SU2");
    const su3 = await unit(q2.id, "SU3");
    Object.assign(ids, { su1: su1.unit, c1: su1.course, c2: su2.course, c3: su3.course });

    const [cohortA] = await tx.insert(cohorts).values({ organisationId, qualificationId: q1.id, name: "Cohort A", startDate: "2026-10-01" }).returning({ id: cohorts.id });
    const [cohortB] = await tx.insert(cohorts).values({ organisationId, qualificationId: q2.id, name: "Cohort B", startDate: "2026-10-01", facilitatorId: people.anna }).returning({ id: cohorts.id });
    ids.cohortA = cohortA.id;
    ids.cohortB = cohortB.id;

    // Cara assesses study unit 1 only; Dan moderates qualification two.
    await tx.insert(programmeStaff).values({ organisationId, userId: people.cara, capacity: "assessor", studyUnitId: su1.unit });
    await tx.insert(programmeStaff).values({ organisationId, userId: people.dan, capacity: "moderator", qualificationId: q2.id });

    // A learner on course one and one on course three, each with work handed in.
    for (const [learner, courseId, cohortId] of [["l1", su1.course, cohortA.id], ["l3", su3.course, cohortB.id]] as const) {
      const [enrolment] = await tx.insert(enrolments).values({ organisationId, userId: people[learner], courseId, qualificationId: courseId === su3.course ? q2.id : q1.id }).returning({ id: enrolments.id });
      await tx.insert(cohortMembers).values({ organisationId, cohortId, userId: people[learner] });
      const [assessment] = await tx.insert(assessments).values({ organisationId, courseId, title: `Test for ${learner}`, status: "published", purpose: "summative" }).returning({ id: assessments.id });
      const [submission] = await tx
        .insert(assessmentSubmissions)
        .values({ organisationId, assessmentId: assessment.id, userId: people[learner], enrolmentId: enrolment.id, status: "submitted", submittedAt: new Date() })
        .returning({ id: assessmentSubmissions.id });
      ids[`sub_${learner}`] = submission.id;
    }
  });
});

afterAll(async () => {
  await withPlatformScope("staff scope test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("who is restricted", () => {
  it("restricts facilitators, assessors and moderators, and nobody who answers for the whole provider", () => {
    expect(isAssignedOnly(as("cara"))).toBe(true);
    expect(isAssignedOnly(as("anna"))).toBe(true);
    expect(isAssignedOnly(as("both"))).toBe(false);
    expect(isAssignedOnly(as("sdf"))).toBe(false);
    expect(isAssignedOnly(as("l1"))).toBe(false);
    expect(isAssignedOnly({ roles: ["tenant_viewer", "assessor"] })).toBe(false);
  });
});

describe("an assessor named on one study unit", () => {
  it("reaches that unit's course, its qualification and the qualification's cohort", async () => {
    const reach = await reachOf(as("cara"));
    if (reach.whole) throw new Error("expected a restricted reach");
    expect([...reach.courses]).toEqual([ids.c1]);
    expect([...reach.qualifications]).toEqual([ids.q1]);
    expect([...reach.cohorts]).toEqual([ids.cohortA]);
  });

  it("is shown only that course, qualification and cohort", async () => {
    expect((await listCourses(as("cara"))).map((row) => row.id)).toEqual([ids.c1]);
    expect((await listQualifications(as("cara"))).map((row) => row.id)).toEqual([ids.q1]);
    expect((await listCohorts(as("cara"))).map((row) => row.id)).toEqual([ids.cohortA]);
    expect((await activeProgrammes(as("cara"))).map((row) => row.cohortId)).toEqual([ids.cohortA]);
  });

  it("is given only that course's work to assess", async () => {
    expect((await listAssessorQueue(as("cara"))).map((row) => row.submissionId)).toEqual([ids.sub_l1]);
  });

  it("cannot open the other qualification's cohort", async () => {
    await expect(getCohort(as("cara"), ids.cohortB)).rejects.toThrow(/not one of the programmes/);
  });

  it("knows its own learners from everybody else's", async () => {
    const reach = await reachOf(as("cara"));
    await withTenant(organisationId, async (tx) => {
      expect(await learnerInReach(tx, reach, people.l1)).toBe(true);
      expect(await learnerInReach(tx, reach, people.l3)).toBe(false);
    });
  });
});

describe("a moderator named on the other qualification", () => {
  it("is given nothing to moderate from the first", async () => {
    expect(await listModerationQueue(as("dan"))).toEqual([]);
    expect((await listCohorts(as("dan"))).map((row) => row.id)).toEqual([ids.cohortB]);
  });
});

describe("a facilitator who takes a cohort", () => {
  it("reaches the cohort and its qualification's courses without being named on the programme", async () => {
    expect((await listCohorts(as("anna"))).map((row) => row.id)).toEqual([ids.cohortB]);
    expect((await listCourses(as("anna"))).map((row) => row.id)).toEqual([ids.c3]);
  });
});

describe("somebody assigned to nothing", () => {
  it("sees nothing of anybody else's", async () => {
    expect(await listCourses(as("nobody"))).toEqual([]);
    expect(await listCohorts(as("nobody"))).toEqual([]);
    expect(await listAssessorQueue(as("nobody"))).toEqual([]);
  });
});

describe("an administrator who also assesses", () => {
  it("still sees the whole provider", async () => {
    expect((await listCourses(as("both"))).length).toBe(3);
    expect((await listAssessorQueue(as("both"))).length).toBe(2);
  });
});
