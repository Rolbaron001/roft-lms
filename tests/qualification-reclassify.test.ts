/**
 * Correcting what a qualification is, after it has been created.
 *
 * The kind and the parent were settable only at import, so a qualification
 * imported as full that should have been a part had to be deleted and done
 * again - taking its documents and anything already built on it with it.
 * Heidi is about to import several for the first time, and "imported it as the
 * wrong kind" is the most ordinary mistake there is.
 *
 * The line it will not cross is enrolment, and that is what most of this file
 * is about. Enrolment is per programme ID: a learner is enrolled on this
 * qualification as it stands, and turning a full qualification into a part
 * changes which modules they are assessed against and therefore what they must
 * do to finish. That is not a correction, it is a different programme.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  courses,
  curriculumModules,
  enrolments,
  organisations,
  qualificationModules,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  PartQualificationError,
  planReclassification,
  reclassify,
} from "@/lib/part-qualifications";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learnerId: string;
let full: string;
let stray: string;
let alsoPart: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Re",
    lastName: "Classify",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function makeQualification(
  title: string,
  kind: "full" | "part" | "skills_programme",
  saqaId: string,
): Promise<string> {
  const [made] = await withPlatformScope("reclassify fixture", (tx) =>
    tx
      .insert(qualifications)
      .values({ organisationId, title, kind, saqaId })
      .returning({ id: qualifications.id }),
  );
  return made.id;
}

beforeAll(async () => {
  const slug = `reclass-${Date.now()}`;

  const made = await withPlatformScope("reclassify fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Reclassify Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const people: Record<string, string> = {};
    for (const key of ["admin", "learner"]) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `${key}@reclass.test`,
          firstName: "Re",
          lastName: key,
          status: "active",
        })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: person.id,
        role: key === "admin" ? "tenant_admin" : "learner",
      });
      people[key] = person.id;
    }

    return { orgId: organisation.id, people };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.people.admin);
  learnerId = made.people.learner;

  full = await makeQualification("A full qualification", "full", "700001");
  stray = await makeQualification(
    "Imported as full, should be a part",
    "full",
    "700002",
  );
  alsoPart = await makeQualification("Already a part", "part", "700003");
});

afterAll(async () => {
  await withPlatformScope("reclassify teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("saying what it would do, before doing it", () => {
  it("counts what the qualification holds", async () => {
    await withPlatformScope("a module of its own", (tx) =>
      tx.insert(curriculumModules).values({
        organisationId,
        qualificationId: stray,
        component: "knowledge",
        code: "KM01",
        title: "A module of its own",
        credits: 8,
      }),
    );

    const plan = await planReclassification(admin, stray);

    expect(plan.from).toBe("full");
    expect(plan.ownModules).toBe(1);
    expect(plan.enrolled).toBe(0);
  });
});

describe("correcting an import", () => {
  it("turns a full qualification into a part of another", async () => {
    const after = await reclassify(admin, stray, {
      kind: "part",
      parentId: full,
    });

    expect(after.to).toBe("part");

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select({
          kind: qualifications.kind,
          parent: qualifications.parentQualificationId,
        })
        .from(qualifications)
        .where(eq(qualifications.id, stray)),
    );

    expect(row.kind).toBe("part");
    expect(row.parent).toBe(full);
  });

  /**
   * Reported, not refused. It was imported as a full qualification and had a
   * curriculum of its own; that is a real state of affairs, and refusing the
   * correction because its consequence is untidy would leave the wrong answer
   * in place.
   */
  it("says the modules of its own curriculum are still there", async () => {
    const plan = await planReclassification(admin, stray);
    expect(plan.from).toBe("part");
    expect(plan.ownModules).toBe(1);
  });

  it("clears a module selection when it goes back to being full", async () => {
    const [someModule] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, stray)),
    );

    await withPlatformScope("a selection", (tx) =>
      tx.insert(qualificationModules).values({
        organisationId,
        qualificationId: stray,
        curriculumModuleId: someModule.id,
      }),
    );

    const after = await reclassify(admin, stray, { kind: "full" });

    // Left behind, those rows would keep counting towards its credits.
    expect(after.selectedModules).toBe(0);

    const left = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: qualificationModules.id })
        .from(qualificationModules)
        .where(eq(qualificationModules.qualificationId, stray)),
    );
    expect(left).toEqual([]);
  });

  it("forgets the parent when it goes back to being full", async () => {
    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select({ parent: qualifications.parentQualificationId })
        .from(qualifications)
        .where(eq(qualifications.id, stray)),
    );

    expect(row.parent).toBeNull();
  });
});

describe("what it will not do", () => {
  it("refuses a part with no parent named", async () => {
    await expect(
      reclassify(admin, stray, { kind: "part" }),
    ).rejects.toThrow(PartQualificationError);
  });

  it("refuses to make a qualification a part of itself", async () => {
    await expect(
      reclassify(admin, stray, { kind: "part", parentId: stray }),
    ).rejects.toThrow(/part of itself/i);
  });

  /**
   * One level, deliberately. A part of a part has no meaning in the documents:
   * each part's SAQA document lists the full qualification's own module codes.
   */
  it("refuses a parent that is itself a part", async () => {
    await expect(
      reclassify(admin, stray, { kind: "part", parentId: alsoPart }),
    ).rejects.toThrow(/itself a part/i);
  });

  /**
   * The one that matters. Changing the kind changes which modules a learner is
   * assessed against, and therefore what they have to do to complete.
   */
  it("refuses once anybody is enrolled on it", async () => {
    await withPlatformScope("an enrolment", async (tx) => {
      // An enrolment always attaches to a course or a learning path - the
      // qualification rides alongside it - so a fixture needs one.
      const [course] = await tx
        .insert(courses)
        .values({
          organisationId,
          title: "Something to be enrolled on",
          status: "published",
        })
        .returning({ id: courses.id });

      await tx.insert(enrolments).values({
        organisationId,
        userId: learnerId,
        courseId: course.id,
        qualificationId: stray,
        status: "in_progress",
      });
    });

    await expect(
      reclassify(admin, stray, { kind: "part", parentId: full }),
    ).rejects.toThrow(/enrolled/i);

    // And says what to do instead, rather than only saying no.
    await expect(
      reclassify(admin, stray, { kind: "part", parentId: full }),
    ).rejects.toThrow(/per programme ID/i);
  });

  it("keeps a learner out of it", async () => {
    const learner = sessionFor(["learner"], learnerId);

    await expect(
      reclassify(learner, full, { kind: "full" }),
    ).rejects.toThrow();
  });
});
