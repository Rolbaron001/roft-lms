/**
 * Recording the qualification certificate a learner receives. Job sheet D2,
 * 27 September 2026.
 *
 * The provider issues statements of results and badges; the qualification
 * certificate comes from the awarding body after the EISA. Until now the
 * platform had nowhere to record that it arrived.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { courses, enrolments, organisations, qualifications, userRoles, users } from "@/db/schema";
import {
  awardsFor,
  recordQualificationAward,
  removeQualificationAward,
} from "@/lib/qualification-awards";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const people: Record<string, AuthenticatedSession> = {};

function sessionFor(userId: string, roles: Role[]): AuthenticatedSession {
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

beforeAll(async () => {
  const slug = `awards-${Date.now()}`;
  await withPlatformScope("awards fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Awards Provider", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    for (const [name, role] of [
      ["admin", "tenant_admin"],
      ["learner", "learner"],
      ["other", "learner"],
    ] as [string, Role][]) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: person.id, role });
      people[name] = sessionFor(person.id, [role]);
      ids[name] = person.id;
    }

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Occupational Certificate: Awarded" })
      .returning({ id: qualifications.id });
    ids.qualification = qualification.id;

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "The whole qualification", status: "published" })
      .returning({ id: courses.id });
    await tx.insert(enrolments).values({
      organisationId,
      userId: ids.learner,
      courseId: course.id,
      qualificationId: qualification.id,
      status: "in_progress",
    });
  });
});

afterAll(async () => {
  await withPlatformScope("awards teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("recording the qualification certificate", () => {
  it("is recorded against an enrolled learner, as the QCTO's unless told otherwise", async () => {
    const award = await recordQualificationAward(people.admin, {
      userId: ids.learner,
      qualificationId: ids.qualification,
      certificateNumber: "QCTO-2026-000123",
      awardedOn: "2026-11-20",
    });
    ids.award = award.id;
    expect(award.awardedBy).toBe("QCTO");

    const held = await awardsFor(people.learner, ids.learner);
    expect(held).toEqual([
      expect.objectContaining({
        certificateNumber: "QCTO-2026-000123",
        awardedOn: "2026-11-20",
        qualificationTitle: "Occupational Certificate: Awarded",
      }),
    ]);
  });

  it("is not recorded twice, nor for a learner not enrolled on the qualification", async () => {
    await expect(
      recordQualificationAward(people.admin, {
        userId: ids.learner,
        qualificationId: ids.qualification,
        certificateNumber: "again",
        awardedOn: "2026-11-21",
      }),
    ).rejects.toThrow(/already recorded/);
    await expect(
      recordQualificationAward(people.admin, {
        userId: ids.other,
        qualificationId: ids.qualification,
        certificateNumber: "x",
        awardedOn: "2026-11-21",
      }),
    ).rejects.toThrow(/not enrolled/);
  });

  it("is recorded by staff, and read only by the learner or staff", async () => {
    await expect(
      recordQualificationAward(people.learner, {
        userId: ids.learner,
        qualificationId: ids.qualification,
        certificateNumber: "mine",
        awardedOn: "2026-11-21",
      }),
    ).rejects.toThrow();
    await expect(awardsFor(people.other, ids.learner)).rejects.toThrow();
  });

  it("is removed only with a reason", async () => {
    await expect(removeQualificationAward(people.admin, ids.award, "")).rejects.toThrow(/Say why/);
    await removeQualificationAward(people.admin, ids.award, "Wrong number typed");
    expect(await awardsFor(people.admin, ids.learner)).toEqual([]);
  });

  it("is on the learner's readiness page and their record", () => {
    const page = readFileSync(join(process.cwd(), "app/readiness/[qualificationId]/[userId]/page.tsx"), "utf8");
    expect(page).toMatch(/<QualificationAward/);
    const person = readFileSync(join(process.cwd(), "app/people/[id]/page.tsx"), "utf8");
    expect(person).toMatch(/Qualifications awarded/);
  });
});
