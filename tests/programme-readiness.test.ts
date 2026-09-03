/**
 * The order a programme is assembled in, and the check that enforces it.
 *
 * The three published documents come first, then the curriculum is read in,
 * then study unit material is built on top. That order is not a convention: a
 * question captured before the curriculum exists cannot be tagged to what it
 * evidences, so the alignment matrix under-reports and readiness is wrong in a
 * way nobody notices until an audit. Putting it right afterwards means
 * re-tagging every question by hand.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  organisations,
  programmeDocuments,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  assertProgrammeReady,
  NotReadyError,
  programmeReadiness,
} from "@/lib/programme-readiness";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;

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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A qualification with as much of the groundwork as asked for. */
async function buildQualification(options: {
  documents?: ("qualification_document" | "curriculum_document" | "assessment_specification")[];
  modules?: number;
  criteria?: number;
}) {
  return withTenant(organisationId, async (tx) => {
    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: `Qualification ${suffix()}` })
      .returning({ id: qualifications.id });

    for (const kind of options.documents ?? []) {
      await tx.insert(programmeDocuments).values({
        organisationId,
        qualificationId: qualification.id,
        kind,
        title: kind,
        filename: `${kind}.pdf`,
        storageKey: `key-${suffix()}`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
      });
    }

    for (let index = 0; index < (options.modules ?? 0); index += 1) {
      const [module] = await tx
        .insert(curriculumModules)
        .values({
          organisationId,
          qualificationId: qualification.id,
          component: "knowledge",
          code: `KM-0${index + 1}`,
          title: `Module ${index + 1}`,
        })
        .returning({ id: curriculumModules.id });

      for (let c = 0; c < (options.criteria ?? 0); c += 1) {
        await tx.insert(assessmentCriteria).values({
          organisationId,
          curriculumModuleId: module.id,
          code: `IAC0${index}${c}`,
          description: "Something a learner must demonstrate.",
        });
      }
    }

    return qualification.id;
  });
}

beforeAll(async () => {
  const slug = `ready-${Date.now()}`;

  organisationId = await withPlatformScope("readiness test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Readiness Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const userId = await withPlatformScope("readiness test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email: "author@ready.test",
        firstName: "Author",
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });
    await tx
      .insert(userRoles)
      .values({ organisationId, userId: user.id, role: "tenant_admin" });
    return user.id;
  });

  author = sessionFor(["tenant_admin"], userId);
});

afterAll(async () => {
  await withPlatformScope("readiness test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("before any material may be built", () => {
  it("names all four things missing on an empty qualification", async () => {
    const id = await buildQualification({});
    const readiness = await programmeReadiness(author, id);

    expect(readiness.ready).toBe(false);
    expect(readiness.gaps).toHaveLength(4);

    const what = readiness.gaps.map((gap) => gap.what).join(" ");
    expect(what).toContain("Qualification Document");
    expect(what).toContain("Curriculum Document");
    expect(what).toContain("Assessment Specification");
    expect(what).toContain("not been read into the App");

    // Every gap says what to do about it, not merely that it exists.
    expect(readiness.gaps.every((gap) => gap.action.length > 20)).toBe(true);
  });

  /**
   * The distinction that matters most. A curriculum document sitting in the
   * library with no modules behind it looks complete on a shelf and is useless
   * to everything downstream.
   */
  it("does not accept the file as a substitute for reading it in", async () => {
    const id = await buildQualification({
      documents: [
        "qualification_document",
        "curriculum_document",
        "assessment_specification",
      ],
    });

    const readiness = await programmeReadiness(author, id);

    expect(readiness.documents).toEqual({
      qualification: true,
      curriculum: true,
      assessmentSpecification: true,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.gaps).toHaveLength(1);
    expect(readiness.gaps[0].what).toContain("not been read into the App");
  });

  it("refuses a curriculum with modules but no criteria", async () => {
    const id = await buildQualification({
      documents: [
        "qualification_document",
        "curriculum_document",
        "assessment_specification",
      ],
      modules: 3,
      criteria: 0,
    });

    const readiness = await programmeReadiness(author, id);
    expect(readiness.ready).toBe(false);
    expect(readiness.gaps[0].what).toContain("no assessment criteria");
  });

  it("is ready once the documents are in and the curriculum is read", async () => {
    const id = await buildQualification({
      documents: [
        "qualification_document",
        "curriculum_document",
        "assessment_specification",
      ],
      modules: 2,
      criteria: 3,
    });

    const readiness = await programmeReadiness(author, id);

    expect(readiness.ready).toBe(true);
    expect(readiness.gaps).toEqual([]);
    expect(readiness.curriculum.modules).toBe(2);
    expect(readiness.curriculum.criteria).toBe(6);
  });
});

describe("the refusal", () => {
  it("refuses and carries what to do next", async () => {
    const id = await buildQualification({ documents: ["curriculum_document"] });

    await expect(assertProgrammeReady(author, id)).rejects.toThrow(NotReadyError);

    try {
      await assertProgrammeReady(author, id);
    } catch (error) {
      const notReady = error as NotReadyError;
      expect(notReady.gaps.length).toBeGreaterThan(0);
      // The message is for a person to act on, not a code to look up.
      expect(notReady.message).toContain("not ready for material yet");
      expect(notReady.gaps[0].action).toBeTruthy();
    }
  });

  it("lets a ready qualification through", async () => {
    const id = await buildQualification({
      documents: [
        "qualification_document",
        "curriculum_document",
        "assessment_specification",
      ],
      modules: 1,
      criteria: 1,
    });

    await expect(assertProgrammeReady(author, id)).resolves.toBeUndefined();
  });
});
